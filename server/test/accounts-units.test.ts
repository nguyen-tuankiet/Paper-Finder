import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, LibraryItem } from '../../shared/types.js';
import { MemoryAccountStore } from '../src/accounts/memoryStore.js';
import { hashPassword, verifyPassword } from '../src/accounts/passwords.js';
import { BillingService } from '../src/accounts/billing.js';
import { extractOrderCode, isOurAccount, memoFor, parseSepayPayload, qrUrl, verifyApiKey } from '../src/accounts/sepay.js';
import { PgAccountStore } from '../src/accounts/pgStore.js';
import { PERIOD_DAYS, applyPurchase, buildEntitlements, parsePlanKey, planKey, tierOf } from '../src/accounts/plans.js';
import { QuotaService } from '../src/accounts/quota.js';
import { libraryKey } from '../src/accounts/routes.js';
import { SessionSigner, readCookie } from '../src/accounts/session.js';
import type { AccountStore, OrderRow } from '../src/accounts/types.js';
import { toBibtex, toRis, type ExportRecord } from '../src/services/export.js';
import { makeRecord } from './helpers.js';

describe('mật khẩu', () => {
  it('băm khác nhau mỗi lần, xác minh đúng và sai', async () => {
    const a = await hashPassword('mat-khau-dai-123');
    const b = await hashPassword('mat-khau-dai-123');
    expect(a).not.toBe(b);
    expect(await verifyPassword('mat-khau-dai-123', a)).toBe(true);
    expect(await verifyPassword('mat-khau-dai-124', a)).toBe(false);
    expect(await verifyPassword('x', 'khong-phai-bam')).toBe(false);
  });
});

describe('phiên đăng nhập', () => {
  const signer = new SessionSigner('s'.repeat(40));
  it('tạo và xác minh token', () => {
    const t = signer.create('u1', 3, 1000);
    expect(signer.verify(t, 2000)).toMatchObject({ userId: 'u1', sessionVersion: 3 });
    expect(signer.verify(t, 2000)?.expiresAt).toBeGreaterThan(1000 + 179 * 24 * 3600 * 1000);
  });
  it('từ chối token hết hạn, sai chữ ký, sai khóa, định dạng lạ', () => {
    const t = signer.create('u1', 1, 1000);
    expect(signer.verify(t, 1000 + 181 * 24 * 3600 * 1000)).toBeNull();
    expect(signer.verify(t, 1000 + 170 * 24 * 3600 * 1000)).not.toBeNull();
    const [body] = t.split('.');
    expect(signer.verify(`${body}.AAAA`)).toBeNull();
    expect(new SessionSigner('k'.repeat(40)).verify(t, 2000)).toBeNull();
    expect(signer.verify('')).toBeNull();
    expect(signer.verify('a.b.c')).toBeNull();
    // payload bị sửa (đổi người dùng) nhưng giữ chữ ký cũ
    const forged = Buffer.from(JSON.stringify({ u: 'admin', v: 1, e: Date.now() + 1e9 })).toString('base64url');
    expect(signer.verify(`${forged}.${t.split('.')[1]}`)).toBeNull();
  });
  it('đọc cookie đúng tên', () => {
    expect(readCookie('a=1; pf_session=abc%3D; b=2', 'pf_session')).toBe('abc=');
    expect(readCookie(undefined, 'pf_session')).toBeUndefined();
    expect(readCookie('a=1', 'pf_session')).toBeUndefined();
  });
});

describe('hạn mức theo ngày', () => {
  it('đặt lại lúc nửa đêm giờ Việt Nam và tách bộ đếm theo ngày', async () => {
    let now = new Date('2026-03-10T16:30:00Z'); // 23:30 ngày 10/3 giờ VN
    const store = new MemoryAccountStore();
    const quota = new QuotaService({ store, dailySearches: (tier) => ({ guest: 1, free: 2, standard: null, pro: null })[tier], timezone: 'Asia/Ho_Chi_Minh', now: () => now });
    const guest = { kind: 'guest', key: 'g1' } as const;

    expect((await quota.consume(guest, 1)).ok).toBe(true);
    const blocked = await quota.consume(guest, 1);
    expect(blocked.ok).toBe(false);
    expect(blocked.quota.resetsAt).toBe('2026-03-10T17:00:00.000Z'); // 00:00 ngày 11/3 giờ VN

    now = new Date('2026-03-10T17:01:00Z'); // đã sang ngày mới
    expect((await quota.consume(guest, 1)).ok).toBe(true);
  });

  it('thành viên: kiểm tra đủ lượt trước khi trừ, hoàn lượt, Pro không giới hạn', async () => {
    const store = new MemoryAccountStore();
    const user = (await store.createUser('a@b.co', 'x'))!;
    const quota = new QuotaService({ store, dailySearches: (tier) => ({ guest: 1, free: 3, standard: null, pro: null })[tier], timezone: 'Asia/Ho_Chi_Minh' });
    const free = { kind: 'user', userId: user.id, tier: 'free' } as const;

    expect((await quota.consume(free, 2)).quota.remaining).toBe(1);
    const over = await quota.consume(free, 2);
    expect(over.ok).toBe(false);
    expect(over.quota.used).toBe(2); // không bị trừ khi từ chối
    await quota.refund(free, 2);
    expect((await quota.peek(free)).used).toBe(0);
    await quota.refund(free, 5);
    expect((await quota.peek(free)).used).toBe(0); // không âm

    for (const tier of ['standard', 'pro'] as const) {
      expect((await quota.consume({ kind: 'user', userId: user.id, tier }, 100)).quota.limit).toBeNull();
    }
  });

  it('khách hạn mức 0 phải đăng nhập', async () => {
    const quota = new QuotaService({ store: new MemoryAccountStore(), dailySearches: (tier) => (tier === 'guest' ? 0 : 3), timezone: 'UTC' });
    expect((await quota.consume({ kind: 'guest', key: 'k' }, 1)).ok).toBe(false);
  });
});

describe('SePay: đọc và đối chiếu giao dịch', () => {
  it('nội dung chuyển khoản và QR', () => {
    expect(memoFor('PF', 482913057)).toBe('PF482913057');
    const url = new URL(qrUrl({ apiKey: 'k', accountNumber: '0123456789', bankName: 'MBBank', codePrefix: 'PF' }, 29000, 'PF482913057'));
    expect(url.searchParams.get('amount')).toBe('29000');
    expect(url.searchParams.get('des')).toBe('PF482913057');
  });

  it('lấy mã đơn từ code hoặc nội dung, không phân biệt hoa thường, cho phép khoảng trắng', () => {
    expect(extractOrderCode('PF', { content: 'Thanh toan PF482913057 cam on' })).toBe(482913057);
    expect(extractOrderCode('PF', { content: 'pf482913057' })).toBe(482913057);
    expect(extractOrderCode('PF', { content: 'PF 482913057' })).toBe(482913057);
    expect(extractOrderCode('PF', { code: 'PF482913057', content: 'khong co' })).toBe(482913057);
    expect(extractOrderCode('PF', { description: 'BankAPINotify PF482913057' })).toBe(482913057);
    expect(extractOrderCode('TT', { content: 'TT123456789' })).toBe(123456789);
    for (const bad of ['', 'PF', 'PF12345', 'PF1234567890123', 'XX482913057', 'toi chuyen PF abc']) expect(extractOrderCode('PF', { content: bad })).toBeNull();
    expect(extractOrderCode('PF', {})).toBeNull();
    expect(extractOrderCode('P.F', { content: 'PxF123456789' })).toBeNull(); // tiền tố được thoát ký tự đặc biệt
  });

  it('khóa API: đúng dạng Apikey, sai khóa, thiếu header', () => {
    expect(verifyApiKey('Apikey abc12345', 'abc12345')).toBe(true);
    expect(verifyApiKey('apikey   abc12345 ', 'abc12345')).toBe(true);
    expect(verifyApiKey('Apikey abc12346', 'abc12345')).toBe(false);
    expect(verifyApiKey('Bearer abc12345', 'abc12345')).toBe(false);
    expect(verifyApiKey('abc12345', 'abc12345')).toBe(false);
    expect(verifyApiKey(undefined, 'abc12345')).toBe(false);
    expect(verifyApiKey('Apikey ', 'abc12345')).toBe(false);
  });

  it('đọc payload webhook chặt chẽ', () => {
    expect(parseSepayPayload({ id: 92704, transferType: 'in', transferAmount: 2277000, accountNumber: '0123', content: 'PF1', code: null, referenceCode: 'FT1' })).toEqual({
      id: '92704',
      direction: 'in',
      amount: 2277000,
      accountNumber: '0123',
      code: undefined,
      content: 'PF1',
      referenceCode: 'FT1',
    });
    expect(parseSepayPayload({ id: 'x1', transferType: 'out', transferAmount: '5000' })).toMatchObject({ id: 'x1', direction: 'out', amount: 5000 });
    for (const bad of [null, 'text', 1, {}, { id: 1 }, { id: 1, transferType: 'in' }, { id: 1, transferType: 'in', transferAmount: -5 }, { id: 1, transferType: 'x', transferAmount: 5 }, { transferType: 'in', transferAmount: 5 }]) {
      expect(parseSepayPayload(bad)).toBeNull();
    }
  });
});

describe('SePay: tài khoản nhận (VA của BIDV...)', () => {
  const va = { apiKey: 'k', accountNumber: '96247NJ49C', accountAliases: ['3144423864'], bankName: 'BIDV', codePrefix: 'PF' };

  it('nhận giao dịch báo theo VA, theo tài khoản chính hoặc theo tài khoản phụ; không phân biệt hoa thường và dấu cách', () => {
    expect(isOurAccount(va, { accountNumber: '96247NJ49C' })).toBe(true);
    expect(isOurAccount(va, { accountNumber: '96247nj49c' })).toBe(true);
    expect(isOurAccount(va, { accountNumber: '3144423864' })).toBe(true);
    expect(isOurAccount(va, { accountNumber: '3144 4238-64' })).toBe(true);
    expect(isOurAccount(va, { accountNumber: '9999999999', subAccount: '96247NJ49C' })).toBe(true);
  });

  it('từ chối tài khoản lạ; không có thông tin tài khoản thì không từ chối', () => {
    expect(isOurAccount(va, { accountNumber: '9999999999' })).toBe(false);
    expect(isOurAccount(va, { accountNumber: '9999999999', subAccount: 'ABC' })).toBe(false);
    expect(isOurAccount({ ...va, accountAliases: undefined }, { accountNumber: '3144423864' })).toBe(false);
    expect(isOurAccount(va, { accountNumber: '' })).toBe(true);
  });

  it('QR dùng số VA và payload đọc được tài khoản phụ', () => {
    expect(new URL(qrUrl(va, 2000, 'PF123456789')).searchParams.get('acc')).toBe('96247NJ49C');
    expect(parseSepayPayload({ id: 1, transferType: 'in', transferAmount: 5, accountNumber: '3144423864', subAccount: '96247NJ49C' })).toMatchObject({ accountNumber: '3144423864', subAccount: '96247NJ49C' });
  });

  it('BillingService kích hoạt khi tiền vào báo theo tài khoản chính của VA', async () => {
    const store = new MemoryAccountStore();
    const billing = new BillingService({ store, sepay: va, prices: { 'standard:week': 2_000, 'standard:month': 29_000, 'standard:year': 119_000, 'pro:week': 20_000, 'pro:month': 49_000, 'pro:year': 229_000 } });
    const user = (await store.createUser('a@b.co', 'h'))!;
    const a = await billing.checkout(user, 'standard', 'week');
    expect(a.accountNumber).toBe('96247NJ49C');
    expect(await billing.handleTransaction({ id: '1', direction: 'in', amount: 2_000, accountNumber: '3144423864', content: a.memo })).toEqual({ result: 'activated', orderCode: a.orderCode });
    const b = await billing.checkout(user, 'standard', 'week');
    expect(await billing.handleTransaction({ id: '2', direction: 'in', amount: 2_000, accountNumber: '8888888888', content: b.memo })).toEqual({ result: 'wrong_account', orderCode: b.orderCode });
  });
});

describe('xử lý giao dịch SePay (BillingService)', () => {
  const prices = { 'standard:week': 10_000, 'standard:month': 29_000, 'standard:year': 119_000, 'pro:week': 20_000, 'pro:month': 49_000, 'pro:year': 229_000 };
  const sepay = { apiKey: 'k', accountNumber: '0123456789', bankName: 'MBBank', codePrefix: 'PF' };
  const tx = (over: Record<string, unknown> = {}) => ({ id: '1', direction: 'in' as const, amount: 29_000, accountNumber: '0123456789', content: '', ...over });

  it('kết quả từng trường hợp', async () => {
    const store = new MemoryAccountStore();
    const billing = new BillingService({ store, sepay, prices, now: () => new Date('2026-10-29T00:00:00Z') });
    const user = (await store.createUser('a@b.co', 'h'))!;
    const { orderCode, memo } = await billing.checkout(user, 'standard', 'month');

    expect(await billing.handleTransaction(tx({ direction: 'out', content: memo }))).toEqual({ result: 'ignored' });
    expect(await billing.handleTransaction(tx({ content: 'khong co ma' }))).toEqual({ result: 'unmatched' });
    expect(await billing.handleTransaction(tx({ content: 'PF999999999' }))).toEqual({ result: 'unmatched' });
    expect(await billing.handleTransaction(tx({ content: memo, accountNumber: '111' }))).toEqual({ result: 'wrong_account', orderCode });
    expect(await billing.handleTransaction(tx({ content: memo, amount: 28_999 }))).toEqual({ result: 'underpaid', orderCode });
    expect((await store.getOrder(orderCode))?.status).toBe('pending');
    expect(await billing.handleTransaction(tx({ content: memo, id: '77' }))).toEqual({ result: 'activated', orderCode });
    expect(await billing.handleTransaction(tx({ content: memo, id: '78' }))).toEqual({ result: 'duplicate', orderCode });
    expect((await store.getOrder(orderCode))).toMatchObject({ status: 'paid', paymentRef: 'sepay:77' });
  });

  it('chưa cấu hình SePay thì mọi giao dịch bị bỏ qua và không tạo được đơn', async () => {
    const store = new MemoryAccountStore();
    const billing = new BillingService({ store, prices });
    const user = (await store.createUser('a@b.co', 'h'))!;
    expect(billing.enabled).toBe(false);
    await expect(billing.checkout(user, 'pro', 'week')).rejects.toThrow();
    expect(await billing.handleTransaction(tx({ content: 'PF123456789' }))).toEqual({ result: 'ignored' });
  });

  it('đơn quá hạn hiển thị thì báo hết hạn, nhưng tiền về muộn vẫn kích hoạt', async () => {
    let now = new Date('2026-10-29T00:00:00Z');
    const store = new MemoryAccountStore();
    const billing = new BillingService({ store, sepay, prices, now: () => now });
    const user = (await store.createUser('a@b.co', 'h'))!;
    const { orderCode, memo } = await billing.checkout(user, 'pro', 'week');
    expect((await billing.status(orderCode, user.id)).status).toBe('pending');
    now = new Date('2026-10-30T01:00:00Z'); // hơn 24 giờ
    expect((await billing.status(orderCode, user.id)).status).toBe('cancelled');
    expect(await billing.handleTransaction(tx({ content: memo, amount: 20_000 }))).toEqual({ result: 'activated', orderCode });
    expect((await billing.status(orderCode, user.id)).status).toBe('paid');
  });
});

describe('mã khóa thư viện', () => {
  it('DOI chữ thường; không có DOI thì băm tiêu đề + năm, ổn định', () => {
    expect(libraryKey({ doi: '10.1/ABC', title: 'x', publicationYear: 2020 })).toBe('10.1/abc');
    const a = libraryKey({ doi: '', title: 'Hello   World', publicationYear: 2020 });
    expect(a).toBe(libraryKey({ doi: '', title: 'hello world', publicationYear: 2020 }));
    expect(a).not.toBe(libraryKey({ doi: '', title: 'hello world', publicationYear: 2021 }));
    expect(a).toMatch(/^h:[0-9a-f]{24}$/);
  });
});

// ---------- Hợp đồng chung cho hai kho dữ liệu ----------

const NOW = new Date('2026-05-01T00:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

async function makePgStore(): Promise<AccountStore> {
  const { Pool } = newDb().adapters.createPg();
  return PgAccountStore.withPool(new Pool());
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

const factories: [string, () => Promise<AccountStore>][] = [
  ['bộ nhớ', async () => new MemoryAccountStore()],
  ['PostgreSQL (pg-mem)', makePgStore],
];

describe.each(factories)('kho tài khoản: %s', (_name, make) => {
  it('tạo người dùng, email không phân biệt hoa thường, email trùng trả null', async () => {
    const store = await make();
    const u = await store.createUser('User@Example.com', 'hash1');
    expect(u).toMatchObject({ email: 'user@example.com', sessionVersion: 1, standardUntil: null, proUntil: null });
    expect(await store.createUser('USER@example.com', 'hash2')).toBeNull();
    expect((await store.getUserByEmail('user@EXAMPLE.com'))?.id).toBe(u!.id);
    expect((await store.getUserById(u!.id))?.email).toBe('user@example.com');
    expect(await store.getUserById('khong-co')).toBeNull();
  });

  it('liệt kê đơn mới nhất trước kèm email, giới hạn số đơn', async () => {
    const store = await make();
    const u = (await store.createUser('Buyer@Example.com', 'h'))!;
    const mk = (orderCode: number, n: number, userId = u.id) => ({ orderCode, userId, plan: 'pro:week' as const, amount: 20_000, status: 'pending' as const, createdAt: day(n), paidAt: null, paymentRef: null });
    await store.createOrder(mk(100000001, 1));
    await store.createOrder(mk(100000002, 3));
    await store.createOrder(mk(100000003, 2, 'tai-khoan-da-xoa'));
    await store.settleOrder(100000002, NOW, 'sepay:9');
    const all = await store.listOrders(10);
    expect(all.map((o) => o.orderCode)).toEqual([100000002, 100000003, 100000001]);
    expect(all[0]).toMatchObject({ email: 'buyer@example.com', status: 'paid', paymentRef: 'sepay:9' });
    expect(all[1]?.email).toBeNull();
    expect(await store.listOrders(1)).toHaveLength(1);
    expect(await store.listOrders(0)).toEqual([]);
  });

  it('đổi mật khẩu tăng sessionVersion', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'old'))!;
    await store.setPassword(u.id, 'new');
    const after = (await store.getUserById(u.id))!;
    expect(after.passwordHash).toBe('new');
    expect(after.sessionVersion).toBe(2);
  });

  it('đếm lượt dùng theo ngày, không âm, ngày khác tách biệt', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    expect(await store.addUsage(u.id, '2026-05-01', 2)).toBe(2);
    expect(await store.addUsage(u.id, '2026-05-01', 1)).toBe(3);
    expect(await store.addUsage(u.id, '2026-05-01', -1)).toBe(2);
    expect(await store.addUsage(u.id, '2026-05-01', -10)).toBe(0);
    expect(await store.getUsage(u.id, '2026-05-02')).toBe(0);
    expect(await store.addUsage(u.id, '2026-05-02', 1)).toBe(1);
    expect(await store.getUsage(u.id, '2026-05-01')).toBe(0);
  });

  it('cấp gói cộng dồn từ hạn hiện tại hoặc từ bây giờ nếu đã hết hạn', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    expect((await store.grantPlan(u.id, 'pro', 30, NOW))?.proUntil).toBe(day(30));
    expect((await store.grantPlan(u.id, 'pro', 30, NOW))?.proUntil).toBe(day(60));
    const later = new Date(day(100));
    expect((await store.grantPlan(u.id, 'pro', 10, later))?.proUntil).toBe(new Date(later.getTime() + 10 * 86_400_000).toISOString());
    expect(await store.grantPlan('khong-co', 'pro', 1, NOW)).toBeNull();
    expect((await store.getUserById(u.id))!.standardUntil).toBeNull();
  });

  it('cấp lẫn hai hạng lưu đủ hai hạn (Tiêu chuẩn lùi lại khi mua Pro)', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    await store.grantPlan(u.id, 'standard', 30, NOW);
    const after = (await store.grantPlan(u.id, 'pro', 7, NOW))!;
    expect(after.proUntil).toBe(day(7));
    expect(after.standardUntil).toBe(day(37));
    const reread = (await store.getUserById(u.id))!;
    expect([reread.proUntil, reread.standardUntil]).toEqual([day(7), day(37)]);
  });

  it('settleOrder chỉ kích hoạt một lần, kể cả khi gọi đồng thời', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    const order: OrderRow = { orderCode: 1_700_000_000_000_123, userId: u.id, plan: 'standard:month', amount: 39_000, status: 'pending', createdAt: NOW.toISOString(), paidAt: null, paymentRef: null };
    await store.createOrder(order);
    expect((await store.getOrder(order.orderCode))?.status).toBe('pending');

    const results = await Promise.all([store.settleOrder(order.orderCode, NOW, 'sepay:1'), store.settleOrder(order.orderCode, NOW, 'sepay:2'), store.settleOrder(order.orderCode, NOW, 'sepay:3')]);
    expect(results.filter((r) => r?.activated).length).toBe(1);
    expect(results.every((r) => r?.order.status === 'paid')).toBe(true);
    expect((await store.getUserById(u.id))?.standardUntil).toBe(day(30));
    expect((await store.getUserById(u.id))?.proUntil).toBeNull();
    expect((await store.getOrder(order.orderCode))?.paidAt).toBe(NOW.toISOString());
    expect((await store.getOrder(order.orderCode))?.paymentRef).toMatch(/^sepay:[123]$/); // chỉ lần gọi thắng cuộc được ghi
    expect(await store.settleOrder(999, NOW)).toBeNull();

    await store.setOrderStatus(order.orderCode, 'cancelled'); // đơn đã trả tiền không bị hủy
    expect((await store.getOrder(order.orderCode))?.status).toBe('paid');
  });

  it('thống kê tài khoản theo hạng', async () => {
    const store = await make();
    const a = (await store.createUser('a@b.co', 'h'))!;
    const b = (await store.createUser('c@d.co', 'h'))!;
    await store.createUser('e@f.co', 'h');
    await store.grantPlan(a.id, 'pro', 30, NOW);
    await store.grantPlan(b.id, 'standard', 7, NOW);
    await store.createOrder({ orderCode: 5, userId: a.id, plan: 'pro:year', amount: 599_000, status: 'pending', createdAt: NOW.toISOString(), paidAt: null, paymentRef: null });
    await store.settleOrder(5, NOW);
    expect(await store.counts(NOW)).toEqual({ users: 3, activeStandard: 1, activePro: 1, paidOrders: 1, revenueVnd: 599_000 });
  });

  it('thư viện: lưu, trùng cập nhật thư mục, giới hạn, xóa, tách biệt giữa người dùng', async () => {
    const store = await make();
    const u1 = (await store.createUser('a@b.co', 'h'))!;
    const u2 = (await store.createUser('c@d.co', 'h'))!;
    const item = (key: string, folder = ''): LibraryItem => ({ key, folder, savedAt: NOW.toISOString(), record: makeRecord({ title: `Paper ${key}`, doi: key }) });
    expect(await store.saveToLibrary(u1.id, item('10.1/a'), 2)).toBe('saved');
    expect(await store.saveToLibrary(u1.id, item('10.1/a', 'Luận văn'), 2)).toBe('exists');
    expect(await store.saveToLibrary(u1.id, item('10.1/b'), 2)).toBe('saved');
    expect(await store.saveToLibrary(u1.id, item('10.1/c'), 2)).toBe('full');
    expect(await store.saveToLibrary(u2.id, item('10.1/a'), 2)).toBe('saved');

    const list = await store.listLibrary(u1.id);
    expect(list.map((i) => i.key).sort()).toEqual(['10.1/a', '10.1/b']);
    expect(list.find((i) => i.key === '10.1/a')?.folder).toBe('Luận văn');
    expect(list[0]!.record.title).toMatch(/^Paper /);

    expect(await store.removeFromLibrary(u1.id, '10.1/a')).toBe(true);
    expect(await store.removeFromLibrary(u1.id, '10.1/a')).toBe(false);
    expect(await store.listLibrary(u2.id)).toHaveLength(1);
  });

  it('lịch sử: mới nhất trước, giữ tối đa N mục, xóa được', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    const entry = (n: number): HistoryEntry => ({
      id: `h${n}`,
      at: day(n),
      total: n,
      request: { keywords: [`k${n}`], sources: ['crossref'], maxResults: 20, onlyWithDoi: true },
    });
    for (let n = 1; n <= 5; n++) await store.addHistory(u.id, entry(n), 3);
    const list = await store.listHistory(u.id);
    expect(list.map((h) => h.id)).toEqual(['h5', 'h4', 'h3']);
    expect(list[0]).toMatchObject({ total: 5, request: { keywords: ['k5'] } });
    await store.clearHistory(u.id);
    expect(await store.listHistory(u.id)).toEqual([]);
  });
});

describe('kho tài khoản dạng file', () => {
  it('ghi ra file và nạp lại được; file hỏng được giữ lại và không làm sập', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pf-acc-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'accounts.json');

    const first = new MemoryAccountStore({ filePath: file, flushIntervalMs: 0 });
    const u = (await first.createUser('a@b.co', 'hash'))!;
    await first.addUsage(u.id, '2026-05-01', 2);
    await first.grantPlan(u.id, 'pro', 30, NOW);
    await first.close();

    const second = new MemoryAccountStore({ filePath: file, flushIntervalMs: 0 });
    expect((await second.getUserByEmail('a@b.co'))?.proUntil).toBe(day(30));
    expect((await second.getUserByEmail('a@b.co'))?.standardUntil).toBeNull();
    expect(await second.getUsage(u.id, '2026-05-01')).toBe(2);
    await second.close();

    writeFileSync(file, '{ not json');
    const third = new MemoryAccountStore({ filePath: file, flushIntervalMs: 0 });
    expect(await third.getUserByEmail('a@b.co')).toBeNull();
    await third.createUser('x@y.co', 'h');
    await third.close();
    expect(JSON.parse(readFileSync(file, 'utf8')).users).toHaveLength(1);
  });
});

describe('gói và quyền lợi', () => {
  it('khóa gói: tạo và đọc lại, từ chối khóa sai', () => {
    expect(planKey('pro', 'month')).toBe('pro:month');
    expect(parsePlanKey('standard:year')).toEqual({ tier: 'standard', period: 'year' });
    for (const bad of ['', 'month', 'free:month', 'pro:decade', 'pro', 'pro:month:x']) expect(parsePlanKey(bad)).toBeNull();
    expect(PERIOD_DAYS).toEqual({ week: 7, month: 30, year: 365 });
  });

  it('hạng hiệu lực: Pro > Tiêu chuẩn > miễn phí, theo hạn còn lại', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const future = '2026-06-01T00:00:00Z';
    const past = '2026-04-01T00:00:00Z';
    expect(tierOf({ standardUntil: null, proUntil: null }, now)).toBe('free');
    expect(tierOf({ standardUntil: future, proUntil: null }, now)).toBe('standard');
    expect(tierOf({ standardUntil: future, proUntil: future }, now)).toBe('pro');
    expect(tierOf({ standardUntil: future, proUntil: past }, now)).toBe('standard');
    expect(tierOf({ standardUntil: past, proUntil: past }, now)).toBe('free');
    expect(tierOf({ standardUntil: null, proUntil: '2026-05-01T00:00:00Z' }, now)).toBe('free'); // đúng thời điểm hết hạn
  });

  it('mua Pro khi đang có Tiêu chuẩn: Tiêu chuẩn lùi đúng bằng số ngày Pro; hết Pro thì dùng tiếp phần còn lại', () => {
    const t0 = new Date('2026-05-01T00:00:00Z');
    const bought = applyPurchase({ standardUntil: null, proUntil: null }, 'standard', 30, t0);
    const t10 = new Date('2026-05-11T00:00:00Z');
    const withPro = applyPurchase(bought, 'pro', 7, t10);
    expect(withPro.proUntil).toBe('2026-05-18T00:00:00.000Z');
    expect(withPro.standardUntil).toBe('2026-06-07T00:00:00.000Z'); // 31/5 + 7 ngày
    const afterPro = new Date('2026-05-18T00:00:00.001Z');
    expect(tierOf(withPro, afterPro)).toBe('standard');
    // Còn lại đúng 20 ngày Tiêu chuẩn như lúc mua Pro (30 - 10).
    expect((new Date(withPro.standardUntil!).getTime() - new Date('2026-05-18T00:00:00Z').getTime()) / 86_400_000).toBe(20);
  });

  it('mua Tiêu chuẩn khi đang có Pro: bắt đầu sau Pro; mua Pro khi Tiêu chuẩn đã hết hạn thì không đụng tới nó', () => {
    const t0 = new Date('2026-05-01T00:00:00Z');
    const pro = applyPurchase({ standardUntil: null, proUntil: null }, 'pro', 7, t0);
    const both = applyPurchase(pro, 'standard', 7, t0);
    expect(both.proUntil).toBe('2026-05-08T00:00:00.000Z');
    expect(both.standardUntil).toBe('2026-05-15T00:00:00.000Z');

    const expiredStandard = { standardUntil: '2026-03-01T00:00:00.000Z', proUntil: null };
    expect(applyPurchase(expiredStandard, 'pro', 7, t0).standardUntil).toBe('2026-03-01T00:00:00.000Z');
  });

  it('quyền lợi tăng dần theo hạng, khách không xuất file', () => {
    const e = buildEntitlements({ guestDailySearches: 3, freeDailySearches: 10 });
    expect(e.guest).toMatchObject({ dailySearches: 3, exportRows: 0, libraryMax: 0, historyMax: 0, referenceExport: false });
    expect(e.free).toMatchObject({ dailySearches: 10, exportRows: 50 });
    expect(e.standard.dailySearches).toBeNull();
    expect(e.pro.dailySearches).toBeNull();
    const order = [e.guest, e.free, e.standard, e.pro];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.maxResultsPerSource).toBeGreaterThanOrEqual(order[i - 1]!.maxResultsPerSource);
      expect(order[i]!.libraryMax).toBeGreaterThanOrEqual(order[i - 1]!.libraryMax);
      expect(order[i]!.historyMax).toBeGreaterThanOrEqual(order[i - 1]!.historyMax);
    }
    expect(e.standard.referenceExport).toBe(false);
    expect(e.pro.referenceExport).toBe(true);
  });
});

// ---------- BibTeX / RIS ----------

const rec = (over: Partial<ExportRecord> = {}): ExportRecord => ({
  title: 'A study',
  doi: '',
  authors: [],
  publicationYear: 2020,
  journal: '',
  publisher: '',
  documentType: 'journal-article',
  abstract: '',
  sources: [],
  originalUrl: '',
  queryKeywords: [],
  ...over,
});

describe('BibTeX', () => {
  it('chọn kiểu mục theo loại tài liệu', () => {
    const text = toBibtex([
      rec({ documentType: 'proceedings-article', journal: 'ICML' }),
      rec({ documentType: 'book' }),
      rec({ documentType: 'book-chapter', journal: 'Handbook' }),
      rec({ documentType: 'dissertation' }),
      rec({ documentType: 'posted-content', journal: 'arXiv' }),
      rec({ documentType: 'journal-article', journal: 'J' }),
    ]).toString();
    for (const type of ['inproceedings', 'book', 'incollection', 'phdthesis', 'misc', 'article']) expect(text).toContain(`@${type}{`);
    expect(text).toContain('booktitle = {ICML}');
  });

  it('khóa trích dẫn bỏ dấu tiếng Việt và không trùng nhau', () => {
    const same = rec({ title: 'Machine learning', authors: [{ name: 'Nguyễn Đức Anh', family: 'Đức Anh', given: 'Nguyễn' }] });
    const text = toBibtex([same, same, same]).toString();
    const keys = [...text.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1]);
    expect(keys).toEqual(['DucAnh2020Machine', 'DucAnh2020Machineb', 'DucAnh2020Machinec']);
    expect(new Set(keys).size).toBe(3);
  });

  it('loại ngoặc nhọn và thoát ký tự đặc biệt để không làm hỏng file', () => {
    const text = toBibtex([rec({ title: 'Cost {of} 50% & $5 #1_x \\ end', doi: '10.1/x' })]).toString();
    expect(text).toContain('title = {Cost of 50\\% \\& \\$5 \\#1\\_x end}');
    expect(text.match(/\{/g)!.length).toBe(text.match(/\}/g)!.length);
  });

  it('bỏ trường trống, dùng URL khi không có DOI', () => {
    const text = toBibtex([rec({ originalUrl: 'https://example.org/p' })]).toString();
    expect(text).not.toContain('doi =');
    expect(text).not.toContain('journal =');
    expect(text).toContain('url = {https://example.org/p}');
  });

  it('tác giả chỉ có tên đầy đủ thì lấy từ cuối làm họ; tên dạng "Họ, Tên" giữ nguyên', () => {
    const text = toBibtex([rec({ authors: [{ name: 'Ada Lovelace' }, { name: 'Turing, Alan' }, { name: 'Plato' }] })]).toString();
    expect(text).toContain('author = {Lovelace, Ada and Turing, Alan and Plato}');
  });
});

describe('RIS', () => {
  it('mỗi bài kết thúc bằng ER và dùng CRLF', () => {
    const text = toRis([rec({ title: 'One' }), rec({ title: 'Two', pages: '12' })]).toString();
    expect(text.split('\r\n').filter((l) => l.startsWith('ER'))).toHaveLength(2);
    expect(text).toContain('SP  - 12');
    expect(text).not.toContain('EP  - 12');
    expect(text).not.toMatch(/[^\r]\n/);
  });
  it('gộp xuống dòng trong abstract thành một dòng', () => {
    expect(toRis([rec({ abstract: 'line1\nline2\r\nline3' })]).toString()).toContain('AB  - line1 line2 line3');
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, LibraryItem } from '../../shared/types.js';
import { MemoryAccountStore } from '../src/accounts/memoryStore.js';
import { hashPassword, verifyPassword } from '../src/accounts/passwords.js';
import { PayOsClient } from '../src/accounts/payos.js';
import { PgAccountStore } from '../src/accounts/pgStore.js';
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
    expect(signer.verify(t, 2000)).toEqual({ userId: 'u1', sessionVersion: 3 });
  });
  it('từ chối token hết hạn, sai chữ ký, sai khóa, định dạng lạ', () => {
    const t = signer.create('u1', 1, 1000);
    expect(signer.verify(t, 1000 + 31 * 24 * 3600 * 1000)).toBeNull();
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
    const quota = new QuotaService({ store, freeDailySearches: 2, guestDailySearches: 1, timezone: 'Asia/Ho_Chi_Minh', now: () => now });
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
    const quota = new QuotaService({ store, freeDailySearches: 3, guestDailySearches: 1, timezone: 'Asia/Ho_Chi_Minh' });
    const free = { kind: 'user', userId: user.id, isPro: false } as const;

    expect((await quota.consume(free, 2)).quota.remaining).toBe(1);
    const over = await quota.consume(free, 2);
    expect(over.ok).toBe(false);
    expect(over.quota.used).toBe(2); // không bị trừ khi từ chối
    await quota.refund(free, 2);
    expect((await quota.peek(free)).used).toBe(0);
    await quota.refund(free, 5);
    expect((await quota.peek(free)).used).toBe(0); // không âm

    const pro = { kind: 'user', userId: user.id, isPro: true } as const;
    expect((await quota.consume(pro, 100)).quota.limit).toBeNull();
  });

  it('khách hạn mức 0 phải đăng nhập', async () => {
    const quota = new QuotaService({ store: new MemoryAccountStore(), freeDailySearches: 3, guestDailySearches: 0, timezone: 'UTC' });
    expect((await quota.consume({ kind: 'guest', key: 'k' }, 1)).ok).toBe(false);
  });
});

describe('PayOS', () => {
  it('ký đúng chuỗi quy định (các khóa theo thứ tự chữ cái)', () => {
    const client = new PayOsClient({ clientId: 'c', apiKey: 'k', checksumKey: 'checksum' });
    const signature = client.signCreate({ orderCode: 123, amount: 3000, description: 'VQRIO123', returnUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
    // HMAC-SHA256("amount=3000&cancelUrl=https://x/no&description=VQRIO123&orderCode=123&returnUrl=https://x/ok", "checksum")
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signature).toBe(client.signCreate({ orderCode: 123, amount: 3000, description: 'VQRIO123', returnUrl: 'https://x/ok', cancelUrl: 'https://x/no' }));
    expect(signature).not.toBe(client.signCreate({ orderCode: 124, amount: 3000, description: 'VQRIO123', returnUrl: 'https://x/ok', cancelUrl: 'https://x/no' }));
  });

  it('báo lỗi rõ ràng khi PayOS từ chối hoặc không kết nối được', async () => {
    const reject = new PayOsClient({ clientId: 'c', apiKey: 'k', checksumKey: 's' }, async () => new Response(JSON.stringify({ code: '20', desc: 'Sai chữ ký' }), { status: 200 }));
    await expect(reject.createPaymentLink({ orderCode: 1, amount: 1000, description: 'd', returnUrl: 'https://a', cancelUrl: 'https://b' })).rejects.toThrow('Sai chữ ký');
    const down = new PayOsClient({ clientId: 'c', apiKey: 'k', checksumKey: 's' }, async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(down.getPaymentInfo(1)).rejects.toThrow(/Không kết nối/);
    const insecure = new PayOsClient({ clientId: 'c', apiKey: 'k', checksumKey: 's' }, async () => new Response(JSON.stringify({ code: '00', data: { checkoutUrl: 'http://evil' } })));
    await expect(insecure.createPaymentLink({ orderCode: 1, amount: 1000, description: 'd', returnUrl: 'https://a', cancelUrl: 'https://b' })).rejects.toThrow();
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
    expect(u).toMatchObject({ email: 'user@example.com', sessionVersion: 1, proUntil: null });
    expect(await store.createUser('USER@example.com', 'hash2')).toBeNull();
    expect((await store.getUserByEmail('user@EXAMPLE.com'))?.id).toBe(u!.id);
    expect((await store.getUserById(u!.id))?.email).toBe('user@example.com');
    expect(await store.getUserById('khong-co')).toBeNull();
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

  it('cấp Pro cộng dồn từ hạn hiện tại hoặc từ bây giờ nếu đã hết hạn', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    expect((await store.grantPro(u.id, 30, NOW))?.proUntil).toBe(day(30));
    expect((await store.grantPro(u.id, 30, NOW))?.proUntil).toBe(day(60));
    const later = new Date(day(100));
    expect((await store.grantPro(u.id, 10, later))?.proUntil).toBe(new Date(later.getTime() + 10 * 86_400_000).toISOString());
    expect(await store.grantPro('khong-co', 1, NOW)).toBeNull();
  });

  it('settleOrder chỉ kích hoạt một lần, kể cả khi gọi đồng thời', async () => {
    const store = await make();
    const u = (await store.createUser('a@b.co', 'h'))!;
    const order: OrderRow = { orderCode: 1_700_000_000_000_123, userId: u.id, plan: 'month', amount: 49_000, status: 'pending', createdAt: NOW.toISOString(), paidAt: null };
    await store.createOrder(order);
    expect((await store.getOrder(order.orderCode))?.status).toBe('pending');

    const results = await Promise.all([store.settleOrder(order.orderCode, 30, NOW), store.settleOrder(order.orderCode, 30, NOW), store.settleOrder(order.orderCode, 30, NOW)]);
    expect(results.filter((r) => r?.activated).length).toBe(1);
    expect(results.every((r) => r?.order.status === 'paid')).toBe(true);
    expect((await store.getUserById(u.id))?.proUntil).toBe(day(30));
    expect((await store.getOrder(order.orderCode))?.paidAt).toBe(NOW.toISOString());
    expect(await store.settleOrder(999, 30, NOW)).toBeNull();

    await store.setOrderStatus(order.orderCode, 'cancelled'); // đơn đã trả tiền không bị hủy
    expect((await store.getOrder(order.orderCode))?.status).toBe('paid');
  });

  it('thống kê tài khoản', async () => {
    const store = await make();
    const a = (await store.createUser('a@b.co', 'h'))!;
    await store.createUser('c@d.co', 'h');
    await store.grantPro(a.id, 30, NOW);
    await store.createOrder({ orderCode: 5, userId: a.id, plan: 'year', amount: 399_000, status: 'pending', createdAt: NOW.toISOString(), paidAt: null });
    await store.settleOrder(5, 365, NOW);
    expect(await store.counts(NOW)).toEqual({ users: 2, activePro: 1, paidOrders: 1, revenueVnd: 399_000 });
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
    await first.grantPro(u.id, 30, NOW);
    await first.close();

    const second = new MemoryAccountStore({ filePath: file, flushIntervalMs: 0 });
    expect((await second.getUserByEmail('a@b.co'))?.proUntil).toBe(day(30));
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

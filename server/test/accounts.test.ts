import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, PlansResponse } from '../../shared/types.js';
import { createAccountsContext, type AccountsContext } from '../src/accounts/context.js';
import { MemoryAccountStore } from '../src/accounts/memoryStore.js';
import { PayOsClient } from '../src/accounts/payos.js';
import { createApp } from '../src/app.js';
import { UpstreamError } from '../src/lib/errors.js';
import { silentLogger } from '../src/logger.js';
import type { AdapterMap } from '../src/services/search.js';
import type { SourceAdapter } from '../src/sources/types.js';
import { makeRecord } from './helpers.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
const ADMIN = 'admin-password-123';

let failAll = false;
const crossref: SourceAdapter = {
  id: 'crossref',
  label: 'Crossref',
  ping: async () => {},
  search: async (p) => {
    if (failAll) return { records: [], error: new UpstreamError('server_error', 'lỗi') };
    p.onProgress?.(1, 1);
    return { records: [makeRecord({ title: `Paper ${p.keyword}`, doi: `10.1/${p.keyword.replace(/\s+/g, '-')}`, sources: ['crossref'], queryKeywords: [p.keyword] })] };
  },
};
const adapters: AdapterMap = { crossref };

/** PayOS giả: lưu trạng thái từng đơn để kiểm tra luồng kích hoạt. */
class FakePayOs {
  orders = new Map<number, { status: string; amountPaid: number; amount: number }>();
  calls = 0;
  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    this.calls++;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/v2/payment-requests') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { orderCode: number; amount: number; signature: string; description: string };
      expect(body.description.length).toBeLessThanOrEqual(25);
      expect(body.signature).toMatch(/^[0-9a-f]{64}$/);
      this.orders.set(body.orderCode, { status: 'PENDING', amountPaid: 0, amount: body.amount });
      return json({ code: '00', desc: 'success', data: { checkoutUrl: `https://pay.payos.vn/web/${body.orderCode}` } });
    }
    const match = /\/v2\/payment-requests\/(\d+)$/.exec(url);
    const order = match ? this.orders.get(Number(match[1])) : undefined;
    if (!order) return json({ code: '101', desc: 'not found', data: null }, 404);
    return json({ code: '00', desc: 'success', data: { status: order.status, amount: order.amount, amountPaid: order.amountPaid } });
  };
  pay(orderCode: number, amountPaid?: number) {
    const o = this.orders.get(orderCode)!;
    o.status = 'PAID';
    o.amountPaid = amountPaid ?? o.amount;
  }
}

let server: Server;
let base: string;
let ctx: AccountsContext;
let payos: FakePayOs;
let store: MemoryAccountStore;

async function startServer(accounts: AccountsContext | undefined): Promise<{ server: Server; base: string }> {
  const app = createApp({ adapters, accounts, config: { corsOrigins: [], rateLimitPerMinute: 10_000, staticDir: undefined, adminPassword: ADMIN }, logger: silentLogger });
  const s = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

beforeAll(async () => {
  payos = new FakePayOs();
  store = new MemoryAccountStore();
  ctx = createAccountsContext({
    store,
    sessionSecret: SECRET,
    freeDailySearches: 3,
    guestDailySearches: 2,
    timezone: 'Asia/Ho_Chi_Minh',
    rateLimits: { registerPerHour: 10_000, loginFailuresPer15Min: 10_000 },
    billing: { payos: new PayOsClient({ clientId: 'id', apiKey: 'key', checksumKey: 'sum' }, payos.fetch), publicBaseUrl: 'https://paperfinder.example', priceMonth: 49_000, priceYear: 399_000 },
  });
  ({ server, base } = await startServer(ctx));
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  failAll = false;
});

interface Resp<T = unknown> {
  status: number;
  body: T;
  cookie?: string;
}

async function call<T = unknown>(method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}): Promise<Resp<T>> {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get('set-cookie');
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* NDJSON hoặc nội dung văn bản */
  }
  return { status: response.status, body: parsed as T, cookie: setCookie ? setCookie.split(';')[0] : undefined };
}

let counter = 0;
async function newUser(): Promise<{ email: string; cookie: string }> {
  const email = `user${++counter}@example.com`;
  const r = await call('POST', '/api/auth/register', { email, password: 'password123' });
  expect(r.status).toBe(201);
  return { email, cookie: r.cookie! };
}

const search = (cookie: string | undefined, keywords: string[] = ['alpha']) =>
  call('POST', '/api/search', { keywords, sources: ['crossref'], maxResults: 20, onlyWithDoi: true }, cookie);

const admin = { authorization: `Bearer ${ADMIN}` };

describe('đăng ký và đăng nhập', () => {
  it('đăng ký, đăng nhập, đọc /api/me, đăng xuất', async () => {
    const reg = await call<{ user: { email: string; isPro: boolean } }>('POST', '/api/auth/register', { email: '  Mixed@Example.COM ', password: 'password123' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'mixed@example.com', isPro: false });
    expect(reg.cookie).toMatch(/^pf_session=/);

    const me = await call<MeResponse>('GET', '/api/me', undefined, reg.cookie);
    expect(me.body.user?.email).toBe('mixed@example.com');
    expect(me.body.quota.limit).toBe(3);

    const login = await call('POST', '/api/auth/login', { email: 'MIXED@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.cookie).toMatch(/^pf_session=/);

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('cookie phiên là HttpOnly, SameSite=Lax', async () => {
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'flags@example.com', password: 'password123' }) });
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
  });

  it('từ chối email trùng, mật khẩu ngắn, email sai định dạng', async () => {
    const { email } = await newUser();
    expect((await call('POST', '/api/auth/register', { email, password: 'password123' })).status).toBe(409);
    expect((await call('POST', '/api/auth/register', { email: 'short@example.com', password: '1234567' })).status).toBe(400);
    expect((await call('POST', '/api/auth/register', { email: 'not-an-email', password: 'password123' })).status).toBe(400);
  });

  it('sai mật khẩu và email không tồn tại cho cùng một thông báo', async () => {
    const { email } = await newUser();
    const wrong = await call<{ message: string }>('POST', '/api/auth/login', { email, password: 'wrong-password' });
    const missing = await call<{ message: string }>('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.message).toBe(missing.body.message);
  });

  it('không lưu mật khẩu dạng rõ trong kho dữ liệu', async () => {
    const { email } = await newUser();
    const user = await store.getUserByEmail(email);
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.passwordHash).not.toContain('password123');
  });

  it('cookie giả hoặc bị sửa không đăng nhập được', async () => {
    const { cookie } = await newUser();
    const tampered = cookie.slice(0, -3) + 'abc';
    expect((await call<MeResponse>('GET', '/api/me', undefined, tampered)).body.user).toBeNull();
    expect((await call<MeResponse>('GET', '/api/me', undefined, 'pf_session=garbage')).body.user).toBeNull();
  });

  it('đổi mật khẩu vô hiệu phiên cũ, phiên mới vẫn dùng được', async () => {
    const { email, cookie } = await newUser();
    const wrong = await call('POST', '/api/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'new-password-1' }, cookie);
    expect(wrong.status).toBe(401);

    const changed = await call('POST', '/api/auth/change-password', { currentPassword: 'password123', newPassword: 'new-password-1' }, cookie);
    expect(changed.status).toBe(200);
    expect((await call<MeResponse>('GET', '/api/me', undefined, cookie)).body.user).toBeNull(); // phiên cũ
    expect((await call<MeResponse>('GET', '/api/me', undefined, changed.cookie)).body.user?.email).toBe(email); // phiên mới
    expect((await call('POST', '/api/auth/login', { email, password: 'password123' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { email, password: 'new-password-1' })).status).toBe(200);
  });
});

describe('hạn mức lượt tìm', () => {
  it('khách bị giới hạn theo IP, trả 429 kèm thông báo rõ ràng', async () => {
    // Mỗi trình duyệt khách dùng cùng IP 127.0.0.1 -> chia sẻ một bộ đếm; dùng khóa riêng bằng cách tạo máy chủ mới.
    const fresh = await startServer(ctx);
    const old = base;
    base = fresh.base;
    try {
      expect((await search(undefined)).status).toBe(200);
      expect((await search(undefined)).status).toBe(200);
      const blocked = await call<{ error: string; message: string; signedIn: boolean; quota: { limit: number; remaining: number } }>('POST', '/api/search', { keywords: ['alpha'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'quota_exceeded', signedIn: false, quota: { limit: 2, remaining: 0 } });
      expect(blocked.body.message).toMatch(/Đăng nhập/);
    } finally {
      base = old;
      fresh.server.closeAllConnections();
      fresh.server.close();
    }
  });

  it('thành viên miễn phí có hạn mức riêng và /api/me phản ánh số lượt đã dùng', async () => {
    const { cookie } = await newUser();
    expect((await search(cookie)).status).toBe(200);
    expect((await search(cookie)).status).toBe(200);
    const me = await call<MeResponse>('GET', '/api/me', undefined, cookie);
    expect(me.body.quota).toMatchObject({ limit: 3, used: 2, remaining: 1 });
    expect(me.body.quota.resetsAt).toMatch(/T/);
    expect((await search(cookie)).status).toBe(200);
    const blocked = await call<{ error: string; message: string; signedIn: boolean }>('POST', '/api/search', { keywords: ['alpha'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true }, cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body.signedIn).toBe(true);
    expect(blocked.body.message).toMatch(/Pro/);
  });

  it('mỗi từ khóa tính một lượt; không đủ lượt thì không trừ gì', async () => {
    const { cookie } = await newUser();
    const tooMany = await call<{ message: string; quota: { used: number } }>('POST', '/api/search', { keywords: ['a1', 'b2', 'c3', 'd4'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true }, cookie);
    expect(tooMany.status).toBe(429);
    expect(tooMany.body.message).toMatch(/4 từ khóa/);
    expect((await call<MeResponse>('GET', '/api/me', undefined, cookie)).body.quota.used).toBe(0);
    expect((await search(cookie, ['a1', 'b2', 'c3'])).status).toBe(200);
    expect((await call<MeResponse>('GET', '/api/me', undefined, cookie)).body.quota.remaining).toBe(0);
  });

  it('hoàn lại lượt khi không nguồn nào trả kết quả', async () => {
    const { cookie } = await newUser();
    failAll = true;
    expect((await search(cookie)).status).toBe(200);
    failAll = false;
    expect((await call<MeResponse>('GET', '/api/me', undefined, cookie)).body.quota.used).toBe(0);
  });

  it('gói Pro không giới hạn', async () => {
    const { email, cookie } = await newUser();
    const granted = await call('POST', '/api/admin/grant', { email, days: 30 }, undefined, admin);
    expect(granted.status).toBe(200);
    for (let i = 0; i < 6; i++) expect((await search(cookie)).status).toBe(200);
    const me = await call<MeResponse>('GET', '/api/me', undefined, cookie);
    expect(me.body.user?.isPro).toBe(true);
    expect(me.body.quota.limit).toBeNull();
  });

  it('Pro hết hạn quay lại hạn mức miễn phí', async () => {
    const { email, cookie } = await newUser();
    const user = (await store.getUserByEmail(email))!;
    await store.grantPro(user.id, -1, new Date()); // hạn Pro là một ngày trước
    expect(new Date((await store.getUserById(user.id))!.proUntil!).getTime()).toBeLessThan(Date.now());
    const me = await call<MeResponse>('GET', '/api/me', undefined, cookie);
    expect(me.body.user?.isPro).toBe(false);
    expect(me.body.quota.limit).toBe(3);
    expect((await call('GET', '/api/library', undefined, cookie)).status).toBe(402);
  });
});

describe('gói Pro: xuất BibTeX/RIS, thư viện, lịch sử', () => {
  const records = [
    {
      title: 'Deep learning for crop disease detection',
      doi: '10.1000/xyz',
      authors: [{ name: 'Jane Q. Smith', given: 'Jane Q.', family: 'Smith' }, { name: 'Nguyen Van An' }],
      publicationYear: 2021,
      journal: 'Journal of Plant AI',
      publisher: 'ACME',
      documentType: 'journal-article',
      abstract: 'We study & test 100% of things_here.',
      sources: ['crossref'],
      originalUrl: 'https://doi.org/10.1000/xyz',
      queryKeywords: ['crop'],
      volume: '12',
      issue: '3',
      pages: '313-325',
    },
  ];

  it('BibTeX/RIS yêu cầu đăng nhập và gói Pro; Excel/CSV vẫn miễn phí', async () => {
    const { cookie } = await newUser();
    expect((await call('POST', '/api/export', { format: 'bibtex', records })).status).toBe(401);
    expect((await call('POST', '/api/export', { format: 'bibtex', records }, cookie)).status).toBe(402);
    expect((await call('POST', '/api/export', { format: 'ris', records }, cookie)).status).toBe(402);
    expect((await call('POST', '/api/export', { format: 'csv', records })).status).toBe(200);
  });

  it('Pro xuất đúng BibTeX và RIS', async () => {
    const { email, cookie } = await newUser();
    await call('POST', '/api/admin/grant', { email, days: 30 }, undefined, admin);
    const bib = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ format: 'bibtex', records }) });
    expect(bib.status).toBe(200);
    expect(bib.headers.get('content-disposition')).toMatch(/\.bib"/);
    const bibText = await bib.text();
    expect(bibText).toContain('@article{Smith2021Deep,');
    expect(bibText).toContain('author = {Smith, Jane Q. and Van An, Nguyen}'.replace('Van An, Nguyen', 'An, Nguyen Van'));
    expect(bibText).toContain('pages = {313--325}');
    expect(bibText).toContain('We study \\& test 100\\% of things\\_here.');
    expect(bibText).toContain('doi = {10.1000/xyz}');

    const ris = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ format: 'ris', records }) });
    const risText = await ris.text();
    expect(risText).toContain('TY  - JOUR');
    expect(risText).toContain('AU  - Smith, Jane Q.');
    expect(risText).toContain('SP  - 313');
    expect(risText).toContain('EP  - 325');
    expect(risText).toContain('DO  - 10.1000/xyz');
    expect(risText.trim().endsWith('ER  -')).toBe(true);
  });

  it('thư viện cá nhân: Pro mới dùng được; lưu, trùng, xóa', async () => {
    const { email, cookie } = await newUser();
    const record = makeRecord({ title: 'Saved paper', doi: '10.5/Saved', sources: ['crossref'] });
    expect((await call('GET', '/api/library')).status).toBe(401);
    expect((await call('GET', '/api/library', undefined, cookie)).status).toBe(402);
    expect((await call('POST', '/api/library', { record, folder: '' }, cookie)).status).toBe(402);

    await call('POST', '/api/admin/grant', { email, days: 30 }, undefined, admin);
    const saved = await call<{ status: string; key: string }>('POST', '/api/library', { record: { ...record, oaPdfSig: 'secret' }, folder: 'Luận văn' }, cookie);
    expect(saved.status).toBe(201);
    expect(saved.body.key).toBe('10.5/saved');
    expect((await call<{ status: string }>('POST', '/api/library', { record, folder: 'Khác' }, cookie)).body.status).toBe('exists');

    const list = await call<{ key: string; folder: string; record: { title: string; oaPdfSig?: string } }[]>('GET', '/api/library', undefined, cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ key: '10.5/saved', folder: 'Khác' });
    expect(list.body[0]!.record.title).toBe('Saved paper');
    expect(list.body[0]!.record.oaPdfSig).toBeUndefined();

    expect((await call('DELETE', `/api/library/${encodeURIComponent('10.5/saved')}`, undefined, cookie)).status).toBe(200);
    expect((await call('DELETE', `/api/library/${encodeURIComponent('10.5/saved')}`, undefined, cookie)).status).toBe(404);
  });

  it('thư viện của người này không lộ cho người khác', async () => {
    const a = await newUser();
    const b = await newUser();
    await call('POST', '/api/admin/grant', { email: a.email, days: 30 }, undefined, admin);
    await call('POST', '/api/admin/grant', { email: b.email, days: 30 }, undefined, admin);
    await call('POST', '/api/library', { record: makeRecord({ title: 'Private', doi: '10.9/private' }), folder: '' }, a.cookie);
    expect((await call<unknown[]>('GET', '/api/library', undefined, b.cookie)).body).toHaveLength(0);
  });

  it('lịch sử tìm kiếm chỉ ghi cho Pro và xóa được', async () => {
    const free = await newUser();
    await search(free.cookie);
    expect((await call('GET', '/api/history', undefined, free.cookie)).status).toBe(402);

    const pro = await newUser();
    await call('POST', '/api/admin/grant', { email: pro.email, days: 30 }, undefined, admin);
    await search(pro.cookie, ['history topic']);
    await new Promise((r) => setTimeout(r, 30));
    const history = await call<{ request: { keywords: string[] }; total: number }[]>('GET', '/api/history', undefined, pro.cookie);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]!.request.keywords).toEqual(['history topic']);
    expect(history.body[0]!.total).toBe(1);
    expect((await call('DELETE', '/api/history', undefined, pro.cookie)).status).toBe(200);
    expect((await call<unknown[]>('GET', '/api/history', undefined, pro.cookie)).body).toHaveLength(0);
  });
});

describe('thanh toán PayOS', () => {
  it('/api/plans trả giá và hạn mức', async () => {
    const plans = await call<PlansResponse>('GET', '/api/plans');
    expect(plans.body).toMatchObject({ accountsEnabled: true, billingEnabled: true, freeDailySearches: 3, guestDailySearches: 2 });
    expect(plans.body.plans).toEqual([
      { id: 'month', label: '1 tháng', days: 30, priceVnd: 49_000 },
      { id: 'year', label: '1 năm', days: 365, priceVnd: 399_000 },
    ]);
  });

  it('phải đăng nhập mới tạo được link thanh toán', async () => {
    expect((await call('POST', '/api/billing/checkout', { plan: 'month' })).status).toBe(401);
    const { cookie } = await newUser();
    expect((await call('POST', '/api/billing/checkout', { plan: 'forever' }, cookie)).status).toBe(400);
  });

  it('thanh toán đủ tiền: kích hoạt Pro đúng một lần dù webhook và trang quay lại cùng gọi', async () => {
    const { email, cookie } = await newUser();
    const checkout = await call<{ checkoutUrl: string; orderCode: number }>('POST', '/api/billing/checkout', { plan: 'month' }, cookie);
    expect(checkout.status).toBe(200);
    expect(checkout.body.checkoutUrl).toMatch(/^https:\/\/pay\.payos\.vn\//);
    const { orderCode } = checkout.body;

    // Chưa thanh toán
    const pending = await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode }, cookie);
    expect(pending.body.status).toBe('pending');
    expect((await call<MeResponse>('GET', '/api/me', undefined, cookie)).body.user?.isPro).toBe(false);

    payos.pay(orderCode);
    // Webhook và trang quay lại gọi gần như cùng lúc
    const [hook, confirm] = await Promise.all([
      call('POST', '/api/billing/payos-webhook', { code: '00', success: true, data: { orderCode, amount: 1 } }),
      call<{ status: string; user: { isPro: boolean; proUntil: string } }>('POST', '/api/billing/confirm', { orderCode }, cookie),
    ]);
    expect(hook.status).toBe(200);
    expect(confirm.body.status).toBe('paid');

    const user1 = (await store.getUserByEmail(email))!;
    await call('POST', '/api/billing/confirm', { orderCode }, cookie);
    await call('POST', '/api/billing/payos-webhook', { data: { orderCode } });
    const user2 = (await store.getUserByEmail(email))!;
    expect(user2.proUntil).toBe(user1.proUntil); // không cộng thêm lần nữa

    const days = (new Date(user2.proUntil!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect((await call<MeResponse>('GET', '/api/me', undefined, cookie)).body.user?.isPro).toBe(true);
  });

  it('mua tiếp khi còn hạn thì cộng dồn', async () => {
    const { email, cookie } = await newUser();
    for (const plan of ['month', 'month'] as const) {
      const checkout = await call<{ orderCode: number }>('POST', '/api/billing/checkout', { plan }, cookie);
      payos.pay(checkout.body.orderCode);
      await call('POST', '/api/billing/confirm', { orderCode: checkout.body.orderCode }, cookie);
    }
    const days = (new Date((await store.getUserByEmail(email))!.proUntil!).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(59.9);
  });

  it('webhook giả mạo (mã đơn không có thật hoặc chưa trả tiền) không kích hoạt Pro', async () => {
    const { email, cookie } = await newUser();
    const checkout = await call<{ orderCode: number }>('POST', '/api/billing/checkout', { plan: 'year' }, cookie);
    const forged = await call('POST', '/api/billing/payos-webhook', { code: '00', success: true, data: { orderCode: checkout.body.orderCode, amount: 399000, description: 'PAID' } });
    expect(forged.status).toBe(200);
    expect((await store.getUserByEmail(email))!.proUntil).toBeNull();
    expect((await call('POST', '/api/billing/payos-webhook', { data: { orderCode: 12345 } })).status).toBe(200);
    expect((await call('POST', '/api/billing/payos-webhook', 'garbage')).status).toBeLessThan(500);
  });

  it('trả thiếu tiền thì chưa kích hoạt', async () => {
    const { email, cookie } = await newUser();
    const checkout = await call<{ orderCode: number }>('POST', '/api/billing/checkout', { plan: 'month' }, cookie);
    payos.pay(checkout.body.orderCode, 1000);
    const result = await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.body.orderCode }, cookie);
    expect(result.body.status).toBe('pending');
    expect((await store.getUserByEmail(email))!.proUntil).toBeNull();
  });

  it('không xác nhận hộ đơn của người khác', async () => {
    const owner = await newUser();
    const other = await newUser();
    const checkout = await call<{ orderCode: number }>('POST', '/api/billing/checkout', { plan: 'month' }, owner.cookie);
    payos.pay(checkout.body.orderCode);
    const result = await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.body.orderCode }, other.cookie);
    expect(result.body.status).toBe('unknown');
    expect((await store.getUserByEmail(other.email))!.proUntil).toBeNull();
  });

  it('đơn bị hủy được ghi nhận', async () => {
    const { cookie } = await newUser();
    const checkout = await call<{ orderCode: number }>('POST', '/api/billing/checkout', { plan: 'month' }, cookie);
    payos.orders.get(checkout.body.orderCode)!.status = 'CANCELLED';
    const result = await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.body.orderCode }, cookie);
    expect(result.body.status).toBe('cancelled');
  });
});

describe('quản trị', () => {
  it('cần mật khẩu admin để cấp Pro hoặc xem thống kê tài khoản', async () => {
    expect((await call('POST', '/api/admin/grant', { email: 'a@b.co', days: 5 })).status).toBe(401);
    expect((await call('GET', '/api/admin/accounts')).status).toBe(401);
    const { email } = await newUser();
    expect((await call('POST', '/api/admin/grant', { email: 'ghost@example.com', days: 5 }, undefined, admin)).status).toBe(404);
    expect((await call('POST', '/api/admin/grant', { email, days: 0 }, undefined, admin)).status).toBe(400);
    const counts = await call<{ users: number; activePro: number }>('GET', '/api/admin/accounts', undefined, undefined, admin);
    expect(counts.status).toBe(200);
    expect(counts.body.users).toBeGreaterThan(0);
  });
});

describe('khi tính năng tài khoản tắt', () => {
  it('giữ nguyên hành vi cũ: tìm không giới hạn, xuất BibTeX tự do, /api/me báo tắt', async () => {
    const off = await startServer(undefined);
    const old = base;
    base = off.base;
    try {
      const me = await call<MeResponse>('GET', '/api/me');
      expect(me.body).toMatchObject({ accountsEnabled: false, user: null, quota: { limit: null } });
      expect((await call<PlansResponse>('GET', '/api/plans')).body.accountsEnabled).toBe(false);
      for (let i = 0; i < 8; i++) expect((await search(undefined)).status).toBe(200);
      const bib = await call('POST', '/api/export', {
        format: 'bibtex',
        records: [{ title: 'T', doi: '', authors: [], publicationYear: null, journal: '', publisher: '', documentType: '', abstract: '', sources: [], originalUrl: '', queryKeywords: [] }],
      });
      expect(bib.status).toBe(200);
      expect((await call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' })).status).toBe(404);
    } finally {
      base = old;
      off.server.closeAllConnections();
      off.server.close();
    }
  });
});

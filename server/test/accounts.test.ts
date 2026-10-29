import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MeResponse, PaidTier, PlanPeriod, PlansResponse } from '../../shared/types.js';
import { createAccountsContext, type AccountsContext } from '../src/accounts/context.js';
import { MemoryAccountStore } from '../src/accounts/memoryStore.js';
import { createApp } from '../src/app.js';
import { UpstreamError } from '../src/lib/errors.js';
import { silentLogger } from '../src/logger.js';
import type { AdapterMap } from '../src/services/search.js';
import type { SourceAdapter } from '../src/sources/types.js';
import { makeRecord } from './helpers.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
const ADMIN = 'admin-password-123';
const PRICES = { 'standard:week': 15_000, 'standard:month': 39_000, 'standard:year': 299_000, 'pro:week': 29_000, 'pro:month': 79_000, 'pro:year': 599_000 } as const;

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

const SEPAY = { apiKey: 'test-sepay-key-12345', accountNumber: '0123456789', bankName: 'MBBank', accountName: 'NGUYEN VAN TEST', codePrefix: 'PF' };

let server: Server;
let base: string;
let ctx: AccountsContext;
let store: MemoryAccountStore;

function makeContext(now?: () => Date): AccountsContext {
  return createAccountsContext({
    store,
    sessionSecret: SECRET,
    freeDailySearches: 3,
    guestDailySearches: 2,
    timezone: 'Asia/Ho_Chi_Minh',
    rateLimits: { registerPerHour: 10_000, loginFailuresPer15Min: 10_000 },
    now,
    billing: { sepay: SEPAY, prices: PRICES },
  });
}

async function startServer(accounts: AccountsContext | undefined, sepay?: typeof SEPAY): Promise<{ server: Server; base: string }> {
  const app = createApp({ adapters, accounts, config: { corsOrigins: [], rateLimitPerMinute: 10_000, staticDir: undefined, adminPassword: ADMIN, sepay }, logger: silentLogger });
  const s = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

beforeAll(async () => {
  store = new MemoryAccountStore();
  ctx = makeContext();
  ({ server, base } = await startServer(ctx, SEPAY));
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
  headers: Headers;
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
  return { status: response.status, body: parsed as T, cookie: setCookie ? setCookie.split(';')[0] : undefined, headers: response.headers };
}

let counter = 0;
async function newUser(): Promise<{ email: string; cookie: string }> {
  const email = `user${++counter}@example.com`;
  const r = await call('POST', '/api/auth/register', { email, password: 'password123' });
  expect(r.status).toBe(201);
  return { email, cookie: r.cookie! };
}

const admin = { authorization: `Bearer ${ADMIN}` };
const grant = (email: string, tier: PaidTier, days = 30) => call('POST', '/api/admin/grant', { email, tier, days }, undefined, admin);
async function userWithTier(tier: 'free' | PaidTier) {
  const u = await newUser();
  if (tier !== 'free') expect((await grant(u.email, tier)).status).toBe(200);
  return u;
}

const search = (cookie: string | undefined, keywords: string[] = ['alpha'], maxResults = 20) =>
  call('POST', '/api/search', { keywords, sources: ['crossref'], maxResults, onlyWithDoi: true }, cookie);
const me = (cookie?: string) => call<MeResponse>('GET', '/api/me', undefined, cookie);

const exportRecord = (i: number) => ({ title: `Paper ${i}`, doi: `10.1/${i}`, authors: [{ name: 'A B' }], publicationYear: 2020, journal: 'J', publisher: '', documentType: 'journal-article', abstract: '', sources: ['crossref'], originalUrl: '', queryKeywords: [] });
const exportRecords = (n: number) => Array.from({ length: n }, (_, i) => exportRecord(i));
const exportCall = (format: string, n: number, cookie?: string) => call('POST', '/api/export', { format, records: exportRecords(n) }, cookie);

async function buyAndPay(cookie: string, tier: PaidTier, period: PlanPeriod): Promise<number> {
  const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier, period }, cookie)).body;
  await webhook(incoming(checkout));
  const confirm = await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.orderCode }, cookie);
  expect(confirm.body.status).toBe('paid');
  return checkout.orderCode;
}

function makeContextWithoutSepay(): AccountsContext {
  return createAccountsContext({ store, sessionSecret: SECRET, freeDailySearches: 3, guestDailySearches: 2, timezone: 'Asia/Ho_Chi_Minh', rateLimits: { registerPerHour: 10_000, loginFailuresPer15Min: 10_000 }, billing: { prices: PRICES } });
}

describe('đăng ký và đăng nhập', () => {
  it('đăng ký tự đăng nhập ngay: cookie phiên có sẵn và /api/me nhận ra người dùng', async () => {
    const reg = await call<{ user: { email: string; tier: string } }>('POST', '/api/auth/register', { email: '  Mixed@Example.COM ', password: 'password123' });
    expect(reg.status).toBe(201);
    expect(reg.body.user).toMatchObject({ email: 'mixed@example.com', tier: 'free' });
    expect(reg.cookie).toMatch(/^pf_session=/);

    const info = await me(reg.cookie);
    expect(info.body.user?.email).toBe('mixed@example.com');
    expect(info.body.tier).toBe('free');
    expect(info.body.quota.limit).toBe(3);

    const login = await call('POST', '/api/auth/login', { email: 'MIXED@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.cookie).toMatch(/^pf_session=/);

    const out = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('cookie phiên nhớ lâu (~6 tháng), HttpOnly, SameSite=Lax', async () => {
    const response = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'flags@example.com', password: 'password123' }) });
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(Number(/Max-Age=(\d+)/.exec(header)![1])).toBeGreaterThanOrEqual(170 * 86_400);
  });

  it('tự gia hạn phiên khi còn dùng: chỉ cấp cookie mới khi đã qua nửa thời hạn', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const clockCtx = makeContext(() => now);
    const s = await startServer(clockCtx);
    const old = base;
    base = s.base;
    try {
      const reg = await call('POST', '/api/auth/register', { email: 'renew@example.com', password: 'password123' });
      now = new Date('2026-01-11T00:00:00Z'); // mới 10 ngày
      expect((await me(reg.cookie)).cookie).toBeUndefined();
      now = new Date('2026-05-01T00:00:00Z'); // đã 120 ngày (> nửa của 180)
      const renewed = await me(reg.cookie);
      expect(renewed.body.user?.email).toBe('renew@example.com');
      expect(renewed.cookie).toMatch(/^pf_session=/);
      now = new Date('2026-09-01T00:00:00Z'); // quá 180 ngày kể từ cookie đầu: cookie cũ hết hạn nhưng cookie đã gia hạn còn dùng được
      expect((await me(reg.cookie)).body.user).toBeNull();
      expect((await me(renewed.cookie)).body.user?.email).toBe('renew@example.com');
    } finally {
      base = old;
      s.server.closeAllConnections();
      s.server.close();
    }
  });

  it('từ chối email trùng, mật khẩu ngắn, email sai định dạng', async () => {
    const { email } = await newUser();
    expect((await call('POST', '/api/auth/register', { email, password: 'password123' })).status).toBe(409);
    expect((await call('POST', '/api/auth/register', { email: 'short@example.com', password: '1234567' })).status).toBe(400);
    expect((await call('POST', '/api/auth/register', { email: 'not-an-email', password: 'password123' })).status).toBe(400);
  });

  it('chỉ cần email + mật khẩu để đăng ký (giao diện không bắt nhập lại)', async () => {
    expect((await call('POST', '/api/auth/register', { email: 'two-fields@example.com', password: 'password123' })).status).toBe(201);
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
    expect((await me(tampered)).body.user).toBeNull();
    expect((await me('pf_session=garbage')).body.user).toBeNull();
  });

  it('đổi mật khẩu vô hiệu phiên cũ, phiên mới vẫn dùng được', async () => {
    const { email, cookie } = await newUser();
    const wrong = await call('POST', '/api/auth/change-password', { currentPassword: 'nope-nope', newPassword: 'new-password-1' }, cookie);
    expect(wrong.status).toBe(401);

    const changed = await call('POST', '/api/auth/change-password', { currentPassword: 'password123', newPassword: 'new-password-1' }, cookie);
    expect(changed.status).toBe(200);
    expect((await me(cookie)).body.user).toBeNull(); // phiên cũ
    expect((await me(changed.cookie)).body.user?.email).toBe(email); // phiên mới
    expect((await call('POST', '/api/auth/login', { email, password: 'password123' })).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { email, password: 'new-password-1' })).status).toBe(200);
  });
});

describe('hạn mức lượt tìm theo hạng', () => {
  it('khách bị giới hạn theo IP, trả 429 kèm thông báo mời đăng nhập', async () => {
    // Máy chủ riêng với bộ đếm khách mới (mọi cuộc gọi từ 127.0.0.1 dùng chung một bộ đếm).
    const own = await startServer(makeContext());
    const old = base;
    base = own.base;
    try {
      expect((await search(undefined)).status).toBe(200);
      expect((await search(undefined)).status).toBe(200);
      const blocked = await call<{ error: string; message: string; signedIn: boolean; quota: { limit: number; remaining: number } }>('POST', '/api/search', { keywords: ['alpha'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true });
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ error: 'quota_exceeded', signedIn: false, quota: { limit: 2, remaining: 0 } });
      expect(blocked.body.message).toMatch(/Đăng nhập/);
    } finally {
      base = old;
      own.server.closeAllConnections();
      own.server.close();
    }
  });

  it('thành viên miễn phí có hạn mức riêng; /api/me phản ánh số lượt đã dùng', async () => {
    const { cookie } = await newUser();
    expect((await search(cookie)).status).toBe(200);
    expect((await search(cookie)).status).toBe(200);
    expect((await me(cookie)).body.quota).toMatchObject({ limit: 3, used: 2, remaining: 1 });
    expect((await search(cookie)).status).toBe(200);
    const blocked = await call<{ error: string; message: string; signedIn: boolean }>('POST', '/api/search', { keywords: ['alpha'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true }, cookie);
    expect(blocked.status).toBe(429);
    expect(blocked.body.signedIn).toBe(true);
    expect(blocked.body.message).toMatch(/gói/);
  });

  it('mỗi từ khóa tính một lượt; không đủ lượt thì không trừ gì', async () => {
    const { cookie } = await newUser();
    const tooMany = await call<{ message: string }>('POST', '/api/search', { keywords: ['a1', 'b2', 'c3', 'd4'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true }, cookie);
    expect(tooMany.status).toBe(429);
    expect(tooMany.body.message).toMatch(/4 từ khóa/);
    expect((await me(cookie)).body.quota.used).toBe(0);
    expect((await search(cookie, ['a1', 'b2', 'c3'])).status).toBe(200);
    expect((await me(cookie)).body.quota.remaining).toBe(0);
  });

  it('hoàn lại lượt khi không nguồn nào trả kết quả', async () => {
    const { cookie } = await newUser();
    failAll = true;
    expect((await search(cookie)).status).toBe(200);
    failAll = false;
    expect((await me(cookie)).body.quota.used).toBe(0);
  });

  it.each(['standard', 'pro'] as const)('hạng %s không giới hạn lượt tìm', async (tier) => {
    const { cookie } = await userWithTier(tier);
    for (let i = 0; i < 6; i++) expect((await search(cookie)).status).toBe(200);
    const info = await me(cookie);
    expect(info.body.tier).toBe(tier);
    expect(info.body.user?.tier).toBe(tier);
    expect(info.body.quota.limit).toBeNull();
  });

  it('hết hạn gói thì quay lại hạn mức miễn phí và mất quyền thư viện', async () => {
    const { email, cookie } = await userWithTier('standard');
    const user = (await store.getUserByEmail(email))!;
    await store.grantPlan(user.id, 'standard', -31, new Date()); // lùi hạn về quá khứ
    const info = await me(cookie);
    expect(info.body.tier).toBe('free');
    expect(info.body.quota.limit).toBe(3);
    expect((await call('GET', '/api/library', undefined, cookie)).status).toBe(402);
  });
});

describe('giới hạn số kết quả mỗi nguồn', () => {
  const cases: [string, 'guest' | 'free' | PaidTier, number, number][] = [
    ['khách', 'guest', 20, 50],
    ['miễn phí', 'free', 50, 100],
    ['Tiêu chuẩn', 'standard', 200, 500],
    ['Pro', 'pro', 500, 500],
  ];

  it.each(cases)('%s: được %i, bị từ chối khi chọn nhiều hơn', async (_label, tier, allowed, tooMany) => {
    const own = tier === 'guest' ? await startServer(makeContext()) : undefined;
    const old = base;
    if (own) base = own.base;
    try {
      const cookie = tier === 'guest' ? undefined : (await userWithTier(tier)).cookie;
      expect((await search(cookie, ['alpha'], allowed)).status).toBe(200);
      if (tooMany > allowed) {
        const denied = await call<{ error: string; limit: number }>('POST', '/api/search', { keywords: ['alpha'], sources: ['crossref'], maxResults: tooMany, onlyWithDoi: true }, cookie);
        expect(denied.status).toBe(403);
        expect(denied.body).toMatchObject({ error: 'results_limit', limit: allowed });
      }
    } finally {
      if (own) {
        base = old;
        own.server.closeAllConnections();
        own.server.close();
      }
    }
  });

  it('bị từ chối vì quá số kết quả thì không bị trừ lượt', async () => {
    const { cookie } = await newUser();
    expect((await call('POST', '/api/search', { keywords: ['alpha'], sources: ['crossref'], maxResults: 500, onlyWithDoi: true }, cookie)).status).toBe(403);
    expect((await me(cookie)).body.quota.used).toBe(0);
  });
});

describe('xuất file theo hạng', () => {
  it('khách không xuất được file nào', async () => {
    expect((await exportCall('csv', 3)).status).toBe(401);
    expect((await exportCall('xlsx', 3)).status).toBe(401);
    expect((await exportCall('bibtex', 3)).status).toBe(401);
  });

  it('miễn phí: xuất được nhưng chỉ 50 dòng đầu, có báo cho giao diện; BibTeX/RIS bị khóa', async () => {
    const { cookie } = await newUser();
    const full = await exportCall('csv', 40, cookie);
    expect(full.status).toBe(200);
    expect(full.headers.get('x-export-truncated')).toBeNull();

    const cut = await exportCall('csv', 60, cookie);
    expect(cut.status).toBe(200);
    expect(cut.headers.get('x-export-truncated')).toBe('50/60');
    const lines = String(cut.body).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(51); // tiêu đề + 50 dòng

    expect((await exportCall('bibtex', 3, cookie)).status).toBe(402);
    expect((await exportCall('ris', 3, cookie)).status).toBe(402);
  });

  it('Tiêu chuẩn: xuất Excel/CSV không giới hạn dòng, nhưng chưa có BibTeX/RIS', async () => {
    const { cookie } = await userWithTier('standard');
    const big = await exportCall('csv', 60, cookie);
    expect(big.status).toBe(200);
    expect(big.headers.get('x-export-truncated')).toBeNull();
    expect(String(big.body).split('\r\n').filter(Boolean)).toHaveLength(61);
    expect((await exportCall('bibtex', 3, cookie)).status).toBe(402);
  });

  it('Pro: có thêm BibTeX và RIS đúng định dạng', async () => {
    const { cookie } = await userWithTier('pro');
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
    const bib = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ format: 'bibtex', records }) });
    expect(bib.status).toBe(200);
    expect(bib.headers.get('content-disposition')).toMatch(/\.bib"/);
    const bibText = await bib.text();
    expect(bibText).toContain('@article{Smith2021Deep,');
    expect(bibText).toContain('author = {Smith, Jane Q. and An, Nguyen Van}');
    expect(bibText).toContain('pages = {313--325}');
    expect(bibText).toContain('We study \\& test 100\\% of things\\_here.');

    const ris = await fetch(`${base}/api/export`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ format: 'ris', records }) });
    const risText = await ris.text();
    expect(risText).toContain('TY  - JOUR');
    expect(risText).toContain('AU  - Smith, Jane Q.');
    expect(risText).toContain('SP  - 313');
    expect(risText).toContain('EP  - 325');
    expect(risText.trim().endsWith('ER  -')).toBe(true);
  });
});

describe('thư viện và lịch sử theo hạng', () => {
  it('thư viện: khách 401, miễn phí 402, Tiêu chuẩn trở lên dùng được (lưu, trùng, xóa, không lộ cho người khác)', async () => {
    const free = await newUser();
    const record = makeRecord({ title: 'Saved paper', doi: '10.5/Saved', sources: ['crossref'] });
    expect((await call('GET', '/api/library')).status).toBe(401);
    expect((await call('GET', '/api/library', undefined, free.cookie)).status).toBe(402);
    expect((await call('POST', '/api/library', { record, folder: '' }, free.cookie)).status).toBe(402);

    const std = await userWithTier('standard');
    const saved = await call<{ status: string; key: string }>('POST', '/api/library', { record: { ...record, oaPdfSig: 'secret' }, folder: 'Luận văn' }, std.cookie);
    expect(saved.status).toBe(201);
    expect(saved.body.key).toBe('10.5/saved');
    expect((await call<{ status: string }>('POST', '/api/library', { record, folder: 'Khác' }, std.cookie)).body.status).toBe('exists');
    const list = await call<{ key: string; folder: string; record: { title: string; oaPdfSig?: string } }[]>('GET', '/api/library', undefined, std.cookie);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ key: '10.5/saved', folder: 'Khác' });
    expect(list.body[0]!.record.oaPdfSig).toBeUndefined();

    const other = await userWithTier('pro');
    expect((await call<unknown[]>('GET', '/api/library', undefined, other.cookie)).body).toHaveLength(0);

    expect((await call('DELETE', `/api/library/${encodeURIComponent('10.5/saved')}`, undefined, std.cookie)).status).toBe(200);
    expect((await call('DELETE', `/api/library/${encodeURIComponent('10.5/saved')}`, undefined, std.cookie)).status).toBe(404);
  });

  it('lịch sử: miễn phí không có; Tiêu chuẩn giữ 20, Pro giữ 50', async () => {
    const free = await newUser();
    await search(free.cookie);
    expect((await call('GET', '/api/history', undefined, free.cookie)).status).toBe(402);

    const std = await userWithTier('standard');
    await search(std.cookie, ['history topic']);
    await new Promise((r) => setTimeout(r, 30));
    const history = await call<{ request: { keywords: string[] }; total: number }[]>('GET', '/api/history', undefined, std.cookie);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]!.request.keywords).toEqual(['history topic']);
    expect(history.body[0]!.total).toBe(1);

    for (let i = 0; i < 24; i++) await search(std.cookie, [`topic ${i}`]);
    await new Promise((r) => setTimeout(r, 60));
    expect((await call<unknown[]>('GET', '/api/history', undefined, std.cookie)).body).toHaveLength(20);

    const pro = await userWithTier('pro');
    for (let i = 0; i < 3; i++) await search(pro.cookie, [`pro topic ${i}`]);
    await new Promise((r) => setTimeout(r, 40));
    expect((await call<unknown[]>('GET', '/api/history', undefined, pro.cookie)).body).toHaveLength(3);
    expect((await call('DELETE', '/api/history', undefined, pro.cookie)).status).toBe(200);
    expect((await call<unknown[]>('GET', '/api/history', undefined, pro.cookie)).body).toHaveLength(0);
  });
});

interface Checkout {
  orderCode: number;
  amount: number;
  memo: string;
  bankName: string;
  accountNumber: string;
  accountName?: string;
  qrUrl: string;
  expiresAt: string;
}

let txCounter = 1000;
/** Giả lập SePay gọi webhook khi có tiền vào tài khoản. */
const webhook = (body: Record<string, unknown>, key: string | null = SEPAY.apiKey) =>
  call<{ success?: boolean }>('POST', '/api/billing/sepay-webhook', body, undefined, key === null ? {} : { authorization: `Apikey ${key}` });
const incoming = (checkout: Checkout, over: Record<string, unknown> = {}) => ({
  id: ++txCounter,
  gateway: 'MBBank',
  transactionDate: '2026-10-29 10:00:00',
  accountNumber: SEPAY.accountNumber,
  code: null,
  content: `${checkout.memo} chuyen tien mua goi`,
  transferType: 'in',
  transferAmount: checkout.amount,
  accumulated: 1_000_000,
  subAccount: null,
  referenceCode: `FT${txCounter}`,
  description: `BankAPINotify ${checkout.memo}`,
  ...over,
});
const daysLeft = (iso: string | null) => (new Date(iso!).getTime() - Date.now()) / 86_400_000;
const periodDays: Record<PlanPeriod, number> = { week: 7, month: 30, year: 365 };

describe('thanh toán chuyển khoản qua SePay', () => {
  it('/api/plans trả bốn hạng và sáu gói (hạng trả phí × 7 ngày/1 tháng/1 năm)', async () => {
    const plans = await call<PlansResponse>('GET', '/api/plans');
    expect(plans.body).toMatchObject({ accountsEnabled: true, billingEnabled: true });
    expect(plans.body.tiers.map((t) => t.tier)).toEqual(['guest', 'free', 'standard', 'pro']);
    expect(plans.body.plans).toHaveLength(6);
    expect(plans.body.plans.filter((p) => p.tier === 'pro').map((p) => [p.period, p.days, p.priceVnd])).toEqual([
      ['week', 7, 29_000],
      ['month', 30, 79_000],
      ['year', 365, 599_000],
    ]);
  });

  it('phải đăng nhập và chọn gói hợp lệ mới tạo được đơn', async () => {
    expect((await call('POST', '/api/billing/checkout', { tier: 'pro', period: 'month' })).status).toBe(401);
    const { cookie } = await newUser();
    expect((await call('POST', '/api/billing/checkout', { tier: 'free', period: 'month' }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/billing/checkout', { tier: 'pro', period: 'forever' }, cookie)).status).toBe(400);
    expect((await call('POST', '/api/billing/checkout', { tier: 'pro' }, cookie)).status).toBe(400);
  });

  it('đơn trả về hướng dẫn chuyển khoản: số tiền, nội dung, tài khoản và mã QR', async () => {
    const { cookie } = await newUser();
    const r = await call<Checkout>('POST', '/api/billing/checkout', { tier: 'pro', period: 'month' }, cookie);
    expect(r.status).toBe(200);
    expect(r.body.orderCode).toBeGreaterThanOrEqual(100_000_000);
    expect(r.body.orderCode).toBeLessThan(1_000_000_000);
    expect(r.body).toMatchObject({ amount: PRICES['pro:month'], memo: `PF${r.body.orderCode}`, bankName: 'MBBank', accountNumber: '0123456789', accountName: 'NGUYEN VAN TEST' });
    const qr = new URL(r.body.qrUrl);
    expect(qr.origin + qr.pathname).toBe('https://qr.sepay.vn/img');
    expect(qr.searchParams.get('acc')).toBe('0123456789');
    expect(qr.searchParams.get('bank')).toBe('MBBank');
    expect(qr.searchParams.get('amount')).toBe(String(PRICES['pro:month']));
    expect(qr.searchParams.get('des')).toBe(r.body.memo);
    expect(new Date(r.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('mỗi đơn có mã khác nhau', async () => {
    const { cookie } = await newUser();
    const codes = new Set<number>();
    for (let i = 0; i < 12; i++) codes.add((await call<Checkout>('POST', '/api/billing/checkout', { tier: 'standard', period: 'week' }, cookie)).body.orderCode);
    expect(codes.size).toBe(12);
  });

  it.each([
    ['standard', 'week'],
    ['standard', 'month'],
    ['standard', 'year'],
    ['pro', 'week'],
    ['pro', 'month'],
    ['pro', 'year'],
  ] as const)('mua %s %s: tiền về đủ thì kích hoạt đúng hạng và số ngày', async (tier, period) => {
    const { email, cookie } = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier, period }, cookie)).body;
    expect(checkout.amount).toBe(PRICES[`${tier}:${period}` as keyof typeof PRICES]);

    expect((await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.orderCode }, cookie)).body.status).toBe('pending');
    expect((await me(cookie)).body.tier).toBe('free');

    const hook = await webhook(incoming(checkout));
    expect(hook).toMatchObject({ status: 200, body: { success: true } });
    const confirm = await call<{ status: string; user: { tier: string } }>('POST', '/api/billing/confirm', { orderCode: checkout.orderCode }, cookie);
    expect(confirm.body).toMatchObject({ status: 'paid', user: { tier } });

    const user = (await store.getUserByEmail(email))!;
    const left = daysLeft(tier === 'pro' ? user.proUntil : user.standardUntil);
    expect(left).toBeGreaterThan(periodDays[period] - 0.1);
    expect(left).toBeLessThan(periodDays[period] + 0.1);
    expect((await me(cookie)).body.tier).toBe(tier);
    expect((await store.getOrder(checkout.orderCode))?.paymentRef).toMatch(/^sepay:\d+$/);
  });

  it('webhook sai khóa hoặc thiếu khóa bị từ chối và không kích hoạt gì', async () => {
    const { email, cookie } = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'pro', period: 'week' }, cookie)).body;
    expect((await webhook(incoming(checkout), null)).status).toBe(401);
    expect((await webhook(incoming(checkout), 'sai-khoa')).status).toBe(401);
    expect((await call('POST', '/api/billing/sepay-webhook', incoming(checkout), undefined, { authorization: `Bearer ${SEPAY.apiKey}` })).status).toBe(401);
    expect((await store.getUserByEmail(email))!.proUntil).toBeNull();
  });

  it('SePay gửi lặp cùng giao dịch hoặc hai giao dịch cho một đơn: chỉ cộng thời hạn một lần', async () => {
    const { email, cookie } = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'pro', period: 'month' }, cookie)).body;
    const tx = incoming(checkout);
    const results = await Promise.all([webhook(tx), webhook(tx), webhook(incoming(checkout)), webhook(tx)]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    const first = (await store.getUserByEmail(email))!.proUntil;
    expect(daysLeft(first)).toBeCloseTo(30, 0);
    await webhook(tx);
    expect((await store.getUserByEmail(email))!.proUntil).toBe(first);
  });

  it('chuyển thiếu tiền thì chưa kích hoạt; bù đủ sau đó thì kích hoạt', async () => {
    const { email, cookie } = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'standard', period: 'month' }, cookie)).body;
    expect((await webhook(incoming(checkout, { transferAmount: checkout.amount - 1 }))).body.success).toBe(true);
    expect((await store.getUserByEmail(email))!.standardUntil).toBeNull();
    expect((await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.orderCode }, cookie)).body.status).toBe('pending');
    await webhook(incoming(checkout));
    expect((await store.getUserByEmail(email))!.standardUntil).not.toBeNull();
  });

  it('chuyển dư tiền vẫn kích hoạt', async () => {
    const { email, cookie } = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'standard', period: 'week' }, cookie)).body;
    await webhook(incoming(checkout, { transferAmount: checkout.amount + 50_000 }));
    expect((await store.getUserByEmail(email))!.standardUntil).not.toBeNull();
  });

  it('tiền vào tài khoản khác, tiền ra, hoặc nội dung không có mã đơn thì không kích hoạt', async () => {
    const { email, cookie } = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'pro', period: 'week' }, cookie)).body;
    await webhook(incoming(checkout, { accountNumber: '9999999999' }));
    await webhook(incoming(checkout, { transferType: 'out' }));
    await webhook(incoming(checkout, { content: 'chuyen tien linh tinh', description: '' }));
    await webhook(incoming(checkout, { content: 'PF000000001 ma khac', description: '' }));
    expect((await store.getUserByEmail(email))!.proUntil).toBeNull();
    // Các trường hợp trên đều trả 200 để SePay không thử lại vô ích.
    expect((await webhook(incoming(checkout, { content: 'khong co ma', description: '' }))).status).toBe(200);
  });

  it('nhận mã đơn dù ngân hàng đổi hoa/thường, chèn khoảng trắng, hoặc SePay đã tách sẵn vào trường code', async () => {
    const cases: ((c: Checkout) => Record<string, unknown>)[] = [
      (c) => ({ content: `thanh toan ${c.memo.toLowerCase()} cam on`, description: '' }),
      (c) => ({ content: `PF ${c.orderCode}`, description: '' }),
      (c) => ({ content: 'MBVCB.123 chuyen tien', description: '', code: c.memo }),
    ];
    for (const make of cases) {
      const { email, cookie } = await newUser();
      const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'standard', period: 'week' }, cookie)).body;
      await webhook(incoming(checkout, make(checkout)));
      expect((await store.getUserByEmail(email))!.standardUntil).not.toBeNull();
    }
  });

  it('payload sai định dạng bị từ chối rõ ràng', async () => {
    expect((await webhook({})).status).toBe(400);
    expect((await webhook({ id: 1, transferType: 'in' })).status).toBe(400);
    expect((await webhook({ id: 1, transferType: 'in', transferAmount: 'abc', content: 'PF123456789' })).status).toBe(400);
    expect((await webhook({ id: 1, transferType: 'lung tung', transferAmount: 1000 })).status).toBe(400);
  });

  it('mua tiếp cùng hạng thì cộng dồn', async () => {
    const { email, cookie } = await newUser();
    await buyAndPay(cookie, 'standard', 'month');
    await buyAndPay(cookie, 'standard', 'month');
    expect(daysLeft((await store.getUserByEmail(email))!.standardUntil)).toBeGreaterThan(59.9);
  });

  it('đang có Tiêu chuẩn mua thêm Pro: Pro có hiệu lực ngay, thời gian Tiêu chuẩn không bị mất mà lùi lại', async () => {
    const { email, cookie } = await newUser();
    await buyAndPay(cookie, 'standard', 'month');
    expect((await me(cookie)).body.tier).toBe('standard');
    await buyAndPay(cookie, 'pro', 'week');
    expect((await me(cookie)).body.tier).toBe('pro');
    const user = (await store.getUserByEmail(email))!;
    expect(daysLeft(user.proUntil)).toBeCloseTo(7, 0);
    expect(daysLeft(user.standardUntil)).toBeCloseTo(37, 0);
  });

  it('mua Tiêu chuẩn khi đang có Pro: bắt đầu sau khi Pro hết', async () => {
    const { email, cookie } = await newUser();
    await buyAndPay(cookie, 'pro', 'week');
    await buyAndPay(cookie, 'standard', 'week');
    const user = (await store.getUserByEmail(email))!;
    expect(daysLeft(user.proUntil)).toBeCloseTo(7, 0);
    expect(daysLeft(user.standardUntil)).toBeCloseTo(14, 0);
    expect((await me(cookie)).body.tier).toBe('pro');
  });

  it('không xem được trạng thái đơn của người khác', async () => {
    const owner = await newUser();
    const other = await newUser();
    const checkout = (await call<Checkout>('POST', '/api/billing/checkout', { tier: 'pro', period: 'month' }, owner.cookie)).body;
    await webhook(incoming(checkout));
    expect((await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: checkout.orderCode }, other.cookie)).body.status).toBe('unknown');
    expect((await call<{ status: string }>('POST', '/api/billing/confirm', { orderCode: 1 }, owner.cookie)).body.status).toBe('unknown');
    expect((await call('POST', '/api/billing/confirm', { orderCode: checkout.orderCode })).status).toBe(401);
  });

  it('khi chưa cấu hình SePay: không tạo được đơn, webhook coi như không tồn tại', async () => {
    const bare = await startServer(makeContextWithoutSepay());
    const old = base;
    base = bare.base;
    try {
      const { cookie } = await newUser();
      expect((await call('POST', '/api/billing/checkout', { tier: 'pro', period: 'month' }, cookie)).status).toBe(503);
      expect((await call<PlansResponse>('GET', '/api/plans')).body.billingEnabled).toBe(false);
      expect((await call('POST', '/api/billing/sepay-webhook', { id: 1 }, undefined, { authorization: `Apikey ${SEPAY.apiKey}` })).status).toBe(404);
    } finally {
      base = old;
      bare.server.closeAllConnections();
      bare.server.close();
    }
  });
});

describe('quản trị', () => {
  it('cần mật khẩu admin để cấp gói hoặc xem thống kê tài khoản', async () => {
    expect((await call('POST', '/api/admin/grant', { email: 'a@b.co', days: 5 })).status).toBe(401);
    expect((await call('GET', '/api/admin/accounts')).status).toBe(401);
    const { email } = await newUser();
    expect((await call('POST', '/api/admin/grant', { email: 'ghost@example.com', days: 5 }, undefined, admin)).status).toBe(404);
    expect((await call('POST', '/api/admin/grant', { email, days: 0 }, undefined, admin)).status).toBe(400);
    expect((await call('POST', '/api/admin/grant', { email, tier: 'free', days: 5 }, undefined, admin)).status).toBe(400);
    const counts = await call<{ users: number; activeStandard: number; activePro: number }>('GET', '/api/admin/accounts', undefined, undefined, admin);
    expect(counts.status).toBe(200);
    expect(counts.body.users).toBeGreaterThan(0);
  });

  it('cấp gói không nêu hạng thì mặc định là Pro', async () => {
    const { email, cookie } = await newUser();
    expect((await call('POST', '/api/admin/grant', { email, days: 10 }, undefined, admin)).status).toBe(200);
    expect((await me(cookie)).body.tier).toBe('pro');
  });
});

describe('khi tính năng tài khoản tắt', () => {
  it('giữ nguyên hành vi cũ: không giới hạn gì, /api/me báo tắt', async () => {
    const off = await startServer(undefined);
    const old = base;
    base = off.base;
    try {
      expect((await me()).body).toMatchObject({ accountsEnabled: false, user: null, quota: { limit: null }, entitlements: { dailySearches: null, referenceExport: true, exportRows: null } });
      expect((await call<PlansResponse>('GET', '/api/plans')).body.accountsEnabled).toBe(false);
      for (let i = 0; i < 8; i++) expect((await search(undefined, ['alpha'], 500)).status).toBe(200);
      expect((await exportCall('bibtex', 1)).status).toBe(200);
      expect((await exportCall('csv', 80)).status).toBe(200);
      expect((await call('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' })).status).toBe(404);
    } finally {
      base = old;
      off.server.closeAllConnections();
      off.server.close();
    }
  });
});

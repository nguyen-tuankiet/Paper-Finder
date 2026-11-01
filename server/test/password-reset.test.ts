import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MeResponse } from '../../shared/types.js';
import { createAccountsContext } from '../src/accounts/context.js';
import { MemoryAccountStore } from '../src/accounts/memoryStore.js';
import { ResetTokenSigner, resetEmail } from '../src/accounts/resetToken.js';
import { createApp } from '../src/app.js';
import { silentLogger } from '../src/logger.js';
import type { MailMessage } from '../src/services/mailer.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
const BASE_URL = 'https://paperfinder.example';

interface Env {
  server: Server;
  base: string;
  sent: MailMessage[];
  setNow: (iso: string) => void;
}

async function start(withMail: boolean, forgotPerHour = 10_000): Promise<Env> {
  let now = new Date('2026-11-02T03:00:00Z');
  const sent: MailMessage[] = [];
  const store = new MemoryAccountStore();
  const accounts = createAccountsContext({
    store,
    sessionSecret: SECRET,
    freeDailySearches: 3,
    guestDailySearches: 2,
    timezone: 'Asia/Ho_Chi_Minh',
    rateLimits: { registerPerHour: 10_000, loginFailuresPer15Min: 10_000, forgotPerHour },
    now: () => now,
    billing: { prices: { 'standard:week': 10_000, 'standard:month': 29_000, 'standard:year': 119_000, 'pro:week': 20_000, 'pro:month': 49_000, 'pro:year': 229_000 } },
    mail: withMail ? { mailer: { mode: 'console', send: async (m) => void sent.push(m) }, baseUrl: BASE_URL } : undefined,
  });
  const app = createApp({ adapters: {}, accounts, config: { corsOrigins: [], rateLimitPerMinute: 10_000, staticDir: undefined }, logger: silentLogger });
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, sent, setNow: (iso) => (now = new Date(iso)) };
}

async function call<T = unknown>(env: Env, method: string, path: string, body?: unknown, cookie?: string) {
  const response = await fetch(env.base + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.get('set-cookie');
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as T, cookie: setCookie ? setCookie.split(';')[0] : undefined };
}

/** Lấy liên kết đặt lại từ thư vừa gửi và tách token. */
const tokenOf = (mail: MailMessage): string => {
  const match = /\/\?reset=([\w.-]+)/.exec(mail.text);
  expect(match).not.toBeNull();
  return match![1]!;
};

let env: Env;
let off: Env;
beforeAll(async () => {
  [env, off] = await Promise.all([start(true), start(false)]);
});
afterAll(() => {
  for (const e of [env, off]) {
    e.server.closeAllConnections();
    e.server.close();
  }
});

let counter = 0;
async function newUser(e: Env, password = 'password123') {
  const email = `reset${++counter}@example.com`;
  const r = await call(e, 'POST', '/api/auth/register', { email, password });
  expect(r.status).toBe(201);
  return { email, cookie: r.cookie! };
}

describe('quên mật khẩu', () => {
  it('đặt lại thành công: đăng nhập luôn, mật khẩu cũ hết hiệu lực, phiên cũ bị đăng xuất', async () => {
    const { email, cookie: oldCookie } = await newUser(env);
    expect((await call<MeResponse>(env, 'GET', '/api/me', undefined, oldCookie)).body.passwordResetEnabled).toBe(true);

    const before = env.sent.length;
    expect((await call(env, 'POST', '/api/auth/forgot', { email })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20)); // thư được gửi không đồng bộ
    expect(env.sent).toHaveLength(before + 1);
    const mail = env.sent.at(-1)!;
    expect(mail.to).toBe(email);
    expect(mail.text).toContain(`${BASE_URL}/?reset=`);
    expect(mail.html).toContain(`${BASE_URL}/?reset=`);

    const reset = await call<{ user: { email: string } }>(env, 'POST', '/api/auth/reset', { token: tokenOf(mail), password: 'mat-khau-moi-456' });
    expect(reset.status).toBe(200);
    expect(reset.body.user.email).toBe(email);
    expect((await call<MeResponse>(env, 'GET', '/api/me', undefined, reset.cookie)).body.user?.email).toBe(email); // đã đăng nhập luôn

    expect((await call<MeResponse>(env, 'GET', '/api/me', undefined, oldCookie)).body.user).toBeNull(); // phiên cũ bị vô hiệu
    expect((await call(env, 'POST', '/api/auth/login', { email, password: 'password123' })).status).toBe(401);
    expect((await call(env, 'POST', '/api/auth/login', { email, password: 'mat-khau-moi-456' })).status).toBe(200);
  });

  it('liên kết chỉ dùng được một lần', async () => {
    const { email } = await newUser(env);
    await call(env, 'POST', '/api/auth/forgot', { email });
    await new Promise((r) => setTimeout(r, 20));
    const token = tokenOf(env.sent.at(-1)!);
    expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'mat-khau-moi-111' })).status).toBe(200);
    const again = await call<{ error: string }>(env, 'POST', '/api/auth/reset', { token, password: 'mat-khau-moi-222' });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('invalid_token');
    expect((await call(env, 'POST', '/api/auth/login', { email, password: 'mat-khau-moi-111' })).status).toBe(200);
  });

  it('liên kết cũ hết hiệu lực khi người dùng tự đổi mật khẩu bằng cách khác', async () => {
    const { email, cookie } = await newUser(env);
    await call(env, 'POST', '/api/auth/forgot', { email });
    await new Promise((r) => setTimeout(r, 20));
    const token = tokenOf(env.sent.at(-1)!);
    expect((await call(env, 'POST', '/api/auth/change-password', { currentPassword: 'password123', newPassword: 'doi-mat-khau-789' }, cookie)).status).toBe(200);
    expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'ke-tan-cong-123' })).status).toBe(400);
  });

  it('hết hạn sau 1 giờ', async () => {
    const { email } = await newUser(env);
    await call(env, 'POST', '/api/auth/forgot', { email });
    await new Promise((r) => setTimeout(r, 20));
    const token = tokenOf(env.sent.at(-1)!);
    env.setNow('2026-11-02T04:01:00Z'); // 61 phút sau
    expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'mat-khau-moi-333' })).status).toBe(400);
    env.setNow('2026-11-02T03:00:00Z');
    expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'mat-khau-moi-333' })).status).toBe(200);
  });

  it('không tiết lộ email có tài khoản hay không và không gửi thư cho email lạ', async () => {
    const before = env.sent.length;
    const unknown = await call(env, 'POST', '/api/auth/forgot', { email: 'nguoi-la@example.com' });
    const { email } = await newUser(env);
    const known = await call(env, 'POST', '/api/auth/forgot', { email });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    await new Promise((r) => setTimeout(r, 20));
    expect(env.sent).toHaveLength(before + 1);
    expect(env.sent.at(-1)!.to).toBe(email);
  });

  it('mỗi email chỉ nhận một thư mỗi phút', async () => {
    const { email } = await newUser(env);
    const before = env.sent.length;
    for (let i = 0; i < 3; i++) expect((await call(env, 'POST', '/api/auth/forgot', { email })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(env.sent).toHaveLength(before + 1);
    env.setNow('2026-11-02T03:01:30Z');
    await call(env, 'POST', '/api/auth/forgot', { email });
    await new Promise((r) => setTimeout(r, 20));
    expect(env.sent).toHaveLength(before + 2);
    env.setNow('2026-11-02T03:00:00Z');
  });

  it('từ chối token giả, token phiên đăng nhập, mật khẩu ngắn và yêu cầu sai dạng', async () => {
    const { email, cookie } = await newUser(env);
    const sessionToken = decodeURIComponent(cookie.split('=')[1]!);
    for (const token of ['x'.repeat(30), 'a.b', sessionToken, `${sessionToken}.x`]) {
      expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'mat-khau-moi-444' })).status).toBe(400);
    }
    await call(env, 'POST', '/api/auth/forgot', { email });
    await new Promise((r) => setTimeout(r, 20));
    const token = tokenOf(env.sent.at(-1)!);
    expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'ngan' })).status).toBe(400);
    const [body, sig] = token.split('.');
    expect((await call(env, 'POST', '/api/auth/reset', { token: `${body}.${sig!.slice(0, -2)}xx`, password: 'mat-khau-moi-444' })).status).toBe(400);
    expect((await call(env, 'POST', '/api/auth/reset', { token, password: 'mat-khau-moi-444', extra: 1 })).status).toBe(400);
    expect((await call(env, 'POST', '/api/auth/forgot', { email: 'khong-phai-email' })).status).toBe(400);
    expect((await call(env, 'POST', '/api/auth/forgot', {})).status).toBe(400);
  });

  it('giới hạn số yêu cầu mỗi giờ theo địa chỉ IP', async () => {
    const limited = await start(true, 2);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await call(limited, 'POST', '/api/auth/forgot', { email: `a${i}@example.com` })).status);
      expect(statuses).toEqual([200, 200, 429, 429]);
    } finally {
      limited.server.closeAllConnections();
      limited.server.close();
    }
  });

  it('chưa cấu hình gửi email thì tính năng tắt và giao diện biết để ẩn nút', async () => {
    expect((await call<MeResponse>(off, 'GET', '/api/me')).body.passwordResetEnabled).toBe(false);
    const r = await call<{ error: string }>(off, 'POST', '/api/auth/forgot', { email: 'a@example.com' });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('mail_disabled');
  });
});

describe('ResetTokenSigner và nội dung thư', () => {
  it('token khác khóa bí mật không dùng được; token tạo bằng mật khẩu khác có dấu vân tay khác', () => {
    const a = new ResetTokenSigner('khoa-a-khoa-a-khoa-a-khoa-a-1234');
    const b = new ResetTokenSigner('khoa-b-khoa-b-khoa-b-khoa-b-1234');
    const token = a.create('u1', 'hash-1', 1_000);
    expect(a.verify(token, 2_000)).toMatchObject({ userId: 'u1' });
    expect(b.verify(token, 2_000)).toBeNull();
    expect(a.verify(token, 1_000 + 60 * 60_000)).toBeNull();
    expect(a.verify(a.create('u1', 'hash-2', 1_000), 2_000)!.fingerprint).not.toBe(a.verify(token, 2_000)!.fingerprint);
  });

  it('thư có liên kết ở cả bản văn bản và HTML', () => {
    const mail = resetEmail('https://x.example/?reset=abc.def');
    expect(mail.subject).toContain('mật khẩu');
    expect(mail.text).toContain('https://x.example/?reset=abc.def');
    expect(mail.html).toContain('href="https://x.example/?reset=abc.def"');
  });
});

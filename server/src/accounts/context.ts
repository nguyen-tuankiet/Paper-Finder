import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import type { AccountUser } from '../../../shared/types.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { BillingService } from './billing.js';
import { MemoryAccountStore } from './memoryStore.js';
import { PayOsClient } from './payos.js';
import { PgAccountStore } from './pgStore.js';
import { QuotaService, type Identity } from './quota.js';
import { SessionSigner, SESSION_COOKIE, readCookie } from './session.js';
import { isProActive, type AccountStore, type UserRow } from './types.js';

export interface AccountsContext {
  store: AccountStore;
  signer: SessionSigner;
  quota: QuotaService;
  billing: BillingService;
  limits: { freeDailySearches: number; guestDailySearches: number };
  /** Khóa băm IP của khách (không bao giờ lưu IP gốc). */
  guestSecret: string;
  /** Chống lạm dụng theo IP: số lần tạo tài khoản mỗi giờ và số lần đăng nhập sai mỗi 15 phút. */
  rateLimits: { registerPerHour: number; loginFailuresPer15Min: number };
  now: () => Date;
}

export interface AccountsOptions {
  rateLimits?: Partial<AccountsContext['rateLimits']>;
  store: AccountStore;
  sessionSecret: string;
  freeDailySearches: number;
  guestDailySearches: number;
  timezone: string;
  billing: { payos?: PayOsClient; publicBaseUrl?: string; priceMonth: number; priceYear: number };
  now?: () => Date;
}

export function createAccountsContext(options: AccountsOptions): AccountsContext {
  const now = options.now ?? (() => new Date());
  return {
    store: options.store,
    signer: new SessionSigner(options.sessionSecret),
    quota: new QuotaService({ store: options.store, freeDailySearches: options.freeDailySearches, guestDailySearches: options.guestDailySearches, timezone: options.timezone, now }),
    billing: new BillingService({ store: options.store, now, ...options.billing }),
    limits: { freeDailySearches: options.freeDailySearches, guestDailySearches: options.guestDailySearches },
    guestSecret: `guest|${options.sessionSecret}`,
    rateLimits: { registerPerHour: 10, loginFailuresPer15Min: 10, ...options.rateLimits },
    now,
  };
}

/** Dựng tài khoản từ cấu hình môi trường. Trả undefined khi chưa đặt SESSION_SECRET (tính năng tài khoản tắt). */
export async function buildAccounts(config: AppConfig, logger: Logger): Promise<AccountsContext | undefined> {
  if (!config.sessionSecret) return undefined;
  // Render Free xóa sạch ổ đĩa mỗi lần khởi động lại: lưu tài khoản và đơn thanh toán ở đó sẽ làm mất gói Pro người dùng đã mua.
  if (!config.databaseUrl && process.env.RENDER && !process.env.ACCOUNTS_FILE && process.env.ALLOW_EPHEMERAL_ACCOUNTS !== '1') {
    throw new Error('Tài khoản đang bật (SESSION_SECRET) nhưng chưa có DATABASE_URL: dữ liệu sẽ mất khi Render khởi động lại. Hãy tạo cơ sở dữ liệu PostgreSQL (xem DEPLOY.md mục 7) hoặc gỡ SESSION_SECRET.');
  }
  const store = config.databaseUrl ? await PgAccountStore.connect(config.databaseUrl) : new MemoryAccountStore({ filePath: config.accountsFile, logger });
  if (store.kind !== 'postgres') {
    logger.warn('accounts_not_durable', { message: 'Chưa đặt DATABASE_URL: tài khoản lưu trong file JSON, sẽ mất nếu máy chủ không có ổ đĩa bền (vd. Render Free).' });
  }
  return createAccountsContext({
    store,
    sessionSecret: config.sessionSecret,
    freeDailySearches: config.freeDailySearches,
    guestDailySearches: config.guestDailySearches,
    timezone: config.statsTimezone,
    billing: {
      payos: config.payos ? new PayOsClient(config.payos) : undefined,
      publicBaseUrl: config.publicBaseUrl,
      priceMonth: config.proPriceMonth,
      priceYear: config.proPriceYear,
    },
  });
}

export const toAccountUser = (user: UserRow, now: Date): AccountUser => ({
  email: user.email,
  isPro: isProActive(user, now),
  proUntil: user.proUntil,
  createdAt: user.createdAt,
});

/** Người dùng đang đăng nhập (theo cookie phiên), hoặc null. Token hết hạn hoặc bị vô hiệu (đổi mật khẩu) coi như chưa đăng nhập. */
export async function currentUser(ctx: AccountsContext, req: Request): Promise<UserRow | null> {
  const token = readCookie(req.get('cookie'), SESSION_COOKIE);
  if (!token) return null;
  const session = ctx.signer.verify(token, ctx.now().getTime());
  if (!session) return null;
  const user = await ctx.store.getUserById(session.userId);
  return user && user.sessionVersion === session.sessionVersion ? user : null;
}

/** Danh tính để tính hạn mức: thành viên theo tài khoản, khách theo mã băm IP. */
export async function identityOf(ctx: AccountsContext, req: Request): Promise<{ identity: Identity; user: UserRow | null }> {
  const user = await currentUser(ctx, req);
  if (user) return { identity: { kind: 'user', userId: user.id, isPro: isProActive(user, ctx.now()) }, user };
  return { identity: { kind: 'guest', key: createHmac('sha256', ctx.guestSecret).update(req.ip ?? 'unknown').digest('hex').slice(0, 24) }, user: null };
}

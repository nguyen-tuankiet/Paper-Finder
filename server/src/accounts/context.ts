import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import type pg from 'pg';
import type { AccountUser, Entitlements, Tier } from '../../../shared/types.js';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { BillingService } from './billing.js';
import { MemoryAccountStore } from './memoryStore.js';
import { PgAccountStore } from './pgStore.js';
import { buildEntitlements, tierOf, type PlanKey } from './plans.js';
import type { SepayConfig } from './sepay.js';
import { ResetTokenSigner } from './resetToken.js';
import { QuotaService, type Identity } from './quota.js';
import { SessionSigner, SESSION_COOKIE, readCookie } from './session.js';
import { createConsoleMailer, createSmtpMailer, type Mailer } from '../services/mailer.js';
import type { AccountStore, UserRow } from './types.js';

export interface AccountsContext {
  store: AccountStore;
  signer: SessionSigner;
  quota: QuotaService;
  billing: BillingService;
  /** Quyền lợi của cả bốn hạng (nguồn duy nhất cho mọi giới hạn). */
  entitlements: Record<Tier, Entitlements>;
  /** Gửi email đặt lại mật khẩu; không có = tắt tính năng quên mật khẩu. */
  mail?: { mailer: Mailer; baseUrl: string };
  resetTokens: ResetTokenSigner;
  /** Khóa băm IP của khách (không bao giờ lưu IP gốc). */
  guestSecret: string;
  /** Múi giờ chia ngày (báo cáo doanh thu, hạn mức theo ngày). */
  timezone: string;
  /** Chống lạm dụng theo IP: số lần tạo tài khoản mỗi giờ và số lần đăng nhập sai mỗi 15 phút. */
  rateLimits: { registerPerHour: number; loginFailuresPer15Min: number; forgotPerHour: number };
  now: () => Date;
}

export interface AccountsOptions {
  store: AccountStore;
  sessionSecret: string;
  freeDailySearches: number;
  guestDailySearches: number;
  timezone: string;
  billing: { sepay?: SepayConfig; prices: Record<PlanKey, number> };
  mail?: AccountsContext['mail'];
  rateLimits?: Partial<AccountsContext['rateLimits']>;
  now?: () => Date;
}

export function createAccountsContext(options: AccountsOptions): AccountsContext {
  const now = options.now ?? (() => new Date());
  const entitlements = buildEntitlements({ freeDailySearches: options.freeDailySearches, guestDailySearches: options.guestDailySearches });
  return {
    store: options.store,
    signer: new SessionSigner(options.sessionSecret),
    quota: new QuotaService({ store: options.store, dailySearches: (tier) => entitlements[tier].dailySearches, timezone: options.timezone, now }),
    billing: new BillingService({ store: options.store, now, ...options.billing }),
    entitlements,
    mail: options.mail,
    resetTokens: new ResetTokenSigner(options.sessionSecret),
    guestSecret: `guest|${options.sessionSecret}`,
    timezone: options.timezone,
    rateLimits: { registerPerHour: 10, loginFailuresPer15Min: 10, forgotPerHour: 5, ...options.rateLimits },
    now,
  };
}

/**
 * Chọn cách gửi email: SMTP khi cấu hình đủ (cần cả PUBLIC_BASE_URL); khi phát triển ở máy local mà chưa có SMTP thì chỉ ghi nội dung thư vào log;
 * còn lại (máy chủ thật chưa cấu hình) thì tắt tính năng quên mật khẩu.
 */
export function buildMail(config: AppConfig, logger: Logger): AccountsContext['mail'] {
  if (config.mail.smtp) {
    if (config.mail.baseUrl) return { mailer: createSmtpMailer(config.mail.smtp), baseUrl: config.mail.baseUrl };
    logger.warn('mail_disabled', { message: 'Đã có SMTP nhưng thiếu PUBLIC_BASE_URL nên không dựng được liên kết đặt lại mật khẩu: tính năng quên mật khẩu bị tắt.' });
    return undefined;
  }
  const local = !process.env.RENDER && process.env.NODE_ENV !== 'production';
  return local ? { mailer: createConsoleMailer(logger), baseUrl: config.mail.baseUrl ?? 'http://localhost:5173' } : undefined;
}

/** Dựng tài khoản từ cấu hình môi trường. Trả undefined khi chưa đặt SESSION_SECRET (tính năng tài khoản tắt). */
export async function buildAccounts(config: AppConfig, logger: Logger, pool?: pg.Pool): Promise<AccountsContext | undefined> {
  if (!config.sessionSecret) return undefined;
  // Render Free xóa sạch ổ đĩa mỗi lần khởi động lại: lưu tài khoản và đơn thanh toán ở đó sẽ làm mất gói người dùng đã mua.
  if (!config.databaseUrl && process.env.RENDER && !process.env.ACCOUNTS_FILE && process.env.ALLOW_EPHEMERAL_ACCOUNTS !== '1') {
    throw new Error('Tài khoản đang bật (SESSION_SECRET) nhưng chưa có DATABASE_URL: dữ liệu sẽ mất khi Render khởi động lại. Hãy tạo cơ sở dữ liệu PostgreSQL (xem DEPLOY.md mục 7) hoặc gỡ SESSION_SECRET.');
  }
  const store = pool ? await PgAccountStore.withPool(pool) : config.databaseUrl ? await PgAccountStore.connect(config.databaseUrl) : new MemoryAccountStore({ filePath: config.accountsFile, logger });
  if (store.kind !== 'postgres') {
    logger.warn('accounts_not_durable', { message: 'Chưa đặt DATABASE_URL: tài khoản lưu trong file JSON, sẽ mất nếu máy chủ không có ổ đĩa bền (vd. Render Free).' });
  }
  return createAccountsContext({
    store,
    sessionSecret: config.sessionSecret,
    freeDailySearches: config.freeDailySearches,
    guestDailySearches: config.guestDailySearches,
    timezone: config.statsTimezone,
    billing: { sepay: config.sepay, prices: config.prices },
    mail: buildMail(config, logger),
  });
}

export const toAccountUser = (user: UserRow, now: Date): AccountUser => ({
  email: user.email,
  tier: tierOf(user, now),
  standardUntil: user.standardUntil,
  proUntil: user.proUntil,
  createdAt: user.createdAt,
});

/** Phiên đăng nhập hiện tại (theo cookie) kèm hạn của token. Token hết hạn hoặc bị vô hiệu (đổi mật khẩu) coi như chưa đăng nhập. */
export async function currentSession(ctx: AccountsContext, req: Request): Promise<{ user: UserRow; expiresAt: number } | null> {
  const token = readCookie(req.get('cookie'), SESSION_COOKIE);
  if (!token) return null;
  const session = ctx.signer.verify(token, ctx.now().getTime());
  if (!session) return null;
  const user = await ctx.store.getUserById(session.userId);
  return user && user.sessionVersion === session.sessionVersion ? { user, expiresAt: session.expiresAt } : null;
}

export async function currentUser(ctx: AccountsContext, req: Request): Promise<UserRow | null> {
  return (await currentSession(ctx, req))?.user ?? null;
}

export interface Caller {
  identity: Identity;
  user: UserRow | null;
  tier: Tier;
  entitlements: Entitlements;
}

/** Ai đang gọi, dựng từ người dùng đã biết (hoặc null = khách). */
export function callerFrom(ctx: AccountsContext, req: Request, user: UserRow | null): Caller {
  if (user) {
    const tier = tierOf(user, ctx.now());
    return { identity: { kind: 'user', userId: user.id, tier }, user, tier, entitlements: ctx.entitlements[tier] };
  }
  const key = createHmac('sha256', ctx.guestSecret).update(req.ip ?? 'unknown').digest('hex').slice(0, 24);
  return { identity: { kind: 'guest', key }, user: null, tier: 'guest', entitlements: ctx.entitlements.guest };
}

/** Ai đang gọi: thành viên theo tài khoản, khách theo mã băm IP; kèm hạng và quyền lợi tương ứng. */
export async function callerOf(ctx: AccountsContext, req: Request): Promise<Caller> {
  return callerFrom(ctx, req, await currentUser(ctx, req));
}

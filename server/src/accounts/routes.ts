import { createHash, randomUUID } from 'node:crypto';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ZodType } from 'zod';
import type { Entitlements, LibraryItem, MeResponse, PaperRecord, PaymentStatusResponse, PlansResponse } from '../../../shared/types.js';
import type { Logger } from '../logger.js';
import { adminGrantSchema, changePasswordSchema, checkoutSchema, confirmPaymentSchema, loginSchema, registerSchema, saveLibrarySchema } from '../schemas.js';
import { callerFrom, callerOf, currentSession, currentUser, toAccountUser, type AccountsContext } from './context.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords.js';
import { PayOsError } from './payos.js';
import { SESSION_TTL_MS, clearedSessionCookie, sessionCookie } from './session.js';
import type { UserRow } from './types.js';

const MAX_SAVED_RECORD_BYTES = 40_000;

export interface AccountRouteDeps {
  ctx: AccountsContext;
  logger: Logger;
  /** Kiểm tra mật khẩu admin: 'off' = chưa bật trang admin, 'bad' = sai mật khẩu. */
  checkAdmin: (req: Request) => 'ok' | 'off' | 'bad';
  adminLimiter: RequestHandler;
  /** Máy chủ đã nạp dữ liệu xếp hạng tạp chí. */
  journalRankAvailable: boolean;
}

const issues = (error: { issues: { path: PropertyKey[]; message: string }[] }) => error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

function parse<T>(schema: ZodType<T>, body: unknown, res: Response): T | undefined {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Yêu cầu không hợp lệ.', issues: issues(parsed.error) });
  return undefined;
}

/** Khóa bài trong thư viện: DOI, hoặc mã băm tiêu đề + năm khi bài không có DOI. */
export function libraryKey(record: Pick<PaperRecord, 'doi' | 'title' | 'publicationYear'>): string {
  if (record.doi) return record.doi.trim().toLowerCase();
  const normalized = `${record.title.toLowerCase().replace(/\s+/g, ' ').trim()}|${record.publicationYear ?? ''}`;
  return `h:${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
}

const wrap =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };

export function registerAccountRoutes(app: Express, { ctx, logger, checkAdmin, adminLimiter, journalRankAvailable }: AccountRouteDeps): void {
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.rateLimits.loginFailuresPer15Min,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.' },
  });
  const registerLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: ctx.rateLimits.registerPerHour,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Tạo tài khoản quá nhiều lần từ địa chỉ này. Vui lòng thử lại sau.' },
  });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'rate_limited', message: 'Bạn thao tác quá nhanh.' } });

  const noStore: RequestHandler = (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };

  const startSession = (req: Request, res: Response, user: UserRow) => {
    res.setHeader('Set-Cookie', sessionCookie(ctx.signer.create(user.id, user.sessionVersion, ctx.now().getTime()), req.secure));
  };

  /** Cho phép khi hạng của người gọi có quyền lợi `allow`; ngược lại trả 401 (chưa đăng nhập) hoặc 402 (cần nâng hạng). */
  const requireFeature = async (req: Request, res: Response, allow: (e: Entitlements) => boolean, message: string) => {
    const caller = await callerOf(ctx, req);
    if (!caller.user) {
      res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập.' });
      return undefined;
    }
    if (!allow(caller.entitlements)) {
      res.status(402).json({ error: 'plan_required', message });
      return undefined;
    }
    return { user: caller.user, entitlements: caller.entitlements };
  };
  const NEED_LIBRARY = 'Thư viện cá nhân dành cho hạng Tiêu chuẩn trở lên.';
  const NEED_HISTORY = 'Lịch sử tìm kiếm dành cho hạng Tiêu chuẩn trở lên.';

  // ---------- Thông tin công khai ----------

  app.get('/api/plans', noStore, (_req, res) => {
    const body: PlansResponse = {
      accountsEnabled: true,
      billingEnabled: ctx.billing.enabled,
      tiers: [ctx.entitlements.guest, ctx.entitlements.free, ctx.entitlements.standard, ctx.entitlements.pro],
      plans: ctx.billing.plans(),
      journalRankAvailable,
    };
    res.json(body);
  });

  app.get(
    '/api/me',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const session = await currentSession(ctx, req);
      const caller = callerFrom(ctx, req, session?.user ?? null);
      // Tự gia hạn: người còn dùng thì phiên được kéo dài, nên đăng nhập một lần là được ghi nhớ lâu dài.
      if (session && session.expiresAt - ctx.now().getTime() < SESSION_TTL_MS / 2) startSession(req, res, session.user);
      const body: MeResponse = {
        accountsEnabled: true,
        user: caller.user ? toAccountUser(caller.user, ctx.now()) : null,
        tier: caller.tier,
        entitlements: caller.entitlements,
        quota: await ctx.quota.peek(caller.identity),
      };
      res.json(body);
    }),
  );

  // ---------- Đăng ký, đăng nhập ----------

  app.post(
    '/api/auth/register',
    noStore,
    registerLimiter,
    wrap(async (req, res) => {
      const input = parse(registerSchema, req.body, res);
      if (!input) return;
      const user = await ctx.store.createUser(input.email, await hashPassword(input.password));
      if (!user) {
        res.status(409).json({ error: 'email_taken', message: 'Email này đã được đăng ký. Hãy đăng nhập.' });
        return;
      }
      startSession(req, res, user);
      res.status(201).json({ user: toAccountUser(user, ctx.now()) });
    }),
  );

  app.post(
    '/api/auth/login',
    noStore,
    authLimiter,
    wrap(async (req, res) => {
      const input = parse(loginSchema, req.body, res);
      if (!input) return;
      const user = await ctx.store.getUserByEmail(input.email);
      // Luôn tốn thời gian băm như nhau dù email có tồn tại hay không.
      const ok = user ? await verifyPassword(input.password, user.passwordHash) : (await burnPasswordCheck(input.password), false);
      if (!user || !ok) {
        res.status(401).json({ error: 'invalid_credentials', message: 'Email hoặc mật khẩu không đúng.' });
        return;
      }
      startSession(req, res, user);
      res.json({ user: toAccountUser(user, ctx.now()) });
    }),
  );

  app.post('/api/auth/logout', noStore, (req, res) => {
    res.setHeader('Set-Cookie', clearedSessionCookie(req.secure));
    res.json({ ok: true });
  });

  app.post(
    '/api/auth/change-password',
    noStore,
    authLimiter,
    wrap(async (req, res) => {
      const user = await currentUser(ctx, req);
      if (!user) {
        res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập.' });
        return;
      }
      const input = parse(changePasswordSchema, req.body, res);
      if (!input) return;
      if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
        res.status(401).json({ error: 'invalid_credentials', message: 'Mật khẩu hiện tại không đúng.' });
        return;
      }
      await ctx.store.setPassword(user.id, await hashPassword(input.newPassword));
      // Phiên cũ trên các thiết bị khác bị vô hiệu; cấp phiên mới cho thiết bị này.
      const updated = await ctx.store.getUserById(user.id);
      if (updated) startSession(req, res, updated);
      res.json({ ok: true });
    }),
  );

  // ---------- Thanh toán ----------

  app.post(
    '/api/billing/checkout',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const user = await currentUser(ctx, req);
      if (!user) {
        res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập trước khi nâng cấp.' });
        return;
      }
      if (!ctx.billing.enabled) {
        res.status(503).json({ error: 'billing_disabled', message: 'Thanh toán trực tuyến chưa được bật. Vui lòng liên hệ quản trị viên để nâng cấp.' });
        return;
      }
      const input = parse(checkoutSchema, req.body, res);
      if (!input) return;
      try {
        res.json(await ctx.billing.checkout(user, input.tier, input.period));
      } catch (error) {
        logger.error('checkout_failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(502).json({ error: 'payment_provider', message: error instanceof PayOsError ? error.message : 'Không tạo được link thanh toán.' });
      }
    }),
  );

  // Trang quay lại sau thanh toán gọi API này để kích hoạt ngay (phòng khi webhook chưa kịp tới).
  app.post(
    '/api/billing/confirm',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const user = await currentUser(ctx, req);
      if (!user) {
        res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập.' });
        return;
      }
      const input = parse(confirmPaymentSchema, req.body, res);
      if (!input) return;
      try {
        const result = await ctx.billing.refresh(input.orderCode, user.id);
        const fresh = result.user ?? (await ctx.store.getUserById(user.id));
        const body: PaymentStatusResponse = { status: result.status, user: fresh ? toAccountUser(fresh, ctx.now()) : null };
        res.json(body);
      } catch (error) {
        logger.error('confirm_failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(502).json({ error: 'payment_provider', message: 'Chưa kiểm tra được trạng thái thanh toán. Thử lại sau ít phút.' });
      }
    }),
  );

  // PayOS gọi khi có giao dịch. Nội dung webhook KHÔNG được tin: chỉ lấy mã đơn rồi hỏi lại PayOS trạng thái thật.
  app.post(
    '/api/billing/payos-webhook',
    wrap(async (req, res) => {
      const raw = (req.body as { data?: { orderCode?: unknown } } | undefined)?.data?.orderCode;
      const orderCode = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
      if (Number.isSafeInteger(orderCode) && orderCode > 0) {
        try {
          await ctx.billing.refresh(orderCode);
        } catch (error) {
          logger.error('webhook_refresh_failed', { error: error instanceof Error ? error.message : String(error) });
        }
      }
      // Luôn trả 200 để PayOS xác nhận được địa chỉ webhook (kể cả lệnh thử có mã đơn giả).
      res.json({ ok: true });
    }),
  );

  // ---------- Thư viện cá nhân (Pro) ----------

  app.get(
    '/api/library',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const ok = await requireFeature(req, res, (e) => e.libraryMax > 0, NEED_LIBRARY);
      if (!ok) return;
      res.json(await ctx.store.listLibrary(ok.user.id));
    }),
  );

  app.post(
    '/api/library',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const ok = await requireFeature(req, res, (e) => e.libraryMax > 0, NEED_LIBRARY);
      if (!ok) return;
      const { user, entitlements } = ok;
      const input = parse(saveLibrarySchema, req.body, res);
      if (!input) return;
      const record = { ...input.record } as Record<string, unknown>;
      delete record.oaPdfSig; // chữ ký tải PDF chỉ có hiệu lực trong một lần chạy của máy chủ
      if (Buffer.byteLength(JSON.stringify(record)) > MAX_SAVED_RECORD_BYTES) {
        res.status(413).json({ error: 'payload_too_large', message: 'Bản ghi bài báo quá lớn để lưu.' });
        return;
      }
      const item: LibraryItem = { key: libraryKey(input.record), folder: input.folder, savedAt: ctx.now().toISOString(), record: record as unknown as PaperRecord };
      const status = await ctx.store.saveToLibrary(user.id, item, entitlements.libraryMax);
      if (status === 'full') {
        res.status(409).json({ error: 'library_full', message: `Thư viện đã đầy (${entitlements.libraryMax} bài). Hãy xóa bớt hoặc nâng hạng để lưu thêm.` });
        return;
      }
      res.status(status === 'saved' ? 201 : 200).json({ status, key: item.key });
    }),
  );

  app.delete(
    '/api/library/:key',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const ok = await requireFeature(req, res, (e) => e.libraryMax > 0, NEED_LIBRARY);
      if (!ok) return;
      const removed = await ctx.store.removeFromLibrary(ok.user.id, String(req.params.key));
      res.status(removed ? 200 : 404).json(removed ? { ok: true } : { error: 'not_found', message: 'Bài không có trong thư viện.' });
    }),
  );

  // ---------- Lịch sử tìm kiếm (Pro) ----------

  app.get(
    '/api/history',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const ok = await requireFeature(req, res, (e) => e.historyMax > 0, NEED_HISTORY);
      if (!ok) return;
      res.json(await ctx.store.listHistory(ok.user.id));
    }),
  );

  app.delete(
    '/api/history',
    noStore,
    apiLimiter,
    wrap(async (req, res) => {
      const ok = await requireFeature(req, res, (e) => e.historyMax > 0, NEED_HISTORY);
      if (!ok) return;
      await ctx.store.clearHistory(ok.user.id);
      res.json({ ok: true });
    }),
  );

  // ---------- Quản trị: cấp Pro thủ công, thống kê tài khoản ----------

  const adminOnly: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const state = checkAdmin(req);
    if (state === 'off') {
      res.status(404).json({ error: 'not_found', message: 'Không tìm thấy API.' });
      return;
    }
    if (state === 'bad') {
      res.status(401).json({ error: 'unauthorized', message: 'Sai mật khẩu quản trị.' });
      return;
    }
    next();
  };

  app.get(
    '/api/admin/accounts',
    adminLimiter,
    adminOnly,
    wrap(async (_req, res) => {
      res.json(await ctx.store.counts(ctx.now()));
    }),
  );

  app.post(
    '/api/admin/grant',
    adminLimiter,
    adminOnly,
    wrap(async (req, res) => {
      const input = parse(adminGrantSchema, req.body, res);
      if (!input) return;
      const user = await ctx.store.getUserByEmail(input.email);
      if (!user) {
        res.status(404).json({ error: 'not_found', message: 'Không có tài khoản với email này.' });
        return;
      }
      const updated = await ctx.store.grantPlan(user.id, input.tier, input.days, ctx.now());
      logger.info('plan_granted', { userId: user.id, tier: input.tier, days: input.days, id: randomUUID().slice(0, 8) });
      res.json({ user: updated ? toAccountUser(updated, ctx.now()) : null });
    }),
  );
}

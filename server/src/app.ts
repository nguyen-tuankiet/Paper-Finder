import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { SearchEvent } from '../../shared/types.js';
import type { AppConfig } from './config.js';
import { UpstreamError } from './lib/errors.js';
import type { Logger } from './logger.js';
import { exportRequestSchema, searchRequestSchema } from './schemas.js';
import { CONTENT_TYPES, exportFilename, toBibtex, toCsv, toRis, toXlsx } from './services/export.js';
import { SourceHealthService } from './services/health.js';
import { runSearch, type AdapterMap } from './services/search.js';
import { StatsService } from './services/stats.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PRO_EXPORT_FORMATS } from '../../shared/types.js';
import { currentUser, identityOf, type AccountsContext } from './accounts/context.js';
import { MAX_HISTORY_ENTRIES, registerAccountRoutes } from './accounts/routes.js';
import { isProActive } from './accounts/types.js';
import { DEFAULT_DOWNLOAD_OPTIONS, DownloadError, UrlSigner, openPdf, safePdfFileName, type DownloadErrorCode, type DownloadOptions } from './services/download.js';

const DOWNLOAD_STATUS: Record<DownloadErrorCode, number> = {
  bad_url: 400,
  blocked: 400,
  not_pdf: 422,
  too_large: 413,
  timeout: 504,
  upstream: 502,
  network: 502,
  cancelled: 499,
};

const MAX_ACTIVE_DOWNLOADS = 4;

export interface AppDeps {
  /** Ký/kiểm tra link PDF cho /api/download. Mặc định dùng khóa ngẫu nhiên mỗi lần khởi động. */
  signer?: UrlSigner;
  downloadOptions?: Partial<DownloadOptions>;
  adapters: AdapterMap;
  config: Pick<AppConfig, 'corsOrigins' | 'rateLimitPerMinute' | 'trustProxy' | 'staticDir'> & Partial<Pick<AppConfig, 'adminPassword'>>;
  logger: Logger;
  /** Thống kê sử dụng; mặc định chỉ lưu trong bộ nhớ. */
  stats?: StatsService;
  /** Tài khoản, hạn mức lượt tìm và gói Pro. Không truyền = tắt: ai cũng tìm không giới hạn như trước. */
  accounts?: AccountsContext;
}

/** So sánh mật khẩu không lộ thông tin qua thời gian xử lý. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function issuesOf(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function createApp({ adapters, config, logger, stats = new StatsService(), signer = new UrlSigner(), downloadOptions, accounts }: AppDeps) {
  const downloadOpts: DownloadOptions = { ...DEFAULT_DOWNLOAD_OPTIONS, ...downloadOptions };
  let activeDownloads = 0;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(helmet({ contentSecurityPolicy: false }));
  if (config.corsOrigins.length > 0) app.use(cors({ origin: config.corsOrigins, exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '30mb' }));

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.' },
  });
  const health = new SourceHealthService(adapters);

  // Đếm người dùng khi họ gọi các API thật sự dùng (không tính /api/health do bot giám sát ping).
  app.use(['/api/sources', '/api/search', '/api/export'], (req, _res, next) => {
    stats.recordVisit(req.ip, req.get('user-agent'));
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Chỉ các lần đăng nhập sai bị tính vào giới hạn (skipSuccessfulRequests) để chống dò mật khẩu.
  const adminLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' },
  });

  const checkAdmin = (req: Request): 'ok' | 'off' | 'bad' => {
    if (!config.adminPassword) return 'off';
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token && safeEqual(token, config.adminPassword) ? 'ok' : 'bad';
  };

  if (accounts) registerAccountRoutes(app, { ctx: accounts, logger, checkAdmin, adminLimiter });
  else {
    // Tính năng tài khoản tắt: giao diện vẫn hỏi /api/me và /api/plans để biết có cần hiện nút đăng nhập hay không.
    app.get('/api/me', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ accountsEnabled: false, user: null, quota: { limit: null, used: 0, remaining: null, resetsAt: null } });
    });
    app.get('/api/plans', (_req, res) => {
      res.json({ accountsEnabled: false, billingEnabled: false, freeDailySearches: 0, guestDailySearches: 0, plans: [] });
    });
  }

  app.get('/api/admin/stats', adminLimiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!config.adminPassword) {
      // Chưa cấu hình: coi như không tồn tại.
      res.status(404).json({ error: 'not_found', message: 'Không tìm thấy API.' });
      return;
    }
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token || !safeEqual(token, config.adminPassword)) {
      res.status(401).json({ error: 'unauthorized', message: 'Sai mật khẩu quản trị.' });
      return;
    }
    const days = Number(req.query.days);
    res.json(stats.getReport(Number.isFinite(days) && days > 0 ? days : 30));
  });

  app.get('/api/sources', async (_req, res) => {
    res.json(await health.check());
  });

  // Kết quả tìm kiếm trả về dạng NDJSON (mỗi dòng một JSON) để giao diện hiển thị tiến độ theo thời gian thực.
  app.post('/api/search', limiter, async (req, res) => {
    const parsed = searchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', message: 'Yêu cầu tìm kiếm không hợp lệ.', issues: issuesOf(parsed.error) });
      return;
    }
    const request = parsed.data;
    const unavailable = request.sources.filter((source) => !adapters[source]);
    if (unavailable.length > 0) {
      res.status(400).json({
        error: 'invalid_request',
        message: `Nguồn chưa được bật trên máy chủ: ${unavailable.join(', ')}.`,
        issues: [{ path: 'sources', message: `Nguồn chưa được bật trên máy chủ: ${unavailable.join(', ')}.` }],
      });
      return;
    }

    // Hạn mức lượt tìm: mỗi từ khóa một lượt; gói Pro không giới hạn.
    let billed: Awaited<ReturnType<typeof identityOf>> | undefined;
    const keywordCount = request.keywords.length;
    if (accounts) {
      billed = await identityOf(accounts, req);
      const charge = await accounts.quota.consume(billed.identity, keywordCount);
      if (!charge.ok) {
        const { limit = 0, remaining = 0 } = charge.quota;
        const partial = (remaining ?? 0) > 0;
        const message = partial
          ? `Lần tìm này có ${keywordCount} từ khóa (mỗi từ khóa tính một lượt) nhưng hôm nay bạn chỉ còn ${remaining} lượt. Hãy bớt từ khóa hoặc nâng cấp Pro.`
          : billed.user
            ? `Bạn đã dùng hết ${limit} lượt tìm miễn phí hôm nay. Nâng cấp Pro để tìm không giới hạn, hoặc quay lại vào ngày mai.`
            : `Bạn đã dùng hết ${limit} lượt tìm của khách hôm nay. Đăng nhập để có ${accounts.limits.freeDailySearches} lượt mỗi ngày, hoặc nâng cấp Pro để không giới hạn.`;
        res.status(429).json({ error: 'quota_exceeded', message, quota: charge.quota, signedIn: Boolean(billed.user) });
        return;
      }
    }
    const refund = () => {
      if (accounts && billed) void accounts.quota.refund(billed.identity, keywordCount).catch(() => undefined);
    };

    stats.recordSearchStarted();
    stats.recordSearchSources(request.sources);

    const controller = new AbortController();
    // Người dùng hủy hoặc đóng trình duyệt -> hủy ngay các request tới API học thuật.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (event: SearchEvent) => {
      if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(event) + '\n');
    };
    const heartbeat = setInterval(() => send({ type: 'ping' }), 10_000);

    try {
      const result = await runSearch(request, {
        adapters,
        signal: controller.signal,
        logger,
        signUrl: (url) => signer.sign(url),
        onProgress: (progress) => send({ type: 'progress', ...progress }),
      });
      send({ type: 'result', result });
      stats.recordSearchOutcome(
        result.stats.sourcesSucceeded > 0
          ? { kind: 'completed', total: result.stats.total, sources: result.sources }
          : { kind: 'failed', sources: result.sources },
      );
      if (result.stats.sourcesSucceeded === 0) refund(); // không nguồn nào trả lời: không tính lượt
      else if (accounts && billed?.user && isProActive(billed.user, accounts.now())) {
        // Lịch sử tìm kiếm chỉ lưu cho gói Pro (lưu điều kiện tìm, không lưu kết quả).
        void accounts.store
          .addHistory(billed.user.id, { id: randomUUID(), at: accounts.now().toISOString(), request, total: result.stats.total }, MAX_HISTORY_ENTRIES)
          .catch((error: unknown) => logger.error('history_failed', { error: error instanceof Error ? error.message : String(error) }));
      }
    } catch (error) {
      refund();
      if (error instanceof UpstreamError && error.code === 'cancelled') {
        stats.recordSearchOutcome({ kind: 'cancelled' });
      } else {
        logger.error('search_failed', { error: error instanceof Error ? error.message : String(error) });
        send({ type: 'error', message: 'Đã xảy ra lỗi khi xử lý kết quả tìm kiếm.' });
        stats.recordSearchOutcome({ kind: 'failed' });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  const downloadLimiter = rateLimit({
    windowMs: 60_000,
    limit: Math.max(5, Math.floor(config.rateLimitPerMinute / 3)),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'rate_limited', message: 'Bạn tải quá nhanh. Vui lòng thử lại sau ít phút.' },
  });

  /**
   * Chuyển tiếp file PDF miễn phí để trình duyệt TẢI VỀ trực tiếp (link PDF của nhà xuất bản ở tên miền khác
   * thì trình duyệt chỉ mở trong trình xem). Chỉ nhận link đã được máy chủ ký trong kết quả tìm kiếm, chặn địa chỉ nội bộ,
   * giới hạn dung lượng và chỉ chấp nhận dữ liệu thực sự là PDF.
   */
  app.get('/api/download', downloadLimiter, async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    if (!url || !sig || !signer.verify(url, sig)) {
      res.status(403).json({ error: 'forbidden', message: 'Link tải không hợp lệ hoặc đã hết hạn. Hãy tìm kiếm lại rồi thử tải lần nữa.' });
      return;
    }
    if (activeDownloads >= MAX_ACTIVE_DOWNLOADS) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'busy', message: 'Máy chủ đang bận tải file khác. Vui lòng thử lại sau vài giây.' });
      return;
    }

    activeDownloads++;
    const controller = new AbortController();
    let opened: Awaited<ReturnType<typeof openPdf>> | undefined;
    res.on('close', () => {
      controller.abort();
      opened?.destroy();
    });

    try {
      opened = await openPdf(url, downloadOpts, controller.signal);
      const names = safePdfFileName(req.query.name);
      res.status(200);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeURIComponent(names.unicode)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      if (opened.contentLength !== undefined) res.setHeader('Content-Length', String(opened.contentLength));
      const source = opened;
      async function* body() {
        let total = source.first.length;
        yield source.first;
        for await (const chunk of source.rest) {
          total += chunk.length;
          if (total > downloadOpts.maxBytes) throw new DownloadError('too_large', 'File vượt giới hạn dung lượng.');
          yield chunk;
        }
      }
      await pipeline(Readable.from(body()), res);
    } catch (error) {
      if (error instanceof DownloadError && !res.headersSent) {
        if (error.code !== 'cancelled') logger.warn('download_rejected', { code: error.code });
        res.status(DOWNLOAD_STATUS[error.code]).json({ error: error.code, message: error.message });
      } else if (!res.headersSent) {
        logger.error('download_failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(502).json({ error: 'upstream', message: 'Không tải được file.' });
      } else {
        res.destroy(); // đã gửi một phần: ngắt kết nối để trình duyệt báo tải lỗi thay vì lưu file thiếu
      }
    } finally {
      opened?.destroy();
      activeDownloads--;
    }
  });

  app.post('/api/export', limiter, async (req, res) => {
    const parsed = exportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', message: 'Dữ liệu xuất file không hợp lệ.', issues: issuesOf(parsed.error) });
      return;
    }
    const { format, records } = parsed.data;
    if ((PRO_EXPORT_FORMATS as readonly string[]).includes(format)) {
      // BibTeX/RIS là tính năng gói Pro. Khi tài khoản tắt thì không khóa (giữ nguyên hành vi cũ).
      if (accounts) {
        const user = await currentUser(accounts, req);
        if (!user) {
          res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập để xuất BibTeX/RIS.' });
          return;
        }
        if (!isProActive(user, accounts.now())) {
          res.status(402).json({ error: 'pro_required', message: 'Xuất BibTeX/RIS dành cho gói Pro.' });
          return;
        }
      }
    }
    const body = format === 'csv' ? toCsv(records) : format === 'bibtex' ? toBibtex(records) : format === 'ris' ? toRis(records) : await toXlsx(records);
    stats.recordExport();
    const filename = exportFilename(format);
    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Không tìm thấy API.' });
  });

  // Phục vụ giao diện đã build (triển khai gộp một container).
  const staticDir = config.staticDir;
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      // Trang admin không nên xuất hiện trên công cụ tìm kiếm.
      if (req.path.startsWith('/admin')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const bodyError = error as { type?: string; status?: number };
    if (bodyError?.type === 'entity.too.large') {
      res.status(413).json({ error: 'payload_too_large', message: 'Dữ liệu gửi lên quá lớn.' });
      return;
    }
    if (bodyError?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'Nội dung yêu cầu không phải JSON hợp lệ.' });
      return;
    }
    logger.error('unhandled_error', { error: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: 'Lỗi máy chủ nội bộ.' });
  });

  return app;
}

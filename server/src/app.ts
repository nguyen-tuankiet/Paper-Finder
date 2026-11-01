import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { Entitlements, SearchEvent } from '../../shared/types.js';
import type { AppConfig } from './config.js';
import { UpstreamError } from './lib/errors.js';
import type { Logger } from './logger.js';
import { docxRequestSchema, exportRequestSchema, lookupRequestSchema, searchRequestSchema } from './schemas.js';
import { CONTENT_TYPES, exportFilename, toBibtex, toCsv, toRis, toXlsx } from './services/export.js';
import { DOCX_CONTENT_TYPE, buildReferencesDocx } from './services/docx.js';
import type { JournalRanker } from './services/journalRank.js';
import { extractDois, lookupDois } from './services/lookup.js';
import { SourceHealthService } from './services/health.js';
import { runSearch, type AdapterMap } from './services/search.js';
import { StatsService } from './services/stats.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { REFERENCE_EXPORT_FORMATS } from '../../shared/types.js';
import { callerOf, type AccountsContext, type Caller } from './accounts/context.js';
import { registerAccountRoutes } from './accounts/routes.js';
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

/** Khi tính năng tài khoản tắt: không giới hạn gì (giữ nguyên hành vi trước khi có tài khoản). */
const UNRESTRICTED: Entitlements = {
  tier: 'pro',
  label: 'Đầy đủ',
  dailySearches: null,
  maxResultsPerSource: 500,
  exportRows: null,
  referenceExport: true,
  wordExport: true,
  doiLookupMax: 500,
  citationTools: true,
  journalRank: true,
  libraryMax: 0,
  historyMax: 0,
};

export interface AppDeps {
  /** Ký/kiểm tra link PDF cho /api/download. Mặc định dùng khóa ngẫu nhiên mỗi lần khởi động. */
  signer?: UrlSigner;
  downloadOptions?: Partial<DownloadOptions>;
  adapters: AdapterMap;
  config: Pick<AppConfig, 'corsOrigins' | 'rateLimitPerMinute' | 'trustProxy' | 'staticDir'> & Partial<Pick<AppConfig, 'adminPassword' | 'sepay'>>;
  logger: Logger;
  /** Thống kê sử dụng; mặc định chỉ lưu trong bộ nhớ. */
  stats?: StatsService;
  /** Tài khoản, hạn mức lượt tìm và gói Pro. Không truyền = tắt: ai cũng tìm không giới hạn như trước. */
  accounts?: AccountsContext;
  /** Dữ liệu xếp hạng tạp chí Q1–Q4 (nếu chủ web đã nạp file SCImago). */
  journalRanker?: JournalRanker;
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

export function createApp({ adapters, config, logger, stats = new StatsService(), signer = new UrlSigner(), downloadOptions, accounts, journalRanker }: AppDeps) {
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

  if (accounts) registerAccountRoutes(app, { ctx: accounts, logger, checkAdmin, adminLimiter, journalRankAvailable: Boolean(journalRanker), sepayApiKey: config.sepay?.apiKey });
  else {
    // Tính năng tài khoản tắt: giao diện vẫn hỏi /api/me và /api/plans để biết có cần hiện nút đăng nhập hay không.
    app.get('/api/me', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ accountsEnabled: false, passwordResetEnabled: false, user: null, tier: 'pro', entitlements: UNRESTRICTED, quota: { limit: null, used: 0, remaining: null, resetsAt: null } });
    });
    app.get('/api/plans', (_req, res) => {
      res.json({ accountsEnabled: false, billingEnabled: false, tiers: [], plans: [], journalRankAvailable: Boolean(journalRanker) });
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

    // Quyền lợi theo hạng: số kết quả mỗi nguồn, rồi hạn mức lượt tìm (mỗi từ khóa một lượt; hạng trả phí không giới hạn).
    let caller: Caller | undefined;
    const keywordCount = request.keywords.length;
    if (accounts) {
      caller = await callerOf(accounts, req);
      const cap = caller.entitlements.maxResultsPerSource;
      if (request.maxResults > cap) {
        const message = caller.user
          ? `Hạng ${caller.entitlements.label} chỉ lấy tối đa ${cap} kết quả mỗi nguồn. Hãy giảm số kết quả hoặc nâng hạng.`
          : `Khách chỉ lấy tối đa ${cap} kết quả mỗi nguồn. Hãy đăng nhập hoặc giảm số kết quả.`;
        res.status(403).json({ error: 'results_limit', message, limit: cap, signedIn: Boolean(caller.user) });
        return;
      }
      const charge = await accounts.quota.consume(caller.identity, keywordCount);
      if (!charge.ok) {
        const { limit = 0, remaining = 0 } = charge.quota;
        const partial = (remaining ?? 0) > 0;
        const message = partial
          ? `Lần tìm này có ${keywordCount} từ khóa (mỗi từ khóa tính một lượt) nhưng hôm nay bạn chỉ còn ${remaining} lượt. Hãy bớt từ khóa hoặc nâng cấp gói.`
          : caller.user
            ? `Bạn đã dùng hết ${limit} lượt tìm hôm nay. Nâng cấp gói để tìm không giới hạn, hoặc quay lại vào ngày mai.`
            : `Bạn đã dùng hết ${limit} lượt tìm của khách hôm nay. Đăng nhập để có ${accounts.entitlements.free.dailySearches} lượt mỗi ngày và thêm tính năng, hoặc mua gói để không giới hạn.`;
        res.status(429).json({ error: 'quota_exceeded', message, quota: charge.quota, signedIn: Boolean(caller.user) });
        return;
      }
    }
    const refund = () => {
      if (accounts && caller) void accounts.quota.refund(caller.identity, keywordCount).catch(() => undefined);
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
      let result = await runSearch(request, {
        adapters,
        signal: controller.signal,
        logger,
        signUrl: (url) => signer.sign(url),
        onProgress: (progress) => send({ type: 'progress', ...progress }),
      });
      // Xếp hạng tạp chí (Q1–Q4) chỉ gắn cho hạng được xem; khi tài khoản tắt thì mở cho tất cả.
      if (journalRanker && (!caller || caller.entitlements.journalRank)) result = { ...result, records: journalRanker.enrich(result.records) };
      send({ type: 'result', result });
      stats.recordSearchOutcome(
        result.stats.sourcesSucceeded > 0
          ? { kind: 'completed', total: result.stats.total, sources: result.sources }
          : { kind: 'failed', sources: result.sources },
      );
      if (result.stats.sourcesSucceeded === 0) refund(); // không nguồn nào trả lời: không tính lượt
      else if (accounts && caller?.user && caller.entitlements.historyMax > 0) {
        // Lịch sử tìm kiếm chỉ lưu cho hạng có quyền (lưu điều kiện tìm, không lưu kết quả).
        void accounts.store
          .addHistory(caller.user.id, { id: randomUUID(), at: accounts.now().toISOString(), request, total: result.stats.total }, caller.entitlements.historyMax)
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
    const { format } = parsed.data;
    let records = parsed.data.records;
    let truncatedFrom: number | undefined;
    if (accounts) {
      const caller = await callerOf(accounts, req);
      const { entitlements } = caller;
      if ((REFERENCE_EXPORT_FORMATS as readonly string[]).includes(format)) {
        if (!caller.user) {
          res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập để xuất BibTeX/RIS.' });
          return;
        }
        if (!entitlements.referenceExport) {
          res.status(402).json({ error: 'plan_required', message: 'Xuất BibTeX/RIS dành cho hạng Pro.' });
          return;
        }
      } else if (entitlements.exportRows === 0) {
        res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập để xuất file Excel/CSV.' });
        return;
      } else if (entitlements.exportRows !== null && records.length > entitlements.exportRows) {
        // Hạng miễn phí: xuất phần đầu danh sách và cho giao diện biết để gợi ý nâng hạng (không từ chối cả file).
        truncatedFrom = records.length;
        records = records.slice(0, entitlements.exportRows);
      }
    }
    const body = format === 'csv' ? toCsv(records) : format === 'bibtex' ? toBibtex(records) : format === 'ris' ? toRis(records) : await toXlsx(records);
    stats.recordExport();
    const filename = exportFilename(format);
    res.setHeader('Content-Type', CONTENT_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (truncatedFrom !== undefined) {
      res.setHeader('X-Export-Truncated', `${records.length}/${truncatedFrom}`);
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Truncated');
    }
    res.send(body);
  });

  // Word (.docx): giao diện gửi các dòng tài liệu tham khảo đã định dạng, máy chủ dàn trang.
  app.post('/api/export/docx', limiter, async (req, res) => {
    const parsed = docxRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', message: 'Danh sách tài liệu tham khảo không hợp lệ.', issues: issuesOf(parsed.error) });
      return;
    }
    if (accounts) {
      const caller = await callerOf(accounts, req);
      if (!caller.user) {
        res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập để xuất file Word.' });
        return;
      }
      if (!caller.entitlements.wordExport) {
        res.status(402).json({ error: 'plan_required', message: 'Xuất file Word dành cho hạng Tiêu chuẩn trở lên.' });
        return;
      }
    }
    const body = await buildReferencesDocx(parsed.data.lines);
    stats.recordExport();
    res.setHeader('Content-Type', DOCX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="paperfinder_tai_lieu_tham_khao_${new Date().toISOString().slice(0, 10)}.docx"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  });

  // Chuẩn hóa danh sách DOI: tra thông tin từng DOI rồi trả về như một kết quả tìm kiếm.
  app.post('/api/lookup', limiter, async (req, res) => {
    const parsed = lookupRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Yêu cầu không hợp lệ.', issues: issuesOf(parsed.error) });
      return;
    }
    let maxDois = 500;
    let caller: Caller | undefined;
    if (accounts) {
      caller = await callerOf(accounts, req);
      if (!caller.user) {
        res.status(401).json({ error: 'unauthorized', message: 'Vui lòng đăng nhập để dùng tính năng này.' });
        return;
      }
      if (caller.entitlements.doiLookupMax === 0) {
        res.status(402).json({ error: 'plan_required', message: 'Chuẩn hóa danh sách DOI dành cho hạng Tiêu chuẩn trở lên.' });
        return;
      }
      maxDois = caller.entitlements.doiLookupMax;
    }
    if (!Object.values(adapters).some((a) => a?.lookupDoi)) {
      res.status(503).json({ error: 'unavailable', message: 'Máy chủ chưa bật nguồn hỗ trợ tra DOI.' });
      return;
    }
    const extracted = extractDois(parsed.data.text);
    if (extracted.dois.length === 0) {
      res.status(400).json({ error: 'no_doi', message: 'Không tìm thấy DOI nào trong nội dung đã dán. Mỗi dòng một DOI (vd. 10.1000/xyz123) hoặc link doi.org.', invalid: extracted.invalid });
      return;
    }
    if (extracted.dois.length > maxDois) {
      res.status(400).json({ error: 'too_many', message: `Mỗi lần tra tối đa ${maxDois} DOI (bạn dán ${extracted.dois.length}). Hãy chia nhỏ danh sách.` });
      return;
    }

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const outcome = await lookupDois(extracted.dois, { adapters, signal: controller.signal, signUrl: (url) => signer.sign(url) });
      if (journalRanker && (!caller || caller.entitlements.journalRank)) outcome.result.records = journalRanker.enrich(outcome.result.records);
      res.json({ result: outcome.result, notFound: outcome.notFound, failed: outcome.failed, invalid: extracted.invalid, duplicates: extracted.duplicates });
    } catch (error) {
      if (error instanceof UpstreamError && error.code === 'cancelled') return;
      logger.error('lookup_failed', { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: 'Không tra được danh sách DOI. Vui lòng thử lại.' });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Không tìm thấy API.' });
  });

  // Phục vụ giao diện đã build (triển khai gộp một container).
  const staticDir = config.staticDir;
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      // Trang admin và các trang riêng của tài khoản không nên xuất hiện trên công cụ tìm kiếm.
      if (/^\/(admin|thu-vien|lich-su)(\/|$)/.test(req.path)) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
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

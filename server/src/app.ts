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
import { CONTENT_TYPES, exportFilename, toCsv, toXlsx } from './services/export.js';
import { SourceHealthService } from './services/health.js';
import { runSearch, type AdapterMap } from './services/search.js';

export interface AppDeps {
  adapters: AdapterMap;
  config: Pick<AppConfig, 'corsOrigins' | 'rateLimitPerMinute' | 'trustProxy' | 'staticDir'>;
  logger: Logger;
}

function issuesOf(error: ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function createApp({ adapters, config, logger }: AppDeps) {
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

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
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
        onProgress: (progress) => send({ type: 'progress', ...progress }),
      });
      send({ type: 'result', result });
    } catch (error) {
      if (!(error instanceof UpstreamError && error.code === 'cancelled')) {
        logger.error('search_failed', { error: error instanceof Error ? error.message : String(error) });
        send({ type: 'error', message: 'Đã xảy ra lỗi khi xử lý kết quả tìm kiếm.' });
      }
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  app.post('/api/export', limiter, async (req, res) => {
    const parsed = exportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_request', message: 'Dữ liệu xuất file không hợp lệ.', issues: issuesOf(parsed.error) });
      return;
    }
    const { format, records } = parsed.data;
    const body = format === 'csv' ? toCsv(records) : await toXlsx(records);
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
    app.get(/^(?!\/api\/).*/, (_req, res) => {
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

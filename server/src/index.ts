import { createApp } from './app.js';
import { loadEnvFiles, parseConfig } from './config.js';
import { HttpClient } from './lib/http.js';
import { Limiter } from './lib/limiter.js';
import { createLogger } from './logger.js';
import { StatsService } from './services/stats.js';
import { UrlSigner } from './services/download.js';
import { CrossrefAdapter } from './sources/crossref.js';
import { OpenAlexAdapter } from './sources/openalex.js';
import { ArxivAdapter } from './sources/arxiv.js';
import { DoajAdapter } from './sources/doaj.js';
import { EuropePmcAdapter } from './sources/europepmc.js';
import { SemanticScholarAdapter } from './sources/semanticscholar.js';
import type { AdapterMap } from './services/search.js';

loadEnvFiles();
const config = parseConfig(process.env);
const logger = createLogger(config.logLevel);

// Crossref: 3 request/giây và tối đa 3 đồng thời (polite pool) -> dùng mức thấp hơn để an toàn.
// Có email liên hệ thì được vào "polite pool" ổn định hơn; không có thì dùng public pool.
const userAgent = config.contactEmail
  ? `PaperFinder/1.0 (mailto:${config.contactEmail})`
  : 'PaperFinder/1.0';

const http = new HttpClient({
  userAgent,
  timeoutMs: config.requestTimeoutMs,
  maxRetries: config.maxRetries,
  cacheTtlMs: config.cacheTtlMs,
  logger,
});

// Mỗi nguồn có bộ giới hạn tốc độ riêng theo chính sách của nguồn đó.
const adapters: AdapterMap = {
  crossref: new CrossrefAdapter({ http, limiter: new Limiter(2, 400) }),
  openalex: new OpenAlexAdapter({ http, limiter: new Limiter(1, 250), apiKey: config.openAlexApiKey }),
  europepmc: new EuropePmcAdapter({ http, limiter: new Limiter(2, 250) }),
  doaj: new DoajAdapter({ http, limiter: new Limiter(1, 700) }),
  // arXiv yêu cầu tối đa 1 request mỗi 3 giây.
  arxiv: new ArxivAdapter({ http, limiter: new Limiter(1, 3100) }),
};
if (config.semanticScholarApiKey) {
  adapters.semanticscholar = new SemanticScholarAdapter({ http, limiter: new Limiter(1, 1100), apiKey: config.semanticScholarApiKey });
}

const stats = new StatsService({ filePath: config.statsFile, timezone: config.statsTimezone, retentionDays: config.statsRetentionDays, logger });
const app = createApp({
  adapters,
  config,
  logger,
  stats,
  signer: new UrlSigner(config.downloadSecret),
  downloadOptions: { maxBytes: config.downloadMaxBytes },
});
const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    crossrefPolitePool: Boolean(config.contactEmail),
    openAlexKey: Boolean(config.openAlexApiKey),
    sources: Object.keys(adapters),
    adminEnabled: Boolean(config.adminPassword),
    serveStatic: Boolean(config.staticDir),
  });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info('server_stopping', { signal });
    stats.stop(); // ghi nốt thống kê ra file
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

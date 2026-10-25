import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { LogLevel } from './logger.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Email liên hệ gửi kèm User-Agent để vào "polite pool" của Crossref (khuyến nghị, không bắt buộc). */
  CONTACT_EMAIL: z.string().email().optional(),
  /** Key OpenAlex miễn phí (tùy chọn): nâng ngân sách hằng ngày so với không key. */
  OPENALEX_API_KEY: z.string().min(1).optional(),
  /** Key Semantic Scholar (miễn phí, cần đăng ký). Không có key thì nguồn này không được bật vì bị giới hạn tốc độ rất chặt. */
  SEMANTIC_SCHOLAR_API_KEY: z.string().min(1).optional(),
  /** Danh sách origin được phép gọi API, phân tách bằng dấu phẩy. Để trống nếu cùng origin. */
  CORS_ORIGIN: z.string().optional(),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86400).default(600),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(30),
  TRUST_PROXY: z.string().optional(),
  STATIC_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

export interface AppConfig {
  port: number;
  contactEmail?: string;
  openAlexApiKey?: string;
  semanticScholarApiKey?: string;
  corsOrigins: string[];
  requestTimeoutMs: number;
  maxRetries: number;
  cacheTtlMs: number;
  rateLimitPerMinute: number;
  trustProxy?: string;
  staticDir?: string;
  logLevel: LogLevel;
}

/** Nạp file .env (nếu có) từ thư mục hiện tại hoặc thư mục cha - không ghi đè biến môi trường đã đặt. */
export function loadEnvFiles(cwd = process.cwd()): void {
  for (const candidate of [path.join(cwd, '.env'), path.join(cwd, '..', '.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

export function parseConfig(env: Record<string, string | undefined>, cwd = process.cwd()): AppConfig {
  // .env.example để trống các giá trị tùy chọn -> coi như chưa đặt.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = envSchema.parse(cleaned);

  const defaultStatic = path.resolve(cwd, '..', 'web', 'dist');
  const staticDir = parsed.STATIC_DIR
    ? path.resolve(cwd, parsed.STATIC_DIR)
    : existsSync(defaultStatic)
      ? defaultStatic
      : undefined;

  return {
    port: parsed.PORT,
    contactEmail: parsed.CONTACT_EMAIL,
    openAlexApiKey: parsed.OPENALEX_API_KEY,
    semanticScholarApiKey: parsed.SEMANTIC_SCHOLAR_API_KEY,
    corsOrigins: (parsed.CORS_ORIGIN ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    requestTimeoutMs: parsed.REQUEST_TIMEOUT_MS,
    maxRetries: parsed.MAX_RETRIES,
    cacheTtlMs: parsed.CACHE_TTL_SECONDS * 1000,
    rateLimitPerMinute: parsed.RATE_LIMIT_PER_MINUTE,
    trustProxy: parsed.TRUST_PROXY,
    staticDir,
    logLevel: parsed.LOG_LEVEL,
  };
}

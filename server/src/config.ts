import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PlanKey } from './accounts/plans.js';
import type { SepayConfig } from './accounts/sepay.js';
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
  /** Khóa ký link tải PDF. Không đặt = tạo ngẫu nhiên mỗi lần khởi động (link cũ hết hạn khi khởi động lại). */
  DOWNLOAD_SECRET: z.string().min(16, 'DOWNLOAD_SECRET cần ít nhất 16 ký tự').optional(),
  /** Dung lượng tối đa mỗi file PDF chuyển tiếp (MB). */
  DOWNLOAD_MAX_MB: z.coerce.number().int().min(1).max(500).default(100),
  /** Mật khẩu trang admin (/admin). Không đặt = trang admin và API admin bị tắt. */
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD cần ít nhất 8 ký tự').optional(),
  /** File JSON lưu thống kê sử dụng. Mặc định: ./data/stats.json (thư mục hiện tại của backend). */
  STATS_FILE: z.string().optional(),
  /** Múi giờ để chia ngày thống kê. */
  STATS_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  /** Số ngày giữ thống kê. */
  STATS_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(365),
  /** Khóa ký phiên đăng nhập. Không đặt = TẮT tài khoản: không đăng nhập, không giới hạn lượt tìm (như trước đây). */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET cần ít nhất 32 ký tự').optional(),
  /** Chuỗi kết nối PostgreSQL (vd. Neon/Supabase) để lưu tài khoản bền vững. Không đặt = lưu file JSON (mất khi Render Free khởi động lại). */
  DATABASE_URL: z.string().optional(),
  /** File JSON lưu tài khoản khi không có DATABASE_URL. */
  ACCOUNTS_FILE: z.string().optional(),
  FREE_DAILY_SEARCHES: z.coerce.number().int().min(1).max(1000).default(10),
  GUEST_DAILY_SEARCHES: z.coerce.number().int().min(0).max(1000).default(3),
  /** Giá từng gói (VND): hạng Tiêu chuẩn và Pro, mỗi hạng mua 7 ngày, 1 tháng hoặc 1 năm. Tối thiểu 2.000đ. */
  PRICE_STANDARD_WEEK: z.coerce.number().int().min(2000).max(100_000_000).default(10_000),
  PRICE_STANDARD_MONTH: z.coerce.number().int().min(2000).max(100_000_000).default(29_000),
  PRICE_STANDARD_YEAR: z.coerce.number().int().min(2000).max(100_000_000).default(119_000),
  PRICE_PRO_WEEK: z.coerce.number().int().min(2000).max(100_000_000).default(20_000),
  PRICE_PRO_MONTH: z.coerce.number().int().min(2000).max(100_000_000).default(49_000),
  PRICE_PRO_YEAR: z.coerce.number().int().min(2000).max(100_000_000).default(229_000),
  /** Khóa xác thực webhook SePay (SePay gửi header `Authorization: Apikey <khóa>`). */
  SEPAY_API_KEY: z.string().min(8, 'SEPAY_API_KEY cần ít nhất 8 ký tự').optional(),
  /** Số tài khoản ngân hàng nhận tiền, đã liên kết với SePay. */
  // Số tài khoản hoặc VA (có thể có chữ cái, vd. 96247NJ49C của BIDV).
  SEPAY_BANK_ACCOUNT: z.string().regex(/^[A-Za-z0-9]{4,30}$/, 'SEPAY_BANK_ACCOUNT chỉ gồm chữ và số, không có khoảng trắng hay dấu gạch').optional(),
  // Các số tài khoản khác cũng được nhận là tiền vào của bạn, cách nhau bằng dấu phẩy (vd. số tài khoản chính khi SEPAY_BANK_ACCOUNT là VA).
  SEPAY_ACCOUNT_ALIASES: z.string().optional(),
  /** Tên ngân hàng theo danh sách VietQR/SePay, vd. MBBank, Vietcombank, ACB. */
  SEPAY_BANK_NAME: z.string().min(2).max(40).optional(),
  /** Tên chủ tài khoản (hiển thị cho khách đối chiếu). */
  SEPAY_ACCOUNT_NAME: z.string().max(80).optional(),
  /** Tiền tố mã thanh toán, phải trùng "Cấu trúc mã thanh toán" trong SePay. */
  SEPAY_CODE_PREFIX: z.string().regex(/^[A-Za-z]{2,6}$/, 'SEPAY_CODE_PREFIX gồm 2-6 chữ cái').default('PF'),
  /** File CSV xếp hạng tạp chí tải từ scimagojr.com. Mặc định ./data/scimagojr.csv; không có file thì tính năng xếp hạng tự tắt. */
  SJR_CSV_PATH: z.string().optional(),
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
  adminPassword?: string;
  downloadSecret?: string;
  downloadMaxBytes: number;
  statsFile: string;
  statsTimezone: string;
  statsRetentionDays: number;
  sessionSecret?: string;
  databaseUrl?: string;
  accountsFile: string;
  freeDailySearches: number;
  guestDailySearches: number;
  /** Giá theo khóa gói, vd. prices['pro:month']. */
  prices: Record<PlanKey, number>;
  sepay?: SepayConfig;
  sjrCsvPath: string;
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
    adminPassword: parsed.ADMIN_PASSWORD,
    downloadSecret: parsed.DOWNLOAD_SECRET,
    downloadMaxBytes: parsed.DOWNLOAD_MAX_MB * 1024 * 1024,
    statsFile: parsed.STATS_FILE ? path.resolve(cwd, parsed.STATS_FILE) : path.resolve(cwd, 'data', 'stats.json'),
    statsTimezone: parsed.STATS_TIMEZONE,
    statsRetentionDays: parsed.STATS_RETENTION_DAYS,
    sessionSecret: parsed.SESSION_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    accountsFile: parsed.ACCOUNTS_FILE ? path.resolve(cwd, parsed.ACCOUNTS_FILE) : path.resolve(cwd, 'data', 'accounts.json'),
    freeDailySearches: parsed.FREE_DAILY_SEARCHES,
    guestDailySearches: parsed.GUEST_DAILY_SEARCHES,
    prices: {
      'standard:week': parsed.PRICE_STANDARD_WEEK,
      'standard:month': parsed.PRICE_STANDARD_MONTH,
      'standard:year': parsed.PRICE_STANDARD_YEAR,
      'pro:week': parsed.PRICE_PRO_WEEK,
      'pro:month': parsed.PRICE_PRO_MONTH,
      'pro:year': parsed.PRICE_PRO_YEAR,
    },
    // Chỉ bật thanh toán khi đủ khóa webhook, số tài khoản và tên ngân hàng.
    sepay:
      parsed.SEPAY_API_KEY && parsed.SEPAY_BANK_ACCOUNT && parsed.SEPAY_BANK_NAME
        ? {
            apiKey: parsed.SEPAY_API_KEY,
            accountNumber: parsed.SEPAY_BANK_ACCOUNT,
            accountAliases: (parsed.SEPAY_ACCOUNT_ALIASES ?? '').split(',').map((v) => v.trim()).filter(Boolean),
            bankName: parsed.SEPAY_BANK_NAME,
            accountName: parsed.SEPAY_ACCOUNT_NAME,
            codePrefix: parsed.SEPAY_CODE_PREFIX.toUpperCase(),
          }
        : undefined,
    sjrCsvPath: parsed.SJR_CSV_PATH ? path.resolve(cwd, parsed.SJR_CSV_PATH) : path.resolve(cwd, 'data', 'scimagojr.csv'),
    staticDir,
    logLevel: parsed.LOG_LEVEL,
  };
}

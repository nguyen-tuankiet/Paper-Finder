import { UpstreamError } from './errors.js';
import { Limiter, cancelled, sleep } from './limiter.js';
import { TtlCache } from './cache.js';
import { silentLogger, type Logger } from '../logger.js';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs: number;
  /** Số lần thử lại tối đa (không tính lần đầu). */
  maxRetries: number;
  baseDelayMs?: number;
  /** Nếu máy chủ yêu cầu chờ lâu hơn mức này (vd. hết ngân sách ngày) thì không chờ, báo lỗi ngay. */
  maxRetryAfterMs?: number;
  cacheTtlMs?: number;
  fetchImpl?: typeof fetch;
  sleepFn?: typeof sleep;
  logger?: Logger;
}

export interface RequestOptions {
  /** Tên nguồn, chỉ dùng cho log và thông báo lỗi. */
  source: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  limiter?: Limiter;
  timeoutMs?: number;
  maxRetries?: number;
  useCache?: boolean;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function formatWait(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes >= 90) return `khoảng ${Math.ceil(minutes / 60)} giờ`;
  if (minutes >= 2) return `khoảng ${minutes} phút`;
  return `${Math.max(1, Math.ceil(ms / 1000))} giây`;
}

/**
 * HTTP client dùng chung cho các adapter: timeout từng request, retry có giới hạn với
 * exponential backoff + jitter (chỉ cho 429, 5xx, lỗi mạng, timeout), tôn trọng Retry-After, cache có hạn.
 */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleepFn: typeof sleep;
  private readonly logger: Logger;
  private readonly cache = new TtlCache<string>(200);
  private readonly baseDelayMs: number;
  private readonly maxRetryAfterMs: number;

  constructor(private readonly options: HttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepFn = options.sleepFn ?? sleep;
    this.logger = options.logger ?? silentLogger;
    this.baseDelayMs = options.baseDelayMs ?? 600;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 15000;
  }

  async getJson<T>(url: string, request: RequestOptions): Promise<T> {
    const text = await this.getText(url, request);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new UpstreamError('bad_response', `${request.source} trả về dữ liệu không phải JSON hợp lệ.`);
    }
  }

  /** Lấy nội dung văn bản (JSON hoặc XML) với cùng cơ chế timeout, retry, cache. */
  async getText(url: string, request: RequestOptions): Promise<string> {
    const useCache = (request.useCache ?? true) && (this.options.cacheTtlMs ?? 0) > 0;
    if (useCache) {
      const hit = this.cache.get(url);
      if (hit !== undefined) return hit;
    }

    const maxRetries = request.maxRetries ?? this.options.maxRetries;
    for (let attempt = 0; ; attempt++) {
      try {
        const run = () => this.once(url, request);
        const text = request.limiter ? await request.limiter.run(run, request.signal) : await run();
        if (useCache) this.cache.set(url, text, this.options.cacheTtlMs ?? 0);
        return text;
      } catch (error) {
        if (!(error instanceof UpstreamError) || !error.retryable || attempt >= maxRetries) throw error;
        if (error.retryAfterMs !== undefined && error.retryAfterMs > this.maxRetryAfterMs) throw error;

        const backoff = Math.min(8000, this.baseDelayMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
        const delay = error.retryAfterMs !== undefined ? Math.max(error.retryAfterMs, 0) : backoff;
        this.logger.warn('upstream_retry', { source: request.source, code: error.code, status: error.status, attempt: attempt + 1, delayMs: Math.round(delay) });
        await this.sleepFn(delay, request.signal);
      }
    }
  }

  private async once(url: string, request: RequestOptions): Promise<string> {
    const timeoutMs = request.timeoutMs ?? this.options.timeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
    const label = request.source;

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json, application/atom+xml;q=0.9, */*;q=0.5', 'user-agent': this.options.userAgent, ...request.headers },
        signal,
      });
      // Đọc thân phản hồi trong cùng vùng bắt lỗi để timeout/hủy áp dụng cả lúc tải dữ liệu.
      text = await response.text();
    } catch (error) {
      if (request.signal?.aborted) throw cancelled();
      if (timeoutSignal.aborted) {
        throw new UpstreamError('timeout', `${label} không phản hồi trong ${Math.round(timeoutMs / 1000)} giây.`, { retryable: true });
      }
      this.logger.warn('upstream_network_error', { source: label, error: error instanceof Error ? error.message : String(error) });
      throw new UpstreamError('network', `Không kết nối được tới ${label}. Kiểm tra mạng của máy chủ.`, { retryable: true });
    }

    const { status } = response;
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      const wait = retryAfterMs !== undefined ? ` Vui lòng thử lại sau ${formatWait(retryAfterMs)}.` : '';
      throw new UpstreamError('rate_limited', `${label} đang giới hạn tốc độ hoặc đã hết hạn mức sử dụng.${wait}`, {
        status,
        retryAfterMs,
        retryable: true,
      });
    }
    if (status >= 500) {
      throw new UpstreamError('server_error', `${label} đang gặp sự cố (HTTP ${status}).`, { status, retryable: true });
    }
    if (status === 401 || status === 403) {
      throw new UpstreamError('auth', `${label} từ chối yêu cầu (HTTP ${status}). Kiểm tra API key hoặc chính sách truy cập.`, { status });
    }
    if (status >= 400) {
      throw new UpstreamError('client_error', `${label} từ chối yêu cầu (HTTP ${status}): ${text.slice(0, 200).replace(/\s+/g, ' ')}`, { status });
    }

    return text;
  }
}

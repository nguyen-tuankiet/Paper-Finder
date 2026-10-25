export type UpstreamErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'server_error'
  | 'client_error'
  | 'auth'
  | 'network'
  | 'cancelled'
  | 'bad_response'
  | 'internal';

/** Lỗi khi gọi API học thuật. `message` là thông báo tiếng Việt có thể hiển thị cho người dùng. */
export class UpstreamError extends Error {
  readonly code: UpstreamErrorCode;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(
    code: UpstreamErrorCode,
    message: string,
    options: { status?: number; retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'UpstreamError';
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
  }
}

export function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  return new UpstreamError('internal', 'Lỗi không xác định khi xử lý dữ liệu từ nguồn.');
}

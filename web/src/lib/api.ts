import type {
  AccountUser,
  CheckoutResponse,
  ExportFormat,
  HistoryEntry,
  LibraryItem,
  MeResponse,
  PaperRecord,
  PaidTier,
  PaymentStatusResponse,
  PlanPeriod,
  PlansResponse,
  SearchEvent,
  SearchRequest,
  SourceHealth,
  UsageReport,
} from '../../../shared/types';
import { pdfFileName, toExportPayload } from './records';

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export type ApiErrorKind = 'network' | 'http' | 'cancelled' | 'stream';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
    /** Mã lỗi của máy chủ (vd. quota_exceeded, pro_required, unauthorized). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readHttpErrorInfo(response: Response): Promise<{ message: string; code?: string }> {
  try {
    const body = (await response.json()) as { error?: string; message?: string; issues?: { message: string }[] };
    const detail = body.issues?.map((i) => i.message).join(' ');
    const message = [body.message, detail].filter(Boolean).join(' ') || `Máy chủ trả về lỗi HTTP ${response.status}.`;
    return { message, code: body.error };
  } catch {
    return { message: `Máy chủ trả về lỗi HTTP ${response.status}.` };
  }
}

async function readHttpError(response: Response): Promise<string> {
  return (await readHttpErrorInfo(response)).message;
}

async function httpError(response: Response): Promise<ApiError> {
  const { message, code } = await readHttpErrorInfo(response);
  return new ApiError(message, 'http', response.status, code);
}

async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, init);
  } catch {
    if (init.signal?.aborted) throw new ApiError('Đã hủy.', 'cancelled');
    throw new ApiError('Không kết nối được tới máy chủ PaperFinder. Kiểm tra mạng hoặc xem backend đã chạy chưa.', 'network');
  }
}

/** Gọi /api/search và đọc luồng NDJSON, báo từng sự kiện qua `onEvent`. */
export async function streamSearch(body: SearchRequest, signal: AbortSignal, onEvent: (event: SearchEvent) => void): Promise<void> {
  const response = await request('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw await httpError(response);
  if (!response.body) throw new ApiError('Trình duyệt không hỗ trợ đọc dữ liệu dạng luồng.', 'stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let gotFinalEvent = false;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as SearchEvent;
    if (event.type === 'result' || event.type === 'error') gotFinalEvent = true;
    onEvent(event);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    handle(buffer);
  } catch (error) {
    if (signal.aborted) throw new ApiError('Đã hủy.', 'cancelled');
    throw error instanceof ApiError ? error : new ApiError('Kết nối bị gián đoạn khi đang nhận kết quả.', 'stream');
  }
  if (!gotFinalEvent) {
    if (signal.aborted) throw new ApiError('Đã hủy.', 'cancelled');
    throw new ApiError('Kết nối bị gián đoạn trước khi nhận đủ kết quả.', 'stream');
  }
}

export async function fetchSourceHealth(signal?: AbortSignal): Promise<SourceHealth[]> {
  const response = await request('/api/sources', { signal });
  if (!response.ok) throw new ApiError(await readHttpError(response), 'http');
  return (await response.json()) as SourceHealth[];
}

/** Lấy báo cáo sử dụng cho trang admin. Ném ApiError có `status` 401 (sai mật khẩu), 404 (chưa bật), 429 (bị chặn). */
export async function fetchUsageReport(password: string, days: number, signal?: AbortSignal): Promise<UsageReport> {
  const response = await request(`/api/admin/stats?days=${days}`, { headers: { authorization: `Bearer ${password}` }, signal });
  if (!response.ok) throw new ApiError(await readHttpError(response), 'http', response.status);
  return (await response.json()) as UsageReport;
}

/** Yêu cầu backend tạo file rồi tải về bằng tên file `fileName`. Ném ApiError có `code` 'unauthorized' / 'pro_required' với BibTeX/RIS. */
export interface ExportOutcome {
  /** Gói hiện tại chỉ cho xuất một phần: số dòng đã xuất và tổng số dòng. */
  truncated?: { rows: number; total: number };
}

export async function exportRecords(format: ExportFormat, records: PaperRecord[], fileName: string): Promise<ExportOutcome> {
  const response = await request('/api/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format, records: toExportPayload(records) }),
  });
  if (!response.ok) throw await httpError(response);
  saveBlob(await response.blob(), fileName);
  const cut = /^(\d+)\/(\d+)$/.exec(response.headers.get('x-export-truncated') ?? '');
  return cut ? { truncated: { rows: Number(cut[1]), total: Number(cut[2]) } } : {};
}

// ---------- Tài khoản, gói Pro, thanh toán ----------

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, {
    ...init,
    headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (!response.ok) throw await httpError(response);
  return (await response.json()) as T;
}

const post = <T>(path: string, body: unknown) => json<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const fetchMe = (signal?: AbortSignal) => json<MeResponse>('/api/me', { signal });
export const fetchPlans = (signal?: AbortSignal) => json<PlansResponse>('/api/plans', { signal });
export const registerAccount = (email: string, password: string) => post<{ user: AccountUser }>('/api/auth/register', { email, password });
export const loginAccount = (email: string, password: string) => post<{ user: AccountUser }>('/api/auth/login', { email, password });
export const logoutAccount = () => post<{ ok: true }>('/api/auth/logout', {});
export const changePassword = (currentPassword: string, newPassword: string) => post<{ ok: true }>('/api/auth/change-password', { currentPassword, newPassword });
export const startCheckout = (tier: PaidTier, period: PlanPeriod) => post<CheckoutResponse>('/api/billing/checkout', { tier, period });
export const confirmPayment = (orderCode: number) => post<PaymentStatusResponse>('/api/billing/confirm', { orderCode });

export const fetchLibrary = () => json<LibraryItem[]>('/api/library');
export const saveToLibrary = (record: PaperRecord, folder: string) => post<{ status: 'saved' | 'exists'; key: string }>('/api/library', { record, folder });
export const removeFromLibrary = (key: string) => json<{ ok: true }>(`/api/library/${encodeURIComponent(key)}`, { method: 'DELETE' });
export const fetchHistory = () => json<HistoryEntry[]>('/api/history');
export const clearHistory = () => json<{ ok: true }>('/api/history', { method: 'DELETE' });

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Tải PDF miễn phí về máy. Link PDF của nhà xuất bản ở tên miền khác nên trình duyệt chỉ mở trong trình xem PDF,
 * vì vậy nhờ máy chủ chuyển tiếp file (chỉ với link do máy chủ đã ký trong kết quả tìm kiếm).
 */
export async function downloadPdf(record: PaperRecord): Promise<void> {
  const query = new URLSearchParams({ url: record.oaPdfUrl, sig: record.oaPdfSig ?? '', name: record.title || record.doi || 'paper' });
  const response = await request(`/api/download?${query.toString()}`, {});
  if (!response.ok) throw new ApiError(await readHttpError(response), 'http', response.status);
  saveBlob(await response.blob(), pdfFileName(record));
}

import type { SearchRequest, SourceId } from '../../../shared/types';
import { SOURCE_IDS } from '../../../shared/types';

/** Khóa phiên trình duyệt dùng chuyển một lần tìm từ trang Lịch sử về trang tìm kiếm để chạy lại. */
export const RERUN_KEY = 'pf_rerun';

/** Đọc (không xóa) yêu cầu tìm đang chờ chạy lại; trả null nếu không có hoặc dữ liệu không hợp lệ. */
export function peekRerun(): SearchRequest | null {
  try {
    const raw = sessionStorage.getItem(RERUN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SearchRequest> | null;
    if (!value || !Array.isArray(value.keywords) || value.keywords.length === 0 || !value.keywords.every((k) => typeof k === 'string')) return null;
    if (!Array.isArray(value.sources) || value.sources.length === 0 || !value.sources.every((s): s is SourceId => (SOURCE_IDS as readonly string[]).includes(s))) return null;
    if (typeof value.maxResults !== 'number' || typeof value.onlyWithDoi !== 'boolean') return null;
    return value as SearchRequest;
  } catch {
    return null;
  }
}

export function clearRerun(): void {
  try {
    sessionStorage.removeItem(RERUN_KEY);
  } catch {
    /* bỏ qua */
  }
}

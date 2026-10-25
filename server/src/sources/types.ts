import type { PaperRecord, SourceId } from '../../../shared/types.js';
import type { UpstreamError } from '../lib/errors.js';

export interface AdapterSearchParams {
  keyword: string;
  /** Số bản ghi tối đa cho từ khóa này. */
  maxResults: number;
  yearFrom?: number;
  yearTo?: number;
  onlyWithDoi: boolean;
  signal?: AbortSignal;
  /** Gọi sau mỗi trang: `fetched` là số bản ghi đã lấy, `target` là số cần lấy (đã tính tổng số kết quả của nguồn). */
  onProgress?: (fetched: number, target: number) => void;
}

/**
 * Adapter không ném lỗi do API: nếu trang giữa chừng lỗi, trả về các bản ghi đã lấy được
 * kèm `error` để tầng trên đánh dấu nguồn là "một phần".
 */
export interface AdapterResult {
  records: PaperRecord[];
  error?: UpstreamError;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly label: string;
  search(params: AdapterSearchParams): Promise<AdapterResult>;
  /** Kiểm tra nhanh nguồn còn hoạt động; ném UpstreamError nếu lỗi. */
  ping(signal?: AbortSignal): Promise<void>;
}

// Kiểu dữ liệu dùng chung giữa backend và frontend. Chỉ chứa type (không có code chạy).

export const SOURCE_IDS = ['crossref', 'openalex', 'europepmc', 'doaj', 'arxiv', 'semanticscholar'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const MAX_RESULT_OPTIONS = [20, 50, 100, 200, 500] as const;
export type MaxResults = (typeof MAX_RESULT_OPTIONS)[number];

export interface Author {
  /** Tên hiển thị, theo thứ tự "Tên Họ" như nguồn cung cấp. */
  name: string;
  given?: string;
  family?: string;
  orcid?: string;
}

/** Dấu vết của từng bản ghi gốc đã được gộp vào một bài báo. */
export interface SourceRef {
  source: SourceId;
  /** ID của bản ghi trong nguồn (DOI với Crossref, W-id với OpenAlex). */
  sourceId: string;
  url: string;
}

export interface PaperRecord {
  /** ID ổn định trong phạm vi một lần tìm kiếm. */
  id: string;
  title: string;
  /** DOI đã chuẩn hóa (chữ thường, không có tiền tố URL). Rỗng nếu nguồn không cung cấp DOI hợp lệ. */
  doi: string;
  authors: Author[];
  publicationYear: number | null;
  journal: string;
  publisher: string;
  /** Loại tài liệu đúng như nguồn cung cấp (vd. journal-article, article, preprint). */
  documentType: string;
  /** Nguồn cho biết đây là preprint / posted-content. */
  isPreprint: boolean;
  abstract: string;
  /** Tập (volume) của tạp chí/sách; rỗng nếu nguồn không có. */
  volume?: string;
  /** Số (issue) của tạp chí. */
  issue?: string;
  /** Trang, dạng "313-325" hoặc "313". */
  pages?: string;
  /** Nơi xuất bản (sách) hoặc nơi và thời gian tổ chức (hội nghị). */
  place?: string;
  /** Có ít nhất một nguồn cho biết bài có bản đọc miễn phí hợp pháp (truy cập mở). */
  isOpenAccess: boolean;
  /** Trạng thái truy cập mở theo nguồn (vd. gold, green, hybrid, bronze, closed); rỗng nếu nguồn không nêu. */
  oaStatus: string;
  /** Trang đọc toàn văn miễn phí (HTML hoặc trang chứa PDF). Rỗng nếu không có. */
  oaUrl: string;
  /** Link trực tiếp tới file PDF miễn phí. Rỗng nếu nguồn không cung cấp. */
  oaPdfUrl: string;
  /** Chữ ký do máy chủ cấp cho `oaPdfUrl`, dùng để xin máy chủ chuyển tiếp file PDF (/api/download). */
  oaPdfSig?: string;
  /** Giấy phép của bản mở (vd. cc-by). Rỗng nếu nguồn không nêu. */
  oaLicense: string;
  /** Tất cả nguồn đã tìm thấy bài báo này. */
  sources: SourceId[];
  sourceRefs: SourceRef[];
  originalUrl: string;
  /** Tất cả từ khóa truy vấn tìm ra bài báo này. */
  queryKeywords: string[];
  retrievedAt: string;
}

export interface SearchRequest {
  keywords: string[];
  sources: SourceId[];
  /** Số bản ghi tối đa cho MỖI từ khóa trên MỖI nguồn. */
  maxResults: MaxResults;
  yearFrom?: number;
  yearTo?: number;
  onlyWithDoi: boolean;
}

export type SourceState = 'ok' | 'partial' | 'error';

export interface SourceErrorInfo {
  keyword: string;
  code: string;
  message: string;
}

export interface SourceStatus {
  source: SourceId;
  label: string;
  state: SourceState;
  /** Số bản ghi thô đã lấy từ nguồn (trước khi loại trùng). */
  fetched: number;
  errors: SourceErrorInfo[];
}

export interface SearchStats {
  total: number;
  withDoi: number;
  withoutDoi: number;
  duplicatesRemoved: number;
  sourcesQueried: number;
  sourcesSucceeded: number;
}

export interface SuspectedDuplicate {
  recordIds: [string, string];
  reason: string;
}

export interface SearchResult {
  records: PaperRecord[];
  stats: SearchStats;
  sources: SourceStatus[];
  suspectedDuplicates: SuspectedDuplicate[];
  request: SearchRequest;
  finishedAt: string;
}

export type SearchEvent =
  | { type: 'progress'; source: SourceId; keyword: string; fetched: number; target: number; done: boolean }
  | { type: 'ping' }
  | { type: 'result'; result: SearchResult }
  | { type: 'error'; message: string };

export interface SourceHealth {
  source: SourceId;
  label: string;
  ok: boolean;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

export type ExportFormat = 'xlsx' | 'csv';

// ---------- Thống kê sử dụng (trang admin) ----------

export interface UsageDay {
  /** Ngày theo múi giờ cấu hình, dạng YYYY-MM-DD. */
  date: string;
  visitors: number;
  searches: number;
  searchesCompleted: number;
  searchesFailed: number;
  searchesCancelled: number;
  exports: number;
  results: number;
}

export interface UsageWindow {
  /** Số người dùng khác nhau (mã băm IP + trình duyệt) trong khoảng thời gian. */
  visitors: number;
  searches: number;
  exports: number;
}

export interface UsageSourceRow {
  source: SourceId;
  label: string;
  /** Số lần nguồn được chọn trong một lượt tìm. */
  used: number;
  /** Số lần nguồn lỗi hoàn toàn. */
  failed: number;
  /** Số lần nguồn chỉ lấy được một phần. */
  partial: number;
}

export interface UsageReport {
  generatedAt: string;
  timezone: string;
  /** Thời điểm bắt đầu ghi thống kê. */
  trackingSince: string;
  /** Có ghi ra file để giữ lại sau khi khởi động lại hay không. */
  persistent: boolean;
  retentionDays: number;
  today: UsageWindow;
  last7Days: UsageWindow;
  last30Days: UsageWindow;
  /** Toàn bộ dữ liệu đang lưu (trong thời hạn lưu trữ). */
  allTime: UsageWindow & { completed: number; failed: number; cancelled: number; averageResultsPerSearch: number };
  daily: UsageDay[];
  sources: UsageSourceRow[];
}

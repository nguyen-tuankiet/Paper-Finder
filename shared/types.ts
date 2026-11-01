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
  /** Số lần được trích dẫn theo nguồn (lấy số lớn nhất giữa các nguồn vì mỗi nguồn đếm khác nhau). Không có = nguồn không cung cấp. */
  citedByCount?: number;
  /** Bài đã bị rút lại theo Crossref/Retraction Watch hoặc OpenAlex. Chỉ có khi true. */
  isRetracted?: boolean;
  /** ISSN của tạp chí (dạng chuẩn hóa 8 ký tự, không gạch nối), dùng để tra xếp hạng tạp chí. */
  issn?: string[];
  /** Hạng phần tư SJR của tạp chí (Q1 cao nhất) và chỉ số SJR. Chỉ có khi máy chủ đã nạp dữ liệu SCImago và hạng người dùng được xem. */
  journalQuartile?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  journalSjr?: number;
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

export type ExportFormat = 'xlsx' | 'csv' | 'bibtex' | 'ris';

/** Định dạng nhập vào Zotero, Mendeley, EndNote; chỉ hạng Pro mới xuất được. */
export const REFERENCE_EXPORT_FORMATS: readonly ExportFormat[] = ['bibtex', 'ris'];

// ---------- Tài khoản, hạng và thanh toán ----------

/** Khách (chưa đăng nhập) < miễn phí (đã đăng nhập) < Tiêu chuẩn < Pro. */
export type Tier = 'guest' | 'free' | 'standard' | 'pro';
/** Hạng có thể mua. */
export type PaidTier = 'standard' | 'pro';
export const PAID_TIERS: readonly PaidTier[] = ['standard', 'pro'];

export type PlanPeriod = 'week' | 'month' | 'year';
export const PLAN_PERIODS: readonly PlanPeriod[] = ['week', 'month', 'year'];

/** Quyền lợi của một hạng. Máy chủ là nơi quyết định; giao diện chỉ hiển thị và khóa nút theo đây. */
export interface Entitlements {
  tier: Tier;
  /** Tên hiển thị (Khách, Miễn phí, Tiêu chuẩn, Pro). */
  label: string;
  /** Số lượt tìm mỗi ngày (mỗi từ khóa một lượt). null = không giới hạn. */
  dailySearches: number | null;
  /** Số kết quả tối đa cho mỗi từ khóa trên mỗi nguồn. */
  maxResultsPerSource: MaxResults;
  /** Số dòng tối đa mỗi file Excel/CSV: 0 = không xuất được, null = không giới hạn. */
  exportRows: number | null;
  /** Xuất BibTeX/RIS. */
  referenceExport: boolean;
  /** Xuất danh sách tài liệu tham khảo ra file Word (.docx). */
  wordExport: boolean;
  /** Số DOI tối đa mỗi lần dán để chuẩn hóa thành tài liệu tham khảo (0 = không có tính năng). */
  doiLookupMax: number;
  /** Sắp xếp và lọc kết quả theo số trích dẫn. */
  citationTools: boolean;
  /** Hiện xếp hạng tạp chí Q1–Q4 và lọc theo hạng (cần máy chủ đã nạp dữ liệu SCImago). */
  journalRank: boolean;
  /** Số bài tối đa trong thư viện cá nhân (0 = không có thư viện). */
  libraryMax: number;
  /** Số lần tìm gần nhất được lưu trong lịch sử (0 = không lưu). */
  historyMax: number;
}

export interface PlanOption {
  tier: PaidTier;
  period: PlanPeriod;
  /** Tên thời hạn: "7 ngày", "1 tháng", "1 năm". */
  label: string;
  days: number;
  priceVnd: number;
}

export interface PlansResponse {
  /** Máy chủ có bật tài khoản hay không (cần SESSION_SECRET). Tắt = không giới hạn gì như trước. */
  accountsEnabled: boolean;
  /** Đã cấu hình nhận thanh toán SePay (chuyển khoản QR) hay chưa. */
  billingEnabled: boolean;
  /** Quyền lợi của cả bốn hạng, để giao diện hiển thị bảng so sánh. */
  tiers: Entitlements[];
  plans: PlanOption[];
  /** Máy chủ đã nạp dữ liệu xếp hạng tạp chí (nếu chưa thì không quảng cáo tính năng này). */
  journalRankAvailable: boolean;
}

export interface QuotaInfo {
  /** null = không giới hạn (hạng trả phí hoặc tính năng tài khoản đang tắt). */
  limit: number | null;
  used: number;
  remaining: number | null;
  /** Thời điểm đặt lại lượt tìm (đầu ngày kế tiếp theo múi giờ máy chủ). */
  resetsAt: string | null;
}

export interface AccountUser {
  email: string;
  /** Hạng đang hiệu lực: free, standard hoặc pro. */
  tier: Exclude<Tier, 'guest'>;
  /** Hạn của từng hạng (ISO) hoặc null nếu chưa từng mua. Hạng Tiêu chuẩn tạm dừng đếm khi Pro đang hiệu lực. */
  standardUntil: string | null;
  proUntil: string | null;
  createdAt: string;
}

export interface MeResponse {
  accountsEnabled: boolean;
  /** Máy chủ có gửi được email đặt lại mật khẩu hay không (cần cấu hình SMTP). */
  passwordResetEnabled: boolean;
  user: AccountUser | null;
  /** Hạng hiện tại (guest khi chưa đăng nhập). */
  tier: Tier;
  entitlements: Entitlements;
  quota: QuotaInfo;
}

export interface HistoryEntry {
  id: string;
  at: string;
  request: SearchRequest;
  total: number;
}

export interface LibraryItem {
  /** Khóa duy nhất của bài trong thư viện (DOI, hoặc mã băm tiêu đề khi không có DOI). */
  key: string;
  folder: string;
  savedAt: string;
  record: PaperRecord;
}

export interface CheckoutRequest {
  tier: PaidTier;
  period: PlanPeriod;
}

/** Hướng dẫn chuyển khoản cho một đơn: khách quét QR hoặc chuyển đúng số tiền, đúng nội dung. */
export interface CheckoutResponse {
  orderCode: number;
  amount: number;
  /** Nội dung chuyển khoản bắt buộc (chứa mã đơn). */
  memo: string;
  bankName: string;
  accountNumber: string;
  accountName?: string;
  /** Ảnh QR VietQR đã có sẵn số tiền và nội dung. */
  qrUrl: string;
  /** Hết hạn hiển thị (ISO); tiền về muộn vẫn được kích hoạt. */
  expiresAt: string;
}

export interface PaymentStatusResponse {
  status: 'paid' | 'pending' | 'cancelled' | 'unknown';
  user: AccountUser | null;
}

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
  /** Có lưu bền để giữ lại sau khi khởi động lại hay không (cơ sở dữ liệu hoặc file). */
  persistent: boolean;
  /** Nơi lưu thống kê: cơ sở dữ liệu (bền), file trên máy chủ (mất nếu ổ đĩa tạm) hoặc chỉ bộ nhớ. */
  storage: 'database' | 'file' | 'memory';
  retentionDays: number;
  today: UsageWindow;
  last7Days: UsageWindow;
  last30Days: UsageWindow;
  /** Toàn bộ dữ liệu đang lưu (trong thời hạn lưu trữ). */
  allTime: UsageWindow & { completed: number; failed: number; cancelled: number; averageResultsPerSearch: number };
  daily: UsageDay[];
  sources: UsageSourceRow[];
}

// ---------- Doanh thu (trang admin) ----------

export type AdminOrderStatus = 'pending' | 'paid' | 'cancelled';

export interface RevenueWindow {
  revenueVnd: number;
  orders: number;
}

export interface RevenueDay extends RevenueWindow {
  /** Ngày theo múi giờ cấu hình, dạng YYYY-MM-DD. */
  date: string;
}

export interface RevenuePlanRow extends RevenueWindow {
  tier: PaidTier;
  period: PlanPeriod;
}

export interface AdminOrder {
  orderCode: number;
  /** Email tài khoản đã đặt đơn (null nếu tài khoản đã bị xóa). */
  email: string | null;
  plan: string;
  amount: number;
  status: AdminOrderStatus;
  createdAt: string;
  paidAt: string | null;
  /** Mã giao dịch ngân hàng/SePay đã thanh toán đơn, để đối soát. */
  paymentRef: string | null;
}

export interface RevenueReport {
  generatedAt: string;
  timezone: string;
  today: RevenueWindow;
  last7Days: RevenueWindow;
  last30Days: RevenueWindow;
  /** Từ ngày 1 của tháng hiện tại. */
  thisMonth: RevenueWindow;
  allTime: RevenueWindow;
  /** Giá trị trung bình mỗi đơn đã thanh toán (0 nếu chưa có). */
  averageOrderVnd: number;
  users: number;
  activeStandard: number;
  activePro: number;
  /** Số tài khoản đã từng thanh toán ít nhất một đơn. */
  payingUsers: number;
  /** Số tài khoản đã thanh toán từ hai đơn trở lên. */
  repeatBuyers: number;
  /** Tỷ lệ tài khoản từng trả tiền trên tổng tài khoản (%), một chữ số thập phân. */
  conversionPercent: number;
  /** Đơn tạo trong 30 ngày gần nhất: bao nhiêu đã trả, còn chờ (dưới 24 giờ), bỏ dở/quá hạn. */
  funnel: { created: number; paid: number; pending: number; abandoned: number };
  daily: RevenueDay[];
  byPlan: RevenuePlanRow[];
  recentOrders: AdminOrder[];
}

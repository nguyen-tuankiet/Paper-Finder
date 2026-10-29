import type { HistoryEntry, LibraryItem, PaidTier } from '../../../shared/types.js';
import type { PlanKey } from './plans.js';

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  /** Tăng khi đổi mật khẩu để vô hiệu mọi phiên đăng nhập cũ. */
  sessionVersion: number;
  /** ISO. null = chưa từng mua hạng đó. Xem `tierOf` / `applyPurchase` trong plans.ts. */
  standardUntil: string | null;
  proUntil: string | null;
  createdAt: string;
}

export type OrderStatus = 'pending' | 'paid' | 'cancelled';

export interface OrderRow {
  /** Mã đơn 9 chữ số, nằm trong nội dung chuyển khoản (số nguyên dương, duy nhất). */
  orderCode: number;
  userId: string;
  /** Hạng và thời hạn đã mua, vd. "pro:month". */
  plan: PlanKey;
  amount: number;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  /** Mã giao dịch ngân hàng/SePay đã dùng để thanh toán đơn (đối soát), vd. sepay:12345. */
  paymentRef: string | null;
}

export type SaveToLibraryResult = 'saved' | 'exists' | 'full';

export interface AccountCounts {
  users: number;
  activeStandard: number;
  activePro: number;
  paidOrders: number;
  revenueVnd: number;
}

/**
 * Kho dữ liệu tài khoản. Có hai cách cài đặt: bộ nhớ + file JSON (mặc định, mất dữ liệu khi máy chủ không có ổ đĩa bền)
 * và PostgreSQL (khuyến nghị khi chạy thật). Mọi thao tác đều bất đồng bộ để hai bản dùng chung giao diện.
 */
export interface AccountStore {
  readonly kind: 'memory' | 'file' | 'postgres';
  /** Trả null nếu email đã tồn tại. */
  createUser(email: string, passwordHash: string): Promise<UserRow | null>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  /** Đổi mật khẩu và tăng sessionVersion. */
  setPassword(id: string, passwordHash: string): Promise<void>;
  /** Cộng (hoặc trừ, khi delta âm) lượt tìm trong ngày; trả về tổng mới (không bao giờ âm). */
  addUsage(userId: string, day: string, delta: number): Promise<number>;
  getUsage(userId: string, day: string): Promise<number>;
  /** Cộng `days` ngày cho hạng `tier` theo quy tắc cộng dồn của `applyPurchase`. */
  grantPlan(userId: string, tier: PaidTier, days: number, now: Date): Promise<UserRow | null>;
  createOrder(order: OrderRow): Promise<void>;
  getOrder(orderCode: number): Promise<OrderRow | null>;
  setOrderStatus(orderCode: number, status: 'pending' | 'cancelled'): Promise<void>;
  /**
   * Đánh dấu đơn đã thanh toán và cộng thời hạn MỘT LẦN DUY NHẤT dù được gọi nhiều lần (webhook + trang quay lại).
   * Trả `activated: false` nếu đơn đã được xử lý trước đó.
   */
  settleOrder(orderCode: number, now: Date, paymentRef?: string): Promise<{ order: OrderRow; user: UserRow; activated: boolean } | null>;
  counts(now: Date): Promise<AccountCounts>;

  listLibrary(userId: string): Promise<LibraryItem[]>;
  saveToLibrary(userId: string, item: LibraryItem, maxItems: number): Promise<SaveToLibraryResult>;
  removeFromLibrary(userId: string, key: string): Promise<boolean>;

  listHistory(userId: string): Promise<HistoryEntry[]>;
  addHistory(userId: string, entry: HistoryEntry, maxEntries: number): Promise<void>;
  clearHistory(userId: string): Promise<void>;

  close(): Promise<void>;
}

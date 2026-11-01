import { randomInt } from 'node:crypto';
import { PAID_TIERS, PLAN_PERIODS, type CheckoutResponse, type PaidTier, type PaymentStatusResponse, type PlanOption, type PlanPeriod } from '../../../shared/types.js';
import { PERIOD_DAYS, PERIOD_LABEL, parsePlanKey, planKey, type PlanKey } from './plans.js';
import { isOurAccount, memoFor, qrUrl, extractOrderCode, type SepayConfig, type SepayTransaction } from './sepay.js';
import type { AccountStore, OrderRow, UserRow } from './types.js';

/** Đơn chưa thanh toán được coi là hết hạn sau chừng này (chỉ để hiển thị; tiền về muộn vẫn được kích hoạt). */
const ORDER_TTL_MS = 24 * 60 * 60 * 1000;

export interface BillingOptions {
  store: AccountStore;
  /** Không có = chưa cấu hình thanh toán (vẫn có thể cấp gói thủ công qua trang admin). */
  sepay?: SepayConfig;
  /** Giá theo khóa gói, vd. prices['pro:month']. */
  prices: Record<PlanKey, number>;
  now?: () => Date;
}

export class BillingError extends Error {}

/** Kết quả xử lý một giao dịch SePay, để ghi log và kiểm thử. */
export type WebhookOutcome =
  | { result: 'activated'; orderCode: number }
  | { result: 'duplicate'; orderCode: number }
  | { result: 'ignored' | 'unmatched' }
  | { result: 'underpaid' | 'wrong_account'; orderCode: number };

export class BillingService {
  private readonly now: () => Date;

  constructor(private readonly options: BillingOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return Boolean(this.options.sepay);
  }

  /** Mọi gói có thể mua: mỗi hạng trả phí × mỗi thời hạn. */
  plans(): PlanOption[] {
    return PAID_TIERS.flatMap((tier) =>
      PLAN_PERIODS.map((period) => ({ tier, period, label: PERIOD_LABEL[period], days: PERIOD_DAYS[period], priceVnd: this.options.prices[planKey(tier, period)] })),
    );
  }

  /** Mã đơn ngắn 9 chữ số (đủ gọn để khách gõ trong nội dung chuyển khoản), kiểm tra không trùng. */
  private async newOrderCode(): Promise<number> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = randomInt(100_000_000, 1_000_000_000);
      if (!(await this.options.store.getOrder(code))) return code;
    }
    throw new BillingError('Không tạo được mã đơn. Vui lòng thử lại.');
  }

  /** Tạo đơn chờ thanh toán và trả hướng dẫn chuyển khoản (số tài khoản, số tiền, nội dung, mã QR). */
  async checkout(user: UserRow, tier: PaidTier, period: PlanPeriod): Promise<CheckoutResponse> {
    const { sepay, store } = this.options;
    if (!sepay) throw new BillingError('Chưa cấu hình thanh toán.');
    const plan = planKey(tier, period);
    const amount = this.options.prices[plan];
    if (!amount) throw new BillingError('Gói không hợp lệ.');

    const orderCode = await this.newOrderCode();
    const now = this.now();
    const order: OrderRow = { orderCode, userId: user.id, plan, amount, status: 'pending', createdAt: now.toISOString(), paidAt: null, paymentRef: null };
    await store.createOrder(order);
    const memo = memoFor(sepay.codePrefix, orderCode);
    return {
      orderCode,
      amount,
      memo,
      bankName: sepay.bankName,
      accountNumber: sepay.accountNumber,
      accountName: sepay.accountName,
      qrUrl: qrUrl(sepay, amount, memo),
      expiresAt: new Date(now.getTime() + ORDER_TTL_MS).toISOString(),
    };
  }

  /** Trạng thái đơn cho trang thanh toán hỏi định kỳ. Chỉ đọc từ kho (webhook mới là nơi kích hoạt); chỉ chủ đơn xem được. */
  async status(orderCode: number, userId: string): Promise<{ status: PaymentStatusResponse['status']; user: UserRow | null }> {
    const order = await this.options.store.getOrder(orderCode);
    if (!order || order.userId !== userId) return { status: 'unknown', user: null };
    const user = await this.options.store.getUserById(order.userId);
    if (order.status === 'paid') return { status: 'paid', user };
    // Quá hạn hiển thị thì báo hết hạn (nhưng nếu tiền về muộn, webhook vẫn kích hoạt và lần hỏi sau sẽ là paid).
    const expired = this.now().getTime() - new Date(order.createdAt).getTime() > ORDER_TTL_MS;
    return { status: order.status === 'cancelled' || expired ? 'cancelled' : 'pending', user: null };
  }

  /**
   * Xử lý một giao dịch tiền vào do SePay báo. Kích hoạt khi: là tiền vào, nội dung có mã đơn hợp lệ, đúng tài khoản nhận
   * và số tiền không thấp hơn giá gói. Kích hoạt đúng một lần cho mỗi đơn dù SePay gửi lặp (thử lại khi lỗi mạng).
   * Chuyển thiếu tiền thì chưa kích hoạt (cần xử lý tay); chuyển dư vẫn kích hoạt.
   */
  async handleTransaction(tx: SepayTransaction): Promise<WebhookOutcome> {
    const { sepay, store } = this.options;
    if (!sepay || tx.direction !== 'in') return { result: 'ignored' };

    const orderCode = extractOrderCode(sepay.codePrefix, { code: tx.code, content: tx.content });
    if (orderCode === null) return { result: 'unmatched' };
    const order = await store.getOrder(orderCode);
    if (!order || !parsePlanKey(order.plan)) return { result: 'unmatched' };

    if (!isOurAccount(sepay, tx)) return { result: 'wrong_account', orderCode };
    if (order.status === 'paid') return { result: 'duplicate', orderCode };
    if (tx.amount < order.amount) return { result: 'underpaid', orderCode };

    const settled = await store.settleOrder(orderCode, this.now(), `sepay:${tx.id}`);
    if (!settled) return { result: 'unmatched' };
    return settled.activated ? { result: 'activated', orderCode } : { result: 'duplicate', orderCode };
  }
}

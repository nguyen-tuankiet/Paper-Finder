import { randomInt } from 'node:crypto';
import { PAID_TIERS, PLAN_PERIODS, type PaidTier, type PaymentStatusResponse, type PlanOption, type PlanPeriod } from '../../../shared/types.js';
import { PERIOD_DAYS, PERIOD_LABEL, parsePlanKey, planKey, type PlanKey } from './plans.js';
import { PayOsClient, PayOsError } from './payos.js';
import type { AccountStore, OrderRow, UserRow } from './types.js';

export interface BillingOptions {
  store: AccountStore;
  /** Không có = chưa cấu hình thanh toán (vẫn có thể cấp gói thủ công qua trang admin). */
  payos?: PayOsClient;
  publicBaseUrl?: string;
  /** Giá theo khóa gói, vd. prices['pro:month']. */
  prices: Record<PlanKey, number>;
  now?: () => Date;
}

/** Nội dung chuyển khoản hiển thị cho khách: PayOS giới hạn 25 ký tự và nên không dấu. */
const DESCRIPTION: Record<PaidTier, string> = { standard: 'PF Tieu chuan', pro: 'PF Pro' };
const PERIOD_ASCII: Record<PlanPeriod, string> = { week: '7 ngay', month: '1 thang', year: '1 nam' };

export class BillingService {
  private readonly now: () => Date;

  constructor(private readonly options: BillingOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return Boolean(this.options.payos && this.options.publicBaseUrl);
  }

  /** Mọi gói có thể mua: mỗi hạng trả phí × mỗi thời hạn. */
  plans(): PlanOption[] {
    return PAID_TIERS.flatMap((tier) =>
      PLAN_PERIODS.map((period) => ({ tier, period, label: PERIOD_LABEL[period], days: PERIOD_DAYS[period], priceVnd: this.options.prices[planKey(tier, period)] })),
    );
  }

  /** Tạo đơn chờ thanh toán và link thanh toán PayOS. */
  async checkout(user: UserRow, tier: PaidTier, period: PlanPeriod): Promise<{ checkoutUrl: string; orderCode: number }> {
    const { payos, publicBaseUrl, store } = this.options;
    if (!payos || !publicBaseUrl) throw new PayOsError('Chưa cấu hình cổng thanh toán.');
    const plan = planKey(tier, period);
    const amount = this.options.prices[plan];
    if (!amount) throw new PayOsError('Gói không hợp lệ.');

    // Mã đơn: số nguyên dương duy nhất (PayOS cho phép tới 2^53-1); mili-giây * 1000 + ngẫu nhiên.
    const orderCode = this.now().getTime() * 1000 + randomInt(0, 1000);
    const order: OrderRow = { orderCode, userId: user.id, plan, amount, status: 'pending', createdAt: this.now().toISOString(), paidAt: null };
    await store.createOrder(order);
    try {
      const { checkoutUrl } = await payos.createPaymentLink({
        orderCode,
        amount,
        description: `${DESCRIPTION[tier]} ${PERIOD_ASCII[period]}`,
        returnUrl: `${publicBaseUrl}/?billing=return`,
        cancelUrl: `${publicBaseUrl}/?billing=cancel`,
      });
      return { checkoutUrl, orderCode };
    } catch (error) {
      await store.setOrderStatus(orderCode, 'cancelled');
      throw error;
    }
  }

  /**
   * Hỏi PayOS trạng thái đơn và kích hoạt gói nếu đã trả đủ tiền. An toàn khi gọi lặp (webhook + trang quay lại):
   * thời hạn chỉ được cộng một lần cho mỗi đơn. `requireUserId`: chỉ cho người sở hữu đơn kiểm tra.
   */
  async refresh(orderCode: number, requireUserId?: string): Promise<{ status: PaymentStatusResponse['status']; user: UserRow | null }> {
    const { store, payos } = this.options;
    const order = await store.getOrder(orderCode);
    if (!order || (requireUserId && order.userId !== requireUserId)) return { status: 'unknown', user: null };
    if (order.status === 'paid') return { status: 'paid', user: await store.getUserById(order.userId) };
    if (!payos || !parsePlanKey(order.plan)) return { status: 'pending', user: null };

    const info = await payos.getPaymentInfo(orderCode);
    if (info.status === 'PAID') {
      // Chỉ kích hoạt khi PayOS xác nhận đã nhận đủ số tiền của gói.
      if (info.amountPaid < order.amount) return { status: 'pending', user: null };
      const settled = await store.settleOrder(orderCode, this.now());
      return { status: 'paid', user: settled?.user ?? null };
    }
    if (info.status === 'CANCELLED' || info.status === 'EXPIRED') {
      await store.setOrderStatus(orderCode, 'cancelled');
      return { status: 'cancelled', user: null };
    }
    return { status: 'pending', user: null };
  }
}

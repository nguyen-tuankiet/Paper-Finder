import { randomInt } from 'node:crypto';
import type { PaymentStatusResponse, PlanId, PlanOption } from '../../../shared/types.js';
import { PayOsClient, PayOsError } from './payos.js';
import type { AccountStore, OrderRow, UserRow } from './types.js';

export interface BillingOptions {
  store: AccountStore;
  /** Không có = chưa cấu hình thanh toán (vẫn có thể cấp Pro thủ công qua trang admin). */
  payos?: PayOsClient;
  publicBaseUrl?: string;
  priceMonth: number;
  priceYear: number;
  now?: () => Date;
}

const PLAN_DEFS: Record<PlanId, { label: string; days: number; description: string }> = {
  month: { label: '1 tháng', days: 30, description: 'PaperFinder Pro 1 thang' },
  year: { label: '1 năm', days: 365, description: 'PaperFinder Pro 1 nam' },
};

export class BillingService {
  private readonly now: () => Date;

  constructor(private readonly options: BillingOptions) {
    this.now = options.now ?? (() => new Date());
  }

  get enabled(): boolean {
    return Boolean(this.options.payos && this.options.publicBaseUrl);
  }

  plans(): PlanOption[] {
    return (Object.keys(PLAN_DEFS) as PlanId[]).map((id) => ({
      id,
      label: PLAN_DEFS[id].label,
      days: PLAN_DEFS[id].days,
      priceVnd: id === 'month' ? this.options.priceMonth : this.options.priceYear,
    }));
  }

  daysOf(plan: PlanId): number {
    return PLAN_DEFS[plan].days;
  }

  /** Tạo đơn chờ thanh toán và link thanh toán PayOS. */
  async checkout(user: UserRow, plan: PlanId): Promise<{ checkoutUrl: string; orderCode: number }> {
    const { payos, publicBaseUrl, store } = this.options;
    if (!payos || !publicBaseUrl) throw new PayOsError('Chưa cấu hình cổng thanh toán.');
    const option = this.plans().find((p) => p.id === plan);
    if (!option) throw new PayOsError('Gói không hợp lệ.');

    // Mã đơn: số nguyên dương duy nhất (PayOS cho phép tới 2^53-1); mili-giây * 1000 + ngẫu nhiên.
    const orderCode = this.now().getTime() * 1000 + randomInt(0, 1000);
    const order: OrderRow = { orderCode, userId: user.id, plan, amount: option.priceVnd, status: 'pending', createdAt: this.now().toISOString(), paidAt: null };
    await store.createOrder(order);
    try {
      const { checkoutUrl } = await payos.createPaymentLink({
        orderCode,
        amount: option.priceVnd,
        description: PLAN_DEFS[plan].description,
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
   * Hỏi PayOS trạng thái đơn và kích hoạt Pro nếu đã trả đủ tiền. An toàn khi gọi lặp (webhook + trang quay lại):
   * Pro chỉ được cộng một lần cho mỗi đơn. `requireUserId`: chỉ cho người sở hữu đơn kiểm tra.
   */
  async refresh(orderCode: number, requireUserId?: string): Promise<{ status: PaymentStatusResponse['status']; user: UserRow | null }> {
    const { store, payos } = this.options;
    const order = await store.getOrder(orderCode);
    if (!order || (requireUserId && order.userId !== requireUserId)) return { status: 'unknown', user: null };
    if (order.status === 'paid') return { status: 'paid', user: await store.getUserById(order.userId) };
    if (!payos) return { status: 'pending', user: null };

    const info = await payos.getPaymentInfo(orderCode);
    if (info.status === 'PAID') {
      // Chỉ kích hoạt khi PayOS xác nhận đã nhận đủ số tiền của gói.
      if (info.amountPaid < order.amount) return { status: 'pending', user: null };
      const settled = await store.settleOrder(orderCode, this.daysOf(order.plan), this.now());
      return { status: 'paid', user: settled?.user ?? null };
    }
    if (info.status === 'CANCELLED' || info.status === 'EXPIRED') {
      await store.setOrderStatus(orderCode, 'cancelled');
      return { status: 'cancelled', user: null };
    }
    return { status: 'pending', user: null };
  }
}

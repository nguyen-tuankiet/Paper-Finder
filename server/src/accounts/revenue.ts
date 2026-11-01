import type { AdminOrder, RevenueDay, RevenuePlanRow, RevenueReport, RevenueWindow } from '../../../shared/types.js';
import { parsePlanKey } from './plans.js';
import type { AccountCounts, OrderWithEmail } from './types.js';

const DAY_MS = 86_400_000;
/** Đơn chưa trả quá 24 giờ coi là bỏ dở (khớp thời hạn hiển thị đơn ở BillingService). */
const ORDER_TTL_MS = DAY_MS;
const RECENT_ORDERS = 50;

export interface RevenueOptions {
  now: Date;
  timezone: string;
  /** Số ngày của biểu đồ theo ngày. */
  days: number;
}

const empty = (): RevenueWindow => ({ revenueVnd: 0, orders: 0 });

/**
 * Dựng báo cáo doanh thu từ danh sách đơn (mới nhất trước) và số liệu tài khoản.
 * Doanh thu tính theo NGÀY THANH TOÁN, đúng múi giờ cấu hình; chỉ đơn đã thanh toán mới được cộng.
 */
export function buildRevenueReport(orders: OrderWithEmail[], counts: AccountCounts, options: RevenueOptions): RevenueReport {
  const { now, timezone } = options;
  const span = Math.min(Math.max(Math.trunc(options.days) || 30, 1), 365);
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayKey = (date: Date) => format.format(date); // en-CA -> YYYY-MM-DD

  const dates: string[] = [];
  for (let i = span - 1; i >= 0; i--) dates.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
  const dailyMap = new Map<string, RevenueWindow>([...new Set(dates)].map((d) => [d, empty()]));

  const todayKey = dayKey(now);
  const last7 = new Set<string>();
  const last30 = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const key = dayKey(new Date(now.getTime() - i * DAY_MS));
    last30.add(key);
    if (i < 7) last7.add(key);
  }
  const monthPrefix = todayKey.slice(0, 7);

  const today = empty();
  const last7Days = empty();
  const last30Days = empty();
  const thisMonth = empty();
  const allTime = empty();
  const byPlan = new Map<string, RevenuePlanRow>();
  const ordersPerUser = new Map<string, number>();
  const funnel = { created: 0, paid: 0, pending: 0, abandoned: 0 };

  for (const order of orders) {
    const created = new Date(order.createdAt).getTime();
    if (now.getTime() - created <= 30 * DAY_MS) {
      funnel.created++;
      if (order.status === 'paid') funnel.paid++;
      else if (order.status === 'pending' && now.getTime() - created <= ORDER_TTL_MS) funnel.pending++;
      else funnel.abandoned++;
    }
    if (order.status !== 'paid') continue;

    const paidAt = new Date(order.paidAt ?? order.createdAt);
    const key = dayKey(paidAt);
    const add = (window: RevenueWindow) => {
      window.revenueVnd += order.amount;
      window.orders++;
    };
    add(allTime);
    if (key === todayKey) add(today);
    if (last7.has(key)) add(last7Days);
    if (last30.has(key)) add(last30Days);
    if (key.startsWith(monthPrefix)) add(thisMonth);
    const day = dailyMap.get(key);
    if (day) add(day);

    const plan = parsePlanKey(order.plan);
    if (plan) {
      const row = byPlan.get(order.plan) ?? { tier: plan.tier, period: plan.period, ...empty() };
      add(row);
      byPlan.set(order.plan, row);
    }
    ordersPerUser.set(order.userId, (ordersPerUser.get(order.userId) ?? 0) + 1);
  }

  const payingUsers = ordersPerUser.size;
  const daily: RevenueDay[] = [...dailyMap].map(([date, w]) => ({ date, ...w }));
  const recentOrders: AdminOrder[] = orders.slice(0, RECENT_ORDERS).map((o) => ({
    orderCode: o.orderCode,
    email: o.email,
    plan: o.plan,
    amount: o.amount,
    status: o.status,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    paymentRef: o.paymentRef,
  }));

  return {
    generatedAt: now.toISOString(),
    timezone,
    today,
    last7Days,
    last30Days,
    thisMonth,
    allTime,
    averageOrderVnd: allTime.orders > 0 ? Math.round(allTime.revenueVnd / allTime.orders) : 0,
    users: counts.users,
    activeStandard: counts.activeStandard,
    activePro: counts.activePro,
    payingUsers,
    repeatBuyers: [...ordersPerUser.values()].filter((n) => n >= 2).length,
    conversionPercent: counts.users > 0 ? Math.round((payingUsers / counts.users) * 1000) / 10 : 0,
    funnel,
    daily,
    byPlan: [...byPlan.values()].sort((a, b) => b.revenueVnd - a.revenueVnd),
    recentOrders,
  };
}

import { PAID_TIERS, PLAN_PERIODS, type Entitlements, type PaidTier, type PlanPeriod, type Tier } from '../../../shared/types.js';

const DAY_MS = 86_400_000;

export const PERIOD_DAYS: Record<PlanPeriod, number> = { week: 7, month: 30, year: 365 };
export const PERIOD_LABEL: Record<PlanPeriod, string> = { week: '7 ngày', month: '1 tháng', year: '1 năm' };
export const TIER_LABEL: Record<Tier, string> = { guest: 'Khách', free: 'Miễn phí', standard: 'Tiêu chuẩn', pro: 'Pro' };

/** Khóa gói lưu trong đơn hàng, vd. "pro:month". */
export type PlanKey = `${PaidTier}:${PlanPeriod}`;

export const planKey = (tier: PaidTier, period: PlanPeriod): PlanKey => `${tier}:${period}`;

export function parsePlanKey(key: string): { tier: PaidTier; period: PlanPeriod } | null {
  const parts = key.split(':');
  const [tier, period] = parts;
  if (parts.length !== 2 || !(PAID_TIERS as readonly string[]).includes(tier ?? '') || !(PLAN_PERIODS as readonly string[]).includes(period ?? '')) return null;
  return { tier: tier as PaidTier, period: period as PlanPeriod };
}

export interface TierClocks {
  standardUntil: string | null;
  proUntil: string | null;
}

/** Hạng đang hiệu lực: Pro nếu còn hạn Pro, không thì Tiêu chuẩn nếu còn hạn, không thì miễn phí. */
export function tierOf(user: TierClocks, now: Date): 'free' | 'standard' | 'pro' {
  const t = now.getTime();
  if (user.proUntil && new Date(user.proUntil).getTime() > t) return 'pro';
  if (user.standardUntil && new Date(user.standardUntil).getTime() > t) return 'standard';
  return 'free';
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/**
 * Cộng `days` ngày cho một hạng, cộng dồn và công bằng khi mua lẫn hai hạng:
 * - Mua Pro: Pro bắt đầu ngay (hoặc nối tiếp hạn Pro hiện có); thời gian Tiêu chuẩn còn lại KHÔNG bị mất mà được lùi thêm đúng bằng số ngày Pro vừa cộng, để dùng tiếp sau khi Pro hết.
 * - Mua Tiêu chuẩn: nếu đang có Pro thì bắt đầu sau khi Pro hết; nếu không thì nối tiếp hạn hiện có.
 */
export function applyPurchase(clocks: TierClocks, tier: PaidTier, days: number, now: Date): TierClocks {
  const t = now.getTime();
  const add = days * DAY_MS;
  if (tier === 'pro') {
    const proUntil = Math.max(t, ms(clocks.proUntil)) + add;
    // Chỉ lùi hạn Tiêu chuẩn khi nó còn hiệu lực hoặc đang chờ; nếu đã hết hạn thì giữ nguyên.
    const standardUntil = ms(clocks.standardUntil) > t ? new Date(ms(clocks.standardUntil) + add).toISOString() : clocks.standardUntil;
    return { proUntil: new Date(proUntil).toISOString(), standardUntil };
  }
  const standardUntil = Math.max(t, ms(clocks.standardUntil), ms(clocks.proUntil)) + add;
  return { standardUntil: new Date(standardUntil).toISOString(), proUntil: clocks.proUntil };
}

export interface EntitlementConfig {
  guestDailySearches: number;
  freeDailySearches: number;
}

/** Số dòng tối đa mỗi file xuất của hạng miễn phí. */
export const FREE_EXPORT_ROWS = 50;

/**
 * Bảng quyền lợi theo hạng: nơi DUY NHẤT quyết định giới hạn. Sửa ở đây để đổi chính sách.
 * Khách chưa đăng nhập không xuất file, không có thư viện/lịch sử; mỗi hạng cao hơn mở thêm.
 */
export function buildEntitlements(config: EntitlementConfig): Record<Tier, Entitlements> {
  return {
    guest: { tier: 'guest', label: TIER_LABEL.guest, dailySearches: config.guestDailySearches, maxResultsPerSource: 20, exportRows: 0, referenceExport: false, libraryMax: 0, historyMax: 0 },
    free: { tier: 'free', label: TIER_LABEL.free, dailySearches: config.freeDailySearches, maxResultsPerSource: 50, exportRows: FREE_EXPORT_ROWS, referenceExport: false, libraryMax: 0, historyMax: 0 },
    standard: { tier: 'standard', label: TIER_LABEL.standard, dailySearches: null, maxResultsPerSource: 200, exportRows: null, referenceExport: false, libraryMax: 200, historyMax: 20 },
    pro: { tier: 'pro', label: TIER_LABEL.pro, dailySearches: null, maxResultsPerSource: 500, exportRows: null, referenceExport: true, libraryMax: 5000, historyMax: 50 },
  };
}

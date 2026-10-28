import type { QuotaInfo, Tier } from '../../../shared/types.js';
import type { AccountStore } from './types.js';

export type Identity = { kind: 'user'; userId: string; tier: Exclude<Tier, 'guest'> } | { kind: 'guest'; key: string };

export interface QuotaOptions {
  store: AccountStore;
  /** Số lượt tìm mỗi ngày của từng hạng; null = không giới hạn. */
  dailySearches: (tier: Tier) => number | null;
  timezone: string;
  now?: () => Date;
}

/** Độ lệch (ms) của múi giờ `timeZone` so với UTC tại thời điểm `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Giới hạn lượt tìm theo ngày: khách tính theo mã băm IP (trong bộ nhớ), thành viên tính theo tài khoản (lưu bền);
 * hạng trả phí không giới hạn. Mỗi từ khóa trong một lần tìm tính là một lượt.
 */
export class QuotaService {
  private readonly guests = new Map<string, number>();
  private readonly dateFormat: Intl.DateTimeFormat;
  private readonly now: () => Date;

  constructor(private readonly options: QuotaOptions) {
    this.now = options.now ?? (() => new Date());
    this.dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: options.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  private today(): string {
    return this.dateFormat.format(this.now());
  }

  /** Đầu ngày kế tiếp theo múi giờ cấu hình. */
  private resetsAt(): string {
    const now = this.now();
    const [y, m, d] = this.today().split('-').map(Number) as [number, number, number];
    const nextMidnightLocal = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
    return new Date(nextMidnightLocal - zoneOffsetMs(now, this.options.timezone)).toISOString();
  }

  private limitFor(identity: Identity): number | null {
    return this.options.dailySearches(identity.kind === 'guest' ? 'guest' : identity.tier);
  }

  private info(limit: number | null, used: number): QuotaInfo {
    return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used), resetsAt: limit === null ? null : this.resetsAt() };
  }

  private guestKey(identity: { key: string }): string {
    const day = this.today();
    // Xóa bộ đếm của các ngày đã qua để bộ nhớ không phình ra.
    for (const key of this.guests.keys()) if (!key.startsWith(`${day}|`)) this.guests.delete(key);
    return `${day}|${identity.key}`;
  }

  async peek(identity: Identity): Promise<QuotaInfo> {
    const limit = this.limitFor(identity);
    if (identity.kind === 'guest') return this.info(limit, this.guests.get(this.guestKey(identity)) ?? 0);
    return this.info(limit, limit === null ? 0 : await this.options.store.getUsage(identity.userId, this.today()));
  }

  /** Trừ `count` lượt nếu còn đủ. Nếu không đủ thì không trừ gì và trả ok=false. */
  async consume(identity: Identity, count: number): Promise<{ ok: boolean; quota: QuotaInfo }> {
    const limit = this.limitFor(identity);
    if (limit === null) return { ok: true, quota: this.info(null, 0) };

    if (identity.kind === 'guest') {
      const key = this.guestKey(identity);
      const used = this.guests.get(key) ?? 0;
      if (used + count > limit) return { ok: false, quota: this.info(limit, used) };
      this.guests.set(key, used + count);
      return { ok: true, quota: this.info(limit, used + count) };
    }

    const day = this.today();
    const used = await this.options.store.addUsage(identity.userId, day, count);
    if (used > limit) {
      const restored = await this.options.store.addUsage(identity.userId, day, -count);
      return { ok: false, quota: this.info(limit, restored) };
    }
    return { ok: true, quota: this.info(limit, used) };
  }

  /** Hoàn lại lượt khi lần tìm bị hủy hoặc không có nguồn nào trả kết quả. */
  async refund(identity: Identity, count: number): Promise<void> {
    if (this.limitFor(identity) === null) return;
    if (identity.kind === 'guest') {
      const key = this.guestKey(identity);
      this.guests.set(key, Math.max(0, (this.guests.get(key) ?? 0) - count));
      return;
    }
    await this.options.store.addUsage(identity.userId, this.today(), -count);
  }
}

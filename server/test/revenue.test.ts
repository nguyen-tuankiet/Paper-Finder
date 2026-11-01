import { newDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';
import { buildRevenueReport } from '../src/accounts/revenue.js';
import type { AccountCounts, OrderWithEmail } from '../src/accounts/types.js';
import { StatsService } from '../src/services/stats.js';
import { PgStatsBackend } from '../src/services/statsPg.js';

const TZ = 'Asia/Ho_Chi_Minh';
/** 10:00 sáng giờ Việt Nam ngày 25/10/2026. */
const NOW = new Date('2026-10-25T03:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const counts: AccountCounts = { users: 40, activeStandard: 3, activePro: 1, paidOrders: 0, revenueVnd: 0 };

function order(over: Partial<OrderWithEmail> & Pick<OrderWithEmail, 'orderCode'>): OrderWithEmail {
  return { userId: 'u1', email: 'a@b.co', plan: 'standard:month', amount: 29_000, status: 'paid', createdAt: hoursAgo(1), paidAt: hoursAgo(1), paymentRef: 'sepay:1', ...over };
}

describe('buildRevenueReport', () => {
  it('chưa có đơn nào thì mọi số liệu bằng 0, không chia cho 0', () => {
    const report = buildRevenueReport([], counts, { now: NOW, timezone: TZ, days: 7 });
    expect(report.allTime).toEqual({ revenueVnd: 0, orders: 0 });
    expect(report.averageOrderVnd).toBe(0);
    expect(report.payingUsers).toBe(0);
    expect(report.conversionPercent).toBe(0);
    expect(report.daily).toHaveLength(7);
    expect(report.daily.every((d) => d.revenueVnd === 0)).toBe(true);
    expect(report.recentOrders).toEqual([]);
    expect(buildRevenueReport([], { ...counts, users: 0 }, { now: NOW, timezone: TZ, days: 7 }).conversionPercent).toBe(0);
  });

  it('chỉ cộng đơn đã thanh toán, tính theo ngày thanh toán, các khoảng thời gian đúng', () => {
    const orders: OrderWithEmail[] = [
      order({ orderCode: 1, amount: 29_000 }), // hôm nay
      order({ orderCode: 2, userId: 'u2', plan: 'pro:week', amount: 20_000, paidAt: hoursAgo(30) }), // hôm qua
      order({ orderCode: 3, userId: 'u3', plan: 'pro:year', amount: 229_000, paidAt: hoursAgo(24 * 10) }), // 10 ngày trước
      order({ orderCode: 4, userId: 'u4', amount: 119_000, paidAt: hoursAgo(24 * 40) }), // ngoài 30 ngày
      order({ orderCode: 5, userId: 'u5', status: 'pending', paidAt: null, amount: 999_000 }),
      order({ orderCode: 6, userId: 'u6', status: 'cancelled', paidAt: null, amount: 888_000 }),
    ];
    const report = buildRevenueReport(orders, counts, { now: NOW, timezone: TZ, days: 30 });
    expect(report.today).toEqual({ revenueVnd: 29_000, orders: 1 });
    expect(report.last7Days).toEqual({ revenueVnd: 49_000, orders: 2 });
    expect(report.last30Days).toEqual({ revenueVnd: 278_000, orders: 3 });
    expect(report.allTime).toEqual({ revenueVnd: 397_000, orders: 4 });
    expect(report.averageOrderVnd).toBe(99_250);
    expect(report.payingUsers).toBe(4);
    expect(report.conversionPercent).toBe(10); // 4 / 40
    expect(report.daily.at(-1)).toEqual({ date: '2026-10-25', revenueVnd: 29_000, orders: 1 });
    expect(report.daily.at(-2)).toEqual({ date: '2026-10-24', revenueVnd: 20_000, orders: 1 });
    expect(report.daily.reduce((s, d) => s + d.revenueVnd, 0)).toBe(278_000);
  });

  it('tháng này chỉ tính từ ngày 1, ngày chia theo múi giờ Việt Nam', () => {
    // 20:00 UTC ngày 30/09 = 03:00 ngày 01/10 giờ Việt Nam -> thuộc tháng 10.
    const lateSeptemberUtc = new Date('2026-09-30T20:00:00Z').toISOString();
    const earlySeptember = new Date('2026-09-30T10:00:00Z').toISOString(); // 17:00 ngày 30/09 giờ Việt Nam -> tháng 9
    const report = buildRevenueReport(
      [order({ orderCode: 1, paidAt: lateSeptemberUtc, amount: 10_000 }), order({ orderCode: 2, paidAt: earlySeptember, amount: 50_000 })],
      counts,
      { now: NOW, timezone: TZ, days: 30 },
    );
    expect(report.thisMonth).toEqual({ revenueVnd: 10_000, orders: 1 });
    expect(report.last30Days.revenueVnd).toBe(60_000);
  });

  it('thống kê theo gói, người mua lại và phễu đơn hàng', () => {
    const orders: OrderWithEmail[] = [
      order({ orderCode: 1, userId: 'u1', plan: 'pro:month', amount: 49_000 }),
      order({ orderCode: 2, userId: 'u1', plan: 'pro:month', amount: 49_000, paidAt: hoursAgo(50) }),
      order({ orderCode: 3, userId: 'u2', plan: 'standard:week', amount: 10_000 }),
      order({ orderCode: 4, userId: 'u3', status: 'pending', paidAt: null, createdAt: hoursAgo(2) }), // còn chờ
      order({ orderCode: 5, userId: 'u4', status: 'pending', paidAt: null, createdAt: hoursAgo(30) }), // bỏ dở
      order({ orderCode: 6, userId: 'u5', status: 'cancelled', paidAt: null, createdAt: hoursAgo(5) }), // bỏ dở
      order({ orderCode: 7, userId: 'u6', plan: 'khong-hop-le' as OrderWithEmail['plan'], amount: 5_000 }), // gói lạ: vẫn tính doanh thu, không vào bảng theo gói
    ];
    const report = buildRevenueReport(orders, counts, { now: NOW, timezone: TZ, days: 7 });
    expect(report.byPlan.map((p) => [p.tier, p.period, p.orders, p.revenueVnd])).toEqual([
      ['pro', 'month', 2, 98_000],
      ['standard', 'week', 1, 10_000],
    ]);
    expect(report.allTime).toEqual({ revenueVnd: 113_000, orders: 4 });
    expect(report.repeatBuyers).toBe(1);
    expect(report.payingUsers).toBe(3);
    expect(report.funnel).toEqual({ created: 7, paid: 4, pending: 1, abandoned: 2 });
  });

  it('danh sách đơn gần đây giữ thứ tự đầu vào, tối đa 50 và giữ email trống', () => {
    const many = Array.from({ length: 70 }, (_v, i) => order({ orderCode: 1000 + i, email: i === 0 ? null : 'x@y.co' }));
    const report = buildRevenueReport(many, counts, { now: NOW, timezone: TZ, days: 7 });
    expect(report.recentOrders).toHaveLength(50);
    expect(report.recentOrders[0]).toMatchObject({ orderCode: 1000, email: null });
    expect(report.recentOrders[0]).not.toHaveProperty('userId');
  });

  it('số ngày được kẹp trong khoảng hợp lệ', () => {
    expect(buildRevenueReport([], counts, { now: NOW, timezone: TZ, days: 9999 }).daily).toHaveLength(365);
    expect(buildRevenueReport([], counts, { now: NOW, timezone: TZ, days: -5 }).daily).toHaveLength(1);
    expect(buildRevenueReport([], counts, { now: NOW, timezone: TZ, days: Number.NaN }).daily).toHaveLength(30);
  });
});

describe('thống kê lưu trong cơ sở dữ liệu', () => {
  async function backend() {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool();
    return { pool, backend: await PgStatsBackend.create(pool) };
  }
  const clock = (iso = '2026-10-25T12:00:00Z') => {
    let now = new Date(iso);
    return { now: () => now, set: (v: string) => (now = new Date(v)) };
  };

  it('giữ nguyên số liệu và khóa băm sau khi khởi động lại', async () => {
    const { backend: db } = await backend();
    const c = clock();
    const a = new StatsService({ ...c, backend: db, flushIntervalMs: 0 });
    await a.init();
    a.recordVisit('1.1.1.1', 'Chrome');
    a.recordVisit('2.2.2.2', 'Chrome');
    a.recordSearchStarted();
    a.recordSearchOutcome({ kind: 'completed', total: 25, sources: [{ source: 'crossref', state: 'ok' }] });
    a.recordSearchSources(['crossref']);
    a.recordExport();
    await a.stop();

    const b = new StatsService({ ...c, backend: db, flushIntervalMs: 0 });
    await b.init();
    b.recordVisit('1.1.1.1', 'Chrome'); // cùng người: cùng mã băm nên không đếm thêm
    b.recordVisit('3.3.3.3', 'Chrome');
    const report = b.getReport();
    expect(report.storage).toBe('database');
    expect(report.persistent).toBe(true);
    expect(report.today).toEqual({ visitors: 3, searches: 1, exports: 1 });
    expect(report.allTime).toMatchObject({ completed: 1, averageResultsPerSearch: 25 });
    expect(report.sources[0]).toMatchObject({ source: 'crossref', used: 1 });
    expect(new Date(report.trackingSince).toISOString()).toBe(new Date('2026-10-25T12:00:00Z').toISOString());
  });

  it('chỉ ghi các ngày đã đổi và xóa ngày quá hạn lưu', async () => {
    const { pool, backend: db } = await backend();
    const c = clock('2026-10-01T12:00:00Z');
    const stats = new StatsService({ ...c, backend: db, retentionDays: 7, flushIntervalMs: 0 });
    await stats.init();
    stats.recordSearchStarted();
    await stats.flushAsync();
    c.set('2026-10-20T12:00:00Z');
    stats.recordSearchStarted();
    await stats.flushAsync();
    const rows = (await pool.query('SELECT day FROM pf_stats_days ORDER BY day')) as { rows: { day: string }[] };
    expect(rows.rows.map((r) => r.day)).toEqual(['2026-10-20']);
  });

  it('lỗi ghi không làm mất số đếm: tự thử lại ở lần ghi sau', async () => {
    const real = (await backend()).backend;
    let fail = true;
    const flaky = {
      kind: 'database' as const,
      load: () => real.load(),
      save: async (...args: Parameters<typeof real.save>) => {
        if (fail) throw new Error('mất kết nối');
        return real.save(...args);
      },
    };
    const stats = new StatsService({ ...clock(), backend: flaky, flushIntervalMs: 0 });
    await stats.init();
    stats.recordSearchStarted();
    await stats.flushAsync(); // thất bại nhưng không ném lỗi
    fail = false;
    await stats.flushAsync();
    const again = new StatsService({ ...clock(), backend: flaky, flushIntervalMs: 0 });
    await again.init();
    expect(again.getReport().today.searches).toBe(1);
  });

  it('không nạp được dữ liệu cũ thì vẫn chạy và đếm lại từ đầu', async () => {
    const broken = { kind: 'database' as const, load: async () => Promise.reject(new Error('db sập')), save: async () => undefined };
    const stats = new StatsService({ ...clock(), backend: broken, flushIntervalMs: 0 });
    await expect(stats.init()).resolves.toBeUndefined();
    stats.recordSearchStarted();
    expect(stats.getReport().today.searches).toBe(1);
  });

  it('báo cáo ghi rõ nơi lưu: file và bộ nhớ', () => {
    expect(new StatsService({ ...clock(), flushIntervalMs: 0 }).getReport().storage).toBe('memory');
  });
});

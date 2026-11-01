import type pg from 'pg';
import type { PersistedDay, StatsBackend, StatsSnapshot } from './stats.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pf_stats_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pf_stats_days (
    day TEXT PRIMARY KEY,
    data JSONB NOT NULL
  )`,
];

/**
 * Lưu thống kê sử dụng trong PostgreSQL (cùng cơ sở dữ liệu với tài khoản): mỗi ngày một dòng JSON, cộng hai khóa meta
 * (khóa băm và thời điểm bắt đầu ghi). Chỉ lưu số đếm và mã băm một chiều, giống bản file.
 */
export class PgStatsBackend implements StatsBackend {
  readonly kind = 'database' as const;

  private constructor(private readonly pool: pg.Pool) {}

  static async create(pool: pg.Pool): Promise<PgStatsBackend> {
    for (const statement of SCHEMA) await pool.query(statement);
    return new PgStatsBackend(pool);
  }

  async load(): Promise<StatsSnapshot | null> {
    const meta = await this.pool.query<{ key: string; value: string }>('SELECT key, value FROM pf_stats_meta');
    const days = await this.pool.query<{ day: string; data: PersistedDay }>('SELECT day, data FROM pf_stats_days');
    if (meta.rows.length === 0 && days.rows.length === 0) return null;
    const get = (key: string) => meta.rows.find((r) => r.key === key)?.value;
    return {
      secret: get('secret') ?? null,
      createdAt: get('created_at') ?? null,
      days: Object.fromEntries(days.rows.map((r) => [r.day, r.data])),
    };
  }

  async save(meta: { secret: string; createdAt: string }, days: Record<string, PersistedDay>, keepFrom: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of [
        ['secret', meta.secret],
        ['created_at', meta.createdAt],
      ]) {
        // Khóa băm chỉ được ghi một lần: nếu hai bản máy chủ cùng khởi động, bản đến trước thắng để mã băm của người dùng không bị đổi giữa chừng.
        await client.query('INSERT INTO pf_stats_meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [key, value]);
      }
      for (const [day, data] of Object.entries(days)) {
        await client.query('INSERT INTO pf_stats_days (day, data) VALUES ($1, $2) ON CONFLICT (day) DO UPDATE SET data = EXCLUDED.data', [day, JSON.stringify(data)]);
      }
      await client.query('DELETE FROM pf_stats_days WHERE day < $1', [keepFrom]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

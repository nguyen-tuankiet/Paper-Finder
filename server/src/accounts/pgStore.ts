import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { HistoryEntry, LibraryItem, PaidTier, PaperRecord, SearchRequest } from '../../../shared/types.js';
import { PERIOD_DAYS, applyPurchase, parsePlanKey, tierOf, type PlanKey } from './plans.js';
import type { AccountCounts, AccountStore, OrderRow, OrderStatus, SaveToLibraryResult, UserRow } from './types.js';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS pf_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 1,
    standard_until TIMESTAMPTZ,
    pro_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
  )`,
  'ALTER TABLE pf_users ADD COLUMN IF NOT EXISTS standard_until TIMESTAMPTZ',
  `CREATE TABLE IF NOT EXISTS pf_usage (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`,
  `CREATE TABLE IF NOT EXISTS pf_orders (
    order_code BIGINT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ,
    payment_ref TEXT
  )`,
  'ALTER TABLE pf_orders ADD COLUMN IF NOT EXISTS payment_ref TEXT',
  `CREATE TABLE IF NOT EXISTS pf_library (
    user_id TEXT NOT NULL,
    item_key TEXT NOT NULL,
    folder TEXT NOT NULL,
    saved_at TIMESTAMPTZ NOT NULL,
    record JSONB NOT NULL,
    PRIMARY KEY (user_id, item_key)
  )`,
  `CREATE TABLE IF NOT EXISTS pf_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL,
    request JSONB NOT NULL,
    total INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS pf_history_user ON pf_history (user_id, at)',
];

interface UserDbRow {
  id: string;
  email: string;
  password_hash: string;
  session_version: number;
  standard_until: Date | string | null;
  pro_until: Date | string | null;
  created_at: Date | string;
}

interface OrderDbRow {
  order_code: string | number;
  user_id: string;
  plan: string;
  amount: number;
  status: string;
  created_at: Date | string;
  paid_at: Date | string | null;
  payment_ref?: string | null;
}

const toUser = (r: UserDbRow): UserRow => ({
  id: r.id,
  email: r.email,
  passwordHash: r.password_hash,
  sessionVersion: Number(r.session_version),
  standardUntil: iso(r.standard_until),
  proUntil: iso(r.pro_until),
  createdAt: iso(r.created_at) ?? new Date().toISOString(),
});

const toOrder = (r: OrderDbRow): OrderRow => ({
  orderCode: Number(r.order_code),
  userId: r.user_id,
  plan: r.plan as PlanKey,
  amount: Number(r.amount),
  status: r.status as OrderStatus,
  createdAt: iso(r.created_at) ?? new Date().toISOString(),
  paidAt: iso(r.paid_at),
  paymentRef: r.payment_ref ?? null,
});

/** Kho tài khoản lưu trong PostgreSQL (Neon, Supabase, Render Postgres...). Bảng được tạo tự động khi khởi động. */
export class PgAccountStore implements AccountStore {
  readonly kind = 'postgres' as const;

  private constructor(private readonly pool: pg.Pool) {}

  /** `pool` truyền vào để thử nghiệm; bình thường dùng `connect(url)`. */
  static async withPool(pool: pg.Pool): Promise<PgAccountStore> {
    const store = new PgAccountStore(pool);
    for (const statement of SCHEMA) await pool.query(statement);
    return store;
  }

  static async connect(connectionString: string): Promise<PgAccountStore> {
    return PgAccountStore.withPool(new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 }));
  }

  async createUser(email: string, passwordHash: string): Promise<UserRow | null> {
    try {
      const result = await this.pool.query<UserDbRow>(
        'INSERT INTO pf_users (id, email, password_hash, session_version, standard_until, pro_until, created_at) VALUES ($1, $2, $3, 1, NULL, NULL, $4) RETURNING *',
        [randomUUID(), normalizeEmail(email), passwordHash, new Date()],
      );
      return result.rows[0] ? toUser(result.rows[0]) : null;
    } catch (error) {
      // 23505 = unique_violation: email đã có (kể cả khi hai yêu cầu đăng ký cùng lúc).
      if ((error as { code?: string }).code === '23505' || /unique|duplicate/i.test(String((error as Error).message))) return null;
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserDbRow>('SELECT * FROM pf_users WHERE email = $1', [normalizeEmail(email)]);
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const result = await this.pool.query<UserDbRow>('SELECT * FROM pf_users WHERE id = $1', [id]);
    return result.rows[0] ? toUser(result.rows[0]) : null;
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE pf_users SET password_hash = $2, session_version = session_version + 1 WHERE id = $1', [id, passwordHash]);
  }

  async addUsage(userId: string, day: string, delta: number): Promise<number> {
    const start = Math.max(0, delta);
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO pf_usage (user_id, day, count) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, day) DO UPDATE SET count = GREATEST(pf_usage.count + $4, 0)
       RETURNING count`,
      [userId, day, start, delta],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getUsage(userId: string, day: string): Promise<number> {
    const result = await this.pool.query<{ count: number }>('SELECT count FROM pf_usage WHERE user_id = $1 AND day = $2', [userId, day]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async grantPlan(userId: string, tier: PaidTier, days: number, now: Date): Promise<UserRow | null> {
    const user = await this.getUserById(userId);
    if (!user) return null;
    const next = { ...user, ...applyPurchase(user, tier, days, now) };
    await this.pool.query('UPDATE pf_users SET standard_until = $2, pro_until = $3 WHERE id = $1', [userId, next.standardUntil ? new Date(next.standardUntil) : null, next.proUntil ? new Date(next.proUntil) : null]);
    return next;
  }

  async createOrder(order: OrderRow): Promise<void> {
    await this.pool.query('INSERT INTO pf_orders (order_code, user_id, plan, amount, status, created_at, paid_at, payment_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
      order.orderCode,
      order.userId,
      order.plan,
      order.amount,
      order.status,
      new Date(order.createdAt),
      order.paidAt ? new Date(order.paidAt) : null,
      order.paymentRef ?? null,
    ]);
  }

  async getOrder(orderCode: number): Promise<OrderRow | null> {
    const result = await this.pool.query<OrderDbRow>('SELECT * FROM pf_orders WHERE order_code = $1', [orderCode]);
    return result.rows[0] ? toOrder(result.rows[0]) : null;
  }

  async setOrderStatus(orderCode: number, status: 'pending' | 'cancelled'): Promise<void> {
    await this.pool.query("UPDATE pf_orders SET status = $2 WHERE order_code = $1 AND status <> 'paid'", [orderCode, status]);
  }

  async settleOrder(orderCode: number, now: Date, paymentRef?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Câu UPDATE có điều kiện chỉ thành công với MỘT lần gọi: các lần còn lại (webhook lặp, trang quay lại) thấy đơn đã paid.
      const claimed = await client.query<OrderDbRow>("UPDATE pf_orders SET status = 'paid', paid_at = $2, payment_ref = $3 WHERE order_code = $1 AND status <> 'paid' RETURNING *", [orderCode, now, paymentRef ?? null]);
      const existing = claimed.rows[0] ?? (await client.query<OrderDbRow>('SELECT * FROM pf_orders WHERE order_code = $1', [orderCode])).rows[0];
      const plan = existing ? parsePlanKey(existing.plan) : null;
      if (!existing || !plan) {
        await client.query('ROLLBACK');
        return null;
      }
      const userRow = (await client.query<UserDbRow>('SELECT * FROM pf_users WHERE id = $1', [existing.user_id])).rows[0];
      if (!userRow) {
        await client.query('ROLLBACK');
        return null;
      }
      let user = toUser(userRow);
      const activated = claimed.rows.length > 0;
      if (activated) {
        user = { ...user, ...applyPurchase(user, plan.tier, PERIOD_DAYS[plan.period], now) };
        await client.query('UPDATE pf_users SET standard_until = $2, pro_until = $3 WHERE id = $1', [user.id, user.standardUntil ? new Date(user.standardUntil) : null, user.proUntil ? new Date(user.proUntil) : null]);
      }
      await client.query('COMMIT');
      return { order: toOrder(existing), user, activated };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async counts(now: Date): Promise<AccountCounts> {
    const all = await this.pool.query<UserDbRow>('SELECT * FROM pf_users');
    const tiers = all.rows.map((r) => tierOf(toUser(r), now));
    const orders = await this.pool.query<{ n: string | number; total: string | number | null }>("SELECT COUNT(*) AS n, SUM(amount) AS total FROM pf_orders WHERE status = 'paid'");
    return {
      users: all.rows.length,
      activeStandard: tiers.filter((t) => t === 'standard').length,
      activePro: tiers.filter((t) => t === 'pro').length,
      paidOrders: Number(orders.rows[0]?.n ?? 0),
      revenueVnd: Number(orders.rows[0]?.total ?? 0),
    };
  }

  async listLibrary(userId: string): Promise<LibraryItem[]> {
    const result = await this.pool.query<{ item_key: string; folder: string; saved_at: Date | string; record: PaperRecord }>(
      'SELECT item_key, folder, saved_at, record FROM pf_library WHERE user_id = $1 ORDER BY saved_at DESC',
      [userId],
    );
    return result.rows.map((r) => ({ key: r.item_key, folder: r.folder, savedAt: iso(r.saved_at) ?? '', record: r.record }));
  }

  async saveToLibrary(userId: string, item: LibraryItem, maxItems: number): Promise<SaveToLibraryResult> {
    const existing = await this.pool.query('SELECT 1 FROM pf_library WHERE user_id = $1 AND item_key = $2', [userId, item.key]);
    if (existing.rows.length > 0) {
      await this.pool.query('UPDATE pf_library SET folder = $3 WHERE user_id = $1 AND item_key = $2', [userId, item.key, item.folder]);
      return 'exists';
    }
    const count = await this.pool.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM pf_library WHERE user_id = $1', [userId]);
    if (Number(count.rows[0]?.n ?? 0) >= maxItems) return 'full';
    await this.pool.query('INSERT INTO pf_library (user_id, item_key, folder, saved_at, record) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, item_key) DO NOTHING', [
      userId,
      item.key,
      item.folder,
      new Date(item.savedAt),
      JSON.stringify(item.record),
    ]);
    return 'saved';
  }

  async removeFromLibrary(userId: string, key: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM pf_library WHERE user_id = $1 AND item_key = $2', [userId, key]);
    return (result.rowCount ?? 0) > 0;
  }

  async listHistory(userId: string): Promise<HistoryEntry[]> {
    const result = await this.pool.query<{ id: string; at: Date | string; request: SearchRequest; total: number }>(
      'SELECT id, at, request, total FROM pf_history WHERE user_id = $1 ORDER BY at DESC',
      [userId],
    );
    return result.rows.map((r) => ({ id: r.id, at: iso(r.at) ?? '', request: r.request, total: Number(r.total) }));
  }

  async addHistory(userId: string, entry: HistoryEntry, maxEntries: number): Promise<void> {
    await this.pool.query('INSERT INTO pf_history (id, user_id, at, request, total) VALUES ($1, $2, $3, $4, $5)', [entry.id, userId, new Date(entry.at), JSON.stringify(entry.request), entry.total]);
    // Giữ `maxEntries` mục mới nhất.
    await this.pool.query(
      'DELETE FROM pf_history WHERE user_id = $1 AND id NOT IN (SELECT id FROM pf_history WHERE user_id = $1 ORDER BY at DESC LIMIT $2)',
      [userId, maxEntries],
    );
  }

  async clearHistory(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM pf_history WHERE user_id = $1', [userId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

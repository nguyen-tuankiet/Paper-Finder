import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { HistoryEntry, LibraryItem } from '../../../shared/types.js';
import { silentLogger, type Logger } from '../logger.js';
import { isProActive, type AccountStore, type OrderRow, type SaveToLibraryResult, type UserRow } from './types.js';

interface Snapshot {
  version: 1;
  users: UserRow[];
  usage: Record<string, number>;
  orders: OrderRow[];
  library: Record<string, LibraryItem[]>;
  history: Record<string, HistoryEntry[]>;
}

export interface MemoryStoreOptions {
  /** Bỏ trống = chỉ giữ trong bộ nhớ. */
  filePath?: string;
  flushIntervalMs?: number;
  logger?: Logger;
}

const DAY_MS = 86_400_000;
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Kho tài khoản trong bộ nhớ, tùy chọn ghi ra file JSON (ghi nguyên tử). Dùng cho phát triển, thử nghiệm và máy chủ có ổ đĩa bền. */
export class MemoryAccountStore implements AccountStore {
  readonly kind: 'memory' | 'file';
  private users = new Map<string, UserRow>();
  private byEmail = new Map<string, string>();
  private usage = new Map<string, number>();
  private orders = new Map<number, OrderRow>();
  private library = new Map<string, LibraryItem[]>();
  private history = new Map<string, HistoryEntry[]>();
  private dirty = false;
  private timer?: NodeJS.Timeout;
  private readonly filePath?: string;
  private readonly logger: Logger;

  constructor(options: MemoryStoreOptions = {}) {
    this.filePath = options.filePath;
    this.logger = options.logger ?? silentLogger;
    this.kind = this.filePath ? 'file' : 'memory';
    this.load();
    if (this.filePath && options.flushIntervalMs !== 0) {
      this.timer = setInterval(() => this.flush(), options.flushIntervalMs ?? 5000);
      this.timer.unref();
    }
  }

  // ---------- Người dùng ----------

  async createUser(email: string, passwordHash: string): Promise<UserRow | null> {
    const key = normalizeEmail(email);
    if (this.byEmail.has(key)) return null;
    const user: UserRow = { id: randomUUID(), email: key, passwordHash, sessionVersion: 1, proUntil: null, createdAt: new Date().toISOString() };
    this.users.set(user.id, user);
    this.byEmail.set(key, user.id);
    this.touch();
    return { ...user };
  }

  async getUserByEmail(email: string): Promise<UserRow | null> {
    const id = this.byEmail.get(normalizeEmail(email));
    const user = id ? this.users.get(id) : undefined;
    return user ? { ...user } : null;
  }

  async getUserById(id: string): Promise<UserRow | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    const user = this.users.get(id);
    if (!user) return;
    user.passwordHash = passwordHash;
    user.sessionVersion++;
    this.touch();
  }

  // ---------- Lượt tìm ----------

  async addUsage(userId: string, day: string, delta: number): Promise<number> {
    const key = `${userId}|${day}`;
    const next = Math.max(0, (this.usage.get(key) ?? 0) + delta);
    this.usage.set(key, next);
    this.touch();
    return next;
  }

  async getUsage(userId: string, day: string): Promise<number> {
    return this.usage.get(`${userId}|${day}`) ?? 0;
  }

  // ---------- Gói Pro và đơn hàng ----------

  async grantPro(userId: string, days: number, now: Date): Promise<UserRow | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    this.extend(user, days, now);
    this.touch();
    return { ...user };
  }

  private extend(user: UserRow, days: number, now: Date): void {
    const current = user.proUntil ? new Date(user.proUntil).getTime() : 0;
    user.proUntil = new Date(Math.max(now.getTime(), current) + days * DAY_MS).toISOString();
  }

  async createOrder(order: OrderRow): Promise<void> {
    this.orders.set(order.orderCode, { ...order });
    this.touch();
  }

  async getOrder(orderCode: number): Promise<OrderRow | null> {
    const order = this.orders.get(orderCode);
    return order ? { ...order } : null;
  }

  async setOrderStatus(orderCode: number, status: 'pending' | 'cancelled'): Promise<void> {
    const order = this.orders.get(orderCode);
    if (order && order.status !== 'paid') {
      order.status = status;
      this.touch();
    }
  }

  async settleOrder(orderCode: number, days: number, now: Date) {
    const order = this.orders.get(orderCode);
    if (!order) return null;
    const user = this.users.get(order.userId);
    if (!user) return null;
    if (order.status === 'paid') return { order: { ...order }, user: { ...user }, activated: false };
    order.status = 'paid';
    order.paidAt = now.toISOString();
    this.extend(user, days, now);
    this.touch();
    return { order: { ...order }, user: { ...user }, activated: true };
  }

  async counts(now: Date) {
    const paid = [...this.orders.values()].filter((o) => o.status === 'paid');
    return {
      users: this.users.size,
      activePro: [...this.users.values()].filter((u) => isProActive(u, now)).length,
      paidOrders: paid.length,
      revenueVnd: paid.reduce((sum, o) => sum + o.amount, 0),
    };
  }

  // ---------- Thư viện ----------

  async listLibrary(userId: string): Promise<LibraryItem[]> {
    return [...(this.library.get(userId) ?? [])].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async saveToLibrary(userId: string, item: LibraryItem, maxItems: number): Promise<SaveToLibraryResult> {
    const items = this.library.get(userId) ?? [];
    const existing = items.find((i) => i.key === item.key);
    if (existing) {
      existing.folder = item.folder;
      this.touch();
      return 'exists';
    }
    if (items.length >= maxItems) return 'full';
    items.push(item);
    this.library.set(userId, items);
    this.touch();
    return 'saved';
  }

  async removeFromLibrary(userId: string, key: string): Promise<boolean> {
    const items = this.library.get(userId) ?? [];
    const next = items.filter((i) => i.key !== key);
    if (next.length === items.length) return false;
    this.library.set(userId, next);
    this.touch();
    return true;
  }

  // ---------- Lịch sử ----------

  async listHistory(userId: string): Promise<HistoryEntry[]> {
    return [...(this.history.get(userId) ?? [])];
  }

  async addHistory(userId: string, entry: HistoryEntry, maxEntries: number): Promise<void> {
    const list = [entry, ...(this.history.get(userId) ?? [])].slice(0, maxEntries);
    this.history.set(userId, list);
    this.touch();
  }

  async clearHistory(userId: string): Promise<void> {
    this.history.delete(userId);
    this.touch();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }

  // ---------- Lưu file ----------

  private touch(): void {
    this.dirty = true;
  }

  flush(): void {
    if (!this.filePath || !this.dirty) return;
    try {
      const snapshot: Snapshot = {
        version: 1,
        users: [...this.users.values()],
        usage: Object.fromEntries(this.usage),
        orders: [...this.orders.values()],
        library: Object.fromEntries(this.library),
        history: Object.fromEntries(this.history),
      };
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot), { mode: 0o600 });
      renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (error) {
      this.logger.error('accounts_flush_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<Snapshot>;
      for (const user of data.users ?? []) {
        this.users.set(user.id, user);
        this.byEmail.set(normalizeEmail(user.email), user.id);
      }
      for (const [key, value] of Object.entries(data.usage ?? {})) this.usage.set(key, value);
      for (const order of data.orders ?? []) this.orders.set(order.orderCode, order);
      for (const [key, value] of Object.entries(data.library ?? {})) this.library.set(key, value);
      for (const [key, value] of Object.entries(data.history ?? {})) this.history.set(key, value);
    } catch (error) {
      this.logger.error('accounts_load_failed', { error: error instanceof Error ? error.message : String(error) });
      // Giữ lại file hỏng để khỏi bị ghi đè mất dữ liệu ở lần lưu kế tiếp.
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        /* không đổi tên được thì thôi */
      }
    }
  }
}

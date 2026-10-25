import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SOURCE_IDS, type SourceId, type SourceStatus, type UsageDay, type UsageReport, type UsageSourceRow, type UsageWindow } from '../../../shared/types.js';
import { silentLogger, type Logger } from '../logger.js';

const SOURCE_LABELS: Record<SourceId, string> = {
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  europepmc: 'Europe PMC',
  doaj: 'DOAJ',
  arxiv: 'arXiv',
  semanticscholar: 'Semantic Scholar',
};

interface DayRecord {
  /** Mã băm (không đảo ngược được) của người dùng trong ngày. */
  visitors: Set<string>;
  searches: number;
  completed: number;
  failed: number;
  cancelled: number;
  results: number;
  exports: number;
  sources: Partial<Record<SourceId, { used: number; failed: number; partial: number }>>;
}

interface PersistedDay extends Omit<DayRecord, 'visitors'> {
  visitors: string[];
}

interface PersistedFile {
  version: 1;
  secret: string;
  createdAt: string;
  days: Record<string, PersistedDay>;
}

export type SearchOutcome =
  | { kind: 'completed'; total: number; sources: Pick<SourceStatus, 'source' | 'state'>[] }
  | { kind: 'failed'; sources?: Pick<SourceStatus, 'source' | 'state'>[] }
  | { kind: 'cancelled' };

export interface StatsOptions {
  /** Đường dẫn file JSON để lưu thống kê. Bỏ trống = chỉ lưu trong bộ nhớ (mất khi khởi động lại). */
  filePath?: string;
  timezone?: string;
  retentionDays?: number;
  flushIntervalMs?: number;
  now?: () => Date;
  logger?: Logger;
}

const emptyDay = (): DayRecord => ({ visitors: new Set(), searches: 0, completed: 0, failed: 0, cancelled: 0, results: 0, exports: 0, sources: {} });

/**
 * Thống kê sử dụng ẩn danh: chỉ lưu số đếm theo ngày và mã băm HMAC một chiều của (IP + User-Agent)
 * để đếm người dùng khác nhau. Không lưu IP, từ khóa hay nội dung tìm kiếm.
 */
export class StatsService {
  private readonly days = new Map<string, DayRecord>();
  private readonly filePath?: string;
  private readonly timezone: string;
  private readonly retentionDays: number;
  private readonly now: () => Date;
  private readonly logger: Logger;
  private readonly dateFormat: Intl.DateTimeFormat;
  private secret: string = randomBytes(24).toString('hex');
  private createdAt: string;
  private dirty = false;
  private timer?: NodeJS.Timeout;

  constructor(options: StatsOptions = {}) {
    this.filePath = options.filePath;
    this.timezone = options.timezone ?? 'Asia/Ho_Chi_Minh';
    this.retentionDays = options.retentionDays ?? 365;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? silentLogger;
    this.dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    this.createdAt = this.now().toISOString();
    this.load();
    if (options.flushIntervalMs !== 0 && this.filePath) {
      this.timer = setInterval(() => this.flush(), options.flushIntervalMs ?? 30_000);
      this.timer.unref();
    }
  }

  get persistent(): boolean {
    return Boolean(this.filePath);
  }

  // ---------- Ghi nhận sự kiện (không bao giờ ném lỗi ra ngoài) ----------

  recordVisit(ip: string | undefined, userAgent: string | undefined): void {
    this.safely(() => {
      const hash = createHmac('sha256', this.secret).update(`${ip ?? ''}|${userAgent ?? ''}`).digest('hex').slice(0, 16);
      this.today().visitors.add(hash);
    });
  }

  recordSearchStarted(): void {
    this.safely(() => {
      this.today().searches++;
    });
  }

  recordSearchSources(sources: SourceId[]): void {
    this.safely(() => {
      const day = this.today();
      for (const id of sources) (day.sources[id] ??= { used: 0, failed: 0, partial: 0 }).used++;
    });
  }

  recordSearchOutcome(outcome: SearchOutcome): void {
    this.safely(() => {
      const day = this.today();
      if (outcome.kind === 'completed') {
        day.completed++;
        day.results += outcome.total;
      } else if (outcome.kind === 'failed') day.failed++;
      else day.cancelled++;

      if (outcome.kind !== 'cancelled') {
        for (const s of outcome.sources ?? []) {
          const row = (day.sources[s.source] ??= { used: 0, failed: 0, partial: 0 });
          if (s.state === 'error') row.failed++;
          else if (s.state === 'partial') row.partial++;
        }
      }
    });
  }

  recordExport(): void {
    this.safely(() => {
      this.today().exports++;
    });
  }

  // ---------- Báo cáo ----------

  getReport(days = 30): UsageReport {
    const span = Math.min(Math.max(Math.trunc(days), 1), this.retentionDays);
    const dates = this.recentDates(span);
    const daily: UsageDay[] = dates.map((date) => {
      const d = this.days.get(date);
      return {
        date,
        visitors: d?.visitors.size ?? 0,
        searches: d?.searches ?? 0,
        searchesCompleted: d?.completed ?? 0,
        searchesFailed: d?.failed ?? 0,
        searchesCancelled: d?.cancelled ?? 0,
        exports: d?.exports ?? 0,
        results: d?.results ?? 0,
      };
    });

    const allKeys = [...this.days.keys()];
    const window = (keys: string[]): UsageWindow => {
      const visitors = new Set<string>();
      let searches = 0;
      let exports = 0;
      for (const key of keys) {
        const d = this.days.get(key);
        if (!d) continue;
        d.visitors.forEach((v) => visitors.add(v));
        searches += d.searches;
        exports += d.exports;
      }
      return { visitors: visitors.size, searches, exports };
    };

    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let results = 0;
    const sourceTotals = new Map<SourceId, { used: number; failed: number; partial: number }>();
    for (const d of this.days.values()) {
      completed += d.completed;
      failed += d.failed;
      cancelled += d.cancelled;
      results += d.results;
      for (const [id, row] of Object.entries(d.sources) as [SourceId, { used: number; failed: number; partial: number }][]) {
        const sum = sourceTotals.get(id) ?? { used: 0, failed: 0, partial: 0 };
        sum.used += row.used;
        sum.failed += row.failed;
        sum.partial += row.partial;
        sourceTotals.set(id, sum);
      }
    }

    const sources: UsageSourceRow[] = SOURCE_IDS.filter((id) => sourceTotals.has(id)).map((id) => ({ source: id, label: SOURCE_LABELS[id], ...sourceTotals.get(id)! }));

    return {
      generatedAt: this.now().toISOString(),
      timezone: this.timezone,
      trackingSince: this.createdAt,
      persistent: this.persistent,
      retentionDays: this.retentionDays,
      today: window([this.dateKey()]),
      last7Days: window(this.recentDates(7)),
      last30Days: window(this.recentDates(30)),
      allTime: { ...window(allKeys), completed, failed, cancelled, averageResultsPerSearch: completed > 0 ? Math.round(results / completed) : 0 },
      daily,
      sources,
    };
  }

  // ---------- Lưu trữ ----------

  flush(): void {
    if (!this.filePath || !this.dirty) return;
    try {
      this.prune();
      const data: PersistedFile = {
        version: 1,
        secret: this.secret,
        createdAt: this.createdAt,
        days: Object.fromEntries([...this.days].map(([date, d]) => [date, { ...d, visitors: [...d.visitors] }])),
      };
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), 'utf8');
      renameSync(tmp, this.filePath); // ghi nguyên tử: không để lại file hỏng nếu bị tắt giữa chừng
      this.dirty = false;
    } catch (error) {
      this.logger.error('stats_flush_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.flush();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedFile;
      if (data.version !== 1 || typeof data.secret !== 'string' || typeof data.days !== 'object') throw new Error('định dạng không hợp lệ');
      this.secret = data.secret;
      this.createdAt = data.createdAt ?? this.createdAt;
      for (const [date, d] of Object.entries(data.days)) {
        this.days.set(date, { ...emptyDay(), ...d, visitors: new Set(d.visitors ?? []) });
      }
    } catch (error) {
      // File hỏng: giữ lại bản sao để kiểm tra rồi bắt đầu lại, không làm sập ứng dụng.
      this.logger.error('stats_load_failed', { error: error instanceof Error ? error.message : String(error) });
      try {
        renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
      } catch {
        /* bỏ qua */
      }
      this.days.clear();
    }
  }

  // ---------- Nội bộ ----------

  private dateKey(date: Date = this.now()): string {
    return this.dateFormat.format(date); // en-CA -> YYYY-MM-DD
  }

  private recentDates(count: number): string[] {
    const out: string[] = [];
    const base = this.now().getTime();
    for (let i = count - 1; i >= 0; i--) out.push(this.dateKey(new Date(base - i * 86_400_000)));
    return [...new Set(out)];
  }

  private today(): DayRecord {
    const key = this.dateKey();
    let day = this.days.get(key);
    if (!day) {
      day = emptyDay();
      this.days.set(key, day);
    }
    this.dirty = true;
    return day;
  }

  private prune(): void {
    const keep = new Set(this.recentDates(this.retentionDays));
    for (const key of [...this.days.keys()]) if (!keep.has(key)) this.days.delete(key);
  }

  private safely(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.logger.error('stats_record_failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

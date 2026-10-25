import type { SourceHealth } from '../../../shared/types.js';
import { toUpstreamError } from '../lib/errors.js';
import type { AdapterMap } from './search.js';

/** Kiểm tra kết nối tới từng nguồn, có cache ngắn để header của giao diện không làm quá tải API. */
export class SourceHealthService {
  private cached?: { at: number; value: SourceHealth[] };

  constructor(
    private readonly adapters: AdapterMap,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  async check(force = false): Promise<SourceHealth[]> {
    if (!force && this.cached && this.now() - this.cached.at < this.ttlMs) return this.cached.value;

    const value = await Promise.all(
      Object.values(this.adapters)
        .filter((adapter): adapter is NonNullable<typeof adapter> => adapter !== undefined)
        .map(async (adapter): Promise<SourceHealth> => {
        const started = this.now();
        const checkedAt = new Date().toISOString();
        try {
          await adapter.ping();
          return { source: adapter.id, label: adapter.label, ok: true, latencyMs: this.now() - started, checkedAt };
        } catch (error) {
          return { source: adapter.id, label: adapter.label, ok: false, message: toUpstreamError(error).message, checkedAt };
        }
      }),
    );
    this.cached = { at: this.now(), value };
    return value;
  }
}

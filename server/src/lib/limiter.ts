import { UpstreamError } from './errors.js';

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function cancelled(): UpstreamError {
  return new UpstreamError('cancelled', 'Tác vụ đã bị hủy.');
}

/**
 * Giới hạn số request đồng thời và khoảng cách tối thiểu giữa hai lần bắt đầu request,
 * để không vượt giới hạn tốc độ của API (Crossref: 3 req/s, 3 đồng thời).
 */
export class Limiter {
  private active = 0;
  private waiters: Array<() => void> = [];
  private nextStart = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly minIntervalMs: number,
    private readonly sleepFn: typeof sleep = sleep,
  ) {}

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      const now = Date.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.minIntervalMs;
      if (start > now) await this.sleepFn(start - now, signal);
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(cancelled());
      };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next(); // chuyển nguyên slot cho người chờ, `active` giữ nguyên
    else this.active--;
  }
}

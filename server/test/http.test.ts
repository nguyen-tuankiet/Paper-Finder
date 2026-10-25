import { describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '../src/lib/errors.js';
import { Limiter } from '../src/lib/limiter.js';
import { TtlCache } from '../src/lib/cache.js';
import { jsonResponse, makeHttp, mockFetch } from './helpers.js';

const opts = { source: 'Test' };

describe('HttpClient', () => {
  it('trả về JSON khi thành công', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ ok: true }));
    await expect(makeHttp(fetchMock).getJson('https://x/y', opts)).resolves.toEqual({ ok: true });
  });

  it('thử lại khi gặp 503 rồi thành công', async () => {
    const fetchMock = mockFetch(() => jsonResponse('', { status: 503 }), () => jsonResponse('', { status: 502 }), () => jsonResponse({ ok: 1 }));
    await expect(makeHttp(fetchMock).getJson('https://x/y', opts)).resolves.toEqual({ ok: 1 });
    expect(fetchMock.calls).toHaveLength(3);
  });

  it('không retry vô hạn: dừng sau maxRetries và báo server_error', async () => {
    const fetchMock = mockFetch(() => jsonResponse('', { status: 500 }));
    await expect(makeHttp(fetchMock, { maxRetries: 2 }).getJson('https://x/y', opts)).rejects.toMatchObject({ code: 'server_error' });
    expect(fetchMock.calls).toHaveLength(3); // 1 lần đầu + 2 lần retry
  });

  it('HTTP 429 với Retry-After ngắn: chờ đúng thời gian rồi thử lại', async () => {
    const sleepFn = vi.fn(async () => {});
    const fetchMock = mockFetch(() => jsonResponse('', { status: 429, headers: { 'retry-after': '2' } }), () => jsonResponse({ ok: 1 }));
    await expect(makeHttp(fetchMock, { sleepFn }).getJson('https://x/y', opts)).resolves.toEqual({ ok: 1 });
    expect(sleepFn).toHaveBeenCalledWith(2000, undefined);
  });

  it('HTTP 429 với Retry-After rất dài (hết hạn mức ngày): không chờ, báo rate_limited', async () => {
    const fetchMock = mockFetch(() => jsonResponse('', { status: 429, headers: { 'retry-after': '40000' } }));
    const error = await makeHttp(fetchMock).getJson('https://x/y', opts).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect((error as Error).message).toContain('giờ');
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('HTTP 4xx (không phải 429) không retry', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ error: 'bad filter' }, { status: 400 }));
    await expect(makeHttp(fetchMock).getJson('https://x/y', opts)).rejects.toMatchObject({ code: 'client_error', status: 400 });
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('401/403 -> auth, không retry', async () => {
    const fetchMock = mockFetch(() => jsonResponse('', { status: 403 }));
    await expect(makeHttp(fetchMock).getJson('https://x/y', opts)).rejects.toMatchObject({ code: 'auth' });
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('lỗi mạng -> network (có retry)', async () => {
    const fetchMock = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(makeHttp(fetchMock, { maxRetries: 1 }).getJson('https://x/y', opts)).rejects.toMatchObject({ code: 'network' });
    expect(fetchMock.calls).toHaveLength(2);
  });

  it('timeout -> timeout', async () => {
    const fetchMock = mockFetch((_url, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(makeHttp(fetchMock, { timeoutMs: 20, maxRetries: 0 }).getJson('https://x/y', opts)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('người dùng hủy -> cancelled, không retry', async () => {
    const controller = new AbortController();
    const fetchMock = mockFetch((_url, init) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const promise = makeHttp(fetchMock).getJson('https://x/y', { ...opts, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock.calls).toHaveLength(1);
  });

  it('phản hồi không phải JSON -> bad_response', async () => {
    const fetchMock = mockFetch(() => new Response('<html>oops</html>', { status: 200 }));
    await expect(makeHttp(fetchMock).getJson('https://x/y', opts)).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('cache: cùng URL chỉ gọi mạng một lần', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ n: 1 }));
    const http = makeHttp(fetchMock, { cacheTtlMs: 60_000 });
    await http.getJson('https://x/y', opts);
    await http.getJson('https://x/y', opts);
    expect(fetchMock.calls).toHaveLength(1);
    await http.getJson('https://x/y', { ...opts, useCache: false });
    expect(fetchMock.calls).toHaveLength(2);
  });
});

describe('Limiter', () => {
  it('không vượt quá số request đồng thời', async () => {
    const limiter = new Limiter(2, 0);
    let active = 0;
    let peak = 0;
    const task = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
    };
    await Promise.all(Array.from({ length: 6 }, () => limiter.run(task)));
    expect(peak).toBe(2);
  });

  it('giãn cách tối thiểu giữa các lần bắt đầu', async () => {
    const limiter = new Limiter(5, 30);
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 3 }, () => limiter.run(async () => void starts.push(Date.now()))));
    starts.sort((a, b) => a - b);
    // So với lần chạy đầu (không phải chờ) để không phụ thuộc việc timer bị bắn dồn khi máy bận.
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(25);
    expect(starts[2]! - starts[0]!).toBeGreaterThanOrEqual(55);
  });

  it('hủy khi đang xếp hàng', async () => {
    const limiter = new Limiter(1, 0);
    const controller = new AbortController();
    const blocker = limiter.run(() => new Promise((r) => setTimeout(r, 30)));
    const queued = limiter.run(async () => 'x', controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ code: 'cancelled' });
    await blocker;
  });
});

describe('TtlCache', () => {
  it('hết hạn và giới hạn số phần tử', () => {
    let now = 0;
    const cache = new TtlCache<number>(2, () => now);
    cache.set('a', 1, 100);
    cache.set('b', 2, 100);
    cache.set('c', 3, 100);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    now = 101;
    expect(cache.get('c')).toBeUndefined();
  });
});

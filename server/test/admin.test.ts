import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UsageReport } from '../../shared/types.js';
import { createApp } from '../src/app.js';
import { UpstreamError } from '../src/lib/errors.js';
import { silentLogger } from '../src/logger.js';
import { StatsService } from '../src/services/stats.js';
import type { SourceAdapter } from '../src/sources/types.js';
import { makeRecord } from './helpers.js';

const PASSWORD = 'mat-khau-admin-123';

const okAdapter: SourceAdapter = {
  id: 'crossref',
  label: 'Crossref',
  ping: async () => {},
  search: async (p) => ({ records: [makeRecord({ title: 'Paper', doi: '10.1/x', queryKeywords: [p.keyword] })] }),
};
const badAdapter: SourceAdapter = {
  id: 'openalex',
  label: 'OpenAlex',
  ping: async () => {},
  search: async () => ({ records: [], error: new UpstreamError('server_error', 'lỗi') }),
};

const body = { keywords: ['bí mật từ khóa'], sources: ['crossref', 'openalex'], maxResults: 20, onlyWithDoi: true };
const record = { title: 'T', doi: '', authors: [], publicationYear: null, journal: '', publisher: '', documentType: '', abstract: '', sources: [], originalUrl: '', queryKeywords: [] };

function start(adminPassword?: string) {
  const stats = new StatsService({ flushIntervalMs: 0 });
  const app = createApp({
    adapters: { crossref: okAdapter, openalex: badAdapter },
    config: { corsOrigins: [], rateLimitPerMinute: 1000, staticDir: undefined, adminPassword },
    logger: silentLogger,
    stats,
  });
  return new Promise<{ server: Server; base: string; stats: StatsService }>((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, stats }));
  });
}

describe('API admin - bật bằng ADMIN_PASSWORD', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start(PASSWORD);
  });
  afterAll(() => {
    ctx.server.closeAllConnections();
    ctx.server.close();
  });

  const get = (headers: Record<string, string> = {}, query = '') => fetch(`${ctx.base}/api/admin/stats${query}`, { headers });
  const auth = { authorization: `Bearer ${PASSWORD}` };

  it('từ chối khi thiếu hoặc sai mật khẩu (401), không lộ dữ liệu', async () => {
    expect((await get()).status).toBe(401);
    expect((await get({ authorization: 'Bearer sai-mat-khau' })).status).toBe(401);
    expect((await get({ authorization: PASSWORD })).status).toBe(401); // thiếu "Bearer "
    const res = await get({ authorization: 'Bearer nope' });
    expect(JSON.stringify(await res.json())).not.toContain('visitors');
  });

  it('đúng mật khẩu -> báo cáo, và số liệu tăng theo hoạt động thật', async () => {
    const before = (await (await get(auth)).json()) as UsageReport;

    const search = await fetch(`${ctx.base}/api/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await search.text();
    const exported = await fetch(`${ctx.base}/api/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'csv', records: [record] }) });
    await exported.arrayBuffer();
    await fetch(`${ctx.base}/api/sources`);

    const res = await get(auth, '?days=7');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const after = (await res.json()) as UsageReport;

    expect(after.today.searches).toBe(before.today.searches + 1);
    expect(after.today.exports).toBe(before.today.exports + 1);
    expect(after.today.visitors).toBe(1); // cùng một máy gọi nhiều API vẫn là một người
    expect(after.daily).toHaveLength(7);
    expect(after.allTime.completed).toBe(1);
    expect(after.sources.find((s) => s.source === 'openalex')).toMatchObject({ used: 1, failed: 1 });
    expect(after.sources.find((s) => s.source === 'crossref')).toMatchObject({ used: 1, failed: 0 });
    // Không lưu hay trả về từ khóa người dùng
    expect(JSON.stringify(after)).not.toContain('bí mật từ khóa');
  });

  it('/api/health do bot giám sát ping không bị tính là người dùng', async () => {
    const fresh = await start(PASSWORD);
    try {
      for (let i = 0; i < 5; i++) await fetch(`${fresh.base}/api/health`);
      const report = (await (await fetch(`${fresh.base}/api/admin/stats`, { headers: auth })).json()) as UsageReport;
      expect(report.today.visitors).toBe(0);
    } finally {
      fresh.server.closeAllConnections();
      fresh.server.close();
    }
  });

  it('chống dò mật khẩu: sai quá 10 lần thì bị chặn (429), kể cả khi sau đó nhập đúng', async () => {
    const fresh = await start(PASSWORD);
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await fetch(`${fresh.base}/api/admin/stats`, { headers: { authorization: 'Bearer sai' } })).status);
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
      expect((await fetch(`${fresh.base}/api/admin/stats`, { headers: auth })).status).toBe(429);
    } finally {
      fresh.server.closeAllConnections();
      fresh.server.close();
    }
  });
});

describe('API admin - tắt khi chưa đặt ADMIN_PASSWORD', () => {
  it('trả 404 dù có gửi mật khẩu nào', async () => {
    const ctx = await start(undefined);
    try {
      expect((await fetch(`${ctx.base}/api/admin/stats`)).status).toBe(404);
      expect((await fetch(`${ctx.base}/api/admin/stats`, { headers: { authorization: 'Bearer anything' } })).status).toBe(404);
    } finally {
      ctx.server.closeAllConnections();
      ctx.server.close();
    }
  });
});

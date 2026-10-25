import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchEvent } from '../../shared/types.js';
import { createApp } from '../src/app.js';
import { UpstreamError } from '../src/lib/errors.js';
import { silentLogger } from '../src/logger.js';
import type { AdapterMap } from '../src/services/search.js';
import type { SourceAdapter } from '../src/sources/types.js';
import { makeRecord } from './helpers.js';

let server: Server;
let base: string;
let slowAborted = false;

const crossref: SourceAdapter = {
  id: 'crossref',
  label: 'Crossref',
  ping: async () => {},
  search: async (p) => {
    if (p.keyword === 'slow query') {
      await new Promise<void>((resolve) => {
        p.signal?.addEventListener('abort', () => {
          slowAborted = true;
          resolve();
        });
      });
      return { records: [], error: new UpstreamError('cancelled', 'hủy') };
    }
    p.onProgress?.(1, 1);
    return { records: [makeRecord({ title: 'Crossref only paper', doi: '10.1/cr', sources: ['crossref'], queryKeywords: [p.keyword] })] };
  },
};
const openalex: SourceAdapter = {
  id: 'openalex',
  label: 'OpenAlex',
  ping: async () => {
    throw new UpstreamError('network', 'Không kết nối được tới OpenAlex.');
  },
  search: async () => ({ records: [], error: new UpstreamError('server_error', 'OpenAlex đang gặp sự cố (HTTP 503).') }),
};

beforeAll(async () => {
  const adapters: AdapterMap = { crossref, openalex };
  const app = createApp({ adapters, config: { corsOrigins: [], rateLimitPerMinute: 1000, staticDir: undefined }, logger: silentLogger });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function readEvents(response: Response): Promise<SearchEvent[]> {
  const text = await response.text();
  return text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as SearchEvent);
}

const validBody = { keywords: ['ai'], sources: ['crossref', 'openalex'], maxResults: 20, onlyWithDoi: true };

describe('POST /api/search', () => {
  it('stream tiến độ và kết quả; một nguồn lỗi vẫn trả kết quả từ nguồn còn lại', async () => {
    const response = await post('/api/search', validBody);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const events = await readEvents(response);
    expect(events.some((e) => e.type === 'progress')).toBe(true);
    const result = events.find((e) => e.type === 'result');
    expect(result?.type === 'result' && result.result.records.map((r) => r.doi)).toEqual(['10.1/cr']);
    if (result?.type !== 'result') throw new Error('thiếu kết quả');
    expect(result.result.sources.find((s) => s.source === 'openalex')).toMatchObject({ state: 'error' });
    expect(result.result.stats).toMatchObject({ total: 1, sourcesQueried: 2, sourcesSucceeded: 1 });
  });

  it.each([
    [{ ...validBody, keywords: [] }, 'keywords'],
    [{ ...validBody, keywords: ['a'] }, 'keywords.0'],
    [{ ...validBody, keywords: Array.from({ length: 11 }, (_, i) => `keyword ${i}`) }, 'keywords'],
    [{ ...validBody, sources: [] }, 'sources'],
    [{ ...validBody, sources: ['google'] }, 'sources.0'],
    [{ ...validBody, maxResults: 30 }, 'maxResults'],
    [{ ...validBody, yearFrom: 2025, yearTo: 2020 }, 'yearFrom'],
    [{ ...validBody, extra: 1 }, ''],
  ])('từ chối đầu vào không hợp lệ %j', async (body, path) => {
    const response = await post('/api/search', body);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { issues: { path: string }[] };
    expect(json.issues.some((i) => i.path === path)).toBe(true);
  });

  it('JSON hỏng -> 400', async () => {
    const response = await fetch(base + '/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    expect(response.status).toBe(400);
  });

  it('hủy từ phía client sẽ hủy tác vụ ở backend', async () => {
    const controller = new AbortController();
    const promise = fetch(base + '/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody, keywords: ['slow query'], sources: ['crossref'] }),
      signal: controller.signal,
    });
    const response = await promise;
    controller.abort();
    await response.text().catch(() => '');
    await new Promise((r) => setTimeout(r, 100));
    expect(slowAborted).toBe(true);
  });
});

describe('GET /api/sources', () => {
  it('báo trạng thái từng nguồn, nguồn lỗi không làm sập endpoint', async () => {
    const response = await fetch(base + '/api/sources');
    expect(response.status).toBe(200);
    const sources = (await response.json()) as { source: string; ok: boolean }[];
    expect(sources.find((s) => s.source === 'crossref')?.ok).toBe(true);
    expect(sources.find((s) => s.source === 'openalex')?.ok).toBe(false);
  });
});

describe('POST /api/export', () => {
  const record = {
    title: 'Bài báo tiếng Việt',
    doi: '10.1000/xyz',
    authors: [{ name: 'Nguyễn An' }],
    publicationYear: 2024,
    journal: 'J',
    publisher: 'P',
    documentType: 'journal-article',
    abstract: 'Tóm tắt',
    sources: ['crossref'],
    originalUrl: 'https://doi.org/10.1000/xyz',
    queryKeywords: ['ai'],
  };

  it('xuất CSV với BOM và header tải về', async () => {
    const response = await post('/api/export', { format: 'csv', records: [record] });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/paperfinder_results_\d{4}-\d{2}-\d{2}\.csv/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toContain('Bài báo tiếng Việt');
  });

  it('xuất XLSX mở được bằng ExcelJS', async () => {
    const response = await post('/api/export', { format: 'xlsx', records: [record, { ...record, doi: '' }] });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0]!.rowCount).toBe(3);
  });

  it('từ chối danh sách rỗng hoặc định dạng lạ', async () => {
    expect((await post('/api/export', { format: 'csv', records: [] })).status).toBe(400);
    expect((await post('/api/export', { format: 'pdf', records: [record] })).status).toBe(400);
  });
});

describe('khác', () => {
  it('health và 404 cho API không tồn tại', async () => {
    expect((await fetch(base + '/api/health')).status).toBe(200);
    expect((await fetch(base + '/api/nope')).status).toBe(404);
  });
});

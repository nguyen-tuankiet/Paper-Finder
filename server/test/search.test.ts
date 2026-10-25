import { describe, expect, it } from 'vitest';
import type { SearchRequest } from '../../shared/types.js';
import { UpstreamError } from '../src/lib/errors.js';
import { runSearch, type AdapterMap } from '../src/services/search.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from '../src/sources/types.js';
import { makeRecord } from './helpers.js';

function fakeAdapter(id: 'crossref' | 'openalex', impl: (p: AdapterSearchParams) => Promise<AdapterResult>): SourceAdapter {
  return { id, label: id === 'crossref' ? 'Crossref' : 'OpenAlex', search: impl, ping: async () => {} };
}

const request: SearchRequest = { keywords: ['ai education', 'machine learning'], sources: ['crossref', 'openalex'], maxResults: 20, onlyWithDoi: true };

const rec = (source: 'crossref' | 'openalex', doi: string, keyword: string) =>
  makeRecord({ title: `Paper ${doi}`, doi, sources: [source], queryKeywords: [keyword] });

describe('runSearch', () => {
  it('tìm ở cả hai nguồn, loại trùng theo DOI và thống kê đúng', async () => {
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async (p) => ({ records: [rec('crossref', '10.1/a', p.keyword), rec('crossref', '10.1/b', p.keyword)] })),
      openalex: fakeAdapter('openalex', async (p) => ({ records: [rec('openalex', '10.1/a', p.keyword), rec('openalex', '10.1/c', p.keyword)] })),
    };
    const result = await runSearch(request, { adapters });
    // thô: 2 nguồn x 2 từ khóa x 2 = 8 bản ghi; duy nhất: a, b, c
    expect(result.records.map((r) => r.doi).sort()).toEqual(['10.1/a', '10.1/b', '10.1/c']);
    expect(result.stats).toMatchObject({ total: 3, withDoi: 3, withoutDoi: 0, duplicatesRemoved: 5, sourcesQueried: 2, sourcesSucceeded: 2 });
    const a = result.records.find((r) => r.doi === '10.1/a')!;
    expect(a.sources).toEqual(['crossref', 'openalex']);
    expect(a.queryKeywords).toEqual(['ai education', 'machine learning']);
    expect(result.sources.every((s) => s.state === 'ok')).toBe(true);
  });

  it('một nguồn lỗi, nguồn còn lại vẫn trả kết quả', async () => {
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async () => ({ records: [], error: new UpstreamError('server_error', 'Crossref đang gặp sự cố (HTTP 503).') })),
      openalex: fakeAdapter('openalex', async (p) => ({ records: [rec('openalex', '10.1/c', p.keyword)] })),
    };
    const result = await runSearch(request, { adapters });
    expect(result.records).toHaveLength(1);
    expect(result.stats.sourcesSucceeded).toBe(1);
    const crossref = result.sources.find((s) => s.source === 'crossref')!;
    expect(crossref.state).toBe('error');
    expect(crossref.errors[0]).toMatchObject({ code: 'server_error' });
  });

  it('adapter ném lỗi bất ngờ cũng không làm sập tìm kiếm', async () => {
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async () => {
        throw new Error('boom');
      }),
      openalex: fakeAdapter('openalex', async (p) => ({ records: [rec('openalex', '10.1/c', p.keyword)] })),
    };
    const result = await runSearch(request, { adapters });
    expect(result.records).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ source: 'crossref', state: 'error' });
  });

  it('tất cả nguồn lỗi -> không có kết quả, sourcesSucceeded = 0', async () => {
    const failing = (id: 'crossref' | 'openalex') => fakeAdapter(id, async () => ({ records: [], error: new UpstreamError('network', 'Không kết nối được.') }));
    const result = await runSearch(request, { adapters: { crossref: failing('crossref'), openalex: failing('openalex') } });
    expect(result.records).toEqual([]);
    expect(result.stats).toMatchObject({ total: 0, sourcesSucceeded: 0, sourcesQueried: 2 });
  });

  it('lỗi một phần: từ khóa đầu thành công, từ khóa sau lỗi -> trạng thái partial', async () => {
    let calls = 0;
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async (p) => {
        calls++;
        return calls === 1
          ? { records: [rec('crossref', '10.1/a', p.keyword)] }
          : { records: [], error: new UpstreamError('timeout', 'Crossref không phản hồi.') };
      }),
      openalex: fakeAdapter('openalex', async () => ({ records: [] })),
    };
    const result = await runSearch(request, { adapters });
    expect(result.sources[0]).toMatchObject({ source: 'crossref', state: 'partial' });
    expect(result.stats.sourcesSucceeded).toBe(2);
  });

  it('hết hạn mức (rate_limited) -> dừng sớm các từ khóa còn lại của nguồn đó', async () => {
    let calls = 0;
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async () => ({ records: [] })),
      openalex: fakeAdapter('openalex', async () => {
        calls++;
        return { records: [], error: new UpstreamError('rate_limited', 'Hết hạn mức.') };
      }),
    };
    await runSearch(request, { adapters });
    expect(calls).toBe(1);
  });

  it('chỉ gọi các nguồn được chọn và báo tiến độ', async () => {
    const crossrefCalled: string[] = [];
    const progress: string[] = [];
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async (p) => {
        crossrefCalled.push(p.keyword);
        p.onProgress?.(5, 20);
        return { records: [] };
      }),
      openalex: fakeAdapter('openalex', async () => {
        throw new Error('không được gọi');
      }),
    };
    await runSearch({ ...request, sources: ['crossref'] }, { adapters, onProgress: (p) => progress.push(`${p.source}:${p.keyword}:${p.fetched}/${p.target}:${p.done}`) });
    expect(crossrefCalled).toEqual(['ai education', 'machine learning']);
    expect(progress).toContain('crossref:ai education:5/20:false');
    expect(progress).toContain('crossref:machine learning:0/0:true');
  });

  it('hủy tác vụ -> ném cancelled', async () => {
    const controller = new AbortController();
    const adapters: AdapterMap = {
      crossref: fakeAdapter('crossref', async () => {
        controller.abort();
        return { records: [], error: new UpstreamError('cancelled', 'Tác vụ đã bị hủy.') };
      }),
      openalex: fakeAdapter('openalex', async () => ({ records: [] })),
    };
    await expect(runSearch(request, { adapters, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});

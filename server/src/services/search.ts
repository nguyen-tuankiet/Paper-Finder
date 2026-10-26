import type {
  PaperRecord,
  SearchRequest,
  SearchResult,
  SourceErrorInfo,
  SourceId,
  SourceState,
  SourceStatus,
} from '../../../shared/types.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import { silentLogger, type Logger } from '../logger.js';
import type { SourceAdapter } from '../sources/types.js';
import { dedupeRecords } from './dedupe.js';

/** Chỉ gồm các nguồn đang được bật trên máy chủ (một số nguồn cần API key). */
export type AdapterMap = Partial<Record<SourceId, SourceAdapter>>;

export interface SearchProgress {
  source: SourceId;
  keyword: string;
  fetched: number;
  target: number;
  done: boolean;
}

export interface RunSearchOptions {
  adapters: AdapterMap;
  signal?: AbortSignal;
  onProgress?: (progress: SearchProgress) => void;
  logger?: Logger;
  now?: () => Date;
  /** Ký URL PDF để client có thể xin máy chủ chuyển tiếp file qua /api/download. */
  signUrl?: (url: string) => string;
}

interface SourceRun {
  records: PaperRecord[];
  errors: SourceErrorInfo[];
  succeededKeywords: number;
}

async function runSource(adapter: SourceAdapter, request: SearchRequest, options: RunSearchOptions): Promise<SourceRun> {
  const run: SourceRun = { records: [], errors: [], succeededKeywords: 0 };

  // Các từ khóa của cùng một nguồn chạy tuần tự để không vượt giới hạn tốc độ.
  for (const keyword of request.keywords) {
    if (options.signal?.aborted) break;
    try {
      const result = await adapter.search({
        keyword,
        maxResults: request.maxResults,
        yearFrom: request.yearFrom,
        yearTo: request.yearTo,
        onlyWithDoi: request.onlyWithDoi,
        signal: options.signal,
        onProgress: (fetched, target) =>
          options.onProgress?.({ source: adapter.id, keyword, fetched, target, done: false }),
      });
      run.records.push(...result.records);
      if (result.error) {
        if (result.error.code === 'cancelled') break;
        run.errors.push({ keyword, code: result.error.code, message: result.error.message });
        // Hết hạn mức hoặc bị từ chối -> các từ khóa sau gần như chắc chắn cũng lỗi, dừng sớm để không lãng phí.
        if (result.error.code === 'rate_limited' || result.error.code === 'auth') break;
      } else {
        run.succeededKeywords++;
      }
      options.onProgress?.({ source: adapter.id, keyword, fetched: result.records.length, target: result.records.length, done: true });
    } catch (error) {
      const upstream = toUpstreamError(error);
      options.logger?.error('adapter_unexpected_error', { source: adapter.id, error: upstream.message });
      run.errors.push({ keyword, code: 'internal', message: upstream.message });
    }
  }
  return run;
}

/** 'partial' = có lỗi nhưng vẫn lấy được một phần dữ liệu; 'error' = không lấy được gì. */
function sourceState(run: SourceRun): SourceState {
  if (run.errors.length === 0) return 'ok';
  return run.succeededKeywords > 0 || run.records.length > 0 ? 'partial' : 'error';
}

/**
 * Điều phối một lần tìm kiếm: các nguồn chạy song song, mỗi nguồn lỗi độc lập (một nguồn lỗi
 * không làm hỏng nguồn còn lại), sau đó gộp, loại trùng và thống kê.
 */
export async function runSearch(request: SearchRequest, options: RunSearchOptions): Promise<SearchResult> {
  const logger = options.logger ?? silentLogger;
  const now = options.now ?? (() => new Date());
  const adapters = request.sources.flatMap((id) => options.adapters[id] ?? []);

  const runs = await Promise.all(adapters.map((adapter) => runSource(adapter, request, options)));
  if (options.signal?.aborted) throw new UpstreamError('cancelled', 'Tác vụ đã bị hủy.');

  const sources: SourceStatus[] = adapters.map((adapter, index) => {
    const run = runs[index]!;
    return {
      source: adapter.id,
      label: adapter.label,
      state: sourceState(run),
      fetched: run.records.length,
      errors: run.errors,
    };
  });

  const raw = runs.flatMap((run) => run.records);
  const deduped = dedupeRecords(raw);
  const { duplicatesRemoved, suspectedDuplicates } = deduped;
  const records = options.signUrl
    ? deduped.records.map((r) => (r.oaPdfUrl ? { ...r, oaPdfSig: options.signUrl!(r.oaPdfUrl) } : r))
    : deduped.records;
  const withDoi = records.filter((record) => record.doi).length;

  logger.info('search_finished', {
    keywords: request.keywords.length,
    sources: request.sources,
    raw: raw.length,
    unique: records.length,
    sourceStates: sources.map((s) => `${s.source}:${s.state}`),
  });

  return {
    records,
    stats: {
      total: records.length,
      withDoi,
      withoutDoi: records.length - withDoi,
      duplicatesRemoved,
      sourcesQueried: sources.length,
      sourcesSucceeded: sources.filter((s) => s.state !== 'error').length,
    },
    sources,
    suspectedDuplicates,
    request,
    finishedAt: now().toISOString(),
  };
}

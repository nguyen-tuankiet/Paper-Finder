import type { PaperRecord, SearchResult, SourceStatus } from '../../../shared/types.js';
import { isValidDoi, normalizeDoi } from '../lib/doi.js';
import { UpstreamError } from '../lib/errors.js';
import type { SourceAdapter } from '../sources/types.js';
import { dedupeRecords, mergeRecords } from './dedupe.js';
import type { AdapterMap } from './search.js';

const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>]+/gi;

/** Bỏ dấu câu dính ở cuối DOI khi dán từ văn bản ("...abc." hoặc "(doi:10.1/abc)"), nhưng giữ ngoặc cân bằng như trong DOI thật. */
function trimTrailing(candidate: string): string {
  let value = candidate;
  for (;;) {
    const last = value[value.length - 1];
    if (!last) return value;
    if (/[.,;:!?'"]/.test(last)) value = value.slice(0, -1);
    else if (last === ')' && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) value = value.slice(0, -1);
    else if (last === ']' && (value.match(/\[/g)?.length ?? 0) < (value.match(/\]/g)?.length ?? 0)) value = value.slice(0, -1);
    else return value;
  }
}

export interface ExtractedDois {
  /** DOI hợp lệ đã chuẩn hóa, không trùng, theo thứ tự xuất hiện. */
  dois: string[];
  /** Dòng có nội dung nhưng không tìm thấy DOI nào. */
  invalid: string[];
  /** Số DOI trùng đã bị bỏ. */
  duplicates: number;
}

/** Lấy các DOI từ văn bản người dùng dán (mỗi dòng một DOI, link doi.org hoặc cả đoạn tài liệu tham khảo). */
export function extractDois(text: string): ExtractedDois {
  const seen = new Set<string>();
  const dois: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const found = (line.match(DOI_IN_TEXT) ?? []).map((m) => normalizeDoi(trimTrailing(m))).filter((d) => d && isValidDoi(d));
    if (found.length === 0) {
      invalid.push(line.length > 120 ? `${line.slice(0, 117)}...` : line);
      continue;
    }
    for (const doi of found) {
      if (seen.has(doi)) duplicates++;
      else {
        seen.add(doi);
        dois.push(doi);
      }
    }
  }
  return { dois, invalid, duplicates };
}

export interface LookupOptions {
  adapters: AdapterMap;
  signal?: AbortSignal;
  /** Số DOI tra đồng thời (mỗi nguồn vẫn tuân theo bộ giới hạn tốc độ riêng). */
  concurrency?: number;
  now?: () => Date;
  signUrl?: (url: string) => string;
}

export interface LookupOutcome {
  result: SearchResult;
  /** DOI mà các nguồn đều không có. */
  notFound: string[];
  /** DOI tra lỗi (mạng, hết hạn mức...): thử lại sau có thể được. */
  failed: string[];
}

type Found = { doi: string; record: PaperRecord } | { doi: string; missing: true } | { doi: string; failed: true };

async function lookupOne(doi: string, adapters: SourceAdapter[], signal?: AbortSignal): Promise<Found> {
  // Hỏi các nguồn song song: Crossref cho thư mục chuẩn, OpenAlex bổ sung truy cập mở, số trích dẫn, cờ rút lại.
  const settled = await Promise.allSettled(adapters.map((a) => a.lookupDoi!(doi, signal)));
  const records = settled.flatMap((s) => (s.status === 'fulfilled' && s.value ? [s.value] : []));
  if (records.length > 0) return { doi, record: records.length === 1 ? records[0]! : mergeRecords(records) };
  const errors = settled.filter((s) => s.status === 'rejected');
  // Chỉ coi là "không có" khi mọi nguồn trả lời rõ là không có; có nguồn lỗi thì để người dùng thử lại.
  return errors.length > 0 ? { doi, failed: true } : { doi, missing: true };
}

/** Tra danh sách DOI và trả về cùng dạng kết quả tìm kiếm để giao diện dùng lại bảng, xuất file và trích dẫn. */
export async function lookupDois(dois: string[], options: LookupOptions): Promise<LookupOutcome> {
  const now = options.now ?? (() => new Date());
  const adapters = Object.values(options.adapters).filter((a): a is SourceAdapter => Boolean(a?.lookupDoi));
  const results: Found[] = new Array<Found>(dois.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < dois.length) {
      if (options.signal?.aborted) throw new UpstreamError('cancelled', 'Tác vụ đã bị hủy.');
      const index = next++;
      results[index] = await lookupOne(dois[index]!, adapters, options.signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, dois.length) }, worker));

  const found = results.flatMap((r) => ('record' in r ? [r.record] : []));
  const notFound = results.flatMap((r) => ('missing' in r ? [r.doi] : []));
  const failed = results.flatMap((r) => ('failed' in r ? [r.doi] : []));
  const deduped = dedupeRecords(found); // gán id cho bản ghi; giữ nguyên thứ tự nhập
  const records = options.signUrl ? deduped.records.map((r) => (r.oaPdfUrl ? { ...r, oaPdfSig: options.signUrl!(r.oaPdfUrl) } : r)) : deduped.records;

  const sources: SourceStatus[] = adapters.map((a) => ({ source: a.id, label: a.label, state: 'ok', fetched: found.filter((r) => r.sources.includes(a.id)).length, errors: [] }));
  const withDoi = records.filter((r) => r.doi).length;
  return {
    result: {
      records,
      stats: { total: records.length, withDoi, withoutDoi: records.length - withDoi, duplicatesRemoved: 0, sourcesQueried: adapters.length, sourcesSucceeded: adapters.length },
      sources,
      suspectedDuplicates: [],
      request: { keywords: ['Danh sách DOI'], sources: adapters.map((a) => a.id), maxResults: 20, onlyWithDoi: true },
      finishedAt: now().toISOString(),
    },
    notFound,
    failed,
  };
}

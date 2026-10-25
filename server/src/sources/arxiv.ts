import { XMLParser } from 'fast-xml-parser';
import type { PaperRecord } from '../../../shared/types.js';
import { normalizeDoi } from '../lib/doi.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import type { HttpClient } from '../lib/http.js';
import type { Limiter } from '../lib/limiter.js';
import { cleanAbstract, cleanText, safeHttpUrl } from '../lib/text.js';
import { Collector, toYear, xmlText } from './collector.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from './types.js';

const PAGE_SIZE = 100;
const STOPWORDS = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

const parser = new XMLParser({
  ignoreAttributes: true,
  isArray: (name) => name === 'entry' || name === 'author',
  parseTagValue: false, // giữ nguyên chuỗi, tránh biến "1234.5678" thành số
});

interface ArxivEntry {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  published?: unknown;
  author?: { name?: unknown }[];
  'arxiv:doi'?: unknown;
}

export function arxivIdFrom(url: string): string {
  return url.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').replace(/v\d+$/i, '');
}

export function mapArxivEntry(raw: unknown, keyword: string, retrievedAt: string): PaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as ArxivEntry;
  const idUrl = xmlText(entry.id).trim();
  if (!idUrl) return null;
  const arxivId = arxivIdFrom(idUrl);
  const url = safeHttpUrl(`https://arxiv.org/abs/${arxivId}`);

  return {
    id: '',
    title: cleanText(xmlText(entry.title)),
    // Chỉ dùng DOI do tác giả khai báo trong arXiv (DOI của bản đã xuất bản); không tự suy ra DOI của arXiv.
    doi: normalizeDoi(xmlText(entry['arxiv:doi'])),
    authors: (Array.isArray(entry.author) ? entry.author : [])
      .map((a) => cleanText(xmlText(a?.name)))
      .filter(Boolean)
      .map((name) => ({ name })),
    publicationYear: toYear(xmlText(entry.published)),
    journal: 'arXiv',
    publisher: '',
    documentType: 'preprint',
    isPreprint: true,
    abstract: cleanAbstract(xmlText(entry.summary)),
    sources: ['arxiv'],
    sourceRefs: [{ source: 'arxiv', sourceId: arxivId, url }],
    originalUrl: url,
    queryKeywords: [keyword],
    retrievedAt,
  };
}

export interface ArxivOptions {
  http: HttpClient;
  limiter: Limiter;
  baseUrl?: string;
  now?: () => Date;
}

export class ArxivAdapter implements SourceAdapter {
  readonly id = 'arxiv' as const;
  readonly label = 'arXiv';
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: ArxivOptions) {
    this.baseUrl = options.baseUrl ?? 'https://export.arxiv.org/api/query';
    this.now = options.now ?? (() => new Date());
  }

  buildQuery(params: AdapterSearchParams): string {
    const words = params.keyword.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
    const meaningful = words.filter((w) => !STOPWORDS.has(w));
    const terms = (meaningful.length > 0 ? meaningful : words).map((w) => `all:${w}`);
    let query = terms.join(' AND ') || 'all:' + params.keyword;
    if (params.yearFrom || params.yearTo) {
      const from = `${params.yearFrom ?? 1991}01010000`;
      const to = `${params.yearTo ?? 9999}12312359`;
      query += ` AND submittedDate:[${from} TO ${to}]`;
    }
    return query;
  }

  buildUrl(params: AdapterSearchParams, start: number, count: number): string {
    const query = new URLSearchParams({
      search_query: this.buildQuery(params),
      start: String(start),
      max_results: String(count),
      sortBy: 'relevance',
      sortOrder: 'descending',
    });
    return `${this.baseUrl}?${query.toString()}`;
  }

  private parseFeed(xml: string): { entries: unknown[]; total: number } {
    let doc: { feed?: Record<string, unknown> };
    try {
      doc = parser.parse(xml) as typeof doc;
    } catch {
      throw new UpstreamError('bad_response', 'arXiv trả về dữ liệu XML không hợp lệ.');
    }
    const feed = doc?.feed;
    if (!feed || typeof feed !== 'object') throw new UpstreamError('bad_response', 'arXiv trả về cấu trúc dữ liệu không như mong đợi.');
    const entries = Array.isArray(feed.entry) ? (feed.entry as ArxivEntry[]) : [];
    // Khi truy vấn sai, arXiv trả về 1 entry có id dạng .../api/errors#...
    if (entries.length === 1 && xmlText(entries[0]?.id).includes('/api/errors')) {
      throw new UpstreamError('client_error', `arXiv từ chối truy vấn: ${cleanText(xmlText(entries[0]?.summary)).slice(0, 150)}`);
    }
    const total = Number(xmlText(feed['opensearch:totalResults']));
    return { entries, total: Number.isFinite(total) ? total : entries.length };
  }

  async search(params: AdapterSearchParams): Promise<AdapterResult> {
    const collector = new Collector(params.maxResults, params.onlyWithDoi);
    const retrievedAt = this.now().toISOString();
    let target = params.maxResults;
    let start = 0;

    try {
      // Với onlyWithDoi, phần lớn bài arXiv bị loại nên duyệt nhiều trang hơn, nhưng vẫn có giới hạn để không quá chậm.
      const maxPages = params.onlyWithDoi ? 10 : Math.ceil(params.maxResults / PAGE_SIZE);
      for (let page = 0; !collector.full && page < maxPages; page++) {
        const count = params.onlyWithDoi ? PAGE_SIZE : Math.min(PAGE_SIZE, params.maxResults - collector.records.length);
        const xml = await this.options.http.getText(this.buildUrl(params, start, count), {
          source: this.label,
          limiter: this.options.limiter,
          signal: params.signal,
        });
        const { entries, total } = this.parseFeed(xml);
        if (!params.onlyWithDoi) target = Math.min(target, total);

        for (const raw of entries) collector.add(mapArxivEntry(raw, params.keyword, retrievedAt));
        start += entries.length;
        params.onProgress?.(Math.min(collector.records.length, target), target);
        if (entries.length < count || start >= total) break;
      }
      return { records: collector.records };
    } catch (error) {
      return { records: collector.records, error: toUpstreamError(error) };
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    const xml = await this.options.http.getText(`${this.baseUrl}?search_query=all:test&max_results=1`, {
      source: this.label,
      signal,
      limiter: this.options.limiter,
      useCache: false,
      maxRetries: 0,
      timeoutMs: 10000,
    });
    this.parseFeed(xml);
  }
}

import type { PaperRecord } from '../../../shared/types.js';
import { doiUrl, normalizeDoi } from '../lib/doi.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import type { HttpClient } from '../lib/http.js';
import type { Limiter } from '../lib/limiter.js';
import { cleanAbstract, cleanText, safeHttpUrl } from '../lib/text.js';
import { Collector, plainQuery, toYear } from './collector.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from './types.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 30;

interface DoajBibjson {
  title?: string;
  year?: string | number;
  abstract?: string;
  author?: { name?: string; orcid_id?: string }[];
  identifier?: { id?: string; type?: string }[];
  link?: { type?: string; url?: string }[];
  journal?: { title?: string; publisher?: string };
}

interface DoajResponse {
  total?: number;
  results?: unknown[];
}

export function mapDoajArticle(raw: unknown, keyword: string, retrievedAt: string): PaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as { id?: string; bibjson?: DoajBibjson };
  const bib = item.bibjson;
  if (!bib || typeof bib !== 'object') return null;

  const doiId = Array.isArray(bib.identifier) ? bib.identifier.find((i) => i?.type === 'doi')?.id : undefined;
  const doi = normalizeDoi(doiId);
  const fulltext = Array.isArray(bib.link) ? (bib.link.find((l) => l?.type === 'fulltext') ?? bib.link[0]) : undefined;
  const pageUrl = item.id ? `https://doaj.org/article/${encodeURIComponent(item.id)}` : '';

  return {
    id: '',
    title: cleanText(bib.title),
    doi,
    authors: (Array.isArray(bib.author) ? bib.author : [])
      .map((a) => cleanText(a?.name))
      .filter(Boolean)
      .map((name) => ({ name })),
    publicationYear: toYear(bib.year),
    journal: cleanText(bib.journal?.title),
    publisher: cleanText(bib.journal?.publisher),
    documentType: '', // DOAJ không cung cấp loại tài liệu trong bản ghi
    isPreprint: false,
    abstract: cleanAbstract(bib.abstract),
    sources: ['doaj'],
    sourceRefs: item.id ? [{ source: 'doaj', sourceId: item.id, url: pageUrl }] : [],
    originalUrl: safeHttpUrl(fulltext?.url) || (doi ? doiUrl(doi) : pageUrl),
    queryKeywords: [keyword],
    retrievedAt,
  };
}

export interface DoajOptions {
  http: HttpClient;
  limiter: Limiter;
  baseUrl?: string;
  now?: () => Date;
}

export class DoajAdapter implements SourceAdapter {
  readonly id = 'doaj' as const;
  readonly label = 'DOAJ';
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: DoajOptions) {
    this.baseUrl = options.baseUrl ?? 'https://doaj.org/api/search';
    this.now = options.now ?? (() => new Date());
  }

  buildQuery(params: AdapterSearchParams): string {
    let query = `(${plainQuery(params.keyword) || params.keyword})`;
    if (params.yearFrom || params.yearTo) query += ` AND bibjson.year:[${params.yearFrom ?? 1000} TO ${params.yearTo ?? 3000}]`;
    return query;
  }

  buildUrl(params: AdapterSearchParams, pageSize: number, page: number): string {
    return `${this.baseUrl}/articles/${encodeURIComponent(this.buildQuery(params))}?pageSize=${pageSize}&page=${page}`;
  }

  async search(params: AdapterSearchParams): Promise<AdapterResult> {
    const collector = new Collector(params.maxResults, params.onlyWithDoi);
    const retrievedAt = this.now().toISOString();
    const pageSize = Math.min(PAGE_SIZE, params.maxResults);
    let target = params.maxResults;

    try {
      for (let page = 1; !collector.full && page <= MAX_PAGES; page++) {
        const data = await this.options.http.getJson<DoajResponse>(this.buildUrl(params, pageSize, page), {
          source: this.label,
          limiter: this.options.limiter,
          signal: params.signal,
        });
        if (!data || !Array.isArray(data.results)) {
          throw new UpstreamError('bad_response', 'DOAJ trả về cấu trúc dữ liệu không như mong đợi.');
        }
        if (typeof data.total === 'number') target = Math.min(target, data.total);

        for (const raw of data.results) collector.add(mapDoajArticle(raw, params.keyword, retrievedAt));
        params.onProgress?.(Math.min(collector.records.length, target), target);
        if (data.results.length < pageSize) break;
      }
      return { records: collector.records };
    } catch (error) {
      return { records: collector.records, error: toUpstreamError(error) };
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.options.http.getJson(`${this.baseUrl}/articles/test?pageSize=1`, {
      source: this.label,
      signal,
      limiter: this.options.limiter,
      useCache: false,
      maxRetries: 0,
      timeoutMs: 8000,
    });
  }
}

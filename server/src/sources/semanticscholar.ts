import type { PaperRecord } from '../../../shared/types.js';
import { doiUrl, normalizeDoi } from '../lib/doi.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import { openAccess } from '../lib/oa.js';
import { biblio } from '../lib/biblio.js';
import type { HttpClient } from '../lib/http.js';
import type { Limiter } from '../lib/limiter.js';
import { cleanAbstract, cleanText, safeHttpUrl } from '../lib/text.js';
import { Collector, toYear } from './collector.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from './types.js';

const FIELDS = 'title,externalIds,year,authors,venue,journal,publicationTypes,abstract,url,isOpenAccess,openAccessPdf';
const PAGE_SIZE = 100;
/** Giới hạn của endpoint search: offset + limit < 1000. */
const MAX_DEPTH = 999;
const PREPRINT_VENUE = /^(arxiv|biorxiv|medrxiv|ssrn|research square|preprints?)/i;

interface S2Paper {
  paperId?: string;
  title?: string;
  externalIds?: { DOI?: string } | null;
  year?: number | null;
  authors?: { name?: string; authorId?: string | null }[] | null;
  venue?: string | null;
  journal?: { name?: string; volume?: string; pages?: string } | null;
  publicationTypes?: string[] | null;
  abstract?: string | null;
  url?: string | null;
  isOpenAccess?: boolean | null;
  openAccessPdf?: { url?: string | null; status?: string | null; license?: string | null } | null;
}

interface S2Response {
  total?: number;
  data?: unknown[];
}

export function mapSemanticScholarPaper(raw: unknown, keyword: string, retrievedAt: string): PaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const paper = raw as S2Paper;
  if (!paper.paperId) return null;

  const doi = normalizeDoi(paper.externalIds?.DOI);
  const venue = cleanText(paper.journal?.name) || cleanText(paper.venue);
  const pageUrl = safeHttpUrl(paper.url) || `https://www.semanticscholar.org/paper/${encodeURIComponent(paper.paperId)}`;

  return {
    id: '',
    title: cleanText(paper.title),
    doi,
    authors: (Array.isArray(paper.authors) ? paper.authors : [])
      .map((a) => cleanText(a?.name))
      .filter(Boolean)
      .map((name) => ({ name })),
    publicationYear: toYear(paper.year ?? undefined),
    journal: venue,
    publisher: '',
    documentType: Array.isArray(paper.publicationTypes) && paper.publicationTypes[0] ? paper.publicationTypes[0] : '',
    isPreprint: PREPRINT_VENUE.test(venue),
    abstract: cleanAbstract(paper.abstract),
    ...biblio({ volume: paper.journal?.volume, pages: paper.journal?.pages }),
    ...openAccess({
      isOpenAccess: paper.isOpenAccess === true || Boolean(paper.openAccessPdf?.url),
      oaStatus: paper.openAccessPdf?.status ?? '',
      oaPdfUrl: paper.openAccessPdf?.url ?? '',
      oaLicense: paper.openAccessPdf?.license ?? '',
    }),
    sources: ['semanticscholar'],
    sourceRefs: [{ source: 'semanticscholar', sourceId: paper.paperId, url: pageUrl }],
    originalUrl: doi ? doiUrl(doi) : pageUrl,
    queryKeywords: [keyword],
    retrievedAt,
  };
}

export interface SemanticScholarOptions {
  http: HttpClient;
  limiter: Limiter;
  apiKey?: string;
  baseUrl?: string;
  now?: () => Date;
}

export class SemanticScholarAdapter implements SourceAdapter {
  readonly id = 'semanticscholar' as const;
  readonly label = 'Semantic Scholar';
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: SemanticScholarOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.semanticscholar.org/graph/v1';
    this.now = options.now ?? (() => new Date());
  }

  private headers(): Record<string, string> | undefined {
    return this.options.apiKey ? { 'x-api-key': this.options.apiKey } : undefined;
  }

  buildUrl(params: AdapterSearchParams, limit: number, offset: number): string {
    const query = new URLSearchParams({ query: params.keyword, limit: String(limit), offset: String(offset), fields: FIELDS });
    if (params.yearFrom || params.yearTo) query.set('year', `${params.yearFrom ?? ''}-${params.yearTo ?? ''}`);
    return `${this.baseUrl}/paper/search?${query.toString()}`;
  }

  async search(params: AdapterSearchParams): Promise<AdapterResult> {
    const collector = new Collector(params.maxResults, params.onlyWithDoi);
    const retrievedAt = this.now().toISOString();
    let target = params.maxResults;
    let offset = 0;

    try {
      while (!collector.full && offset < MAX_DEPTH) {
        const limit = Math.min(PAGE_SIZE, MAX_DEPTH - offset);
        const data = await this.options.http.getJson<S2Response>(this.buildUrl(params, limit, offset), {
          source: this.label,
          limiter: this.options.limiter,
          signal: params.signal,
          headers: this.headers(),
        });
        if (!data || !Array.isArray(data.data)) {
          // Khi không có kết quả, API có thể bỏ hẳn trường `data`.
          if (data && typeof data.total === 'number' && data.total === 0) break;
          throw new UpstreamError('bad_response', 'Semantic Scholar trả về cấu trúc dữ liệu không như mong đợi.');
        }
        if (typeof data.total === 'number' && !params.onlyWithDoi) target = Math.min(target, data.total);

        for (const raw of data.data) collector.add(mapSemanticScholarPaper(raw, params.keyword, retrievedAt));
        offset += data.data.length;
        params.onProgress?.(Math.min(collector.records.length, target), target);
        if (data.data.length < limit || (typeof data.total === 'number' && offset >= data.total)) break;
      }
      return { records: collector.records };
    } catch (error) {
      return { records: collector.records, error: toUpstreamError(error) };
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.options.http.getJson(`${this.baseUrl}/paper/search?query=test&limit=1&fields=title`, {
      source: this.label,
      signal,
      limiter: this.options.limiter,
      headers: this.headers(),
      useCache: false,
      maxRetries: 0,
      timeoutMs: 8000,
    });
  }
}

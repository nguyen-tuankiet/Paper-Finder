import type { Author, PaperRecord } from '../../../shared/types.js';
import { doiUrl, normalizeDoi } from '../lib/doi.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import { looksLikePdf, openAccess } from '../lib/oa.js';
import { biblio } from '../lib/biblio.js';
import type { HttpClient } from '../lib/http.js';
import type { Limiter } from '../lib/limiter.js';
import { abstractFromInvertedIndex, cleanText, safeHttpUrl } from '../lib/text.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from './types.js';

const SELECT = [
  'id',
  'doi',
  'display_name',
  'publication_year',
  'authorships',
  'primary_location',
  'type',
  'abstract_inverted_index',
  'open_access',
  'best_oa_location',
  'biblio',
].join(',');

const MAX_PER_PAGE = 100;

interface OpenAlexAuthorship {
  author?: { display_name?: string; orcid?: string };
  raw_author_name?: string;
}

interface OpenAlexLocation {
  landing_page_url?: string;
  raw_source_name?: string;
  source?: { display_name?: string; host_organization_name?: string } | null;
}

interface OpenAlexOpenAccess {
  is_oa?: boolean | null;
  oa_status?: string | null;
  oa_url?: string | null;
}

interface OpenAlexBestLocation {
  is_oa?: boolean | null;
  pdf_url?: string | null;
  landing_page_url?: string | null;
  license?: string | null;
}

interface OpenAlexWork {
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null;
  open_access?: OpenAlexOpenAccess | null;
  best_oa_location?: OpenAlexBestLocation | null;
  id?: string;
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: unknown;
  primary_location?: OpenAlexLocation | null;
  type?: string | null;
  abstract_inverted_index?: unknown;
}

interface OpenAlexResponse {
  meta?: { count?: number };
  results?: unknown[];
}

function mapAuthors(value: unknown): Author[] {
  if (!Array.isArray(value)) return [];
  const authors: Author[] = [];
  for (const raw of value as OpenAlexAuthorship[]) {
    if (!raw || typeof raw !== 'object') continue;
    const name = cleanText(raw.author?.display_name) || cleanText(raw.raw_author_name);
    if (!name) continue;
    const author: Author = { name };
    const orcid = safeHttpUrl(raw.author?.orcid);
    if (orcid) author.orcid = orcid;
    authors.push(author);
  }
  return authors;
}

export function mapOpenAlexWork(raw: unknown, keyword: string, retrievedAt: string): PaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const work = raw as OpenAlexWork;
  const doi = normalizeDoi(work.doi);
  const location = work.primary_location ?? undefined;
  const type = typeof work.type === 'string' ? work.type : '';
  const workId = typeof work.id === 'string' ? work.id : '';
  const year = work.publication_year;
  const oa = work.open_access ?? undefined;
  const best = work.best_oa_location ?? undefined;
  const isOpen = oa?.is_oa === true || best?.is_oa === true;
  const oaUrl = safeHttpUrl(oa?.oa_url);

  return {
    id: '',
    title: cleanText(work.display_name),
    doi,
    authors: mapAuthors(work.authorships),
    publicationYear: typeof year === 'number' && Number.isInteger(year) && year > 0 ? year : null,
    journal: cleanText(location?.source?.display_name) || cleanText(location?.raw_source_name),
    publisher: cleanText(location?.source?.host_organization_name),
    documentType: type,
    isPreprint: type === 'preprint',
    abstract: abstractFromInvertedIndex(work.abstract_inverted_index),
    ...biblio({ volume: work.biblio?.volume, issue: work.biblio?.issue, firstPage: work.biblio?.first_page, lastPage: work.biblio?.last_page }),
    ...openAccess({
      isOpenAccess: isOpen,
      oaStatus: oa?.oa_status ?? '',
      // oa_url có thể là PDF hoặc trang landing; chỉ coi là PDF khi URL trông như PDF.
      oaPdfUrl: safeHttpUrl(best?.pdf_url) || (looksLikePdf(oaUrl) ? oaUrl : ''),
      oaUrl: safeHttpUrl(best?.landing_page_url) || oaUrl,
      oaLicense: best?.license ?? '',
    }),
    sources: ['openalex'],
    sourceRefs: workId ? [{ source: 'openalex', sourceId: workId, url: safeHttpUrl(workId) }] : [],
    originalUrl: safeHttpUrl(location?.landing_page_url) || (doi ? doiUrl(doi) : safeHttpUrl(workId)),
    queryKeywords: [keyword],
    retrievedAt,
  };
}

export interface OpenAlexOptions {
  http: HttpClient;
  limiter: Limiter;
  apiKey?: string;
  baseUrl?: string;
  now?: () => Date;
}

export class OpenAlexAdapter implements SourceAdapter {
  readonly id = 'openalex' as const;
  readonly label = 'OpenAlex';
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: OpenAlexOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.openalex.org';
    this.now = options.now ?? (() => new Date());
  }

  private headers(): Record<string, string> | undefined {
    return this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : undefined;
  }

  buildUrl(params: AdapterSearchParams, perPage: number, page: number): string {
    const query = new URLSearchParams();
    // Tìm trong tiêu đề, abstract và từ khóa (giống tìm kiếm mặc định của openalex.org), không tìm toàn văn.
    query.set('search.title_abstract_keywords', params.keyword);
    query.set('per_page', String(perPage));
    query.set('page', String(page));
    query.set('select', SELECT);
    const filters: string[] = [];
    if (params.yearFrom && params.yearTo) filters.push(`publication_year:${params.yearFrom}-${params.yearTo}`);
    else if (params.yearFrom) filters.push(`publication_year:>${params.yearFrom - 1}`);
    else if (params.yearTo) filters.push(`publication_year:<${params.yearTo + 1}`);
    if (params.onlyWithDoi) filters.push('has_doi:true');
    if (filters.length) query.set('filter', filters.join(','));
    return `${this.baseUrl}/works?${query.toString()}`;
  }

  async search(params: AdapterSearchParams): Promise<AdapterResult> {
    const records: PaperRecord[] = [];
    const retrievedAt = this.now().toISOString();
    const perPage = Math.min(MAX_PER_PAGE, params.maxResults);
    let target = params.maxResults;

    try {
      for (let page = 1; records.length < target; page++) {
        if (page * perPage > 10000) break; // giới hạn phân trang cơ bản của OpenAlex
        const data = await this.options.http.getJson<OpenAlexResponse>(this.buildUrl(params, perPage, page), {
          source: this.label,
          limiter: this.options.limiter,
          signal: params.signal,
          headers: this.headers(),
        });
        if (!data || !Array.isArray(data.results)) {
          throw new UpstreamError('bad_response', 'OpenAlex trả về cấu trúc dữ liệu không như mong đợi.');
        }
        if (typeof data.meta?.count === 'number') target = Math.min(target, data.meta.count);

        for (const raw of data.results) {
          if (records.length >= params.maxResults) break;
          const record = mapOpenAlexWork(raw, params.keyword, retrievedAt);
          if (record) records.push(record);
        }
        params.onProgress?.(Math.min(records.length, target), target);
        if (data.results.length < perPage) break; // hết dữ liệu
      }
      return { records };
    } catch (error) {
      return { records, error: toUpstreamError(error) };
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    // Tra cứu một bản ghi theo ID không tốn hạn mức theo tài liệu OpenAlex.
    await this.options.http.getJson(`${this.baseUrl}/works/W2741809807?select=id`, {
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

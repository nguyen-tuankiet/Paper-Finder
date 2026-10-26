import type { Author, PaperRecord } from '../../../shared/types.js';
import { doiUrl, normalizeDoi } from '../lib/doi.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import { openAccess } from '../lib/oa.js';
import type { HttpClient } from '../lib/http.js';
import type { Limiter } from '../lib/limiter.js';
import { cleanAbstract, cleanText } from '../lib/text.js';
import { Collector, plainQuery, toYear } from './collector.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from './types.js';

const PAGE_SIZE = 100;

interface EpmcAuthor {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  collectiveName?: string;
}

interface EpmcResult {
  id?: string;
  source?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: { author?: EpmcAuthor[] };
  journalInfo?: { journal?: { title?: string }; yearOfPublication?: number };
  bookOrReportDetails?: { publisher?: string };
  pubYear?: string;
  firstPublicationDate?: string;
  pubTypeList?: { pubType?: string[] };
  abstractText?: string;
  isOpenAccess?: string;
  license?: string;
  fullTextUrlList?: { fullTextUrl?: { availabilityCode?: string; documentStyle?: string; site?: string; url?: string }[] };
}

/**
 * Europe PMC đánh dấu từng link toàn văn: OA = truy cập mở, F = miễn phí, S = cần đăng ký/mua.
 * Bài được coi là miễn phí khi cờ isOpenAccess = Y hoặc có link OA/F thật sự dẫn tới toàn văn.
 */
export function europePmcOpenAccess(result: EpmcResult) {
  const urls = Array.isArray(result.fullTextUrlList?.fullTextUrl) ? result.fullTextUrlList.fullTextUrl : [];
  const free = urls.filter((u) => u?.availabilityCode === 'OA' || u?.availabilityCode === 'F');
  const hasOaLink = urls.some((u) => u?.availabilityCode === 'OA');
  const pdf = free.find((u) => u.documentStyle === 'pdf')?.url;
  const page = free.find((u) => u.documentStyle === 'html')?.url ?? free.find((u) => u.documentStyle === 'doi' && u.availabilityCode === 'OA')?.url;
  return openAccess({
    isOpenAccess: result.isOpenAccess === 'Y' || hasOaLink,
    oaPdfUrl: pdf,
    oaUrl: page,
    oaLicense: result.license, // chỉ được giữ khi bài là bản mở (xem openAccess())
  });
}

interface EpmcResponse {
  hitCount?: number;
  nextCursorMark?: string;
  resultList?: { result?: unknown[] };
}

function mapAuthors(result: EpmcResult): Author[] {
  const list = result.authorList?.author;
  if (Array.isArray(list) && list.length > 0) {
    const authors: Author[] = [];
    for (const raw of list) {
      const given = cleanText(raw?.firstName);
      const family = cleanText(raw?.lastName);
      const name = given && family ? `${given} ${family}` : cleanText(raw?.fullName) || cleanText(raw?.collectiveName);
      if (!name) continue;
      authors.push({ name, ...(given && family ? { given, family } : {}) });
    }
    return authors;
  }
  return cleanText(result.authorString)
    .replace(/\.$/, '')
    .split(/,\s*/)
    .filter(Boolean)
    .map((name) => ({ name }));
}

export function mapEuropePmcResult(raw: unknown, keyword: string, retrievedAt: string): PaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const result = raw as EpmcResult;
  if (!result.id || !result.source) return null;

  const doi = normalizeDoi(result.doi);
  const pubTypes = Array.isArray(result.pubTypeList?.pubType) ? result.pubTypeList.pubType : [];
  const isPreprint = result.source === 'PPR' || pubTypes.includes('Preprint');
  const publisher = cleanText(result.bookOrReportDetails?.publisher);
  const url = `https://europepmc.org/article/${encodeURIComponent(result.source)}/${encodeURIComponent(result.id)}`;
  const yearOfPublication = result.journalInfo?.yearOfPublication;

  return {
    id: '',
    title: cleanText(result.title),
    doi,
    authors: mapAuthors(result),
    publicationYear: toYear(result.pubYear) ?? toYear(yearOfPublication || undefined) ?? toYear(result.firstPublicationDate),
    journal: cleanText(result.journalInfo?.journal?.title) || (isPreprint ? publisher : ''),
    publisher,
    documentType: isPreprint ? 'preprint' : (pubTypes.find((t) => t === 'Journal Article') ?? pubTypes[0] ?? ''),
    isPreprint,
    abstract: cleanAbstract(result.abstractText),
    ...europePmcOpenAccess(result),
    sources: ['europepmc'],
    sourceRefs: [{ source: 'europepmc', sourceId: `${result.source}:${result.id}`, url }],
    originalUrl: url,
    queryKeywords: [keyword],
    retrievedAt,
  };
}

export interface EuropePmcOptions {
  http: HttpClient;
  limiter: Limiter;
  baseUrl?: string;
  now?: () => Date;
}

export class EuropePmcAdapter implements SourceAdapter {
  readonly id = 'europepmc' as const;
  readonly label = 'Europe PMC';
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: EuropePmcOptions) {
    this.baseUrl = options.baseUrl ?? 'https://www.ebi.ac.uk/europepmc/webservices/rest';
    this.now = options.now ?? (() => new Date());
  }

  buildQuery(params: AdapterSearchParams): string {
    const parts = [`TITLE_ABS:(${plainQuery(params.keyword) || params.keyword})`];
    if (params.yearFrom || params.yearTo) parts.push(`PUB_YEAR:[${params.yearFrom ?? 1000} TO ${params.yearTo ?? 3000}]`);
    if (params.onlyWithDoi) parts.push('HAS_DOI:y');
    return parts.join(' AND ');
  }

  buildUrl(params: AdapterSearchParams, pageSize: number, cursor: string): string {
    const query = new URLSearchParams({
      query: this.buildQuery(params),
      format: 'json',
      resultType: 'core',
      pageSize: String(pageSize),
      cursorMark: cursor,
    });
    return `${this.baseUrl}/search?${query.toString()}`;
  }

  async search(params: AdapterSearchParams): Promise<AdapterResult> {
    const collector = new Collector(params.maxResults, params.onlyWithDoi);
    const retrievedAt = this.now().toISOString();
    const pageSize = Math.min(PAGE_SIZE, params.maxResults);
    let target = params.maxResults;
    let cursor = '*';

    try {
      for (let page = 0; !collector.full && page < 50; page++) {
        const data = await this.options.http.getJson<EpmcResponse>(this.buildUrl(params, pageSize, cursor), {
          source: this.label,
          limiter: this.options.limiter,
          signal: params.signal,
        });
        const results = data?.resultList?.result;
        if (!Array.isArray(results)) {
          throw new UpstreamError('bad_response', 'Europe PMC trả về cấu trúc dữ liệu không như mong đợi.');
        }
        if (typeof data.hitCount === 'number') target = Math.min(target, data.hitCount);

        for (const raw of results) collector.add(mapEuropePmcResult(raw, params.keyword, retrievedAt));
        params.onProgress?.(Math.min(collector.records.length, target), target);

        const next = data.nextCursorMark;
        if (results.length < pageSize || !next || next === cursor) break;
        cursor = next;
      }
      return { records: collector.records };
    } catch (error) {
      return { records: collector.records, error: toUpstreamError(error) };
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.options.http.getJson(`${this.baseUrl}/search?query=test&format=json&pageSize=1`, {
      source: this.label,
      signal,
      limiter: this.options.limiter,
      useCache: false,
      maxRetries: 0,
      timeoutMs: 8000,
    });
  }
}

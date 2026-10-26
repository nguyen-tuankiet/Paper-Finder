import type { Author, PaperRecord } from '../../../shared/types.js';
import { normalizeDoi, doiUrl } from '../lib/doi.js';
import { UpstreamError, toUpstreamError } from '../lib/errors.js';
import { openAccess } from '../lib/oa.js';
import type { HttpClient } from '../lib/http.js';
import type { Limiter } from '../lib/limiter.js';
import { cleanAbstract, cleanText, safeHttpUrl } from '../lib/text.js';
import type { AdapterResult, AdapterSearchParams, SourceAdapter } from './types.js';

const SELECT = [
  'DOI',
  'title',
  'author',
  'issued',
  'published',
  'published-print',
  'published-online',
  'container-title',
  'publisher',
  'type',
  'URL',
  'abstract',
  'event',
].join(',');

const PAGE_SIZE = 100;

type DateParts = { 'date-parts'?: unknown } | undefined;

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
  ORCID?: string;
}

interface CrossrefItem {
  DOI?: string;
  title?: unknown;
  author?: unknown;
  issued?: DateParts;
  published?: DateParts;
  'published-print'?: DateParts;
  'published-online'?: DateParts;
  'container-title'?: unknown;
  event?: { name?: string };
  publisher?: string;
  type?: string;
  URL?: string;
  abstract?: string;
}

interface CrossrefResponse {
  status?: string;
  message?: { 'total-results'?: number; items?: unknown[] };
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const text = cleanText(entry);
      if (text) return text;
    }
    return '';
  }
  return cleanText(value);
}

function yearOf(value: DateParts): number | null {
  const parts = value?.['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const year = parts[0][0];
  return typeof year === 'number' && Number.isInteger(year) && year > 0 ? year : null;
}

function mapAuthors(value: unknown): Author[] {
  if (!Array.isArray(value)) return [];
  const authors: Author[] = [];
  for (const raw of value as CrossrefAuthor[]) {
    if (!raw || typeof raw !== 'object') continue;
    const given = cleanText(raw.given);
    const family = cleanText(raw.family);
    const name = [given, family].filter(Boolean).join(' ') || cleanText(raw.name);
    if (!name) continue;
    const author: Author = { name };
    if (given) author.given = given;
    if (family) author.family = family;
    const orcid = safeHttpUrl(raw.ORCID);
    if (orcid) author.orcid = orcid;
    authors.push(author);
  }
  return authors;
}

export function mapCrossrefItem(raw: unknown, keyword: string, retrievedAt: string): PaperRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as CrossrefItem;
  const doi = normalizeDoi(item.DOI);
  const type = typeof item.type === 'string' ? item.type : '';
  const container = firstString(item['container-title']) || cleanText(item.event?.name);

  return {
    id: '',
    title: firstString(item.title),
    doi,
    authors: mapAuthors(item.author),
    // `published` là ngày sớm nhất giữa bản in và bản online theo Crossref.
    publicationYear:
      yearOf(item.published) ?? yearOf(item.issued) ?? yearOf(item['published-print']) ?? yearOf(item['published-online']),
    journal: container,
    publisher: cleanText(item.publisher),
    documentType: type,
    isPreprint: type === 'posted-content',
    abstract: cleanAbstract(item.abstract),
    // Crossref không cho biết chắc bài có bản mở hay không nên không suy đoán; trạng thái được bổ sung khi gộp với nguồn khác.
    ...openAccess(),
    sources: ['crossref'],
    sourceRefs: doi ? [{ source: 'crossref', sourceId: doi, url: doiUrl(doi) }] : [],
    originalUrl: safeHttpUrl(item.URL) || (doi ? doiUrl(doi) : ''),
    queryKeywords: [keyword],
    retrievedAt,
  };
}

export interface CrossrefOptions {
  http: HttpClient;
  limiter: Limiter;
  baseUrl?: string;
  now?: () => Date;
}

export class CrossrefAdapter implements SourceAdapter {
  readonly id = 'crossref' as const;
  readonly label = 'Crossref';
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(private readonly options: CrossrefOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.crossref.org';
    this.now = options.now ?? (() => new Date());
  }

  buildUrl(params: AdapterSearchParams, rows: number, offset: number): string {
    const query = new URLSearchParams();
    query.set('query.bibliographic', params.keyword);
    query.set('rows', String(rows));
    query.set('offset', String(offset));
    query.set('select', SELECT);
    const filters: string[] = [];
    if (params.yearFrom) filters.push(`from-pub-date:${params.yearFrom}`);
    if (params.yearTo) filters.push(`until-pub-date:${params.yearTo}`);
    if (filters.length) query.set('filter', filters.join(','));
    return `${this.baseUrl}/works?${query.toString()}`;
  }

  async search(params: AdapterSearchParams): Promise<AdapterResult> {
    const records: PaperRecord[] = [];
    const retrievedAt = this.now().toISOString();
    const seenDois = new Set<string>();
    let target = params.maxResults;
    let offset = 0;

    try {
      while (records.length < target) {
        const rows = Math.min(PAGE_SIZE, params.maxResults - records.length);
        const data = await this.options.http.getJson<CrossrefResponse>(this.buildUrl(params, rows, offset), {
          source: this.label,
          limiter: this.options.limiter,
          signal: params.signal,
        });
        const message = data?.message;
        if (data?.status !== 'ok' || !message || !Array.isArray(message.items)) {
          throw new UpstreamError('bad_response', 'Crossref trả về cấu trúc dữ liệu không như mong đợi.');
        }
        if (typeof message['total-results'] === 'number') target = Math.min(target, message['total-results']);

        for (const raw of message.items) {
          const record = mapCrossrefItem(raw, params.keyword, retrievedAt);
          if (!record || (!record.doi && params.onlyWithDoi)) continue;
          // Phân trang offset của Crossref có thể trả cùng một bài ở hai trang khi thứ hạng thay đổi giữa hai lần gọi.
          if (record.doi) {
            if (seenDois.has(record.doi)) continue;
            seenDois.add(record.doi);
          }
          records.push(record);
        }
        offset += message.items.length;
        params.onProgress?.(Math.min(records.length, target), target);
        if (message.items.length < rows) break; // hết dữ liệu
        if (offset >= 10000) break; // giới hạn offset của Crossref
      }
      return { records: records.slice(0, params.maxResults) };
    } catch (error) {
      return { records, error: toUpstreamError(error) };
    }
  }

  async ping(signal?: AbortSignal): Promise<void> {
    await this.options.http.getJson(`${this.baseUrl}/works?rows=0`, {
      source: this.label,
      signal,
      limiter: this.options.limiter,
      useCache: false,
      maxRetries: 0,
      timeoutMs: 8000,
    });
  }
}

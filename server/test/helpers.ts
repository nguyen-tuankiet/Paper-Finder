import type { PaperRecord } from '../../shared/types.js';
import { HttpClient } from '../src/lib/http.js';
import { Limiter } from '../src/lib/limiter.js';

export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
}

export type FetchMock = ((url: string | URL | Request, init?: RequestInit) => Promise<Response>) & { calls: string[] };

/** Tạo fetch giả: mỗi lần gọi lấy handler kế tiếp (handler cuối được dùng lặp lại). */
export function mockFetch(...handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>): FetchMock {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const handler = handlers[Math.min(calls.length, handlers.length - 1)]!;
    calls.push(url);
    return handler(url, init);
  }) as FetchMock;
  fn.calls = calls;
  return fn;
}

export function makeHttp(fetchImpl: FetchMock, overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    userAgent: 'PaperFinder-test',
    timeoutMs: 2000,
    maxRetries: 2,
    baseDelayMs: 1,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleepFn: async () => {},
    ...overrides,
  });
}

export const noLimit = () => new Limiter(10, 0);

export function makeRecord(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: '',
    title: 'Deep learning for crop disease detection',
    doi: '',
    authors: [],
    publicationYear: null,
    journal: '',
    publisher: '',
    documentType: '',
    isPreprint: false,
    abstract: '',
    sources: ['crossref'],
    sourceRefs: [],
    originalUrl: '',
    queryKeywords: ['crop'],
    retrievedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

export const author = (name: string, family?: string) => ({ name, family: family ?? name.split(' ').slice(-1)[0] });

// ---- Dữ liệu mẫu theo đúng cấu trúc phản hồi thật của Crossref/OpenAlex ----

export function crossrefItem(n: number, extra: Record<string, unknown> = {}) {
  return {
    DOI: `10.1000/Test.${n}`,
    title: [`Crossref paper ${n}`],
    author: [{ given: 'Anh', family: `Nguyễn ${n}`, sequence: 'first' }],
    published: { 'date-parts': [[2020 + (n % 5)]] },
    issued: { 'date-parts': [[2020 + (n % 5)]] },
    'container-title': ['Journal of Tests'],
    publisher: 'Test Press',
    type: 'journal-article',
    URL: `https://doi.org/10.1000/test.${n}`,
    ...extra,
  };
}

export function crossrefPage(items: unknown[], total = 1000) {
  return { status: 'ok', 'message-type': 'work-list', message: { 'total-results': total, items } };
}

export function openAlexWork(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `https://openalex.org/W${1000 + n}`,
    doi: `https://doi.org/10.2000/OA.${n}`,
    display_name: `OpenAlex paper ${n}`,
    publication_year: 2021,
    authorships: [{ author: { display_name: 'Minh Trần' } }],
    primary_location: {
      landing_page_url: `https://publisher.example/oa/${n}`,
      source: { display_name: 'OpenAlex Journal', host_organization_name: 'OA Publisher' },
    },
    type: 'article',
    abstract_inverted_index: { Hello: [0], world: [1] },
    ...extra,
  };
}

export function openAlexPage(results: unknown[], count = 1000) {
  return { meta: { count, page: 1, per_page: results.length }, results };
}

import { describe, expect, it } from 'vitest';
import { CrossrefAdapter, mapCrossrefItem } from '../src/sources/crossref.js';
import { OpenAlexAdapter, mapOpenAlexWork } from '../src/sources/openalex.js';
import {
  crossrefItem,
  crossrefPage,
  jsonResponse,
  makeHttp,
  mockFetch,
  noLimit,
  openAlexPage,
  openAlexWork,
} from './helpers.js';

const NOW = new Date('2026-10-25T00:00:00Z');
const base = { keyword: 'machine learning', maxResults: 20, onlyWithDoi: true };

describe('Crossref adapter', () => {
  const make = (fetchMock: ReturnType<typeof mockFetch>) =>
    new CrossrefAdapter({ http: makeHttp(fetchMock), limiter: noLimit(), now: () => NOW });

  it('tìm kiếm thành công và chuẩn hóa dữ liệu', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse(
        crossrefPage(
          [
            crossrefItem(1, {
              title: ['Deep  <i>learning</i> &amp; vision'],
              abstract: '<jats:title>Abstract</jats:title><jats:p>Hello <jats:italic>there</jats:italic>.</jats:p>',
            }),
          ],
          1,
        ),
      ),
    );
    const { records, error } = await make(fetchMock).search(base);
    expect(error).toBeUndefined();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      title: 'Deep learning & vision',
      doi: '10.1000/test.1', // chuẩn hóa chữ thường
      publicationYear: 2021,
      journal: 'Journal of Tests',
      publisher: 'Test Press',
      documentType: 'journal-article',
      abstract: 'Hello there.',
      sources: ['crossref'],
      queryKeywords: ['machine learning'],
      retrievedAt: NOW.toISOString(),
    });
    expect(records[0]!.authors).toEqual([{ name: 'Anh Nguyễn 1', given: 'Anh', family: 'Nguyễn 1' }]);
    const url = new URL(fetchMock.calls[0]!);
    expect(url.searchParams.get('query.bibliographic')).toBe('machine learning');
    expect(url.searchParams.get('select')).toContain('abstract');
  });

  it('phân trang theo offset và giới hạn đúng số kết quả (150 -> 100 + 50)', async () => {
    const page = (start: number, size: number) => crossrefPage(Array.from({ length: size }, (_, i) => crossrefItem(start + i)));
    const fetchMock = mockFetch(() => jsonResponse(page(0, 100)), () => jsonResponse(page(100, 50)));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 150 });
    expect(records).toHaveLength(150);
    expect(fetchMock.calls).toHaveLength(2);
    expect(new URL(fetchMock.calls[0]!).searchParams.get('rows')).toBe('100');
    expect(new URL(fetchMock.calls[1]!).searchParams.get('rows')).toBe('50');
    expect(new URL(fetchMock.calls[1]!).searchParams.get('offset')).toBe('100');
  });

  it('dừng khi nguồn hết dữ liệu (total-results nhỏ hơn yêu cầu)', async () => {
    const fetchMock = mockFetch(() => jsonResponse(crossrefPage([crossrefItem(1), crossrefItem(2)], 2)));
    const progress: Array<[number, number]> = [];
    const { records } = await make(fetchMock).search({ ...base, maxResults: 100, onProgress: (f, t) => progress.push([f, t]) });
    expect(records).toHaveLength(2);
    expect(fetchMock.calls).toHaveLength(1);
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it('bỏ DOI lặp giữa hai trang (thứ hạng đổi giữa các lần gọi) và lấy bù cho đủ số lượng', async () => {
    const page1 = crossrefPage(Array.from({ length: 100 }, (_, i) => crossrefItem(i)));
    // trang 2 lặp lại bài số 96 (DOI khác hoa/thường) rồi tiếp tục bằng bài mới
    const page2 = crossrefPage([crossrefItem(96, { DOI: '10.1000/TEST.96' }), ...Array.from({ length: 49 }, (_, i) => crossrefItem(100 + i))]);
    const page3 = crossrefPage([crossrefItem(500)]);
    const fetchMock = mockFetch(() => jsonResponse(page1), () => jsonResponse(page2), () => jsonResponse(page3));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 150 });
    expect(records).toHaveLength(150);
    expect(new Set(records.map((r) => r.doi)).size).toBe(150);
    expect(new URL(fetchMock.calls[2]!).searchParams.get('rows')).toBe('1');
    expect(new URL(fetchMock.calls[2]!).searchParams.get('offset')).toBe('150');
  });

  it('thêm bộ lọc năm xuất bản', async () => {
    const fetchMock = mockFetch(() => jsonResponse(crossrefPage([], 0)));
    await make(fetchMock).search({ ...base, yearFrom: 2020, yearTo: 2024 });
    expect(new URL(fetchMock.calls[0]!).searchParams.get('filter')).toBe('from-pub-date:2020,until-pub-date:2024');
  });

  it('metadata thiếu: không có tác giả, năm, tạp chí - không tự suy đoán', () => {
    const record = mapCrossrefItem({ DOI: '10.5555/abc', title: ['Only title'], type: 'journal-article' }, 'k', NOW.toISOString())!;
    expect(record).toMatchObject({ title: 'Only title', authors: [], publicationYear: null, journal: '', publisher: '', abstract: '' });
    expect(record.originalUrl).toBe('https://doi.org/10.5555/abc');
  });

  it('nhiều giá trị: lấy tiêu đề/tạp chí đầu tiên không rỗng, năm từ published-print khi thiếu published', () => {
    const record = mapCrossrefItem(
      {
        DOI: '10.5555/abc',
        title: ['', 'Second title', 'Third'],
        'container-title': ['', 'Journal B', 'Journal C'],
        'published-print': { 'date-parts': [[2019, 5]] },
        author: [{ name: 'WHO Consortium' }, { given: '', family: '' }, { family: 'Solo' }],
      },
      'k',
      NOW.toISOString(),
    )!;
    expect(record.title).toBe('Second title');
    expect(record.journal).toBe('Journal B');
    expect(record.publicationYear).toBe(2019);
    expect(record.authors.map((a) => a.name)).toEqual(['WHO Consortium', 'Solo']);
  });

  it('ngày dạng [[null]] hoặc sai kiểu cho năm = null', () => {
    const record = mapCrossrefItem({ DOI: '10.5555/abc', published: { 'date-parts': [[null]] }, issued: 'x' }, 'k', NOW.toISOString())!;
    expect(record.publicationYear).toBeNull();
  });

  it('DOI không hợp lệ -> để trống, không bịa; vẫn giữ bản ghi nếu cho phép bài không DOI', async () => {
    const items = [crossrefItem(1, { DOI: 'not-a-doi', URL: 'javascript:alert(1)' }), crossrefItem(2)];
    const withoutFilter = await make(mockFetch(() => jsonResponse(crossrefPage(items, 2)))).search({ ...base, onlyWithDoi: false });
    expect(withoutFilter.records).toHaveLength(2);
    expect(withoutFilter.records[0]).toMatchObject({ doi: '', originalUrl: '' });

    const onlyDoi = await make(mockFetch(() => jsonResponse(crossrefPage(items, 2)))).search(base);
    expect(onlyDoi.records.map((r) => r.doi)).toEqual(['10.1000/test.2']);
  });

  it('loại posted-content được đánh dấu preprint', () => {
    expect(mapCrossrefItem({ DOI: '10.5555/abc', type: 'posted-content' }, 'k', '')!.isPreprint).toBe(true);
  });

  it('lỗi giữa chừng: trả về phần đã lấy được kèm lỗi', async () => {
    const page1 = crossrefPage(Array.from({ length: 100 }, (_, i) => crossrefItem(i)));
    const fetchMock = mockFetch(() => jsonResponse(page1), () => jsonResponse('', { status: 500 }));
    const { records, error } = await new CrossrefAdapter({
      http: makeHttp(fetchMock, { maxRetries: 0 }),
      limiter: noLimit(),
    }).search({ ...base, maxResults: 200 });
    expect(records).toHaveLength(100);
    expect(error?.code).toBe('server_error');
  });

  it('cấu trúc phản hồi lạ -> bad_response', async () => {
    const { error } = await make(mockFetch(() => jsonResponse({ hello: 'world' }))).search(base);
    expect(error?.code).toBe('bad_response');
  });

  it('rate limit (429, Retry-After dài) -> lỗi rate_limited, không ném', async () => {
    const fetchMock = mockFetch(() => jsonResponse('', { status: 429, headers: { 'retry-after': '3600' } }));
    const { records, error } = await make(fetchMock).search(base);
    expect(records).toEqual([]);
    expect(error?.code).toBe('rate_limited');
  });
});

describe('OpenAlex adapter', () => {
  const make = (fetchMock: ReturnType<typeof mockFetch>, apiKey?: string) =>
    new OpenAlexAdapter({ http: makeHttp(fetchMock), limiter: noLimit(), now: () => NOW, apiKey });

  it('tìm kiếm thành công, dựng abstract từ inverted index', async () => {
    const fetchMock = mockFetch(() => jsonResponse(openAlexPage([openAlexWork(1)], 1)));
    const { records, error } = await make(fetchMock).search(base);
    expect(error).toBeUndefined();
    expect(records[0]).toMatchObject({
      title: 'OpenAlex paper 1',
      doi: '10.2000/oa.1',
      publicationYear: 2021,
      journal: 'OpenAlex Journal',
      publisher: 'OA Publisher',
      documentType: 'article',
      abstract: 'Hello world',
      originalUrl: 'https://publisher.example/oa/1',
      sources: ['openalex'],
    });
    expect(records[0]!.authors).toEqual([{ name: 'Minh Trần' }]);
    expect(records[0]!.sourceRefs[0]).toMatchObject({ source: 'openalex', sourceId: 'https://openalex.org/W1001' });
    const url = new URL(fetchMock.calls[0]!);
    expect(url.searchParams.get('search.title_abstract_keywords')).toBe('machine learning');
    expect(url.searchParams.get('filter')).toBe('has_doi:true');
    expect(url.searchParams.get('select')).toContain('abstract_inverted_index');
  });

  it('phân trang và giới hạn: 150 kết quả -> 2 trang per_page=100 và cắt đúng 150', async () => {
    const page = (start: number) => openAlexPage(Array.from({ length: 100 }, (_, i) => openAlexWork(start + i)));
    const fetchMock = mockFetch(() => jsonResponse(page(0)), () => jsonResponse(page(100)));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 150 });
    expect(records).toHaveLength(150);
    expect(new URL(fetchMock.calls[1]!).searchParams.get('page')).toBe('2');
  });

  it.each([
    [{ yearFrom: 2020, yearTo: 2024 }, 'publication_year:2020-2024,has_doi:true'],
    [{ yearFrom: 2020 }, 'publication_year:>2019,has_doi:true'],
    [{ yearTo: 2024 }, 'publication_year:<2025,has_doi:true'],
    [{ onlyWithDoi: false }, null],
  ])('bộ lọc năm/DOI %j', async (extra, expected) => {
    const fetchMock = mockFetch(() => jsonResponse(openAlexPage([], 0)));
    await make(fetchMock).search({ ...base, ...extra });
    expect(new URL(fetchMock.calls[0]!).searchParams.get('filter')).toBe(expected);
  });

  it('gửi API key bằng header Authorization, không đưa vào URL', async () => {
    let seen: RequestInit | undefined;
    const fetchMock = mockFetch((_url, init) => {
      seen = init;
      return jsonResponse(openAlexPage([], 0));
    });
    await make(fetchMock, 'secret-key').search(base);
    expect((seen?.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
    expect(fetchMock.calls[0]).not.toContain('secret-key');
  });

  it('metadata thiếu / null không gây lỗi', () => {
    const record = mapOpenAlexWork(
      { id: 'https://openalex.org/W1', doi: null, display_name: null, publication_year: null, authorships: null, primary_location: null, type: null, abstract_inverted_index: null },
      'k',
      NOW.toISOString(),
    )!;
    expect(record).toMatchObject({ title: '', doi: '', authors: [], publicationYear: null, journal: '', publisher: '', abstract: '', documentType: '' });
    expect(record.originalUrl).toBe('https://openalex.org/W1');
  });

  it('preprint được đánh dấu theo type', () => {
    expect(mapOpenAlexWork({ id: 'https://openalex.org/W1', type: 'preprint' }, 'k', '')!.isPreprint).toBe(true);
  });

  it('HTTP 429 hết ngân sách ngày -> rate_limited và không có kết quả', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ error: 'budget' }, { status: 429, headers: { 'retry-after': '40000' } }));
    const { records, error } = await make(fetchMock).search(base);
    expect(records).toEqual([]);
    expect(error?.code).toBe('rate_limited');
  });

  it('bad_response khi thiếu results', async () => {
    const { error } = await make(mockFetch(() => jsonResponse({ meta: {} }))).search(base);
    expect(error?.code).toBe('bad_response');
  });
});

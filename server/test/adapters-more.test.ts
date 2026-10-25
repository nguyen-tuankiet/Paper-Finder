import { describe, expect, it } from 'vitest';
import { ArxivAdapter, mapArxivEntry } from '../src/sources/arxiv.js';
import { DoajAdapter, mapDoajArticle } from '../src/sources/doaj.js';
import { EuropePmcAdapter, mapEuropePmcResult } from '../src/sources/europepmc.js';
import { SemanticScholarAdapter } from '../src/sources/semanticscholar.js';
import { jsonResponse, makeHttp, mockFetch, noLimit } from './helpers.js';

const NOW = new Date('2026-10-25T00:00:00Z');
const base = { keyword: 'machine learning', maxResults: 20, onlyWithDoi: false };
const xmlResponse = (xml: string, status = 200) => new Response(xml, { status, headers: { 'content-type': 'application/atom+xml' } });

// ---------------- Europe PMC ----------------
const epmcJournal = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `3635${n}`,
  source: 'MED',
  doi: `10.1590/ABC.${n}`,
  title: `Comment on <i>AI</i> in medicine ${n}`,
  authorString: 'Malerbi FK, Krakauer M, Schaan B.',
  authorList: { author: [{ fullName: 'Malerbi FK', firstName: 'Fernando K', lastName: 'Malerbi' }, { fullName: 'Krakauer M' }] },
  journalInfo: { journal: { title: 'Revista da Associacao Medica Brasileira' }, yearOfPublication: 2022 },
  pubYear: '2022',
  pubTypeList: { pubType: ['article-commentary', 'Journal Article'] },
  abstractText: '<h4>Aim</h4>This paper aims to present.',
  ...extra,
});
const epmcPage = (results: unknown[], hitCount = 1000, nextCursorMark = 'CURSOR2') => ({ hitCount, nextCursorMark, resultList: { result: results } });

describe('Europe PMC adapter', () => {
  const make = (fetchMock: ReturnType<typeof mockFetch>) => new EuropePmcAdapter({ http: makeHttp(fetchMock), limiter: noLimit(), now: () => NOW });

  it('chuẩn hóa bài báo tạp chí', async () => {
    const fetchMock = mockFetch(() => jsonResponse(epmcPage([epmcJournal(1)], 1)));
    const { records, error } = await make(fetchMock).search(base);
    expect(error).toBeUndefined();
    expect(records[0]).toMatchObject({
      title: 'Comment on AI in medicine 1',
      doi: '10.1590/abc.1',
      publicationYear: 2022,
      journal: 'Revista da Associacao Medica Brasileira',
      documentType: 'Journal Article',
      isPreprint: false,
      abstract: 'Aim This paper aims to present.',
      sources: ['europepmc'],
      originalUrl: 'https://europepmc.org/article/MED/36351',
    });
    expect(records[0]!.authors.map((a) => a.name)).toEqual(['Fernando K Malerbi', 'Krakauer M']);
    expect(records[0]!.sourceRefs[0]).toMatchObject({ source: 'europepmc', sourceId: 'MED:36351' });
  });

  it('preprint (SRC:PPR): đánh dấu preprint, nhà xuất bản là máy chủ preprint', () => {
    const record = mapEuropePmcResult(
      { id: 'PPR534567', source: 'PPR', doi: '10.21203/rs.3.rs-1885746/v2', title: 'T', pubYear: '2022', pubTypeList: { pubType: ['Preprint'] }, bookOrReportDetails: { publisher: 'Research Square' } },
      'k',
      '',
    )!;
    expect(record).toMatchObject({ isPreprint: true, documentType: 'preprint', journal: 'Research Square', publisher: 'Research Square' });
  });

  it('thiếu tác giả/năm/tạp chí: không bịa; thiếu id/source thì bỏ qua', () => {
    const record = mapEuropePmcResult({ id: '1', source: 'MED', title: 'Only title' }, 'k', '')!;
    expect(record).toMatchObject({ authors: [], publicationYear: null, journal: '', doi: '', abstract: '' });
    expect(mapEuropePmcResult({ title: 'x' }, 'k', '')).toBeNull();
    expect(mapEuropePmcResult(null, 'k', '')).toBeNull();
  });

  it('tác giả lấy từ authorString khi không có authorList', () => {
    const record = mapEuropePmcResult({ id: '1', source: 'MED', authorString: 'Smith J, Lee K.' }, 'k', '')!;
    expect(record.authors.map((a) => a.name)).toEqual(['Smith J', 'Lee K']);
  });

  it('truy vấn: TITLE_ABS, lọc năm và HAS_DOI; phân trang bằng cursorMark; bỏ DOI lặp (MED + PMC)', async () => {
    const page1 = epmcPage(Array.from({ length: 100 }, (_, i) => epmcJournal(i)), 500, 'C2');
    const page2 = epmcPage([epmcJournal(5, { source: 'PMC', id: 'PMC5' }), ...Array.from({ length: 99 }, (_, i) => epmcJournal(100 + i))], 500, 'C3');
    const fetchMock = mockFetch(() => jsonResponse(page1), () => jsonResponse(page2));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 150, yearFrom: 2020, yearTo: 2024, onlyWithDoi: true });
    expect(records).toHaveLength(150);
    expect(new Set(records.map((r) => r.doi)).size).toBe(150);
    const first = new URL(fetchMock.calls[0]!).searchParams;
    expect(first.get('query')).toBe('TITLE_ABS:(machine learning) AND PUB_YEAR:[2020 TO 2024] AND HAS_DOI:y');
    expect(first.get('cursorMark')).toBe('*');
    expect(new URL(fetchMock.calls[1]!).searchParams.get('cursorMark')).toBe('C2');
  });

  it('ký tự đặc biệt trong từ khóa không phá cú pháp truy vấn', async () => {
    const fetchMock = mockFetch(() => jsonResponse(epmcPage([], 0, '')));
    await make(fetchMock).search({ ...base, keyword: 'AI: "education" (2020)/ml?' });
    expect(new URL(fetchMock.calls[0]!).searchParams.get('query')).toBe('TITLE_ABS:(AI education 2020 ml)');
  });

  it('lỗi 503 -> trả lỗi server_error, không ném', async () => {
    const { records, error } = await new EuropePmcAdapter({ http: makeHttp(mockFetch(() => jsonResponse('', { status: 503 })), { maxRetries: 0 }), limiter: noLimit() }).search(base);
    expect(records).toEqual([]);
    expect(error?.code).toBe('server_error');
  });

  it('cấu trúc lạ -> bad_response', async () => {
    const { error } = await make(mockFetch(() => jsonResponse({ nope: 1 }))).search(base);
    expect(error?.code).toBe('bad_response');
  });
});

// ---------------- DOAJ ----------------
const doajArticle = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `doaj${n}`,
  bibjson: {
    title: `Learning-based control ${n}`,
    year: '2022',
    month: '12',
    abstract: 'The steering mechanism of ship.',
    author: [{ name: 'Xiaolong Tang', affiliation: 'Shanghai' }, { name: 'Changjie Wu' }],
    identifier: [{ id: `10.3390/JMSE.${n}`, type: 'doi' }, { id: '2077-1312', type: 'eissn' }],
    link: [{ type: 'fulltext', content_type: 'text/html', url: `https://www.mdpi.com/${n}` }],
    journal: { title: 'Journal of Marine Science and Engineering', publisher: 'MDPI AG' },
    ...extra,
  },
});

describe('DOAJ adapter', () => {
  const make = (fetchMock: ReturnType<typeof mockFetch>) => new DoajAdapter({ http: makeHttp(fetchMock), limiter: noLimit(), now: () => NOW });

  it('chuẩn hóa bài báo', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ total: 1, page: 1, pageSize: 20, results: [doajArticle(1)] }));
    const { records, error } = await make(fetchMock).search(base);
    expect(error).toBeUndefined();
    expect(records[0]).toMatchObject({
      title: 'Learning-based control 1',
      doi: '10.3390/jmse.1',
      publicationYear: 2022,
      journal: 'Journal of Marine Science and Engineering',
      publisher: 'MDPI AG',
      documentType: '',
      abstract: 'The steering mechanism of ship.',
      originalUrl: 'https://www.mdpi.com/1',
      sources: ['doaj'],
    });
    expect(records[0]!.authors.map((a) => a.name)).toEqual(['Xiaolong Tang', 'Changjie Wu']);
  });

  it('truy vấn có lọc năm, phân trang page/pageSize', async () => {
    const page = (start: number, n: number) => ({ total: 500, results: Array.from({ length: n }, (_, i) => doajArticle(start + i)) });
    const fetchMock = mockFetch(() => jsonResponse(page(0, 100)), () => jsonResponse(page(100, 100)));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 150, yearFrom: 2021, yearTo: 2022 });
    expect(records).toHaveLength(150);
    const url = fetchMock.calls[0]!;
    expect(decodeURIComponent(url)).toContain('(machine learning) AND bibjson.year:[2021 TO 2022]');
    expect(url).toContain('pageSize=100&page=1');
    expect(fetchMock.calls[1]).toContain('page=2');
  });

  it('onlyWithDoi loại bài không có DOI và duyệt thêm trang để đủ số lượng', async () => {
    const noDoi = (n: number) => doajArticle(n, { identifier: [{ id: '1234-5678', type: 'pissn' }] });
    const page1 = { total: 200, results: [...Array.from({ length: 50 }, (_, i) => noDoi(i)), ...Array.from({ length: 50 }, (_, i) => doajArticle(50 + i))] };
    const page2 = { total: 200, results: Array.from({ length: 100 }, (_, i) => doajArticle(100 + i)) };
    const fetchMock = mockFetch(() => jsonResponse(page1), () => jsonResponse(page2));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 100, onlyWithDoi: true });
    expect(records).toHaveLength(100);
    expect(records.every((r) => r.doi)).toBe(true);
    expect(fetchMock.calls).toHaveLength(2);
  });

  it('thiếu dữ liệu: không DOI -> URL bài trên DOAJ; thiếu bibjson thì bỏ qua', () => {
    const record = mapDoajArticle({ id: 'abc', bibjson: { title: 'T', identifier: [] } }, 'k', '')!;
    expect(record).toMatchObject({ doi: '', authors: [], publicationYear: null, originalUrl: 'https://doaj.org/article/abc' });
    expect(mapDoajArticle({ id: 'x' }, 'k', '')).toBeNull();
  });

  it('lỗi 429 dài -> rate_limited', async () => {
    const fetchMock = mockFetch(() => jsonResponse('', { status: 429, headers: { 'retry-after': '3600' } }));
    expect((await make(fetchMock).search(base)).error?.code).toBe('rate_limited');
  });
});

// ---------------- arXiv ----------------
const entryXml = (n: number, extra = '') => `
  <entry>
    <id>http://arxiv.org/abs/2507.0937${n}v1</id>
    <updated>2025-07-12T18:45:50Z</updated>
    <published>2025-07-12T18:45:50Z</published>
    <title>Automated Crop
      Pathology &amp; Classification ${n}</title>
    <summary>Crop diseases present
      a significant barrier. 100 &lt; 200.</summary>
    <author><name>Nguyễn Văn An</name></author>
    <author><name>Jane Roe</name></author>
    <link href="https://arxiv.org/abs/2507.0937${n}v1" rel="alternate" type="text/html"/>
    ${extra}
  </entry>`;
const feedXml = (entries: string, total = 669) => `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>${total}</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>${entries}
</feed>`;

describe('arXiv adapter', () => {
  const make = (fetchMock: ReturnType<typeof mockFetch>) => new ArxivAdapter({ http: makeHttp(fetchMock), limiter: noLimit(), now: () => NOW });

  it('phân tích Atom XML: tiêu đề nhiều dòng, entity, tác giả, năm, preprint', async () => {
    const fetchMock = mockFetch(() => xmlResponse(feedXml(entryXml(1) + entryXml(2), 2)));
    const { records, error } = await make(fetchMock).search(base);
    expect(error).toBeUndefined();
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      title: 'Automated Crop Pathology & Classification 1',
      doi: '',
      publicationYear: 2025,
      journal: 'arXiv',
      documentType: 'preprint',
      isPreprint: true,
      abstract: 'Crop diseases present a significant barrier. 100 < 200.',
      originalUrl: 'https://arxiv.org/abs/2507.09371',
      sources: ['arxiv'],
    });
    expect(records[0]!.authors.map((a) => a.name)).toEqual(['Nguyễn Văn An', 'Jane Roe']);
    expect(records[0]!.sourceRefs[0]).toMatchObject({ source: 'arxiv', sourceId: '2507.09371' });
  });

  it('chỉ dùng DOI do arXiv cung cấp (arxiv:doi), không tự tạo DOI', async () => {
    const fetchMock = mockFetch(() => xmlResponse(feedXml(entryXml(1, '<arxiv:doi>10.1016/J.COMPAG.2025.1</arxiv:doi>') + entryXml(2), 2)));
    const { records } = await make(fetchMock).search(base);
    expect(records.map((r) => r.doi)).toEqual(['10.1016/j.compag.2025.1', '']);
  });

  it('onlyWithDoi: chỉ giữ bài có DOI', async () => {
    const fetchMock = mockFetch(() => xmlResponse(feedXml(entryXml(1, '<arxiv:doi>10.1016/x.1</arxiv:doi>') + entryXml(2), 2)));
    const { records } = await make(fetchMock).search({ ...base, onlyWithDoi: true });
    expect(records).toHaveLength(1);
  });

  it('truy vấn: bỏ stopword, lọc năm bằng submittedDate, phân trang start/max_results', async () => {
    const fetchMock = mockFetch(() => xmlResponse(feedXml(Array.from({ length: 100 }, (_, i) => entryXml(i)).join(''), 400)), () => xmlResponse(feedXml(Array.from({ length: 50 }, (_, i) => entryXml(100 + i)).join(''), 400)));
    const { records } = await make(fetchMock).search({ ...base, keyword: 'Deep learning for crop disease detection', maxResults: 150, yearFrom: 2020, yearTo: 2024 });
    expect(records).toHaveLength(150);
    const first = new URL(fetchMock.calls[0]!).searchParams;
    expect(first.get('search_query')).toBe('all:deep AND all:learning AND all:crop AND all:disease AND all:detection AND submittedDate:[202001010000 TO 202412312359]');
    expect(first.get('max_results')).toBe('100');
    expect(new URL(fetchMock.calls[1]!).searchParams.get('start')).toBe('100');
    expect(new URL(fetchMock.calls[1]!).searchParams.get('max_results')).toBe('50');
  });

  it('arXiv báo lỗi truy vấn bằng entry /api/errors -> client_error', async () => {
    const errorEntry = `<entry><id>http://arxiv.org/api/errors#incorrect_id_format_for_1</id><title>Error</title><summary>incorrect id format</summary></entry>`;
    const { error } = await make(mockFetch(() => xmlResponse(feedXml(errorEntry, 1)))).search(base);
    expect(error?.code).toBe('client_error');
  });

  it('không có kết quả -> danh sách rỗng; XML hỏng -> bad_response', async () => {
    expect((await make(mockFetch(() => xmlResponse(feedXml('', 0)))).search(base)).records).toEqual([]);
    expect((await make(mockFetch(() => xmlResponse('<html>lỗi</html>'))).search(base)).error?.code).toBe('bad_response');
  });

  it('mapArxivEntry bỏ qua entry không có id', () => {
    expect(mapArxivEntry({ title: 'x' }, 'k', '')).toBeNull();
  });
});

// ---------------- Semantic Scholar ----------------
const s2Paper = (n: number, extra: Record<string, unknown> = {}) => ({
  paperId: `abc${n}`,
  title: `S2 paper ${n}`,
  externalIds: { DOI: `10.5555/S2.${n}`, ArXiv: '2001.0001' },
  year: 2023,
  authors: [{ authorId: '1', name: 'Ada Lovelace' }],
  venue: 'Nature',
  journal: { name: 'Nature Machine Intelligence' },
  publicationTypes: ['JournalArticle'],
  abstract: 'An abstract.',
  url: `https://www.semanticscholar.org/paper/abc${n}`,
  ...extra,
});

describe('Semantic Scholar adapter', () => {
  const make = (fetchMock: ReturnType<typeof mockFetch>, apiKey = 'k123') => new SemanticScholarAdapter({ http: makeHttp(fetchMock), limiter: noLimit(), apiKey, now: () => NOW });

  it('chuẩn hóa dữ liệu, gửi key bằng header x-api-key và lọc năm', async () => {
    let seen: RequestInit | undefined;
    const fetchMock = mockFetch((_u, init) => {
      seen = init;
      return jsonResponse({ total: 1, offset: 0, data: [s2Paper(1)] });
    });
    const { records, error } = await make(fetchMock).search({ ...base, yearFrom: 2020, yearTo: 2024 });
    expect(error).toBeUndefined();
    expect((seen?.headers as Record<string, string>)['x-api-key']).toBe('k123');
    expect(fetchMock.calls[0]).not.toContain('k123');
    expect(new URL(fetchMock.calls[0]!).searchParams.get('year')).toBe('2020-2024');
    expect(records[0]).toMatchObject({
      title: 'S2 paper 1',
      doi: '10.5555/s2.1',
      publicationYear: 2023,
      journal: 'Nature Machine Intelligence',
      documentType: 'JournalArticle',
      isPreprint: false,
      abstract: 'An abstract.',
      originalUrl: 'https://doi.org/10.5555/s2.1',
      sources: ['semanticscholar'],
    });
  });

  it('bản ghi thiếu dữ liệu (null) và preprint arXiv', async () => {
    const sparse = s2Paper(2, { externalIds: null, year: null, authors: null, abstract: null, journal: null, venue: 'arXiv.org', publicationTypes: null });
    const { records } = await make(mockFetch(() => jsonResponse({ total: 1, data: [sparse] }))).search(base);
    expect(records[0]).toMatchObject({ doi: '', publicationYear: null, authors: [], abstract: '', documentType: '', isPreprint: true, originalUrl: 'https://www.semanticscholar.org/paper/abc2' });
  });

  it('phân trang offset/limit và giới hạn số kết quả', async () => {
    const page = (start: number, n: number) => ({ total: 800, data: Array.from({ length: n }, (_, i) => s2Paper(start + i)) });
    const fetchMock = mockFetch(() => jsonResponse(page(0, 100)), () => jsonResponse(page(100, 100)));
    const { records } = await make(fetchMock).search({ ...base, maxResults: 150 });
    expect(records).toHaveLength(150);
    expect(new URL(fetchMock.calls[1]!).searchParams.get('offset')).toBe('100');
  });

  it('không có kết quả (total 0, không có data) -> rỗng, không lỗi', async () => {
    const { records, error } = await make(mockFetch(() => jsonResponse({ total: 0, offset: 0 }))).search(base);
    expect(records).toEqual([]);
    expect(error).toBeUndefined();
  });

  it('HTTP 429 (key sai hoặc vượt hạn mức) -> rate_limited', async () => {
    const fetchMock = mockFetch(() => jsonResponse({ message: 'Too Many Requests' }, { status: 429, headers: { 'retry-after': '600' } }));
    expect((await make(fetchMock).search(base)).error?.code).toBe('rate_limited');
  });
});

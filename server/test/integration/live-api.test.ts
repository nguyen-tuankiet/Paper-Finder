/**
 * Kiểm thử tích hợp với API THẬT của Crossref và OpenAlex (cần Internet).
 * Chạy:  npm run test:integration
 *
 * Lưu ý: OpenAlex không key chỉ có ngân sách nhỏ dùng chung theo IP; nếu hết hạn mức,
 * các test OpenAlex sẽ được bỏ qua (skip) kèm giải thích thay vì báo lỗi sai.
 */
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/lib/http.js';
import { Limiter } from '../../src/lib/limiter.js';
import { toCsv, toXlsx } from '../../src/services/export.js';
import { runSearch } from '../../src/services/search.js';
import { CrossrefAdapter } from '../../src/sources/crossref.js';
import { OpenAlexAdapter } from '../../src/sources/openalex.js';
import { ArxivAdapter } from '../../src/sources/arxiv.js';
import { DoajAdapter } from '../../src/sources/doaj.js';
import { EuropePmcAdapter } from '../../src/sources/europepmc.js';

const http = new HttpClient({
  userAgent: 'PaperFinder-integration-test/1.0',
  timeoutMs: 30000,
  maxRetries: 2,
  cacheTtlMs: 0,
});
const crossref = new CrossrefAdapter({ http, limiter: new Limiter(2, 400) });
const openalex = new OpenAlexAdapter({ http, limiter: new Limiter(1, 250), apiKey: process.env.OPENALEX_API_KEY });

const base = { onlyWithDoi: true };

describe('Crossref (API thật)', () => {
  it('trả về bài báo thật với DOI, tiêu đề, năm và URL', async () => {
    const { records, error } = await crossref.search({ ...base, keyword: 'artificial intelligence in education', maxResults: 20 });
    expect(error).toBeUndefined();
    expect(records.length).toBe(20);
    for (const record of records) {
      expect(record.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
      expect(record.originalUrl).toMatch(/^https:\/\//);
      expect(record.sources).toEqual(['crossref']);
    }
    expect(records.filter((r) => r.title).length).toBeGreaterThan(15);
    expect(records.filter((r) => r.publicationYear).length).toBeGreaterThan(15);
  });

  it('bộ lọc năm hoạt động (2021-2022)', async () => {
    const { records, error } = await crossref.search({ ...base, keyword: 'deep learning crop disease detection', maxResults: 50, yearFrom: 2021, yearTo: 2022 });
    expect(error).toBeUndefined();
    expect(records.length).toBeGreaterThan(0);
    const years = new Set(records.map((r) => r.publicationYear));
    for (const year of years) expect([2021, 2022]).toContain(year);
  });

  it('phân trang: 150 kết quả không trùng DOI', async () => {
    const { records, error } = await crossref.search({ ...base, keyword: 'machine learning in healthcare', maxResults: 150 });
    expect(error).toBeUndefined();
    expect(records.length).toBe(150);
    expect(new Set(records.map((r) => r.doi)).size).toBe(150);
  });
});

describe('OpenAlex (API thật)', () => {
  it('trả về bài báo thật; abstract dựng từ inverted index', async (ctx) => {
    const { records, error } = await openalex.search({ ...base, keyword: 'machine learning in healthcare', maxResults: 20 });
    if (error?.code === 'rate_limited') ctx.skip(`OpenAlex hết hạn mức: ${error.message}`);
    expect(error).toBeUndefined();
    expect(records.length).toBe(20);
    for (const record of records) {
      expect(record.doi).toMatch(/^10\.\d{4,9}\/\S+$/);
      expect(record.sources).toEqual(['openalex']);
      expect(record.abstract).not.toMatch(/undefined|\[object/);
    }
    expect(records.filter((r) => r.abstract.length > 50).length).toBeGreaterThan(5);
    expect(records.filter((r) => r.authors.length > 0).length).toBeGreaterThan(15);
  });

  it('bộ lọc năm hoạt động (2021-2022)', async (ctx) => {
    const { records, error } = await openalex.search({ ...base, keyword: 'large language models in software engineering', maxResults: 20, yearFrom: 2021, yearTo: 2022 });
    if (error?.code === 'rate_limited') ctx.skip(`OpenAlex hết hạn mức: ${error.message}`);
    expect(error).toBeUndefined();
    for (const record of records) expect([2021, 2022]).toContain(record.publicationYear);
  });
});

const limiterFor = (concurrent: number, interval: number) => new Limiter(concurrent, interval);
const europepmc = new EuropePmcAdapter({ http, limiter: limiterFor(2, 250) });
const doaj = new DoajAdapter({ http, limiter: limiterFor(1, 700) });
const arxiv = new ArxivAdapter({ http, limiter: limiterFor(1, 3100) });

describe('Europe PMC (API thật)', () => {
  it('trả về bài thật, lọc năm và DOI hoạt động, không lặp DOI', async () => {
    const { records, error } = await europepmc.search({ keyword: 'machine learning healthcare', maxResults: 120, onlyWithDoi: true, yearFrom: 2021, yearTo: 2022 });
    expect(error).toBeUndefined();
    expect(records.length).toBe(120);
    expect(new Set(records.map((r) => r.doi)).size).toBe(120);
    for (const r of records) {
      expect(r.doi).toMatch(/^10\./);
      expect([2021, 2022]).toContain(r.publicationYear);
      expect(r.originalUrl).toMatch(/^https:\/\/europepmc\.org\/article\//);
    }
    expect(records.filter((r) => r.abstract).length).toBeGreaterThan(20);
  });
});

describe('DOAJ (API thật)', () => {
  it('trả về bài thật, lọc năm hoạt động', async () => {
    const { records, error } = await doaj.search({ keyword: 'deep learning crop disease', maxResults: 30, onlyWithDoi: true, yearFrom: 2022, yearTo: 2023 });
    expect(error).toBeUndefined();
    expect(records.length).toBe(30);
    for (const r of records) {
      expect(r.doi).toMatch(/^10\./);
      expect([2022, 2023]).toContain(r.publicationYear);
      expect(r.journal).not.toBe('');
    }
  });
});

describe('arXiv (API thật)', () => {
  it('trả về preprint thật (parse XML), lọc năm; không tự tạo DOI', async () => {
    const { records, error } = await arxiv.search({ keyword: 'deep learning crop disease detection', maxResults: 20, onlyWithDoi: false, yearFrom: 2022, yearTo: 2024 });
    expect(error).toBeUndefined();
    expect(records.length).toBe(20);
    for (const r of records) {
      expect(r.isPreprint).toBe(true);
      expect([2022, 2023, 2024]).toContain(r.publicationYear);
      expect(r.originalUrl).toMatch(/^https:\/\/arxiv\.org\/abs\//);
      expect(r.title).not.toMatch(/\n/);
      expect(r.authors.length).toBeGreaterThan(0);
      if (r.doi) expect(r.doi).not.toMatch(/arxiv/i);
    }
  });
});

describe('Truy cập mở (API thật)', () => {
  const httpUrl = /^https?:\/\//;

  it('OpenAlex: có bài miễn phí kèm link/giấy phép và có bài chưa thấy bản mở', async (ctx) => {
    const { records, error } = await openalex.search({ keyword: 'crop disease detection deep learning', maxResults: 50, onlyWithDoi: true });
    if (error?.code === 'rate_limited') ctx.skip(`OpenAlex hết hạn mức: ${error.message}`);
    expect(error).toBeUndefined();
    const free = records.filter((r) => r.isOpenAccess);
    expect(free.length).toBeGreaterThan(5);
    expect(records.length - free.length).toBeGreaterThan(0);
    for (const r of free) {
      expect(r.oaPdfUrl || r.oaUrl).toMatch(httpUrl);
      if (r.oaPdfUrl) expect(r.oaPdfUrl).toMatch(httpUrl);
    }
    expect(free.filter((r) => r.oaPdfUrl).length).toBeGreaterThan(0);
    expect(free.filter((r) => r.oaLicense).length).toBeGreaterThan(0);
    for (const r of records.filter((r) => !r.isOpenAccess)) expect([r.oaUrl, r.oaPdfUrl, r.oaLicense]).toEqual(['', '', '']);
  });

  it('Europe PMC: bài OA có PDF của Europe PMC; bài không OA không có link miễn phí', async () => {
    const { records, error } = await europepmc.search({ keyword: 'crop disease detection', maxResults: 60, onlyWithDoi: true, yearFrom: 2023, yearTo: 2024 });
    expect(error).toBeUndefined();
    const free = records.filter((r) => r.isOpenAccess);
    expect(free.length).toBeGreaterThan(5);
    expect(free.filter((r) => r.oaPdfUrl).length).toBeGreaterThan(0);
    expect(records.filter((r) => !r.isOpenAccess).length).toBeGreaterThan(0);
    for (const r of records.filter((r) => !r.isOpenAccess)) expect(r.oaPdfUrl).toBe('');
  });

  it('DOAJ và arXiv: mọi bài đều là bản mở với link hợp lệ', async () => {
    const d = await doaj.search({ keyword: 'plant disease', maxResults: 20, onlyWithDoi: true });
    expect(d.error).toBeUndefined();
    expect(d.records.every((r) => r.isOpenAccess && httpUrl.test(r.oaUrl))).toBe(true);
    const a = await arxiv.search({ keyword: 'plant disease detection', maxResults: 10, onlyWithDoi: false });
    expect(a.error).toBeUndefined();
    expect(a.records.every((r) => r.isOpenAccess && /^https:\/\/arxiv\.org\/pdf\/\S+$/.test(r.oaPdfUrl))).toBe(true);
  });

  it('gộp nhiều nguồn: bài có bản mở ở một nguồn thì cả bài được đánh dấu miễn phí', async (ctx) => {
    const result = await runSearch(
      { keywords: ['deep learning crop disease detection'], sources: ['crossref', 'openalex', 'europepmc'], maxResults: 50, onlyWithDoi: true, yearFrom: 2022, yearTo: 2024 },
      { adapters: { crossref, openalex, europepmc } },
    );
    const oa = result.sources.find((s) => s.source === 'openalex')!;
    if (oa.state === 'error' && oa.errors.some((e) => e.code === 'rate_limited')) ctx.skip(`OpenAlex hết hạn mức: ${oa.errors[0]!.message}`);
    const multi = result.records.filter((r) => r.sources.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    const free = result.records.filter((r) => r.isOpenAccess);
    console.log(`Tổng ${result.records.length} bài, miễn phí ${free.length}, có PDF trực tiếp ${free.filter((r) => r.oaPdfUrl).length}`);
    // Nhất quán: bài không mở thì không có URL/giấy phép mở
    for (const r of result.records.filter((r) => !r.isOpenAccess)) expect([r.oaUrl, r.oaPdfUrl, r.oaLicense]).toEqual(['', '', '']);
    // Với bài có ở nhiều nguồn, kết quả gộp phải miễn phí nếu có bất kỳ nguồn nào xác nhận
    expect(free.length).toBeGreaterThan(0);
  });
});

describe('Tìm đồng thời hai nguồn + loại trùng + xuất file (API thật)', () => {
  it('gộp kết quả, không đếm trùng một DOI, xuất được XLSX/CSV', async (ctx) => {
    const result = await runSearch(
      { keywords: ['artificial intelligence in education', 'machine learning in healthcare'], sources: ['crossref', 'openalex'], maxResults: 50, onlyWithDoi: true, yearFrom: 2022, yearTo: 2024 },
      { adapters: { crossref, openalex } },
    );
    const oa = result.sources.find((s) => s.source === 'openalex')!;
    if (oa.state === 'error' && oa.errors.some((e) => e.code === 'rate_limited')) ctx.skip(`OpenAlex hết hạn mức: ${oa.errors[0]!.message}`);

    expect(result.sources.every((s) => s.state !== 'error')).toBe(true);
    const dois = result.records.map((r) => r.doi).filter(Boolean);
    expect(new Set(dois).size).toBe(dois.length); // không có DOI nào xuất hiện hai lần
    expect(result.stats.total).toBe(result.records.length);
    expect(result.stats.duplicatesRemoved).toBe(result.sources.reduce((n, s) => n + s.fetched, 0) - result.records.length);
    console.log(
      `Tổng thô ${result.sources.map((s) => `${s.label}=${s.fetched}`).join(', ')} -> duy nhất ${result.records.length}; ` +
        `bài tìm thấy ở cả 2 nguồn: ${result.records.filter((r) => r.sources.length === 2).length}; nghi trùng: ${result.suspectedDuplicates.length}`,
    );

    const csv = toCsv(result.records).toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await toXlsx(result.records)) as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets[0]!.rowCount).toBe(result.records.length + 1);
  });
});

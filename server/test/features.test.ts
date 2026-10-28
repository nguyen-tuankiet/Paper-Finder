import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaperRecord, PlansResponse, SearchResult } from '../../shared/types.js';
import { createAccountsContext, type AccountsContext } from '../src/accounts/context.js';
import { MemoryAccountStore } from '../src/accounts/memoryStore.js';
import { createApp } from '../src/app.js';
import { UpstreamError } from '../src/lib/errors.js';
import { normalizeIssn, recordSignals } from '../src/lib/signals.js';
import { silentLogger } from '../src/logger.js';
import { buildReferencesDocx } from '../src/services/docx.js';
import { toBibtex, toRis, toXlsx } from '../src/services/export.js';
import { mergeRecords } from '../src/services/dedupe.js';
import { JournalRanker } from '../src/services/journalRank.js';
import { extractDois, lookupDois } from '../src/services/lookup.js';
import type { AdapterMap } from '../src/services/search.js';
import { mapCrossrefItem } from '../src/sources/crossref.js';
import { mapDoajArticle } from '../src/sources/doaj.js';
import { mapEuropePmcResult } from '../src/sources/europepmc.js';
import { mapOpenAlexWork } from '../src/sources/openalex.js';
import type { SourceAdapter } from '../src/sources/types.js';
import { crossrefItem, makeRecord, openAlexWork } from './helpers.js';

const NOW = '2026-10-25T00:00:00.000Z';

describe('tín hiệu bổ sung của bản ghi', () => {
  it('chuẩn hóa ISSN', () => {
    expect(normalizeIssn('0140-6736')).toBe('01406736');
    expect(normalizeIssn(' 1474-547x ')).toBe('1474547X');
    for (const bad of ['', '1234', '12345678X', 'abcd-efgh', 123, null, undefined]) expect(normalizeIssn(bad)).toBeNull();
  });

  it('chỉ trả các trường hợp lệ', () => {
    expect(recordSignals({})).toEqual({});
    expect(recordSignals({ citedBy: 0 })).toEqual({ citedByCount: 0 });
    expect(recordSignals({ citedBy: 12.9, retracted: true, issns: ['0140-6736', '01406736', 'xx', '1474-547X'] })).toEqual({ citedByCount: 12, isRetracted: true, issn: ['01406736', '1474547X'] });
    expect(recordSignals({ citedBy: -1, retracted: false, issns: 'abc' })).toEqual({});
    expect(recordSignals({ citedBy: '5' as unknown as number, retracted: 'true' as unknown as boolean })).toEqual({});
    expect(recordSignals({ issns: '1234-5678' })).toEqual({ issn: ['12345678'] });
  });
});

describe('adapter đọc số trích dẫn, trạng thái rút lại và ISSN', () => {
  it('OpenAlex', () => {
    const work = openAlexWork(1, { cited_by_count: 3007, is_retracted: true, primary_location: { landing_page_url: 'https://x', source: { display_name: 'The Lancet', issn: ['0099-5355', '0140-6736'] } } });
    expect(mapOpenAlexWork(work, 'k', NOW)).toMatchObject({ citedByCount: 3007, isRetracted: true, issn: ['00995355', '01406736'] });
    const plain = mapOpenAlexWork(openAlexWork(2), 'k', NOW)!;
    expect(plain).not.toHaveProperty('isRetracted');
    expect(plain).not.toHaveProperty('citedByCount');
    expect(mapOpenAlexWork(openAlexWork(3, { is_retracted: false, cited_by_count: 0 }), 'k', NOW)).toMatchObject({ citedByCount: 0 });
  });

  it('Crossref: updated-by loại retraction mới tính là đã rút lại', () => {
    const retracted = mapCrossrefItem(crossrefItem(1, { 'is-referenced-by-count': 2046, ISSN: ['0140-6736'], 'updated-by': [{ type: 'correction' }, { type: 'retraction', source: 'retraction-watch' }] }), 'k', NOW)!;
    expect(retracted).toMatchObject({ citedByCount: 2046, isRetracted: true, issn: ['01406736'] });
    const corrected = mapCrossrefItem(crossrefItem(2, { 'updated-by': [{ type: 'correction' }] }), 'k', NOW)!;
    expect(corrected).not.toHaveProperty('isRetracted');
    expect(mapCrossrefItem(crossrefItem(3, { 'updated-by': 'bad' }), 'k', NOW)).not.toHaveProperty('isRetracted');
  });

  it('Europe PMC và DOAJ', () => {
    const epmc = mapEuropePmcResult({ id: '1', source: 'MED', title: 'T', citedByCount: 15, journalInfo: { journal: { title: 'J', issn: '1234-5678', essn: '8765-4321' } } }, 'k', NOW)!;
    expect(epmc).toMatchObject({ citedByCount: 15, issn: ['12345678', '87654321'] });
    const doaj = mapDoajArticle({ id: 'a', bibjson: { title: 'T', journal: { title: 'J', issns: ['1111-2222'] } } }, 'k', NOW)!;
    expect(doaj.issn).toEqual(['11112222']);
  });
});

describe('gộp bản ghi', () => {
  it('số trích dẫn lấy lớn nhất, rút lại nếu bất kỳ nguồn nào báo, ISSN gộp', () => {
    const a = makeRecord({ title: 'A', doi: '10.1/a', citedByCount: 10, issn: ['11112222'] });
    const b = makeRecord({ title: 'A', doi: '10.1/a', citedByCount: 25, isRetracted: true, issn: ['11112222', '33334444'], sources: ['openalex'] });
    const merged = mergeRecords([a, b]);
    expect(merged.citedByCount).toBe(25);
    expect(merged.isRetracted).toBe(true);
    expect(merged.issn?.sort()).toEqual(['11112222', '33334444']);
    const bare = mergeRecords([makeRecord({ doi: '10.1/x' }), makeRecord({ doi: '10.1/x', sources: ['openalex'] })]);
    for (const key of ['citedByCount', 'isRetracted', 'issn']) expect(bare).not.toHaveProperty(key);
  });
});

describe('xuất file mang tín hiệu mới', () => {
  const base = { title: 'T', doi: '10.1/t', authors: [], publicationYear: 2020, journal: 'J', publisher: '', documentType: 'journal-article', abstract: '', sources: [], originalUrl: '', queryKeywords: [] };

  it('Excel/CSV có cột Cited By, Retracted, Journal Quartile', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await toXlsx([{ ...base, citedByCount: 42, isRetracted: true, journalQuartile: 'Q1' }, base]) as unknown) as Parameters<typeof wb.xlsx.load>[0]);
    const sheet = wb.worksheets[0]!;
    expect([sheet.getCell('O2').value, sheet.getCell('P2').value, sheet.getCell('Q2').value]).toEqual([42, 'RETRACTED', 'Q1']);
    expect([sheet.getCell('O3').value, sheet.getCell('P3').value, sheet.getCell('Q3').value].map((v) => v ?? '')).toEqual(['', '', '']);
  });

  it('BibTeX và RIS ghi chú bài đã rút lại', () => {
    expect(toBibtex([{ ...base, isRetracted: true }]).toString()).toContain('note = {Retracted publication (bài đã bị rút lại)}');
    expect(toRis([{ ...base, isRetracted: true }]).toString()).toContain('N1  - Retracted publication');
    expect(toBibtex([base]).toString()).not.toContain('note =');
    expect(toRis([base]).toString()).not.toContain('N1  -');
  });
});

describe('tách DOI từ văn bản dán', () => {
  it('nhận DOI trần, link doi.org, doi: và DOI trong đoạn tài liệu tham khảo', () => {
    const text = [
      '10.1016/S0140-6736(97)11096-0',
      'https://doi.org/10.1038/nature12373',
      'doi:10.1000/XYZ123.',
      '[3] A. Smith, "Title," J. Test, 2020. (doi: 10.5555/abc.def).',
      'dx.doi.org/10.1234/Test-1',
    ].join('\n');
    expect(extractDois(text).dois).toEqual(['10.1016/s0140-6736(97)11096-0', '10.1038/nature12373', '10.1000/xyz123', '10.5555/abc.def', '10.1234/test-1']);
  });

  it('bỏ DOI trùng, báo dòng không có DOI, bỏ dòng trống', () => {
    const out = extractDois('10.1000/a\n\n10.1000/A\nkhông có doi ở đây\nhttps://doi.org/10.1000/a');
    expect(out.dois).toEqual(['10.1000/a']);
    expect(out.duplicates).toBe(2);
    expect(out.invalid).toEqual(['không có doi ở đây']);
  });

  it('giữ ngoặc cân bằng nằm trong DOI nhưng bỏ ngoặc thừa ở cuối', () => {
    expect(extractDois('(10.1002/(sici)1097-4571(199806)49:8<693::aid-asi4>3.0.co;2-o)').dois).toHaveLength(1);
    expect(extractDois('10.1016/s0140-6736(97)11096-0').dois).toEqual(['10.1016/s0140-6736(97)11096-0']);
    expect(extractDois('xem (10.1000/abc)').dois).toEqual(['10.1000/abc']);
  });

  it('đoạn dài không có DOI được rút gọn khi báo lỗi', () => {
    const long = 'a'.repeat(300);
    expect(extractDois(long).invalid[0]!.length).toBeLessThanOrEqual(120);
  });
});

// ---------- Adapter giả có lookupDoi ----------

const DOIS = { cr: '10.1000/crossref-only', both: '10.1000/both', retracted: '10.1000/retracted', missing: '10.4040/missing', fail: '10.5000/fail' };

function fakeAdapter(id: 'crossref' | 'openalex'): SourceAdapter {
  return {
    id,
    label: id === 'crossref' ? 'Crossref' : 'OpenAlex',
    ping: async () => {},
    search: async (p) => {
      const issn = id === 'crossref' ? ['00079235'] : undefined;
      return { records: [makeRecord({ title: `Paper ${p.keyword}`, doi: `10.9/${p.keyword.replace(/\s+/g, '-')}`, journal: 'Journal One', sources: [id], queryKeywords: [p.keyword], ...(issn ? { issn } : {}) })] };
    },
    lookupDoi: async (doi) => {
      if (doi === DOIS.fail && id === 'crossref') throw new UpstreamError('server_error', 'sự cố');
      if (doi === DOIS.missing) return null;
      if (doi === DOIS.cr && id === 'openalex') return null;
      const base = makeRecord({ title: `Title of ${doi}`, doi, journal: 'Journal One', publicationYear: 2020, sources: [id], queryKeywords: [], issn: ['00079235'] });
      if (id === 'openalex') return { ...base, citedByCount: 25, isOpenAccess: true, oaUrl: 'https://oa.example/p', ...(doi === DOIS.retracted ? { isRetracted: true } : {}) };
      return { ...base, citedByCount: 10 };
    },
  };
}

const lookupAdapters: AdapterMap = { crossref: fakeAdapter('crossref'), openalex: fakeAdapter('openalex') };

describe('tra DOI hàng loạt', () => {
  it('giữ thứ tự nhập, gộp hai nguồn, phân biệt không có và lỗi', async () => {
    const outcome = await lookupDois([DOIS.both, DOIS.cr, DOIS.missing, DOIS.fail, DOIS.retracted], { adapters: lookupAdapters, concurrency: 3, now: () => new Date(NOW) });
    const records = outcome.result.records;
    expect(records.map((r) => r.doi)).toEqual([DOIS.both, DOIS.cr, DOIS.fail, DOIS.retracted]);
    const both = records[0]!;
    expect(both.sources.sort()).toEqual(['crossref', 'openalex']);
    expect(both.citedByCount).toBe(25);
    expect(both.isOpenAccess).toBe(true);
    expect(records[1]!.sources).toEqual(['crossref']); // OpenAlex không có
    expect(records[2]!.sources).toEqual(['openalex']); // Crossref lỗi nhưng OpenAlex vẫn có
    expect(records[3]!.isRetracted).toBe(true);
    expect(outcome.notFound).toEqual([DOIS.missing]);
    expect(outcome.failed).toEqual([]);
    expect(records.every((r) => r.id)).toBe(true); // đã gán id để bảng chọn/xuất được
    expect(outcome.result.stats).toMatchObject({ total: 4, withDoi: 4, sourcesQueried: 2 });
  });

  it('DOI mà mọi nguồn đều lỗi được báo là lỗi (thử lại được), không phải không tìm thấy', async () => {
    const onlyFailing: AdapterMap = {
      crossref: { ...fakeAdapter('crossref'), lookupDoi: async () => { throw new UpstreamError('server_error', 'x'); } },
      openalex: { ...fakeAdapter('openalex'), lookupDoi: async () => { throw new UpstreamError('timeout', 'x'); } },
    };
    const outcome = await lookupDois(['10.1/a'], { adapters: onlyFailing });
    expect(outcome.failed).toEqual(['10.1/a']);
    expect(outcome.notFound).toEqual([]);
    expect(outcome.result.records).toEqual([]);
  });

  it('hủy giữa chừng thì ném lỗi cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(lookupDois(['10.1/a'], { adapters: lookupAdapters, signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });
});

// ---------- Xếp hạng tạp chí ----------

const SJR_CSV = [
  'Rank;Sourceid;Title;Type;Issn;SJR;SJR Best Quartile;H index',
  '1;1;"Journal One";journal;"00079235, 15424863";145,004;Q1;100',
  '2;2;"Journal ""Two"" Quoted";journal;"11112222";0,512;Q3;20',
  '3;3;"No Quartile";journal;"33334444";0,1;-;3',
  '4;4;"Dual Issn";journal;"55556666, 77778888";2,5;Q2;5',
  '5;5;"Higher Dual";journal;"77778888";9;Q1;5',
].join('\r\n');

describe('xếp hạng tạp chí SJR', () => {
  const ranker = JournalRanker.fromCsv(SJR_CSV);

  it('đọc CSV của SCImago: dấu ; ngoặc kép, số thập phân dùng dấu phẩy, bỏ hạng "-"', () => {
    expect(ranker.rankOf(['00079235'])).toMatchObject({ quartile: 'Q1', sjr: 145.004, title: 'Journal One' });
    expect(ranker.rankOf(['15424863'])?.quartile).toBe('Q1'); // ISSN thứ hai của cùng tạp chí
    expect(ranker.rankOf(['11112222'])).toMatchObject({ quartile: 'Q3', title: 'Journal "Two" Quoted' });
    expect(ranker.rankOf(['33334444'])).toBeUndefined();
    expect(ranker.rankOf(['99999999'])).toBeUndefined();
    expect(ranker.rankOf(undefined)).toBeUndefined();
  });

  it('ISSN thuộc hai tạp chí thì lấy hạng tốt nhất trong các ISSN của bản ghi', () => {
    expect(ranker.rankOf(['55556666', '77778888'])?.quartile).toBe('Q1');
  });

  it('gắn hạng vào bản ghi khớp ISSN, giữ nguyên bản ghi không khớp', () => {
    const [a, b] = ranker.enrich([makeRecord({ issn: ['00079235'] }), makeRecord({ issn: ['99999999'] })]);
    expect(a).toMatchObject({ journalQuartile: 'Q1', journalSjr: 145.004 });
    expect(b).not.toHaveProperty('journalQuartile');
  });

  it('file thiếu cột cần thiết hoặc rỗng thì không có dữ liệu', () => {
    expect(JournalRanker.fromCsv('').size).toBe(0);
    expect(JournalRanker.fromCsv('a;b;c\n1;2;3').size).toBe(0);
    expect(JournalRanker.fromFile('khong-co-file.csv')).toBeUndefined();
  });
});

// ---------- Xuất Word ----------

describe('xuất Word (.docx)', () => {
  it('tạo file .docx hợp lệ chứa đủ các dòng, loại ký tự điều khiển', async () => {
    const buffer = await buildReferencesDocx(['[1] A. Smith, "Một bài báo có dấu," J. Test, 2020.', '[2] Dòng\u0001có ký tự lạ & <thẻ>.', '   ']);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string');
    expect(xml).toContain('TÀI LIỆU THAM KHẢO');
    expect(xml).toContain('Một bài báo có dấu');
    expect(xml).toContain('Dòngcó ký tự lạ &amp; &lt;thẻ&gt;.');
    expect(xml).toContain('w:hanging="720"');
    expect((xml.match(/<w:p>|<w:p /g) ?? []).length).toBe(3); // tiêu đề + 2 dòng; dòng trống bị bỏ
  });
});

// ---------- API ----------

const SECRET = 'features-secret-features-secret-features-123';
const ADMIN = 'admin-password-123';
let server: Server;
let base: string;
let open: { server: Server; base: string };
let store: MemoryAccountStore;
let ctx: AccountsContext;

async function start(opts: { accounts?: AccountsContext; ranker?: JournalRanker }): Promise<{ server: Server; base: string }> {
  const app = createApp({
    adapters: lookupAdapters,
    accounts: opts.accounts,
    journalRanker: opts.ranker,
    config: { corsOrigins: [], rateLimitPerMinute: 10_000, staticDir: undefined, adminPassword: ADMIN },
    logger: silentLogger,
  });
  const s = await new Promise<Server>((resolve) => {
    const l = app.listen(0, () => resolve(l));
  });
  return { server: s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
}

beforeAll(async () => {
  store = new MemoryAccountStore();
  ctx = createAccountsContext({
    store,
    sessionSecret: SECRET,
    freeDailySearches: 100,
    guestDailySearches: 100,
    timezone: 'Asia/Ho_Chi_Minh',
    rateLimits: { registerPerHour: 10_000, loginFailuresPer15Min: 10_000 },
    billing: { prices: { 'standard:week': 10_000, 'standard:month': 29_000, 'standard:year': 119_000, 'pro:week': 20_000, 'pro:month': 49_000, 'pro:year': 229_000 } },
  });
  ({ server, base } = await start({ accounts: ctx, ranker: JournalRanker.fromCsv(SJR_CSV) }));
  open = await start({ ranker: JournalRanker.fromCsv(SJR_CSV) });
});

afterAll(() => {
  for (const s of [server, open.server]) {
    s.closeAllConnections();
    s.close();
  }
});

async function call<T = unknown>(url: string, method: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
  const r = await fetch(url, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* văn bản thuần hoặc NDJSON */
  }
  return { status: r.status, body: parsed as T, setCookie: r.headers.get('set-cookie')?.split(';')[0], raw: text };
}

let n = 0;
async function user(tier: 'free' | 'standard' | 'pro') {
  const email = `feat${++n}@example.com`;
  const reg = await call(`${base}/api/auth/register`, 'POST', { email, password: 'password123' });
  if (tier !== 'free') await call(`${base}/api/admin/grant`, 'POST', { email, tier, days: 30 }, undefined, { authorization: `Bearer ${ADMIN}` });
  return reg.setCookie!;
}

const searchBody = { keywords: ['alpha beta'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true };
const lastResult = (raw: string): SearchResult => {
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l) as { type: string; result?: SearchResult });
  return lines.find((l) => l.type === 'result')!.result!;
};

describe('API: tra DOI', () => {
  it('khi tài khoản tắt: dùng được cho mọi người, trả kết quả cùng dạng tìm kiếm', async () => {
    const r = await call<{ result: SearchResult; notFound: string[]; failed: string[]; invalid: string[]; duplicates: number }>(`${open.base}/api/lookup`, 'POST', { text: `${DOIS.both}\nhttps://doi.org/${DOIS.both}\n${DOIS.missing}\nlinh tinh` });
    expect(r.status).toBe(200);
    expect(r.body.result.records.map((x) => x.doi)).toEqual([DOIS.both]);
    expect(r.body.result.records[0]).toMatchObject({ citedByCount: 25, journalQuartile: 'Q1' }); // xếp hạng cũng được gắn
    expect(r.body).toMatchObject({ notFound: [DOIS.missing], failed: [], invalid: ['linh tinh'], duplicates: 1 });
  });

  it('yêu cầu đăng nhập và hạng Tiêu chuẩn trở lên', async () => {
    const text = DOIS.both;
    expect((await call(`${base}/api/lookup`, 'POST', { text })).status).toBe(401);
    const free = await user('free');
    expect((await call(`${base}/api/lookup`, 'POST', { text }, free)).status).toBe(402);
    const std = await user('standard');
    expect((await call(`${base}/api/lookup`, 'POST', { text }, std)).status).toBe(200);
  });

  it('giới hạn số DOI theo hạng và báo lỗi rõ ràng khi nội dung không có DOI', async () => {
    const std = await user('standard');
    const many = Array.from({ length: 101 }, (_, i) => `10.1000/many${i}`).join('\n');
    const tooMany = await call<{ error: string; message: string }>(`${base}/api/lookup`, 'POST', { text: many }, std);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toMatchObject({ error: 'too_many' });
    expect(tooMany.body.message).toMatch(/100/);

    const none = await call<{ error: string }>(`${base}/api/lookup`, 'POST', { text: 'chẳng có gì cả' }, std);
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('no_doi');
    expect((await call(`${base}/api/lookup`, 'POST', { text: '' }, std)).status).toBe(400);

    const pro = await user('pro');
    expect((await call(`${base}/api/lookup`, 'POST', { text: many }, pro)).status).toBe(200); // Pro tra được tới 500
  });
});

describe('API: xếp hạng tạp chí trong kết quả tìm kiếm', () => {
  it('chỉ hạng Tiêu chuẩn trở lên được thấy Q1–Q4; khách và miễn phí thì không', async () => {
    const std = await user('standard');
    const free = await user('free');
    const asStd = lastResult((await call(`${base}/api/search`, 'POST', searchBody, std)).raw).records[0]!;
    expect(asStd).toMatchObject({ journalQuartile: 'Q1', journalSjr: 145.004 });
    const asFree = lastResult((await call(`${base}/api/search`, 'POST', searchBody, free)).raw).records[0]!;
    expect(asFree).not.toHaveProperty('journalQuartile');
    expect(asFree.issn).toEqual(['00079235']); // ISSN là dữ liệu thô, không phải tính năng bị khóa
    const asGuest = lastResult((await call(`${base}/api/search`, 'POST', searchBody)).raw).records[0]!;
    expect(asGuest).not.toHaveProperty('journalQuartile');
  });

  it('khi tài khoản tắt thì mọi người đều thấy', async () => {
    const rec = lastResult((await call(`${open.base}/api/search`, 'POST', searchBody)).raw).records[0]!;
    expect(rec.journalQuartile).toBe('Q1');
  });

  it('không có dữ liệu SCImago thì không gắn gì và /api/plans báo tính năng chưa có', async () => {
    const bare = await start({});
    try {
      const rec = lastResult((await call(`${bare.base}/api/search`, 'POST', searchBody)).raw).records[0]!;
      expect(rec).not.toHaveProperty('journalQuartile');
      expect((await call<PlansResponse>(`${bare.base}/api/plans`, 'GET')).body.journalRankAvailable).toBe(false);
    } finally {
      bare.server.closeAllConnections();
      bare.server.close();
    }
    expect((await call<PlansResponse>(`${base}/api/plans`, 'GET')).body.journalRankAvailable).toBe(true);
  });

  it('quyền lợi mới theo hạng được công bố trong /api/plans', async () => {
    const tiers = (await call<PlansResponse>(`${base}/api/plans`, 'GET')).body.tiers;
    const by = (t: string) => tiers.find((x) => x.tier === t)!;
    expect(by('guest')).toMatchObject({ wordExport: false, doiLookupMax: 0, citationTools: false, journalRank: false });
    expect(by('free')).toMatchObject({ wordExport: false, doiLookupMax: 0, citationTools: false, journalRank: false });
    expect(by('standard')).toMatchObject({ wordExport: true, doiLookupMax: 100, citationTools: true, journalRank: true });
    expect(by('pro')).toMatchObject({ wordExport: true, doiLookupMax: 500, citationTools: true, journalRank: true });
  });
});

describe('API: xuất Word', () => {
  const lines = ['[1] A. Smith, "Title," J. Test, 2020.', '[2] B. Tran, "Another," J. Test, 2021.'];

  it('khi tài khoản tắt: mọi người dùng được', async () => {
    const r = await fetch(`${open.base}/api/export/docx`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines }) });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/wordprocessingml/);
    expect(r.headers.get('content-disposition')).toMatch(/\.docx"/);
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 2).toString()).toBe('PK');
  });

  it('khách 401, miễn phí 402, Tiêu chuẩn và Pro 200', async () => {
    expect((await call(`${base}/api/export/docx`, 'POST', { lines })).status).toBe(401);
    expect((await call(`${base}/api/export/docx`, 'POST', { lines }, await user('free'))).status).toBe(402);
    for (const tier of ['standard', 'pro'] as const) {
      const r = await fetch(`${base}/api/export/docx`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: await user(tier) }, body: JSON.stringify({ lines }) });
      expect(r.status).toBe(200);
    }
  });

  it('từ chối nội dung không hợp lệ', async () => {
    const std = await user('standard');
    expect((await call(`${base}/api/export/docx`, 'POST', { lines: [] }, std)).status).toBe(400);
    expect((await call(`${base}/api/export/docx`, 'POST', { lines: [1, 2] }, std)).status).toBe(400);
    expect((await call(`${base}/api/export/docx`, 'POST', {}, std)).status).toBe(400);
  });
});

describe('API: xuất file mang dữ liệu mới', () => {
  it('Excel/CSV nhận citedByCount, isRetracted, journalQuartile từ giao diện', async () => {
    const rec = { title: 'T', doi: '10.1/t', authors: [{ name: 'A B' }], publicationYear: 2020, journal: 'J', publisher: '', documentType: '', abstract: '', sources: ['crossref'], originalUrl: '', queryKeywords: [], citedByCount: 7, isRetracted: true, journalQuartile: 'Q2' };
    const std = await user('standard');
    const csv = await call(`${base}/api/export`, 'POST', { format: 'csv', records: [rec] }, std);
    expect(csv.status).toBe(200);
    expect(csv.raw).toContain('"7","RETRACTED","Q2"');
    expect((await call(`${base}/api/export`, 'POST', { format: 'csv', records: [{ ...rec, journalQuartile: 'Q9' }] }, std)).status).toBe(400);
  });
});

// Kiểm tra kiểu: bản ghi có các trường mới khớp PaperRecord
const _typeCheck: Pick<PaperRecord, 'citedByCount' | 'isRetracted' | 'issn' | 'journalQuartile' | 'journalSjr'> = { citedByCount: 1, isRetracted: true, issn: ['12345678'], journalQuartile: 'Q1', journalSjr: 1.5 };
void _typeCheck;

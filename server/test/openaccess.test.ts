import { describe, expect, it } from 'vitest';
import { cleanLicense, formatLicense, looksLikePdf, openAccess } from '../src/lib/oa.js';
import { dedupeRecords, mergeRecords } from '../src/services/dedupe.js';
import { mapArxivEntry } from '../src/sources/arxiv.js';
import { mapDoajArticle } from '../src/sources/doaj.js';
import { mapEuropePmcResult } from '../src/sources/europepmc.js';
import { mapCrossrefItem } from '../src/sources/crossref.js';
import { mapOpenAlexWork } from '../src/sources/openalex.js';
import { mapSemanticScholarPaper } from '../src/sources/semanticscholar.js';
import { makeRecord } from './helpers.js';

describe('tiện ích truy cập mở', () => {
  it('cleanLicense bỏ giá trị vô nghĩa', () => {
    expect(cleanLicense(' CC-BY ')).toBe('cc-by');
    for (const v of [null, undefined, 5, '', 'unknown', 'other']) expect(cleanLicense(v)).toBe('');
  });

  it('formatLicense', () => {
    expect(formatLicense('cc-by')).toBe('CC BY');
    expect(formatLicense('cc-by-nc-nd')).toBe('CC BY-NC-ND');
    expect(formatLicense('cc by')).toBe('CC BY');
    expect(formatLicense('cc0')).toBe('CC0');
    expect(formatLicense('publisher-specific-oa')).toBe('publisher-specific-oa');
  });

  it('looksLikePdf', () => {
    for (const u of ['https://a.org/x.pdf', 'https://a.org/x.pdf?v=1', 'https://mdpi.com/2072/15/9/2450/pdf?version=1', 'https://wiley.com/doi/pdfdirect/10.1/x', 'https://europepmc.org/articles/PMC1?pdf=render']) {
      expect(looksLikePdf(u)).toBe(true);
    }
    for (const u of ['https://doi.org/10.1/x', 'https://a.org/article/123', 'https://a.org/pdfs-are-great']) expect(looksLikePdf(u)).toBe(false);
  });

  it('openAccess: chỉ giữ URL http(s) hợp lệ và chỉ khi là bản mở', () => {
    expect(openAccess({ isOpenAccess: true, oaPdfUrl: 'javascript:alert(1)', oaUrl: 'https://a.org/p', oaLicense: 'CC-BY' })).toEqual({
      isOpenAccess: true, oaStatus: '', oaUrl: 'https://a.org/p', oaPdfUrl: '', oaLicense: 'cc-by',
    });
    // không phải bản mở -> bỏ URL và giấy phép dù nguồn có gửi kèm
    expect(openAccess({ isOpenAccess: false, oaUrl: 'https://a.org/p', oaLicense: 'cc-by', oaStatus: 'CLOSED' })).toEqual({
      isOpenAccess: false, oaStatus: 'closed', oaUrl: '', oaPdfUrl: '', oaLicense: '',
    });
  });
});

describe('OpenAlex: dữ liệu truy cập mở', () => {
  const work = (extra: Record<string, unknown>) => ({ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.1/x', display_name: 'T', ...extra });

  it('bài gold: PDF, trang, giấy phép, trạng thái', () => {
    const r = mapOpenAlexWork(
      work({
        open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://nature.com/a.pdf' },
        best_oa_location: { is_oa: true, pdf_url: 'https://nature.com/a.pdf', landing_page_url: 'https://doi.org/10.1/x', license: 'cc-by' },
      }),
      'k',
      '',
    )!;
    expect(r).toMatchObject({ isOpenAccess: true, oaStatus: 'gold', oaPdfUrl: 'https://nature.com/a.pdf', oaUrl: 'https://doi.org/10.1/x', oaLicense: 'cc-by' });
  });

  it('bài mở nhưng không có PDF trực tiếp: chỉ có trang đọc', () => {
    const r = mapOpenAlexWork(
      work({ open_access: { is_oa: true, oa_status: 'hybrid', oa_url: 'http://dx.doi.org/10.36948/x' }, best_oa_location: { is_oa: true, pdf_url: null, landing_page_url: 'http://dx.doi.org/10.36948/x', license: 'cc-by-sa' } }),
      'k',
      '',
    )!;
    expect(r).toMatchObject({ isOpenAccess: true, oaPdfUrl: '', oaUrl: 'http://dx.doi.org/10.36948/x', oaLicense: 'cc-by-sa' });
  });

  it('oa_url trông như PDF thì dùng làm PDF khi thiếu best_oa_location', () => {
    const r = mapOpenAlexWork(work({ open_access: { is_oa: true, oa_status: 'green', oa_url: 'https://repo.edu/files/paper.pdf' }, best_oa_location: null }), 'k', '')!;
    expect(r.oaPdfUrl).toBe('https://repo.edu/files/paper.pdf');
  });

  it('bài đóng (closed) hoặc thiếu dữ liệu: không phải bản mở', () => {
    const closed = mapOpenAlexWork(work({ open_access: { is_oa: false, oa_status: 'closed', oa_url: null }, best_oa_location: null }), 'k', '')!;
    expect(closed).toMatchObject({ isOpenAccess: false, oaStatus: 'closed', oaUrl: '', oaPdfUrl: '', oaLicense: '' });
    expect(mapOpenAlexWork(work({}), 'k', '')).toMatchObject({ isOpenAccess: false, oaUrl: '' });
  });
});

describe('Europe PMC: dữ liệu truy cập mở', () => {
  const urls = (...u: [string, string, string, string][]) => ({ fullTextUrl: u.map(([availabilityCode, documentStyle, site, url]) => ({ availabilityCode, documentStyle, site, url })) });

  it('bài OA có PMC: PDF + trang + giấy phép', () => {
    const r = mapEuropePmcResult(
      { id: '1', source: 'MED', isOpenAccess: 'Y', license: 'cc by', fullTextUrlList: urls(['S', 'doi', 'DOI', 'https://doi.org/10.3/x'], ['OA', 'html', 'Europe_PMC', 'https://europepmc.org/articles/PMC1'], ['OA', 'pdf', 'Europe_PMC', 'https://europepmc.org/articles/PMC1?pdf=render']) },
      'k',
      '',
    )!;
    expect(r).toMatchObject({ isOpenAccess: true, oaPdfUrl: 'https://europepmc.org/articles/PMC1?pdf=render', oaUrl: 'https://europepmc.org/articles/PMC1', oaLicense: 'cc by' });
  });

  it('bài cần đăng ký (S): không phải bản mở, bỏ cả giấy phép ghi kèm', () => {
    const r = mapEuropePmcResult({ id: '2', source: 'AGR', isOpenAccess: 'N', license: 'cc by', fullTextUrlList: urls(['S', 'doi', 'DOI', 'https://doi.org/10.1007/x']) }, 'k', '')!;
    expect(r).toMatchObject({ isOpenAccess: false, oaUrl: '', oaPdfUrl: '', oaLicense: '' });
  });

  it('có link OA qua Unpaywall dù cờ isOpenAccess = N (preprint) -> là bản mở, dùng link DOI', () => {
    const r = mapEuropePmcResult({ id: 'PPR1', source: 'PPR', isOpenAccess: 'N', fullTextUrlList: urls(['OA', 'doi', 'Unpaywall', 'https://doi.org/10.21203/rs.3.rs-1/v1'], ['F', 'doi', 'DOI', 'https://doi.org/10.21203/rs.3.rs-1/v1']) }, 'k', '')!;
    expect(r).toMatchObject({ isOpenAccess: true, oaUrl: 'https://doi.org/10.21203/rs.3.rs-1/v1', oaPdfUrl: '' });
  });

  it('thiếu fullTextUrlList không gây lỗi', () => {
    expect(mapEuropePmcResult({ id: '3', source: 'MED' }, 'k', '')).toMatchObject({ isOpenAccess: false });
  });
});

describe('DOAJ, arXiv, Semantic Scholar: truy cập mở', () => {
  it('DOAJ: mọi bài là bản mở, link toàn văn là trang; nhận ra PDF khi có', () => {
    const html = mapDoajArticle({ id: 'a', bibjson: { title: 'T', link: [{ type: 'fulltext', content_type: 'html', url: 'https://j.org/art/1' }] } }, 'k', '')!;
    expect(html).toMatchObject({ isOpenAccess: true, oaUrl: 'https://j.org/art/1', oaPdfUrl: '' });
    const pdf = mapDoajArticle({ id: 'b', bibjson: { title: 'T', link: [{ type: 'fulltext', content_type: 'html', url: 'https://j.org/art/2' }, { type: 'fulltext', content_type: 'PDF', url: 'https://j.org/art/2/download' }] } }, 'k', '')!;
    expect(pdf.oaPdfUrl).toBe('https://j.org/art/2/download');
  });

  it('arXiv: PDF ở địa chỉ chuẩn của arXiv, bỏ hậu tố phiên bản', () => {
    const r = mapArxivEntry({ id: 'http://arxiv.org/abs/2507.09375v2', title: 'T' }, 'k', '')!;
    expect(r).toMatchObject({ isOpenAccess: true, oaPdfUrl: 'https://arxiv.org/pdf/2507.09375', oaUrl: 'https://arxiv.org/abs/2507.09375' });
  });

  it('Semantic Scholar: openAccessPdf', () => {
    const open = mapSemanticScholarPaper({ paperId: 'p', openAccessPdf: { url: 'https://x.org/p.pdf', status: 'GREEN', license: 'CCBY' } }, 'k', '')!;
    expect(open).toMatchObject({ isOpenAccess: true, oaPdfUrl: 'https://x.org/p.pdf', oaStatus: 'green', oaLicense: 'ccby' });
    const closed = mapSemanticScholarPaper({ paperId: 'q', isOpenAccess: false, openAccessPdf: null }, 'k', '')!;
    expect(closed).toMatchObject({ isOpenAccess: false, oaPdfUrl: '' });
  });

  it('Crossref không suy đoán truy cập mở', () => {
    expect(mapCrossrefItem({ DOI: '10.1/x', title: ['T'], license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }] }, 'k', '')).toMatchObject({ isOpenAccess: false, oaUrl: '' });
  });
});

describe('gộp thông tin truy cập mở giữa các nguồn', () => {
  const closedOA = makeRecord({ doi: '10.1/x', sources: ['openalex'], oaStatus: 'closed' });
  const openEpmc = makeRecord({ doi: '10.1/x', sources: ['europepmc'], isOpenAccess: true, oaStatus: 'gold', oaPdfUrl: 'https://europepmc.org/a?pdf=render', oaUrl: 'https://europepmc.org/a', oaLicense: 'cc by' });
  const crossref = makeRecord({ doi: '10.1/x', sources: ['crossref'], title: 'Crossref title' });

  it('một nguồn xác nhận mở thì cả bài là miễn phí, dù nguồn khác nói closed hoặc không biết', () => {
    for (const order of [[closedOA, openEpmc, crossref], [crossref, closedOA, openEpmc], [openEpmc, crossref, closedOA]]) {
      const merged = mergeRecords(order);
      expect(merged).toMatchObject({ isOpenAccess: true, oaPdfUrl: 'https://europepmc.org/a?pdf=render', oaUrl: 'https://europepmc.org/a', oaLicense: 'cc by', oaStatus: 'gold' });
    }
  });

  it('không nguồn nào xác nhận mở thì giữ trạng thái closed và không có URL', () => {
    const merged = mergeRecords([closedOA, crossref]);
    expect(merged).toMatchObject({ isOpenAccess: false, oaStatus: 'closed', oaUrl: '', oaPdfUrl: '', oaLicense: '' });
  });

  it('lấy PDF từ nguồn này và trang đọc từ nguồn khác khi mỗi nguồn chỉ có một nửa', () => {
    const pdfOnly = makeRecord({ doi: '10.1/y', isOpenAccess: true, oaPdfUrl: 'https://a.org/y.pdf' });
    const pageOnly = makeRecord({ doi: '10.1/y', isOpenAccess: true, oaUrl: 'https://a.org/y' });
    expect(dedupeRecords([pdfOnly, pageOnly]).records[0]).toMatchObject({ isOpenAccess: true, oaPdfUrl: 'https://a.org/y.pdf', oaUrl: 'https://a.org/y' });
  });
});

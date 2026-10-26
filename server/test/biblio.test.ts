import { describe, expect, it } from 'vitest';
import { biblio, cleanPages, formatEventDates, pagesFromRange } from '../src/lib/biblio.js';
import { mergeRecords } from '../src/services/dedupe.js';
import { mapCrossrefItem } from '../src/sources/crossref.js';
import { mapDoajArticle } from '../src/sources/doaj.js';
import { mapEuropePmcResult } from '../src/sources/europepmc.js';
import { mapOpenAlexWork } from '../src/sources/openalex.js';
import { mapSemanticScholarPaper } from '../src/sources/semanticscholar.js';
import { makeRecord } from './helpers.js';

describe('cleanPages / pagesFromRange', () => {
  it.each([
    ['313-325', '313-325'],
    ['313 – 325', '313-325'],
    ['313—325', '313-325'],
    ['e1234', 'e1234'],
    ['S45-S52', 'S45-S52'],
    ['623', '623'],
  ])('chuẩn hóa %s -> %s', (input, expected) => expect(cleanPages(input)).toBe(expected));

  it.each(['S1360-1385(26)00280-3', 'abc', '', 'x'.repeat(50), null, undefined, '12 pages'])('bỏ giá trị không phải số trang: %s', (input) => {
    expect(cleanPages(input)).toBe('');
  });

  it('pagesFromRange: trang đầu - cuối, trùng thì chỉ một trang, thiếu thì lấy cái có', () => {
    expect(pagesFromRange('1237', '1239')).toBe('1237-1239');
    expect(pagesFromRange('108', '108')).toBe('108');
    expect(pagesFromRange('9', null)).toBe('9');
    expect(pagesFromRange(null, null)).toBe('');
  });

  it('biblio: ép kiểu số, giới hạn độ dài, không suy đoán', () => {
    expect(biblio({ volume: 7, issue: ' 2 ', firstPage: '313', lastPage: '325', place: ' Boca Raton ' })).toEqual({ volume: '7', issue: '2', pages: '313-325', place: 'Boca Raton' });
    expect(biblio({})).toEqual({ volume: '', issue: '', pages: '', place: '' });
    expect(biblio({ volume: 'x'.repeat(40) }).volume).toBe('');
  });
});

describe('formatEventDates', () => {
  const d = (y: number, m?: number, day?: number) => ({ 'date-parts': [[y, m, day].filter((x) => x !== undefined)] });
  it.each([
    [d(1998, 10, 16), d(1998, 10, 20), 'Oct. 16-20, 1998'],
    [d(2024, 9, 27), d(2024, 9, 29), 'Sep. 27-29, 2024'],
    [d(1998, 10, 30), d(1998, 11, 2), 'Oct. 30 - Nov. 2, 1998'],
    [d(1998, 12, 30), d(1999, 1, 2), 'Dec. 30, 1998 - Jan. 2, 1999'],
    [d(1998, 5, 3), d(1998, 5, 3), 'May 3, 1998'],
    [d(1998, 5, 3), undefined, 'May 3, 1998'],
    [d(1998, 5), undefined, 'May 1998'],
    [d(1998), undefined, '1998'],
    [undefined, undefined, ''],
  ])('%j -> %s', (start, end, expected) => expect(formatEventDates(start, end)).toBe(expected));
});

describe('thông tin thư mục theo từng nguồn', () => {
  it('Crossref: bài tạp chí có tập/số/trang', () => {
    const r = mapCrossrefItem({ DOI: '10.1/x', title: ['T'], volume: '25', issue: '2', page: '1139-1143' }, 'k', '')!;
    expect(r).toMatchObject({ volume: '25', issue: '2', pages: '1139-1143', place: '' });
  });

  it('Crossref: hội nghị lấy nơi và thời gian tổ chức', () => {
    const r = mapCrossrefItem(
      { DOI: '10.1/y', title: ['T'], type: 'proceedings-article', page: '197-202', event: { name: 'ICMLA', location: 'Boca Raton, FL, USA', start: { 'date-parts': [[2012, 12, 12]] }, end: { 'date-parts': [[2012, 12, 15]] } } },
      'k',
      '',
    )!;
    expect(r).toMatchObject({ pages: '197-202', place: 'Boca Raton, FL, USA, Dec. 12-15, 2012' });
  });

  it('Crossref: sách lấy nơi xuất bản; thiếu thì để trống', () => {
    expect(mapCrossrefItem({ DOI: '10.1/z', title: ['T'], type: 'book', 'publisher-location': 'Cham' }, 'k', '')).toMatchObject({ place: 'Cham' });
    expect(mapCrossrefItem({ DOI: '10.1/z', title: ['T'], type: 'book' }, 'k', '')).toMatchObject({ place: '', volume: '', pages: '' });
  });

  it('OpenAlex: biblio', () => {
    const r = mapOpenAlexWork({ id: 'https://openalex.org/W1', biblio: { volume: '364', issue: '6447', first_page: '1237', last_page: '1239' } }, 'k', '')!;
    expect(r).toMatchObject({ volume: '364', issue: '6447', pages: '1237-1239' });
    expect(mapOpenAlexWork({ id: 'https://openalex.org/W2', biblio: { volume: null, issue: '1', first_page: null, last_page: null } }, 'k', '')).toMatchObject({ volume: '', issue: '1', pages: '' });
    expect(mapOpenAlexWork({ id: 'https://openalex.org/W3' }, 'k', '')).toMatchObject({ volume: '', pages: '' });
  });

  it('Europe PMC: tập/số/trang, bỏ mã bài không phải số trang', () => {
    expect(mapEuropePmcResult({ id: '1', source: 'MED', journalInfo: { volume: '42', issue: '11' }, pageInfo: '623' }, 'k', '')).toMatchObject({ volume: '42', issue: '11', pages: '623' });
    expect(mapEuropePmcResult({ id: '2', source: 'MED', pageInfo: 'S1360-1385(26)00280-3' }, 'k', '')).toMatchObject({ pages: '' });
  });

  it('DOAJ: trang đầu-cuối, tập, số', () => {
    const r = mapDoajArticle({ id: 'a', bibjson: { title: 'T', start_page: '9', end_page: '22', journal: { volume: '16', number: '1' } } }, 'k', '')!;
    expect(r).toMatchObject({ volume: '16', issue: '1', pages: '9-22' });
  });

  it('Semantic Scholar: journal.volume và journal.pages', () => {
    const r = mapSemanticScholarPaper({ paperId: 'p', journal: { name: 'J', volume: '12', pages: '100 - 110' } }, 'k', '')!;
    expect(r).toMatchObject({ volume: '12', pages: '100-110' });
  });

  it('gộp: điền tập/số/trang/nơi còn trống từ nguồn khác, không ghi đè', () => {
    const a = makeRecord({ doi: '10.1/x', volume: '7', pages: '' });
    const b = makeRecord({ doi: '10.1/x', volume: '9', issue: '2', pages: '313-325', place: 'London' });
    expect(mergeRecords([a, b])).toMatchObject({ volume: expect.stringMatching(/^(7|9)$/), issue: '2', pages: '313-325', place: 'London' });
    expect(mergeRecords([makeRecord({ doi: '10.1/x', volume: '7' }), makeRecord({ doi: '10.1/x', volume: '' })]).volume).toBe('7');
  });
});

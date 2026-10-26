import { describe, expect, it } from 'vitest';
import type { Author, PaperRecord } from '../../../shared/types';
import { formatReference, formatReferenceList } from './citation';
import { parseCustomConfig } from './citationStyle';
import {
  CUSTOM_FIELDS,
  CUSTOM_PRESETS,
  DEFAULT_CUSTOM,
  formatCustomAuthors,
  formatCustomList,
  formatCustomReference,
  joinNames,
  unknownPlaceholders,
  type CustomCitationConfig,
} from './customCitation';

function rec(overrides: Partial<PaperRecord>): PaperRecord {
  return {
    id: 'x', title: 'Title of article', doi: '', authors: [], publicationYear: null, journal: '', publisher: '', documentType: '', isPreprint: false, abstract: '',
    isOpenAccess: false, oaStatus: '', oaUrl: '', oaPdfUrl: '', oaLicense: '', sources: ['crossref'], sourceRefs: [], originalUrl: '', queryKeywords: [], retrievedAt: '2026-10-26T01:02:03.000Z',
    ...overrides,
  };
}
const A = (name: string, given?: string, family?: string): Author => ({ name, ...(given ? { given } : {}), ...(family ? { family } : {}) });
const cfg = (template: string, extra: Partial<CustomCitationConfig> = {}): CustomCitationConfig => ({ ...DEFAULT_CUSTOM, template, ...extra });

const FULL = rec({
  title: 'Superconvergence of a finite element method',
  authors: [A('Santosh Kumar', 'Santosh', 'Kumar'), A('Bao Singh', 'Bao', 'Singh')],
  journal: 'IMA Journal of Numerical Analysis',
  volume: '7', issue: '2', pages: '313-325', publicationYear: 1987, doi: '10.1000/xyz', publisher: 'Oxford', place: 'London', documentType: 'journal-article',
  originalUrl: 'https://example.org/paper',
});

describe('trường và thay thế', () => {
  it('thay các trường bằng dữ liệu của bài', () => {
    expect(formatCustomReference(FULL, cfg('{title} | {journal} | {volume} | {issue} | {year}'))).toBe('Superconvergence of a finite element method | IMA Journal of Numerical Analysis | 7 | 2 | 1987');
  });

  it('các trường dẫn xuất: volume_issue, pages, pages_en, first/last_page, doi_url, url, retrieved, type, publisher, place', () => {
    const t = '{volume_issue}|{pages}|{pages_en}|{first_page}|{last_page}|{doi}|{doi_url}|{url}|{retrieved}|{type}|{publisher}|{place}';
    expect(formatCustomReference(FULL, cfg(t))).toBe('7(2)|313-325|313–325|313|325|10.1000/xyz|https://doi.org/10.1000/xyz|https://example.org/paper|2026-10-26|journal-article|Oxford|London');
  });

  it('volume_issue khi thiếu tập hoặc số; trang đơn lẻ', () => {
    expect(formatCustomReference(rec({ volume: '7' }), cfg('{volume_issue}'))).toBe('7');
    expect(formatCustomReference(rec({ issue: '4' }), cfg('{volume_issue}'))).toBe('(4)');
    expect(formatCustomReference(rec({ pages: '108' }), cfg('{pages_en}|{first_page}|{last_page}'))).toBe('108|108|');
  });

  it('tiêu đề được bỏ dấu chấm cuối để mẫu tự thêm dấu câu', () => {
    expect(formatCustomReference(rec({ title: 'Một bài. ' }), cfg('{title}.'))).toBe('Một bài.');
  });

  it('chỉ nhận URL http(s) cho {url}', () => {
    expect(formatCustomReference(rec({ originalUrl: 'javascript:alert(1)' }), cfg('[{url}]'))).toBe('');
  });

  it('trường không nhận ra được giữ nguyên và báo lại', () => {
    expect(formatCustomReference(FULL, cfg('{title} {foo}'))).toBe('Superconvergence of a finite element method {foo}');
    expect(unknownPlaceholders('{title} {foo} {Authors} {year}')).toEqual(['foo', 'Authors']);
    expect(unknownPlaceholders(`{${CUSTOM_FIELDS.map((f) => f.key).join('} {')}}`)).toEqual([]);
  });
});

describe('nhóm tùy chọn [[ ]]: bỏ cả nhóm khi thiếu dữ liệu, không bịa', () => {
  const t = '{authors}. {title}. {journal}[[, tập {volume}]][[, số {issue}]][[, {year}]][[, tr. {pages}]].';

  it('đủ dữ liệu: giữ tất cả các nhóm', () => {
    expect(formatCustomReference(FULL, cfg(t))).toBe('Kumar S, Singh B. Superconvergence of a finite element method. IMA Journal of Numerical Analysis, tập 7, số 2, 1987, tr. 313-325.');
  });

  it('thiếu tập/số/trang: nhóm tương ứng biến mất, dấu câu vẫn gọn', () => {
    const r = rec({ title: 'T', authors: [A('A B', 'A', 'B')], journal: 'J', publicationYear: 2020 });
    expect(formatCustomReference(r, cfg(t))).toBe('B A. T. J, 2020.');
  });

  it('một nhóm chứa nhiều trường: thiếu bất kỳ trường nào thì bỏ cả nhóm', () => {
    const g = '{title}[[ (tập {volume}, số {issue})]]';
    expect(formatCustomReference(rec({ title: 'T', volume: '1', issue: '2' }), cfg(g))).toBe('T (tập 1, số 2)');
    expect(formatCustomReference(rec({ title: 'T', volume: '1' }), cfg(g))).toBe('T');
  });

  it('ngoặc vuông đơn là ký tự thường; {index} rỗng khi chỉ có một bài', () => {
    expect(formatCustomReference(FULL, cfg('[{year}] {title}'))).toBe('[1987] Superconvergence of a finite element method');
    expect(formatCustomReference(FULL, cfg('[[[{index}] ]]{title}'))).toBe('Superconvergence of a finite element method');
    expect(formatCustomReference(FULL, cfg('[[[{index}] ]]{title}'), 3)).toBe('[3] Superconvergence of a finite element method');
  });

  it('trường rỗng nằm NGOÀI nhóm: dọn dấu câu thừa, ngoặc rỗng', () => {
    expect(formatCustomReference(rec({ title: 'T', journal: 'J' }), cfg('{authors}, {title}, {journal}, {year}.'))).toBe('T, J.');
    expect(formatCustomReference(rec({ title: 'T' }), cfg('{title} ({year}) “{journal}”.'))).toBe('T.');
    expect(formatCustomReference(rec({ title: 'T', journal: 'J' }), cfg('{title}, {volume}, {journal}'))).toBe('T, J');
  });

  it('không tạo dấu chấm kép khi tác giả kết thúc bằng dấu chấm', () => {
    const r = rec({ title: 'T', authors: [A('A B', 'A', 'B')] });
    expect(formatCustomReference(r, cfg('{authors}. {title}', { authorFormat: 'family_comma_initials' }))).toBe('B, A. T');
    expect(formatCustomReference(r, cfg('{authors}.', { authorFormat: 'family_comma_initials' }))).toBe('B, A.');
  });

  it('chuỗi "..." (ba chấm) được giữ nguyên', () => {
    expect(formatCustomReference(rec({ title: 'T' }), cfg('{title} ...'))).toBe('T...');
  });
});

describe('tác giả: kiểu ghi, cách nối, giới hạn', () => {
  const people = [A('Santosh Kumar', 'Santosh', 'Kumar'), A('Bao Singh', 'Bao', 'Singh'), A('Anh Văn Nguyễn', 'Anh Văn', 'Nguyễn'), A('Jean-Pierre Dupont', 'Jean-Pierre', 'Dupont')];
  const fmt = (n: number, extra: Partial<CustomCitationConfig>) => formatCustomAuthors(people.slice(0, n), '', { ...DEFAULT_CUSTOM, ...extra });

  it.each([
    ['family_initials', 'Kumar S, Singh B, Nguyễn AV'],
    ['initials_family', 'S. Kumar, B. Singh, A. V. Nguyễn'],
    ['family_comma_initials', 'Kumar, S., Singh, B., Nguyễn, A. V.'],
    ['source', 'Santosh Kumar, Bao Singh, Anh Văn Nguyễn'],
  ] as const)('kiểu ghi %s', (authorFormat, expected) => expect(fmt(3, { authorFormat })).toBe(expected));

  it('gạch nối trong tên: J.-P.', () => {
    expect(fmt(4, { authorFormat: 'family_comma_initials', maxAuthors: 4 }).endsWith('Dupont, J.-P.')).toBe(true);
  });

  it('cách nối: dấu phẩy, "and", "&", chấm phẩy (1, 2, 3 tác giả)', () => {
    const n = ['A', 'B', 'C'];
    expect(joinNames(n, 'comma')).toBe('A, B, C');
    expect(joinNames(n, 'comma_and')).toBe('A, B, and C');
    expect(joinNames(n.slice(0, 2), 'comma_and')).toBe('A and B');
    expect(joinNames(n, 'comma_amp')).toBe('A, B, & C');
    expect(joinNames(n.slice(0, 2), 'comma_amp')).toBe('A, & B');
    expect(joinNames(n, 'semicolon')).toBe('A; B; C');
    expect(joinNames(['A'], 'comma_and')).toBe('A');
    expect(joinNames([], 'comma')).toBe('');
  });

  it('quá số tác giả tối đa thì ghi N người đầu rồi "et al."', () => {
    expect(fmt(4, { maxAuthors: 2 })).toBe('Kumar S, Singh B, et al.');
    expect(fmt(4, { maxAuthors: 2, authorJoin: 'comma_and' })).toBe('Kumar S, Singh B, et al.');
    expect(fmt(4, { maxAuthors: 1 })).toBe('Kumar S, et al.');
    expect(fmt(4, { maxAuthors: 2, authorJoin: 'semicolon' })).toBe('Kumar S; Singh B; et al.');
    expect(fmt(2, { maxAuthors: 2 })).toBe('Kumar S, Singh B');
  });

  it('{first_author} theo kiểu ghi đã chọn; bỏ "tác giả" trùng tên bài; thiếu tác giả thì rỗng', () => {
    expect(formatCustomReference(FULL, cfg('{first_author}', { authorFormat: 'initials_family' }))).toBe('S. Kumar');
    const bad = rec({ title: 'Same Title', authors: [A('Same Title', undefined, 'Same Title')] });
    expect(formatCustomReference(bad, cfg('{authors}, {title}'))).toBe('Same Title');
    expect(formatCustomReference(rec({ title: 'T' }), cfg('{authors}, {first_author}, {title}'))).toBe('T');
  });
});

describe('danh sách và thứ tự', () => {
  const a = rec({ title: 'A paper', authors: [A('Zed Zulu', 'Zed', 'Zulu')], publicationYear: 2020 });
  const b = rec({ title: 'B paper', authors: [A('Amy Alpha', 'Amy', 'Alpha')], publicationYear: 2022 });
  const c = rec({ title: 'C paper', authors: [A('Amy Alpha', 'Amy', 'Alpha')], publicationYear: 2019 });
  const noAuthor = rec({ title: 'D paper' });
  const withIndex = '[[[{index}] ]]{authors}, {title}[[, {year}]]';

  it('giữ thứ tự bảng và đánh số theo {index}', () => {
    expect(formatCustomList([a, b], cfg(withIndex, { order: 'table' }))).toBe('[1] Zulu Z, A paper, 2020\n[2] Alpha A, B paper, 2022');
  });

  it('sắp xếp theo tác giả A–Z rồi theo năm; bài không có tác giả xếp cuối; đánh số sau khi sắp xếp', () => {
    expect(formatCustomList([noAuthor, a, b, c], cfg(withIndex, { order: 'author' }))).toBe('[1] Alpha A, C paper, 2019\n[2] Alpha A, B paper, 2022\n[3] Zulu Z, A paper, 2020\n[4] D paper');
  });

  it('một bài thì không đánh số; danh sách rỗng thì rỗng', () => {
    expect(formatCustomList([a], cfg(withIndex))).toBe('Zulu Z, A paper, 2020');
    expect(formatCustomList([], cfg(withIndex))).toBe('');
  });

  it('qua API chung formatReference/formatReferenceList với style "custom"', () => {
    const custom = cfg('{authors}: {title}');
    expect(formatReference(a, { style: 'custom', custom })).toBe('Zulu Z: A paper');
    expect(formatReferenceList([a, b], { style: 'custom', custom })).toBe('Zulu Z: A paper\nAlpha A: B paper');
  });
});

describe('các mẫu có sẵn', () => {
  const article = rec({
    title: 'Title of article', authors: [A('Anh Anh Author', 'Anh Anh', 'Author')], journal: 'Journal Name', volume: '7', issue: '2', pages: '313-325', publicationYear: 2020, doi: '10.1000/xyz', documentType: 'journal-article',
  });
  const preset = (id: string) => CUSTOM_PRESETS.find((p) => p.id === id)!.config;

  it('mọi mẫu có sẵn chỉ dùng trường hợp lệ', () => {
    for (const p of CUSTOM_PRESETS) expect(unknownPlaceholders(p.config.template)).toEqual([]);
  });

  it('"Giống IEEE" cho kết quả trùng kiểu IEEE với bài tạp chí đủ dữ liệu', () => {
    expect(formatCustomReference(article, preset('ieee'))).toBe(formatReference(article, { style: 'ieee' }));
  });

  it('"Giống APA 7" cho kết quả trùng kiểu APA với bài tạp chí đủ dữ liệu', () => {
    expect(formatCustomReference(article, preset('apa'))).toBe(formatReference(article, { style: 'apa' }));
  });

  it('"Đơn giản" cho kết quả trùng Mẫu cơ bản (khác ở dấu gạch trong khoảng trang)', () => {
    expect(formatCustomReference(article, preset('basic'))).toBe('Author AA, Title of article, Journal Name (7), no. 2, 2020, pp. 313-325.');
    expect(formatReference(article, { style: 'basic' })).toBe('Author AA, Title of article, Journal Name (7), no. 2, 2020, pp. 313 - 325.');
  });

  it('các mẫu có sẵn không để lại dấu câu thừa khi bài thiếu nhiều dữ liệu', () => {
    const sparse = rec({ title: 'Only title' });
    for (const p of CUSTOM_PRESETS) {
      const text = formatCustomReference(sparse, p.config);
      expect(text).toContain('Only title');
      expect(text).not.toMatch(/,\s*[,.]|\(\s*\)|\{|\}|\.\./);
    }
  });
});

describe('đọc cấu hình đã lưu (localStorage)', () => {
  it('giá trị hợp lệ được giữ nguyên', () => {
    const saved = { template: '{title}', authorFormat: 'initials_family', authorJoin: 'comma_amp', maxAuthors: 4, order: 'author' };
    expect(parseCustomConfig(JSON.stringify(saved))).toEqual(saved);
  });

  it('thiếu, hỏng hoặc sai kiểu thì dùng mặc định cho phần sai, không ném lỗi', () => {
    expect(parseCustomConfig(null)).toEqual(DEFAULT_CUSTOM);
    expect(parseCustomConfig('{không phải json')).toEqual(DEFAULT_CUSTOM);
    expect(parseCustomConfig('{"template":"  ","authorFormat":"lạ","authorJoin":5,"maxAuthors":"x","order":null}')).toEqual(DEFAULT_CUSTOM);
    expect(parseCustomConfig('{"template":"{title}","maxAuthors":999}').maxAuthors).toBe(50);
    expect(parseCustomConfig('{"template":"{title}","maxAuthors":-3}').maxAuthors).toBe(1);
    expect(parseCustomConfig(JSON.stringify({ template: 'x'.repeat(5000) })).template.length).toBe(2000);
  });
});

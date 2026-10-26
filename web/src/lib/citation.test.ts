import { describe, expect, it } from 'vitest';
import type { Author, PaperRecord } from '../../../shared/types';
import { formatAuthor, formatAuthors, formatReference, formatReferenceList, referenceKind } from './citation';

function rec(overrides: Partial<PaperRecord>): PaperRecord {
  return {
    id: 'x', title: 'Tiêu đề', doi: '', authors: [], publicationYear: null, journal: '', publisher: '', documentType: '', isPreprint: false, abstract: '',
    isOpenAccess: false, oaStatus: '', oaUrl: '', oaPdfUrl: '', oaLicense: '', sources: ['crossref'], sourceRefs: [], originalUrl: '', queryKeywords: [], retrievedAt: '',
    ...overrides,
  };
}
const A = (name: string, given?: string, family?: string): Author => ({ name, ...(given ? { given } : {}), ...(family ? { family } : {}) });

describe('formatAuthor', () => {
  it.each<[Author, string]>([
    [A('Kumar Santosh', 'Santosh', 'Kumar'), 'Kumar S'],
    [A('Anh Văn Nguyễn', 'Anh Văn', 'Nguyễn'), 'Nguyễn AV'],
    [A('Jean-Pierre Dupont', 'Jean-Pierre', 'Dupont'), 'Dupont JP'],
    [A('Danton S. Char'), 'Char DS'],
    [A('Michael D. Abràmoff'), 'Abràmoff MD'],
    [A('Kumar, S.'), 'Kumar S'],
    [A('Madonna'), 'Madonna'],
    [A('WHO Consortium'), 'WHO Consortium'],
    [A('Stanford University School of Medicine'), 'Stanford University School of Medicine'],
    [A('', undefined, 'Solo'), 'Solo'],
  ])('%j -> %s', (author, expected) => expect(formatAuthor(author)).toBe(expected));

  it('tên Việt theo thứ tự họ trước (khi nguồn không tách họ/tên)', () => {
    expect(formatAuthor(A('Nguyễn Văn An'))).toBe('Nguyễn VA');
    expect(formatAuthor(A('Tran Thi Binh'))).toBe('Tran TB');
    expect(formatAuthor(A('Phạm Minh'))).toBe('Phạm M');
    expect(formatAuthor(A('Lê Thị Hoa'))).toBe('Lê TH');
    expect(formatAuthor(A('Le Wang'))).toBe('Wang L'); // "Le" hai phần: coi là tên phương Tây
  });

  it('dữ liệu lỗi: cả họ tên bị ghi vào trường "họ" -> vẫn rút gọn đúng', () => {
    expect(formatAuthor({ name: 'Minh Thuan Bui', family: 'Minh Thuan Bui' })).toBe('Bui MT');
    expect(formatAuthor({ name: 'Nguyễn Văn An', family: 'Nguyễn Văn An' })).toBe('Nguyễn VA');
    expect(formatAuthor({ name: 'WHO Consortium', family: 'WHO Consortium' })).toBe('WHO Consortium');
    expect(formatAuthor({ name: 'Kumar', family: 'Kumar' })).toBe('Kumar');
  });

  it('dữ liệu lỗi: "tác giả" trùng với tên bài thì bị bỏ', () => {
    const r = rec({ title: 'Machine learning algorithms for healthcare', authors: [A('Machine learning algorithms for healthcare', undefined, 'Machine learning algorithms for healthcare')], journal: 'J', publicationYear: 2025 });
    expect(formatReference(r)).toBe('Machine learning algorithms for healthcare, J, 2025.');
    // tác giả thật vẫn được giữ
    const ok = rec({ title: 'Một tiêu đề', authors: [A('Real Person', 'Real', 'Person'), A('Other Name', 'Other', 'Name')], journal: 'J' });
    expect(formatReference(ok)).toBe('Person R, Name O, Một tiêu đề, J.');
  });

  it('quá 6 tác giả -> 6 người đầu + et al.', () => {
    const seven = Array.from({ length: 7 }, (_, i) => A(`Ho Ten${i}`, `Ten${i}`, `Ho${i}`));
    expect(formatAuthors(seven)).toBe('Ho0 T, Ho1 T, Ho2 T, Ho3 T, Ho4 T, Ho5 T, et al.');
    expect(formatAuthors(seven.slice(0, 6)).endsWith('et al.')).toBe(false);
    expect(formatAuthors([])).toBe('');
  });
});

describe('referenceKind', () => {
  it.each([
    ['journal-article', 'journal'], ['article', 'journal'], ['Journal Article', 'journal'], ['preprint', 'journal'], ['', 'journal'], ['review', 'journal'],
    ['proceedings-article', 'conference'], ['conference-paper', 'conference'], ['Conference', 'conference'],
    ['book', 'book'], ['monograph', 'book'], ['edited-book', 'book'],
    ['book-chapter', 'chapter'],
  ])('%s -> %s', (type, kind) => expect(referenceKind({ documentType: type })).toBe(kind));
});

describe('formatReference - bài tạp chí (theo ví dụ của quy ước)', () => {
  it('tác giả, tên bài, tạp chí (tập), năm, pp. trang', () => {
    const r = rec({ title: 'Superconvergence of a finite element method', authors: [A('Kumar S', 'S', 'Kumar')], journal: 'IMA Journal of Numerical Analysis', volume: '7', publicationYear: 1987, pages: '313-325', documentType: 'journal-article' });
    expect(formatReference(r)).toBe('Kumar S, Superconvergence of a finite element method, IMA Journal of Numerical Analysis (7), 1987, pp. 313 - 325.');
  });

  it('có số (issue) thì thêm "no."', () => {
    const r = rec({ authors: [A('X Y', 'X', 'Y')], journal: 'Nature', volume: '364', issue: '6447', publicationYear: 2019, pages: '1237-1239' });
    expect(formatReference(r)).toBe('Y X, Tiêu đề, Nature (364), no. 6447, 2019, pp. 1237 - 1239.');
  });

  it('một trang -> "p."; thiếu tập/số/trang/năm thì bỏ qua, không bịa', () => {
    expect(formatReference(rec({ authors: [A('A B', 'A', 'B')], journal: 'J', pages: '108', publicationYear: 2020 }))).toBe('B A, Tiêu đề, J, 2020, p. 108.');
    expect(formatReference(rec({ authors: [A('A B', 'A', 'B')], journal: 'J' }))).toBe('B A, Tiêu đề, J.');
    expect(formatReference(rec({}))).toBe('Tiêu đề.');
  });

  it('thiếu tạp chí nhưng có tập vẫn không để lại dấu thừa; tiêu đề kết thúc bằng dấu chấm được gọn lại', () => {
    expect(formatReference(rec({ title: 'Một bài báo. ', volume: '3', publicationYear: 2001 }))).toBe('Một bài báo, (3), 2001.');
  });

  it('nhiều tác giả; preprint dùng cùng dạng; tiếng Việt giữ nguyên', () => {
    const r = rec({ title: 'Ứng dụng trí tuệ nhân tạo trong giáo dục', authors: [A('Anh Nguyễn', 'Anh', 'Nguyễn'), A('Bình Trần', 'Bình', 'Trần')], journal: 'Tạp chí Giáo dục', volume: '12', publicationYear: 2025 });
    expect(formatReference(r)).toBe('Nguyễn A, Trần B, Ứng dụng trí tuệ nhân tạo trong giáo dục, Tạp chí Giáo dục (12), 2025.');
    expect(formatReference(rec({ authors: [A('Jane Roe', 'Jane', 'Roe')], journal: 'arXiv', documentType: 'preprint', publicationYear: 2025 }))).toBe('Roe J, Tiêu đề, arXiv, 2025.');
  });
});

describe('formatReference - hội nghị và sách', () => {
  it('hội nghị: tác giả, tên bài, tên hội nghị, nơi và thời gian', () => {
    const r = rec({
      title: 'Fuzzy sets and fuzzy relational structures as Chu spaces', authors: [A('B.K. Paradopop', 'B.K.', 'Paradopop')], documentType: 'proceedings-article',
      journal: 'Proceedings of the First International Workshop', place: 'Thessaloniki, Greece, Oct. 16-20, 1998', publicationYear: 1998,
    });
    expect(formatReference(r)).toBe('Paradopop BK, Fuzzy sets and fuzzy relational structures as Chu spaces, Proceedings of the First International Workshop, Thessaloniki, Greece, Oct. 16-20, 1998.');
  });

  it('hội nghị: nơi chưa có năm thì thêm năm xuất bản; thiếu nơi thì chỉ có tên hội nghị', () => {
    expect(formatReference(rec({ documentType: 'proceedings-article', journal: 'ICMLA', place: 'Boca Raton, FL, USA', publicationYear: 2012 }))).toBe('Tiêu đề, ICMLA, Boca Raton, FL, USA, 2012.');
    expect(formatReference(rec({ documentType: 'proceedings-article', journal: 'ICMLA' }))).toBe('Tiêu đề, ICMLA.');
  });

  it('sách: tác giả, tên sách, nhà xuất bản, nơi xuất bản, năm', () => {
    const r = rec({ title: 'Solutions of Ill-Posed Problems', authors: [A('A.N. Tikhonov', 'A.N.', 'Tikhonov')], documentType: 'book', publisher: 'Wiley', place: 'New York', publicationYear: 1997 });
    expect(formatReference(r)).toBe('Tikhonov AN, Solutions of Ill-Posed Problems, Wiley, New York, 1997.');
  });

  it('chương sách: có "in <tên sách>"', () => {
    const r = rec({ title: 'Machine Learning in Healthcare', authors: [A('S K', 'S', 'K')], documentType: 'book-chapter', journal: 'Healthcare Solutions', publisher: 'CRC Press', place: 'Boca Raton', publicationYear: 2022, pages: '1-20' });
    expect(formatReference(r)).toBe('K S, Machine Learning in Healthcare, in Healthcare Solutions, CRC Press, Boca Raton, 2022, pp. 1 - 20.');
  });
});

describe('tuỳ chọn và danh sách', () => {
  it('kèm DOI khi được yêu cầu', () => {
    const r = rec({ authors: [A('A B', 'A', 'B')], journal: 'J', publicationYear: 2020, doi: '10.1/x' });
    expect(formatReference(r)).toBe('B A, Tiêu đề, J, 2020.');
    expect(formatReference(r, { includeDoi: true })).toBe('B A, Tiêu đề, J, 2020, DOI: 10.1/x.');
    expect(formatReference(rec({ journal: 'J' }), { includeDoi: true })).toBe('Tiêu đề, J.');
  });

  it('danh sách: một bài không đánh số, nhiều bài đánh số [1], [2]', () => {
    const a = rec({ title: 'Một', journal: 'J1' });
    const b = rec({ title: 'Hai', journal: 'J2' });
    expect(formatReferenceList([a])).toBe('Một, J1.');
    expect(formatReferenceList([a, b])).toBe('[1] Một, J1.\n[2] Hai, J2.');
    expect(formatReferenceList([])).toBe('');
  });
});

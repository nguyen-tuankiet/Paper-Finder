import { describe, expect, it } from 'vitest';
import type { Author, PaperRecord } from '../../../shared/types';
import { formatApaInText, formatAuthor, formatAuthors, formatReference as formatWith, formatReferenceList as formatListWith, referenceKind, type ReferenceOptions } from './citation';

// Các test cũ kiểm tra "mẫu cơ bản" (quy ước ban đầu); IEEE/APA được kiểm tra ở các khối mới bên dưới.
const formatReference = (r: PaperRecord, o: ReferenceOptions = {}) => formatWith(r, { style: 'basic', ...o });
const formatReferenceList = (rs: PaperRecord[], o: ReferenceOptions = {}) => formatListWith(rs, { style: 'basic', ...o });
const ieee = (r: PaperRecord, o: ReferenceOptions = {}) => formatWith(r, { style: 'ieee', ...o });
const apa = (r: PaperRecord, o: ReferenceOptions = {}) => formatWith(r, { style: 'apa', ...o });

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

// ====================================================================================
// Đối chiếu với mẫu IEEE do người dùng cung cấp
// ====================================================================================
const AUTHOR = A('Anh Anh Author', 'Anh Anh', 'Author'); // -> "A. A. Author"

describe('IEEE - đối chiếu từng mẫu', () => {
  it('1. Bài báo tạp chí: A. A. Author, “Title of article,” Journal Name, vol. x, no. x, pp. xx–xx, year, doi: DOI.', () => {
    const r = rec({ title: 'Title of article', authors: [AUTHOR], journal: 'Journal Name', volume: '7', issue: '2', pages: '313-325', publicationYear: 2020, doi: '10.1000/xyz', documentType: 'journal-article' });
    expect(ieee(r)).toBe('A. A. Author, “Title of article,” Journal Name, vol. 7, no. 2, pp. 313–325, 2020, doi: 10.1000/xyz.');
  });

  it('2. Bài báo hội nghị: A. A. Author, “Title of paper,” in Proc. Conference Name, year, pp. xx–xx, doi: DOI.', () => {
    const r = rec({ title: 'Title of paper', authors: [AUTHOR], documentType: 'proceedings-article', journal: 'Conference Name', publicationYear: 2012, pages: '197-202', doi: '10.1109/icmla.2012.1' });
    expect(ieee(r)).toBe('A. A. Author, “Title of paper,” in Proc. Conference Name, 2012, pp. 197–202, doi: 10.1109/icmla.2012.1.');
  });

  it('2b. "Proceedings of the X" -> "Proc. X" (không lặp "Proc. Proceedings")', () => {
    const r = rec({ title: 'T', authors: [AUTHOR], documentType: 'proceedings-article', journal: 'Proceedings of the First International Workshop', publicationYear: 1998 });
    expect(ieee(r)).toBe('A. A. Author, “T,” in Proc. First International Workshop, 1998.');
  });

  it('3. Sách: A. A. Author, Title of Book, xth ed. Publisher, year. (không có lần xuất bản nên bỏ "xth ed.")', () => {
    const r = rec({ title: 'Title of Book', authors: [AUTHOR], documentType: 'book', publisher: 'Publisher', publicationYear: 1997 });
    expect(ieee(r)).toBe('A. A. Author, Title of Book. Publisher, 1997.');
  });

  it('4. Chương sách: A. A. Author, “Title of chapter,” in Title of Book, Editor, Ed. Publisher, year, pp. xx–xx. (không có biên tập viên)', () => {
    const r = rec({ title: 'Title of chapter', authors: [AUTHOR], documentType: 'book-chapter', journal: 'Title of Book', publisher: 'Publisher', publicationYear: 2022, pages: '1-20' });
    expect(ieee(r)).toBe('A. A. Author, “Title of chapter,” in Title of Book. Publisher, 2022, pp. 1–20.');
  });

  it('5. Luận văn: A. A. Author, “Title of thesis,” B.S. thesis, University Name, City, Country, year. (không rõ bậc học/nơi nên chỉ ghi "thesis")', () => {
    const r = rec({ title: 'Title of thesis', authors: [AUTHOR], documentType: 'dissertation', publisher: 'University Name', publicationYear: 2021 });
    expect(ieee(r)).toBe('A. A. Author, “Title of thesis,” thesis, University Name, 2021.');
  });

  it('7. Báo cáo kỹ thuật: A. A. Author, Title of Report, report number, Organization, year. (không có số báo cáo)', () => {
    const r = rec({ title: 'Title of Report', authors: [AUTHOR], documentType: 'report', publisher: 'Organization', publicationYear: 2019 });
    expect(ieee(r)).toBe('A. A. Author, Title of Report, Organization, 2019.');
  });

  it('8. Bài báo trực tuyến có DOI (không có trang): ..., vol. x, no. x, year, doi: DOI.', () => {
    const r = rec({ title: 'Title of article', authors: [AUTHOR], journal: 'Journal Name', volume: '12', issue: '3', publicationYear: 2023, doi: '10.5555/abc' });
    expect(ieee(r)).toBe('A. A. Author, “Title of article,” Journal Name, vol. 12, no. 3, 2023, doi: 10.5555/abc.');
  });

  it('6. Website: không hỗ trợ (ứng dụng chỉ tìm tài liệu học thuật) - dữ liệu loại khác được ghi theo dạng bài báo', () => {
    expect(referenceKind({ documentType: 'website' })).toBe('journal');
  });
});

describe('IEEE - tác giả, danh sách và các trường hợp biên', () => {
  it('tên tác giả: chữ cái đầu có dấu chấm đặt trước họ; tên có gạch nối; tên Việt', () => {
    const r = (a: Author[]) => ieee(rec({ title: 'T', authors: a, journal: 'J' }));
    expect(r([A('Jean-Pierre Dupont', 'Jean-Pierre', 'Dupont')])).toBe('J.-P. Dupont, “T,” J.');
    expect(r([A('Anh Văn Nguyễn', 'Anh Văn', 'Nguyễn')])).toBe('A. V. Nguyễn, “T,” J.');
    expect(r([A('Danton S. Char')])).toBe('D. S. Char, “T,” J.');
    expect(r([A('WHO Consortium')])).toBe('WHO Consortium, “T,” J.');
  });

  it('2 tác giả dùng "and"; 3-6 tác giả dùng "A, B, and C"; hơn 6 dùng "et al."', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => A(`Given${i} Fam${i}`, `Given${i}`, `Fam${i}`));
    const r = (n: number) => ieee(rec({ title: 'T', authors: mk(n), journal: 'J' }));
    expect(r(2)).toBe('G. Fam0 and G. Fam1, “T,” J.');
    expect(r(3)).toBe('G. Fam0, G. Fam1, and G. Fam2, “T,” J.');
    expect(r(6).startsWith('G. Fam0, G. Fam1, G. Fam2, G. Fam3, G. Fam4, and G. Fam5, “T,”')).toBe(true);
    expect(r(7)).toBe('G. Fam0 et al., “T,” J.');
  });

  it('tiêu đề kết thúc bằng ? hoặc ! thì không thêm dấu phẩy trong ngoặc kép', () => {
    expect(ieee(rec({ title: 'Why ML?', authors: [AUTHOR], journal: 'J', publicationYear: 2020 }))).toBe('A. A. Author, “Why ML?” J, 2020.');
  });

  it('thiếu trường thì bỏ qua, không bịa; không có tác giả thì bắt đầu bằng tiêu đề', () => {
    expect(ieee(rec({ title: 'Only title' }))).toBe('“Only title.”');
    expect(ieee(rec({ title: 'T', journal: 'J', publicationYear: 2020 }))).toBe('“T,” J, 2020.');
    expect(ieee(rec({ title: 'T', authors: [AUTHOR], journal: 'J.', publicationYear: 2020, pages: '9' }))).toBe('A. A. Author, “T,” J., p. 9, 2020.');
  });

  it('IEEE luôn ghi DOI theo mẫu bài báo/hội nghị, không phụ thuộc tùy chọn "Kèm DOI"', () => {
    const r = rec({ title: 'T', authors: [AUTHOR], journal: 'J', publicationYear: 2020, doi: '10.1/x' });
    expect(ieee(r, { includeDoi: false })).toContain('doi: 10.1/x');
  });

  it('danh sách IEEE đánh số [1], [2] theo thứ tự đưa vào; một bài thì không đánh số', () => {
    const a = rec({ title: 'Một', authors: [AUTHOR], journal: 'J1' });
    const b = rec({ title: 'Hai', authors: [AUTHOR], journal: 'J2' });
    expect(formatListWith([a, b], { style: 'ieee' })).toBe('[1] A. A. Author, “Một,” J1.\n[2] A. A. Author, “Hai,” J2.');
    expect(formatListWith([a], { style: 'ieee' })).toBe('A. A. Author, “Một,” J1.');
  });
});

// ====================================================================================
// Đối chiếu với mẫu APA 7 do người dùng cung cấp
// ====================================================================================
describe('APA 7 - đối chiếu từng mẫu', () => {
  it('Bài báo tạp chí: Author, A. A. (Year). Title of article. Journal Name, volume(issue), pages. https://doi.org/xxx', () => {
    const r = rec({ title: 'Title of article', authors: [AUTHOR], journal: 'Journal Name', volume: '7', issue: '2', pages: '313-325', publicationYear: 2020, doi: '10.1000/xyz' });
    expect(apa(r)).toBe('Author, A. A. (2020). Title of article. Journal Name, 7(2), 313–325. https://doi.org/10.1000/xyz');
  });

  it('Bài báo hội nghị: Author, A. A. (Year). Title of paper. In Proceedings title (pp. xx–xx). Publisher. DOI/URL', () => {
    const r = rec({ title: 'Title of paper', authors: [AUTHOR], documentType: 'proceedings-article', journal: 'Proceedings title', pages: '197-202', publisher: 'IEEE', publicationYear: 2012, doi: '10.1109/x' });
    expect(apa(r)).toBe('Author, A. A. (2012). Title of paper. In Proceedings title (pp. 197–202). IEEE. https://doi.org/10.1109/x');
  });

  it('Sách: Author, A. A. (Year). Title of book. Publisher. DOI/URL', () => {
    const r = rec({ title: 'Title of book', authors: [AUTHOR], documentType: 'book', publisher: 'Publisher', publicationYear: 1997, doi: '10.1201/b' });
    expect(apa(r)).toBe('Author, A. A. (1997). Title of book. Publisher. https://doi.org/10.1201/b');
  });

  it('Chương sách: Author, A. A. (Year). Title of chapter. In A. Editor (Ed.), Title of book (pp. xx–xx). Publisher. DOI/URL (không có biên tập viên)', () => {
    const r = rec({ title: 'Title of chapter', authors: [AUTHOR], documentType: 'book-chapter', journal: 'Title of book', pages: '1-20', publisher: 'Publisher', publicationYear: 2022, doi: '10.1201/c' });
    expect(apa(r)).toBe('Author, A. A. (2022). Title of chapter. In Title of book (pp. 1–20). Publisher. https://doi.org/10.1201/c');
  });

  it('Luận văn: Author, A. A. (Year). Title of thesis [Bachelor’s thesis/Master’s thesis, University Name]. Repository. URL (không rõ bậc học)', () => {
    const r = rec({ title: 'Title of thesis', authors: [AUTHOR], documentType: 'dissertation', publisher: 'University Name', publicationYear: 2021, originalUrl: 'https://repo.edu/123' });
    expect(apa(r)).toBe('Author, A. A. (2021). Title of thesis [Thesis, University Name]. https://repo.edu/123');
  });

  it('Báo cáo: Organization/Author. (Year). Title of report (Report No. xxx). Publisher. URL (không có số báo cáo)', () => {
    const r = rec({ title: 'Title of report', authors: [A('World Health Organization')], documentType: 'report', publisher: 'WHO Press', publicationYear: 2019, originalUrl: 'https://who.int/r' });
    expect(apa(r)).toBe('World Health Organization. (2019). Title of report. WHO Press. https://who.int/r');
  });

  it('Website: không hỗ trợ (ứng dụng chỉ tìm tài liệu học thuật)', () => {
    expect(referenceKind({ documentType: 'webpage' })).toBe('journal');
  });
});

describe('APA 7 - tác giả, danh sách và các trường hợp biên', () => {
  it('tác giả: Họ, A. A.; 2 tác giả "A, A., & B, B."; 3+ "A, A., B, B., & C, C."; tên gạch nối; tên Việt', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => A(`Given${i} Fam${i}`, `Given${i}`, `Fam${i}`));
    const r = (a: Author[]) => apa(rec({ title: 'T', authors: a, journal: 'J', publicationYear: 2020 }));
    expect(r(mk(2))).toBe('Fam0, G., & Fam1, G. (2020). T. J.');
    expect(r(mk(3))).toBe('Fam0, G., Fam1, G., & Fam2, G. (2020). T. J.');
    expect(r([A('Jean-Pierre Dupont', 'Jean-Pierre', 'Dupont')])).toBe('Dupont, J.-P. (2020). T. J.');
    expect(r([A('Anh Văn Nguyễn', 'Anh Văn', 'Nguyễn')])).toBe('Nguyễn, A. V. (2020). T. J.');
    expect(r([A('Nguyễn Văn An')])).toBe('Nguyễn, V. A. (2020). T. J.');
  });

  it('hơn 20 tác giả: 19 người đầu, ". . .", người cuối', () => {
    const many = Array.from({ length: 22 }, (_, i) => A(`G${i} F${i}`, `G${i}`, `F${i}`));
    const text = apa(rec({ title: 'T', authors: many, journal: 'J', publicationYear: 2020 }));
    expect(text.startsWith('F0, G., F1, G.')).toBe(true);
    expect(text).toContain('F18, G., . . . F21, G. (2020).');
    expect(text).not.toContain('F19');
  });

  it('thiếu năm -> (n.d.); thiếu tập thì chỉ còn trang; chỉ có số thì (số); không DOI thì dùng URL nếu có', () => {
    expect(apa(rec({ title: 'T', authors: [AUTHOR], journal: 'J' }))).toBe('Author, A. A. (n.d.). T. J.');
    expect(apa(rec({ title: 'T', authors: [AUTHOR], journal: 'J', pages: '5', publicationYear: 2020 }))).toBe('Author, A. A. (2020). T. J, 5.');
    expect(apa(rec({ title: 'T', authors: [AUTHOR], journal: 'J', issue: '4', publicationYear: 2020 }))).toBe('Author, A. A. (2020). T. J, (4).');
    expect(apa(rec({ title: 'T', authors: [AUTHOR], journal: 'arXiv', publicationYear: 2024, originalUrl: 'https://arxiv.org/abs/2401.1' }))).toBe('Author, A. A. (2024). T. arXiv. https://arxiv.org/abs/2401.1');
  });

  it('không có tác giả: tên bài đứng ở vị trí tác giả', () => {
    expect(apa(rec({ title: 'Một tiêu đề', journal: 'J', publicationYear: 2020 }))).toBe('Một tiêu đề. (2020). J.');
  });

  it('tiêu đề kết thúc bằng ? không bị thêm dấu chấm; tiếng Việt giữ nguyên', () => {
    expect(apa(rec({ title: 'Ứng dụng AI trong giáo dục?', authors: [A('Anh Nguyễn', 'Anh', 'Nguyễn')], journal: 'Tạp chí Giáo dục', volume: '12', publicationYear: 2025 }))).toBe('Nguyễn, A. (2025). Ứng dụng AI trong giáo dục? Tạp chí Giáo dục, 12.');
  });

  it('danh sách APA: không đánh số, sắp xếp theo bảng chữ cái của tác giả', () => {
    const z = rec({ title: 'Z', authors: [A('Zed Zulu', 'Zed', 'Zulu')], journal: 'J' });
    const a = rec({ title: 'A', authors: [A('Amy Alpha', 'Amy', 'Alpha')], journal: 'J' });
    const m = rec({ title: 'M', authors: [A('Max Mike', 'Max', 'Mike')], journal: 'J' });
    expect(formatListWith([z, a, m], { style: 'apa' })).toBe('Alpha, A. (n.d.). A. J.\nMike, M. (n.d.). M. J.\nZulu, Z. (n.d.). Z. J.');
  });

  it('trích dẫn trong văn bản APA: (Nguyen, 2025), (Nguyen & Tran, 2025), (Nguyen et al., 2025)', () => {
    const au = (n: string) => A(`G ${n}`, 'G', n);
    expect(formatApaInText(rec({ authors: [au('Nguyen')], publicationYear: 2025 }))).toBe('(Nguyen, 2025)');
    expect(formatApaInText(rec({ authors: [au('Nguyen'), au('Tran')], publicationYear: 2025 }))).toBe('(Nguyen & Tran, 2025)');
    expect(formatApaInText(rec({ authors: [au('Nguyen'), au('Tran'), au('Le')], publicationYear: 2025 }))).toBe('(Nguyen et al., 2025)');
    expect(formatApaInText(rec({ authors: [au('Nguyen')] }))).toBe('(Nguyen, n.d.)');
    expect(formatApaInText(rec({ title: 'Một tiêu đề khá là dài ở đây', publicationYear: 2025 }))).toBe('(“Một tiêu đề khá”, 2025)');
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

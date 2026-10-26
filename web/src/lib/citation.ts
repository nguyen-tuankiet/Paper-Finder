import type { Author, PaperRecord } from '../../../shared/types';

/**
 * Ghi tài liệu tham khảo theo ba kiểu:
 * - 'ieee'  : IEEE (danh sách đánh số [1], [2]...)
 * - 'apa'   : APA 7 (danh sách sắp xếp theo tên tác giả)
 * - 'basic' : quy ước ban đầu: Tác giả, Tên bài, Tạp chí (tập), no. số, năm, pp. trang.
 *
 * Nguyên tắc chung: phần nào nguồn dữ liệu không có (tập, số, trang, biên tập viên, lần xuất bản, số báo cáo,
 * bậc học...) thì BỎ QUA, không bịa. Chữ nghiêng (tên tạp chí, tên sách) không biểu diễn được trong văn bản thuần.
 */
export type CitationStyle = 'ieee' | 'apa' | 'basic';
export type ReferenceKind = 'journal' | 'conference' | 'book' | 'chapter' | 'thesis' | 'report';

export const CITATION_STYLE_LABELS: Record<CitationStyle, string> = { ieee: 'IEEE', apa: 'APA 7', basic: 'Mẫu cơ bản' };

const MAX_AUTHORS_BASIC = 6;
const MAX_AUTHORS_IEEE = 6;
const APA_FULL_LIST_LIMIT = 20;

const ORGANIZATION = /(consortium|group|collaboration|committee|organi[sz]ation|university|institute|association|society|team|network|company|\binc\b|\bltd\b|trường|viện|hội|tổ chức)/i;

// Họ Việt Nam thường đứng ĐẦU tên. Nhóm không mơ hồ: dùng khi tên có từ 2 phần trở lên; nhóm dễ nhầm với tên phương Tây: cần từ 3 phần.
const VN_SURNAMES_STRONG = new Set(['nguyen', 'tran', 'pham', 'hoang', 'huynh', 'phan', 'dang', 'bui', 'ngo', 'duong']);
const VN_SURNAMES_WEAK = new Set(['le', 'vu', 'vo', 'do', 'ho', 'ly']);

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

// ---------- Tên tác giả ----------

interface ParsedName {
  family: string;
  given: string;
  /** Tên tổ chức hoặc tên chỉ có một từ: giữ nguyên, không rút gọn. */
  whole: boolean;
}

export function parseAuthor(author: Author): ParsedName {
  const given = author.given?.trim() ?? '';
  const family = author.family?.trim() ?? '';
  if (family && given) return { family, given, whole: false };

  // Một số nhà xuất bản ghi cả họ tên vào trường "họ" mà không có "tên": khi đó phân tích như tên đầy đủ.
  const full = (family && !given ? (family.includes(' ') ? family : '') : author.name).trim().replace(/\s+/g, ' ');
  if (family && !given && !full) return { family, given: '', whole: true };
  if (!full || ORGANIZATION.test(full)) return { family: full, given: '', whole: true };

  if (full.includes(',')) {
    const [last = '', first = ''] = full.split(',', 2).map((s) => s.trim());
    return first ? { family: last, given: first, whole: false } : { family: last, given: '', whole: true };
  }
  const tokens = full.split(' ');
  if (tokens.length === 1) return { family: full, given: '', whole: true };

  const head = fold(tokens[0]!);
  const vietnamese = VN_SURNAMES_STRONG.has(head) || (VN_SURNAMES_WEAK.has(head) && tokens.length >= 3);
  if (vietnamese) return { family: tokens[0]!, given: tokens.slice(1).join(' '), whole: false };
  return { family: tokens[tokens.length - 1]!, given: tokens.slice(0, -1).join(' '), whole: false };
}

/** Chữ cái đầu viết liền: "Anh Văn" -> "AV". */
function initials(given: string): string {
  return given
    .split(/[\s.\-]+/)
    .filter(Boolean)
    .map((token) => [...token][0]!.toUpperCase())
    .join('');
}

/** Chữ cái đầu có dấu chấm: "Anh Văn" -> "A. V.", "Jean-Pierre" -> "J.-P.". */
function dottedInitials(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((token) =>
      token
        .split('-')
        .filter(Boolean)
        .map((part) => `${[...part][0]!.toUpperCase()}.`)
        .join('-'),
    )
    .join(' ');
}

const sameText = (a: string, b: string) => fold(a).replace(/\s+/g, ' ').trim() === fold(b).replace(/\s+/g, ' ').trim();

/** Bỏ "tác giả" trùng với tên bài (dữ liệu lỗi từ nguồn: đôi khi tên bài bị ghi vào trường tác giả). */
function cleanAuthors(authors: Author[], title: string): Author[] {
  return authors.filter((a) => a.name.trim() && (!title || !sameText(a.name, title)));
}

/** "Kumar S": họ trước, chữ cái đầu của tên sau (mẫu cơ bản). */
export function formatAuthor(author: Author): string {
  const p = parseAuthor(author);
  return p.whole || !p.given ? p.family : `${p.family} ${initials(p.given)}`;
}

export function formatAuthors(authors: Author[], title = ''): string {
  const names = cleanAuthors(authors, title).map(formatAuthor).filter(Boolean);
  if (names.length > MAX_AUTHORS_BASIC) return `${names.slice(0, MAX_AUTHORS_BASIC).join(', ')}, et al.`;
  return names.join(', ');
}

/** IEEE: "A. A. Author"; 2 tác giả: "A and B"; 3-6: "A, B, and C"; hơn 6: "A et al.". */
function ieeeAuthor(author: Author): string {
  const p = parseAuthor(author);
  return p.whole || !p.given ? p.family : `${dottedInitials(p.given)} ${p.family}`;
}

function ieeeAuthors(authors: Author[]): string {
  const names = authors.map(ieeeAuthor).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length > MAX_AUTHORS_IEEE) return `${names[0]} et al.`;
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** APA 7: "Author, A. A."; 2-20 tác giả: "A, A., B, B., & C, C."; hơn 20: 19 người đầu, ". . .", người cuối. */
function apaAuthor(author: Author): string {
  const p = parseAuthor(author);
  return p.whole || !p.given ? p.family : `${p.family}, ${dottedInitials(p.given)}`;
}

function apaAuthors(authors: Author[]): string {
  const names = authors.map(apaAuthor).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length > APA_FULL_LIST_LIMIT) return `${names.slice(0, 19).join(', ')}, . . . ${names[names.length - 1]}`;
  if (names.length === 2) return `${names[0]}, & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
}

// ---------- Loại tài liệu ----------

export function referenceKind(record: Pick<PaperRecord, 'documentType'>): ReferenceKind {
  const type = record.documentType.toLowerCase();
  if (/proceedings|conference/.test(type)) return 'conference';
  if (/chapter/.test(type)) return 'chapter';
  if (/dissertation|thesis/.test(type)) return 'thesis';
  if (/report/.test(type)) return 'report';
  if (/^(book|monograph|edited-book|reference-book|textbook)$/.test(type)) return 'book';
  return 'journal'; // bài báo, preprint, review...: dùng dạng bài tạp chí
}

// ---------- Tiện ích chung ----------

const trimTitle = (title: string) => title.trim().replace(/[.\s]+$/, '');
const endsWithPunctuation = (s: string) => /[?!]$/.test(s);
/** Chuẩn hóa khoảng trang về gạch en: "313-325" -> "313–325". */
const enDash = (pages: string) => pages.replace(/-/g, '–');

function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

const join = (parts: string[], separator = ', ') => parts.map((p) => p.trim()).filter(Boolean).join(separator);

export interface ReferenceOptions {
  style?: CitationStyle;
  /** Chỉ áp dụng cho mẫu cơ bản (IEEE/APA tự quyết định có DOI theo từng mẫu). */
  includeDoi?: boolean;
}

// ---------- IEEE ----------

/** "Proceedings of the X" -> "Proc. X"; còn lại -> "Proc. <tên>". */
function ieeeProceedings(name: string): string {
  const rest = name.replace(/^proceedings(?:\s+of)?(?:\s+the)?\s+/i, '').replace(/^proc\.?\s+/i, '');
  return `Proc. ${rest || name}`;
}

function ieeeReference(r: PaperRecord, kind: ReferenceKind): string {
  const authors = ieeeAuthors(cleanAuthors(r.authors, r.title));
  const title = trimTitle(r.title) || 'Chưa có tiêu đề';
  const year = r.publicationYear ? String(r.publicationYear) : '';
  const pages = r.pages ? (r.pages.includes('-') ? `pp. ${enDash(r.pages)}` : `p. ${r.pages}`) : '';
  const doi = r.doi ? `doi: ${r.doi}` : '';
  const volume = r.volume ? `vol. ${r.volume}` : '';
  const issue = r.issue ? `no. ${r.issue}` : '';
  const org = r.publisher || r.journal;

  // “Title,” hoặc “Title?” (tiêu đề đã có dấu hỏi/than thì không thêm dấu phẩy)
  const quoted = endsWithPunctuation(title) ? `“${title}”` : `“${title},”`;
  const withAuthors = (rest: string) => (authors ? `${authors}, ${rest}` : rest);
  const close = (text: string) => (/[.?!”]$/.test(text) ? text : `${text}.`);

  switch (kind) {
    case 'conference': {
      const tail = join([r.journal ? `in ${ieeeProceedings(r.journal)}` : '', year, pages, doi]);
      return close(withAuthors(tail ? `${quoted} ${tail}` : `“${title}.”`));
    }
    case 'book': {
      // Mẫu: Title of Book, xth ed. Publisher, year.  (không có thông tin lần xuất bản nên bỏ "xth ed.")
      const tail = join([r.publisher, year]);
      return close(withAuthors(tail ? `${title}. ${tail}` : title));
    }
    case 'chapter': {
      // Mẫu: “Title of chapter,” in Title of Book, Editor, Ed. Publisher, year, pp. xx–xx.  (không có biên tập viên)
      const tail = join([r.publisher, year, pages]);
      const book = r.journal ? `in ${r.journal}` : '';
      return close(withAuthors(`${quoted} ${[book ? `${book}.` : '', tail].filter(Boolean).join(' ')}`.trim()));
    }
    case 'thesis': {
      // Mẫu: “Title of thesis,” B.S. thesis, University Name, City, Country, year.  (không rõ bậc học/nơi nên chỉ ghi "thesis")
      const tail = join(['thesis', org, year]);
      return close(withAuthors(`${quoted} ${tail}`));
    }
    case 'report': {
      // Mẫu: Title of Report, report number, Organization, year.  (không có số báo cáo)
      return close(withAuthors(join([title, org, year])));
    }
    default: {
      const tail = join([r.journal, volume, issue, pages, year, doi]);
      return close(withAuthors(tail ? `${quoted} ${tail}` : `“${title}.”`));
    }
  }
}

// ---------- APA 7 ----------

function apaLink(r: PaperRecord): string {
  if (r.doi) return doiUrl(r.doi);
  return /^https?:\/\//i.test(r.originalUrl) ? r.originalUrl : '';
}

function apaReference(r: PaperRecord, kind: ReferenceKind): string {
  const authors = apaAuthors(cleanAuthors(r.authors, r.title));
  const title = trimTitle(r.title) || 'Chưa có tiêu đề';
  const year = r.publicationYear ? String(r.publicationYear) : 'n.d.';
  const pages = r.pages ? enDash(r.pages) : '';
  const link = apaLink(r);
  const sentence = (text: string) => (!text ? '' : /[.?!]$/.test(text) ? text : `${text}.`);
  const titleSentence = sentence(title);

  // Không có tác giả: tên bài chuyển lên vị trí tác giả.
  const head = authors ? `${sentence(authors)} (${year}).` : `${titleSentence} (${year}).`;
  const titlePart = authors ? titleSentence : '';
  const body = (...parts: string[]) => join([head, titlePart, ...parts], ' ');
  const pp = pages ? ` (${pages.includes('–') ? 'pp.' : 'p.'} ${pages})` : '';

  switch (kind) {
    case 'conference':
      return body(r.journal ? sentence(`In ${r.journal}${pp}`) : '', sentence(r.publisher), link);
    case 'book':
      return body(sentence(r.publisher), link);
    case 'chapter':
      return body(r.journal ? sentence(`In ${r.journal}${pp}`) : '', sentence(r.publisher), link);
    case 'thesis': {
      // Mẫu: Title of thesis [Bachelor’s thesis/Master’s thesis, University Name]. Repository. URL  (không rõ bậc học)
      const school = r.publisher || r.journal;
      const bracket = `[Thesis${school ? `, ${school}` : ''}].`;
      return join([head, authors ? `${title} ${bracket}` : bracket, link], ' ');
    }
    case 'report':
      return body(sentence(r.publisher), link);
    default: {
      // Journal Name, volume(issue), pages.
      const vol = r.volume ? `${r.volume}${r.issue ? `(${r.issue})` : ''}` : r.issue ? `(${r.issue})` : '';
      const container = sentence(join([r.journal, vol, pages]));
      return body(container, link);
    }
  }
}

// ---------- Mẫu cơ bản (quy ước ban đầu) ----------

function pagesBasic(pages: string): string {
  if (!pages) return '';
  return pages.includes('-') ? `pp. ${pages.replace(/-/g, ' - ')}` : `p. ${pages}`;
}

function basicReference(record: PaperRecord, kind: ReferenceKind, includeDoi: boolean): string {
  const year = record.publicationYear ? String(record.publicationYear) : '';
  const volume = record.volume ?? '';
  const issue = record.issue ?? '';
  const pages = record.pages ?? '';
  const place = record.place ?? '';
  const authors = formatAuthors(record.authors, record.title);
  const title = trimTitle(record.title) || 'Chưa có tiêu đề';

  let parts: string[];
  if (kind === 'conference') {
    // Nơi và thời gian tổ chức đã gồm năm khi nguồn có ngày; nếu chưa có năm thì thêm năm xuất bản.
    const hasYear = /\b\d{4}\b/.test(place);
    parts = [authors, title, record.journal, place, hasYear ? '' : year];
  } else if (kind === 'book' || kind === 'report') {
    parts = [authors, title, record.publisher, place, year];
  } else if (kind === 'chapter') {
    parts = [authors, title, record.journal ? `in ${record.journal}` : '', record.publisher, place, year, pagesBasic(pages)];
  } else if (kind === 'thesis') {
    parts = [authors, title, record.publisher || record.journal, place, year];
  } else {
    parts = [authors, title, record.journal ? `${record.journal}${volume ? ` (${volume})` : ''}` : volume ? `(${volume})` : '', issue ? `no. ${issue}` : '', year, pagesBasic(pages)];
  }
  if (includeDoi && record.doi) parts.push(`DOI: ${record.doi}`);
  return `${join(parts)}.`;
}

// ---------- API công khai ----------

export function formatReference(record: PaperRecord, options: ReferenceOptions = {}): string {
  const style = options.style ?? 'ieee';
  const kind = referenceKind(record);
  if (style === 'ieee') return ieeeReference(record, kind);
  if (style === 'apa') return apaReference(record, kind);
  return basicReference(record, kind, options.includeDoi === true);
}

/**
 * Danh sách tham khảo:
 * - IEEE: đánh số [1], [2]... theo thứ tự đưa vào (thứ tự trích dẫn).
 * - APA 7: KHÔNG đánh số, sắp xếp theo bảng chữ cái của tác giả.
 * - Mẫu cơ bản: đánh số [1], [2]...
 * Một bài thì không đánh số.
 */
export function formatReferenceList(records: PaperRecord[], options: ReferenceOptions = {}): string {
  const style = options.style ?? 'ieee';
  const lines = records.map((r) => formatReference(r, options));
  if (style === 'apa') {
    return [...lines].sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' })).join('\n');
  }
  return lines.length === 1 ? lines[0]! : lines.map((line, i) => `[${i + 1}] ${line}`).join('\n');
}

/**
 * Trích dẫn trong nội dung theo APA 7: (Nguyen, 2025), (Nguyen & Tran, 2025), (Nguyen et al., 2025).
 * (IEEE dùng số thứ tự [n] trong danh sách nên không có hàm riêng.)
 */
export function formatApaInText(record: PaperRecord): string {
  const authors = cleanAuthors(record.authors, record.title).map((a) => parseAuthor(a).family).filter(Boolean);
  const year = record.publicationYear ? String(record.publicationYear) : 'n.d.';
  let who: string;
  if (authors.length === 0) who = `“${trimTitle(record.title).split(/\s+/).slice(0, 4).join(' ')}”`;
  else if (authors.length === 1) who = authors[0]!;
  else if (authors.length === 2) who = `${authors[0]} & ${authors[1]}`;
  else who = `${authors[0]} et al.`;
  return `(${who}, ${year})`;
}

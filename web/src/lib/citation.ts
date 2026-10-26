import type { Author, PaperRecord } from '../../../shared/types';

/**
 * Ghi tài liệu tham khảo theo quy ước:
 * - Bài tạp chí:   Tác giả, Tên bài báo, Tên tạp chí (tập), số, năm, pp. trang.
 *   VD: Kumar S, Superconvergence of a ..., IMA Journal of Numerical Analysis (7), 1987, pp. 313 - 325.
 * - Hội nghị:      Tác giả, Tên bài báo, Tên hội nghị/tuyển tập, nơi và thời gian tổ chức.
 * - Sách:          Tác giả, Tên sách, Nhà xuất bản, Nơi xuất bản, Năm.
 * Phần nào nguồn không có thì bỏ qua, không bịa.
 */
export type ReferenceKind = 'journal' | 'conference' | 'book' | 'chapter';

const MAX_AUTHORS = 6;

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

function initials(given: string): string {
  return given
    .split(/[\s.\-]+/)
    .filter(Boolean)
    .map((token) => [...token][0]!.toUpperCase())
    .join('');
}

/** "Kumar S": họ trước, chữ cái đầu của tên sau. Tổ chức giữ nguyên. */
export function formatAuthor(author: Author): string {
  const given = author.given?.trim();
  const family = author.family?.trim();
  if (family && given) return `${family} ${initials(given)}`;

  // Một số nhà xuất bản ghi cả họ tên vào trường "họ" mà không có "tên": khi đó phân tích như tên đầy đủ.
  const name = (family && !given && family.includes(' ') ? family : family && !given ? '' : author.name).trim().replace(/\s+/g, ' ');
  if (family && !given && !name) return family;
  if (!name || ORGANIZATION.test(name)) return name;

  if (name.includes(',')) {
    const [last = '', first = ''] = name.split(',', 2).map((s) => s.trim());
    return first ? `${last} ${initials(first)}` : last;
  }
  const tokens = name.split(' ');
  if (tokens.length === 1) return name;

  const head = fold(tokens[0]!);
  const vietnamese = VN_SURNAMES_STRONG.has(head) || (VN_SURNAMES_WEAK.has(head) && tokens.length >= 3);
  if (vietnamese) return `${tokens[0]} ${initials(tokens.slice(1).join(' '))}`;
  return `${tokens[tokens.length - 1]} ${initials(tokens.slice(0, -1).join(' '))}`;
}

/** `title`: bỏ qua "tác giả" trùng với tên bài (dữ liệu lỗi từ nguồn: đôi khi tên bài bị ghi vào trường tác giả). */
export function formatAuthors(authors: Author[], title = ''): string {
  const same = (s: string) => fold(s).replace(/\s+/g, ' ').trim();
  const names = authors
    .filter((a) => !title || same(a.name) !== same(title))
    .map(formatAuthor)
    .filter(Boolean);
  if (names.length > MAX_AUTHORS) return `${names.slice(0, MAX_AUTHORS).join(', ')}, et al.`;
  return names.join(', ');
}

export function referenceKind(record: Pick<PaperRecord, 'documentType'>): ReferenceKind {
  const type = record.documentType.toLowerCase();
  if (/proceedings|conference/.test(type)) return 'conference';
  if (/chapter/.test(type)) return 'chapter';
  if (/^(book|monograph|edited-book|reference-book|textbook)$/.test(type)) return 'book';
  return 'journal';
}

const trimTitle = (title: string) => title.trim().replace(/[.\s]+$/, '');

/** "313-325" -> "pp. 313 - 325"; một trang -> "p. 313". */
function pagesText(pages: string): string {
  if (!pages) return '';
  return pages.includes('-') ? `pp. ${pages.replace(/-/g, ' - ')}` : `p. ${pages}`;
}

export interface ReferenceOptions {
  /** Thêm DOI (nếu có) vào cuối. */
  includeDoi?: boolean;
}

export function formatReference(record: PaperRecord, options: ReferenceOptions = {}): string {
  const kind = referenceKind(record);
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
  } else if (kind === 'book') {
    parts = [authors, title, record.publisher, place, year];
  } else if (kind === 'chapter') {
    parts = [authors, title, record.journal ? `in ${record.journal}` : '', record.publisher, place, year, pagesText(pages)];
  } else {
    parts = [authors, title, record.journal ? `${record.journal}${volume ? ` (${volume})` : ''}` : volume ? `(${volume})` : '', issue ? `no. ${issue}` : '', year, pagesText(pages)];
  }
  if (options.includeDoi && record.doi) parts.push(`DOI: ${record.doi}`);

  return `${parts.map((p) => p.trim()).filter(Boolean).join(', ')}.`;
}

/** Danh sách tham khảo đánh số [1], [2]... mỗi bài một dòng; một bài thì không đánh số. */
export function formatReferenceList(records: PaperRecord[], options: ReferenceOptions = {}): string {
  const lines = records.map((r) => formatReference(r, options));
  return lines.length === 1 ? lines[0]! : lines.map((line, i) => `[${i + 1}] ${line}`).join('\n');
}

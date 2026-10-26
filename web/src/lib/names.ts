import type { Author } from '../../../shared/types';

// Tiện ích tên tác giả dùng chung cho các kiểu trích dẫn.

const ORGANIZATION = /(consortium|group|collaboration|committee|organi[sz]ation|university|institute|association|society|team|network|company|\binc\b|\bltd\b|trường|viện|hội|tổ chức)/i;

// Họ Việt Nam thường đứng ĐẦU tên. Nhóm không mơ hồ: dùng khi tên có từ 2 phần trở lên; nhóm dễ nhầm với tên phương Tây: cần từ 3 phần.
const VN_SURNAMES_STRONG = new Set(['nguyen', 'tran', 'pham', 'hoang', 'huynh', 'phan', 'dang', 'bui', 'ngo', 'duong']);
const VN_SURNAMES_WEAK = new Set(['le', 'vu', 'vo', 'do', 'ho', 'ly']);

/** Bỏ dấu + chữ thường, dùng để so sánh. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

export interface ParsedName {
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
export function initials(given: string): string {
  return given
    .split(/[\s.\-]+/)
    .filter(Boolean)
    .map((token) => [...token][0]!.toUpperCase())
    .join('');
}

/** Chữ cái đầu có dấu chấm: "Anh Văn" -> "A. V.", "Jean-Pierre" -> "J.-P.". */
export function dottedInitials(given: string): string {
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

export const sameText = (a: string, b: string) => fold(a).replace(/\s+/g, ' ').trim() === fold(b).replace(/\s+/g, ' ').trim();

/** Bỏ "tác giả" trùng với tên bài (dữ liệu lỗi từ nguồn: đôi khi tên bài bị ghi vào trường tác giả). */
export function cleanAuthors(authors: Author[], title: string): Author[] {
  return authors.filter((a) => a.name.trim() && (!title || !sameText(a.name, title)));
}

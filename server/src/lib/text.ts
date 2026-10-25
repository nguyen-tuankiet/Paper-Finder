const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

// Thẻ cấp khối (đoạn, tiêu đề...) -> khoảng trắng; thẻ nội tuyến (<i>, <sub>...) -> bỏ hẳn để không tách từ.
const BLOCK_TAG = /<\/?(?:[a-z]+:)?(?:p|title|sec|br|div|li|ul|ol|label|h[1-6])\b[^>]*>/gi;
const ANY_TAG = /<\/?[a-z][^>]*>/gi;

/** Bỏ thẻ HTML/JATS, giải mã entity, chuẩn hóa Unicode NFC và gộp khoảng trắng. */
export function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return decodeEntities(value.replace(BLOCK_TAG, ' ').replace(ANY_TAG, ''))
    .normalize('NFC')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Làm sạch abstract; bỏ nhãn "Abstract" đứng đầu mà Crossref hay thêm vào. */
export function cleanAbstract(value: unknown): string {
  const text = cleanText(value);
  const stripped = text.replace(/^abstract\b[\s:.\-–—]*/i, '').trim();
  return stripped || (/^abstract\W*$/i.test(text) ? '' : text);
}

/**
 * Khóa so sánh tiêu đề: bỏ dấu (kể cả tiếng Việt), chữ thường, bỏ ký tự đặc biệt.
 * Chỉ dùng để so sánh, không dùng để hiển thị.
 */
export function normalizeTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Khóa so sánh họ tác giả (từ họ nếu có, nếu không lấy từ cuối của tên). */
export function authorKey(author: { name: string; family?: string }): string {
  const family = author.family?.trim();
  if (family) return normalizeTitle(family);
  const parts = author.name.trim().split(/\s+/);
  return normalizeTitle(parts[parts.length - 1] ?? '');
}

/**
 * Dựng lại abstract từ "inverted index" của OpenAlex ({từ: [vị trí, ...]}).
 * Trả về chuỗi rỗng nếu dữ liệu thiếu hoặc sai định dạng.
 */
export function abstractFromInvertedIndex(index: unknown): string {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return '';
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (typeof position === 'number' && Number.isInteger(position) && position >= 0 && position < 100_000) {
        words[position] = word;
      }
    }
  }
  return cleanAbstract(words.filter((word) => word !== undefined).join(' '));
}

/** Chỉ chấp nhận URL http(s); loại các scheme nguy hiểm như javascript:. */
export function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return '';
  try {
    return new URL(trimmed).toString();
  } catch {
    return '';
  }
}

import type { Author, PaperRecord } from '../../../shared/types';
import { cleanAuthors, dottedInitials, fold, initials, parseAuthor } from './names';

/**
 * Mẫu trích dẫn do người dùng tự soạn.
 *
 * Cú pháp:
 * - `{truong}`   : được thay bằng giá trị của bài (xem CUSTOM_FIELDS).
 * - `[[ ... ]]`  : nhóm tùy chọn - nếu BẤT KỲ trường nào bên trong rỗng thì cả nhóm bị bỏ.
 *                  Ví dụ `[[, tập {volume}]]` biến mất khi bài không có tập (không bịa dữ liệu).
 * - Mọi ký tự khác giữ nguyên (kể cả [ ] đơn như "[{index}]").
 */
export type AuthorFormat = 'family_initials' | 'initials_family' | 'family_comma_initials' | 'source';
export type AuthorJoin = 'comma' | 'comma_and' | 'comma_amp' | 'semicolon';
export type ListOrder = 'table' | 'author';

export interface CustomCitationConfig {
  template: string;
  authorFormat: AuthorFormat;
  authorJoin: AuthorJoin;
  /** Quá số này thì ghi N người đầu rồi "et al.". */
  maxAuthors: number;
  order: ListOrder;
}

export interface CustomField {
  key: string;
  label: string;
}

export const CUSTOM_FIELDS: CustomField[] = [
  { key: 'authors', label: 'Tác giả' },
  { key: 'first_author', label: 'Tác giả đầu' },
  { key: 'title', label: 'Tên bài' },
  { key: 'journal', label: 'Tạp chí / hội nghị / sách' },
  { key: 'volume', label: 'Tập' },
  { key: 'issue', label: 'Số' },
  { key: 'volume_issue', label: 'Tập(số)' },
  { key: 'pages', label: 'Trang (313-325)' },
  { key: 'pages_en', label: 'Trang (313–325)' },
  { key: 'first_page', label: 'Trang đầu' },
  { key: 'last_page', label: 'Trang cuối' },
  { key: 'year', label: 'Năm' },
  { key: 'doi', label: 'DOI' },
  { key: 'doi_url', label: 'Link DOI' },
  { key: 'url', label: 'URL bài' },
  { key: 'publisher', label: 'Nhà xuất bản' },
  { key: 'place', label: 'Nơi xuất bản/tổ chức' },
  { key: 'type', label: 'Loại tài liệu' },
  { key: 'retrieved', label: 'Ngày lấy dữ liệu' },
  { key: 'index', label: 'Số thứ tự' },
];

const KNOWN_KEYS = new Set(CUSTOM_FIELDS.map((f) => f.key));

export const AUTHOR_FORMAT_LABELS: Record<AuthorFormat, string> = {
  family_initials: 'Họ + tên viết tắt (Kumar S)',
  initials_family: 'Tên viết tắt + họ (S. Kumar)',
  family_comma_initials: 'Họ, tên viết tắt (Kumar, S.)',
  source: 'Như nguồn cung cấp (tên đầy đủ)',
};

export const AUTHOR_JOIN_LABELS: Record<AuthorJoin, string> = {
  comma: 'Ngăn bằng dấu phẩy (A, B, C)',
  comma_and: 'Dấu phẩy và “and” (A, B, and C)',
  comma_amp: 'Dấu phẩy và “&” (A, B, & C)',
  semicolon: 'Ngăn bằng chấm phẩy (A; B; C)',
};

export const LIST_ORDER_LABELS: Record<ListOrder, string> = {
  table: 'Giữ thứ tự đang hiển thị trong bảng',
  author: 'Sắp xếp theo tên tác giả (A–Z)',
};

export interface CustomPreset {
  id: string;
  label: string;
  config: CustomCitationConfig;
}

export const CUSTOM_PRESETS: CustomPreset[] = [
  {
    id: 'basic',
    label: 'Đơn giản: Tác giả, Tên bài, Tạp chí (tập), số, năm, trang',
    config: {
      template: '{authors}, {title}, {journal}[[ ({volume})]][[, no. {issue}]][[, {year}]][[, pp. {pages}]].',
      authorFormat: 'family_initials',
      authorJoin: 'comma',
      maxAuthors: 6,
      order: 'table',
    },
  },
  {
    id: 'ieee',
    label: 'Giống IEEE (bài tạp chí), có số thứ tự',
    config: {
      template: '[[[{index}] ]]{authors}, “{title},” {journal}[[, vol. {volume}]][[, no. {issue}]][[, pp. {pages_en}]][[, {year}]][[, doi: {doi}]].',
      authorFormat: 'initials_family',
      authorJoin: 'comma_and',
      maxAuthors: 6,
      order: 'table',
    },
  },
  {
    id: 'apa',
    label: 'Giống APA 7 (bài tạp chí)',
    config: {
      template: '{authors}[[ ({year})]]. {title}. {journal}[[, {volume_issue}]][[, {pages_en}]]. [[{doi_url}]]',
      authorFormat: 'family_comma_initials',
      authorJoin: 'comma_amp',
      maxAuthors: 20,
      order: 'author',
    },
  },
  {
    id: 'short',
    label: 'Ngắn gọn: Tác giả (Năm). Tên bài. Nguồn.',
    config: {
      template: '{authors}[[ ({year})]]. {title}. {journal}.',
      authorFormat: 'family_initials',
      authorJoin: 'comma',
      maxAuthors: 3,
      order: 'table',
    },
  },
  {
    id: 'link',
    label: 'Có link: Tác giả. Tên bài. Nguồn, năm. Link DOI',
    config: {
      template: '[[[{index}] ]]{authors}. {title}. {journal}[[, {year}]]. [[{doi_url}]]',
      authorFormat: 'family_initials',
      authorJoin: 'comma',
      maxAuthors: 6,
      order: 'table',
    },
  },
];

export const DEFAULT_CUSTOM: CustomCitationConfig = CUSTOM_PRESETS[0]!.config;

// ---------- Tác giả ----------

function formatOne(author: Author, format: AuthorFormat): string {
  const p = parseAuthor(author);
  if (format === 'source') return author.name.trim() || p.family;
  if (p.whole || !p.given) return p.family;
  if (format === 'initials_family') return `${dottedInitials(p.given)} ${p.family}`;
  if (format === 'family_comma_initials') return `${p.family}, ${dottedInitials(p.given)}`;
  return `${p.family} ${initials(p.given)}`;
}

export function joinNames(names: string[], join: AuthorJoin): string {
  if (names.length <= 1) return names[0] ?? '';
  if (join === 'semicolon') return names.join('; ');
  if (join === 'comma_and') return names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  if (join === 'comma_amp') return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  return names.join(', ');
}

export function formatCustomAuthors(authors: Author[], title: string, config: CustomCitationConfig): string {
  const names = cleanAuthors(authors, title).map((a) => formatOne(a, config.authorFormat)).filter(Boolean);
  const max = Math.max(1, Math.floor(config.maxAuthors) || 1);
  if (names.length > max) return `${joinNames(names.slice(0, max), config.authorJoin === 'comma_and' || config.authorJoin === 'comma_amp' ? 'comma' : config.authorJoin)}${config.authorJoin === 'semicolon' ? ';' : ','} et al.`;
  return joinNames(names, config.authorJoin);
}

// ---------- Dựng chuỗi ----------

const trimTitle = (title: string) => title.trim().replace(/[.\s]+$/, '');
const enDash = (pages: string) => pages.replace(/-/g, '–');

function valuesFor(r: PaperRecord, config: CustomCitationConfig, index?: number): Record<string, string> {
  const authorsList = cleanAuthors(r.authors, r.title);
  const [firstPage = '', lastPage = ''] = (r.pages ?? '').split('-');
  const volume = r.volume ?? '';
  const issue = r.issue ?? '';
  return {
    authors: formatCustomAuthors(r.authors, r.title, config),
    first_author: authorsList[0] ? formatOne(authorsList[0], config.authorFormat) : '',
    title: trimTitle(r.title),
    journal: r.journal,
    volume,
    issue,
    volume_issue: volume ? `${volume}${issue ? `(${issue})` : ''}` : issue ? `(${issue})` : '',
    pages: r.pages ?? '',
    pages_en: enDash(r.pages ?? ''),
    first_page: firstPage,
    last_page: lastPage,
    year: r.publicationYear ? String(r.publicationYear) : '',
    doi: r.doi,
    doi_url: r.doi ? `https://doi.org/${r.doi}` : '',
    url: /^https?:\/\//i.test(r.originalUrl) ? r.originalUrl : '',
    publisher: r.publisher,
    place: r.place ?? '',
    type: r.documentType,
    retrieved: r.retrievedAt ? r.retrievedAt.slice(0, 10) : '',
    index: index === undefined ? '' : String(index),
  };
}

/** Dọn dấu câu thừa sinh ra khi một trường rỗng (", ,", ", .", "()", ...). */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)|“\s*”|"\s*"|\[\s*\]/g, '')
    // Số thứ tự ở đầu dòng ([4] hoặc 4. / 4)) mà phần ngay sau bị rỗng: bỏ dấu câu thừa ("[4] , Tên bài" -> "[4] Tên bài")
    .replace(/^(\[\d+\]|\d+[.)])\s*[,;:]+\s*/, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/,\s*\./g, '.')
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/^[\s,;:.]+/, '')
    .replace(/([“(\[])\s+/g, '$1')
    .trim();
}

/** Các `{tên}` trong mẫu mà ứng dụng không nhận ra (để cảnh báo người dùng gõ sai). */
export function unknownPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) if (!KNOWN_KEYS.has(m[1]!)) found.add(m[1]!);
  return [...found];
}

/** Dựng một tài liệu tham khảo từ mẫu tùy chỉnh. `index` (bắt đầu từ 1) dùng cho trường {index}. */
export function formatCustomReference(record: PaperRecord, config: CustomCitationConfig, index?: number): string {
  const values = valuesFor(record, config, index);
  const withGroups = config.template.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
    const keys = [...inner.matchAll(/\{([^{}]*)\}/g)].map((x) => x[1]!);
    return keys.some((k) => KNOWN_KEYS.has(k) && !values[k]) ? '' : inner;
  });
  const filled = withGroups.replace(/\{([^{}]*)\}/g, (m, key: string) => (KNOWN_KEYS.has(key) ? values[key]! : m));
  return tidy(filled);
}

/** Danh sách tham khảo theo mẫu tùy chỉnh (có sắp xếp nếu người dùng chọn). Mỗi bài một dòng. */
export function formatCustomList(records: PaperRecord[], config: CustomCitationConfig): string {
  let ordered = records;
  if (config.order === 'author') {
    const key = (r: PaperRecord) => {
      const first = cleanAuthors(r.authors, r.title)[0];
      return first ? fold(parseAuthor(first).family) : '￿'; // bài không có tác giả xếp cuối
    };
    ordered = [...records].sort((a, b) => key(a).localeCompare(key(b)) || (a.publicationYear ?? 0) - (b.publicationYear ?? 0));
  }
  return ordered.map((r, i) => formatCustomReference(r, config, ordered.length === 1 ? undefined : i + 1)).join('\n');
}

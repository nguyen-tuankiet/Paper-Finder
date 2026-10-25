import type { Author, ExportFormat, PaperRecord, SourceId } from '../../../shared/types';

export const SOURCE_LABELS: Record<SourceId, string> = {
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  europepmc: 'Europe PMC',
  doaj: 'DOAJ',
  arxiv: 'arXiv',
  semanticscholar: 'Semantic Scholar',
};

/** Mô tả ngắn thế mạnh của từng nguồn, hiển thị trong ô chọn nguồn. */
export const SOURCE_HINTS: Record<SourceId, string> = {
  crossref: 'Mọi bài có DOI, mọi lĩnh vực',
  openalex: 'Tổng hợp rộng, có cả bài không DOI',
  europepmc: 'Y sinh, sức khỏe, kèm preprint',
  doaj: 'Tạp chí truy cập mở',
  arxiv: 'Preprint vật lý, toán, tin học (ít bài có DOI)',
  semanticscholar: 'Khoa học máy tính, y sinh',
};

/** Nguồn bật sẵn khi chưa kết nối được máy chủ. */
export const DEFAULT_SOURCES: SourceId[] = ['crossref', 'openalex'];
export const NO_DATA = 'Chưa có dữ liệu';

export interface ResultFilters {
  text: string;
  doi: 'all' | 'with' | 'without';
  source: 'all' | SourceId | 'both';
  type: string;
}

export const DEFAULT_FILTERS: ResultFilters = { text: '', doi: 'all', source: 'all', type: '' };

/** Bỏ dấu + chữ thường để tìm kiếm tiếng Việt không phụ thuộc dấu. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function filterRecords(records: PaperRecord[], filters: ResultFilters): PaperRecord[] {
  const needle = fold(filters.text.trim());
  return records.filter((record) => {
    if (filters.doi === 'with' && !record.doi) return false;
    if (filters.doi === 'without' && record.doi) return false;
    if (filters.source === 'both' && record.sources.length < 2) return false;
    if (filters.source !== 'all' && filters.source !== 'both' && !record.sources.includes(filters.source)) return false;
    if (filters.type && record.documentType !== filters.type) return false;
    if (needle) {
      const haystack = fold(
        [record.title, record.doi, record.journal, record.publisher, record.authors.map((a) => a.name).join(' '), record.queryKeywords.join(' ')].join(' '),
      );
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

/** Sắp xếp theo năm; bài không có năm luôn nằm cuối dù tăng hay giảm. */
export function sortByYear(records: PaperRecord[], order: 'ascend' | 'descend' | null | undefined): PaperRecord[] {
  if (!order) return records;
  const sign = order === 'ascend' ? 1 : -1;
  return [...records].sort((a, b) => {
    if (a.publicationYear === null && b.publicationYear === null) return 0;
    if (a.publicationYear === null) return 1;
    if (b.publicationYear === null) return -1;
    return (a.publicationYear - b.publicationYear) * sign;
  });
}

export function doiUrl(doi: string): string {
  return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;
}

export function authorsShort(authors: Author[], max = 3): { shown: string; extra: number } {
  return { shown: authors.slice(0, max).map((a) => a.name).join(', '), extra: Math.max(0, authors.length - max) };
}

const TYPE_LABELS: Record<string, string> = {
  'journal-article': 'Bài báo tạp chí',
  article: 'Bài báo',
  'proceedings-article': 'Bài hội nghị',
  'conference-paper': 'Bài hội nghị',
  'posted-content': 'Preprint / posted content',
  preprint: 'Preprint',
  'book-chapter': 'Chương sách',
  book: 'Sách',
  review: 'Bài tổng quan',
  dissertation: 'Luận văn / luận án',
  dataset: 'Bộ dữ liệu',
  report: 'Báo cáo',
};

export function docTypeLabel(raw: string): string {
  return raw ? (TYPE_LABELS[raw] ?? raw) : NO_DATA;
}

export function localDateStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function exportFileName(format: ExportFormat, date: Date = new Date()): string {
  return `paperfinder_results_${localDateStamp(date)}.${format}`;
}

/** Chỉ gửi các trường cần thiết cho việc xuất file để giảm dung lượng request. */
export function toExportPayload(records: PaperRecord[]) {
  return records.map((r) => ({
    title: r.title,
    doi: r.doi,
    authors: r.authors.map((a) => ({ name: a.name })),
    publicationYear: r.publicationYear,
    journal: r.journal,
    publisher: r.publisher,
    documentType: r.documentType,
    abstract: r.abstract,
    sources: r.sources,
    originalUrl: r.originalUrl,
    queryKeywords: r.queryKeywords,
  }));
}

export function parseKeywords(text: string, multi: boolean): string[] {
  const parts = multi ? text.split(/\r?\n/) : [text];
  return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

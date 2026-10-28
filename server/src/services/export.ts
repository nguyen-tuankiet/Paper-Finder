import ExcelJS from 'exceljs';
import type { ExportFormat } from '../../../shared/types.js';
import { doiUrl } from '../lib/doi.js';
import { formatLicense } from '../lib/oa.js';

/** Dữ liệu tối thiểu cần cho việc xuất file (client gửi lại danh sách đã chọn/lọc). */
export interface ExportRecord {
  title: string;
  doi: string;
  authors: { name: string; given?: string; family?: string }[];
  publicationYear: number | null;
  journal: string;
  publisher: string;
  documentType: string;
  abstract: string;
  sources: string[];
  originalUrl: string;
  queryKeywords: string[];
  /** Thông tin truy cập mở (tùy chọn để tương thích với client cũ). */
  oaUrl?: string;
  oaPdfUrl?: string;
  oaLicense?: string;
  /** Thông tin thư mục (dùng cho BibTeX/RIS). */
  volume?: string;
  issue?: string;
  pages?: string;
  place?: string;
}

export const EXPORT_COLUMNS = [
  'STT',
  'Title',
  'DOI',
  'Authors',
  'Publication Year',
  'Journal',
  'Publisher',
  'Document Type',
  'Abstract',
  'Source',
  'Original URL',
  'Search Keyword',
  'Open Access URL',
  'License',
] as const;

const SOURCE_LABELS: Record<string, string> = {
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  europepmc: 'Europe PMC',
  doaj: 'DOAJ',
  arxiv: 'arXiv',
  semanticscholar: 'Semantic Scholar',
};
const EXCEL_CELL_LIMIT = 32000; // Excel giới hạn 32.767 ký tự mỗi ô
const EXCEL_HYPERLINK_LIMIT = 2000;

function sourceLabel(record: ExportRecord): string {
  return record.sources.map((s) => SOURCE_LABELS[s] ?? s).join('; ');
}

function authorsText(record: ExportRecord): string {
  return record.authors.map((a) => a.name).join('; ');
}

/** Giá trị của một dòng theo thứ tự EXPORT_COLUMNS. Ô không có dữ liệu để trống. */
function rowValues(record: ExportRecord, index: number): (string | number)[] {
  return [
    index + 1,
    record.title,
    record.doi,
    authorsText(record),
    record.publicationYear ?? '',
    record.journal,
    record.publisher,
    record.documentType,
    record.abstract,
    sourceLabel(record),
    record.originalUrl,
    record.queryKeywords.join('; '),
    openAccessUrl(record),
    record.oaLicense ? formatLicense(record.oaLicense) : '',
  ];
}

/** Link đọc miễn phí: ưu tiên PDF trực tiếp, nếu không có thì trang toàn văn. Rỗng nếu bài không có bản mở. */
function openAccessUrl(record: ExportRecord): string {
  return record.oaPdfUrl || record.oaUrl || '';
}

// ---------- CSV ----------

/**
 * Chống "CSV injection": ô văn bản bắt đầu bằng = + - @ (hoặc tab/CR) sẽ bị Excel hiểu là công thức,
 * nên thêm dấu nháy đơn phía trước để Excel coi là văn bản.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : neutralizeFormula(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(records: ExportRecord[]): Buffer {
  const lines = [EXPORT_COLUMNS.map(csvCell).join(',')];
  records.forEach((record, index) => lines.push(rowValues(record, index).map(csvCell).join(',')));
  // BOM UTF-8 để Excel hiển thị đúng tiếng Việt.
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

// ---------- XLSX ----------

function truncate(value: string): string {
  return value.length > EXCEL_CELL_LIMIT ? value.slice(0, EXCEL_CELL_LIMIT - 1) + '…' : value;
}

const LINK_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF0563C1' }, underline: true };

export async function toXlsx(records: ExportRecord[], generatedAt: Date = new Date()): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PaperFinder';
  workbook.created = generatedAt;

  const sheet = workbook.addWorksheet('PaperFinder', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: EXPORT_COLUMNS[0], width: 6 },
    { header: EXPORT_COLUMNS[1], width: 60 },
    { header: EXPORT_COLUMNS[2], width: 30 },
    { header: EXPORT_COLUMNS[3], width: 40 },
    { header: EXPORT_COLUMNS[4], width: 10 },
    { header: EXPORT_COLUMNS[5], width: 36 },
    { header: EXPORT_COLUMNS[6], width: 24 },
    { header: EXPORT_COLUMNS[7], width: 18 },
    { header: EXPORT_COLUMNS[8], width: 70 },
    { header: EXPORT_COLUMNS[9], width: 18 },
    { header: EXPORT_COLUMNS[10], width: 40 },
    { header: EXPORT_COLUMNS[11], width: 30 },
    { header: EXPORT_COLUMNS[12], width: 40 },
    { header: EXPORT_COLUMNS[13], width: 14 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 22;

  records.forEach((record, index) => {
    const values = rowValues(record, index);
    // Chuỗi thêm vào ô luôn là kiểu văn bản (shared string), không bao giờ là công thức.
    const row = sheet.addRow(values.map((v) => (typeof v === 'string' ? truncate(v) : v)));
    row.alignment = { vertical: 'top' };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };

    if (record.doi) {
      const cell = row.getCell(3);
      cell.value = { text: record.doi, hyperlink: doiUrl(record.doi) };
      cell.font = LINK_FONT;
    }
    for (const [column, url] of [[11, record.originalUrl], [13, openAccessUrl(record)]] as const) {
      if (/^https?:\/\//i.test(url) && url.length <= EXCEL_HYPERLINK_LIMIT) {
        const cell = row.getCell(column);
        cell.value = { text: url, hyperlink: url };
        cell.font = LINK_FONT;
      }
    }
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };

  const notes = workbook.addWorksheet('Ghi chú');
  notes.columns = [{ width: 28 }, { width: 80 }];
  notes.addRows([
    ['Công cụ', 'PaperFinder'],
    ['Thời điểm xuất', generatedAt.toISOString()],
    ['Số bài báo', records.length],
    ['Nguồn dữ liệu', 'Metadata công khai từ Crossref, OpenAlex, Europe PMC, DOAJ, arXiv, Semantic Scholar (tùy nguồn đã chọn)'],
    ['Lưu ý', 'Kết quả không bao phủ toàn bộ tài liệu khoa học; metadata (đặc biệt abstract) có thể thiếu hoặc không đầy đủ.'],
  ]);
  notes.getColumn(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ---------- BibTeX và RIS (gói Pro) ----------

const BIBTEX_SPECIALS = /[&%#_$]/g;

/** Làm sạch giá trị đặt trong cặp ngoặc nhọn của BibTeX: bỏ ngoặc nhọn (làm hỏng cấu trúc), thoát các ký tự đặc biệt của LaTeX. */
function bibValue(value: string): string {
  return value.replace(/[{}]/g, '').replace(/\\/g, '').replace(BIBTEX_SPECIALS, (c) => `\\${c}`).replace(/\s+/g, ' ').trim();
}

function authorParts(author: ExportRecord['authors'][number]): { family: string; given: string } {
  if (author.family) return { family: author.family, given: author.given ?? '' };
  const name = author.name.trim();
  if (name.includes(',')) {
    const [family = '', ...rest] = name.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }
  // Nguồn cung cấp tên theo thứ tự "Tên Họ": lấy từ cuối làm họ.
  const words = name.split(/\s+/);
  if (words.length < 2) return { family: name, given: '' };
  return { family: words[words.length - 1]!, given: words.slice(0, -1).join(' ') };
}

const asciiWord = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]/g, '');

type BibType = 'article' | 'inproceedings' | 'book' | 'incollection' | 'phdthesis' | 'techreport' | 'misc';

function bibType(record: ExportRecord): BibType {
  const t = record.documentType.toLowerCase();
  if (/proceedings|conference/.test(t)) return 'inproceedings';
  if (/book-chapter|chapter/.test(t)) return 'incollection';
  if (/^book|monograph/.test(t)) return 'book';
  if (/thesis|dissertation/.test(t)) return 'phdthesis';
  if (/report/.test(t)) return 'techreport';
  if (/preprint|posted-content/.test(t)) return 'misc';
  return record.journal ? 'article' : 'misc';
}

function citeKeys(records: ExportRecord[]): string[] {
  const used = new Map<string, number>();
  return records.map((record) => {
    const first = record.authors[0] ? authorParts(record.authors[0]).family : 'paper';
    const word = asciiWord(record.title.split(/\s+/).find((w) => asciiWord(w).length > 3) ?? '');
    const base = `${asciiWord(first) || 'paper'}${record.publicationYear ?? ''}${word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''}`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    return count === 1 ? base : `${base}${String.fromCharCode(96 + Math.min(count, 26))}`;
  });
}

export function toBibtex(records: ExportRecord[]): Buffer {
  const keys = citeKeys(records);
  const entries = records.map((record, index) => {
    const type = bibType(record);
    const fields: [string, string][] = [];
    const add = (name: string, value: string | undefined | null) => {
      const clean = value ? bibValue(value) : '';
      if (clean) fields.push([name, clean]);
    };
    const authors = record.authors.map((a) => authorParts(a)).filter((a) => a.family);
    add('author', authors.map((a) => (a.given ? `${a.family}, ${a.given}` : a.family)).join(' and '));
    add('title', record.title);
    if (type === 'article') add('journal', record.journal);
    else if (type === 'inproceedings' || type === 'incollection') add('booktitle', record.journal);
    else add('howpublished', record.journal);
    add('year', record.publicationYear === null ? '' : String(record.publicationYear));
    add('volume', record.volume);
    add('number', record.issue);
    add('pages', record.pages?.replace(/[-–—]+/g, '--'));
    add('publisher', record.publisher);
    if (type === 'inproceedings' || type === 'book' || type === 'incollection') add('address', record.place);
    add('doi', record.doi);
    add('url', record.doi ? '' : record.originalUrl);
    add('abstract', record.abstract);
    const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(',\n');
    return `@${type}{${keys[index]},\n${body}\n}`;
  });
  return Buffer.from(entries.join('\n\n') + '\n', 'utf8');
}

function risType(record: ExportRecord): string {
  return { article: 'JOUR', inproceedings: 'CPAPER', book: 'BOOK', incollection: 'CHAP', phdthesis: 'THES', techreport: 'RPRT', misc: 'GEN' }[bibType(record)];
}

export function toRis(records: ExportRecord[]): Buffer {
  const lines: string[] = [];
  for (const record of records) {
    const add = (tag: string, value: string | undefined | null) => {
      const clean = value ? value.replace(/\s+/g, ' ').trim() : '';
      if (clean) lines.push(`${tag}  - ${clean}`);
    };
    add('TY', risType(record));
    for (const author of record.authors) {
      const { family, given } = authorParts(author);
      if (family) add('AU', given ? `${family}, ${given}` : family);
    }
    add('TI', record.title);
    add('T2', record.journal);
    add('PY', record.publicationYear === null ? '' : String(record.publicationYear));
    add('VL', record.volume);
    add('IS', record.issue);
    const [start, end] = (record.pages ?? '').split(/[-–—]+/).map((p) => p.trim());
    add('SP', start);
    add('EP', end);
    add('PB', record.publisher);
    add('CY', record.place);
    add('DO', record.doi);
    add('UR', record.doi ? doiUrl(record.doi) : record.originalUrl);
    add('AB', record.abstract);
    lines.push('ER  - ', '');
  }
  return Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
}

const EXTENSIONS: Record<ExportFormat, string> = { csv: 'csv', xlsx: 'xlsx', bibtex: 'bib', ris: 'ris' };

export function exportFilename(format: ExportFormat, date: Date = new Date()): string {
  return `paperfinder_results_${date.toISOString().slice(0, 10)}.${EXTENSIONS[format]}`;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bibtex: 'application/x-bibtex; charset=utf-8',
  ris: 'application/x-research-info-systems; charset=utf-8',
};

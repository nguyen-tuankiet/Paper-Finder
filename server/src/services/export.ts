import ExcelJS from 'exceljs';
import type { ExportFormat } from '../../../shared/types.js';
import { doiUrl } from '../lib/doi.js';

/** Dữ liệu tối thiểu cần cho việc xuất file (client gửi lại danh sách đã chọn/lọc). */
export interface ExportRecord {
  title: string;
  doi: string;
  authors: { name: string }[];
  publicationYear: number | null;
  journal: string;
  publisher: string;
  documentType: string;
  abstract: string;
  sources: string[];
  originalUrl: string;
  queryKeywords: string[];
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
  ];
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
    if (/^https?:\/\//i.test(record.originalUrl) && record.originalUrl.length <= EXCEL_HYPERLINK_LIMIT) {
      const cell = row.getCell(11);
      cell.value = { text: record.originalUrl, hyperlink: record.originalUrl };
      cell.font = LINK_FONT;
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

export function exportFilename(format: ExportFormat, date: Date = new Date()): string {
  return `paperfinder_results_${date.toISOString().slice(0, 10)}.${format}`;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

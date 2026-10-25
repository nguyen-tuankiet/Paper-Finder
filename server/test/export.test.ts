import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS, exportFilename, neutralizeFormula, toCsv, toXlsx, type ExportRecord } from '../src/services/export.js';

function exportRecord(n: number, extra: Partial<ExportRecord> = {}): ExportRecord {
  return {
    title: `Bài báo số ${n}`,
    doi: `10.1000/test.${n}`,
    authors: [{ name: 'Nguyễn Văn An' }, { name: 'Trần Thị Bình' }],
    publicationYear: 2024,
    journal: 'Tạp chí Khoa học',
    publisher: 'NXB Giáo dục',
    documentType: 'journal-article',
    abstract: 'Tóm tắt có dấu tiếng Việt: đ, ư, ơ.',
    sources: ['crossref', 'openalex'],
    originalUrl: `https://doi.org/10.1000/test.${n}`,
    queryKeywords: ['trí tuệ nhân tạo', 'machine learning'],
    ...extra,
  };
}

/** Phân tích CSV tối giản (hỗ trợ dấu ngoặc kép, xuống dòng trong ô) để kiểm tra round-trip. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  return rows;
}

describe('CSV', () => {
  it('có BOM UTF-8 và đúng cột theo yêu cầu', () => {
    const buffer = toCsv([exportRecord(1)]);
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const rows = parseCsv(buffer.toString('utf8').slice(1));
    expect(rows[0]).toEqual([...EXPORT_COLUMNS]);
    expect(rows[0]).toEqual(['STT', 'Title', 'DOI', 'Authors', 'Publication Year', 'Journal', 'Publisher', 'Document Type', 'Abstract', 'Source', 'Original URL', 'Search Keyword']);
  });

  it('giữ nguyên ký tự tiếng Việt, tác giả/nguồn/từ khóa phân cách bằng dấu chấm phẩy', () => {
    const rows = parseCsv(toCsv([exportRecord(1)]).toString('utf8').slice(1));
    expect(rows[1]).toEqual([
      '1',
      'Bài báo số 1',
      '10.1000/test.1',
      'Nguyễn Văn An; Trần Thị Bình',
      '2024',
      'Tạp chí Khoa học',
      'NXB Giáo dục',
      'journal-article',
      'Tóm tắt có dấu tiếng Việt: đ, ư, ơ.',
      'Crossref; OpenAlex',
      'https://doi.org/10.1000/test.1',
      'trí tuệ nhân tạo; machine learning',
    ]);
  });

  it('xử lý tiêu đề chứa dấu phẩy, ngoặc kép, xuống dòng', () => {
    const title = 'He said "AI, ML"\nand more; <b>bold</b> & co';
    const rows = parseCsv(toCsv([exportRecord(1, { title })]).toString('utf8').slice(1));
    expect(rows).toHaveLength(2); // header + 1 dòng dữ liệu (xuống dòng trong ô không tách thành dòng mới)
    expect(rows[1]![1]).toBe(title);
  });

  it('chống CSV injection: ô bắt đầu bằng = + - @ được vô hiệu hóa', () => {
    expect(neutralizeFormula('=HYPERLINK("http://evil")')).toBe(`'=HYPERLINK("http://evil")`);
    for (const lead of ['+', '-', '@', '\t', '\r']) expect(neutralizeFormula(`${lead}x`)).toBe(`'${lead}x`);
    expect(neutralizeFormula('Bình thường')).toBe('Bình thường');
    const rows = parseCsv(toCsv([exportRecord(1, { title: '=cmd|calc' })]).toString('utf8').slice(1));
    expect(rows[1]![1]).toBe("'=cmd|calc");
  });

  it('trường thiếu để trống, không in "null" hay "undefined"', () => {
    const rows = parseCsv(toCsv([exportRecord(1, { doi: '', publicationYear: null, authors: [], journal: '' })]).toString('utf8').slice(1));
    expect(rows[1]![2]).toBe('');
    expect(rows[1]![3]).toBe('');
    expect(rows[1]![4]).toBe('');
    expect(rows[1]!.join('|')).not.toMatch(/null|undefined/);
  });

  it('xuất đầy đủ mọi dòng (không chỉ một trang)', () => {
    const records = Array.from({ length: 1234 }, (_, i) => exportRecord(i + 1));
    const rows = parseCsv(toCsv(records).toString('utf8').slice(1));
    expect(rows.length - 1).toBe(1234); // trừ dòng tiêu đề
    expect(rows[1234]![0]).toBe('1234');
  });
});

describe('XLSX', () => {
  async function load(buffer: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    return workbook;
  }

  it('có tiêu đề cột, dữ liệu tiếng Việt và hyperlink cho DOI/URL', async () => {
    const workbook = await load(await toXlsx([exportRecord(1)]));
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).values).toEqual([undefined, ...EXPORT_COLUMNS]);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getCell('B2').value).toBe('Bài báo số 1');
    expect(sheet.getCell('D2').value).toBe('Nguyễn Văn An; Trần Thị Bình');
    expect(sheet.getCell('E2').value).toBe(2024);
    expect(sheet.getCell('I2').value).toBe('Tóm tắt có dấu tiếng Việt: đ, ư, ơ.');
    expect(sheet.getCell('C2').value).toMatchObject({ text: '10.1000/test.1', hyperlink: 'https://doi.org/10.1000/test.1' });
    expect(sheet.getCell('K2').value).toMatchObject({ hyperlink: 'https://doi.org/10.1000/test.1' });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });

  it('ô bắt đầu bằng "=" được lưu là văn bản, không phải công thức', async () => {
    const workbook = await load(await toXlsx([exportRecord(1, { title: '=SUM(1+1)', abstract: '+cmd|calc', journal: '@evil' })]));
    const sheet = workbook.worksheets[0]!;
    for (const address of ['B2', 'I2', 'F2']) {
      const cell = sheet.getCell(address);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
      expect(typeof cell.value).toBe('string');
    }
    expect(sheet.getCell('B2').value).toBe('=SUM(1+1)');
  });

  it('xuất đủ số dòng; bài không DOI/URL vẫn xuất bình thường', async () => {
    const records = [
      ...Array.from({ length: 700 }, (_, i) => exportRecord(i + 1)),
      exportRecord(701, { doi: '', originalUrl: '', publicationYear: null }),
    ];
    const sheet = (await load(await toXlsx(records))).worksheets[0]!;
    expect(sheet.rowCount).toBe(702);
    expect(sheet.getCell('A702').value).toBe(701);
    expect(sheet.getCell('C702').value ?? '').toBe('');
  });

  it('cắt abstract vượt giới hạn 32.767 ký tự của Excel thay vì làm hỏng file', async () => {
    const sheet = (await load(await toXlsx([exportRecord(1, { abstract: 'x'.repeat(40000) })]))).worksheets[0]!;
    expect(String(sheet.getCell('I2').value).length).toBeLessThanOrEqual(32767);
  });

  it('có sheet ghi chú về giới hạn dữ liệu', async () => {
    const workbook = await load(await toXlsx([exportRecord(1)]));
    expect(workbook.worksheets[1]!.name).toBe('Ghi chú');
  });
});

describe('exportFilename', () => {
  it('đặt tên dễ hiểu theo ngày', () => {
    expect(exportFilename('xlsx', new Date('2026-10-25T10:00:00Z'))).toBe('paperfinder_results_2026-10-25.xlsx');
    expect(exportFilename('csv', new Date('2026-10-25T10:00:00Z'))).toBe('paperfinder_results_2026-10-25.csv');
  });
});

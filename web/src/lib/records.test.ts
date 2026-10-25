import { describe, expect, it } from 'vitest';
import type { PaperRecord } from '../../../shared/types';
import { DEFAULT_FILTERS, authorsShort, docTypeLabel, exportFileName, filterRecords, parseKeywords, sortByYear, toExportPayload } from './records';

function rec(overrides: Partial<PaperRecord>): PaperRecord {
  return {
    id: overrides.id ?? Math.random().toString(),
    title: 'Tiêu đề',
    doi: '',
    authors: [],
    publicationYear: null,
    journal: '',
    publisher: '',
    documentType: '',
    isPreprint: false,
    abstract: '',
    sources: ['crossref'],
    sourceRefs: [],
    originalUrl: '',
    queryKeywords: [],
    retrievedAt: '',
    ...overrides,
  };
}

const data = [
  rec({ id: 'a', title: 'Trí tuệ nhân tạo trong giáo dục', doi: '10.1/a', publicationYear: 2020, sources: ['crossref', 'openalex'], documentType: 'journal-article' }),
  rec({ id: 'b', title: 'Machine learning in healthcare', publicationYear: 2023, sources: ['openalex'], documentType: 'preprint' }),
  rec({ id: 'c', title: 'Crop disease', doi: '10.1/c', publicationYear: null, authors: [{ name: 'Nguyễn Văn An' }] }),
];

describe('filterRecords', () => {
  it('không lọc -> giữ nguyên', () => {
    expect(filterRecords(data, DEFAULT_FILTERS)).toHaveLength(3);
  });
  it('tìm không phân biệt dấu tiếng Việt', () => {
    expect(filterRecords(data, { ...DEFAULT_FILTERS, text: 'tri tue nhan tao' }).map((r) => r.id)).toEqual(['a']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, text: 'nguyen van an' }).map((r) => r.id)).toEqual(['c']);
  });
  it('lọc theo DOI, nguồn, loại tài liệu', () => {
    expect(filterRecords(data, { ...DEFAULT_FILTERS, doi: 'with' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, doi: 'without' }).map((r) => r.id)).toEqual(['b']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, source: 'openalex' }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, source: 'both' }).map((r) => r.id)).toEqual(['a']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, type: 'preprint' }).map((r) => r.id)).toEqual(['b']);
  });
});

describe('sortByYear', () => {
  it('bài không có năm luôn ở cuối', () => {
    expect(sortByYear(data, 'ascend').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sortByYear(data, 'descend').map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortByYear(data, null)).toBe(data);
  });
});

describe('tiện ích', () => {
  it('authorsShort', () => {
    expect(authorsShort([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }])).toEqual({ shown: 'A, B, C', extra: 1 });
  });
  it('docTypeLabel', () => {
    expect(docTypeLabel('')).toBe('Chưa có dữ liệu');
    expect(docTypeLabel('journal-article')).toBe('Bài báo tạp chí');
    expect(docTypeLabel('weird-type')).toBe('weird-type');
  });
  it('parseKeywords', () => {
    expect(parseKeywords('  a  b \n\n c ', true)).toEqual(['a b', 'c']);
    expect(parseKeywords('a\nb', false)).toEqual(['a b']);
  });
  it('exportFileName dùng ngày địa phương', () => {
    expect(exportFileName('xlsx', new Date(2026, 9, 5))).toBe('paperfinder_results_2026-10-05.xlsx');
  });
  it('toExportPayload chỉ giữ trường cần thiết', () => {
    const [item] = toExportPayload([data[2]!]);
    expect(Object.keys(item!)).not.toContain('sourceRefs');
    expect(item!.authors).toEqual([{ name: 'Nguyễn Văn An' }]);
  });
});

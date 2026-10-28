import { describe, expect, it } from 'vitest';
import type { PaperRecord } from '../../../shared/types';
import { DEFAULT_FILTERS, docxFileName, filterRecords, sortByCitations, toExportPayload } from './records';

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
    isOpenAccess: false,
    oaStatus: '',
    oaUrl: '',
    oaPdfUrl: '',
    oaLicense: '',
    sources: ['crossref'],
    sourceRefs: [],
    originalUrl: '',
    queryKeywords: [],
    retrievedAt: '',
    ...overrides,
  };
}

const data = [
  rec({ id: 'a', citedByCount: 120, journalQuartile: 'Q1' }),
  rec({ id: 'b', citedByCount: 3, journalQuartile: 'Q2', isRetracted: true }),
  rec({ id: 'c', journalQuartile: 'Q3' }),
  rec({ id: 'd', citedByCount: 0 }),
  rec({ id: 'e', citedByCount: 45, journalQuartile: 'Q1' }),
];

describe('sắp xếp theo số trích dẫn', () => {
  it('giảm dần và tăng dần, bài không có số liệu luôn cuối', () => {
    expect(sortByCitations(data, 'descend').map((r) => r.id)).toEqual(['a', 'e', 'b', 'd', 'c']);
    expect(sortByCitations(data, 'ascend').map((r) => r.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
    expect(sortByCitations(data, null)).toBe(data);
  });

  it('không làm đổi mảng gốc', () => {
    const copy = data.map((r) => r.id);
    sortByCitations(data, 'descend');
    expect(data.map((r) => r.id)).toEqual(copy);
  });
});

describe('lọc theo trích dẫn, hạng tạp chí, bài rút lại', () => {
  it('trích dẫn tối thiểu: bài không có số liệu tính là 0', () => {
    expect(filterRecords(data, { ...DEFAULT_FILTERS, minCited: 40 }).map((r) => r.id)).toEqual(['a', 'e']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, minCited: 0 })).toHaveLength(5);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, minCited: 1 }).map((r) => r.id)).toEqual(['a', 'b', 'e']);
  });

  it('hạng tạp chí: chỉ Q1, hoặc Q1–Q2', () => {
    expect(filterRecords(data, { ...DEFAULT_FILTERS, quartile: 'q1' }).map((r) => r.id)).toEqual(['a', 'e']);
    expect(filterRecords(data, { ...DEFAULT_FILTERS, quartile: 'q12' }).map((r) => r.id)).toEqual(['a', 'b', 'e']);
  });

  it('ẩn bài đã rút lại', () => {
    expect(filterRecords(data, { ...DEFAULT_FILTERS, hideRetracted: true }).map((r) => r.id)).toEqual(['a', 'c', 'd', 'e']);
  });

  it('các bộ lọc kết hợp với nhau', () => {
    expect(filterRecords(data, { ...DEFAULT_FILTERS, quartile: 'q12', minCited: 10, hideRetracted: true }).map((r) => r.id)).toEqual(['a', 'e']);
  });

  it('mặc định không lọc gì', () => {
    expect(filterRecords(data, DEFAULT_FILTERS)).toHaveLength(5);
    expect(DEFAULT_FILTERS).toMatchObject({ minCited: null, quartile: 'all', hideRetracted: false });
  });
});

describe('dữ liệu gửi khi xuất file', () => {
  it('mang theo số trích dẫn, trạng thái rút lại và hạng tạp chí khi có', () => {
    const [a, c] = toExportPayload([data[1]!, rec({ id: 'x' })]);
    expect(a).toMatchObject({ citedByCount: 3, isRetracted: true, journalQuartile: 'Q2' });
    expect(c!.citedByCount).toBeUndefined();
    expect(c!.isRetracted).toBeUndefined();
  });

  it('tên file Word theo ngày địa phương', () => {
    expect(docxFileName(new Date(2026, 9, 5))).toBe('paperfinder_tai_lieu_tham_khao_2026-10-05.docx');
  });
});

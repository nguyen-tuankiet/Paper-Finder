import { describe, expect, it } from 'vitest';
import { dedupeRecords, mergeRecords } from '../src/services/dedupe.js';
import { author, makeRecord } from './helpers.js';

describe('dedupeRecords - theo DOI', () => {
  it('gộp bản ghi cùng DOI từ nhiều nguồn/từ khóa và giữ mọi nguồn', () => {
    const a = makeRecord({
      title: 'Same paper',
      doi: '10.1000/abc',
      sources: ['crossref'],
      queryKeywords: ['ai'],
      sourceRefs: [{ source: 'crossref', sourceId: '10.1000/abc', url: 'https://doi.org/10.1000/abc' }],
    });
    const b = makeRecord({
      title: 'Same paper',
      doi: '10.1000/abc',
      sources: ['openalex'],
      queryKeywords: ['machine learning'],
      sourceRefs: [{ source: 'openalex', sourceId: 'https://openalex.org/W1', url: 'https://openalex.org/W1' }],
    });
    const result = dedupeRecords([a, b, { ...a }]);
    expect(result.records).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(2);
    expect(result.records[0]).toMatchObject({
      id: 'doi:10.1000/abc',
      sources: ['crossref', 'openalex'],
      queryKeywords: ['ai', 'machine learning'],
    });
    expect(result.records[0]!.sourceRefs).toHaveLength(2);
  });

  it('không ghi đè dữ liệu hợp lệ bằng dữ liệu rỗng, và điền vào ô còn trống', () => {
    const full = makeRecord({
      doi: '10.1000/abc',
      title: 'Full record',
      authors: [author('An Nguyen')],
      publicationYear: 2022,
      journal: 'Journal A',
      publisher: 'Pub A',
      documentType: 'journal-article',
      originalUrl: 'https://a.example',
    });
    const sparse = makeRecord({ doi: '10.1000/abc', title: 'Full record', sources: ['openalex'], abstract: 'An abstract from OpenAlex.' });
    const [merged] = dedupeRecords([sparse, full]).records;
    expect(merged).toMatchObject({
      authors: [author('An Nguyen')],
      publicationYear: 2022,
      journal: 'Journal A',
      publisher: 'Pub A',
      abstract: 'An abstract from OpenAlex.',
    });
    // chiều ngược lại cũng không làm mất dữ liệu
    expect(mergeRecords([full, sparse]).journal).toBe('Journal A');
  });

  it('abstract: giữ bản dài hơn', () => {
    const a = makeRecord({ doi: '10.1000/abc', abstract: 'short' });
    const b = makeRecord({ doi: '10.1000/abc', abstract: 'a much longer abstract text' });
    expect(mergeRecords([a, b]).abstract).toBe('a much longer abstract text');
  });

  it('hai DOI khác nhau không bao giờ bị gộp, dù tiêu đề giống hệt - chỉ cảnh báo nghi trùng', () => {
    const preprint = makeRecord({ title: 'A very specific long research title', doi: '10.1101/2020.01.01.111', isPreprint: true, publicationYear: 2020 });
    const published = makeRecord({ title: 'A very specific long research title', doi: '10.1000/journal.2021', publicationYear: 2021 });
    const result = dedupeRecords([preprint, published]);
    expect(result.records).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.suspectedDuplicates).toHaveLength(1);
    expect(result.suspectedDuplicates[0]!.reason).toContain('DOI khác nhau');
    expect(result.suspectedDuplicates[0]!.recordIds).toEqual(['doi:10.1101/2020.01.01.111', 'doi:10.1000/journal.2021']);
  });
});

describe('dedupeRecords - không có DOI', () => {
  const noDoi = (overrides = {}) =>
    makeRecord({ title: 'Machine learning methods for soil moisture prediction', sources: ['openalex'], ...overrides });

  it('gộp khi tiêu đề (đã chuẩn hóa) + năm + tác giả đầu khớp', () => {
    const a = noDoi({ title: 'Machine Learning Methods for Soil-Moisture Prediction!', publicationYear: 2022, authors: [author('Lan Pham')] });
    const b = noDoi({ publicationYear: 2022, authors: [author('Pham Lan', 'Pham')], sources: ['crossref'] });
    const result = dedupeRecords([a, b]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.sources).toEqual(['openalex', 'crossref']);
  });

  it('bản ghi không DOI được gộp vào đúng một bản có DOI khi đủ bằng chứng, và nhận DOI đó', () => {
    const withDoi = noDoi({ doi: '10.1000/soil', publicationYear: 2022, authors: [author('Lan Pham')], sources: ['crossref'] });
    const withoutDoi = noDoi({ publicationYear: 2022, authors: [author('Lan Pham')] });
    const result = dedupeRecords([withoutDoi, withDoi]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ doi: '10.1000/soil', id: 'doi:10.1000/soil' });
  });

  it('chấp nhận chênh 1 năm (bản online/in) nếu tác giả khớp', () => {
    const a = noDoi({ publicationYear: 2022, authors: [author('Lan Pham')] });
    const b = noDoi({ publicationYear: 2023, authors: [author('Lan Pham')] });
    expect(dedupeRecords([a, b]).records).toHaveLength(1);
  });

  it('chỉ giống tiêu đề, thiếu cả năm và tác giả -> KHÔNG gộp, báo nghi trùng', () => {
    const result = dedupeRecords([noDoi(), noDoi({ sources: ['crossref'] })]);
    expect(result.records).toHaveLength(2);
    expect(result.suspectedDuplicates).toHaveLength(1);
    expect(result.suspectedDuplicates[0]!.reason).toContain('thiếu năm hoặc tác giả');
  });

  it('cùng tiêu đề, khác tác giả hoàn toàn -> là hai tác phẩm khác nhau: không gộp và không báo nghi trùng', () => {
    const a = noDoi({ publicationYear: 2010, authors: [author('Lan Pham')] });
    const b = noDoi({ publicationYear: 2022, authors: [author('John Smith')] });
    const result = dedupeRecords([a, b]);
    expect(result.records).toHaveLength(2);
    expect(result.suspectedDuplicates).toHaveLength(0);
  });

  it('cùng tiêu đề và cùng tác giả nhưng năm cách xa -> không gộp, báo nghi trùng', () => {
    const a = noDoi({ publicationYear: 2010, authors: [author('Lan Pham')] });
    const b = noDoi({ publicationYear: 2022, authors: [author('Lan Pham')] });
    const result = dedupeRecords([a, b]);
    expect(result.records).toHaveLength(2);
    expect(result.suspectedDuplicates).toHaveLength(1);
    expect(result.suspectedDuplicates[0]!.reason).toContain('năm xuất bản khác nhau');
  });

  it('khác DOI, tiêu đề chung chung nhưng tác giả khác nhau -> không báo nghi trùng', () => {
    const title = 'Machine learning in healthcare';
    const a = makeRecord({ title, doi: '10.1201/a', authors: [author('Shruti Dambhare')] });
    const b = makeRecord({ title, doi: '10.1201/b', authors: [author('Hafsa Habehh')] });
    const result = dedupeRecords([a, b]);
    expect(result.records).toHaveLength(2);
    expect(result.suspectedDuplicates).toHaveLength(0);
  });

  it('tiêu đề chỉ gần giống (không trùng khớp) -> không gộp và cũng không báo', () => {
    const a = noDoi({ title: 'Machine learning methods for soil moisture prediction', publicationYear: 2022, authors: [author('Lan Pham')] });
    const b = noDoi({ title: 'Machine learning methods for soil moisture estimation', publicationYear: 2022, authors: [author('Lan Pham')] });
    const result = dedupeRecords([a, b]);
    expect(result.records).toHaveLength(2);
    expect(result.suspectedDuplicates).toHaveLength(0);
  });

  it('tiêu đề quá ngắn không dùng làm bằng chứng gộp', () => {
    const a = makeRecord({ title: 'Editorial', publicationYear: 2022, authors: [author('Lan Pham')] });
    const b = makeRecord({ title: 'Editorial', publicationYear: 2022, authors: [author('Lan Pham')] });
    expect(dedupeRecords([a, b]).records).toHaveLength(2);
  });

  it('bản ghi không DOI khớp nhiều bản có DOI -> không đoán, giữ riêng', () => {
    const title = 'Machine learning methods for soil moisture prediction';
    const d1 = makeRecord({ title, doi: '10.1000/one', publicationYear: 2022, authors: [author('Lan Pham')] });
    const d2 = makeRecord({ title, doi: '10.1000/two', publicationYear: 2022, authors: [author('Lan Pham')] });
    const orphan = makeRecord({ title, publicationYear: 2022, authors: [author('Lan Pham')] });
    const result = dedupeRecords([d1, d2, orphan]);
    expect(result.records).toHaveLength(3);
  });

  it('tiêu đề tiếng Việt có/không dấu vẫn được nhận diện cùng bài khi đủ bằng chứng', () => {
    const a = makeRecord({ title: 'Ứng dụng trí tuệ nhân tạo trong giáo dục đại học', publicationYear: 2023, authors: [author('Anh Nguyễn', 'Nguyễn')] });
    const b = makeRecord({ title: 'Ung dung tri tue nhan tao trong giao duc dai hoc', publicationYear: 2023, authors: [author('Anh Nguyen', 'Nguyen')] });
    expect(dedupeRecords([a, b]).records).toHaveLength(1);
  });

  it('gán id duy nhất cho các bản ghi không DOI', () => {
    const records = dedupeRecords([makeRecord({ title: 'Alpha beta gamma delta' }), makeRecord({ title: 'Epsilon zeta eta theta' })]).records;
    expect(new Set(records.map((r) => r.id)).size).toBe(2);
  });
});

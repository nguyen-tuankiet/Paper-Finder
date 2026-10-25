import type { PaperRecord } from '../../../shared/types.js';

/** Gom bản ghi của một lần truy vấn: giới hạn số lượng, bỏ bài lặp DOI, bỏ bài không DOI nếu được yêu cầu. */
export class Collector {
  readonly records: PaperRecord[] = [];
  private readonly seenDois = new Set<string>();

  constructor(
    private readonly max: number,
    private readonly onlyWithDoi: boolean,
  ) {}

  get full(): boolean {
    return this.records.length >= this.max;
  }

  add(record: PaperRecord | null): boolean {
    if (!record || this.full) return false;
    if (!record.doi && this.onlyWithDoi) return false;
    if (record.doi) {
      if (this.seenDois.has(record.doi)) return false;
      this.seenDois.add(record.doi);
    }
    this.records.push(record);
    return true;
  }
}

/** Bỏ các ký tự điều khiển cú pháp truy vấn (Lucene) để từ khóa người dùng không gây lỗi cú pháp ở nguồn. */
export function plainQuery(keyword: string): string {
  return keyword
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Giá trị văn bản của một nút XML đã parse (chuỗi, số hoặc object có #text). */
export function xmlText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return xmlText((value as Record<string, unknown>)['#text']);
  return '';
}

export function toYear(value: unknown): number | null {
  const year = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value.slice(0, 4), 10) : NaN;
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null;
}

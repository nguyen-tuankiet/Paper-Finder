import type { PaperRecord } from '../../../shared/types.js';

/** ISSN dạng "1234-5678" / "12345678" / "1234567x" -> "12345678" / "1234567X"; null nếu sai định dạng. */
export function normalizeIssn(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const compact = value.replace(/[\s-]/g, '').toUpperCase();
  return /^\d{7}[\dX]$/.test(compact) ? compact : null;
}

export interface SignalInput {
  /** Số lần được trích dẫn do nguồn báo. */
  citedBy?: unknown;
  /** Nguồn có cho biết bài đã bị rút lại không. */
  retracted?: unknown;
  /** Một ISSN hoặc danh sách ISSN của tạp chí. */
  issns?: unknown;
}

/**
 * Các tín hiệu bổ sung của một bài (số trích dẫn, đã rút lại, ISSN) ở dạng sẵn để rải vào bản ghi.
 * Chỉ trả các trường có giá trị hợp lệ để bản ghi không bị thêm khóa rỗng.
 */
export function recordSignals(input: SignalInput): Pick<PaperRecord, 'citedByCount' | 'isRetracted' | 'issn'> {
  const out: Pick<PaperRecord, 'citedByCount' | 'isRetracted' | 'issn'> = {};
  const cited = input.citedBy;
  if (typeof cited === 'number' && Number.isFinite(cited) && cited >= 0) out.citedByCount = Math.floor(cited);
  if (input.retracted === true) out.isRetracted = true;
  const list = Array.isArray(input.issns) ? input.issns : input.issns === undefined ? [] : [input.issns];
  const issns = [...new Set(list.map(normalizeIssn).filter((x): x is string => x !== null))];
  if (issns.length > 0) out.issn = issns;
  return out;
}

import { cleanText } from './text.js';

export interface Biblio {
  volume: string;
  issue: string;
  pages: string;
  place: string;
}

const short = (value: unknown, max: number): string => {
  const text = typeof value === 'number' ? String(value) : cleanText(value);
  return text.length > max ? '' : text;
};

/** Chuẩn hóa khoảng trang về "313-325"; bỏ các giá trị không phải số trang (vd. mã bài "S1360-1385(26)00280-3"). */
export function cleanPages(value: unknown): string {
  const text = short(value, 40).replace(/\s*[–—−-]+\s*/g, '-');
  return /^[A-Za-z]?\d[\w.]*(?:-[A-Za-z]?\d[\w.]*)?$/.test(text) ? text : '';
}

export function pagesFromRange(first: unknown, last: unknown): string {
  const a = cleanPages(first);
  const b = cleanPages(last);
  if (a && b && a !== b) return `${a}-${b}`;
  return a || b;
}

/** Gom thông tin thư mục (tập, số, trang, nơi) đã làm sạch; trường nào không có thì để rỗng, không suy đoán. */
export function biblio(input: { volume?: unknown; issue?: unknown; pages?: unknown; firstPage?: unknown; lastPage?: unknown; place?: unknown }): Biblio {
  return {
    volume: short(input.volume, 20),
    issue: short(input.issue, 20),
    pages: input.pages !== undefined && input.pages !== null && input.pages !== '' ? cleanPages(input.pages) : pagesFromRange(input.firstPage, input.lastPage),
    place: short(input.place, 160),
  };
}

const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

type DateParts = { 'date-parts'?: unknown } | undefined;

function parts(value: DateParts): [number, number?, number?] | null {
  const raw = value?.['date-parts'];
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) return null;
  const [y, m, d] = raw[0] as unknown[];
  if (typeof y !== 'number' || !Number.isInteger(y)) return null;
  return [y, typeof m === 'number' ? m : undefined, typeof d === 'number' ? d : undefined];
}

/** Ngày tổ chức hội nghị theo kiểu "Oct. 16-20, 1998" / "Oct. 30 - Nov. 2, 1998" / "1998". */
export function formatEventDates(start: DateParts, end: DateParts): string {
  const s = parts(start);
  if (!s) return '';
  const [sy, sm, sd] = s;
  const monthName = (m?: number) => (m && m >= 1 && m <= 12 ? MONTHS[m - 1]! : '');
  if (!sm) return String(sy);
  if (!sd) return `${monthName(sm)} ${sy}`.trim();
  const e = parts(end);
  if (e && e[1] && e[2] && (e[0] !== sy || e[1] !== sm || e[2] !== sd)) {
    const [ey, em, ed] = e as [number, number, number];
    if (ey === sy && em === sm) return `${monthName(sm)} ${sd}-${ed}, ${sy}`;
    if (ey === sy) return `${monthName(sm)} ${sd} - ${monthName(em)} ${ed}, ${sy}`;
    return `${monthName(sm)} ${sd}, ${sy} - ${monthName(em)} ${ed}, ${ey}`;
  }
  return `${monthName(sm)} ${sd}, ${sy}`;
}

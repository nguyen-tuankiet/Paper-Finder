import { useCallback, useState } from 'react';
import type { CitationStyle } from './citation';

const KEY = 'pf_citation_style';
const STYLES: CitationStyle[] = ['ieee', 'apa', 'basic'];

function load(): CitationStyle {
  try {
    const value = localStorage.getItem(KEY);
    return STYLES.includes(value as CitationStyle) ? (value as CitationStyle) : 'ieee';
  } catch {
    return 'ieee'; // trình duyệt chặn lưu trữ
  }
}

/** Kiểu trích dẫn đang chọn, được nhớ lại ở lần mở sau (chỉ trong trình duyệt của người dùng). */
export function useCitationStyle(): [CitationStyle, (style: CitationStyle) => void] {
  const [style, setStyle] = useState<CitationStyle>(load);
  const update = useCallback((next: CitationStyle) => {
    setStyle(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* bỏ qua */
    }
  }, []);
  return [style, update];
}

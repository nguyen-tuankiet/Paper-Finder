import { useCallback, useState } from 'react';
import type { CitationStyle } from './citation';
import { AUTHOR_FORMAT_LABELS, AUTHOR_JOIN_LABELS, DEFAULT_CUSTOM, LIST_ORDER_LABELS, type CustomCitationConfig } from './customCitation';

const STYLE_KEY = 'pf_citation_style';
const CUSTOM_KEY = 'pf_custom_citation';
const OPEN_KEY = 'pf_citation_panel_open';
const STYLES: CitationStyle[] = ['ieee', 'apa', 'basic', 'custom'];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // trình duyệt chặn lưu trữ
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* bỏ qua */
  }
}

/** Kiểu trích dẫn đang chọn, được nhớ lại ở lần mở sau (chỉ trong trình duyệt của người dùng). */
export function useCitationStyle(): [CitationStyle, (style: CitationStyle) => void] {
  const [style, setStyle] = useState<CitationStyle>(() => {
    const value = read(STYLE_KEY);
    return STYLES.includes(value as CitationStyle) ? (value as CitationStyle) : 'ieee';
  });
  const update = useCallback((next: CitationStyle) => {
    setStyle(next);
    write(STYLE_KEY, next);
  }, []);
  return [style, update];
}

/** Đọc cấu hình mẫu tùy chỉnh đã lưu; giá trị hỏng hoặc thiếu thì dùng mặc định. */
export function parseCustomConfig(raw: string | null): CustomCitationConfig {
  if (!raw) return DEFAULT_CUSTOM;
  try {
    const data = JSON.parse(raw) as Partial<CustomCitationConfig>;
    return {
      template: typeof data.template === 'string' && data.template.trim() ? data.template.slice(0, 2000) : DEFAULT_CUSTOM.template,
      authorFormat: data.authorFormat && data.authorFormat in AUTHOR_FORMAT_LABELS ? data.authorFormat : DEFAULT_CUSTOM.authorFormat,
      authorJoin: data.authorJoin && data.authorJoin in AUTHOR_JOIN_LABELS ? data.authorJoin : DEFAULT_CUSTOM.authorJoin,
      maxAuthors: Number.isFinite(data.maxAuthors) ? Math.min(50, Math.max(1, Math.floor(data.maxAuthors!))) : DEFAULT_CUSTOM.maxAuthors,
      order: data.order && data.order in LIST_ORDER_LABELS ? data.order : DEFAULT_CUSTOM.order,
    };
  } catch {
    return DEFAULT_CUSTOM;
  }
}

/** Mẫu trích dẫn tự soạn, được nhớ lại ở lần mở sau. */
export function useCustomCitation(): [CustomCitationConfig, (config: CustomCitationConfig) => void] {
  const [config, setConfig] = useState<CustomCitationConfig>(() => parseCustomConfig(read(CUSTOM_KEY)));
  const update = useCallback((next: CustomCitationConfig) => {
    setConfig(next);
    write(CUSTOM_KEY, JSON.stringify(next));
  }, []);
  return [config, update];
}

/** Khung sao chép tài liệu tham khảo: mặc định thu gọn thành một dòng. */
export function usePanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => read(OPEN_KEY) === '1');
  const update = useCallback((next: boolean) => {
    setOpen(next);
    write(OPEN_KEY, next ? '1' : '0');
  }, []);
  return [open, update];
}

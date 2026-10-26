import { safeHttpUrl } from './text.js';

export interface OpenAccessInfo {
  isOpenAccess: boolean;
  oaStatus: string;
  oaUrl: string;
  oaPdfUrl: string;
  oaLicense: string;
}

/** Giấy phép: chuẩn hóa về chữ thường, bỏ giá trị vô nghĩa. */
export function cleanLicense(value: unknown): string {
  if (typeof value !== 'string') return '';
  const license = value.trim().toLowerCase().slice(0, 60);
  return ['', 'unknown', 'other', 'null', 'undefined'].includes(license) ? '' : license;
}

/** Tạo thông tin truy cập mở đã làm sạch: chỉ nhận URL http(s), và chỉ giữ URL/giấy phép khi bài thật sự là bản mở. */
export function openAccess(input: Partial<OpenAccessInfo> = {}): OpenAccessInfo {
  const isOpenAccess = input.isOpenAccess === true;
  return {
    isOpenAccess,
    oaStatus: typeof input.oaStatus === 'string' ? input.oaStatus.trim().toLowerCase().slice(0, 30) : '',
    oaUrl: isOpenAccess ? safeHttpUrl(input.oaUrl) : '',
    oaPdfUrl: isOpenAccess ? safeHttpUrl(input.oaPdfUrl) : '',
    oaLicense: isOpenAccess ? cleanLicense(input.oaLicense) : '',
  };
}

/** URL có vẻ là file PDF trực tiếp. */
export function looksLikePdf(url: string): boolean {
  return /\.pdf(?:$|[?#])|\/pdf(?:\/|$|\?)|pdfdirect|[?&]pdf=/i.test(url);
}

/** "cc-by-nc-nd" -> "CC BY-NC-ND", "cc by" -> "CC BY", "cc0" -> "CC0"; giấy phép khác giữ nguyên. */
export function formatLicense(license: string): string {
  const value = license.trim();
  if (/^cc[\s-]/i.test(value)) return value.replace(/^cc[\s-]+/i, 'CC ').toUpperCase().replace(/\s+/g, ' ');
  return /^cc\d/i.test(value) ? value.toUpperCase() : value;
}

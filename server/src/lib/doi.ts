const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/;

export function isValidDoi(doi: string): boolean {
  return DOI_PATTERN.test(doi);
}

/**
 * Chuẩn hóa DOI để so sánh và lưu trữ: bỏ tiền tố URL (doi.org, dx.doi.org) hoặc "doi:",
 * chuyển chữ thường (DOI không phân biệt hoa thường). Trả về chuỗi rỗng nếu không hợp lệ.
 * Không bao giờ tự tạo DOI.
 */
export function normalizeDoi(input: unknown): string {
  if (typeof input !== 'string') return '';
  let value = input.trim();
  if (!value) return '';
  if (value.includes('%')) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // giữ nguyên nếu chuỗi % không hợp lệ
    }
  }
  value = value
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim()
    .toLowerCase();
  return isValidDoi(value) ? value : '';
}

/** URL https://doi.org/{doi}, mã hóa từng đoạn để ký tự như # hoặc ? không phá vỡ URL. */
export function doiUrl(doi: string): string {
  return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;
}

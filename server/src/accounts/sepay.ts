import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * SePay (sepay.vn) theo dõi tài khoản ngân hàng của bạn và gọi webhook mỗi khi có tiền vào.
 * Cách dùng ở đây: mỗi đơn có một mã ngắn (vd. PF482913057); khách chuyển khoản/quét QR kèm mã đó trong nội dung,
 * SePay gọi webhook, ta đối chiếu mã + số tiền rồi kích hoạt gói.
 */
export interface SepayConfig {
  /** Khóa xác thực webhook: SePay gửi header `Authorization: Apikey <khóa>`. */
  apiKey: string;
  /** Số tài khoản ngân hàng nhận tiền (đã liên kết với SePay). */
  accountNumber: string;
  /** Tên ngân hàng theo danh sách của SePay/VietQR, vd. MBBank, Vietcombank, ACB. */
  bankName: string;
  /** Tên chủ tài khoản, chỉ để hiển thị cho khách đối chiếu. */
  accountName?: string;
  /** Tiền tố mã thanh toán; phải trùng cấu hình "Cấu trúc mã thanh toán" trong SePay. Mặc định PF. */
  codePrefix: string;
}

/** Nội dung chuyển khoản của một đơn, chỉ chữ và số vì nhiều ngân hàng bỏ ký tự đặc biệt: "PF" + mã đơn. */
export function memoFor(prefix: string, orderCode: number): string {
  return `${prefix}${orderCode}`;
}

/** Ảnh QR VietQR có sẵn số tiền và nội dung (do qr.sepay.vn dựng, không chứa dữ liệu nhạy cảm). */
export function qrUrl(config: SepayConfig, amount: number, memo: string): string {
  const query = new URLSearchParams({ acc: config.accountNumber, bank: config.bankName, amount: String(amount), des: memo, template: 'compact' });
  return `https://qr.sepay.vn/img?${query.toString()}`;
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Lấy mã đơn từ giao dịch SePay: ưu tiên trường `code` (SePay đã tách theo tiền tố bạn cấu hình),
 * nếu không có thì tìm trong nội dung chuyển khoản. Ngân hàng có thể chèn khoảng trắng hoặc đổi chữ hoa/thường.
 */
export function extractOrderCode(prefix: string, input: { code?: unknown; content?: unknown; description?: unknown }): number | null {
  const pattern = new RegExp(`${escapeRegex(prefix)}\\s*(\\d{6,12})(?!\\d)`, 'i');
  for (const field of [input.code, input.content, input.description]) {
    if (typeof field !== 'string') continue;
    const match = pattern.exec(field);
    if (match) {
      const value = Number(match[1]);
      if (Number.isSafeInteger(value) && value > 0) return value;
    }
  }
  return null;
}

/** So khóa API không lộ thông tin qua thời gian xử lý. Header có dạng `Apikey <khóa>` (không phân biệt hoa thường ở phần "Apikey"). */
export function verifyApiKey(header: string | undefined, apiKey: string): boolean {
  if (!header) return false;
  const match = /^apikey\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const a = createHash('sha256').update(match[1]!.trim()).digest();
  const b = createHash('sha256').update(apiKey).digest();
  return timingSafeEqual(a, b);
}

/** Phần của webhook SePay mà ta dùng (các trường khác bị bỏ qua). */
export interface SepayTransaction {
  /** Mã giao dịch của SePay, duy nhất. */
  id: string;
  direction: 'in' | 'out';
  amount: number;
  accountNumber: string;
  code?: string;
  content: string;
  referenceCode?: string;
}

/** Đọc payload webhook một cách chặt chẽ; trả null nếu thiếu trường bắt buộc hoặc sai kiểu. */
export function parseSepayPayload(body: unknown): SepayTransaction | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const id = typeof b.id === 'number' || typeof b.id === 'string' ? String(b.id) : '';
  const amount = typeof b.transferAmount === 'number' ? b.transferAmount : typeof b.transferAmount === 'string' ? Number(b.transferAmount) : NaN;
  if (!id || !Number.isFinite(amount) || amount < 0) return null;
  const type = b.transferType === 'out' ? 'out' : b.transferType === 'in' ? 'in' : null;
  if (!type) return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    id,
    direction: type,
    amount,
    accountNumber: str(b.accountNumber),
    code: str(b.code) || undefined,
    content: [str(b.content), str(b.description)].filter(Boolean).join(' '),
    referenceCode: str(b.referenceCode) || undefined,
  };
}

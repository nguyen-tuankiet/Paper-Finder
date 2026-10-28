import { createHmac } from 'node:crypto';

const API_BASE = 'https://api-merchant.payos.vn';

export interface PayOsCredentials {
  clientId: string;
  apiKey: string;
  checksumKey: string;
}

export interface CreateLinkInput {
  orderCode: number;
  amount: number;
  /** PayOS giới hạn 25 ký tự. */
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

export type PayOsStatus = 'PAID' | 'PENDING' | 'PROCESSING' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';

export interface PaymentInfo {
  status: PayOsStatus;
  /** Số tiền đã thanh toán (VND). */
  amountPaid: number;
  amount: number;
}

export class PayOsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PayOsError';
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Máy khách PayOS (cổng thanh toán chuyển khoản QR ngân hàng Việt Nam).
 * Quy ước chữ ký tạo link: HMAC-SHA256(checksumKey) trên chuỗi
 * `amount=..&cancelUrl=..&description=..&orderCode=..&returnUrl=..` (các khóa theo thứ tự chữ cái).
 */
export class PayOsClient {
  constructor(
    private readonly credentials: PayOsCredentials,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly timeoutMs = 15_000,
  ) {}

  signCreate(input: CreateLinkInput): string {
    const data = `amount=${input.amount}&cancelUrl=${input.cancelUrl}&description=${input.description}&orderCode=${input.orderCode}&returnUrl=${input.returnUrl}`;
    return createHmac('sha256', this.credentials.checksumKey).update(data).digest('hex');
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', 'x-client-id': this.credentials.clientId, 'x-api-key': this.credentials.apiKey };
  }

  private async call(path: string, init: RequestInit): Promise<{ code?: string; desc?: string; data?: Record<string, unknown> | null }> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}${path}`, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new PayOsError('Không kết nối được cổng thanh toán PayOS.');
    }
    let body: { code?: string; desc?: string; data?: Record<string, unknown> | null };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new PayOsError(`PayOS trả về phản hồi không hợp lệ (HTTP ${response.status}).`, response.status);
    }
    if (!response.ok || (body.code && body.code !== '00')) {
      throw new PayOsError(body.desc || `PayOS báo lỗi (HTTP ${response.status}).`, response.status);
    }
    return body;
  }

  async createPaymentLink(input: CreateLinkInput): Promise<{ checkoutUrl: string }> {
    const body = await this.call('/v2/payment-requests', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...input, signature: this.signCreate(input) }),
    });
    const checkoutUrl = body.data?.checkoutUrl;
    if (typeof checkoutUrl !== 'string' || !/^https:\/\//i.test(checkoutUrl)) throw new PayOsError('PayOS không trả về link thanh toán.');
    return { checkoutUrl };
  }

  /** Lấy trạng thái đơn trực tiếp từ PayOS. Đây là nguồn sự thật duy nhất để quyết định kích hoạt Pro (không tin nội dung webhook). */
  async getPaymentInfo(orderCode: number): Promise<PaymentInfo> {
    const body = await this.call(`/v2/payment-requests/${orderCode}`, { method: 'GET', headers: this.headers() });
    const status = String(body.data?.status ?? 'UNKNOWN').toUpperCase();
    const known: PayOsStatus[] = ['PAID', 'PENDING', 'PROCESSING', 'CANCELLED', 'EXPIRED'];
    return {
      status: (known as string[]).includes(status) ? (status as PayOsStatus) : 'UNKNOWN',
      amount: Number(body.data?.amount ?? 0),
      amountPaid: Number(body.data?.amountPaid ?? 0),
    };
  }
}

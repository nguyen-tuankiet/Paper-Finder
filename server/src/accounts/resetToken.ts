import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Liên kết đặt lại mật khẩu có hiệu lực 1 giờ. */
export const RESET_TTL_MS = 60 * 60 * 1000;

interface Payload {
  /** Mã người dùng. */
  u: string;
  /** Dấu vân tay của mật khẩu hiện tại: đổi mật khẩu xong thì liên kết cũ tự vô hiệu (dùng được đúng một lần). */
  f: string;
  /** Hết hạn (ms epoch). */
  e: number;
}

const b64 = (value: string) => Buffer.from(value).toString('base64url');

/** Dấu vân tay ngắn của mã băm mật khẩu (không đảo ngược được, không lộ mật khẩu). */
export const passwordFingerprint = (passwordHash: string): string => createHash('sha256').update(passwordHash).digest('base64url').slice(0, 22);

/**
 * Token đặt lại mật khẩu không cần lưu trong cơ sở dữ liệu: base64url(JSON).chữ ký HMAC-SHA256, khóa riêng
 * (khác khóa phiên đăng nhập) nên token phiên không thể dùng thay token này và ngược lại.
 */
export class ResetTokenSigner {
  private readonly secret: string;

  constructor(sessionSecret: string) {
    this.secret = `password-reset|${sessionSecret}`;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  create(userId: string, passwordHash: string, now = Date.now()): string {
    const body = b64(JSON.stringify({ u: userId, f: passwordFingerprint(passwordHash), e: now + RESET_TTL_MS } satisfies Payload));
    return `${body}.${this.sign(body)}`;
  }

  /** Trả null nếu sai chữ ký, hỏng hoặc hết hạn. Người gọi còn phải so `fingerprint` với mật khẩu hiện tại của người dùng. */
  verify(token: string, now = Date.now()): { userId: string; fingerprint: string } | null {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Payload>;
      if (typeof payload.u !== 'string' || typeof payload.f !== 'string' || typeof payload.e !== 'number' || payload.e <= now) return null;
      return { userId: payload.u, fingerprint: payload.f };
    } catch {
      return null;
    }
  }
}

/** Nội dung thư đặt lại mật khẩu (văn bản thường và HTML). `link` chỉ chứa ký tự an toàn của base64url nên không cần thoát. */
export function resetEmail(link: string): { subject: string; text: string; html: string } {
  const minutes = RESET_TTL_MS / 60_000;
  return {
    subject: 'Đặt lại mật khẩu PaperFinder',
    text: `Chào bạn,\n\nBạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản PaperFinder. Mở liên kết dưới đây để đặt mật khẩu mới (có hiệu lực ${minutes} phút, dùng được một lần):\n\n${link}\n\nNếu không phải bạn yêu cầu, hãy bỏ qua thư này; mật khẩu hiện tại vẫn giữ nguyên.\n\nPaperFinder`,
    html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f2d3d;line-height:1.55">
<p>Chào bạn,</p>
<p>Bạn (hoặc ai đó) vừa yêu cầu đặt lại mật khẩu tài khoản <b>PaperFinder</b>. Bấm nút dưới đây để đặt mật khẩu mới (có hiệu lực ${minutes} phút, dùng được một lần):</p>
<p><a href="${link}" style="display:inline-block;background:#1f4e79;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px">Đặt mật khẩu mới</a></p>
<p style="color:#6b7785;font-size:13px">Nếu nút không bấm được, sao chép liên kết này vào trình duyệt:<br>${link}</p>
<p style="color:#6b7785;font-size:13px">Nếu không phải bạn yêu cầu, hãy bỏ qua thư này; mật khẩu hiện tại vẫn giữ nguyên.</p>
</div>`,
  };
}

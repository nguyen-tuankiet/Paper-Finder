import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'pf_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Payload {
  /** Mã người dùng. */
  u: string;
  /** Phiên bản phiên (đổi mật khẩu thì token cũ vô hiệu). */
  v: number;
  /** Hết hạn (ms epoch). */
  e: number;
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** Token phiên không trạng thái: base64url(JSON).chữ ký HMAC-SHA256. */
export class SessionSigner {
  constructor(private readonly secret: string) {}

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  create(userId: string, sessionVersion: number, now = Date.now()): string {
    const body = b64(JSON.stringify({ u: userId, v: sessionVersion, e: now + SESSION_TTL_MS } satisfies Payload));
    return `${body}.${this.sign(body)}`;
  }

  /** Trả null nếu token sai chữ ký, hỏng hoặc hết hạn. */
  verify(token: string, now = Date.now()): { userId: string; sessionVersion: number } | null {
    const [body, signature, extra] = token.split('.');
    if (!body || !signature || extra !== undefined) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Payload>;
      if (typeof payload.u !== 'string' || typeof payload.v !== 'number' || typeof payload.e !== 'number' || payload.e <= now) return null;
      return { userId: payload.u, sessionVersion: payload.v };
    } catch {
      return null;
    }
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`, ...(secure ? ['Secure'] : [])].join('; ');
}

export function clearedSessionCookie(secure: boolean): string {
  return [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0', ...(secure ? ['Secure'] : [])].join('; ');
}

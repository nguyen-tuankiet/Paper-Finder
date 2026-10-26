import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

// ---------- Chữ ký URL: chỉ chuyển tiếp các link PDF do chính máy chủ đã trả về trong kết quả tìm kiếm ----------

export class UrlSigner {
  private readonly secret: string;

  constructor(secret?: string) {
    this.secret = secret || randomBytes(32).toString('hex');
  }

  sign(url: string): string {
    return createHmac('sha256', this.secret).update(url).digest('hex').slice(0, 32);
  }

  verify(url: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(url));
    const given = Buffer.from(typeof signature === 'string' ? signature : '');
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

// ---------- Chống SSRF: chỉ cho phép địa chỉ IP công cộng ----------

function isPublicIpv4(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // 0/8, 10/8, loopback, multicast + dành riêng
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 169 && b === 254) return false; // link-local, gồm cả metadata đám mây
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

/** Phân tích IPv6 thành 8 nhóm 16-bit (hỗ trợ "::" và IPv4 nhúng ở cuối). Trả về null nếu sai định dạng. */
function parseIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);

  let embedded: [number, number] | undefined;
  const v4 = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[2]!.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !(n >= 0 && n <= 255))) return null;
    embedded = [(o[0]! << 8) | o[1]!, (o[2]! << 8) | o[3]!];
    text = `${v4[1]}0:0`; // chỗ giữ cho hai nhóm cuối
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === '' ? [] : part.split(':').map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  if ([...head, ...tail].some(Number.isNaN)) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (embedded) [groups[6], groups[7]] = embedded;
  return groups;
}

const ipv4Of = (g: number[]) => [g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255].join('.');

export function isPublicIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family !== 6) return false;

  const g = parseIpv6(ip);
  if (!g) return false;
  const zeros = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);

  if (zeros(0, 5) && g[5] === 0xffff) return isPublicIpv4(ipv4Of(g)); // ::ffff:a.b.c.d (IPv4-mapped, Node chuẩn hóa sang dạng hex)
  if (zeros(0, 6)) return false; // ::, ::1 và dạng IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isPublicIpv4(ipv4Of(g)); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return isPublicIpv4([g[1]! >> 8, g[1]! & 255, g[2]! >> 8, g[2]! & 255].join('.')); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return false; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return false; // dải tài liệu
  if (g[0] === 0x100 && zeros(1, 4)) return false; // 100::/64 (discard)
  if ((g[0]! & 0xfe00) === 0xfc00) return false; // fc00::/7 (unique local)
  if ((g[0]! & 0xffc0) === 0xfe80) return false; // fe80::/10 (link-local)
  if ((g[0]! & 0xff00) === 0xff00) return false; // multicast
  return true;
}

export type DownloadErrorCode = 'bad_url' | 'blocked' | 'timeout' | 'upstream' | 'network' | 'not_pdf' | 'too_large' | 'cancelled';

export class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  /** Chỉ dùng trong test để gọi tới server cục bộ. */
  allowPrivateNetwork: boolean;
}

export const DEFAULT_DOWNLOAD_OPTIONS: DownloadOptions = {
  maxBytes: 100 * 1024 * 1024,
  timeoutMs: 30_000,
  maxRedirects: 5,
  allowPrivateNetwork: false,
};

/** Hàm tra DNS kiểm tra mọi địa chỉ trả về TRƯỚC khi kết nối, nên chống được cả DNS rebinding. */
function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!allowPrivate && addresses.some((a) => !isPublicIp(a.address))) {
        return callback(new DownloadError('blocked', 'Địa chỉ đích không được phép truy cập.'));
      }
      if (options.all) return callback(null, addresses);
      const first = addresses[0];
      return first ? callback(null, first.address, first.family) : callback(new DownloadError('network', 'Không phân giải được tên miền.'));
    });
  };
}

/** Kiểm tra một URL đích (dùng cho cả URL ban đầu và mọi chặng chuyển hướng). Xuất ra để kiểm thử. */
export function parseTarget(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DownloadError('bad_url', 'Địa chỉ file không hợp lệ.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DownloadError('bad_url', 'Chỉ hỗ trợ địa chỉ http(s).');
  if (url.username || url.password) throw new DownloadError('bad_url', 'Địa chỉ không được chứa tài khoản.');
  // Node KHÔNG gọi hàm tra DNS (lookup) khi host đã là địa chỉ IP, nên phải kiểm tra IP trực tiếp tại đây.
  // URL đã chuẩn hóa các dạng IP lạ (số thập phân, hex, rút gọn) về dạng chuẩn trước khi vào đây.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowPrivate && net.isIP(host) && !isPublicIp(host)) {
    throw new DownloadError('blocked', 'Địa chỉ đích không được phép truy cập.');
  }
  return url;
}

function requestOnce(url: URL, options: DownloadOptions, signal?: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: { 'user-agent': 'PaperFinder/1.0 (+open-access download)', accept: 'application/pdf,*/*;q=0.5' },
        lookup: guardedLookup(options.allowPrivateNetwork) as never,
        timeout: options.timeoutMs,
        signal,
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new DownloadError('timeout', 'Nguồn không phản hồi kịp thời.')));
    req.on('error', (error) => {
      if (error instanceof DownloadError) reject(error);
      else if (signal?.aborted) reject(new DownloadError('cancelled', 'Đã hủy.'));
      else reject(new DownloadError('network', 'Không kết nối được tới nơi chứa file.'));
    });
    req.end();
  });
}

export interface OpenedPdf {
  /** Phần đầu của file đã đọc để kiểm tra chữ ký %PDF. */
  first: Buffer;
  /** Phần còn lại của dữ liệu. */
  rest: AsyncIterable<Buffer>;
  contentLength?: number;
  destroy: () => void;
}

/**
 * Mở một URL PDF: theo chuyển hướng (kiểm tra từng chặng), từ chối địa chỉ nội bộ, giới hạn dung lượng,
 * và chỉ chấp nhận khi dữ liệu thực sự bắt đầu bằng "%PDF-" (loại các trang HTML/đăng ký).
 */
export async function openPdf(rawUrl: string, options: DownloadOptions = DEFAULT_DOWNLOAD_OPTIONS, signal?: AbortSignal): Promise<OpenedPdf> {
  let url = parseTarget(rawUrl, options.allowPrivateNetwork);
  let response: http.IncomingMessage | undefined;

  for (let hop = 0; ; hop++) {
    response = await requestOnce(url, options, signal);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (hop >= options.maxRedirects) throw new DownloadError('upstream', 'Link chuyển hướng quá nhiều lần.');
      url = parseTarget(new URL(response.headers.location, url).toString(), options.allowPrivateNetwork);
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      if (status === 401 || status === 403 || status === 429) {
        throw new DownloadError(
          'upstream',
          `Nhà xuất bản không cho máy chủ tải tự động file này (HTTP ${status}). Hãy mở link gốc rồi lưu từ trình xem PDF (nút Lưu hoặc Ctrl+S).`,
        );
      }
      throw new DownloadError('upstream', `Nơi chứa file trả về lỗi HTTP ${status} (link có thể đã hỏng).`);
    }
    break;
  }

  const declared = Number(response.headers['content-length']);
  const contentLength = Number.isFinite(declared) && declared > 0 ? declared : undefined;
  if (contentLength !== undefined && contentLength > options.maxBytes) {
    response.destroy();
    throw new DownloadError('too_large', `File lớn hơn giới hạn ${Math.round(options.maxBytes / 1024 / 1024)} MB.`);
  }

  const iterator = response[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const destroy = () => response!.destroy();
  let first: Buffer;
  try {
    const head = await iterator.next();
    first = head.done ? Buffer.alloc(0) : Buffer.from(head.value);
  } catch (error) {
    destroy();
    throw error instanceof DownloadError ? error : new DownloadError('network', 'Gián đoạn khi tải file.');
  }
  if (first.subarray(0, 5).toString('latin1') !== '%PDF-') {
    destroy();
    throw new DownloadError('not_pdf', 'Link này không trỏ trực tiếp tới file PDF (có thể là trang web hoặc cần đăng nhập).');
  }

  return {
    first,
    contentLength,
    destroy,
    rest: { [Symbol.asyncIterator]: () => ({ next: async () => iterator.next() as Promise<IteratorResult<Buffer>> }) },
  };
}

/** Tên file an toàn cho Content-Disposition: bỏ ký tự cấm, giới hạn độ dài, luôn có đuôi .pdf. */
export function safePdfFileName(name: unknown): { ascii: string; unicode: string } {
  const raw = typeof name === 'string' ? name : '';
  let base = raw
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.pdf$/i, '')
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();
  if (!base) base = 'paper';
  const unicode = `${base}.pdf`;
  const ascii =
    base
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\%]/g, '_')
      .trim() || 'paper';
  return { ascii: `${ascii}.pdf`, unicode };
}

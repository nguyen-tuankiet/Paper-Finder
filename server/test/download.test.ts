import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaperRecord } from '../../shared/types.js';
import { createApp } from '../src/app.js';
import { silentLogger } from '../src/logger.js';
import { UrlSigner, isPublicIp, parseTarget, safePdfFileName } from '../src/services/download.js';
import type { SourceAdapter } from '../src/sources/types.js';
import { makeRecord } from './helpers.js';

describe('isPublicIp (chống SSRF)', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('cho phép %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it.each([
    '127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    'localhost', 'not-an-ip', '',
  ])('chặn %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each([
    '::ffff:7f00:1', '::ffff:a00:1', '::ffff:c0a8:101', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:7f00:1', '::127.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', '2002:a9fe:a9fe::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1',
    '0:0:0:0:0:0:0:1', 'fe80::1%eth0', '1:2:3:4:5:6:7:8:9', '1::2::3',
  ])('chặn IPv6 nhúng địa chỉ nội bộ hoặc sai định dạng: %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1', '2a00:1450:4001:81c::200e'])('cho phép IPv6 nhúng địa chỉ công cộng: %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });

  it('172.15 và 172.32 là địa chỉ công cộng (ngoài dải 172.16/12)', () => {
    expect(isPublicIp('172.15.0.1')).toBe(true);
    expect(isPublicIp('172.32.0.1')).toBe(true);
  });
});

describe('UrlSigner', () => {
  it('chỉ chấp nhận đúng chữ ký của đúng URL', () => {
    const signer = new UrlSigner('mot-khoa-bi-mat-dai-hon-16');
    const sig = signer.sign('https://a.org/x.pdf');
    expect(signer.verify('https://a.org/x.pdf', sig)).toBe(true);
    expect(signer.verify('https://a.org/y.pdf', sig)).toBe(false);
    expect(signer.verify('https://a.org/x.pdf', sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0'))).toBe(false);
    expect(signer.verify('https://a.org/x.pdf', '')).toBe(false);
    expect(new UrlSigner('khoa-khac-khoa-khac-1234').verify('https://a.org/x.pdf', sig)).toBe(false);
  });

  it('khóa ngẫu nhiên khác nhau giữa các lần tạo', () => {
    expect(new UrlSigner().sign('u')).not.toBe(new UrlSigner().sign('u'));
  });
});

describe('safePdfFileName', () => {
  it('bỏ ký tự cấm, giữ tiếng Việt cho tên unicode và tạo bản ASCII', () => {
    expect(safePdfFileName('Trí tuệ nhân tạo: ứng dụng?')).toEqual({ ascii: 'Tri tue nhan tao ung dung.pdf', unicode: 'Trí tuệ nhân tạo ứng dụng.pdf' });
  });
  it('không cho phép đường dẫn, ký tự điều khiển, dấu nháy phá header', () => {
    const { ascii, unicode } = safePdfFileName('../../etc/passwd"\r\nX-Evil: 1');
    for (const n of [ascii, unicode]) {
      expect(n).not.toMatch(/[\\/"\r\n]/);
      expect(n.endsWith('.pdf')).toBe(true);
    }
  });
  it('rỗng/sai kiểu -> paper.pdf, không nhân đôi đuôi, giới hạn độ dài', () => {
    expect(safePdfFileName('').ascii).toBe('paper.pdf');
    expect(safePdfFileName(undefined).unicode).toBe('paper.pdf');
    expect(safePdfFileName('abc.PDF').unicode).toBe('abc.pdf');
    expect(safePdfFileName('x'.repeat(500)).unicode.length).toBeLessThanOrEqual(124);
  });
});

// ---------- Máy chủ giả lập nơi chứa file ----------
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200_000, 0x41)]);
let files: http.Server;
let filesBase: string;

beforeAll(async () => {
  files = http.createServer((req, res) => {
    const path = req.url ?? '';
    if (path === '/ok.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': PDF.length });
      res.end(PDF);
    } else if (path === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>Vui lòng đăng nhập để tải bài</body></html>');
    } else if (path === '/redirect') {
      res.writeHead(302, { location: '/ok.pdf' });
      res.end();
    } else if (path === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
    } else if (path === '/big') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': 5 * 1024 * 1024 });
      res.end(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1024)]));
    } else if (path === '/chunked-big') {
      res.writeHead(200, { 'content-type': 'application/pdf' }); // không có content-length
      res.write('%PDF-1.4\n');
      const chunk = Buffer.alloc(256 * 1024, 0x42);
      let sent = 0;
      const timer = setInterval(() => {
        if (res.destroyed || sent >= 20) {
          clearInterval(timer);
          res.end();
          return;
        }
        res.write(chunk);
        sent++;
      }, 5);
      res.on('close', () => clearInterval(timer));
    } else if (path === '/forbidden') {
      res.writeHead(403);
      res.end('bot blocked');
    } else if (path === '/slow') {
      // không bao giờ trả lời
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise<void>((resolve) => files.listen(0, '127.0.0.1', resolve));
  filesBase = `http://127.0.0.1:${(files.address() as AddressInfo).port}`;
});

afterAll(() => {
  files.closeAllConnections();
  files.close();
});

const stubAdapter = (record: Partial<PaperRecord>): SourceAdapter => ({
  id: 'crossref',
  label: 'Crossref',
  ping: async () => {},
  search: async () => ({ records: [makeRecord({ doi: '10.1/x', isOpenAccess: true, ...record })] }),
});

function start(options: { allowPrivateNetwork: boolean; adapter?: SourceAdapter; maxBytes?: number }) {
  const signer = new UrlSigner('khoa-ky-test-0123456789');
  const app = createApp({
    adapters: { crossref: options.adapter ?? stubAdapter({}) },
    config: { corsOrigins: [], rateLimitPerMinute: 1000, staticDir: undefined },
    logger: silentLogger,
    signer,
    downloadOptions: { allowPrivateNetwork: options.allowPrivateNetwork, maxBytes: options.maxBytes ?? 1024 * 1024, timeoutMs: 400, maxRedirects: 3 },
  });
  return new Promise<{ server: http.Server; base: string; signer: UrlSigner }>((resolve) => {
    const server = app.listen(0, () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, signer }));
  });
}

describe('GET /api/download (cho phép mạng cục bộ để dùng server giả lập)', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start({ allowPrivateNetwork: true });
  });
  afterAll(() => {
    ctx.server.closeAllConnections();
    ctx.server.close();
  });

  const dl = (path: string, name = 'Bài báo: tiếng Việt?', sign = true, sigOverride?: string) => {
    const url = filesBase + path;
    const qs = new URLSearchParams({ url, name });
    if (sigOverride !== undefined) qs.set('sig', sigOverride);
    else if (sign) qs.set('sig', ctx.signer.sign(url));
    return fetch(`${ctx.base}/api/download?${qs}`);
  };

  it('tải đúng file PDF, ép tải về (attachment) với tên file tiếng Việt an toàn', async () => {
    const res = await dl('/ok.pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain('attachment;');
    expect(cd).toContain('filename="Bai bao tieng Viet.pdf"');
    expect(decodeURIComponent(cd.split("filename*=UTF-8''")[1]!)).toBe('Bài báo tiếng Việt.pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('theo chuyển hướng tới file PDF', async () => {
    const res = await dl('/redirect');
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('thiếu hoặc sai chữ ký -> 403 (không phải proxy mở)', async () => {
    expect((await dl('/ok.pdf', 'x', false)).status).toBe(403);
    expect((await dl('/ok.pdf', 'x', true, 'sai-chu-ky')).status).toBe(403);
    // chữ ký của URL này không dùng được cho URL khác
    const sigOfOk = ctx.signer.sign(filesBase + '/ok.pdf');
    expect((await dl('/page', 'x', true, sigOfOk)).status).toBe(403);
    expect((await fetch(`${ctx.base}/api/download`)).status).toBe(403);
  });

  it('trang HTML (không phải PDF) -> 422 not_pdf để giao diện mở link gốc', async () => {
    const res = await dl('/page');
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('not_pdf');
  });

  it('lỗi HTTP của nơi chứa file -> 502; chuyển hướng vòng -> 502', async () => {
    expect((await dl('/missing')).status).toBe(502);
    expect((await dl('/loop')).status).toBe(502);
  });

  it('nhà xuất bản chặn tải tự động (403) -> thông báo rõ cách lưu thủ công', async () => {
    const res = await dl('/forbidden');
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('upstream');
    expect(body.message).toContain('không cho máy chủ tải tự động');
    expect(body.message).toContain('HTTP 403');
  });

  it('khai báo dung lượng quá lớn -> 413 trước khi tải', async () => {
    const res = await dl('/big');
    expect(res.status).toBe(413);
  });

  it('không khai báo dung lượng nhưng dữ liệu vượt giới hạn -> ngắt giữa chừng, không lưu file thiếu', async () => {
    const res = await dl('/chunked-big');
    expect(res.status).toBe(200); // đã bắt đầu gửi
    await expect(res.arrayBuffer()).rejects.toThrow(); // nhưng bị ngắt kết nối nên trình duyệt báo lỗi tải
  });

  it('nơi chứa file không trả lời -> 504', async () => {
    expect((await dl('/slow')).status).toBe(504);
  });
});

describe('GET /api/download (chặn SSRF - cấu hình mặc định)', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeAll(async () => {
    ctx = await start({ allowPrivateNetwork: false });
  });
  afterAll(() => {
    ctx.server.closeAllConnections();
    ctx.server.close();
  });

  const signedGet = (url: string) => fetch(`${ctx.base}/api/download?${new URLSearchParams({ url, sig: ctx.signer.sign(url) })}`);

  it.each([
    ['server cục bộ', () => `${filesBase}/ok.pdf`],
    ['metadata đám mây', () => 'http://169.254.169.254/latest/meta-data/'],
    ['mạng nội bộ', () => 'http://10.0.0.1/secret.pdf'],
    ['IPv6 loopback', () => 'http://[::1]:8787/api/health'],
    ['localhost', () => 'http://localhost:8787/api/health'],
  ])('dù URL có chữ ký hợp lệ vẫn chặn: %s', async (_name, url) => {
    const res = await signedGet(url());
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('blocked');
  });

  it.each([
    ['số thập phân', 'http://2130706433/x.pdf'],
    ['dạng hex', 'http://0x7f000001/x.pdf'],
    ['rút gọn', 'http://127.1/x.pdf'],
    ['IPv4 trong IPv6', 'http://[::ffff:127.0.0.1]/x.pdf'],
    ['0.0.0.0', 'http://0.0.0.0:8787/x.pdf'],
  ])('chặn các cách viết khác của địa chỉ nội bộ: %s', async (_name, url) => {
    const res = await signedGet(url);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('blocked');
  });

  it('mọi chặng chuyển hướng đều đi qua cùng bước kiểm tra: Location trỏ vào mạng nội bộ bị chặn', () => {
    // openPdf gọi parseTarget(new URL(location, urlHiệnTại)) ở mỗi chặng; kiểm tra các dạng Location nguy hiểm.
    const current = new URL('https://publisher.example/paper.pdf');
    for (const location of ['http://169.254.169.254/latest/meta-data/', '//127.0.0.1/admin', 'http://[::1]/x', 'http://10.1.2.3:8080/x']) {
      expect(() => parseTarget(new URL(location, current).toString(), false)).toThrowError(expect.objectContaining({ code: 'blocked' }));
    }
    // Location tương đối hoặc tới host công cộng thì được phép
    expect(parseTarget(new URL('/files/real.pdf', current).toString(), false).href).toBe('https://publisher.example/files/real.pdf');
    expect(parseTarget('https://8.8.8.8/x.pdf', false).hostname).toBe('8.8.8.8');
  });

  it('từ chối scheme lạ và URL có tài khoản', async () => {
    for (const url of ['file:///etc/passwd', 'ftp://a.org/x.pdf', 'http://user:pass@a.org/x.pdf', 'not a url']) {
      const res = await signedGet(url);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('bad_url');
    }
  });
});

describe('Chữ ký được cấp trong kết quả tìm kiếm', () => {
  it('bản ghi có oaPdfUrl nhận oaPdfSig hợp lệ; bản ghi không có PDF thì không', async () => {
    const withPdf = await start({ allowPrivateNetwork: true, adapter: stubAdapter({ oaPdfUrl: `${filesBase}/ok.pdf`, oaUrl: `${filesBase}/page` }) });
    try {
      const res = await fetch(`${withPdf.base}/api/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords: ['ai'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true }),
      });
      const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string; result?: { records: PaperRecord[] } });
      const record = events.find((e) => e.type === 'result')!.result!.records[0]!;
      expect(record.oaPdfSig).toBeTruthy();
      expect(withPdf.signer.verify(record.oaPdfUrl, record.oaPdfSig!)).toBe(true);
      // dùng đúng chữ ký đó để tải: luồng hoàn chỉnh từ tìm kiếm tới tải về
      const file = await fetch(`${withPdf.base}/api/download?${new URLSearchParams({ url: record.oaPdfUrl, sig: record.oaPdfSig! })}`);
      expect(file.status).toBe(200);
      expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true);
    } finally {
      withPdf.server.closeAllConnections();
      withPdf.server.close();
    }

    const noPdf = await start({ allowPrivateNetwork: false, adapter: stubAdapter({ oaUrl: `${filesBase}/page` }) });
    try {
      const res = await fetch(`${noPdf.base}/api/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keywords: ['ai'], sources: ['crossref'], maxResults: 20, onlyWithDoi: true }),
      });
      const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string; result?: { records: PaperRecord[] } });
      expect(events.find((e) => e.type === 'result')!.result!.records[0]!.oaPdfSig).toBeUndefined();
    } finally {
      noPdf.server.closeAllConnections();
      noPdf.server.close();
    }
  });
});

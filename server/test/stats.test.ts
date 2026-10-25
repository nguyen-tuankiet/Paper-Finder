import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { StatsService } from '../src/services/stats.js';

/** Đồng hồ giả để kiểm soát ngày. Mặc định 12:00 UTC = 19:00 giờ Việt Nam. */
function clock(iso = '2026-10-25T12:00:00Z') {
  let now = new Date(iso);
  return { now: () => now, set: (value: string) => (now = new Date(value)) };
}

const tmp = () => mkdtempSync(path.join(tmpdir(), 'pf-stats-'));

describe('StatsService - đếm', () => {
  it('đếm người dùng khác nhau (IP + trình duyệt), cùng người chỉ tính một lần', () => {
    const stats = new StatsService({ ...clock(), flushIntervalMs: 0 });
    stats.recordVisit('1.1.1.1', 'Chrome');
    stats.recordVisit('1.1.1.1', 'Chrome');
    stats.recordVisit('1.1.1.1', 'Firefox');
    stats.recordVisit('2.2.2.2', 'Chrome');
    stats.recordVisit(undefined, undefined);
    expect(stats.getReport().today.visitors).toBe(4);
  });

  it('đếm lượt tìm, kết quả, lỗi, hủy, xuất file và dùng nguồn', () => {
    const stats = new StatsService({ ...clock(), flushIntervalMs: 0 });
    stats.recordSearchStarted();
    stats.recordSearchSources(['crossref', 'openalex']);
    stats.recordSearchOutcome({ kind: 'completed', total: 40, sources: [{ source: 'crossref', state: 'ok' }, { source: 'openalex', state: 'partial' }] });
    stats.recordSearchStarted();
    stats.recordSearchSources(['openalex']);
    stats.recordSearchOutcome({ kind: 'failed', sources: [{ source: 'openalex', state: 'error' }] });
    stats.recordSearchStarted();
    stats.recordSearchOutcome({ kind: 'cancelled' });
    stats.recordExport();
    stats.recordExport();

    const report = stats.getReport();
    expect(report.today).toMatchObject({ searches: 3, exports: 2 });
    expect(report.allTime).toMatchObject({ completed: 1, failed: 1, cancelled: 1, averageResultsPerSearch: 40 });
    expect(report.sources).toEqual([
      { source: 'crossref', label: 'Crossref', used: 1, failed: 0, partial: 0 },
      { source: 'openalex', label: 'OpenAlex', used: 2, failed: 1, partial: 1 },
    ]);
  });

  it('chia ngày theo múi giờ: 18:00 UTC đã là ngày hôm sau ở Việt Nam', () => {
    const c = clock('2026-10-25T16:00:00Z'); // 23:00 ngày 25 giờ VN
    const stats = new StatsService({ ...c, flushIntervalMs: 0 });
    stats.recordSearchStarted();
    c.set('2026-10-25T18:00:00Z'); // 01:00 ngày 26 giờ VN
    stats.recordSearchStarted();
    stats.recordSearchStarted();
    const daily = stats.getReport(3).daily;
    expect(daily.map((d) => [d.date, d.searches])).toEqual([
      ['2026-10-24', 0],
      ['2026-10-25', 1],
      ['2026-10-26', 2],
    ]);
  });

  it('báo cáo điền 0 cho ngày không có dữ liệu và tính đúng cửa sổ 7/30 ngày', () => {
    const c = clock('2026-10-01T05:00:00Z');
    const stats = new StatsService({ ...c, flushIntervalMs: 0 });
    stats.recordVisit('1.1.1.1', 'a');
    c.set('2026-10-20T05:00:00Z');
    stats.recordVisit('1.1.1.1', 'a'); // cùng người ở ngày khác
    stats.recordVisit('2.2.2.2', 'a');
    const report = stats.getReport(30);
    expect(report.daily).toHaveLength(30);
    expect(report.today.visitors).toBe(2);
    expect(report.last7Days.visitors).toBe(2);
    expect(report.last30Days.visitors).toBe(2); // hợp của cả hai ngày: người 1.1.1.1 chỉ tính một lần
    expect(report.allTime.visitors).toBe(2);
  });

  it('giới hạn số ngày trong báo cáo theo thời hạn lưu trữ', () => {
    const stats = new StatsService({ ...clock(), retentionDays: 30, flushIntervalMs: 0 });
    expect(stats.getReport(9999).daily).toHaveLength(30);
    expect(stats.getReport(0).daily).toHaveLength(1);
  });

  it('không ném lỗi khi dữ liệu ghi nhận bất thường', () => {
    const stats = new StatsService({ ...clock(), flushIntervalMs: 0 });
    expect(() => stats.recordSearchOutcome({ kind: 'completed', total: NaN, sources: [] })).not.toThrow();
  });
});

describe('StatsService - lưu trữ', () => {
  it('ghi ra file và nạp lại đầy đủ sau khi khởi động lại', () => {
    const file = path.join(tmp(), 'nested', 'stats.json');
    const a = new StatsService({ ...clock(), filePath: file, flushIntervalMs: 0 });
    a.recordVisit('1.1.1.1', 'Chrome');
    a.recordSearchStarted();
    a.recordSearchSources(['arxiv']);
    a.recordSearchOutcome({ kind: 'completed', total: 7, sources: [{ source: 'arxiv', state: 'ok' }] });
    a.recordExport();
    a.flush();

    const b = new StatsService({ ...clock(), filePath: file, flushIntervalMs: 0 });
    b.recordVisit('1.1.1.1', 'Chrome'); // cùng người: mã băm ổn định giữa các lần chạy
    const report = b.getReport();
    expect(report.persistent).toBe(true);
    expect(report.today).toMatchObject({ visitors: 1, searches: 1, exports: 1 });
    expect(report.sources[0]).toMatchObject({ source: 'arxiv', used: 1 });
  });

  it('file không chứa IP hay User-Agent thô', () => {
    const file = path.join(tmp(), 'stats.json');
    const stats = new StatsService({ ...clock(), filePath: file, flushIntervalMs: 0 });
    stats.recordVisit('203.0.113.77', 'SuperSecretBrowser/9.9');
    stats.flush();
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('203.0.113.77');
    expect(text).not.toContain('SuperSecretBrowser');
  });

  it('file hỏng: không sập, giữ lại bản sao và bắt đầu lại', () => {
    const dir = tmp();
    const file = path.join(dir, 'stats.json');
    writeFileSync(file, '{ không phải json', 'utf8');
    const stats = new StatsService({ ...clock(), filePath: file, flushIntervalMs: 0 });
    expect(stats.getReport().allTime.searches).toBe(0);
    expect(readdirSync(dir).some((name) => name.startsWith('stats.json.corrupt-'))).toBe(true);
  });

  it('xóa dữ liệu quá thời hạn lưu trữ khi ghi file', () => {
    const file = path.join(tmp(), 'stats.json');
    const c = clock('2026-01-01T05:00:00Z');
    const stats = new StatsService({ ...c, filePath: file, retentionDays: 7, flushIntervalMs: 0 });
    stats.recordSearchStarted(); // ngày cũ
    c.set('2026-03-01T05:00:00Z');
    stats.recordSearchStarted();
    stats.flush();
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { days: Record<string, unknown> };
    expect(Object.keys(saved.days)).toEqual(['2026-03-01']);
  });

  it('không có filePath thì chỉ lưu trong bộ nhớ', () => {
    const stats = new StatsService({ ...clock(), flushIntervalMs: 0 });
    expect(stats.getReport().persistent).toBe(false);
    expect(() => stats.flush()).not.toThrow();
  });
});

import { existsSync, readFileSync } from 'node:fs';
import type { PaperRecord } from '../../../shared/types.js';
import { normalizeIssn } from '../lib/signals.js';

export interface JournalRank {
  quartile: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  sjr: number;
  title: string;
}

/** Tách một dòng CSV có dấu phân cách `;` và ô được đặt trong ngoặc kép (định dạng file của SCImago). */
function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      cells.push(cell);
      cell = '';
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

const QUARTILE_ORDER = ['Q1', 'Q2', 'Q3', 'Q4'] as const;

/**
 * Xếp hạng tạp chí theo phần tư SJR (Q1 cao nhất), tra theo ISSN. Dữ liệu là file CSV do chủ web tự tải từ
 * scimagojr.com (Journal Rankings -> Download data) và đặt vào máy chủ; ứng dụng không kèm sẵn dữ liệu này.
 */
export class JournalRanker {
  private constructor(private readonly byIssn: Map<string, JournalRank>) {}

  get size(): number {
    return this.byIssn.size;
  }

  static fromCsv(text: string): JournalRanker {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const map = new Map<string, JournalRank>();
    const header = lines[0];
    if (!header) return new JournalRanker(map);
    const delimiter = header.includes(';') ? ';' : ',';
    const names = splitRow(header, delimiter).map((h) => h.trim().toLowerCase());
    const col = (name: string) => names.indexOf(name);
    const iTitle = col('title');
    const iIssn = col('issn');
    const iSjr = col('sjr');
    const iQuartile = col('sjr best quartile');
    if (iIssn < 0 || iQuartile < 0) return new JournalRanker(map);

    for (const line of lines.slice(1)) {
      const cells = splitRow(line, delimiter);
      const quartile = (cells[iQuartile] ?? '').trim().toUpperCase();
      if (!(QUARTILE_ORDER as readonly string[]).includes(quartile)) continue;
      const sjr = Number((cells[iSjr] ?? '').replace(',', '.'));
      const rank: JournalRank = { quartile: quartile as JournalRank['quartile'], sjr: Number.isFinite(sjr) ? sjr : 0, title: (cells[iTitle] ?? '').trim() };
      for (const raw of (cells[iIssn] ?? '').split(/[,\s]+/)) {
        const issn = normalizeIssn(raw);
        if (!issn) continue;
        // Cùng một ISSN xuất hiện ở nhiều dòng thì giữ hạng tốt hơn.
        const existing = map.get(issn);
        if (!existing || QUARTILE_ORDER.indexOf(rank.quartile) < QUARTILE_ORDER.indexOf(existing.quartile)) map.set(issn, rank);
      }
    }
    return new JournalRanker(map);
  }

  /** Nạp từ file; trả undefined nếu chưa có file (tính năng sẽ tự tắt, không báo lỗi). */
  static fromFile(path: string): JournalRanker | undefined {
    if (!existsSync(path)) return undefined;
    const ranker = JournalRanker.fromCsv(readFileSync(path, 'utf8'));
    return ranker.size > 0 ? ranker : undefined;
  }

  /** Hạng tốt nhất trong các ISSN của tạp chí (một tạp chí có thể có cả ISSN in và online). */
  rankOf(issns: string[] | undefined): JournalRank | undefined {
    let best: JournalRank | undefined;
    for (const issn of issns ?? []) {
      const rank = this.byIssn.get(issn);
      if (rank && (!best || QUARTILE_ORDER.indexOf(rank.quartile) < QUARTILE_ORDER.indexOf(best.quartile))) best = rank;
    }
    return best;
  }

  /** Gắn hạng tạp chí vào các bản ghi có ISSN khớp; bản ghi không khớp được giữ nguyên. */
  enrich(records: PaperRecord[]): PaperRecord[] {
    return records.map((record) => {
      const rank = this.rankOf(record.issn);
      return rank ? { ...record, journalQuartile: rank.quartile, journalSjr: rank.sjr } : record;
    });
  }
}

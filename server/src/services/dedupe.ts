import type { Author, PaperRecord, SuspectedDuplicate } from '../../../shared/types.js';
import { authorKey, normalizeTitle } from '../lib/text.js';

export interface DedupeResult {
  records: PaperRecord[];
  duplicatesRemoved: number;
  suspectedDuplicates: SuspectedDuplicate[];
}

/** Tiêu đề quá ngắn (vd. "Editorial") trùng nhau quá dễ nên không dùng làm bằng chứng gộp. */
const MIN_MERGE_TITLE_LENGTH = 10;
/** Chỉ cảnh báo "nghi trùng" với tiêu đề đủ dài để việc trùng không phải ngẫu nhiên. */
const MIN_SUSPECT_TITLE_LENGTH = 20;
const MAX_SUSPECT_BUCKET = 6;

type Relation = 'equal' | 'close' | 'conflict' | 'unknown';

function yearRelation(a: number | null, b: number | null): Relation {
  if (a === null || b === null) return 'unknown';
  if (a === b) return 'equal';
  return Math.abs(a - b) === 1 ? 'close' : 'conflict'; // chênh 1 năm: bản online và bản in
}

function authorRelation(a: Author[], b: Author[]): Relation {
  if (a.length === 0 || b.length === 0) return 'unknown';
  const keysA = a.map(authorKey).filter(Boolean);
  const keysB = b.map(authorKey).filter(Boolean);
  if (keysA.length === 0 || keysB.length === 0) return 'unknown';
  if (keysA[0] === keysB[0]) return 'equal';
  const setB = new Set(keysB);
  const shared = new Set(keysA.filter((key) => setB.has(key))).size;
  const union = new Set([...keysA, ...keysB]).size;
  return shared / union >= 0.5 ? 'equal' : 'conflict';
}

/**
 * Hai bản ghi KHÔNG có DOI chung chỉ được gộp khi tiêu đề trùng khớp VÀ có thêm bằng chứng độc lập:
 * tác giả khớp (năm không mâu thuẫn), hoặc năm khớp khi chưa biết tác giả. Thiếu bằng chứng -> không gộp.
 */
function hasMergeEvidence(a: PaperRecord, b: PaperRecord): boolean {
  const year = yearRelation(a.publicationYear, b.publicationYear);
  const authors = authorRelation(a.authors, b.authors);
  if (authors === 'equal' && year !== 'conflict') return true;
  return year === 'equal' && authors === 'unknown';
}

function completeness(record: PaperRecord): number {
  return [
    record.title,
    record.doi,
    record.authors.length > 0,
    record.publicationYear !== null,
    record.journal,
    record.publisher,
    record.documentType,
    record.abstract,
    record.originalUrl,
  ].filter(Boolean).length;
}

/**
 * Gộp các bản ghi của cùng một bài báo: lấy bản đầy đủ nhất làm gốc, chỉ điền vào ô còn trống
 * (không bao giờ ghi đè dữ liệu hợp lệ bằng dữ liệu rỗng), giữ lại mọi nguồn và từ khóa.
 */
export function mergeRecords(members: PaperRecord[]): PaperRecord {
  const sorted = [...members].sort((a, b) => completeness(b) - completeness(a));
  const base: PaperRecord = { ...sorted[0]! };

  for (const other of sorted.slice(1)) {
    if (!base.title) base.title = other.title;
    if (!base.doi) base.doi = other.doi;
    if (base.authors.length === 0) base.authors = other.authors;
    if (base.publicationYear === null) base.publicationYear = other.publicationYear;
    if (!base.journal) base.journal = other.journal;
    if (!base.publisher) base.publisher = other.publisher;
    if (!base.documentType) {
      base.documentType = other.documentType;
      base.isPreprint = other.isPreprint;
    }
    if (!base.originalUrl) base.originalUrl = other.originalUrl;
    for (const field of ['volume', 'issue', 'pages', 'place'] as const) {
      if (!base[field] && other[field]) base[field] = other[field];
    }
    if (other.abstract.length > base.abstract.length) base.abstract = other.abstract;
  }

  // Truy cập mở: chỉ cần một nguồn xác nhận là bản mở thì bài được coi là miễn phí. URL, giấy phép và trạng thái
  // chỉ lấy từ các bản ghi xác nhận là mở (tránh trạng thái "closed" của nguồn này che bản mở của nguồn khác).
  const openMembers = sorted.filter((m) => m.isOpenAccess);
  base.isOpenAccess = openMembers.length > 0;
  base.oaPdfUrl = openMembers.find((m) => m.oaPdfUrl)?.oaPdfUrl ?? '';
  base.oaUrl = openMembers.find((m) => m.oaUrl)?.oaUrl ?? '';
  base.oaLicense = openMembers.find((m) => m.oaLicense)?.oaLicense ?? '';
  base.oaStatus = (openMembers.find((m) => m.oaStatus) ?? base).oaStatus;

  base.sources = [...new Set(members.flatMap((m) => m.sources))];
  base.queryKeywords = [...new Set(members.flatMap((m) => m.queryKeywords))];
  const refs = new Map<string, PaperRecord['sourceRefs'][number]>();
  for (const ref of members.flatMap((m) => m.sourceRefs)) refs.set(`${ref.source}|${ref.sourceId}`, ref);
  base.sourceRefs = [...refs.values()];
  return base;
}

interface Group {
  members: PaperRecord[];
  merged: PaperRecord;
}

function suspectReason(a: PaperRecord, b: PaperRecord): string {
  if (a.doi && b.doi && a.doi !== b.doi) {
    return 'Cùng tiêu đề nhưng DOI khác nhau (có thể là bản preprint và bản xuất bản, hoặc bản ghi trùng).';
  }
  if (yearRelation(a.publicationYear, b.publicationYear) === 'conflict') {
    return 'Cùng tiêu đề nhưng năm xuất bản khác nhau.';
  }
  return 'Cùng tiêu đề nhưng thiếu năm hoặc tác giả để xác nhận là cùng một bài.';
}

export function dedupeRecords(input: PaperRecord[]): DedupeResult {
  const groups: Group[] = [];
  const byDoi = new Map<string, Group>();
  const byTitle = new Map<string, Group[]>();

  const indexTitle = (group: Group, record: PaperRecord) => {
    const key = normalizeTitle(record.title);
    if (key.length < MIN_MERGE_TITLE_LENGTH) return;
    const bucket = byTitle.get(key) ?? [];
    if (!bucket.includes(group)) bucket.push(group);
    byTitle.set(key, bucket);
  };

  const addMember = (group: Group, record: PaperRecord) => {
    group.members.push(record);
    group.merged = mergeRecords(group.members);
    indexTitle(group, record);
  };

  const newGroup = (record: PaperRecord): Group => {
    const group: Group = { members: [record], merged: record };
    groups.push(group);
    indexTitle(group, record);
    return group;
  };

  // Bước 1: DOI đã chuẩn hóa là khóa gộp đáng tin cậy nhất.
  for (const record of input) {
    if (!record.doi) continue;
    const existing = byDoi.get(record.doi);
    if (existing) addMember(existing, record);
    else byDoi.set(record.doi, newGroup(record));
  }

  // Bước 2: bản ghi không có DOI - cần tiêu đề + bằng chứng bổ sung, và phải xác định duy nhất một đích.
  for (const record of input) {
    if (record.doi) continue;
    const key = normalizeTitle(record.title);
    const candidates = key.length >= MIN_MERGE_TITLE_LENGTH ? (byTitle.get(key) ?? []) : [];
    const matches = candidates.filter((group) => hasMergeEvidence(record, group.merged));
    if (matches.length === 1) addMember(matches[0]!, record);
    else newGroup(record);
  }

  const records = groups.map((group, index) => ({
    ...group.merged,
    id: group.merged.doi ? `doi:${group.merged.doi}` : `n:${index}`,
  }));

  // Các bản ghi còn lại cùng tiêu đề (không đủ bằng chứng để gộp) được báo là "nghi trùng".
  const buckets = new Map<string, PaperRecord[]>();
  for (const record of records) {
    const key = normalizeTitle(record.title);
    if (key.length < MIN_SUSPECT_TITLE_LENGTH) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  }
  const suspectedDuplicates: SuspectedDuplicate[] = [];
  for (const bucket of buckets.values()) {
    const limited = bucket.slice(0, MAX_SUSPECT_BUCKET);
    for (let i = 0; i < limited.length; i++) {
      for (let j = i + 1; j < limited.length; j++) {
        // Tác giả hoàn toàn khác nhau = các tác phẩm khác nhau trùng tiêu đề chung chung -> không phải nghi trùng.
        if (authorRelation(limited[i]!.authors, limited[j]!.authors) === 'conflict') continue;
        suspectedDuplicates.push({
          recordIds: [limited[i]!.id, limited[j]!.id],
          reason: suspectReason(limited[i]!, limited[j]!),
        });
      }
    }
  }

  return { records, duplicatesRemoved: input.length - records.length, suspectedDuplicates };
}

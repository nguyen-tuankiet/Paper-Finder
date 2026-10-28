import { z } from 'zod';
import { MAX_RESULT_OPTIONS, PAID_TIERS, PLAN_PERIODS, SOURCE_IDS, type SearchRequest } from '../../shared/types.js';

const MAX_KEYWORDS = 10;
const currentYear = () => new Date().getUTCFullYear();

const keyword = z
  .string()
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Từ khóa phải có ít nhất 2 ký tự.').max(200, 'Mỗi từ khóa tối đa 200 ký tự.'));

export const searchRequestSchema = z
  .object({
    keywords: z
      .array(keyword)
      .min(1, 'Nhập ít nhất một từ khóa.')
      .max(MAX_KEYWORDS, `Tối đa ${MAX_KEYWORDS} từ khóa mỗi lần tìm.`),
    sources: z
      .array(z.enum(SOURCE_IDS))
      .min(1, 'Chọn ít nhất một nguồn dữ liệu.')
      .max(SOURCE_IDS.length),
    maxResults: z
      .number()
      .refine((n): n is (typeof MAX_RESULT_OPTIONS)[number] => (MAX_RESULT_OPTIONS as readonly number[]).includes(n), {
        message: `Số kết quả tối đa phải là một trong: ${MAX_RESULT_OPTIONS.join(', ')}.`,
      }),
    yearFrom: z.number().int().min(1000).max(currentYear() + 1).optional(),
    yearTo: z.number().int().min(1000).max(currentYear() + 1).optional(),
    onlyWithDoi: z.boolean().default(true),
  })
  .strict()
  .refine((value) => value.yearFrom === undefined || value.yearTo === undefined || value.yearFrom <= value.yearTo, {
    message: 'Năm bắt đầu phải nhỏ hơn hoặc bằng năm kết thúc.',
    path: ['yearFrom'],
  })
  .transform((value): SearchRequest => {
    // Loại từ khóa trùng (không phân biệt hoa thường) và nguồn trùng nhưng giữ thứ tự nhập.
    const seen = new Set<string>();
    const keywords = value.keywords.filter((k) => {
      const key = k.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...value, keywords, sources: [...new Set(value.sources)] };
  });

const exportRecordSchema = z.object({
  title: z.string().max(5000),
  doi: z.string().max(500),
  authors: z.array(z.object({ name: z.string().max(500), given: z.string().max(500).optional(), family: z.string().max(500).optional() })).max(5000),
  publicationYear: z.number().int().nullable(),
  journal: z.string().max(2000),
  publisher: z.string().max(2000),
  documentType: z.string().max(200),
  abstract: z.string().max(200_000),
  sources: z.array(z.string().max(50)).max(10),
  originalUrl: z.string().max(5000),
  queryKeywords: z.array(z.string().max(500)).max(50),
  oaUrl: z.string().max(5000).optional(),
  oaPdfUrl: z.string().max(5000).optional(),
  oaLicense: z.string().max(100).optional(),
  volume: z.string().max(100).optional(),
  issue: z.string().max(100).optional(),
  pages: z.string().max(100).optional(),
  place: z.string().max(500).optional(),
});

export const exportRequestSchema = z.object({
  format: z.enum(['xlsx', 'csv', 'bibtex', 'ris']),
  records: z.array(exportRecordSchema).min(1, 'Không có bài báo nào để xuất.').max(20000),
});

// ---------- Tài khoản ----------

const email = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.string().max(254, 'Email quá dài.').regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email không hợp lệ.'));

const password = z.string().min(8, 'Mật khẩu cần ít nhất 8 ký tự.').max(200, 'Mật khẩu tối đa 200 ký tự.');

export const registerSchema = z.object({ email, password }).strict();
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password }).strict();
export const checkoutSchema = z.object({ tier: z.enum(PAID_TIERS), period: z.enum(PLAN_PERIODS) }).strict();
export const confirmPaymentSchema = z.object({ orderCode: z.number().int().positive() }).strict();

/** Bài lưu vào thư viện: giữ nguyên bản ghi PaperRecord của giao diện, chỉ kiểm tra các trường cốt lõi và giới hạn kích thước. */
export const savedPaperSchema = z.looseObject({
  id: z.string().max(200),
  title: z.string().max(5000),
  doi: z.string().max(500),
  authors: z.array(z.looseObject({ name: z.string().max(500) })).max(500),
  publicationYear: z.number().int().nullable(),
  journal: z.string().max(2000),
  publisher: z.string().max(2000),
  documentType: z.string().max(200),
  abstract: z.string().max(60_000),
  sources: z.array(z.string().max(50)).max(10),
  originalUrl: z.string().max(5000),
  queryKeywords: z.array(z.string().max(500)).max(50),
});

export const saveLibrarySchema = z.object({ record: savedPaperSchema, folder: z.string().trim().max(60).default('') }).strict();

export const adminGrantSchema = z.object({ email, tier: z.enum(PAID_TIERS).default('pro'), days: z.number().int().min(1).max(3650) }).strict();

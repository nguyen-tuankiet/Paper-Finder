/** Thông tin tác giả và các ứng dụng khác - chỉnh tại đây để cập nhật footer và khu giới thiệu. */
export const AUTHOR = {
  name: 'Nguyễn Tuấn Kiệt',
  github: 'https://github.com/nguyen-tuankiet?tab=repositories',
};

export interface OtherApp {
  key: 'cocoflow' | 'muse';
  name: string;
  url: string;
  tagline: string;
  description?: string;
  tags: string[];
}

export const OTHER_APPS: OtherApp[] = [
  {
    key: 'cocoflow',
    name: 'Cocoflow',
    url: 'https://coco-flow-zeta.vercel.app/',
    tagline: 'Thao tác chuyển đổi file trong tích tắc',
    tags: ['Chuyển đổi file'],
  },
  {
    key: 'muse',
    name: 'Muse Studio',
    url: 'https://muse-studio-landing.vercel.app/',
    tagline: 'Tạo video YouTube tự động, nhanh chóng và dễ dàng',
    description: 'Dùng AI tạo video YouTube theo chủ đề của từng kênh, duyệt trước khi đăng và đặt lịch đăng hằng ngày.',
    tags: ['AI', 'YouTube', 'Lên lịch'],
  },
];

/** Nguồn dữ liệu hiển thị ở footer (trang chủ của từng nguồn). */
export const DATA_SOURCE_LINKS: { name: string; url: string }[] = [
  { name: 'Crossref', url: 'https://www.crossref.org' },
  { name: 'OpenAlex', url: 'https://openalex.org' },
  { name: 'Europe PMC', url: 'https://europepmc.org' },
  { name: 'DOAJ', url: 'https://doaj.org' },
  { name: 'arXiv', url: 'https://arxiv.org' },
];

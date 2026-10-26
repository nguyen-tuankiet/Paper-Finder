/** Thông tin tác giả, footer và các ứng dụng khác - chỉnh tại đây để cập nhật chân trang và khu giới thiệu. */
export const AUTHOR = {
  name: 'Nguyễn Tuấn Kiệt',
  github: 'https://github.com/nguyen-tuankiet?tab=repositories',
  /**
   * Liên kết mạng xã hội hiện ở footer. Để trống = ẩn icon đó (không hiện liên kết giả).
   * Ví dụ: youtube: 'https://youtube.com/@kenh-cua-ban', email: 'mailto:ban@example.com'
   */
  socials: {
    youtube: '',
    linkedin: '',
    x: '',
    email: '',
  },
};

export const FOOTER = {
  tagline: 'Tìm kiếm tri thức, kết nối tương lai',
  description: 'Công cụ tìm kiếm và quản lý tài liệu khoa học dành cho sinh viên, giảng viên và người làm nghiên cứu. Dữ liệu từ các nguồn học thuật uy tín trên thế giới.',
  slogan: ['Kiến thức hôm nay', 'Thành công ngày mai'],
};

export interface OtherApp {
  key: 'cocoflow' | 'muse';
  name: string;
  url: string;
  tagline: string;
  description?: string;
}

export const OTHER_APPS: OtherApp[] = [
  {
    key: 'cocoflow',
    name: 'Cocoflow',
    url: 'https://coco-flow-zeta.vercel.app/',
    tagline: 'Thao tác chuyển đổi file trong tích tắc',
  },
  {
    key: 'muse',
    name: 'Muse Studio',
    url: 'https://muse-studio-landing.vercel.app/',
    tagline: 'Tạo video YouTube tự động, nhanh chóng và dễ dàng',
    description: 'Dùng AI tạo video YouTube theo chủ đề của từng kênh, duyệt trước khi đăng và đặt lịch đăng hằng ngày.',
  },
];

/**
 * Nguồn dữ liệu hiển thị ở footer (trang chủ của từng nguồn). `color`/`letter`: ô màu nhận diện đơn giản,
 * KHÔNG phải logo chính thức của các tổ chức này.
 */
export const DATA_SOURCE_LINKS: { name: string; url: string; color: string; letter: string }[] = [
  { name: 'Crossref', url: 'https://www.crossref.org', color: '#e0523a', letter: 'C' },
  { name: 'OpenAlex', url: 'https://openalex.org', color: '#1fa6d1', letter: 'O' },
  { name: 'Europe PMC', url: 'https://europepmc.org', color: '#2f9a4f', letter: 'E' },
  { name: 'DOAJ', url: 'https://doaj.org', color: '#e3832a', letter: 'D' },
  { name: 'arXiv', url: 'https://arxiv.org', color: '#c1302f', letter: 'x' },
];

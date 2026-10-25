/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL gốc của backend khi frontend và backend deploy riêng (vd. https://api.example.com). Để trống nếu cùng origin. */
  readonly VITE_API_BASE_URL?: string;
}

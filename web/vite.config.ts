import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Khi chạy dev, chuyển /api sang backend để không cần cấu hình CORS.
      '/api': { target: process.env.VITE_DEV_API_TARGET ?? 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: { include: ['src/**/*.test.ts'] },
});

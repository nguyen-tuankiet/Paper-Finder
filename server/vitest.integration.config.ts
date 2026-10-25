import { defineConfig } from 'vitest/config';

// Kiểm thử tích hợp gọi API thật (Crossref, OpenAlex) - cần Internet.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 90000,
    hookTimeout: 90000,
    fileParallelism: false,
  },
});

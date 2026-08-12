import { defineConfig } from 'vitest/config';

// Тесты — только по domain/: чистая логика, без сети и без базы (docs/02-architecture.md).
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});

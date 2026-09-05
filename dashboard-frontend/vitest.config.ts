import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Story 2.3 (Code Map/Boundaries): "frontend dùng Vitest + @testing-library/
// react (công cụ test FE đầu tiên của repo)".
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});

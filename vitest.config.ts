import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Pure modules run in node. Component tests opt in to a DOM with
// `// @vitest-environment happy-dom` at the top of the file.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    restoreMocks: true,
  },
});

import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Static site: every runtime URL is built from import.meta.env.BASE_URL, so a relative base
// lets the build run from any path (docs/ARCHITECTURE.md §16).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // The About dialog shows package.json's version (src/main.tsx).
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  build: {
    // The build manifest lets tools/build/audit-dist.ts measure the entry chunk (§14); the audit
    // then deletes dist/.vite (`--strip-manifest` in `pnpm build`), so it never deploys.
    manifest: true,
    sourcemap: false,
    target: 'es2023',
  },
});

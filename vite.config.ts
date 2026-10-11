import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** "1.0.0+abc1234": the package version and the commit (Vercel's, or the local checkout's). */
function appVersion(): string {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  if (!sha) {
    try {
      sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch {
      sha = '';
    }
  }
  return sha ? `${version}+${sha.trim().slice(0, 7)}` : version;
}

/** The public address, for absolute links in index.html (share cards need them). */
const SITE_URL = process.env.SITE_URL ?? 'https://basepinball.vercel.app';

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    {
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', SITE_URL),
    },
  ],
  // Preact's automatic JSX runtime for the UI (src/ui).
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Three.js (WebGPU build) dominates the bundle; the real budget is 400 KB gzipped (docs/MVP/04 § 6).
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Physics suites run many seconds of simulated play; allow for loaded CI machines.
    testTimeout: 60_000,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
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

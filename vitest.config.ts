import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration test files all share ONE live dev database (no per-file/per-test isolated DB
    // exists), and several fixtures reuse common reference rows (e.g. "chapter 1 of MATH-SEED").
    // Running files in parallel let one file's in-flight fixture questions become eligible
    // picks for another file's concurrently-generating paper -- observed as both cross-test data
    // contamination and FK-violation cleanup failures. Sequential file execution is the fix.
    fileParallelism: false,
  },
})

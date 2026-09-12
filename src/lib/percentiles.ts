// F108: the p95 calculation for scripts/load-test.ts's own report -- pulled into src/lib (rather
// than left inline in the script) so it gets the same unit-test coverage as every other pure
// function in this codebase, since vitest only picks up src/**/*.test.ts.
export function p95(valuesMs: Array<number>): number {
  if (valuesMs.length === 0) return 0
  const sorted = [...valuesMs].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)
  return sorted[index]
}

import { describe, expect, it } from 'vitest'
import { p95 } from './percentiles'

describe('p95 (F108 load-test report)', () => {
  it('returns 0 for an empty array', () => {
    expect(p95([])).toBe(0)
  })

  it('returns the single value for a one-element array', () => {
    expect(p95([42])).toBe(42)
  })

  it('returns the 95th-percentile value for a sorted 100-element array', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    // ceil(0.95 * 100) = 95th value, 1-indexed -> value 95
    expect(p95(values)).toBe(95)
  })

  it('does not mutate the input array', () => {
    const values = [5, 1, 4, 2, 3]
    const copy = [...values]
    p95(values)
    expect(values).toEqual(copy)
  })

  it('handles an unsorted array correctly', () => {
    expect(p95([100, 1, 2, 3, 4])).toBe(100)
  })
})

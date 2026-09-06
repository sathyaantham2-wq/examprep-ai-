import { describe, expect, it } from 'vitest'
import {
  allocateByWeighting,
  allocateProportionally,
  computeChapterMarksTargets,
  difficultiesUpTo,
  DEFAULT_WEIGHTING,
} from './papers'

describe('difficultiesUpTo (F119 ceiling)', () => {
  it('Easy ceiling only allows Easy', () => {
    expect(difficultiesUpTo('Easy')).toEqual(['Easy'])
  })

  it('Hard ceiling allows Easy and Hard, not Hardest', () => {
    expect(difficultiesUpTo('Hard')).toEqual(['Easy', 'Hard'])
  })

  it('Hardest ceiling allows all three tiers', () => {
    expect(difficultiesUpTo('Hardest')).toEqual(['Easy', 'Hard', 'Hardest'])
  })
})

describe('allocateByWeighting (F028 40/40/20)', () => {
  it('always sums to the requested total, even when it does not divide evenly', () => {
    for (let total = 1; total <= 25; total++) {
      const allocation = allocateByWeighting(total, DEFAULT_WEIGHTING)
      const sum =
        allocation.weak_priority + allocation.needs_practice + allocation.strong
      expect(sum).toBe(total)
    }
  })

  it('matches the 40/40/20 split exactly when the total divides evenly', () => {
    const allocation = allocateByWeighting(10, DEFAULT_WEIGHTING)
    expect(allocation).toEqual({
      weak_priority: 4,
      needs_practice: 4,
      strong: 2,
    })
  })

  it('gives the leftover slot to the bucket with the largest fractional remainder', () => {
    // 5 * 0.4 = 2.0, 5 * 0.4 = 2.0, 5 * 0.2 = 1.0 -- no remainder to distribute, sums to 5.
    const allocation = allocateByWeighting(5, DEFAULT_WEIGHTING)
    expect(
      allocation.weak_priority + allocation.needs_practice + allocation.strong,
    ).toBe(5)

    // 100% weighting to a single bucket is the simplest possible check of the apportionment.
    const singleBucket = allocateByWeighting(7, {
      weak_priority: 100,
      needs_practice: 0,
      strong: 0,
    })
    expect(singleBucket).toEqual({
      weak_priority: 7,
      needs_practice: 0,
      strong: 0,
    })
  })

  it('handles a zero total without error', () => {
    const allocation = allocateByWeighting(0, DEFAULT_WEIGHTING)
    expect(allocation).toEqual({
      weak_priority: 0,
      needs_practice: 0,
      strong: 0,
    })
  })
})

describe('allocateProportionally (generic apportionment underlying F028 and F113)', () => {
  it('normalises by the weights own sum, not an assumed 100', () => {
    // 1:1:2 has the same proportions as 25:25:50 but doesn't sum to 100 itself.
    const allocation = allocateProportionally(8, { a: 1, b: 1, c: 2 })
    expect(allocation).toEqual({ a: 2, b: 2, c: 4 })
  })

  it('always sums to the requested total regardless of key count', () => {
    for (let total = 1; total <= 20; total++) {
      const allocation = allocateProportionally(total, { a: 7, b: 3, c: 5 })
      const sum = allocation.a + allocation.b + allocation.c
      expect(sum).toBe(total)
    }
  })

  it('splits evenly rather than dividing by zero when every weight is zero', () => {
    const allocation = allocateProportionally(9, { a: 0, b: 0, c: 0 })
    expect(allocation).toEqual({ a: 3, b: 3, c: 3 })
    expect(allocation.a + allocation.b + allocation.c).toBe(9)
  })

  it('gives a zero-weight key nothing when other keys have real weight', () => {
    const allocation = allocateProportionally(10, { a: 100, b: 0 })
    expect(allocation).toEqual({ a: 10, b: 0 })
  })
})

describe('computeChapterMarksTargets (F113)', () => {
  it('splits marks proportionally to concept count by default', () => {
    const targets = computeChapterMarksTargets(20, { ch1: 3, ch2: 1 })
    expect(targets).toEqual({ ch1: 15, ch2: 5 })
  })

  it('gives a chapter with zero concepts a zero target rather than erroring', () => {
    const targets = computeChapterMarksTargets(10, { ch1: 5, ch2: 0 })
    expect(targets).toEqual({ ch1: 10, ch2: 0 })
  })

  it('an override replaces the concept-count default entirely', () => {
    // ch1 has far more concepts, but the override says weight it lower anyway.
    const targets = computeChapterMarksTargets(
      10,
      { ch1: 9, ch2: 1 },
      { ch1: 20, ch2: 80 },
    )
    expect(targets).toEqual({ ch1: 2, ch2: 8 })
  })

  it('splits evenly when every chapter in scope has zero concepts', () => {
    const targets = computeChapterMarksTargets(6, { ch1: 0, ch2: 0 })
    expect(targets).toEqual({ ch1: 3, ch2: 3 })
  })
})

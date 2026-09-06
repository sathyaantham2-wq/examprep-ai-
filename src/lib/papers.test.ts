import { describe, expect, it } from 'vitest'
import {
  allocateByWeighting,
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

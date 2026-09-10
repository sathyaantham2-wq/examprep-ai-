import { describe, expect, it } from 'vitest'
import { computeStreakDays } from './student-dashboard'

function daysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

describe('computeStreakDays (F072)', () => {
  it('returns 0 for no active days', () => {
    expect(computeStreakDays([])).toBe(0)
  })

  it('counts consecutive days ending today', () => {
    expect(computeStreakDays([daysAgo(0), daysAgo(1), daysAgo(2)])).toBe(3)
  })

  it('still counts a streak that ended yesterday (survives until end of today)', () => {
    expect(computeStreakDays([daysAgo(1), daysAgo(2)])).toBe(2)
  })

  it('stops at the first gap', () => {
    expect(computeStreakDays([daysAgo(0), daysAgo(1), daysAgo(3)])).toBe(2)
  })

  it('is 0 when the most recent active day was two or more days ago', () => {
    expect(computeStreakDays([daysAgo(2), daysAgo(3)])).toBe(0)
  })

  it('ignores duplicate day strings', () => {
    expect(computeStreakDays([daysAgo(0), daysAgo(0), daysAgo(1)])).toBe(2)
  })
})

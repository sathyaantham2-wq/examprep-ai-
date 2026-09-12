import { describe, expect, it } from 'vitest'
import { getTaskList } from './study-plan'
import type { StudyPlanDay } from './study-plan'

function day(overrides: Partial<StudyPlanDay>): StudyPlanDay {
  return {
    day_number: 1,
    date: '2026-01-05',
    subject_name: 'Maths',
    concept_id: 'c1',
    concept_name: 'Fractions',
    activity: 'Practice',
    completed: false,
    ...overrides,
  }
}

describe('getTaskList (F079: tickable, roll over when missed)', () => {
  it("always includes today's own day, whether or not it's completed", () => {
    const days = [day({ day_number: 1, date: '2026-01-05', completed: false })]
    const tasks = getTaskList(days, '2026-01-05')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].is_rollover).toBe(false)
  })

  it('rolls over a past day that was never ticked off', () => {
    const days = [
      day({ day_number: 1, date: '2026-01-05', completed: false }),
      day({ day_number: 2, date: '2026-01-06', completed: false }),
    ]
    // "today" is day 2 -- day 1 is past and incomplete, so it rolls forward.
    const tasks = getTaskList(days, '2026-01-06')
    expect(tasks).toHaveLength(2)
    const rolledOver = tasks.find((t) => t.day_number === 1)
    expect(rolledOver?.is_rollover).toBe(true)
    const today = tasks.find((t) => t.day_number === 2)
    expect(today?.is_rollover).toBe(false)
  })

  it('does not roll over a past day that was already completed', () => {
    const days = [
      day({ day_number: 1, date: '2026-01-05', completed: true }),
      day({ day_number: 2, date: '2026-01-06', completed: false }),
    ]
    const tasks = getTaskList(days, '2026-01-06')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].day_number).toBe(2)
  })

  it('never includes a future day', () => {
    const days = [
      day({ day_number: 1, date: '2026-01-05', completed: false }),
      day({ day_number: 2, date: '2026-01-06', completed: false }),
    ]
    // "today" is day 1 -- day 2 is in the future, not part of today's list yet.
    const tasks = getTaskList(days, '2026-01-05')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].day_number).toBe(1)
  })

  it('rolls over every incomplete past day, not just the most recent one', () => {
    const days = [
      day({ day_number: 1, date: '2026-01-05', completed: false }),
      day({ day_number: 2, date: '2026-01-06', completed: false }),
      day({ day_number: 3, date: '2026-01-07', completed: false }),
    ]
    const tasks = getTaskList(days, '2026-01-07')
    expect(tasks.map((t) => t.day_number).sort()).toEqual([1, 2, 3])
    expect(tasks.filter((t) => t.is_rollover)).toHaveLength(2)
  })

  it('keeps rolling an incomplete day forward no matter how much later "today" is checked', () => {
    // Nobody looked at the plan for weeks -- the missed day is still owed, not silently dropped.
    const days = [day({ day_number: 1, date: '2026-01-05', completed: false })]
    const tasks = getTaskList(days, '2026-02-01')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].is_rollover).toBe(true)
  })
})

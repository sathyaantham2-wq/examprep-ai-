import { describe, expect, it } from 'vitest'
import {
  computeRawStatus,
  computeTrend,
  determineNextStatus,
  determineRetestSchedule,
  RETEST_LADDER_DAYS,
} from './mastery'

describe('computeRawStatus (F062 thresholds)', () => {
  it.each([
    [1, 'Strong'],
    [0.8, 'Strong'],
    [0.79, 'Needs Practice'],
    [0.5, 'Needs Practice'],
    [0.49, 'Weak'],
    [0, 'Weak'],
  ] as const)('ratio %f -> %s', (ratio, expected) => {
    expect(computeRawStatus(ratio)).toBe(expected)
  })
})

describe('computeTrend', () => {
  it('is flat with no prior history', () => {
    expect(computeTrend(0.5, [])).toBe('flat')
  })

  it('is up when clearly better than the recent average', () => {
    expect(computeTrend(0.9, [0.5, 0.6])).toBe('up')
  })

  it('is down when clearly worse than the recent average', () => {
    expect(computeTrend(0.2, [0.5, 0.6])).toBe('down')
  })

  it('is flat within the +/-0.05 noise band', () => {
    expect(computeTrend(0.53, [0.5, 0.5])).toBe('flat')
  })
})

describe('determineNextStatus (F063 escalation state machine)', () => {
  it('a first-ever weak attempt is just Weak, not Priority', () => {
    const status = determineNextStatus({
      ratio: 0.2,
      mostRecentRatio: undefined,
      mostRecentStatus: undefined,
      currentPersistedStatus: undefined,
    })
    expect(status).toBe('Weak')
  })

  it('T18: a second consecutive Weak appearance escalates to Priority', () => {
    const status = determineNextStatus({
      ratio: 0.3,
      mostRecentRatio: 0.2,
      mostRecentStatus: 'Weak',
      currentPersistedStatus: 'Weak',
    })
    expect(status).toBe('Priority')
  })

  it('Priority is sticky: a single good score does not clear the flag', () => {
    const status = determineNextStatus({
      ratio: 0.9,
      mostRecentRatio: 0.3, // the prior attempt was not itself >=85%, so this isn't "two in a row"
      mostRecentStatus: 'Priority',
      currentPersistedStatus: 'Priority',
    })
    expect(status).toBe('Priority')
  })

  it('T19: two consecutive >=85% attempts recover a Priority concept into Maintenance', () => {
    const status = determineNextStatus({
      ratio: 0.9,
      mostRecentRatio: 0.9,
      mostRecentStatus: 'Priority',
      currentPersistedStatus: 'Priority',
    })
    expect(status).toBe('Maintenance')
  })

  it('the full documented sequence: Weak -> Priority -> Priority (holds) -> Maintenance', () => {
    // Mirrors the live curl-tested sequence from M12's build: 20%, 30%, 90%, 90%.
    const attempt1 = determineNextStatus({
      ratio: 0.2,
      mostRecentRatio: undefined,
      mostRecentStatus: undefined,
      currentPersistedStatus: undefined,
    })
    expect(attempt1).toBe('Weak')

    const attempt2 = determineNextStatus({
      ratio: 0.3,
      mostRecentRatio: 0.2,
      mostRecentStatus: attempt1,
      currentPersistedStatus: attempt1,
    })
    expect(attempt2).toBe('Priority')

    const attempt3 = determineNextStatus({
      ratio: 0.9,
      mostRecentRatio: 0.3,
      mostRecentStatus: attempt2,
      currentPersistedStatus: attempt2,
    })
    expect(attempt3).toBe('Priority')

    const attempt4 = determineNextStatus({
      ratio: 0.9,
      mostRecentRatio: 0.9,
      mostRecentStatus: attempt3,
      currentPersistedStatus: attempt3,
    })
    expect(attempt4).toBe('Maintenance')
  })

  it('a middling score does not escalate a merely-Weak (not yet Priority) concept', () => {
    const status = determineNextStatus({
      ratio: 0.6,
      mostRecentRatio: 0.2,
      mostRecentStatus: 'Weak',
      currentPersistedStatus: 'Weak',
    })
    expect(status).toBe('Needs Practice')
  })
})

describe('determineRetestSchedule (F069 spaced re-test ladder)', () => {
  const now = new Date('2026-01-01T00:00:00Z')

  it('a concept freshly cleared from Weak starts the ladder at day 7', () => {
    const { retestStage, nextRetestAt } = determineRetestSchedule({
      status: 'Strong',
      previousStatus: 'Weak',
      previousStage: 0,
      previousNextRetestAt: undefined,
      now,
    })
    expect(retestStage).toBe(0)
    expect(nextRetestAt.getTime() - now.getTime()).toBe(
      RETEST_LADDER_DAYS[0] * 24 * 60 * 60 * 1000,
    )
  })

  it('a scheduled re-test that comes back cleared advances to the next rung (7 -> 21)', () => {
    const { retestStage, nextRetestAt } = determineRetestSchedule({
      status: 'Strong',
      previousStatus: 'Strong',
      previousStage: 0,
      previousNextRetestAt: new Date('2025-12-31T00:00:00Z'), // due before `now`
      now,
    })
    expect(retestStage).toBe(1)
    expect(nextRetestAt.getTime() - now.getTime()).toBe(
      RETEST_LADDER_DAYS[1] * 24 * 60 * 60 * 1000,
    )
  })

  it('advancing past the last rung caps at 60 days rather than growing further', () => {
    const { retestStage, nextRetestAt } = determineRetestSchedule({
      status: 'Maintenance',
      previousStatus: 'Strong',
      previousStage: RETEST_LADDER_DAYS.length - 1,
      previousNextRetestAt: new Date('2025-12-31T00:00:00Z'),
      now,
    })
    expect(retestStage).toBe(RETEST_LADDER_DAYS.length - 1)
    expect(nextRetestAt.getTime() - now.getTime()).toBe(
      RETEST_LADDER_DAYS.at(-1)! * 24 * 60 * 60 * 1000,
    )
  })

  it('bonus practice before the scheduled date does not advance or reset the ladder', () => {
    const scheduledFor = new Date('2026-01-10T00:00:00Z') // not due yet
    const { retestStage, nextRetestAt } = determineRetestSchedule({
      status: 'Strong',
      previousStatus: 'Strong',
      previousStage: 0,
      previousNextRetestAt: scheduledFor,
      now,
    })
    expect(retestStage).toBe(0)
    expect(nextRetestAt).toEqual(scheduledFor)
  })

  it('regressing out of Strong/Maintenance resets the ladder to rung 0', () => {
    const { retestStage } = determineRetestSchedule({
      status: 'Weak',
      previousStatus: 'Strong',
      previousStage: 2,
      previousNextRetestAt: new Date('2025-12-31T00:00:00Z'),
      now,
    })
    expect(retestStage).toBe(0)
  })

  it('a not-yet-cleared status uses the short follow-up window, not the ladder', () => {
    const { nextRetestAt } = determineRetestSchedule({
      status: 'Priority',
      previousStatus: undefined,
      previousStage: 0,
      previousNextRetestAt: undefined,
      now,
    })
    expect(nextRetestAt.getTime() - now.getTime()).toBe(3 * 24 * 60 * 60 * 1000)
  })
})

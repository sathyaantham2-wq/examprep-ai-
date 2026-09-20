import { describe, expect, it } from 'vitest'
import { DEFAULT_MASTERY_CONFIG, resolveMasteryConfig } from './config'
import { adaptiveLevel } from './levels'
import type { AdaptiveLevel } from './levels'
import {
  computeMastery,
  effectiveRetentionStatus,
  evolveRetention,
  explainMastery,
} from './engine'
import type { AnswerEvent } from './engine'
import {
  allocateQuestions,
  bucketWeighting,
  computeConceptWeights,
  guaranteeRetention,
} from './weights'
import type { ConceptSignal } from './weights'

const cfg = DEFAULT_MASTERY_CONFIG
const DAY = 24 * 60 * 60 * 1000
const T0 = new Date('2026-09-01T10:00:00Z').getTime()

function ev(
  i: number,
  credit: number,
  level: AdaptiveLevel,
  assessment = 'A1',
): AnswerEvent {
  return {
    questionId: `q${i}`,
    assessmentId: assessment,
    credit,
    level,
    timeSec: 30,
    answeredAt: new Date(T0 + i * 60_000),
  }
}

describe('adaptiveLevel', () => {
  it('splits the standard 20-question grid into 6 / 5 / 6 / 3', () => {
    const grid: Array<[Parameters<typeof adaptiveLevel>[0], Parameters<typeof adaptiveLevel>[1], number]> = [
      ['Remember', 'Easy', 3], ['Remember', 'Hard', 1], ['Understand', 'Easy', 3],
      ['Understand', 'Hard', 2], ['Apply', 'Easy', 2], ['Apply', 'Hard', 3],
      ['Apply', 'Hardest', 1], ['Analyse', 'Hard', 2], ['Analyse', 'Hardest', 1],
      ['Evaluate', 'Hard', 1], ['Create', 'Hardest', 1],
    ]
    const counts = [0, 0, 0, 0, 0]
    for (const [bloom, diff, n] of grid) counts[adaptiveLevel(bloom, diff)] += n
    expect(counts.slice(1)).toEqual([6, 5, 6, 3])
  })
})

describe('computeMastery', () => {
  it('starts every concept at Easy with no score', () => {
    const state = computeMastery([], cfg)
    expect(state.currentLevel).toBe(1)
    expect(state.masteryLevel).toBe('Beginner')
    expect(state.questionsAttempted).toBe(0)
  })

  it('one wrong answer does not collapse a strong score', () => {
    const good = Array.from({ length: 10 }, (_, i) => ev(i, 1, ((i % 3) + 1) as AdaptiveLevel))
    const before = computeMastery(good, cfg)
    const after = computeMastery([...good, ev(10, 0, 2)], cfg)
    expect(before.masteryScore - after.masteryScore).toBeLessThanOrEqual(
      cfg.adjustment.maxDropPerAnswer,
    )
    expect(after.consecutiveWrong).toBe(1)
  })

  it('repeated mistakes drop the score further than a single one', () => {
    const good = Array.from({ length: 10 }, (_, i) => ev(i, 1, ((i % 3) + 1) as AdaptiveLevel))
    const one = computeMastery([...good, ev(10, 0, 2)], cfg)
    const three = computeMastery([...good, ev(10, 0, 2), ev(11, 0, 2), ev(12, 0, 2)], cfg)
    expect(three.masteryScore).toBeLessThan(one.masteryScore)
    expect(three.consecutiveWrong).toBe(3)
  })

  it('restores mastery gradually after mistakes', () => {
    const history = [
      ...Array.from({ length: 6 }, (_, i) => ev(i, 1, 2)),
      ev(6, 0, 2), ev(7, 0, 2), ev(8, 0, 2),
    ]
    const low = computeMastery(history, cfg)
    const recovered = computeMastery(
      [...history, ev(9, 1, 2), ev(10, 1, 2), ev(11, 1, 2)],
      cfg,
    )
    expect(recovered.masteryScore).toBeGreaterThan(low.masteryScore)
    expect(recovered.masteryScore - low.masteryScore).toBeLessThanOrEqual(3 * cfg.adjustment.maxRisePerAnswer)
  })

  it('never reports Mastered from a single test', () => {
    const oneTest = Array.from({ length: 14 }, (_, i) => ev(i, 1, ((i % 4) + 1) as AdaptiveLevel, 'A1'))
    const state = computeMastery(oneTest, cfg)
    expect(state.masteryLevel).not.toBe('Mastered')
    expect(state.evidence.met).toBe(false)
    expect(state.evidence.blockers.join(' ')).toMatch(/separate tests/)
  })

  it('never reports Mastered on easy questions only', () => {
    const easy = Array.from({ length: 16 }, (_, i) => ev(i, 1, 1, i < 8 ? 'A1' : 'A2'))
    const state = computeMastery(easy, cfg)
    expect(state.masteryLevel).not.toBe('Mastered')
    expect(state.masteryScore).toBeLessThanOrEqual(cfg.difficulty.scoreCapByHighestLevel['1'])
  })

  it('reports Mastered only when every evidence condition is met', () => {
    const events = Array.from({ length: 16 }, (_, i) =>
      ev(i, 1, ((i % 4) + 1) as AdaptiveLevel, i < 8 ? 'A1' : 'A2'),
    )
    // Give the score room to climb: more consistent correct answers across both tests.
    const more = [...events, ...Array.from({ length: 10 }, (_, i) => ev(20 + i, 1, ((i % 2) + 3) as AdaptiveLevel, 'A3'))]
    const state = computeMastery(more, cfg)
    expect(state.evidence.met).toBe(true)
    expect(state.masteryLevel).toBe('Mastered')
    expect(state.masteryScore).toBeGreaterThanOrEqual(cfg.levels.mastered)
  })

  it('blocks Mastered when the last 5 answers are weak even with high overall accuracy', () => {
    const strong = Array.from({ length: 30 }, (_, i) =>
      ev(i, 1, ((i % 4) + 1) as AdaptiveLevel, `A${1 + Math.floor(i / 10)}`),
    )
    const slipped = [...strong, ev(30, 0, 2, 'A4'), ev(31, 0, 2, 'A4'), ev(32, 1, 2, 'A4')]
    const state = computeMastery(slipped, cfg)
    expect(state.evidence.met).toBe(false)
    expect(state.masteryLevel).not.toBe('Mastered')
  })

  it('weights recent answers more than old ones', () => {
    const oldBad = [
      ...Array.from({ length: 6 }, (_, i) => ev(i, 0, 1)),
      ...Array.from({ length: 5 }, (_, i) => ev(10 + i, 1, 1)),
    ]
    const oldGood = [
      ...Array.from({ length: 5 }, (_, i) => ev(i, 1, 1)),
      ...Array.from({ length: 6 }, (_, i) => ev(10 + i, 0, 1)),
    ]
    const improving = computeMastery(oldBad, cfg)
    const declining = computeMastery(oldGood, cfg)
    expect(improving.components.recent).toBeGreaterThan(declining.components.recent)
    expect(improving.masteryScore).toBeGreaterThan(declining.masteryScore)
  })

  it('raises difficulty only after a window of good answers, never after one', () => {
    expect(computeMastery([ev(0, 1, 1)], cfg).currentLevel).toBe(1)
    expect(computeMastery([ev(0, 1, 1), ev(1, 1, 1)], cfg).currentLevel).toBe(1)
    expect(computeMastery([ev(0, 1, 1), ev(1, 1, 1), ev(2, 1, 1)], cfg).currentLevel).toBe(2)
  })

  it('does not keep raising difficulty from easy answers given after the level rose', () => {
    const easy = Array.from({ length: 10 }, (_, i) => ev(i, 1, 1))
    expect(computeMastery(easy, cfg).currentLevel).toBe(2)
    const stepUp = [...easy.slice(0, 3), ev(3, 1, 2), ev(4, 1, 2), ev(5, 1, 2)]
    expect(computeMastery(stepUp, cfg).currentLevel).toBe(3)
  })

  it('lowers difficulty after repeated poor answers but not after one', () => {
    const up = [ev(0, 1, 1), ev(1, 1, 1), ev(2, 1, 1)]
    expect(computeMastery([...up, ev(3, 0, 2)], cfg).currentLevel).toBe(2)
    expect(computeMastery([...up, ev(3, 0, 2), ev(4, 0, 2), ev(5, 0, 2)], cfg).currentLevel).toBe(1)
  })

  it('keeps the current level for middling performance', () => {
    const up = [ev(0, 1, 1), ev(1, 1, 1), ev(2, 1, 1)]
    const mixed = [...up, ev(3, 1, 2), ev(4, 0, 2), ev(5, 1, 2)]
    expect(computeMastery(mixed, cfg).currentLevel).toBe(2)
  })

  it('counts hard and master correct answers and separate assessments', () => {
    const state = computeMastery(
      [ev(0, 1, 3, 'A1'), ev(1, 1, 4, 'A2'), ev(2, 0, 3, 'A2')],
      cfg,
    )
    expect(state.hardQuestionsCorrect).toBe(1)
    expect(state.masterQuestionsCorrect).toBe(1)
    expect(state.assessmentCount).toBe(2)
    expect(state.avgResponseSec).toBe(30)
  })

  it('explains itself', () => {
    const lines = explainMastery(computeMastery([ev(0, 1, 1), ev(1, 0, 1)], cfg), cfg)
    expect(lines.join(' ')).toMatch(/Mastery/)
    expect(lines.join(' ')).toMatch(/Not yet Mastered/)
  })

  it('reads the weights from config', () => {
    const accuracyOnly = resolveMasteryConfig({
      weights: { accuracy: 1, recent: 0, difficulty: 0, consistency: 0 },
    })
    const events = Array.from({ length: 10 }, (_, i) => ev(i, i < 5 ? 1 : 0, 1))
    expect(computeMastery(events, accuracyOnly).components.raw).toBe(50)
  })
})

describe('resolveMasteryConfig', () => {
  it('falls back to defaults for missing or invalid settings', () => {
    expect(resolveMasteryConfig(null)).toEqual(DEFAULT_MASTERY_CONFIG)
    expect(resolveMasteryConfig({ weights: { accuracy: 5 } })).toEqual(DEFAULT_MASTERY_CONFIG)
  })

  it('merges partial overrides over the defaults', () => {
    const c = resolveMasteryConfig({ evidence: { minQuestions: 15 } })
    expect(c.evidence.minQuestions).toBe(15)
    expect(c.evidence.minAccuracy).toBe(90)
  })
})

function signal(over: Partial<ConceptSignal> & { conceptId: string }): ConceptSignal {
  return {
    masteryScore: 50,
    masteryLevel: 'Developing',
    currentLevel: 1,
    consecutiveWrong: 0,
    recentAccuracy: 60,
    lastAssessedAt: new Date(),
    retention: 'not_applicable',
    ...over,
  }
}

describe('concept weightage', () => {
  const now = new Date()
  const signals: Array<ConceptSignal> = [
    signal({ conceptId: 'A', masteryScore: 92, masteryLevel: 'Mastered', retention: 'scheduled' }),
    signal({ conceptId: 'B', masteryScore: 76, masteryLevel: 'Advanced' }),
    signal({ conceptId: 'C', masteryScore: 48, masteryLevel: 'Developing', consecutiveWrong: 2, recentAccuracy: 30 }),
    signal({ conceptId: 'D', masteryScore: 35, masteryLevel: 'Beginner' }),
  ]

  it('gives weak concepts more questions than mastered ones', () => {
    const alloc = allocateQuestions(computeConceptWeights(signals, cfg, now), 20)
    expect(alloc.get('C')! + alloc.get('D')!).toBeGreaterThan(alloc.get('A')! + alloc.get('B')!)
    expect(alloc.get('D')!).toBeGreaterThan(alloc.get('A')!)
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(20)
  })

  it('boosts concepts with recent mistakes and stale concepts', () => {
    const old = new Date(now.getTime() - 40 * DAY)
    const w = computeConceptWeights(
      [
        signal({ conceptId: 'fresh', masteryScore: 60 }),
        signal({ conceptId: 'mistakes', masteryScore: 60, consecutiveWrong: 1 }),
        signal({ conceptId: 'stale', masteryScore: 60, lastAssessedAt: old }),
      ],
      cfg,
      now,
    )
    const by = Object.fromEntries(w.map((x) => [x.conceptId, x.weight]))
    expect(by.mistakes).toBeGreaterThan(by.fresh)
    expect(by.stale).toBeGreaterThan(by.fresh)
  })

  it('treats a never-assessed concept as needing attention', () => {
    const w = computeConceptWeights(
      [signal({ conceptId: 'new', masteryScore: null, masteryLevel: null, lastAssessedAt: null })],
      cfg,
      now,
    )
    expect(w[0].reasons).toContain('not assessed yet')
  })

  it('shares questions between chapters before concepts, so one chapter cannot crowd out another', () => {
    const chapterOf = (id: string) => (id.startsWith('a') ? 'ch1' : 'ch2')
    const many: Array<ConceptSignal> = [
      ...Array.from({ length: 10 }, (_, i) => signal({ conceptId: `a${i}`, masteryScore: null, masteryLevel: null, lastAssessedAt: null })),
      ...Array.from({ length: 7 }, (_, i) => signal({ conceptId: `b${i}`, masteryScore: null, masteryLevel: null, lastAssessedAt: null })),
    ]
    const alloc = allocateQuestions(computeConceptWeights(many, cfg, now), 10, chapterOf)
    const total = (prefix: string) =>
      [...alloc].filter(([id]) => id.startsWith(prefix)).reduce((sum, [, n]) => sum + n, 0)
    expect(total('a')).toBe(6)
    expect(total('b')).toBe(4)
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(10)
  })

  it('keeps a due mastered concept in the paper', () => {
    const many: Array<ConceptSignal> = [
      signal({ conceptId: 'M', masteryScore: 95, masteryLevel: 'Mastered', retention: 'due' }),
      ...['w1', 'w2', 'w3', 'w4'].map((id) => signal({ conceptId: id, masteryScore: 20, masteryLevel: 'Beginner' })),
    ]
    const weights = computeConceptWeights(many, cfg, now)
    const alloc = guaranteeRetention(allocateQuestions(weights, 8), many, 8)
    expect(alloc.get('M')).toBeGreaterThanOrEqual(1)
    expect([...alloc.values()].reduce((a, b) => a + b, 0)).toBe(8)
  })

  it('never drops the weak share below the floor while weak concepts exist', () => {
    const many: Array<ConceptSignal> = [
      signal({ conceptId: 's1', masteryScore: 92, masteryLevel: 'Mastered' }),
      signal({ conceptId: 's2', masteryScore: 91, masteryLevel: 'Mastered' }),
      signal({ conceptId: 's3', masteryScore: 80, masteryLevel: 'Advanced' }),
      signal({ conceptId: 'weak', masteryScore: 70, masteryLevel: 'Proficient' }),
      signal({ conceptId: 'weakest', masteryScore: 55, masteryLevel: 'Developing' }),
    ]
    const split = bucketWeighting(computeConceptWeights(many, cfg, now), many, cfg)
    expect(split.weak_priority).toBeGreaterThanOrEqual(cfg.weakPriorityFloorPercent)
    expect(split.weak_priority + split.needs_practice + split.strong).toBeCloseTo(100, 0)
  })
})

describe('retention', () => {
  const at = new Date('2026-09-10T00:00:00Z')

  it('schedules the first revision when a concept becomes Mastered', () => {
    const r = evolveRetention({
      previousLevel: 'Advanced', newLevel: 'Mastered', previous: null,
      assessedAt: at, assessmentRate: 100, config: cfg,
    })
    expect(r.status).toBe('scheduled')
    expect(r.nextAt!.getTime()).toBe(at.getTime() + 7 * DAY)
  })

  it('moves to the next interval after a good retention check', () => {
    const first = { stage: 0, nextAt: new Date(at.getTime() - DAY), status: 'scheduled' as const }
    const r = evolveRetention({
      previousLevel: 'Mastered', newLevel: 'Mastered', previous: first,
      assessedAt: at, assessmentRate: 90, config: cfg,
    })
    expect(r.stage).toBe(1)
    expect(r.nextAt!.getTime()).toBe(at.getTime() + 21 * DAY)
  })

  it('restarts the ladder after a poor retention check', () => {
    const second = { stage: 2, nextAt: new Date(at.getTime() - DAY), status: 'scheduled' as const }
    const r = evolveRetention({
      previousLevel: 'Mastered', newLevel: 'Mastered', previous: second,
      assessedAt: at, assessmentRate: 40, config: cfg,
    })
    expect(r.stage).toBe(0)
  })

  it('does not advance the ladder for extra practice before it is due', () => {
    const early = { stage: 1, nextAt: new Date(at.getTime() + 10 * DAY), status: 'scheduled' as const }
    const r = evolveRetention({
      previousLevel: 'Mastered', newLevel: 'Mastered', previous: early,
      assessedAt: at, assessmentRate: 100, config: cfg,
    })
    expect(r.stage).toBe(1)
    expect(r.nextAt).toEqual(early.nextAt)
  })

  it('marks a concept lapsed when it falls out of Mastered', () => {
    const r = evolveRetention({
      previousLevel: 'Mastered', newLevel: 'Advanced',
      previous: { stage: 1, nextAt: at, status: 'scheduled' },
      assessedAt: at, assessmentRate: 30, config: cfg,
    })
    expect(r.status).toBe('lapsed')
  })

  it('reports due once the date has passed', () => {
    expect(
      effectiveRetentionStatus({ status: 'scheduled', nextAt: new Date(at.getTime() - DAY) }, at),
    ).toBe('due')
    expect(
      effectiveRetentionStatus({ status: 'scheduled', nextAt: new Date(at.getTime() + DAY) }, at),
    ).toBe('scheduled')
  })
})

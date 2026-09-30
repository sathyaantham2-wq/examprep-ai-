import { describe, expect, it } from 'vitest'
import {
  applyBlockers,
  buildScanKey,
  checkOption,
  computeStatuses,
  isBlocked,
  normalizeLabel,
  parsePageReadings,
  resolveLabel,
} from './scan-mapping'
import type { DetectionState, ScanSlot } from './scan-mapping'

const slots: Array<ScanSlot> = [
  { id: 'a1', position: 1, choiceGroup: null, text: 'MCQ', optionLabels: ['a', 'b', 'c', 'd'] },
  { id: 'b2', position: 2, choiceGroup: null, text: 'Short', optionLabels: [] },
  // An OR pair: one printed number, two alternatives.
  { id: 'd3', position: 3, choiceGroup: 'g1', text: 'Prove X', optionLabels: [] },
  { id: 'c3', position: 3, choiceGroup: 'g1', text: 'Prove Y', optionLabels: [] },
]

function det(id: string, q: string | null, extra: Partial<DetectionState> = {}): DetectionState {
  return { id, paperQuestionId: q, confidence: 0.95, confirmed: false, discarded: false, ...extra }
}

describe('F052 scan key and label resolution', () => {
  it('gives OR-pair members A/B keys, independent of input order', () => {
    const key = buildScanKey(slots)
    expect(key.map((k) => k.key)).toEqual(['1', '2', '3A', '3B'])
    expect(key.find((k) => k.key === '3A')?.slotId).toBe('c3')
    expect(buildScanKey([...slots].reverse()).map((k) => `${k.key}:${k.slotId}`)).toEqual(
      key.map((k) => `${k.key}:${k.slotId}`),
    )
  })

  it('normalizes the ways a question number gets written', () => {
    expect(['Q.7', '7)', ' 7 ', 'Question 7', '(7)'].map(normalizeLabel)).toEqual(
      Array(5).fill('7'),
    )
    expect(normalizeLabel('3 b')).toBe('3B')
  })

  it('refuses to guess: unknown numbers and bare OR-pair numbers resolve to nothing', () => {
    const key = buildScanKey(slots)
    expect(resolveLabel('Q2', key)).toBe('b2')
    expect(resolveLabel('3b', key)).toBe('d3')
    expect(resolveLabel('3', key)).toBeNull()
    expect(resolveLabel('9', key)).toBeNull()
    expect(resolveLabel('', key)).toBeNull()
  })
})

describe('F051 page reading parser', () => {
  it('keeps well-formed answers and scales 0-1000 boxes to fractions', () => {
    const readings = parsePageReadings(
      JSON.stringify({
        answers: [
          { question: '2', text: 'x = 5', confidence: 0.9, box: [100, 200, 500, 100] },
          { question: '1', option: 'b', confidence: 1.4, box: [0.1, 0.1, 0.2, 0.05] },
          { question: '', text: 'no label' },
          { question: '4', text: '', option: '' },
        ],
      }),
    )
    expect(readings).toEqual([
      { label: '2', text: 'x = 5', option: null, confidence: 0.9, bbox: { x: 0.1, y: 0.2, w: 0.5, h: 0.1 } },
      { label: '1', text: null, option: 'b', confidence: 1, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.05 } },
    ])
  })

  it('accepts fenced JSON, rejects garbage', () => {
    expect(parsePageReadings('```json\n{"answers":[]}\n```')).toEqual([])
    expect(parsePageReadings('not json')).toBeNull()
    expect(parsePageReadings(null)).toBeNull()
  })

  it('an option the question never printed forces a human check', () => {
    expect(checkOption({ option: '(B)', confidence: 0.9 }, ['a', 'b'])).toEqual({ option: 'b', confidence: 0.9 })
    expect(checkOption({ option: 'e', confidence: 0.9 }, ['a', 'b'])).toEqual({ option: 'e', confidence: 0 })
    expect(checkOption({ option: null, confidence: 0.9 }, [])).toEqual({ option: null, confidence: 0.9 })
  })
})

describe('F052/F053 statuses and what blocks marking', () => {
  it('flags duplicates, including both halves of one OR pair, and unmapped readings', () => {
    const statuses = computeStatuses(
      [det('1', 'a1'), det('2', 'b2'), det('3', 'b2'), det('4', 'c3'), det('5', 'd3'), det('6', null), det('7', 'a1', { discarded: true })],
      slots,
    )
    expect(Object.fromEntries(statuses)).toEqual({
      1: 'mapped', 2: 'duplicate', 3: 'duplicate', 4: 'duplicate', 5: 'duplicate', 6: 'unmapped', 7: 'discarded',
    })
  })

  it('discarding one duplicate settles the other', () => {
    const statuses = computeStatuses([det('2', 'b2'), det('3', 'b2', { discarded: true })], slots)
    expect(statuses.get('2')).toBe('mapped')
  })

  it('blocks on low confidence until confirmed; reports missing numbers without blocking', () => {
    const live = [det('1', 'a1', { confidence: 0.5 }), det('2', 'b2')]
    const withStatus = (ds: Array<DetectionState>) => {
      const s = computeStatuses(ds, slots)
      return ds.map((d) => ({ ...d, status: s.get(d.id)! }))
    }
    const before = applyBlockers(withStatus(live), slots)
    expect(before).toEqual({ unmapped: 0, duplicates: 0, unconfirmedLowConfidence: 1, missingPositions: [3] })
    expect(isBlocked(before)).toBe(true)

    const after = applyBlockers(withStatus([{ ...live[0], confirmed: true }, live[1]]), slots)
    expect(isBlocked(after)).toBe(false)
    expect(after.missingPositions).toEqual([3])
  })
})

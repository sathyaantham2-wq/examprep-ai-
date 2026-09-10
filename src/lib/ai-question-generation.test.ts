import { describe, expect, it } from 'vitest'
import { estimateCostInr, validateCandidates } from './ai-question-generation'
import type { ScopeItem } from './ai-question-generation'

const inScope: Array<ScopeItem> = [
  { id: '1', kind: 'IN', item_text: 'Adding two integers with the same sign', page_ref: 'p12' },
]
const outScope: Array<ScopeItem> = [
  { id: '2', kind: 'OUT', item_text: 'multiplying negative fractions', page_ref: null },
]

describe('validateCandidates (F025 / AI-01 guardrail)', () => {
  it('accepts a well-formed candidate that cites a real IN-scope item', () => {
    const result = validateCandidates(
      [
        {
          text: 'What is (-3) + (-5)?',
          answer: '-8',
          in_scope_ref: 'Adding two integers with the same sign',
          tags: ['integers'],
        },
      ],
      { inScope, outScope, isMcq: false, marks: 1 },
    )
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('rejects a candidate whose in_scope_ref does not match a real IN-scope item', () => {
    const result = validateCandidates(
      [{ text: 'What is (-3) + (-5)?', answer: '-8', in_scope_ref: 'Something made up' }],
      { inScope, outScope, isMcq: false, marks: 1 },
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/in_scope_ref/)
  })

  it('rejects a candidate that references an OUT-of-scope item even with a valid in_scope_ref', () => {
    const result = validateCandidates(
      [
        {
          text: 'Explain the rule for multiplying negative fractions.',
          answer: 'n/a',
          in_scope_ref: 'Adding two integers with the same sign',
        },
      ],
      { inScope, outScope, isMcq: false, marks: 1 },
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/OUT-of-scope/)
  })

  it('rejects an mcq without exactly one correct option', () => {
    const result = validateCandidates(
      [
        {
          text: 'What is (-3) + (-5)?',
          answer: '-8',
          in_scope_ref: 'Adding two integers with the same sign',
          options: [
            { label: 'A', text: '-8', is_correct: true },
            { label: 'B', text: '8', is_correct: true },
          ],
        },
      ],
      { inScope, outScope, isMcq: true, marks: 1 },
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/mcq/)
  })

  it('rejects step_marks that do not sum to the question marks', () => {
    const result = validateCandidates(
      [
        {
          text: 'Solve and show your steps.',
          answer: '-8',
          in_scope_ref: 'Adding two integers with the same sign',
          step_marks: [{ step_no: 1, description: 'Sets up the sum', marks: 1 }],
        },
      ],
      { inScope, outScope, isMcq: false, marks: 3 },
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/step_marks/)
  })

  it('rejects a candidate missing text or answer', () => {
    const result = validateCandidates(
      [{ in_scope_ref: 'Adding two integers with the same sign' }],
      { inScope, outScope, isMcq: false, marks: 1 },
    )
    expect(result.accepted).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/Missing/)
  })
})

describe('estimateCostInr (F116 cost cap)', () => {
  it('prices at Claude Sonnet 5 published rates ($2/$10 per 1M tokens) converted to INR', () => {
    const cost = estimateCostInr({ inputTokens: 1_000_000, outputTokens: 1_000_000 })
    // (2 + 10) USD * 83 INR/USD
    expect(cost).toBeCloseTo(12 * 83, 5)
  })

  it('scales linearly and returns 0 for no usage', () => {
    expect(estimateCostInr({ inputTokens: 0, outputTokens: 0 })).toBe(0)
    const small = estimateCostInr({ inputTokens: 1000, outputTokens: 500 })
    const double = estimateCostInr({ inputTokens: 2000, outputTokens: 1000 })
    expect(double).toBeCloseTo(small * 2, 8)
  })
})

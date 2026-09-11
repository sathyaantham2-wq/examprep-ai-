import { describe, expect, it } from 'vitest'
import {
  evaluateBlankSweep,
  evaluateMarkToPoint,
  evaluateThreeCheckAr,
  MARK_TO_POINT_MIN_CHARS,
} from './habit-drills'

describe('evaluateBlankSweep (F070 H5: two-minute blank sweep)', () => {
  it('passes when every question has some answer, correctness irrelevant', () => {
    const passed = evaluateBlankSweep({
      questionIds: ['q1', 'q2'],
      answers: [
        { question_id: 'q1', selected_option: 'A' }, // could be wrong -- still counts
        { question_id: 'q2', response_text: 'guess' },
      ],
    })
    expect(passed).toBe(true)
  })

  it('fails when any question is left with no answer at all', () => {
    const passed = evaluateBlankSweep({
      questionIds: ['q1', 'q2'],
      answers: [{ question_id: 'q1', selected_option: 'A' }],
    })
    expect(passed).toBe(false)
  })

  it('fails when an "answer" is present but blank (whitespace-only response_text)', () => {
    const passed = evaluateBlankSweep({
      questionIds: ['q1'],
      answers: [{ question_id: 'q1', response_text: '   ' }],
    })
    expect(passed).toBe(false)
  })

  it('fails on an empty question set rather than vacuously passing', () => {
    expect(evaluateBlankSweep({ questionIds: [], answers: [] })).toBe(false)
  })
})

describe('evaluateMarkToPoint (F070 H1: mark-to-point)', () => {
  it('passes when every response meets the minimum length, regardless of correctness', () => {
    const passed = evaluateMarkToPoint({
      questionIds: ['q1'],
      answers: [
        {
          question_id: 'q1',
          response_text: 'x'.repeat(MARK_TO_POINT_MIN_CHARS),
        },
      ],
    })
    expect(passed).toBe(true)
  })

  it('fails a bare final answer that is too short to show working', () => {
    const passed = evaluateMarkToPoint({
      questionIds: ['q1'],
      answers: [{ question_id: 'q1', response_text: '42' }],
    })
    expect(passed).toBe(false)
  })

  it('fails when any one of several questions falls short, not just all of them', () => {
    const passed = evaluateMarkToPoint({
      questionIds: ['q1', 'q2'],
      answers: [
        {
          question_id: 'q1',
          response_text: 'x'.repeat(MARK_TO_POINT_MIN_CHARS),
        },
        { question_id: 'q2', response_text: '42' },
      ],
    })
    expect(passed).toBe(false)
  })

  it('a custom minChars overrides the default', () => {
    const passed = evaluateMarkToPoint({
      questionIds: ['q1'],
      answers: [{ question_id: 'q1', response_text: 'short' }],
      minChars: 3,
    })
    expect(passed).toBe(true)
  })
})

describe('evaluateThreeCheckAr (F070 H9: three-check on assertion-reason)', () => {
  it('passes only when every result is correct', () => {
    expect(evaluateThreeCheckAr({ results: [true, true, true] })).toBe(true)
  })

  it('fails if even one of the three is wrong', () => {
    expect(evaluateThreeCheckAr({ results: [true, false, true] })).toBe(false)
  })

  it('fails on an empty result set rather than vacuously passing', () => {
    expect(evaluateThreeCheckAr({ results: [] })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  normalizeAnswer,
  scoreObjectiveAnswer,
  templateFeedback,
} from './scoring'
import type { ErrorType } from '../db/enums'

describe('normalizeAnswer (F044)', () => {
  it('is case-insensitive', () => {
    expect(normalizeAnswer('Delhi')).toBe(normalizeAnswer('delhi'))
  })

  it('treats Indian and international number grouping as equal', () => {
    expect(normalizeAnswer('1,00,000')).toBe(normalizeAnswer('100,000'))
    expect(normalizeAnswer('1,00,000')).toBe('100000')
  })

  it('strips common units and currency/percent/degree symbols', () => {
    expect(normalizeAnswer('5 cm')).toBe(normalizeAnswer('5cm'))
    expect(normalizeAnswer('Rs. 50')).toBe(normalizeAnswer('50 rupees'))
    expect(normalizeAnswer('90°')).toBe(normalizeAnswer('90'))
    expect(normalizeAnswer('50%')).toBe(normalizeAnswer('50'))
  })

  it('collapses whitespace and a trailing full stop', () => {
    expect(normalizeAnswer('  5   apples.  ')).toBe('5 apples')
  })
})

describe('scoreObjectiveAnswer (F044/F046)', () => {
  it('awards full marks for a correct mcq selection', () => {
    const result = scoreObjectiveAnswer({
      type: 'mcq',
      marksMax: 2,
      correctOptionLabel: 'B',
      correctAnswerText: 'irrelevant for mcq',
      selectedOption: 'B',
    })
    expect(result).toEqual({ marksAwarded: 2, errorType: null })
  })

  it('marks a wrong mcq selection as Conceptual Gap, not a more specific error', () => {
    const result = scoreObjectiveAnswer({
      type: 'mcq',
      marksMax: 1,
      correctOptionLabel: 'A',
      correctAnswerText: 'irrelevant for mcq',
      selectedOption: 'C',
    })
    expect(result).toEqual({ marksAwarded: 0, errorType: 'Conceptual Gap' })
  })

  it('marks a blank mcq as Not Attempted, not Conceptual Gap', () => {
    const result = scoreObjectiveAnswer({
      type: 'mcq',
      marksMax: 1,
      correctOptionLabel: 'A',
      correctAnswerText: 'irrelevant for mcq',
      selectedOption: null,
    })
    expect(result.errorType).toBe('Not Attempted')
    expect(result.marksAwarded).toBe(0)
  })

  it('scores fill_blank via normalized text comparison, not exact string match', () => {
    const result = scoreObjectiveAnswer({
      type: 'fill_blank',
      marksMax: 1,
      correctAnswerText: '1,00,000',
      responseText: '100000',
    })
    expect(result).toEqual({ marksAwarded: 1, errorType: null })
  })

  it('marks fill_blank wrong when normalized values genuinely differ', () => {
    const result = scoreObjectiveAnswer({
      type: 'fill_blank',
      marksMax: 1,
      correctAnswerText: '0.5',
      responseText: '0.6',
    })
    expect(result).toEqual({ marksAwarded: 0, errorType: 'Conceptual Gap' })
  })
})

describe('templateFeedback (F049, AI-08 fallback)', () => {
  const errorTypes: Array<ErrorType> = [
    'Conceptual Gap',
    'Calculation Error',
    'Presentation Issue',
    'Formula/Definition Error',
    'Incomplete',
    'Not Attempted',
  ]

  it.each(errorTypes)(
    'produces non-empty, concept-naming feedback for %s',
    (errorType) => {
      const feedback = templateFeedback(errorType, 'Adding fractions')
      expect(feedback.length).toBeGreaterThan(0)
      expect(feedback).toContain('Adding fractions')
    },
  )

  it('returns an empty string when there is no error (full marks)', () => {
    expect(templateFeedback(null, 'Adding fractions')).toBe('')
  })
})

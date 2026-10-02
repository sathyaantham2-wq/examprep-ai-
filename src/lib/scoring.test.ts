import { describe, expect, it } from 'vitest'
import {
  fillBlankMatches,
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

describe('fillBlankMatches (F129 spelling tolerance)', () => {
  it('accepts exact and normalised matches', () => {
    expect(fillBlankMatches('Photosynthesis', 'photosynthesis')).toBe(true)
    expect(fillBlankMatches('photo-synthesis', 'photosynthesis')).toBe(true)
  })
  it('accepts a small spelling slip', () => {
    expect(fillBlankMatches('photosynthsis', 'photosynthesis')).toBe(true)
    expect(fillBlankMatches('chlorophyl', 'chlorophyll')).toBe(true)
    expect(fillBlankMatches('recieve', 'receive')).toBe(true) // swapped letters
    expect(fillBlankMatches('parliment', 'parliament')).toBe(true)
  })
  it('still rejects a genuinely different word', () => {
    expect(fillBlankMatches('meiosis', 'mitosis')).toBe(false)
    expect(fillBlankMatches('cathode', 'anode')).toBe(false)
    expect(fillBlankMatches('delta', 'Delhi')).toBe(false)
  })
  it('never lets numbers be "close enough"', () => {
    expect(fillBlankMatches('125', '152')).toBe(false)
    expect(fillBlankMatches('3.15', '3.14')).toBe(false)
    expect(fillBlankMatches('1,00,000', '100000')).toBe(true)
  })
  it('allows no slips on very short words', () => {
    expect(fillBlankMatches('cat', 'car')).toBe(false)
    expect(fillBlankMatches('iron', 'icon')).toBe(false)
  })
})

describe('fillBlankMatches accepts the same number written another way (F044)', () => {
  it('accepts a decimal for a fraction key and a fraction for a decimal key', () => {
    expect(fillBlankMatches('0.5', '1/2')).toBe(true)
    expect(fillBlankMatches('0.375', '3/8')).toBe(true)
    expect(fillBlankMatches('2/5', '0.4')).toBe(true)
    expect(fillBlankMatches('4/10', '0.4')).toBe(true)
    expect(fillBlankMatches('1 / 2', '1/2')).toBe(true)
  })
  it('accepts a missing leading zero, trailing zeros and an explicit plus sign', () => {
    expect(fillBlankMatches('.2', '0.2')).toBe(true)
    expect(fillBlankMatches('0.20', '0.2')).toBe(true)
    expect(fillBlankMatches('5.0', '5')).toBe(true)
    expect(fillBlankMatches('+5', '5')).toBe(true)
    expect(fillBlankMatches('-0.5', '-1/2')).toBe(true)
  })
  it('still rejects a different number, however close', () => {
    expect(fillBlankMatches('0.33', '1/3')).toBe(false)
    expect(fillBlankMatches('0.51', '1/2')).toBe(false)
    expect(fillBlankMatches('-5', '5')).toBe(false)
    expect(fillBlankMatches('3.15', '3.14')).toBe(false)
    expect(fillBlankMatches('1/0', '1')).toBe(false)
  })
  it('does not accept an unreduced fraction for a fraction key', () => {
    expect(fillBlankMatches('2/4', '1/2')).toBe(false)
  })
  it('leaves answers that are not plain numbers to the existing rules', () => {
    expect(fillBlankMatches('5 cm', '5cm')).toBe(true)
    expect(fillBlankMatches('x = 5', '5')).toBe(false)
    expect(fillBlankMatches('VIII', 'VIII')).toBe(true)
  })
})

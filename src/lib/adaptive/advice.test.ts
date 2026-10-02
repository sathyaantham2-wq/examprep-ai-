import { describe, expect, it } from 'vitest'
import { chapterAdvice, conceptAdvice } from './advice'
import type { ChapterAdviceConcept, ConceptAdviceInput } from './advice'

function concept(over: Partial<ConceptAdviceInput> = {}): ConceptAdviceInput {
  return {
    mastery_level: 'Developing',
    accuracy: 65,
    recent_accuracy: 65,
    questions_attempted: 12,
    retention: 'not_applicable',
    ...over,
  }
}

function inChapter(
  id: string,
  over: Partial<ChapterAdviceConcept> = {},
): ChapterAdviceConcept {
  return {
    ...concept(),
    concept_id: id,
    concept_name: `Concept ${id}`,
    mastery_score: 60,
    ...over,
  }
}

describe('conceptAdvice', () => {
  it('puts revision that is due ahead of everything else', () => {
    const advice = conceptAdvice(
      concept({ mastery_level: 'Mastered', accuracy: 95, retention: 'due' }),
    )
    expect(advice.principle).toBe('Spaced practice')
    expect(advice.action).toMatch(/Revise this now/)
  })

  it('offers an untried concept a low-stakes Easy start', () => {
    const advice = conceptAdvice(
      concept({
        mastery_level: 'Not started',
        accuracy: null,
        recent_accuracy: null,
        questions_attempted: 0,
      }),
    )
    expect(advice.principle).toBe('A low-stakes start')
    expect(advice.action).toMatch(/Easy/)
  })

  it('makes no judgement from fewer than five answers', () => {
    const advice = conceptAdvice(
      concept({ accuracy: 0, recent_accuracy: 0, questions_attempted: 3 }),
    )
    expect(advice.principle).toBe('Enough answers to tell')
  })

  it('sends a concept below half marks to a worked example first', () => {
    expect(conceptAdvice(concept({ accuracy: 35 })).principle).toBe(
      'Worked examples first',
    )
  })

  it('names a recent dip and a recent rise, with both numbers', () => {
    const dip = conceptAdvice(concept({ accuracy: 70, recent_accuracy: 50 }))
    expect(dip.principle).toBe('Little and often')
    expect(dip.reason).toContain('50%')
    expect(dip.reason).toContain('70%')

    const rise = conceptAdvice(concept({ accuracy: 60, recent_accuracy: 85 }))
    expect(rise.principle).toBe('Effort is working')
    expect(rise.reason).toContain('85%')
  })

  it('asks for retrieval practice in the middle and a stretch near the top', () => {
    expect(conceptAdvice(concept({ accuracy: 65 })).principle).toBe(
      'Retrieval practice',
    )
    expect(
      conceptAdvice(
        concept({
          mastery_level: 'Advanced',
          accuracy: 90,
          recent_accuracy: 90,
        }),
      ).principle,
    ).toBe('Stretch and mix')
  })

  it('tells her to leave a mastered concept that is not due', () => {
    const advice = conceptAdvice(
      concept({
        mastery_level: 'Mastered',
        accuracy: 96,
        retention: 'scheduled',
      }),
    )
    expect(advice.action).toMatch(/Leave this one/)
  })

  it('never uses discouraging words', () => {
    const inputs = [
      concept({ accuracy: 10 }),
      concept({ accuracy: 70, recent_accuracy: 30 }),
      concept({
        questions_attempted: 0,
        accuracy: null,
        recent_accuracy: null,
      }),
      concept({ questions_attempted: 2, accuracy: 0 }),
    ]
    for (const input of inputs) {
      const advice = conceptAdvice(input)
      expect(`${advice.action} ${advice.reason}`).not.toMatch(
        /\b(weak|poor|bad|fail|failed|wrong|worst|behind)\b/i,
      )
    }
  })
})

describe('chapterAdvice', () => {
  it('starts an untouched chapter with the whole chapter, not a focus', () => {
    const advice = chapterAdvice([
      inChapter('a', { questions_attempted: 0, mastery_score: null }),
      inChapter('b', { questions_attempted: 0, mastery_score: null }),
    ])
    expect(advice.principle).toBe('A low-stakes start')
    expect(advice.focus_concept_ids).toEqual([])
  })

  it('focuses on revision that is due', () => {
    const advice = chapterAdvice([
      inChapter('a', { mastery_level: 'Mastered', retention: 'due' }),
      inChapter('b'),
    ])
    expect(advice.principle).toBe('Spaced practice')
    expect(advice.focus_concept_ids).toEqual(['a'])
    expect(advice.action).toContain('Concept a')
  })

  it('focuses on the lowest scores when only part of the chapter needs work', () => {
    const advice = chapterAdvice([
      inChapter('a', { mastery_level: 'Mastered', mastery_score: 95 }),
      inChapter('b', { mastery_score: 40 }),
      inChapter('c', { mastery_score: 20 }),
    ])
    expect(advice.principle).toBe('Weakest part first')
    expect(advice.focus_concept_ids).toEqual(['c', 'b'])
  })

  it('keeps a focus to three concepts, lowest first', () => {
    const advice = chapterAdvice([
      inChapter('a', { mastery_score: 50 }),
      inChapter('b', { mastery_score: 10 }),
      inChapter('c', { mastery_score: 30 }),
      inChapter('d', { mastery_score: 20 }),
      inChapter('e', { mastery_score: 40 }),
    ])
    expect(advice.focus_concept_ids).toEqual(['b', 'd', 'c'])
  })

  it('recommends mixed practice when every concept of a small chapter is in progress', () => {
    const advice = chapterAdvice([inChapter('a'), inChapter('b')])
    expect(advice.principle).toBe('Mixed practice')
    expect(advice.focus_concept_ids).toEqual([])
  })

  it('points a chapter whose started concepts are all mastered at the untried ones', () => {
    const advice = chapterAdvice([
      inChapter('a', { mastery_level: 'Mastered', mastery_score: 95 }),
      inChapter('b', { questions_attempted: 0, mastery_score: null }),
    ])
    expect(advice.focus_concept_ids).toEqual(['b'])
    expect(advice.action).toMatch(/not started yet/)
  })

  it('says a fully mastered chapter can be left', () => {
    const advice = chapterAdvice([
      inChapter('a', { mastery_level: 'Mastered', mastery_score: 95 }),
      inChapter('b', { mastery_level: 'Mastered', mastery_score: 92 }),
    ])
    expect(advice.action).toMatch(/mastered/)
    expect(advice.focus_concept_ids).toEqual([])
  })
})

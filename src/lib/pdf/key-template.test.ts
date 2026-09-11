import { describe, expect, it } from 'vitest'
import { buildAnswerKeyHtml } from './key-template'
import type { KeyTemplateQuestion } from './key-template'

function baseQuestion(overrides: Partial<KeyTemplateQuestion>): KeyTemplateQuestion {
  return {
    position: 1,
    section: 'Section A',
    marks: 1,
    type: 'short_answer',
    text: 'A question',
    answer: 'An answer',
    diagram_kind: null,
    diagram_params: undefined,
    choice_group: null,
    correctOptionLabel: null,
    stepMarks: [],
    ...overrides,
  }
}

describe('buildAnswerKeyHtml internal choice / OR pairs (F030)', () => {
  it('shows both alternatives expected answers under one shared mark value with an OR divider', () => {
    const html = buildAnswerKeyHtml({
      title: 'Test Paper',
      coverage: [],
      questions: [
        baseQuestion({
          position: 1,
          marks: 3,
          answer: 'Primary answer',
          choice_group: 'Section A#1',
        }),
        baseQuestion({
          position: 2,
          marks: 3,
          answer: 'Alternate answer',
          choice_group: 'Section A#1',
        }),
      ],
    })
    expect(html).toContain('choice-pair')
    expect(html).toContain('class="or-divider"')
    expect(html).toContain('Primary answer')
    expect(html).toContain('Alternate answer')
    expect((html.match(/\(3 marks\)/g) ?? []).length).toBe(1)
  })

  it('a question with no choice_group renders as a single ordinary item, unchanged from before F030', () => {
    const html = buildAnswerKeyHtml({
      title: 'Test Paper',
      coverage: [],
      questions: [baseQuestion({ choice_group: null })],
    })
    expect(html).not.toContain('choice-pair')
    expect(html).not.toContain('class="or-divider"')
  })
})

describe('buildAnswerKeyHtml theming (F034/F120)', () => {
  it('embeds the Doodle Journal theme CSS when selected, matching the student paper', () => {
    const html = buildAnswerKeyHtml({
      title: 'Test Paper',
      coverage: [],
      theme: 'Doodle Journal',
      questions: [baseQuestion({})],
    })
    expect(html).toContain('Comic Sans MS')
  })

  it('defaults to Clean School -- no decorative CSS added', () => {
    const html = buildAnswerKeyHtml({
      title: 'Test Paper',
      coverage: [],
      questions: [baseQuestion({})],
    })
    expect(html).not.toContain('Comic Sans MS')
  })
})

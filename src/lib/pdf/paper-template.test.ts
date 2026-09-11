import { describe, expect, it } from 'vitest'
import { buildPaperHtml } from './paper-template'
import type { PaperTemplateQuestion } from './paper-template'

function baseQuestion(
  overrides: Partial<PaperTemplateQuestion>,
): PaperTemplateQuestion {
  return {
    id: 'q1',
    section: 'Section A',
    position: 1,
    marks: 1,
    bloom: 'Remember',
    difficulty: 'Easy',
    type: 'short_answer',
    text: 'Draw a number line from 0 to 5.',
    diagram_kind: null,
    diagram_params: undefined,
    choice_group: null,
    options: [],
    ...overrides,
  }
}

const baseInput = {
  title: 'Test Paper',
  studentName: 'Test Kid',
  board: 'CBSE',
  class: 7,
  durationMin: 30,
  totalMarks: 1,
  chapters: [],
  shortfalls: [],
}

describe('buildPaperHtml diagram rendering (F024)', () => {
  it('embeds the real SVG for a known diagram_kind with valid params', () => {
    const html = buildPaperHtml({
      ...baseInput,
      questions: [
        baseQuestion({
          diagram_kind: 'number-line',
          diagram_params: { min: 0, max: 5 },
        }),
      ],
    })
    expect(html).toContain('class="diagram"')
    expect(html).toContain('<svg')
    // F035's blank draw-box still appears underneath the real figure.
    expect(html).toContain('class="draw-box"')
  })

  it('falls back to F035s bare draw-box for an unrecognised diagram_kind, unchanged from before F024', () => {
    const html = buildPaperHtml({
      ...baseInput,
      questions: [
        baseQuestion({ diagram_kind: 'right-triangle', diagram_params: undefined }),
      ],
    })
    expect(html).not.toContain('class="diagram"')
    expect(html).not.toContain('<svg')
    expect(html).toContain('class="draw-box"')
  })

  it('renders neither a diagram nor a draw-box when diagram_kind is null', () => {
    const html = buildPaperHtml({
      ...baseInput,
      questions: [baseQuestion({ diagram_kind: null })],
    })
    expect(html).not.toContain('class="diagram"')
    expect(html).not.toContain('class="draw-box"')
  })
})

describe('buildPaperHtml internal choice / OR pairs (F030)', () => {
  it('prints two questions sharing a choice_group as one numbered block with an OR divider and one [marks]', () => {
    const html = buildPaperHtml({
      ...baseInput,
      totalMarks: 3,
      questions: [
        baseQuestion({
          id: 'q1',
          position: 1,
          marks: 3,
          text: 'Primary question text',
          choice_group: 'Section A#1',
        }),
        baseQuestion({
          id: 'q2',
          position: 2,
          marks: 3,
          text: 'Alternate question text',
          choice_group: 'Section A#1',
        }),
      ],
    })
    expect(html).toContain('choice-pair')
    expect(html).toContain('class="or-divider"')
    expect(html).toContain('Primary question text')
    expect(html).toContain('Alternate question text')
    // Printed once as "1." (not "1." then "2.") and marked once, not twice.
    expect(html).toContain('<div class="q-number">1.</div>')
    expect(html).not.toContain('<div class="q-number">2.</div>')
    expect((html.match(/\[3\]/g) ?? []).length).toBe(1)
  })

  it('a question with no choice_group renders as a single ordinary question, unchanged from before F030', () => {
    const html = buildPaperHtml({
      ...baseInput,
      questions: [baseQuestion({ choice_group: null })],
    })
    expect(html).not.toContain('choice-pair')
    expect(html).not.toContain('class="or-divider"')
  })
})

describe('buildPaperHtml theming (F034)', () => {
  it('defaults to the Plain theme when none is given -- no decorative CSS added', () => {
    const html = buildPaperHtml({ ...baseInput, questions: [baseQuestion({})] })
    expect(html).not.toContain('Comic Sans MS')
  })

  it('embeds the Doodle Journal theme CSS when selected', () => {
    const html = buildPaperHtml({
      ...baseInput,
      theme: 'Doodle Journal',
      questions: [baseQuestion({})],
    })
    expect(html).toContain('Comic Sans MS')
    expect(html).toContain('border-radius: 14px')
  })
})

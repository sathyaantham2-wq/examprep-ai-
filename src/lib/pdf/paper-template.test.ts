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

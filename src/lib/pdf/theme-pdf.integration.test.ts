import { describe, expect, it } from 'vitest'
import { buildPaperHtml } from './paper-template'
import { renderHtmlToPdf } from './render'
import { PAPER_THEMES } from './themes'

/**
 * F034/F120's "prints in black and white legibly" half, for every theme pack -- the same
 * real-Chromium-rendering proof src/lib/pdf/diagram-pdf.integration.test.ts uses for diagrams,
 * not just a check of the generated HTML string.
 */
describe('every theme pack renders to a valid PDF (F034/F120)', () => {
  it.each(PAPER_THEMES)('%s produces a non-trivial PDF with the theme applied', async (theme) => {
    const html = buildPaperHtml({
      title: `${theme} Test Paper`,
      studentName: 'Test Kid',
      board: 'CBSE',
      class: 7,
      durationMin: 30,
      totalMarks: 1,
      chapters: [],
      shortfalls: [],
      theme,
      questions: [
        {
          id: 'q1',
          section: 'Section A',
          position: 1,
          marks: 1,
          bloom: 'Remember',
          difficulty: 'Easy',
          type: 'mcq',
          text: `A ${theme}-themed question`,
          diagram_kind: null,
          diagram_params: undefined,
          choice_group: null,
          options: [
            { label: 'A', text: 'One', order_index: 1 },
            { label: 'B', text: 'Two', order_index: 2 },
          ],
        },
      ],
    })

    const pdf = await renderHtmlToPdf(html)
    const bytes = new Uint8Array(pdf)
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii')
    expect(header).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(5000)
  })
})

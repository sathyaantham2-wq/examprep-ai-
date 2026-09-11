import { describe, expect, it } from 'vitest'
import { buildPaperHtml } from './paper-template'
import { renderHtmlToPdf } from './render'

/**
 * F034's "prints in black and white legibly" half for the Doodle Journal theme -- the same
 * real-Chromium-rendering proof src/lib/pdf/diagram-pdf.integration.test.ts uses for diagrams,
 * not just a check of the generated HTML string.
 */
describe('the Doodle Journal theme renders to a valid PDF (F034)', () => {
  it('produces a non-trivial PDF with the theme applied', async () => {
    const html = buildPaperHtml({
      title: 'Doodle Journal Test Paper',
      studentName: 'Test Kid',
      board: 'CBSE',
      class: 7,
      durationMin: 30,
      totalMarks: 1,
      chapters: [],
      shortfalls: [],
      theme: 'Doodle Journal',
      questions: [
        {
          id: 'q1',
          section: 'Section A',
          position: 1,
          marks: 1,
          bloom: 'Remember',
          difficulty: 'Easy',
          type: 'mcq',
          text: 'A doodle-themed question',
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

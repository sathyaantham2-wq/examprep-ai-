import { describe, expect, it } from 'vitest'
import { buildPaperHtml } from './paper-template'
import { renderHtmlToPdf } from './render'

/**
 * F024's "prints cleanly" half: proves the embedded SVG actually survives real headless-Chromium
 * PDF rendering (src/lib/pdf/render.ts), not just that the HTML string looks right (that's
 * paper-template.test.ts's job) -- no database needed, buildPaperHtml/renderHtmlToPdf are both
 * pure given plain objects.
 */
describe('a paper with a real diagram renders to a valid PDF (F024)', () => {
  it('produces a non-trivial PDF for every known diagram kind', async () => {
    const cases: Array<{ kind: string; params: unknown }> = [
      { kind: 'intersecting-lines', params: { labels: ['a', 'b', 'c', 'd'] } },
      { kind: 'transversal', params: { labels: ['1', '2'] } },
      { kind: 'number-line', params: { min: 0, max: 10, points: [{ value: 3 }] } },
      {
        kind: 'place-value',
        params: { columns: ['H', 'T', 'O'], digits: [4, 2, 7] },
      },
      { kind: 'circuit', params: { components: ['battery', 'bulb', 'switch'] } },
      { kind: 'ray-diagram', params: { rays: [{ angle: 0 }, { angle: 90 }] } },
    ]

    const html = buildPaperHtml({
      title: 'Diagram Test Paper',
      studentName: 'Test Kid',
      board: 'CBSE',
      class: 7,
      durationMin: 30,
      totalMarks: cases.length,
      chapters: [],
      shortfalls: [],
      questions: cases.map((c, i) => ({
        id: `q${i}`,
        section: 'Section A',
        position: i + 1,
        marks: 1,
        bloom: 'Remember',
        difficulty: 'Easy',
        type: 'short_answer',
        text: `Question about a ${c.kind}`,
        diagram_kind: c.kind,
        diagram_params: c.params,
        choice_group: null,
        options: [],
      })),
    })

    const pdf = await renderHtmlToPdf(html)
    const bytes = new Uint8Array(pdf)
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii')
    expect(header).toBe('%PDF-')
    expect(bytes.byteLength).toBeGreaterThan(5000)
  })
})

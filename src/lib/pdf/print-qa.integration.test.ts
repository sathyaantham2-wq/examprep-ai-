import { writeFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { buildPaperHtml } from './paper-template'
import type { PaperTemplateQuestion } from './paper-template'
import { PDF_PAGE_OPTIONS, renderHtmlToPdf } from './render'
import { PAPER_THEMES } from './themes'

// F107: "no clipped margins or split questions". A printed paper is the primary artefact (tab 01),
// so this lays out a deliberately awkward 45-question paper exactly as production does, then reads
// the PDF back and checks where everything landed.
//
// How a split is detected: before printing, an invisible marker is placed at the very start and
// very end of every question (and after every section title). pdf.js then reports which page each
// marker is on. A question whose start and end are on different pages was split. A section title
// on a different page from its first question was orphaned at the bottom of a page.

const MM = 72 / 25.4 // PDF points per millimetre
const A4 = { w: 210 * MM, h: 297 * MM }
const MARGIN = { top: 14 * MM, bottom: 14 * MM, left: 12 * MM, right: 12 * MM }

const LONG =
  'Read the passage carefully and answer: explain, with reasons and a worked example, how the ' +
  'quantity changes when each of the given conditions is applied one after another, showing every step.'

// `shift` adds that many one-line questions at the start, moving every page break. One layout can
// happen to avoid the awkward spots (a heading right at a page bottom); across shifts 0..8 the
// breaks sweep through every position, so a missing rule always shows up in some variant.
function stressQuestions(shift: number): Array<PaperTemplateQuestion> {
  const qs: Array<PaperTemplateQuestion> = []
  let position = 0
  const add = (
    section: string,
    q: Partial<PaperTemplateQuestion>,
    choiceGroup: string | null = null,
  ) => {
    if (!choiceGroup || !qs.some((x) => x.choice_group === choiceGroup))
      position += 1
    qs.push({
      id: `q${qs.length + 1}`,
      section,
      position,
      marks: 1,
      bloom: 'Understand',
      difficulty: 'Hard',
      type: 'short_answer',
      text: `Question ${qs.length + 1}. ${LONG}`,
      diagram_kind: null,
      diagram_params: undefined,
      choice_group: choiceGroup,
      options: [],
      ...q,
    })
  }
  const options = ['A', 'B', 'C', 'D'].map((label, i) => ({
    label,
    text: `Option ${label}: a fairly long choice that may wrap onto a second line on paper`,
    order_index: i + 1,
  }))
  for (let i = 0; i < shift; i++)
    add('Section A', {
      type: 'fill_blank',
      text: `Fill in: ${i} + ${i} = ____`,
    })
  for (let i = 0; i < 15; i++) add('Section A', { type: 'mcq', options })
  for (let i = 0; i < 12; i++)
    add('Section B', { type: 'short_answer', marks: 2 })
  for (let i = 0; i < 6; i++)
    add('Section C', { type: 'long_answer', marks: 5 })
  // Diagram questions: a figure plus an empty draw-here box.
  for (let i = 0; i < 4; i++) {
    add('Section C', {
      type: 'long_answer',
      marks: 4,
      diagram_kind: 'number_line',
      diagram_params: {
        min: -5,
        max: 5,
        step: 1,
        points: [{ value: 2, label: 'A' }],
      },
    })
  }
  // OR pairs: one printed number, two long alternatives.
  for (let i = 0; i < 4; i++) {
    add('Section C', { type: 'long_answer', marks: 5 }, `or-${i}`)
    add('Section C', { type: 'long_answer', marks: 5 }, `or-${i}`)
  }
  return qs
}

interface Marker {
  id: string
  page: number
}

async function layOut(browser: Browser, html: string) {
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(async () => {
      await document.fonts.ready
      const mark = (text: string) => {
        const span = document.createElement('span')
        span.textContent = ` ${text} `
        // Absolutely positioned: it sits where it would have been but takes no space, so the
        // layout under test is exactly production's.
        span.style.cssText =
          'position:absolute;font-size:1px;color:#fff;line-height:1px'
        return span
      }
      document.querySelectorAll('.question').forEach((q, i) => {
        q.querySelector('.q-body')?.prepend(mark(`QS${i}QS`))
        q.querySelector('.q-body')?.append(mark(`QE${i}QE`))
      })
      document
        .querySelectorAll('.section-title')
        .forEach((t, i) => t.append(mark(`SEC${i}SEC`)))
    })
    // Height of each question in CSS px; anything taller than a printable page can't avoid a split.
    const heights = await page.evaluate(() =>
      [...document.querySelectorAll('.question')].map(
        (q) => q.getBoundingClientRect().height,
      ),
    )
    const pdf = await page.pdf(PDF_PAGE_OPTIONS)
    return { pdf, heights }
  } finally {
    await page.close()
  }
}

async function readPdf(pdf: Buffer) {
  const task = getDocument({ data: new Uint8Array(pdf), useSystemFonts: false })
  const doc = await task.promise
  const markers: Array<Marker> = []
  const outOfBounds: Array<string> = []
  const pageSizes: Array<{ w: number; h: number }> = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const view = page.view
    pageSizes.push({ w: view[2] - view[0], h: view[3] - view[1] })
    const content = await page.getTextContent()
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue
      for (const m of item.str.matchAll(/(QS|QE|SEC)(\d+)\1/g))
        markers.push({ id: `${m[1]}${m[2]}`, page: n })
      if (/^(QS|QE|SEC)\d+/.test(item.str.trim())) continue
      const [a, b, , , x, y] = item.transform
      // For rotated text (the vertical "Rough work" label) `width` runs along the text, i.e. down
      // the page, not across it; across the page it is only about one font size wide.
      const rotated = Math.abs(b) > Math.abs(a)
      const across = rotated ? Math.abs(b) : item.width
      const down = rotated ? item.width : 0
      // A little slack: glyph origins sit slightly inside the ink box.
      if (
        x < MARGIN.left - 2 ||
        x + across > A4.w - MARGIN.right + 2 ||
        y - down < MARGIN.bottom - 2 ||
        y > A4.h - MARGIN.top + 2
      ) {
        outOfBounds.push(
          `p${n} "${item.str.slice(0, 30)}" at x=${x.toFixed(0)} y=${y.toFixed(0)}`,
        )
      }
    }
  }
  await task.destroy()
  return { markers, outOfBounds, pageSizes, pages: pageSizes.length }
}

describe('printed papers: A4, nothing clipped, no split questions (F107)', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser.close()
  })

  it.each(PAPER_THEMES)(
    '%s theme, page breaks shifted 0..8 questions',
    async (theme) => {
      for (let shift = 0; shift <= 8; shift++) {
        const questions = stressQuestions(shift)
        const html = buildPaperHtml({
          title: 'Print QA stress paper',
          studentName: 'Test Student',
          board: 'CBSE',
          class: 7,
          durationMin: 90,
          totalMarks: 80,
          chapters: [],
          shortfalls: [],
          theme,
          questions,
        })
        const { pdf, heights } = await layOut(browser, html)
        // For the manual half of F107 (Acrobat, a phone's print dialog, a real printer): set
        // PRINT_QA_OUT to a folder to keep the exact PDFs this test checked.
        if (process.env.PRINT_QA_OUT && shift === 0) {
          // The production render, without the test's markers.
          writeFileSync(
            `${process.env.PRINT_QA_OUT}/print-qa-${theme.replace(/\s+/g, '-')}.pdf`,
            await renderHtmlToPdf(html),
          )
        }
        const { markers, outOfBounds, pageSizes, pages } = await readPdf(pdf)
        const pageOf = (id: string) => markers.find((m) => m.id === id)?.page

        // Every page is A4 portrait.
        for (const size of pageSizes) {
          expect(Math.abs(size.w - A4.w)).toBeLessThan(1)
          expect(Math.abs(size.h - A4.h)).toBeLessThan(1)
        }
        expect(pages).toBeGreaterThan(3)

        // No question split across pages, unless it is genuinely taller than one printable page.
        const printableCssPx = ((297 - 28) / 25.4) * 96
        const split = heights
          .map((h, i) => ({
            i,
            h,
            start: pageOf(`QS${i}`),
            end: pageOf(`QE${i}`),
          }))
          .filter(
            (q) =>
              q.start === undefined ||
              q.end === undefined ||
              (q.start !== q.end && q.h < printableCssPx),
          )
        expect(
          split,
          `shift ${shift}: split questions: ${JSON.stringify(split)}`,
        ).toEqual([])

        // No section title left alone at the bottom of a page: it shares a page with its first question.
        const sectionStarts: Array<number> = []
        questions.forEach((q, i) => {
          if (i === 0 || questions[i - 1].section !== q.section)
            sectionStarts.push(i)
        })
        // OR pairs render as one .question block, so map question index -> rendered block index.
        const blockOf: Array<number> = []
        let block = -1
        questions.forEach((q, i) => {
          const prev = questions[i - 1] as PaperTemplateQuestion | undefined
          if (!(q.choice_group && prev?.choice_group === q.choice_group))
            block += 1
          blockOf.push(block)
        })
        const orphans = sectionStarts
          .map((qi, s) => ({
            s,
            title: pageOf(`SEC${s}`),
            first: pageOf(`QS${blockOf[qi]}`),
          }))
          .filter((x) => x.title !== x.first)
        expect(
          orphans,
          `shift ${shift}: orphaned section titles: ${JSON.stringify(orphans)}`,
        ).toEqual([])

        // Nothing printed in the margins, where printers clip.
        expect(
          outOfBounds,
          `shift ${shift}: ${outOfBounds.slice(0, 5).join('\n')}`,
        ).toEqual([])
      }
    },
    240000,
  )
})

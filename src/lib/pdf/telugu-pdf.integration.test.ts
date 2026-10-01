import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { buildPaperHtml } from './paper-template'
import { renderHtmlToPdf } from './render'
import { PAPER_THEMES } from './themes'
import { TELUGU_SAMPLE } from './telugu-sample.fixture'

function teluguPaper(theme: (typeof PAPER_THEMES)[number]) {
  return buildPaperHtml({
    title: 'తెలుగు పరీక్ష',
    studentName: 'విద్యార్థి',
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
        type: 'short_answer',
        text: TELUGU_SAMPLE,
        diagram_kind: null,
        diagram_params: undefined,
        choice_group: null,
        options: [],
      },
    ],
  })
}

/**
 * F087: "correct conjunct rendering on screen and in PDF; verified on a 200-word sample including
 * ottulu and deerghalu." The renderer runs on a server with no Telugu font, so the PDF must use
 * the font inlined into its own HTML. This checks, in real Chromium, that the inlined font is the
 * one actually loaded and used for the Telugu text, not a font that happens to be installed on
 * the machine running the test.
 */
describe('Telugu in PDFs uses the bundled Noto Sans Telugu (F087)', () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser.close()
  })

  it.each(PAPER_THEMES)('%s theme: the bundled Telugu face loads and covers the 200-word sample', async (theme) => {
    const page = await browser.newPage()
    try {
      await page.setContent(teluguPaper(theme), { waitUntil: 'load' })
      const result = await page.evaluate(async () => {
        await document.fonts.ready
        const faces = [...document.fonts].filter((f) => f.family.includes('PrepPlan Telugu'))
        const question = document.querySelector('.q-body')
        return {
          faces: faces.map((f) => f.status),
          // Every Telugu character in the question can be drawn by the bundled face.
          covered: document.fonts.check(`16px "PrepPlan Telugu"`, question?.textContent ?? ''),
          family: question ? getComputedStyle(question).fontFamily : '',
        }
      })
      expect(result.faces).toEqual(['loaded'])
      expect(result.covered).toBe(true)
      expect(result.family).toMatch(/^"?PrepPlan Telugu"?,/)
    } finally {
      await page.close()
    }
  })

  it('renders the sample to a real PDF with the Telugu glyphs embedded', async () => {
    const pdf = await renderHtmlToPdf(teluguPaper('Clean School'))
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
    // Chromium embeds the variable web font as Type3 glyph programs. Their presence is the
    // fingerprint that the inlined font, not a system TrueType font, drew the Telugu.
    expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Type3/)
    expect(pdf.toString('latin1')).not.toMatch(/Nirmala|Gautami|Lohit|Pothana|Vani/)
  })

  it('the sample really is 200+ words and has the hard cases', () => {
    const words = TELUGU_SAMPLE.split(/\s+/).filter((w) => /[ఀ-౿]/.test(w))
    expect(words.length).toBeGreaterThanOrEqual(200)
    for (const hard of ['క్ష', 'స్త్ర', 'ద్ధ', 'శ్రీ', 'జ్ఞ', 'ఙ్మ', 'కా', 'కీ', 'కూ', 'కే', 'కో', 'ఐ', 'ఔ', '‌', '౨౫']) {
      expect(TELUGU_SAMPLE).toContain(hard)
    }
  })
})

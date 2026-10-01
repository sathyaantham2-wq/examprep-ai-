import { chromium } from 'playwright'
import type { Browser } from 'playwright'

/**
 * F033: server-side HTML->PDF on headless Chromium (tab09's locked choice). A single browser
 * instance is kept warm for the lifetime of this process rather than launched fresh per call --
 * launching Chromium is the expensive part of a render (far more than opening a page), and this
 * runs inside a request handler today (no background job queue exists yet, tab09's own "do not
 * run OCR/PDF inside a request handler" warning is a known gap, not an oversight -- see the F033
 * backlog note), so a request-scoped process would relaunch it every time regardless; keeping one
 * instance warm at least avoids paying that cost per PDF within a single warm process (and,
 * concretely, per test run in this suite -- launch/teardown churn across repeated PDF tests was
 * observed contributing to Vitest worker crashes on this memory-constrained host).
 */
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch()
  }
  let browser = await browserPromise
  if (!browser.isConnected()) {
    browserPromise = chromium.launch()
    browser = await browserPromise
  }
  return browser
}

/**
 * A4 with print margins every real printer can reach (most can't print within ~5 mm of the edge).
 * Exported so F107's print checks lay pages out exactly as production does.
 */
export const PDF_PAGE_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
} as const

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    // 'load' (not 'networkidle') -- the templates embed everything (styles, no remote images or
    // fonts), so there is no network activity to wait out.
    await page.setContent(html, { waitUntil: 'load' })
    // F087: web fonts (the inlined Telugu one) decode asynchronously after 'load'. Printing before
    // they are ready would silently use a fallback, or nothing, for those characters.
    await page.evaluate(async () => {
      await document.fonts.ready
    })
    const pdf = await page.pdf(PDF_PAGE_OPTIONS)
    return pdf
  } finally {
    await page.close()
  }
}

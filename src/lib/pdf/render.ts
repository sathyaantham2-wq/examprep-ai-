import { chromium } from 'playwright'

/**
 * F033: server-side HTML->PDF on headless Chromium (tab09's locked choice). One browser instance
 * is launched per render rather than kept warm -- this runs inside a request handler today (no
 * background job queue exists yet, tab09's own "do not run OCR/PDF inside a request handler"
 * warning is a known gap, not an oversight -- see the F033 backlog note), so there is no
 * long-lived process to keep a browser warm in between calls.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    // 'load' (not 'networkidle') -- the templates embed everything (styles, no remote images or
    // fonts), so there is no network activity to wait out.
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' },
    })
    return pdf
  } finally {
    await browser.close()
  }
}

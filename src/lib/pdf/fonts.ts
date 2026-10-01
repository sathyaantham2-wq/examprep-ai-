import notoSansTeluguWoff2 from './fonts/NotoSansTelugu-telugu.woff2?inline'

// F087: Telugu in PDFs. Papers are rendered by Chromium on the server, and a serverless Linux box
// has no Telugu font, so any Telugu text (a Telugu question, a student's Telugu answer in a
// report) would print as empty boxes. The font is therefore inlined into the PDF's own HTML as a
// data URL: no system font, no file path and no network access is needed when rendering.
//
// Noto Sans Telugu (SIL Open Font License, see ./fonts/OFL.txt), Google Fonts' Telugu subset: a
// variable font covering weights 100-900, 124 KB. unicode-range limits it to Telugu (plus the
// joiners and dotted circle conjuncts need), so Latin text keeps each template's own font.
const TELUGU_FAMILY = 'PrepPlan Telugu'

export const PDF_FONT_FACES = `
  @font-face {
    font-family: '${TELUGU_FAMILY}';
    src: url(${notoSansTeluguWoff2}) format('woff2');
    font-weight: 100 900;
    font-style: normal;
    unicode-range: U+0951-0952, U+0964-0965, U+0C00-0C7F, U+1CDA, U+1CF2, U+200C-200D, U+25CC;
  }`

/**
 * A font stack with Telugu first. Because of unicode-range, the browser only takes Telugu
 * characters from it and falls through to `rest` for everything else.
 */
export function withTelugu(rest: string): string {
  return `'${TELUGU_FAMILY}', ${rest}`
}

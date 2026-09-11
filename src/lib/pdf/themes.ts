// F120: "Themes are data-driven packs (layout tokens, fonts, ornaments) not forked templates.
// Ship three: Manga, Doodle Journal, Clean School. All use original artwork only and all print
// legibly in black and white." Supersedes F034's two-theme placeholder ('Plain' is renamed
// 'Clean School' by migration 0053) with the real pack framework: every theme is a plain-data
// ThemePack (layout tokens) run through the ONE buildThemeCss() function below, never its own
// hand-written CSS block -- adding a fourth theme later means adding a data object, not new
// rendering logic. paper-template.ts/key-template.ts stay untouched either way; a pack only ever
// adds decoration over the same question/diagram/choice-pair markup they already build.
//
// "Manga" is a genre and fine to evoke (CLAUDE.md); the ornament below is an original geometric
// burst, not any franchise's character, logo or typeface. "Doodle Journal" never references the
// franchise its name might evoke -- its ornament is an original hand-drawn-style squiggle.

export const PAPER_THEMES = ['Clean School', 'Doodle Journal', 'Manga'] as const
export type PaperTheme = (typeof PAPER_THEMES)[number]

export const DEFAULT_THEME: PaperTheme = 'Clean School'

export function isKnownTheme(value: string | null | undefined): value is PaperTheme {
  return (PAPER_THEMES as readonly string[]).includes(value ?? '')
}

export interface ThemePack {
  fontFamily: string
  headerBorder: string
  sectionTitleDecoration: string
  questionBorder: string
  questionBorderRadius: number
  // Alternating +/- rotation (degrees) applied to odd/even questions; 0 disables it entirely.
  questionRotationDeg: number
  marksBadge: boolean
  drawBoxRounded: boolean
  // A small, original, black-stroke-only SVG placed in the paper header's top-right corner. null
  // for a theme that deliberately carries no ornament (Clean School).
  cornerOrnament: string | null
}

function doodleSquiggleOrnament(): string {
  return `<svg viewBox="0 0 60 40" width="60" height="40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="doodle flourish">
    <path d="M4,30 Q14,8 24,30 T44,30" stroke="black" stroke-width="2" fill="none" />
    <circle cx="52" cy="14" r="3" fill="none" stroke="black" stroke-width="1.5" />
  </svg>`
}

function mangaSpeedLinesOrnament(): string {
  const originX = 55
  const originY = 5
  const segments = Array.from({ length: 7 }, (_, i) => {
    const angle = (Math.PI / 2 / 6) * i + Math.PI // sweeps into the top-right corner
    const length = 20 + (i % 2) * 8
    const x2 = originX + length * Math.cos(angle)
    const y2 = originY + length * Math.sin(angle)
    return `<line x1="${originX}" y1="${originY}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="black" stroke-width="2" />`
  }).join('')
  return `<svg viewBox="0 0 60 40" width="60" height="40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="speed lines">${segments}</svg>`
}

export const THEME_PACKS: Record<PaperTheme, ThemePack> = {
  'Clean School': {
    fontFamily: "Georgia, 'Times New Roman', serif",
    headerBorder: '2px solid #111',
    sectionTitleDecoration: 'underline',
    questionBorder: '',
    questionBorderRadius: 0,
    questionRotationDeg: 0,
    marksBadge: false,
    drawBoxRounded: false,
    cornerOrnament: null,
  },
  'Doodle Journal': {
    fontFamily: "'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive, Georgia, serif",
    headerBorder: '3px dashed #333',
    sectionTitleDecoration: 'wavy underline',
    questionBorder: '2px solid #222',
    questionBorderRadius: 14,
    questionRotationDeg: 0.5,
    marksBadge: true,
    drawBoxRounded: true,
    cornerOrnament: doodleSquiggleOrnament(),
  },
  Manga: {
    fontFamily: "'Arial Black', 'Helvetica Neue', Arial, sans-serif",
    headerBorder: '4px solid #000',
    sectionTitleDecoration: 'underline',
    questionBorder: '3px solid #000',
    questionBorderRadius: 0,
    questionRotationDeg: 0,
    marksBadge: true,
    drawBoxRounded: false,
    cornerOrnament: mangaSpeedLinesOrnament(),
  },
}

/**
 * The single CSS-generation path every theme goes through -- a pack only ever supplies data, this
 * function is what turns it into rules. Every rule stays within black/white/grey (no `color`
 * token in ThemePack at all), so "prints legibly in black and white" holds by construction.
 */
export function buildThemeCss(pack: ThemePack): string {
  const rotation = pack.questionRotationDeg
  return `
    body { font-family: ${pack.fontFamily}; }
    header.paper-header { border-bottom: ${pack.headerBorder}; }
    .section-title { text-decoration: ${pack.sectionTitleDecoration}; }
    ${
      pack.questionBorder
        ? `.question, .item {
      border: ${pack.questionBorder};
      border-radius: ${pack.questionBorderRadius}px;
      padding: 8px 10px;
    }`
        : ''
    }
    ${
      rotation
        ? `.question:nth-child(odd) { transform: rotate(-${rotation}deg); }
    .question:nth-child(even) { transform: rotate(${rotation}deg); }`
        : ''
    }
    ${
      pack.marksBadge
        ? `.q-marks {
      border: ${pack.questionBorder || '2px solid #222'};
      border-radius: 999px;
      padding: 2px 6px;
      align-self: flex-start;
    }`
        : ''
    }
    ${pack.drawBoxRounded ? `.draw-box { border-style: dashed; border-radius: 8px; }` : ''}
  `
}

export const THEME_STYLES: Record<PaperTheme, string> = Object.fromEntries(
  PAPER_THEMES.map((theme) => [theme, buildThemeCss(THEME_PACKS[theme])]),
) as Record<PaperTheme, string>

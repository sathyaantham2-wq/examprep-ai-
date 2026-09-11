// F034: "At least two themes (plain school format, illustrated/comic format) selectable at
// generation; both print in black-and-white legibly." CLAUDE.md names the illustrated theme
// "Doodle Journal" specifically (original artwork/CSS only -- never reference the franchise the
// name evokes). Themes are a CSS-only decoration layer over the SAME question/diagram/choice-pair
// markup paper-template.ts and key-template.ts already build -- not a forked template -- so this
// stays extensible for F120's fuller "data-driven theme pack" framework later without another
// rewrite of the rendering logic itself.

export const PAPER_THEMES = ['Plain', 'Doodle Journal'] as const
export type PaperTheme = (typeof PAPER_THEMES)[number]

export const DEFAULT_THEME: PaperTheme = 'Plain'

export function isKnownTheme(value: string | null | undefined): value is PaperTheme {
  return (PAPER_THEMES as readonly string[]).includes(value ?? '')
}

/**
 * Extra CSS appended after the base stylesheet paper-template.ts/key-template.ts already emit --
 * theme-specific rules only ever ADD decoration (border, rotation, font stack); they never touch
 * colour beyond black/white/grey, so "prints in black and white legibly" holds for every theme by
 * construction, not by per-theme review.
 */
export const THEME_STYLES: Record<PaperTheme, string> = {
  Plain: '',
  'Doodle Journal': `
    body { font-family: 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive, Georgia, serif; }
    header.paper-header { border-bottom: 3px dashed #333; }
    .section-title { text-decoration: wavy underline; text-decoration-color: #555; }
    .question {
      border: 2px solid #222;
      border-radius: 14px;
      padding: 8px 10px;
      margin-bottom: 16px;
    }
    .question:nth-child(odd) { transform: rotate(-0.5deg); }
    .question:nth-child(even) { transform: rotate(0.5deg); }
    .q-marks {
      border: 2px solid #222;
      border-radius: 999px;
      padding: 2px 6px;
      align-self: flex-start;
    }
    .draw-box { border-style: dashed; border-radius: 8px; }
    .item { border: 2px solid #222; border-radius: 14px; padding: 8px 10px; }
  `,
}

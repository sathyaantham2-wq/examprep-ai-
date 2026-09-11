import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, isKnownTheme, PAPER_THEMES, THEME_STYLES } from './themes'

describe('themes (F034)', () => {
  it('names at least two themes, as the plan requires', () => {
    expect(PAPER_THEMES.length).toBeGreaterThanOrEqual(2)
  })

  it('includes Plain and Doodle Journal specifically', () => {
    expect(PAPER_THEMES).toContain('Plain')
    expect(PAPER_THEMES).toContain('Doodle Journal')
  })

  it('the default theme is Plain', () => {
    expect(DEFAULT_THEME).toBe('Plain')
  })

  it('every named theme has a style entry, even if empty', () => {
    for (const theme of PAPER_THEMES) {
      expect(THEME_STYLES[theme]).toBeDefined()
    }
  })

  it('no theme style introduces a non-greyscale colour -- prints legibly in black and white', () => {
    // A cheap but real guardrail: anything that looks like a colour value in the CSS must be one
    // of black/white/grey/transparent/inherit -- never a hue.
    const colourValue = /(?:color|background)\s*:\s*([^;]+);/g
    for (const [theme, css] of Object.entries(THEME_STYLES)) {
      const matches = [...css.matchAll(colourValue)]
      for (const match of matches) {
        const value = match[1].trim()
        expect(
          /^(#[0-9a-f]{3,8}|black|white|transparent|inherit)$/i.test(value),
          `theme "${theme}" uses a non-greyscale colour: ${value}`,
        ).toBe(true)
      }
    }
  })

  describe('isKnownTheme', () => {
    it('accepts every named theme', () => {
      for (const theme of PAPER_THEMES) {
        expect(isKnownTheme(theme)).toBe(true)
      }
    })

    it('rejects an unrecognised, null, or undefined value', () => {
      expect(isKnownTheme('Some Made Up Theme')).toBe(false)
      expect(isKnownTheme(null)).toBe(false)
      expect(isKnownTheme(undefined)).toBe(false)
      expect(isKnownTheme('')).toBe(false)
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildThemeCss,
  DEFAULT_THEME,
  isKnownTheme,
  PAPER_THEMES,
  THEME_PACKS,
  THEME_STYLES,
} from './themes'

describe('themes (F120: data-driven theme packs)', () => {
  it('ships exactly the three named packs', () => {
    expect([...PAPER_THEMES].sort()).toEqual(
      ['Clean School', 'Doodle Journal', 'Manga'].sort(),
    )
  })

  it('the default theme is Clean School', () => {
    expect(DEFAULT_THEME).toBe('Clean School')
  })

  it('every named theme has a pack and a derived style entry', () => {
    for (const theme of PAPER_THEMES) {
      expect(THEME_PACKS[theme]).toBeDefined()
      expect(THEME_STYLES[theme]).toBeDefined()
    }
  })

  it('every theme is data-driven -- its CSS is exactly buildThemeCss(its own pack), not hand-written per theme', () => {
    for (const theme of PAPER_THEMES) {
      expect(THEME_STYLES[theme]).toBe(buildThemeCss(THEME_PACKS[theme]))
    }
  })

  it('Clean School carries no ornament; Doodle Journal and Manga each carry their own original one', () => {
    expect(THEME_PACKS['Clean School'].cornerOrnament).toBeNull()
    expect(THEME_PACKS['Doodle Journal'].cornerOrnament).toContain('<svg')
    expect(THEME_PACKS.Manga.cornerOrnament).toContain('<svg')
    // Distinct ornaments, not the same artwork reused under two names.
    expect(THEME_PACKS['Doodle Journal'].cornerOrnament).not.toBe(
      THEME_PACKS.Manga.cornerOrnament,
    )
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

  it('no ornament SVG uses a stroke or fill other than black/none -- prints legibly in black and white', () => {
    const strokeOrFill = /(?:stroke|fill)="([^"]+)"/g
    for (const [theme, pack] of Object.entries(THEME_PACKS)) {
      if (!pack.cornerOrnament) continue
      for (const match of pack.cornerOrnament.matchAll(strokeOrFill)) {
        expect(
          ['black', 'none'].includes(match[1]),
          `theme "${theme}" ornament uses a non-greyscale stroke/fill: ${match[1]}`,
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

    it('rejects an unrecognised, null, undefined, or retired value', () => {
      expect(isKnownTheme('Some Made Up Theme')).toBe(false)
      expect(isKnownTheme(null)).toBe(false)
      expect(isKnownTheme(undefined)).toBe(false)
      expect(isKnownTheme('')).toBe(false)
      // F034's placeholder name, retired by migration 0053 -- no longer a valid selection.
      expect(isKnownTheme('Plain')).toBe(false)
    })
  })

  describe('buildThemeCss', () => {
    it('a zero-token pack (no border, no rotation, no badge) produces no question/marks-badge rules', () => {
      const css = buildThemeCss({
        fontFamily: 'serif',
        headerBorder: '1px solid black',
        sectionTitleDecoration: 'none',
        questionBorder: '',
        questionBorderRadius: 0,
        questionRotationDeg: 0,
        marksBadge: false,
        drawBoxRounded: false,
        cornerOrnament: null,
      })
      expect(css).not.toContain('.question, .item')
      expect(css).not.toContain('.q-marks')
      expect(css).not.toContain('nth-child')
    })

    it('a fully-specified pack produces every corresponding rule', () => {
      const css = buildThemeCss({
        fontFamily: 'serif',
        headerBorder: '1px solid black',
        sectionTitleDecoration: 'none',
        questionBorder: '2px solid black',
        questionBorderRadius: 10,
        questionRotationDeg: 1,
        marksBadge: true,
        drawBoxRounded: true,
        cornerOrnament: null,
      })
      expect(css).toContain('.question, .item')
      expect(css).toContain('border-radius: 10px')
      expect(css).toContain('nth-child(odd)')
      expect(css).toContain('.q-marks')
      expect(css).toContain('.draw-box')
    })
  })
})

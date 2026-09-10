/**
 * F075: categorical + status color slots, validated (colorblind-separation, contrast, lightness
 * band) per the dataviz skill's reference palette -- this project has no categorical/status ramp
 * of its own yet, so these are the borrowed parameters (see references/palette.md in that skill).
 * Same hex in light and dark; only the categorical slots have distinct dark steps.
 */
export const CATEGORICAL_LIGHT = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
]
export const CATEGORICAL_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
]

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
}

export function categoricalColor(index: number, isDark: boolean): string {
  const ramp = isDark ? CATEGORICAL_DARK : CATEGORICAL_LIGHT
  return ramp[index % ramp.length]
}

import { z } from 'zod'
import { escapeHtml } from './html-utils'

// F024: "Diagram type + parameters render as SVG ... prints cleanly." diagram_kind/diagram_params
// (migration 0010) were always free-text/jsonb with no shape ever defined -- these six kinds and
// their parameter schemas are a documented default (the plan names the six kinds, never their
// parameters), matching the pattern RETEST_LADDER_DAYS/MARK_TO_POINT_MIN_CHARS/
// STUDENT_DAILY_GENERATION_QUOTA already set elsewhere in this codebase. Stroke-only, black on
// white/transparent -- every paper theme must print legibly in black and white (CLAUDE.md).

const STROKE = 'black'
const SVG_FONT = "font-family='Helvetica,Arial,sans-serif'"

function svg(width: number, height: number, inner: string): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`
}

function line(x1: number, y1: number, x2: number, y2: number, width = 1.5): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${STROKE}" stroke-width="${width}" />`
}

function text(x: number, y: number, value: string, anchor = 'middle'): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" ${SVG_FONT} font-size="11" fill="${STROKE}">${escapeHtml(value)}</text>`
}

/** Placeholder rendered when diagram_params fails its kind's schema -- labelled, not blank, so a
 * malformed row still tells the reader what was meant rather than silently degrading (F032's
 * "report, never hide" spirit applied to rendering instead of paper generation). */
function placeholder(kind: string, width = 200, height = 120): string {
  return svg(
    width,
    height,
    `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" fill="none" stroke="${STROKE}" stroke-width="1" stroke-dasharray="4,3" />` +
      text(width / 2, height / 2, `(${kind} diagram)`),
  )
}

const intersectingLinesSchema = z
  .object({
    // Angle labels for the four regions formed by the crossing lines, clockwise from top.
    labels: z.array(z.string()).max(4).optional(),
  })
  .optional()

function renderIntersectingLines(rawParams: unknown): string {
  const parsed = intersectingLinesSchema.safeParse(rawParams)
  if (!parsed.success) return placeholder('intersecting lines')
  const labels = parsed.data?.labels ?? []
  const positions = [
    { x: 100, y: 45 },
    { x: 155, y: 100 },
    { x: 100, y: 160 },
    { x: 45, y: 100 },
  ]
  return svg(
    200,
    200,
    line(20, 20, 180, 180) +
      line(180, 20, 20, 180) +
      positions
        .map((p, i) => (labels[i] ? text(p.x, p.y, labels[i]) : ''))
        .join(''),
  )
}

const transversalSchema = z
  .object({
    // Up to 8 angle labels at the two intersection points, numbered 1-8 the way NCERT diagrams
    // conventionally do (1-4 at the upper line, 5-8 at the lower).
    labels: z.array(z.string()).max(8).optional(),
  })
  .optional()

function renderTransversal(rawParams: unknown): string {
  const parsed = transversalSchema.safeParse(rawParams)
  if (!parsed.success) return placeholder('transversal')
  const labels = parsed.data?.labels ?? []
  const topY = 60
  const bottomY = 160
  const topX = 100
  const bottomX = 140
  const positions = [
    { x: topX - 22, y: topY - 12 },
    { x: topX + 22, y: topY - 12 },
    { x: topX - 22, y: topY + 20 },
    { x: topX + 22, y: topY + 20 },
    { x: bottomX - 22, y: bottomY - 12 },
    { x: bottomX + 22, y: bottomY - 12 },
    { x: bottomX - 22, y: bottomY + 20 },
    { x: bottomX + 22, y: bottomY + 20 },
  ]
  return svg(
    220,
    220,
    line(20, topY, 200, topY) +
      line(20, bottomY, 200, bottomY) +
      line(60, 20, 180, 200) +
      positions
        .map((p, i) => (labels[i] ? text(p.x, p.y, labels[i]) : ''))
        .join(''),
  )
}

const numberLineSchema = z
  .object({
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    points: z
      .array(z.object({ value: z.number(), label: z.string().optional() }))
      .optional(),
  })
  .refine((v) => v.max > v.min, { message: 'max must be greater than min' })

function renderNumberLine(rawParams: unknown): string {
  const parsed = numberLineSchema.safeParse(rawParams)
  if (!parsed.success) return placeholder('number line')
  const { min, max, points = [] } = parsed.data
  const step = parsed.data.step ?? 1
  const width = 320
  const marginX = 20
  const usableWidth = width - marginX * 2
  const toX = (value: number) =>
    marginX + ((value - min) / (max - min)) * usableWidth
  const ticks: Array<string> = []
  for (let v = min; v <= max + 1e-9; v += step) {
    const x = toX(v)
    ticks.push(line(x, 35, x, 45))
    ticks.push(text(x, 60, String(Math.round(v * 1000) / 1000)))
  }
  const markers = points.map((p) => {
    const x = toX(p.value)
    return (
      `<circle cx="${x}" cy="40" r="4" fill="${STROKE}" />` +
      (p.label ? text(x, 22, p.label) : '')
    )
  })
  return svg(width, 70, line(marginX, 40, width - marginX, 40) + ticks.join('') + markers.join(''))
}

const placeValueSchema = z.object({
  // Left-to-right column headers (e.g. ["Th", "H", "T", "O"]) paired positionally with digits.
  columns: z.array(z.string()).min(1).max(8),
  digits: z.array(z.union([z.string(), z.number()])).min(1).max(8),
})

function renderPlaceValue(rawParams: unknown): string {
  const parsed = placeValueSchema.safeParse(rawParams)
  if (!parsed.success) return placeholder('place value')
  const { columns, digits } = parsed.data
  const cellWidth = 40
  const cellHeight = 40
  const count = Math.min(columns.length, digits.length)
  const width = cellWidth * count + 20
  const cells: Array<string> = []
  for (let i = 0; i < count; i++) {
    const x = 10 + i * cellWidth
    cells.push(
      `<rect x="${x}" y="20" width="${cellWidth}" height="${cellHeight}" fill="none" stroke="${STROKE}" stroke-width="1.5" />`,
    )
    cells.push(text(x + cellWidth / 2, 14, columns[i]))
    cells.push(text(x + cellWidth / 2, 20 + cellHeight / 2 + 5, String(digits[i]), 'middle'))
  }
  return svg(width, 70, cells.join(''))
}

const circuitSchema = z
  .object({
    components: z
      .array(z.enum(['battery', 'bulb', 'switch']))
      .min(1)
      .max(6)
      .optional(),
  })
  .optional()

function renderCircuit(rawParams: unknown): string {
  const parsed = circuitSchema.safeParse(rawParams)
  if (!parsed.success) return placeholder('circuit')
  const components = parsed.data?.components ?? ['battery', 'bulb']
  const width = 220
  const height = 140
  const loop =
    line(30, 30, 190, 30) + // top wire
    line(190, 30, 190, 110) + // right wire
    line(190, 110, 30, 110) + // bottom wire
    line(30, 110, 30, 30) // left wire

  // Battery symbol: two parallel strokes of unequal length on the left wire, the conventional
  // schematic mark -- positioned regardless of whether it's actually requested, but only DRAWN
  // when 'battery' is in components, so an omitted battery leaves a plain wire there instead.
  const battery = components.includes('battery')
    ? line(20, 60, 40, 60, 4) + line(24, 72, 36, 72, 2) + text(50, 68, '+', 'start')
    : ''
  // Bulb symbol: a circle with a cross through it (schematic convention), on the top wire.
  const bulb = components.includes('bulb')
    ? `<circle cx="110" cy="30" r="12" fill="none" stroke="${STROKE}" stroke-width="1.5" />` +
      line(102, 22, 118, 38) +
      line(118, 22, 102, 38)
    : ''
  // Switch symbol: a break in the bottom wire with a diagonal stroke, the open-switch convention.
  const swtch = components.includes('switch')
    ? `<circle cx="90" cy="110" r="2.5" fill="${STROKE}" />` +
      `<circle cx="130" cy="110" r="2.5" fill="${STROKE}" />` +
      line(90, 110, 125, 96)
    : ''

  return svg(width, height, loop + battery + bulb + swtch)
}

const rayDiagramSchema = z.object({
  vertex: z.object({ x: z.number(), y: z.number() }).optional(),
  rays: z
    .array(
      z.object({
        // Degrees, standard trig convention: 0 = positive x-axis (east), increasing
        // counter-clockwise.
        angle: z.number(),
        length: z.number().positive().optional(),
        label: z.string().optional(),
      }),
    )
    .min(1)
    .max(8),
})

function renderRayDiagram(rawParams: unknown): string {
  const parsed = rayDiagramSchema.safeParse(rawParams)
  if (!parsed.success) return placeholder('ray diagram')
  const { rays } = parsed.data
  const vertex = parsed.data.vertex ?? { x: 100, y: 140 }
  const segments = rays.map((ray) => {
    const length = ray.length ?? 90
    const radians = (ray.angle * Math.PI) / 180
    // SVG's y axis points down, so a positive (counter-clockwise, math-convention) angle needs
    // its y term negated to actually rotate upward/counter-clockwise on screen.
    const endX = vertex.x + length * Math.cos(radians)
    const endY = vertex.y - length * Math.sin(radians)
    const labelX = vertex.x + (length + 14) * Math.cos(radians)
    const labelY = vertex.y - (length + 14) * Math.sin(radians)
    return (
      line(vertex.x, vertex.y, endX, endY) +
      (ray.label ? text(labelX, labelY, ray.label) : '')
    )
  })
  return svg(
    220,
    180,
    `<circle cx="${vertex.x}" cy="${vertex.y}" r="2.5" fill="${STROKE}" />` +
      segments.join(''),
  )
}

const DIAGRAM_RENDERERS: Partial<Record<string, (params: unknown) => string>> = {
  'intersecting-lines': renderIntersectingLines,
  transversal: renderTransversal,
  'number-line': renderNumberLine,
  'place-value': renderPlaceValue,
  circuit: renderCircuit,
  'ray-diagram': renderRayDiagram,
}

/**
 * Returns an SVG string for a known diagram_kind, or null for anything else -- callers (the paper
 * and answer-key templates) fall back to their pre-existing blank draw-box for null, so a custom
 * or unrecognised diagram_kind behaves exactly as it did before this feature existed.
 */
export function renderDiagramSvg(
  kind: string | null,
  params: unknown,
): string | null {
  if (!kind) return null
  const renderer = DIAGRAM_RENDERERS[kind]
  if (!renderer) return null
  return renderer(params)
}

export const KNOWN_DIAGRAM_KINDS = Object.keys(DIAGRAM_RENDERERS)

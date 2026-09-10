import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { categoricalColor } from './palette'

export interface LineSeries {
  label: string
  points: Array<{ x: string; y: number }>
}

/**
 * F075: "score-over-time per subject, Delivery Gap over time ... all charts print legibly."
 * Plain inline SVG, no charting dependency (dataviz skill: sequential/single-hue by default,
 * categorical only when there's a real series-per-subject story -- Class 7 Math launch scope is
 * one subject, so this reads as a single labelled line until more subjects exist). The last
 * point on every line is direct-labelled with its value, which is also what keeps the chart
 * legible once the print stylesheet flattens color to black-on-white -- position and text carry
 * the reading, not hue.
 */
export function LineChart({
  series,
  yFormat = (n) => String(n),
  height = 180,
}: {
  series: Array<LineSeries>
  yFormat?: (n: number) => string
  height?: number
}) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const isDark = mounted && resolvedTheme === 'dark'

  const nonEmpty = series.filter((s) => s.points.length > 0)
  if (nonEmpty.length === 0) {
    return (
      <p className="text-body text-muted-foreground">Not enough data yet.</p>
    )
  }

  const width = 560
  // Axis labels sit on the left, the line's end-value label on the right -- kept on opposite
  // sides so they can never collide, which they did when both lived on the right and a value
  // happened to land exactly on a gridline (e.g. a flat 0% line).
  const padding = { top: 12, right: 48, bottom: 20, left: 34 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const allY = nonEmpty.flatMap((s) => s.points.map((p) => p.y))
  const maxPoints = Math.max(...nonEmpty.map((s) => s.points.length))
  const yMin = Math.min(0, ...allY)
  // Rounds the top of the axis up to the nearest 10 (both this chart's real uses are
  // percentages) so gridlines read as clean numbers instead of an arbitrary fallback ceiling.
  const yMax = Math.max(10, Math.ceil(Math.max(...allY, 0) / 10) * 10)
  const yScale = (y: number) =>
    padding.top + plotHeight - ((y - yMin) / (yMax - yMin || 1)) * plotHeight
  const xScale = (i: number) =>
    padding.left + (maxPoints > 1 ? (i / (maxPoints - 1)) * plotWidth : plotWidth / 2)

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((t) => yMin + t * (yMax - yMin))

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={series.map((s) => s.label).join(', ')}
        className="w-full"
      >
        {gridLines.map((g) => (
          <line
            key={g}
            x1={padding.left}
            x2={width - padding.right}
            y1={yScale(g)}
            y2={yScale(g)}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}
        {gridLines.map((g) => (
          <text
            key={`label-${g}`}
            x={padding.left - 6}
            y={yScale(g)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {yFormat(Math.round(g))}
          </text>
        ))}

        {nonEmpty.map((s, seriesIndex) => {
          const color = categoricalColor(seriesIndex, isDark)
          const path = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.y)}`)
            .join(' ')
          const last = s.points.at(-1)!
          return (
            <g key={s.label}>
              <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle
                cx={xScale(s.points.length - 1)}
                cy={yScale(last.y)}
                r={4}
                fill={color}
                className="stroke-background"
                strokeWidth={2}
              />
              <text
                x={xScale(s.points.length - 1) + 8}
                y={yScale(last.y)}
                dominantBaseline="middle"
                className="fill-foreground text-[12px] font-medium"
              >
                {yFormat(last.y)}
              </text>
            </g>
          )
        })}
      </svg>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {nonEmpty.map((s, i) => (
            <span key={s.label} className="text-small text-muted-foreground flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: categoricalColor(i, isDark) }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

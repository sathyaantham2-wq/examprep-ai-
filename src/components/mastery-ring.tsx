/**
 * F072 (tab06): "mastery ring" component, reusable across screens that show chapter/concept
 * progress. Plain inline SVG (no charting dependency) — a track circle plus a foreground arc
 * sized to `percent`, using `currentColor` so it inherits the theme's text color automatically
 * in both light and dark mode rather than a hardcoded palette.
 */
export function MasteryRing({
  percent,
  label,
  size = 88,
}: {
  percent: number
  label: string
  size?: number
}) {
  const clamped = Math.max(0, Math.min(100, percent))
  const strokeWidth = size * 0.11
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - clamped / 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="text-muted stroke-current"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="text-primary stroke-current transition-[stroke-dashoffset]"
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
          className="fill-current text-[0.9rem] font-medium"
        >
          {clamped}%
        </text>
      </svg>
      <span className="text-small text-muted-foreground max-w-[6.5rem] text-center leading-tight">
        {label}
      </span>
    </div>
  )
}

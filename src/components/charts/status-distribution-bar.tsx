import { STATUS } from './palette'

const SEGMENT_ORDER: Array<{ status: string; color: string; label: string }> = [
  { status: 'Strong', color: STATUS.good, label: 'Strong' },
  { status: 'Maintenance', color: STATUS.good, label: 'Maintenance' },
  { status: 'Needs Practice', color: STATUS.warning, label: 'Needs Practice' },
  { status: 'Weak', color: STATUS.serious, label: 'Weak' },
  { status: 'Priority', color: STATUS.critical, label: 'Priority' },
]

/**
 * F075: "concept status distribution" -- a single horizontal stacked bar, good -> critical left
 * to right, using the dataviz skill's reserved status palette (never the categorical ramp: this
 * is state, not series identity). Strong and Maintenance share the "good" step since both mean
 * "no concern" for a parent reading this at a glance; the 2px surface gap plus each segment's own
 * count label is what keeps them distinguishable, not the color alone.
 */
export function StatusDistributionBar({
  counts,
}: {
  counts: Record<string, number>
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) {
    return (
      <p className="text-body text-muted-foreground">
        No concepts tracked yet.
      </p>
    )
  }

  const segments = SEGMENT_ORDER.map((s) => ({
    ...s,
    count: counts[s.status] ?? 0,
  })).filter((s) => s.count > 0)

  const gapPx = 2
  const totalGap = gapPx * (segments.length - 1)

  return (
    <div>
      <div className="flex h-6 w-full overflow-hidden rounded-md" style={{ gap: gapPx }}>
        {segments.map((s) => (
          <div
            key={s.status}
            style={{
              backgroundColor: s.color,
              flexBasis: `calc(${(s.count / total) * 100}% - ${(totalGap * s.count) / total}px)`,
            }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <span
            key={s.status}
            className="text-small text-muted-foreground flex items-center gap-1.5"
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.label} ({s.count})
          </span>
        ))}
      </div>
    </div>
  )
}

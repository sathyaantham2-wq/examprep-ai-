import type { Db } from '../db/connection'
import { aiJobsRepository } from '../db/repositories'
import type { AiUsageGroupBy } from '../db/repositories/ops'

// tab07's own AI function IDs -- the exact `feature` value every AI-*.ts module logs -- mapped to
// a label a non-engineer admin can read on the dashboard.
const FEATURE_LABELS: Record<string, string> = {
  'AI-01': 'Question generation',
  'AI-05': 'Subjective grading',
  'AI-09': 'Remediation content',
}

export interface AiUsageBucket {
  group_key: string | null
  label: string
  calls: number
  tokens_in: number
  tokens_out: number
  cost_inr: number
  avg_latency_ms: number | null
  error_count: number
}

export interface AiUsageReport {
  from: string
  to: string
  group_by: AiUsageGroupBy
  totals: {
    calls: number
    tokens_in: number
    tokens_out: number
    cost_inr: number
    error_count: number
  }
  buckets: Array<AiUsageBucket>
}

/**
 * F091: GET /api/admin/ai-usage per tab05 -- "token and cost aggregates" for the admin dashboard
 * (tab06 /admin/usage), grouped by day, feature, or student. Totals are computed as their own
 * ungrouped query rather than by summing the buckets, so a bug in one grouping's SQL can't
 * silently corrupt the other's numbers.
 */
export async function getAiUsageReport(
  db: Db,
  input: { from: Date; to: Date | null; groupBy: AiUsageGroupBy },
): Promise<AiUsageReport> {
  const [rows, totals] = await Promise.all([
    aiJobsRepository.aggregateUsage(db, input),
    aiJobsRepository.totalsForRange(db, input),
  ])

  const studentIds = [
    ...new Set(
      input.groupBy === 'student'
        ? rows.map((r) => r.group_key).filter((k): k is string => k !== null)
        : [],
    ),
  ]
  const studentNames =
    studentIds.length > 0
      ? await db
          .selectFrom('students')
          .select(['id', 'name'])
          .where('id', 'in', studentIds)
          .execute()
      : []
  const nameById = new Map(studentNames.map((s) => [s.id, s.name]))

  const buckets: Array<AiUsageBucket> = rows.map((row) => ({
    ...row,
    label: labelFor(input.groupBy, row.group_key, nameById),
  }))

  return {
    from: input.from.toISOString().slice(0, 10),
    to: (input.to ?? new Date()).toISOString().slice(0, 10),
    group_by: input.groupBy,
    totals,
    buckets,
  }
}

function labelFor(
  groupBy: AiUsageGroupBy,
  groupKey: string | null,
  nameById: Map<string, string>,
): string {
  if (groupBy === 'day') return groupKey ?? 'Unknown'
  if (groupBy === 'feature') return FEATURE_LABELS[groupKey ?? ''] ?? (groupKey ?? 'Unknown')
  // student
  if (groupKey === null) return 'Bank generation (no student)'
  return nameById.get(groupKey) ?? 'Unknown student'
}

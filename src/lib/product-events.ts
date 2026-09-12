import type { Db } from '../db/connection'
import { productEventsRepository } from '../db/repositories'

// F093: "Events: paper generated, downloaded, attempted, uploaded, evaluated, remediated."
// 'attempt_uploaded' is declared here (and on the DB check constraint) for when F050 (upload of
// photos/scanned PDF) lands -- it has no real trigger point in this codebase yet, since that
// whole OCR upload cluster is unbuilt, so nothing fires it today. The other five are wired into
// their real HTTP routes below.
export type ProductEventType =
  | 'paper_generated'
  | 'paper_downloaded'
  | 'attempt_submitted'
  | 'attempt_uploaded'
  | 'evaluation_completed'
  | 'remediation_started'

// Funnel order matches the AC's own listing exactly: generated -> downloaded -> attempted ->
// uploaded -> evaluated -> remediated.
export const PRODUCT_EVENT_FUNNEL_ORDER: Array<ProductEventType> = [
  'paper_generated',
  'paper_downloaded',
  'attempt_submitted',
  'attempt_uploaded',
  'evaluation_completed',
  'remediation_started',
]

/**
 * F093: first-party event log, "privacy-respecting, no third-party ad pixels" -- every row is
 * this app's own household/student action, written to this app's own database, never sent
 * anywhere external. Never throws: analytics must never take down the action it's observing,
 * same principle as logAiJob (src/lib/ai-metering.ts).
 */
export async function logProductEvent(
  db: Db,
  input: {
    eventType: ProductEventType
    householdId: string
    studentId: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  try {
    await productEventsRepository.insert(db, {
      household_id: input.householdId,
      student_id: input.studentId,
      event_type: input.eventType,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    })
  } catch (err) {
    console.error('logProductEvent: failed to write product_events row', err)
  }
}

export interface ProductFunnelStage {
  event_type: ProductEventType
  households: number
  students: number
  events: number
  // Percentage of the FIRST stage's household count that reached this stage -- the standard
  // funnel-completion metric ("of everyone who generated a paper, what % got as far as
  // evaluation?"), null for the first stage itself (nothing to compare against).
  pct_of_first_stage: number | null
}

export interface ProductFunnelReport {
  from: string
  to: string
  stages: Array<ProductFunnelStage>
}

/**
 * F093: "funnel view." Always reports all six stages in funnel order, even ones with zero events
 * in range (a household count of 0 is itself meaningful -- "nobody uploaded anything this month"
 * -- so a missing row would misreport that as "we don't know" rather than "zero").
 */
export async function getProductFunnelReport(
  db: Db,
  input: { from: Date; to: Date | null },
): Promise<ProductFunnelReport> {
  const rows = await productEventsRepository.funnelCounts(db, input)
  const byType = new Map(rows.map((r) => [r.event_type, r]))
  const firstStageHouseholds = byType.get(PRODUCT_EVENT_FUNNEL_ORDER[0])?.households ?? 0

  const stages: Array<ProductFunnelStage> = PRODUCT_EVENT_FUNNEL_ORDER.map(
    (eventType, index) => {
      const row = byType.get(eventType)
      const households = row?.households ?? 0
      return {
        event_type: eventType,
        households,
        students: row?.students ?? 0,
        events: row?.events ?? 0,
        pct_of_first_stage:
          index === 0 || firstStageHouseholds === 0
            ? null
            : Math.round((households / firstStageHouseholds) * 1000) / 10,
      }
    },
  )

  return {
    from: input.from.toISOString().slice(0, 10),
    to: (input.to ?? new Date()).toISOString().slice(0, 10),
    stages,
  }
}

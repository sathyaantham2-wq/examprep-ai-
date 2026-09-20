import type { Db } from '../db/connection'
import type { BloomLevel, DifficultyTier } from '../db/enums'
import {
  chapterScopeRepository,
  conceptsRepository,
  generationBatchItemsRepository,
  generationBatchesRepository,
  questionsRepository,
} from '../db/repositories'
import { computeCoverageGridForSubject } from './coverage-grid'
import {
  generateQuestions,
  isAiQuestionGenerationConfigured,
} from './ai-question-generation'
import { estimateCostInr } from './ai-metering'
import { createQuestion } from './questions'

// F116: each chunk is capped at this many questions -- keeps one AI call's output bounded and
// gives resumability real granularity (a cell needing 50 tops up 10 at a time across batches,
// rather than one huge unresumable call). Re-running planBatch later picks up the remainder,
// per CLAUDE.md invariant 3's "top-up job ... idempotent and safe to re-run".
const MAX_PER_CELL_PER_BATCH = 10
const DEFAULT_MAX_ITEMS_PER_RUN = 10

export type PlanBatchResult =
  | { ok: true; batchId: string }
  | { ok: false; reason: 'ai_not_configured' | 'no_shortfall' }

/**
 * F116: scans every concept in the subject's Bloom x difficulty grid (F115) for shortfall cells
 * and enqueues one generation_batch_items row per cell, capped at MAX_PER_CELL_PER_BATCH. Does
 * not call the model yet -- runBatch() does that, chunk by chunk, so this stays fast and the
 * caller can inspect the plan before spending anything.
 */
export async function planBatch(
  db: Db,
  input: { subjectId: string; costCapInr: number; createdBy: string },
): Promise<PlanBatchResult> {
  if (!isAiQuestionGenerationConfigured()) {
    return { ok: false, reason: 'ai_not_configured' }
  }

  const grids = await computeCoverageGridForSubject(db, input.subjectId)
  const cells: Array<{
    concept_id: string
    bloom: BloomLevel
    difficulty: DifficultyTier
    target_count: number
  }> = []
  for (const grid of grids) {
    for (const cell of grid.cells) {
      if (!cell.shortfall) continue
      const needed = Math.min(cell.target - cell.count, MAX_PER_CELL_PER_BATCH)
      if (needed <= 0) continue
      cells.push({
        concept_id: grid.concept_id,
        bloom: cell.bloom,
        difficulty: cell.difficulty,
        target_count: needed,
      })
    }
  }

  if (cells.length === 0) {
    return { ok: false, reason: 'no_shortfall' }
  }

  const batch = await generationBatchesRepository.insert(db, {
    subject_id: input.subjectId,
    cost_cap_inr: input.costCapInr,
    created_by: input.createdBy,
    status: 'pending',
  })

  await generationBatchItemsRepository.insertMany(
    db,
    cells.map((c) => ({ ...c, batch_id: batch.id, status: 'pending' as const })),
  )

  return { ok: true, batchId: batch.id }
}

export interface RunBatchSummary {
  batch_id: string
  status: string
  cost_spent_inr: number
  cost_cap_inr: number
  items_processed: number
  items_remaining: number
}

/**
 * Processes up to `maxItems` pending cells of an existing batch, one at a time, stopping early
 * if the cost cap is reached. Safe to call repeatedly (resumable): a cell already marked 'done'
 * is never reprocessed, so re-running never generates duplicate questions for the same cell.
 * Each cell's accepted candidates are written in one transaction -- a mid-write failure rolls
 * back that cell only, "never leaves partial ... data" per F116's AC.
 */
export async function runBatch(
  db: Db,
  batchId: string,
  maxItems = DEFAULT_MAX_ITEMS_PER_RUN,
): Promise<RunBatchSummary | null> {
  const batch = await generationBatchesRepository.findById(db, batchId)
  if (!batch) return null

  if (batch.status === 'completed' || batch.status === 'failed') {
    return {
      batch_id: batch.id,
      status: batch.status,
      cost_spent_inr: Number(batch.cost_spent_inr),
      cost_cap_inr: Number(batch.cost_cap_inr),
      items_processed: 0,
      items_remaining: await generationBatchItemsRepository.countPending(
        db,
        batchId,
      ),
    }
  }

  await generationBatchesRepository.update(db, batchId, { status: 'running' })

  let costSpent = Number(batch.cost_spent_inr)
  const costCap = Number(batch.cost_cap_inr)
  const pending = await generationBatchItemsRepository.listPending(
    db,
    batchId,
    maxItems,
  )

  let itemsProcessed = 0

  for (const item of pending) {
    if (costSpent >= costCap) break

    try {
      const concept = await conceptsRepository.findById(db, item.concept_id)
      if (!concept) throw new Error('Concept no longer exists')

      const scope = await chapterScopeRepository.listByChapter(
        db,
        concept.chapter_id,
      )
      const { items: exemplarQuestions } = await questionsRepository.search(
        db,
        {
          concept_id: item.concept_id,
          bloom: item.bloom,
          difficulty: item.difficulty,
          status: 'approved',
        },
        3,
        0,
      )

      const result = await generateQuestions(db, {
        conceptName: concept.name,
        syllabusLabel: `${concept.board} Class ${concept.class} Mathematics`,
        conceptIdea: concept.idea,
        conceptRule: concept.rule,
        conceptExample: concept.example,
        scope,
        bloom: item.bloom,
        difficulty: item.difficulty,
        marks: 1,
        type: 'mcq',
        count: item.target_count,
        exemplars: exemplarQuestions.map((q) => ({
          text: q.text,
          answer: q.answer,
        })),
        householdId: null,
        studentId: null,
      })

      if (!result) {
        throw new Error('AI provider is not configured')
      }

      if (result.accepted.length === 0) {
        await generationBatchItemsRepository.update(db, item.id, {
          status: 'failed',
          error: `All ${result.rejected.length} candidate(s) failed the scope guardrail`,
        })
      } else {
        await db.transaction().execute(async (trx) => {
          for (const candidate of result.accepted) {
            await createQuestion(trx, {
              concept_id: item.concept_id,
              board: concept.board,
              class: concept.class,
              bloom: item.bloom,
              difficulty: item.difficulty,
              marks: 1,
              type: 'mcq',
              text: candidate.text,
              answer: candidate.answer,
              hint: candidate.hint,
              tags: candidate.tags,
              options: candidate.options?.map((o, index) => ({
                label: o.label,
                text: o.text,
                is_correct: o.is_correct,
                order_index: index,
              })),
              source_ref: candidate.in_scope_ref,
              created_by: batch.created_by,
              origin: 'ai_generated',
            })
          }
          await generationBatchItemsRepository.update(trx, item.id, {
            status: 'done',
            generated_count: result.accepted.length,
          })
        })
      }

      if (result.usage) {
        const cost = estimateCostInr(result.usage)
        costSpent += cost
        await generationBatchesRepository.addCostSpent(db, batchId, cost)
      }
    } catch (error) {
      await generationBatchItemsRepository.update(db, item.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }

    itemsProcessed += 1
  }

  const itemsRemaining = await generationBatchItemsRepository.countPending(
    db,
    batchId,
  )
  // Paused either because the per-run item cap or the cost cap was reached -- either way there
  // is remaining work a future runBatch() call (the resume endpoint) will pick back up.
  const finalStatus = itemsRemaining === 0 ? 'completed' : 'paused'
  const updated = await generationBatchesRepository.update(db, batchId, {
    status: finalStatus,
  })

  return {
    batch_id: updated.id,
    status: updated.status,
    cost_spent_inr: Number(updated.cost_spent_inr),
    cost_cap_inr: Number(updated.cost_cap_inr),
    items_processed: itemsProcessed,
    items_remaining: itemsRemaining,
  }
}

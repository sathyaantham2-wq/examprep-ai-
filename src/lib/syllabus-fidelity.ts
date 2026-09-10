import type { Db } from '../db/connection'

export interface FidelityViolation {
  question_id: string
  question_text: string
  concept_id: string
  concept_name: string
  chapter_id: string
  chapter_name: string
  reason: string
}

/**
 * F106: "every question in a generated paper maps to an IN-scope concept for that chapter and
 * source book; zero violations required." CLAUDE.md invariant 5 says "a concept cannot exist
 * without a chapter scope record" as a product rule, but nothing in the schema actually enforces
 * it at the DB level (a concept can be created under a chapter with zero chapter_scope rows, and
 * F025's own in-scope-citation guardrail only runs for AI-generated questions -- a manually
 * authored or bulk-imported question never passes through it at all). This audit is the backstop
 * that actually checks the rule, across the whole approved bank, not just AI output.
 *
 * Only approved questions are checked -- a paper can only ever draw from approved questions
 * (F027-032's generator has always filtered status='approved'), so an approved question with no
 * real scope grounding is the actual violation this feature's AC cares about; a draft awaiting
 * review is not yet "in a generated paper."
 */
export async function auditSyllabusFidelity(db: Db): Promise<Array<FidelityViolation>> {
  const rows = await db
    .selectFrom('questions')
    .innerJoin('concepts', 'concepts.id', 'questions.concept_id')
    .innerJoin('chapters', 'chapters.id', 'concepts.chapter_id')
    .leftJoin('sources', 'sources.id', 'chapters.source_id')
    .select([
      'questions.id as question_id',
      'questions.text as question_text',
      'concepts.id as concept_id',
      'concepts.name as concept_name',
      'chapters.id as chapter_id',
      'chapters.name as chapter_name',
      'sources.id as source_id',
    ])
    .where('questions.status', '=', 'approved')
    .execute()

  if (rows.length === 0) return []

  const chapterIds = [...new Set(rows.map((r) => r.chapter_id))]
  const inScopeCounts = await db
    .selectFrom('chapter_scope')
    .select(['chapter_id', (eb) => eb.fn.countAll<string>().as('count')])
    .where('chapter_id', 'in', chapterIds)
    .where('kind', '=', 'IN')
    .groupBy('chapter_id')
    .execute()
  const inScopeCountByChapter = new Map(
    inScopeCounts.map((r) => [r.chapter_id, Number(r.count)]),
  )

  const violations: Array<FidelityViolation> = []
  for (const row of rows) {
    const base = {
      question_id: row.question_id,
      question_text: row.question_text,
      concept_id: row.concept_id,
      concept_name: row.concept_name,
      chapter_id: row.chapter_id,
      chapter_name: row.chapter_name,
    }
    if (!row.source_id) {
      violations.push({ ...base, reason: 'Chapter has no source book on record' })
      continue
    }
    if ((inScopeCountByChapter.get(row.chapter_id) ?? 0) === 0) {
      violations.push({ ...base, reason: 'Chapter has no IN-scope record at all' })
    }
  }
  return violations
}

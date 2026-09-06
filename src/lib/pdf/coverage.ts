import type { Db } from '../../db/connection'
import type { BloomLevel } from '../../db/enums'

export interface CoverageRow {
  concept_id: string
  concept_name: string
  question_count: number
  marks: number
  weight_pct: number
  bloom_split: Partial<Record<BloomLevel, number>>
}

/**
 * F037: "concept, questions, marks, % weight, Bloom split" -- one row per concept actually used
 * on the paper. Kept independent of the PDF templates (coverage.integration.test.ts exercises it
 * directly) since the AC also wants this "shown on screen", which doesn't exist yet but will want
 * the same data shape.
 */
export async function computeCoverageTable(
  db: Db,
  paperId: string,
): Promise<Array<CoverageRow>> {
  const rows = await db
    .selectFrom('paper_questions')
    .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
    .innerJoin('concepts', 'concepts.id', 'questions.concept_id')
    .select([
      'concepts.id as concept_id',
      'concepts.name as concept_name',
      'paper_questions.marks as marks',
      'questions.bloom as bloom',
    ])
    .where('paper_questions.paper_id', '=', paperId)
    .execute()

  const totalMarks = rows.reduce((sum, r) => sum + r.marks, 0)
  const byConcept = new Map<string, CoverageRow>()
  for (const row of rows) {
    const existing = byConcept.get(row.concept_id) ?? {
      concept_id: row.concept_id,
      concept_name: row.concept_name,
      question_count: 0,
      marks: 0,
      weight_pct: 0,
      bloom_split: {},
    }
    existing.question_count += 1
    existing.marks += row.marks
    existing.bloom_split[row.bloom] = (existing.bloom_split[row.bloom] ?? 0) + 1
    byConcept.set(row.concept_id, existing)
  }

  const result = [...byConcept.values()]
  for (const r of result) {
    r.weight_pct =
      totalMarks > 0 ? Math.round((r.marks / totalMarks) * 1000) / 10 : 0
  }
  return result.sort((a, b) => a.concept_name.localeCompare(b.concept_name))
}

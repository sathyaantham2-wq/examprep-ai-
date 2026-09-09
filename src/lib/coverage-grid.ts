import type { Db } from '../db/connection'
import type { BloomLevel, DifficultyTier } from '../db/enums'

const BLOOM_LEVELS: Array<BloomLevel> = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
]
const DIFFICULTY_TIERS: Array<DifficultyTier> = ['Easy', 'Hard', 'Hardest']

export interface CoverageCell {
  bloom: BloomLevel
  difficulty: DifficultyTier
  count: number
  target: number
  shortfall: boolean
}

export interface ConceptCoverageGrid {
  concept_id: string
  concept_name: string
  target_question_count: number
  cells: Array<CoverageCell>
  empty_cells: number
}

/**
 * F115: "a 6 Bloom x 3 difficulty grid shows counts and target counts." target_question_count
 * (F122) is a single per-concept number, not one per cell -- there is no per-cell target defined
 * anywhere in the plan, so this splits it evenly across all 18 cells (rounded up) as the simplest
 * defensible per-cell target. A cell below that target is a shortfall; "papers cannot request an
 * empty cell without a stated fallback" is already true structurally (generatePaper reports a
 * shortfall rather than failing when a slot has no eligible question -- F027-F032), this grid is
 * what would drive a targeted generation batch (F116) at the cells actually empty.
 */
export async function computeCoverageGrid(
  db: Db,
  conceptId: string,
): Promise<ConceptCoverageGrid> {
  const concept = await db
    .selectFrom('concepts')
    .select(['id', 'name', 'target_question_count'])
    .where('id', '=', conceptId)
    .executeTakeFirstOrThrow()

  const rows = await db
    .selectFrom('questions')
    .select(['bloom', 'difficulty', (eb) => eb.fn.countAll().as('count')])
    .where('concept_id', '=', conceptId)
    .where('status', '=', 'approved')
    .groupBy(['bloom', 'difficulty'])
    .execute()

  const countByCell = new Map<string, number>()
  for (const row of rows) {
    countByCell.set(`${row.bloom}|${row.difficulty}`, Number(row.count))
  }

  const perCellTarget = Math.ceil(concept.target_question_count / 18)
  const cells: Array<CoverageCell> = []
  for (const bloom of BLOOM_LEVELS) {
    for (const difficulty of DIFFICULTY_TIERS) {
      const count = countByCell.get(`${bloom}|${difficulty}`) ?? 0
      cells.push({
        bloom,
        difficulty,
        count,
        target: perCellTarget,
        shortfall: count < perCellTarget,
      })
    }
  }

  return {
    concept_id: concept.id,
    concept_name: concept.name,
    target_question_count: concept.target_question_count,
    cells,
    empty_cells: cells.filter((c) => c.count === 0).length,
  }
}

export async function computeCoverageGridForSubject(
  db: Db,
  subjectId: string,
): Promise<Array<ConceptCoverageGrid>> {
  const concepts = await db
    .selectFrom('concepts')
    .innerJoin('chapters', 'chapters.id', 'concepts.chapter_id')
    .select(['concepts.id'])
    .where('chapters.subject_id', '=', subjectId)
    .execute()

  const grids: Array<ConceptCoverageGrid> = []
  for (const concept of concepts) {
    grids.push(await computeCoverageGrid(db, concept.id))
  }
  return grids.sort((a, b) => b.empty_cells - a.empty_cells)
}

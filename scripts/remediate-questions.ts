/**
 * Applies a remediation delta to an already-loaded chapter: for each swap, retires one existing
 * question (by exact text match) and inserts one replacement in the SAME Bloom x difficulty cell,
 * so target_question_count and the grid shape are never touched -- only which question occupies
 * that cell changes. Built for two 2026-09-26 remediation passes: adding reversal/assertion_reason/
 * multi_statement coverage to Class 7 (authored before those conventions existed) and varying the
 * assertion_reason answer-key distribution bank-wide (78.9% of A-R items shared one key).
 *
 * Retiring only flips `questions.status` to 'retired' -- not a FK target anywhere (see
 * src/routes/api/questions/$id.ts), so every paper/attempt/evaluation that already used the
 * question keeps referencing it untouched, per CLAUDE.md invariant 4 ("nothing is deleted").
 *
 * Delta file shape (content/remediation/<set>/<file>.json):
 *   {
 *     "subject_code": "SST",
 *     "chapter": { "part": "I", "chapter_no": 1 },
 *     "swaps": [
 *       {
 *         "concept_code": "C7S-1.1",
 *         "retire_text": "<exact text of the question being replaced>",
 *         "add": { "b": "Remember", "d": "Easy", "t": "mcq", "m": 1, "q": "...", "a": "...",
 *                   "o": ["...", "...", "...", "..."], "rev": true }
 *       }
 *     ]
 *   }
 *
 * Usage (same convention as load-authored-chapter.ts):
 *   node scripts/with-test-env.mjs npx tsx scripts/remediate-questions.ts <delta.json> --check
 *   node scripts/with-test-env.mjs npx tsx scripts/remediate-questions.ts <delta.json>       # local
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/remediate-questions.ts <delta.json>  # prod
 *
 * Idempotent: re-running skips a swap whose "add" text already exists for the concept, and skips
 * retiring a question that is already retired.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb } from '../src/db/connection'
import { computeTextHash } from '../src/lib/duplicate-detection'
import { createQuestion } from '../src/lib/questions'

type Bloom = 'Remember' | 'Understand' | 'Apply' | 'Analyse' | 'Evaluate' | 'Create'
type Tier = 'Easy' | 'Hard' | 'Hardest'
type QType = 'mcq' | 'short_answer' | 'long_answer' | 'fill_blank' | 'assertion_reason' | 'multi_statement' | 'match'

interface AddQuestion {
  b: Bloom
  d: Tier
  t: QType
  m: number
  q: string
  a: string
  o?: Array<string>
  s?: Array<[string, number]>
  rev?: boolean
}

interface Swap {
  concept_code: string
  retire_text: string
  add: AddQuestion
}

interface DeltaFile {
  subject_code: string
  chapter: { part: string; chapter_no: number }
  swaps: Array<Swap>
}

const OPTION_TYPES = new Set<QType>(['mcq', 'assertion_reason', 'multi_statement'])

function validateAdd(swap: Swap, i: number): Array<string> {
  const problems: Array<string> = []
  const where = `swap #${i + 1} (${swap.concept_code})`
  if (!swap.retire_text.trim()) problems.push(`${where}: retire_text is empty`)
  const q = swap.add
  if (!q.q.trim()) problems.push(`${where}: add.q is empty`)
  if (!q.a.trim()) problems.push(`${where}: add.a is empty`)
  if (OPTION_TYPES.has(q.t)) {
    if (!q.o || q.o.length !== 4) problems.push(`${where}: ${q.t} needs 4 options`)
    else if (new Set(q.o.map((x) => x.trim())).size !== 4) problems.push(`${where}: options are not distinct`)
    else if (q.o[0] !== q.a) problems.push(`${where}: correct option must be listed first (o[0] === a)`)
    if (q.m !== 1) problems.push(`${where}: ${q.t} is worth 1 mark`)
    if (q.s) problems.push(`${where}: ${q.t} has step marks`)
  } else if (q.t === 'fill_blank') {
    if (q.m !== 1) problems.push(`${where}: fill_blank is worth 1 mark`)
  } else {
    const sum = (q.s ?? []).reduce((n, [, m]) => n + m, 0)
    if (!q.s || q.s.length === 0) problems.push(`${where}: written question needs step marks`)
    else if (sum !== q.m) problems.push(`${where}: steps sum to ${sum}, question is ${q.m}`)
  }
  return problems
}

function shuffled<T>(items: Array<T>, seed: string): Array<T> {
  const keyed = items.map((item, i) => ({ item, k: createHash('sha256').update(`${seed}|${i}`).digest('hex') }))
  return keyed.sort((x, y) => (x.k < y.k ? -1 : 1)).map((x) => x.item)
}

async function main() {
  const path = process.argv[2]
  const check = process.argv.includes('--check')
  const file = JSON.parse(readFileSync(path, 'utf8')) as DeltaFile

  const problems: Array<string> = []
  if (!file.subject_code) problems.push('subject_code is missing')
  if (!file.chapter?.part || !file.chapter?.chapter_no) problems.push('chapter.part/chapter_no is missing')
  if (!file.swaps || file.swaps.length === 0) problems.push('swaps is empty')
  file.swaps?.forEach((s, i) => problems.push(...validateAdd(s, i)))
  const texts = (file.swaps ?? []).map((s) => s.add.q)
  if (new Set(texts).size !== texts.length) problems.push('duplicate add.q text within this delta file')

  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  console.log(`${path}: ${file.swaps.length} swaps, valid`)
  if (check) return

  const db = createDb()
  try {
    const subject = await db.selectFrom('subjects').selectAll().where('code', '=', file.subject_code).executeTakeFirst()
    if (!subject) throw new Error(`subject ${file.subject_code} does not exist -- remediation targets an existing chapter only`)

    const chapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('part', '=', file.chapter.part)
      .where('chapter_no', '=', file.chapter.chapter_no)
      .executeTakeFirst()
    if (!chapter) throw new Error(`chapter ${file.subject_code} part ${file.chapter.part} #${file.chapter.chapter_no} does not exist`)

    let retired = 0
    let alreadyRetired = 0
    let added = 0
    let alreadyPresent = 0

    for (const swap of file.swaps) {
      const concept = await db
        .selectFrom('concepts')
        .selectAll()
        .where('chapter_id', '=', chapter.id)
        .where('code', '=', swap.concept_code)
        .executeTakeFirst()
      if (!concept) throw new Error(`concept ${swap.concept_code} does not exist in this chapter`)

      const oldQ = await db
        .selectFrom('questions')
        .selectAll()
        .where('concept_id', '=', concept.id)
        .where('text_hash', '=', computeTextHash(swap.retire_text))
        .executeTakeFirst()
      if (!oldQ) {
        throw new Error(
          `${swap.concept_code}: retire_text not found for this concept (check for an exact-text mismatch) -- "${swap.retire_text.slice(0, 80)}..."`,
        )
      }
      if (oldQ.bloom !== swap.add.b || oldQ.difficulty !== swap.add.d) {
        throw new Error(
          `${swap.concept_code}: grid-cell mismatch -- retiring ${oldQ.bloom}|${oldQ.difficulty} but add is ${swap.add.b}|${swap.add.d}. A swap must stay in the same cell.`,
        )
      }

      if (oldQ.status === 'retired') {
        alreadyRetired++
      } else {
        await db.updateTable('questions').set({ status: 'retired' }).where('id', '=', oldQ.id).execute()
        retired++
      }

      const newExists = await db
        .selectFrom('questions')
        .select('id')
        .where('concept_id', '=', concept.id)
        .where('text_hash', '=', computeTextHash(swap.add.q))
        .executeTakeFirst()
      if (newExists) {
        alreadyPresent++
        continue
      }

      const options = swap.add.o
        ? shuffled(
            swap.add.o.map((text, i) => ({ text, is_correct: i === 0 })),
            swap.add.q,
          ).map((o, i) => ({ label: 'ABCD'[i], text: o.text, is_correct: o.is_correct, order_index: i + 1 }))
        : undefined

      await createQuestion(db, {
        concept_id: concept.id,
        board: subject.board,
        class: subject.class,
        bloom: swap.add.b,
        difficulty: swap.add.d,
        marks: swap.add.m,
        type: swap.add.t,
        text: swap.add.q,
        answer: swap.add.a,
        options,
        step_marks: swap.add.s?.map(([description, marks], i) => ({ step_no: i + 1, description, marks })),
        is_reversal_word: swap.add.rev,
        created_by: `claude-remediation-${file.subject_code}-ch${file.chapter.chapter_no}`,
        origin: 'ai_generated',
        source_ref: `${chapter.source_id}`,
      })
      added++
    }

    console.log(
      `${file.subject_code} ${file.chapter.part}${file.chapter.chapter_no}: ${retired} retired (${alreadyRetired} already), ${added} added (${alreadyPresent} already present)`,
    )
  } finally {
    await db.destroy()
  }
}

if (process.argv[1]?.includes('remediate-questions')) void main()

/**
 * Loads an authored chapter file (content/authoring/<set>/chNN.json) into the database:
 * subject (created once), source, chapter, IN/OUT scope, concepts and their questions.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/load-authored-chapter.ts \
 *        content/authoring/class9/ch01.json [--check]
 *
 * Idempotent: an existing chapter/concept is reused, a question whose text already exists for the
 * concept is skipped. --check validates the file (grid, one correct option, step marks) and writes
 * nothing. Option positions are shuffled by a hash of the question text so the correct answer is
 * not always the same letter.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createDb } from '../src/db/connection'
import { computeTextHash } from '../src/lib/duplicate-detection'
import { createQuestion } from '../src/lib/questions'

type Bloom = 'Remember' | 'Understand' | 'Apply' | 'Analyse' | 'Evaluate' | 'Create'
type Tier = 'Easy' | 'Hard' | 'Hardest'
type QType = 'mcq' | 'short_answer' | 'long_answer' | 'fill_blank' | 'assertion_reason' | 'multi_statement' | 'match'

interface AuthoredQuestion {
  b: Bloom
  d: Tier
  t: QType
  m: number
  q: string
  a: string
  /** mcq options, the correct one first */
  o?: Array<string>
  /** written questions: [description, marks] steps summing to m */
  s?: Array<[string, number]>
  rev?: boolean
}

interface AuthoredFile {
  subject: { code: string; name: string; board: string; class: number }
  source: { publisher: string; title: string; edition: string; year: number }
  chapter: { part: string; chapter_no: number; name: string; blurb: string; source_code: string; order_index: number }
  scope_in: Array<{ item: string; pages: string }>
  scope_out: Array<{ item: string; reason: string }>
  concepts: Array<{
    code: string
    name: string
    description: string
    idea: string
    rule: string
    example: string
    difficulty_base: Tier
    questions: Array<AuthoredQuestion>
  }>
}

const GRID: Record<string, number> = {
  'Remember|Easy': 3,
  'Remember|Hard': 1,
  'Understand|Easy': 3,
  'Understand|Hard': 2,
  'Apply|Easy': 2,
  'Apply|Hard': 3,
  'Apply|Hardest': 1,
  'Analyse|Hard': 2,
  'Analyse|Hardest': 1,
  'Evaluate|Hard': 1,
  'Create|Hardest': 1,
}

export function validate(file: AuthoredFile): Array<string> {
  const problems: Array<string> = []
  if (file.scope_in.length === 0) problems.push('scope_in is empty')
  if (file.scope_out.length === 0) problems.push('scope_out is empty')
  for (const c of file.concepts) {
    const counts: Record<string, number> = {}
    const seen = new Set<string>()
    for (const [i, q] of c.questions.entries()) {
      const where = `${c.code} #${i + 1}`
      const cell = `${q.b}|${q.d}`
      counts[cell] = (counts[cell] ?? 0) + 1
      if (!(cell in GRID)) problems.push(`${where}: cell ${cell} is not in the grid`)
      if (seen.has(q.q)) problems.push(`${where}: duplicate text`)
      seen.add(q.q)
      if (q.t === 'mcq') {
        if (!q.o || q.o.length !== 4) problems.push(`${where}: mcq needs 4 options`)
        else if (new Set(q.o.map((x) => x.trim())).size !== 4) problems.push(`${where}: options are not distinct`)
        if (q.m !== 1) problems.push(`${where}: mcq is worth 1 mark`)
        if (q.s) problems.push(`${where}: mcq has step marks`)
      } else if (q.t === 'fill_blank') {
        if (q.m !== 1) problems.push(`${where}: fill_blank is worth 1 mark`)
      } else {
        const sum = (q.s ?? []).reduce((n, [, m]) => n + m, 0)
        if (!q.s || q.s.length === 0) problems.push(`${where}: written question needs step marks`)
        else if (sum !== q.m) problems.push(`${where}: steps sum to ${sum}, question is ${q.m}`)
      }
      if (!q.a.trim()) problems.push(`${where}: empty answer`)
    }
    for (const [cell, want] of Object.entries(GRID)) {
      if ((counts[cell] ?? 0) !== want) problems.push(`${c.code}: cell ${cell} has ${counts[cell] ?? 0}, want ${want}`)
    }
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
  const file = JSON.parse(readFileSync(path, 'utf8')) as AuthoredFile
  const problems = validate(file)
  if (problems.length > 0) {
    console.error(problems.join('\n'))
    process.exit(1)
  }
  const total = file.concepts.reduce((n, c) => n + c.questions.length, 0)
  console.log(`${path}: ${file.concepts.length} concepts, ${total} questions, valid`)
  if (check) return

  const db = createDb()
  try {
    const { subject: sub, source: src, chapter: ch } = file
    let subject = await db.selectFrom('subjects').selectAll().where('code', '=', sub.code).executeTakeFirst()
    if (!subject) {
      subject = await db
        .insertInto('subjects')
        .values({ code: sub.code, name: sub.name, board: sub.board, class: sub.class })
        .returningAll()
        .executeTakeFirstOrThrow()
    }
    let source = await db
      .selectFrom('sources')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('title', '=', src.title)
      .executeTakeFirst()
    if (!source) {
      source = await db
        .insertInto('sources')
        .values({ subject_id: subject.id, publisher: src.publisher, title: src.title, edition: src.edition, year: src.year })
        .returningAll()
        .executeTakeFirstOrThrow()
    }
    let chapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('part', '=', ch.part)
      .where('chapter_no', '=', ch.chapter_no)
      .executeTakeFirst()
    if (!chapter) {
      chapter = await db
        .insertInto('chapters')
        .values({
          subject_id: subject.id,
          source_id: source.id,
          part: ch.part,
          chapter_no: ch.chapter_no,
          name: ch.name,
          blurb: ch.blurb,
          order_index: ch.order_index,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    }
    const haveScope = await db.selectFrom('chapter_scope').select('id').where('chapter_id', '=', chapter.id).executeTakeFirst()
    if (!haveScope) {
      await db
        .insertInto('chapter_scope')
        .values([
          ...file.scope_in.map((s) => ({ chapter_id: chapter.id, kind: 'IN' as const, item_text: s.item, page_ref: s.pages })),
          ...file.scope_out.map((s) => ({ chapter_id: chapter.id, kind: 'OUT' as const, item_text: s.item, page_ref: s.reason })),
        ])
        .execute()
    }

    let added = 0
    let skipped = 0
    for (const c of file.concepts) {
      let concept = await db
        .selectFrom('concepts')
        .selectAll()
        .where('chapter_id', '=', chapter.id)
        .where('code', '=', c.code)
        .executeTakeFirst()
      if (!concept) {
        concept = await db
          .insertInto('concepts')
          .values({
            chapter_id: chapter.id,
            board: sub.board,
            class: sub.class,
            code: c.code,
            name: c.name,
            description: c.description,
            idea: c.idea,
            rule: c.rule,
            example: c.example,
            difficulty_base: c.difficulty_base,
            target_question_count: 20,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      }
      for (const q of c.questions) {
        const exists = await db
          .selectFrom('questions')
          .select('id')
          .where('concept_id', '=', concept.id)
          .where('text_hash', '=', computeTextHash(q.q))
          .executeTakeFirst()
        if (exists) {
          skipped++
          continue
        }
        const options = q.o
          ? shuffled(
              q.o.map((text, i) => ({ text, is_correct: i === 0 })),
              q.q,
            ).map((o, i) => ({ label: 'ABCD'[i], text: o.text, is_correct: o.is_correct, order_index: i + 1 }))
          : undefined
        await createQuestion(db, {
          concept_id: concept.id,
          board: sub.board,
          class: sub.class,
          bloom: q.b,
          difficulty: q.d,
          marks: q.m,
          type: q.t,
          text: q.q,
          answer: q.a,
          options,
          step_marks: q.s?.map(([description, marks], i) => ({ step_no: i + 1, description, marks })),
          is_reversal_word: q.rev,
          created_by: `claude-authoring-${sub.code}-ch${ch.chapter_no}`,
          origin: 'ai_generated',
          source_ref: `${ch.source_code}`,
        })
        added++
      }
    }
    console.log(`loaded chapter ${ch.part}${ch.chapter_no}: ${added} questions added, ${skipped} already present`)
  } finally {
    await db.destroy()
  }
}

if (process.argv[1]?.includes('load-authored-chapter')) void main()

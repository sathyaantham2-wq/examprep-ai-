import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { createDb } from './connection'
import type { Db } from './connection'
import type { BloomLevel, DifficultyTier, QuestionType } from './enums'
import {
  subjectsRepository,
  sourcesRepository,
  chaptersRepository,
  chapterScopeRepository,
  conceptsRepository,
  householdsRepository,
  studentsRepository,
  blueprintsRepository,
  attemptsRepository,
  attemptAnswersRepository,
  questionsRepository,
  questionOptionsRepository,
} from './repositories'
import { createQuestion } from '../lib/questions'
import { generatePaper } from '../lib/papers'
import { createEvaluation, confirmEvaluation } from '../lib/evaluation'

// Minimal fixture for exercising the M04 syllabus routes end to end. This is NOT approved
// curriculum content — real chapter scope must come from /examprep-ingest-source +
// /examprep-scope-authoring against an actual textbook (see that skill's own warning against
// authoring scope from memory). Names are marked "(seed)" so nobody mistakes this for real data.
async function main() {
  const db = createDb()
  try {
    const subject = await subjectsRepository.insert(db, {
      board: 'CBSE',
      class: 7,
      name: 'Mathematics (seed)',
      code: 'MATH-SEED',
      language: 'English',
    })

    const source = await sourcesRepository.insert(db, {
      subject_id: subject.id,
      publisher: 'Seed Publisher',
      title: 'Seed Textbook',
      edition: 'Seed Edition',
      year: 2026,
    })

    const chapterOne = await chaptersRepository.insert(db, {
      subject_id: subject.id,
      source_id: source.id,
      part: 'I',
      chapter_no: 1,
      name: 'Sample Chapter — Fractions (seed)',
      order_index: 1,
    })

    const chapterTwo = await chaptersRepository.insert(db, {
      subject_id: subject.id,
      source_id: source.id,
      part: 'I',
      chapter_no: 2,
      name: 'Sample Chapter — Decimals (seed)',
      order_index: 2,
    })

    await chapterScopeRepository.insertMany(db, [
      {
        chapter_id: chapterOne.id,
        kind: 'IN',
        item_text: 'Add and subtract fractions with unlike denominators (seed)',
        page_ref: '1-5',
      },
      {
        chapter_id: chapterOne.id,
        kind: 'OUT',
        item_text: 'Multiplication and division of fractions (seed)',
        page_ref: undefined,
      },
    ])

    await conceptsRepository.insert(db, {
      chapter_id: chapterOne.id,
      board: 'CBSE',
      class: 7,
      code: 'C7M-1.1-SEED',
      name: 'Adding unlike fractions (seed)',
      description: 'Find a common denominator, then add.',
      difficulty_base: 'Easy',
      idea: 'Fractions need the same denominator before adding.',
      rule: 'Convert to the LCM of the denominators, then add numerators.',
      example: '1/2 + 1/3 = 3/6 + 2/6 = 5/6',
    })

    console.log('Seeded subject:', subject.id)
    console.log('Seeded chapters:', chapterOne.id, chapterTwo.id)

    // F012: "1 household, 2 students, 2 subjects, 15 chapters, 60 concepts, 200 questions, 3
    // historical evaluations." Everything below lives under BRAND NEW chapters (chapter_no 3-15)
    // rather than adding to chapterOne/chapterTwo above -- several integration tests generate
    // real papers scoped to "chapter_no=1 of MATH-SEED" and depend on it having exactly their own
    // fixture questions as eligible candidates; adding more approved questions there would make
    // those tests' random picks nondeterministic. New chapters are never in any existing test's
    // chapter_ids, so this is fully additive and safe.
    await seedBulkFixtures(db, subject.id, source.id)
  } finally {
    await db.destroy()
  }
}

const CHAPTER_TOPICS = [
  'Integers',
  'Rational Numbers',
  'Simple Equations',
  'Lines and Angles',
  'Triangles',
  'Comparing Quantities',
  'Perimeter and Area',
  'Algebraic Expressions',
  'Exponents and Powers',
  'Symmetry',
  'Visualising Solid Shapes',
  'Data Handling',
  'Practical Geometry',
]

const BLOOM_CYCLE: Array<BloomLevel> = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
]
const DIFFICULTY_CYCLE: Array<DifficultyTier> = ['Easy', 'Hard', 'Hardest']
const TYPE_CYCLE: Array<QuestionType> = ['mcq', 'fill_blank', 'short_answer']
const MARKS_BY_TYPE: Record<string, number> = {
  mcq: 1,
  fill_blank: 1,
  short_answer: 2,
}

export async function seedBulkFixtures(db: Db, subjectId: string, sourceId: string) {
  // 60 concepts total, 1 already exists on chapterOne above -- 59 more, spread across 13 new
  // chapters. 200 questions total, distributed across those 59 new concepts.
  const conceptTargets = distribute(59, 13)
  const questionTargets = distribute(200, 59)
  let questionTargetIndex = 0

  const seedConceptIds: Array<string> = []
  let firstNewChapterId: string | undefined

  for (let ci = 0; ci < CHAPTER_TOPICS.length; ci++) {
    const chapterNo = ci + 3
    const chapter = await chaptersRepository.insert(db, {
      subject_id: subjectId,
      source_id: sourceId,
      part: 'I',
      chapter_no: chapterNo,
      name: `Sample Chapter — ${CHAPTER_TOPICS[ci]} (seed)`,
      order_index: chapterNo,
    })
    if (ci === 0) firstNewChapterId = chapter.id

    for (let k = 0; k < conceptTargets[ci]; k++) {
      const concept = await conceptsRepository.insert(db, {
        chapter_id: chapter.id,
        board: 'CBSE',
        class: 7,
        code: `C7M-${chapterNo}.${k + 1}-SEED`,
        name: `${CHAPTER_TOPICS[ci]} concept ${k + 1} (seed)`,
        difficulty_base: DIFFICULTY_CYCLE[k % DIFFICULTY_CYCLE.length],
      })
      seedConceptIds.push(concept.id)

      const questionCount = questionTargets[questionTargetIndex] ?? 3
      questionTargetIndex += 1
      for (let q = 0; q < questionCount; q++) {
        const type = TYPE_CYCLE[q % TYPE_CYCLE.length]
        const bloom = BLOOM_CYCLE[(k + q) % BLOOM_CYCLE.length]
        const difficulty = DIFFICULTY_CYCLE[q % DIFFICULTY_CYCLE.length]
        const marks = MARKS_BY_TYPE[type]
        const correctValue = 10 + k + q

        await createQuestion(db, {
          concept_id: concept.id,
          board: 'CBSE',
          class: 7,
          bloom,
          difficulty,
          marks,
          type,
          text: `${CHAPTER_TOPICS[ci]} practice question ${chapterNo}.${k + 1}.${q + 1} (seed)`,
          answer: String(correctValue),
          created_by: 'seed-script',
          options:
            type === 'mcq'
              ? [
                  { label: 'A', text: String(correctValue), is_correct: true, order_index: 1 },
                  { label: 'B', text: String(correctValue + 1), is_correct: false, order_index: 2 },
                  { label: 'C', text: String(correctValue + 2), is_correct: false, order_index: 3 },
                  { label: 'D', text: String(correctValue + 3), is_correct: false, order_index: 4 },
                ]
              : undefined,
        })
      }
    }
  }

  // short_answer isn't an objective type, so computeReviewTier (F117) puts it in Tier B
  // (draft) regardless of marks -- seed data should be immediately usable, not sitting in a
  // review queue that doesn't have a UI yet (F084), so approve everything this script created.
  await db
    .updateTable('questions')
    .set({ status: 'approved' })
    .where('created_by', '=', 'seed-script')
    .execute()

  console.log(
    `Seeded ${CHAPTER_TOPICS.length} more chapters, ${seedConceptIds.length} concepts, 200 questions`,
  )

  // A second subject, kept deliberately small -- CLAUDE.md's launch scope is CBSE Class 7 Maths
  // only, so this exists to prove multi-subject routes (GET /api/syllabus/subjects, the
  // dashboard's per-subject cards) work, not to carry curriculum depth of its own.
  const secondSubject = await subjectsRepository.insert(db, {
    board: 'CBSE',
    class: 7,
    name: 'Science (seed)',
    code: 'SCI-SEED',
    language: 'English',
  })
  const secondSource = await sourcesRepository.insert(db, {
    subject_id: secondSubject.id,
    publisher: 'Seed Publisher',
    title: 'Seed Science Textbook',
    edition: 'Seed Edition',
    year: 2026,
  })
  const secondSubjectChapter = await chaptersRepository.insert(db, {
    subject_id: secondSubject.id,
    source_id: secondSource.id,
    part: 'I',
    chapter_no: 1,
    name: 'Sample Chapter — Nutrition in Plants (seed)',
    order_index: 1,
  })
  await conceptsRepository.insert(db, {
    chapter_id: secondSubjectChapter.id,
    board: 'CBSE',
    class: 7,
    code: 'C7S-1.1-SEED',
    name: 'Photosynthesis (seed)',
    difficulty_base: 'Easy',
  })
  console.log('Seeded second subject:', secondSubject.id)

  // 1 household, 2 students, 3 historical (confirmed) evaluations.
  const household = await householdsRepository.insert(db, {
    name: 'Seed Household',
    plan: 'free',
  })
  const studentOne = await studentsRepository.insert(db, {
    household_id: household.id,
    name: 'Seed Student One',
    class: 7,
    board: 'CBSE',
    target_exams: JSON.stringify([]),
  })
  const studentTwo = await studentsRepository.insert(db, {
    household_id: household.id,
    name: 'Seed Student Two',
    class: 7,
    board: 'CBSE',
    target_exams: JSON.stringify([]),
  })
  // No consent row for these students: consents.given_by_user_id requires a real users row, and
  // better-auth (not this script) owns user creation -- there is no seeded parent login for this
  // household to attribute one to. A real signup always goes through POST /api/students, which
  // always writes a consent row in the same transaction (F095); this script instead generates
  // papers by calling generatePaper() directly, the same way it always has, bypassing the route
  // (and its consent check) entirely.

  if (!firstNewChapterId) throw new Error('No seed chapters were created')

  const blueprint = await blueprintsRepository.insert(db, {
    subject_id: subjectId,
    board: 'CBSE',
    class: 7,
    name: 'Seed practice blueprint',
    duration_min: 20,
    total_marks: 5,
    sections: JSON.stringify([
      {
        name: 'Section A',
        marks_per_question: 1,
        count: 5,
        bloom_allowed: BLOOM_CYCLE,
      },
    ]),
    bloom_targets: JSON.stringify({
      Remember: 30,
      Understand: 20,
      Apply: 20,
      Analyse: 15,
      Evaluate: 10,
      Create: 5,
    }),
  })

  const evaluationPlan: Array<{ student: typeof studentOne; correctRatio: number }> = [
    { student: studentOne, correctRatio: 0.4 },
    { student: studentOne, correctRatio: 0.8 },
    { student: studentTwo, correctRatio: 0.6 },
  ]

  for (const { student, correctRatio } of evaluationPlan) {
    const generated = await generatePaper(db, {
      student_id: student.id,
      blueprint_id: blueprint.id,
      chapter_ids: [firstNewChapterId],
    })

    const attempt = await attemptsRepository.insert(db, {
      paper_id: generated.paper.id,
      student_id: student.id,
      mode: 'online',
      status: 'in_progress',
    })

    const slots = generated.paperQuestions
    const correctCount = Math.round(slots.length * correctRatio)
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const question = await questionsRepository.findById(db, slot.question_id)
      if (!question) continue
      const answerCorrectly = i < correctCount

      if (question.type === 'mcq') {
        const options = await questionOptionsRepository.listByQuestion(db, question.id)
        const correctOption = options.find((o) => o.is_correct)
        const wrongOption = options.find((o) => !o.is_correct)
        await attemptAnswersRepository.upsert(db, {
          attempt_id: attempt.id,
          paper_question_id: slot.id,
          selected_option: (answerCorrectly ? correctOption : wrongOption)?.label,
          source: 'typed',
        })
      } else {
        await attemptAnswersRepository.upsert(db, {
          attempt_id: attempt.id,
          paper_question_id: slot.id,
          response_text: answerCorrectly ? question.answer : 'seed placeholder answer',
          source: 'typed',
        })
      }
    }

    await attemptsRepository.update(db, student.id, attempt.id, {
      status: 'submitted',
      submitted_at: new Date(),
      duration_used_sec: 600,
    })

    const evaluation = await createEvaluation(db, attempt.id)
    await confirmEvaluation(db, evaluation.evaluation.id)
  }

  console.log('Seeded household:', household.id, 'students:', studentOne.id, studentTwo.id)
  console.log('Seeded 3 historical evaluations')
}

// Largest-remainder-free equal split: `count` items across `buckets` slots, as evenly as
// possible (a plain modulo distribution is fine here -- unlike F028/F113's proportional
// allocation, there's no weighting signal to respect, just "spread N things across M slots").
function distribute(count: number, buckets: number): Array<number> {
  const base = Math.floor(count / buckets)
  const remainder = count - base * buckets
  return Array.from({ length: buckets }, (_, i) => base + (i < remainder ? 1 : 0))
}

// Only auto-run when this file is the actual entry point (`npm run db:seed`) -- seedBulkFixtures
// is also imported directly by one-off backfill scripts against a DB that already has the
// MATH-SEED subject this file's own main() would otherwise try to re-insert.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

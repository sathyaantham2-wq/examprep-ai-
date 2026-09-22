import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
  householdsRepository,
  studentsRepository,
  attemptsRepository,
  attemptAnswersRepository,
  studentPointsLedgerRepository,
} from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { generatePaper } from '../lib/papers'
import { createEvaluation, confirmEvaluation } from '../lib/evaluation'
import { POINTS_BY_DIFFICULTY } from '../lib/points'

/**
 * F125 (first slice: schema + points logic). A correctly-answered MCQ pays points/coins by
 * difficulty at the moment its mark is confirmed; a wrong one pays nothing. Built directly
 * against generatePaper()/createEvaluation()/confirmEvaluation() and the repository layer, same
 * pattern question-stats.integration.test.ts already uses, rather than the full HTTP surface --
 * confirmEvaluation is the one and only place points get written, so that is what's under test.
 */
describe('student points ledger (F125)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let studentId: string
  let subjectId: string
  let chapterId: string
  let blueprintId: string
  let easyConceptId: string
  let hardConceptId: string
  let easyQuestionId: string
  let hardQuestionId: string
  let paperId: string
  let attemptId: string
  let evaluationId: string

  beforeAll(async () => {
    db = createDb()

    household = await householdsRepository.insert(db, {
      name: 'Points Fixture Household',
      plan: 'free',
    })
    const student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'Points Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    studentId = student.id

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
    // A DEDICATED chapter, not chapter_no=1 -- F012's own migration note warns that adding more
    // approved questions to MATH-SEED's chapter 1 makes other tests' random picks
    // nondeterministic, and that cuts both ways: this test's own generatePaper() call is just as
    // vulnerable to picking one of THOSE other tests' fixture questions instead of the ones
    // created below when several integration test files' fixtures share chapter 1's pool. A
    // fresh chapter_no (unique per run) keeps this test's eligible-question pool to exactly the
    // two questions it creates, deterministically, regardless of what else is running.
    const anyChapter = await db
      .selectFrom('chapters')
      .select('source_id')
      .where('subject_id', '=', subject.id)
      .executeTakeFirstOrThrow()
    const chapter = await db
      .insertInto('chapters')
      .values({
        subject_id: subject.id,
        source_id: anyChapter.source_id,
        part: 'I',
        chapter_no: 9000 + Math.floor(Math.random() * 90000),
        name: 'Points fixture chapter',
        order_index: 9000,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    chapterId = chapter.id

    const easyConcept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PTS-EASY-${Date.now()}`,
      name: 'Points fixture concept (Easy)',
      difficulty_base: 'Easy',
    })
    easyConceptId = easyConcept.id
    const hardConcept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.PTS-HARD-${Date.now()}`,
      name: 'Points fixture concept (Hard)',
      difficulty_base: 'Hard',
    })
    hardConceptId = hardConcept.id

    const easyQuestion = await createQuestion(db, {
      concept_id: easyConcept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Points fixture question (Easy, answered right)',
      answer: '1',
      created_by: 'points-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    easyQuestionId = easyQuestion.id

    const hardQuestion = await createQuestion(db, {
      concept_id: hardConcept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Hard',
      marks: 1,
      type: 'mcq',
      text: 'Points fixture question (Hard, answered wrong)',
      answer: '1',
      created_by: 'points-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    hardQuestionId = hardQuestion.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Points fixture blueprint',
      duration_min: 10,
      total_marks: 2,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 2, bloom_allowed: ['Remember'] },
      ]),
      bloom_targets: JSON.stringify({
        Remember: 100,
        Understand: 0,
        Apply: 0,
        Analyse: 0,
        Evaluate: 0,
        Create: 0,
      }),
    })
    blueprintId = blueprint.id

    const generated = await generatePaper(db, {
      student_id: studentId,
      blueprint_id: blueprintId,
      chapter_ids: [chapter.id],
    })
    expect(generated.paperQuestions).toHaveLength(2)
    paperId = generated.paper.id

    const attempt = await attemptsRepository.insert(db, {
      paper_id: paperId,
      student_id: studentId,
      mode: 'online',
      status: 'in_progress',
    })
    attemptId = attempt.id

    for (const pq of generated.paperQuestions) {
      const isEasySlot = pq.question_id === easyQuestionId
      await attemptAnswersRepository.upsert(db, {
        attempt_id: attemptId,
        paper_question_id: pq.id,
        selected_option: isEasySlot ? 'A' : 'B', // Easy answered right, Hard answered wrong
        source: 'typed',
      })
    }
    await attemptsRepository.update(db, studentId, attemptId, {
      status: 'submitted',
      submitted_at: new Date(),
      duration_used_sec: 60,
    })

    const evaluation = await createEvaluation(db, attemptId)
    evaluationId = evaluation.evaluation.id
    await confirmEvaluation(db, evaluationId)
  })

  afterAll(async () => {
    await db.deleteFrom('student_points_ledger').where('student_id', '=', studentId).execute()
    await db.deleteFrom('evaluation_items').where('evaluation_id', '=', evaluationId).execute()
    await db.deleteFrom('evaluations').where('id', '=', evaluationId).execute()
    await db.deleteFrom('attempt_answers').where('attempt_id', '=', attemptId).execute()
    await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
    await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('questions').where('id', 'in', [easyQuestionId, hardQuestionId]).execute()
    await db.deleteFrom('concepts').where('id', 'in', [easyConceptId, hardConceptId]).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.destroy()
  })

  it('pays points/coins for the correctly-answered Easy MCQ, and nothing for the wrong Hard one', async () => {
    const rows = await studentPointsLedgerRepository.list(db, studentId)
    expect(rows).toHaveLength(1)
    expect(rows[0].concept_id).toBe(easyConceptId)
    expect(rows[0].difficulty).toBe('Easy')
    expect(rows[0].points).toBe(POINTS_BY_DIFFICULTY.Easy)
    expect(rows[0].coins).toBe(POINTS_BY_DIFFICULTY.Easy)
    expect(rows[0].subject_id).toBe(subjectId)
  })

  it('totalForStudent rolls the ledger up', async () => {
    const total = await studentPointsLedgerRepository.totalForStudent(db, studentId)
    expect(total).toEqual({ points: POINTS_BY_DIFFICULTY.Easy, coins: POINTS_BY_DIFFICULTY.Easy })
  })

  it('is idempotent per evaluation item: a second confirm attempt never doubles the ledger', async () => {
    // confirmEvaluation itself refuses a second confirm (evaluation.confirmed_at guard) -- this
    // just pins down that expectation so a future refactor of that guard cannot silently start
    // double-awarding points.
    await expect(confirmEvaluation(db, evaluationId)).rejects.toThrow()
    const rows = await studentPointsLedgerRepository.list(db, studentId)
    expect(rows).toHaveLength(1)
  })
})

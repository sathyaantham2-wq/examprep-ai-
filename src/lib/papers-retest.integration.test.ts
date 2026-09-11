import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  householdsRepository,
  studentsRepository,
  blueprintsRepository,
  chaptersRepository,
  conceptsRepository,
  conceptStatusRepository,
} from '../db/repositories'
import { createQuestion } from './questions'
import { generatePaper } from './papers'

/**
 * F069: "re-test items appear automatically in the next generated paper." Builds two Strong
 * concepts in the same chapter -- one whose spaced re-test date has already passed, one whose
 * hasn't -- and a blueprint whose weighting sends every slot to the 'strong' bucket, so a single
 * generated paper proves the due concept wins the slot deterministically (not by chance: the due
 * concept has exactly one candidate question, the not-due concept has several).
 */
describe('generatePaper prefers a due spaced re-test over an ordinary Strong concept (F069)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let student: Awaited<ReturnType<typeof studentsRepository.insert>>
  let subjectId: string
  let sourceId: string
  let chapter: Awaited<ReturnType<typeof chaptersRepository.insert>>
  let conceptDue: Awaited<ReturnType<typeof conceptsRepository.insert>>
  let conceptNotDue: Awaited<ReturnType<typeof conceptsRepository.insert>>
  let blueprintId: string

  beforeAll(async () => {
    db = createDb()

    household = await householdsRepository.insert(db, {
      name: 'F069 Test Household',
      plan: 'free',
    })
    student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F069 Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    subjectId = subject.id
    const existingChapter = await db
      .selectFrom('chapters')
      .select(['source_id'])
      .where('subject_id', '=', subjectId)
      .executeTakeFirstOrThrow()
    sourceId = existingChapter.source_id

    chapter = await chaptersRepository.insert(db, {
      subject_id: subjectId,
      source_id: sourceId,
      part: 'F069-TEST',
      chapter_no: 1,
      name: 'F069 fixture chapter',
      order_index: 1,
    })

    conceptDue = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-F069.due-${Date.now()}`,
      name: 'F069 fixture concept (due for re-test)',
      difficulty_base: 'Easy',
    })
    conceptNotDue = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-F069.notdue-${Date.now()}`,
      name: 'F069 fixture concept (not yet due)',
      difficulty_base: 'Easy',
    })

    // Exactly one candidate for the due concept, several for the not-due concept -- the due
    // concept can only win the slot because the due-pool preference picks it, not by luck.
    await createQuestion(db, {
      concept_id: conceptDue.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'F069 fixture question (due concept)',
      answer: '1',
      created_by: 'f069-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    for (let q = 0; q < 5; q++) {
      await createQuestion(db, {
        concept_id: conceptNotDue.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Remember',
        difficulty: 'Easy',
        marks: 1,
        type: 'mcq',
        text: `F069 fixture question (not-due concept) ${q}`,
        answer: '1',
        created_by: 'f069-fixture',
        options: [
          { label: 'A', text: '1', is_correct: true, order_index: 1 },
          { label: 'B', text: '2', is_correct: false, order_index: 2 },
        ],
      })
    }

    await conceptStatusRepository.upsert(db, {
      student_id: student.id,
      concept_id: conceptDue.id,
      status: 'Strong',
      retest_stage: 0,
      next_retest_at: new Date(Date.now() - 24 * 60 * 60 * 1000), // due yesterday
    })
    await conceptStatusRepository.upsert(db, {
      student_id: student.id,
      concept_id: conceptNotDue.id,
      status: 'Strong',
      retest_stage: 0,
      next_retest_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000), // due in 21 days
    })

    blueprintId = (
      await blueprintsRepository.insert(db, {
        subject_id: subjectId,
        board: 'CBSE',
        class: 7,
        name: 'F069 all-strong blueprint',
        duration_min: 10,
        total_marks: 1,
        sections: JSON.stringify([
          {
            name: 'Section A',
            marks_per_question: 1,
            count: 1,
            bloom_allowed: ['Remember'],
          },
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
    ).id
  })

  afterAll(async () => {
    await db.deleteFrom('papers').where('student_id', '=', student.id).execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    await db.deleteFrom('chapters').where('id', '=', chapter.id).execute()
    await db.destroy()
  })

  it('the single strong-bucket slot goes to the due concept, not the not-due one', async () => {
    const result = await generatePaper(db, {
      student_id: student.id,
      blueprint_id: blueprintId,
      chapter_ids: [chapter.id],
      weighting_override: { weak_priority: 0, needs_practice: 0, strong: 100 },
    })

    expect(result.shortfalls).toEqual([])
    expect(result.paperQuestions).toHaveLength(1)

    const question = await db
      .selectFrom('questions')
      .select('concept_id')
      .where('id', '=', result.paperQuestions[0].question_id)
      .executeTakeFirstOrThrow()
    expect(question.concept_id).toBe(conceptDue.id)
  })
})

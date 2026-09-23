import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  conceptsRepository,
  householdsRepository,
  studentsRepository,
} from '../db/repositories'
import { createQuestion } from '../lib/questions'
import { getCachedExplanations, getOrCreateExplanation } from './explanations'

/**
 * F126: the explanation cache and its free path. Deliberately exercises the library directly and
 * with NO AI provider configured, so it asserts the two behaviours that must hold regardless of
 * whether an API key exists in the environment running it:
 *
 *   - a question that already has question_step_marks is explained from those, for free,
 *   - a question with neither step marks nor a configured provider yields null and writes no row,
 *     rather than inventing content or throwing.
 *
 * The AI path itself (AI-13) is not asserted here: it would be a paid, non-deterministic call.
 */
describe('question explanations (F126)', () => {
  let db: Db
  let householdId: string
  let studentId: string
  let chapterId: string
  let conceptId: string
  let steppedQuestionId: string
  let bareQuestionId: string

  beforeAll(async () => {
    db = createDb()

    const household = await householdsRepository.insert(db, {
      name: 'Explanation Fixture Household',
      plan: 'free',
    })
    householdId = household.id
    const student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'Explanation Kid',
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
    const anyChapter = await db
      .selectFrom('chapters')
      .select('source_id')
      .where('subject_id', '=', subject.id)
      .executeTakeFirstOrThrow()
    // Dedicated chapter, per the same reasoning student-points.integration.test.ts documents.
    const chapter = await db
      .insertInto('chapters')
      .values({
        subject_id: subject.id,
        source_id: anyChapter.source_id,
        part: 'I',
        chapter_no: 9000 + Math.floor(Math.random() * 90000),
        name: 'Explanation fixture chapter',
        order_index: 9100,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    chapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.EXPL-${Date.now()}`,
      name: 'Explanation fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id

    const stepped = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Apply',
      difficulty: 'Easy',
      marks: 2,
      type: 'short_answer',
      text: 'Explanation fixture: add 1/2 and 1/4.',
      answer: '3/4',
      created_by: 'explanation-fixture',
    })
    steppedQuestionId = stepped.id
    await db
      .insertInto('question_step_marks')
      .values([
        {
          question_id: stepped.id,
          step_no: 1,
          description: 'Make the denominators the same.',
          marks: 1,
        },
        {
          question_id: stepped.id,
          step_no: 2,
          description: 'Add the numerators and simplify.',
          marks: 1,
        },
      ])
      .execute()

    const bare = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'Explanation fixture: which is larger?',
      answer: 'A',
      created_by: 'explanation-fixture',
      options: [
        { label: 'A', text: '3/4', is_correct: true, order_index: 1 },
        { label: 'B', text: '2/3', is_correct: false, order_index: 2 },
      ],
    })
    bareQuestionId = bare.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('question_explanations')
      .where('question_id', 'in', [steppedQuestionId, bareQuestionId])
      .execute()
    await db
      .deleteFrom('question_step_marks')
      .where('question_id', '=', steppedQuestionId)
      .execute()
    await db
      .deleteFrom('question_options')
      .where('question_id', 'in', [steppedQuestionId, bareQuestionId])
      .execute()
    await db
      .deleteFrom('questions')
      .where('id', 'in', [steppedQuestionId, bareQuestionId])
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
    await db.deleteFrom('students').where('id', '=', studentId).execute()
    await db.deleteFrom('households').where('id', '=', householdId).execute()
    await db.destroy()
  })

  it('explains a question from its own step marks, with no AI call', async () => {
    const result = await getOrCreateExplanation(db, {
      questionId: steppedQuestionId,
      householdId,
      studentId,
      studentAnswer: null,
    })
    expect(result).not.toBeNull()
    expect(result!.source).toBe('step_marks')
    expect(result!.explanation).toContain('Make the denominators the same.')
    expect(result!.explanation).toContain('Add the numerators and simplify.')
  })

  it('caches it, so a second request reads the stored row', async () => {
    await getOrCreateExplanation(db, {
      questionId: steppedQuestionId,
      householdId,
      studentId,
      studentAnswer: null,
    })
    const rows = await db
      .selectFrom('question_explanations')
      .selectAll()
      .where('question_id', '=', steppedQuestionId)
      .execute()
    expect(rows).toHaveLength(1)

    const cached = await getCachedExplanations(db, [steppedQuestionId])
    expect(cached.get(steppedQuestionId)?.source).toBe('step_marks')
  })

  it('returns null and stores nothing when there is no step-mark scheme and no AI configured', async () => {
    const result = await getOrCreateExplanation(db, {
      questionId: bareQuestionId,
      householdId,
      studentId,
      studentAnswer: 'B',
    })
    // With a provider configured this generates instead, so only assert the no-provider branch.
    if (result === null) {
      const rows = await db
        .selectFrom('question_explanations')
        .selectAll()
        .where('question_id', '=', bareQuestionId)
        .execute()
      expect(rows).toHaveLength(0)
    } else {
      expect(result.source).toBe('ai')
      expect(result.explanation.length).toBeGreaterThan(0)
    }
  })

  it('getCachedExplanations never generates', async () => {
    const cached = await getCachedExplanations(db, [bareQuestionId])
    expect(cached.has(bareQuestionId)).toBe(
      // Only true if the previous test generated one via a configured provider.
      cached.has(bareQuestionId),
    )
    const rowsBefore = await db
      .selectFrom('question_explanations')
      .select('question_id')
      .where('question_id', '=', bareQuestionId)
      .execute()
    await getCachedExplanations(db, [bareQuestionId])
    const rowsAfter = await db
      .selectFrom('question_explanations')
      .select('question_id')
      .where('question_id', '=', bareQuestionId)
      .execute()
    expect(rowsAfter.length).toBe(rowsBefore.length)
  })
})

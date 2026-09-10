import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository } from '../db/repositories'
import { createQuestion } from './questions'
import { auditSyllabusFidelity } from './syllabus-fidelity'

/**
 * F106: "zero violations required" is meant as a CI gate, but the real dev DB's seed data
 * (F012) is itself currently non-compliant -- only 2 of its 16 fixture chapters ever got
 * IN-scope records authored (chapter_scope needs real page-cited textbook content, which this
 * audit cannot fabricate), leaving ~200 approved seed questions with no scope grounding. That is
 * a real, separate content-authoring gap this audit surfaced, not something to silently assert
 * past -- see F106's tracker note for the full chapter-by-chapter breakdown. So rather than a
 * false "zero on real data" assertion, this test proves the audit mechanism itself is correct:
 * it injects one deliberate violation (a concept under a chapter with zero IN-scope records) and
 * confirms it's flagged, which is what actually regresses if invariant 5's check logic breaks.
 */
describe('syllabus fidelity audit (F106)', () => {
  let db: Db
  let unscopedChapterId: string
  let unscopedConceptId: string
  let violatingQuestionId: string

  afterAll(async () => {
    if (violatingQuestionId) {
      await db.deleteFrom('question_options').where('question_id', '=', violatingQuestionId).execute()
      await db.deleteFrom('questions').where('id', '=', violatingQuestionId).execute()
    }
    if (unscopedConceptId) {
      await db.deleteFrom('concepts').where('id', '=', unscopedConceptId).execute()
    }
    if (unscopedChapterId) {
      await db.deleteFrom('chapters').where('id', '=', unscopedChapterId).execute()
    }
    await db.destroy()
  })

  it('flags an approved question whose chapter has no IN-scope record', async () => {
    db = createDb()
    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const existingChapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .executeTakeFirstOrThrow()

    const chapter = await db
      .insertInto('chapters')
      .values({
        subject_id: subject.id,
        source_id: existingChapter.source_id,
        part: 'Fidelity Test Part',
        chapter_no: 8800 + Math.floor(Math.random() * 100),
        name: 'F106 fixture chapter (deliberately unscoped)',
        order_index: 900,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    unscopedChapterId = chapter.id

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-8800.1-${Date.now()}`,
      name: 'F106 fixture concept',
      difficulty_base: 'Easy',
    })
    unscopedConceptId = concept.id

    const question = await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: 'F106 fixture question with no real scope grounding',
      answer: '1',
      created_by: 'fidelity-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    violatingQuestionId = question.id
    expect(question.status).toBe('approved') // Tier A auto-approves — this must be approved to count

    const violations = await auditSyllabusFidelity(db)
    const found = violations.find((v) => v.question_id === violatingQuestionId)
    expect(found).toBeDefined()
    expect(found!.reason).toContain('no IN-scope record')
  })
})

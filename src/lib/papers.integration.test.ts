import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import {
  householdsRepository,
  studentsRepository,
  blueprintsRepository,
  chaptersRepository,
  conceptsRepository,
} from '../db/repositories'
import { createQuestion } from './questions'
import { generatePaper } from './papers'

/**
 * F113: "marks are distributed across the selected chapters proportionally to their concept
 * count unless overridden." Builds two real fixture chapters with a known 3:2 concept-count
 * ratio and enough approved questions to fill a proportional split exactly, then asserts the
 * live generatePaper() output actually lands on that ratio -- not just that the pure allocation
 * math works (that's papers.test.ts's job), but that the whole concept -> chapter -> question
 * pipeline honours it against the real dev database.
 */
describe('generatePaper distributes marks across chapters proportionally to concept count (F113)', () => {
  let db: Db
  let household: Awaited<ReturnType<typeof householdsRepository.insert>>
  let student: Awaited<ReturnType<typeof studentsRepository.insert>>
  let studentB: Awaited<ReturnType<typeof studentsRepository.insert>>
  let subjectId: string
  let sourceId: string
  let chapterA: Awaited<ReturnType<typeof chaptersRepository.insert>>
  let chapterB: Awaited<ReturnType<typeof chaptersRepository.insert>>
  let blueprintDefaultId: string
  let blueprintOverrideId: string

  beforeAll(async () => {
    db = createDb()

    household = await householdsRepository.insert(db, {
      name: 'F113 Test Household',
      plan: 'free',
    })
    student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F113 Kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    // A second student for the override test, so it draws from a fresh recent-usage window
    // instead of competing with the default-split test for the same tightly-sized question pool.
    studentB = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'F113 Kid B',
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

    // A distinct part namespace keeps this fixture's (source_id, part, chapter_no) unique
    // regardless of what the shared MATH-SEED fixture already has under part 'I'.
    chapterA = await chaptersRepository.insert(db, {
      subject_id: subjectId,
      source_id: sourceId,
      part: 'F113-TEST',
      chapter_no: 1,
      name: 'F113 Chapter A (3 concepts)',
      order_index: 1,
    })
    chapterB = await chaptersRepository.insert(db, {
      subject_id: subjectId,
      source_id: sourceId,
      part: 'F113-TEST',
      chapter_no: 2,
      name: 'F113 Chapter B (2 concepts)',
      order_index: 2,
    })

    // Chapter A: 3 concepts x 3 approved questions each = 9 available.
    // Chapter B: 2 concepts x 3 approved questions each = 6 available.
    // A 3:2 concept-count ratio with enough supply to fill either the default (6:4 of 10) or the
    // override (1:4 of 5) split exactly, so a shortfall would mean the allocation logic is wrong,
    // not that the fixture ran out of questions.
    for (const chapter of [chapterA, chapterB]) {
      const conceptCount = chapter.id === chapterA.id ? 3 : 2
      for (let c = 0; c < conceptCount; c++) {
        const concept = await conceptsRepository.insert(db, {
          chapter_id: chapter.id,
          board: 'CBSE',
          class: 7,
          code: `C7M-F113.${chapter.chapter_no}.${c}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          name: `F113 fixture concept ${chapter.chapter_no}.${c}`,
          difficulty_base: 'Easy',
        })

        for (let q = 0; q < 3; q++) {
          await createQuestion(db, {
            concept_id: concept.id,
            board: 'CBSE',
            class: 7,
            bloom: 'Remember',
            difficulty: 'Easy',
            marks: 1,
            type: 'mcq',
            text: `F113 fixture question ${chapter.chapter_no}.${c}.${q}`,
            answer: '1',
            created_by: 'f113-fixture',
            options: [
              { label: 'A', text: '1', is_correct: true, order_index: 1 },
              { label: 'B', text: '2', is_correct: false, order_index: 2 },
            ],
          })
        }
      }
    }

    const blueprintDefault = await blueprintsRepository.insert(db, {
      subject_id: subjectId,
      board: 'CBSE',
      class: 7,
      name: 'F113 default-split blueprint',
      duration_min: 30,
      total_marks: 10,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 10,
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
    blueprintDefaultId = blueprintDefault.id

    const blueprintOverride = await blueprintsRepository.insert(db, {
      subject_id: subjectId,
      board: 'CBSE',
      class: 7,
      name: 'F113 override-split blueprint',
      duration_min: 15,
      total_marks: 5,
      sections: JSON.stringify([
        {
          name: 'Section A',
          marks_per_question: 1,
          count: 5,
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
    blueprintOverrideId = blueprintOverride.id
  })

  afterAll(async () => {
    // papers cascade paper_questions + question_usage (F014's schema); households cascade
    // students cascades papers. Chapters cascade concepts cascade questions/options/step_marks.
    // Order matters: papers before households (student_id FK), chapters last (nothing else
    // depends on them once the papers above are gone).
    await db
      .deleteFrom('papers')
      .where('student_id', 'in', [student.id, studentB.id])
      .execute()
    await db.deleteFrom('households').where('id', '=', household.id).execute()
    await db
      .deleteFrom('blueprints')
      .where('id', 'in', [blueprintDefaultId, blueprintOverrideId])
      .execute()
    await db
      .deleteFrom('chapters')
      .where('id', 'in', [chapterA.id, chapterB.id])
      .execute()
    await db.destroy()
  })

  it('splits marks proportionally to concept count by default (3:2 -> 6:4 of 10)', async () => {
    const result = await generatePaper(db, {
      student_id: student.id,
      blueprint_id: blueprintDefaultId,
      chapter_ids: [chapterA.id, chapterB.id],
    })

    expect(result.shortfalls).toEqual([])
    expect(result.paperQuestions).toHaveLength(10)

    const conceptToChapter = new Map<string, string>()
    const chapterAConcepts = await db
      .selectFrom('concepts')
      .select('id')
      .where('chapter_id', '=', chapterA.id)
      .execute()
    const chapterBConcepts = await db
      .selectFrom('concepts')
      .select('id')
      .where('chapter_id', '=', chapterB.id)
      .execute()
    for (const c of chapterAConcepts) conceptToChapter.set(c.id, chapterA.id)
    for (const c of chapterBConcepts) conceptToChapter.set(c.id, chapterB.id)

    const withQuestions = await db
      .selectFrom('paper_questions')
      .innerJoin('questions', 'questions.id', 'paper_questions.question_id')
      .select(['questions.concept_id'])
      .where('paper_questions.paper_id', '=', result.paper.id)
      .execute()

    const countByChapter = { [chapterA.id]: 0, [chapterB.id]: 0 }
    for (const row of withQuestions) {
      const chapterId = conceptToChapter.get(row.concept_id)
      if (chapterId) countByChapter[chapterId] += 1
    }
    expect(countByChapter[chapterA.id]).toBe(6)
    expect(countByChapter[chapterB.id]).toBe(4)

    // weighting is a jsonb column -- the pg driver returns it already parsed, not a JSON string.
    const weighting = result.paper.weighting as {
      chapter_target: Record<string, number>
      chapter_actual: Record<string, number>
    }
    expect(weighting.chapter_target).toEqual({
      [chapterA.id]: 6,
      [chapterB.id]: 4,
    })
    expect(weighting.chapter_actual).toEqual({
      [chapterA.id]: 6,
      [chapterB.id]: 4,
    })

    expect(result.chapters.map((c) => c.id).sort()).toEqual(
      [chapterA.id, chapterB.id].sort(),
    )
    expect(result.chapters.find((c) => c.id === chapterA.id)?.name).toBe(
      'F113 Chapter A (3 concepts)',
    )
  })

  it('an explicit chapter_weighting_override replaces the concept-count default (20:80 -> 1:4 of 5)', async () => {
    const result = await generatePaper(db, {
      student_id: studentB.id,
      blueprint_id: blueprintOverrideId,
      chapter_ids: [chapterA.id, chapterB.id],
      chapter_weighting_override: {
        [chapterA.id]: 20,
        [chapterB.id]: 80,
      },
    })

    expect(result.shortfalls).toEqual([])
    expect(result.paperQuestions).toHaveLength(5)

    const weighting = result.paper.weighting as {
      chapter_target: Record<string, number>
      chapter_actual: Record<string, number>
    }
    expect(weighting.chapter_target).toEqual({
      [chapterA.id]: 1,
      [chapterB.id]: 4,
    })
    expect(weighting.chapter_actual).toEqual({
      [chapterA.id]: 1,
      [chapterB.id]: 4,
    })
  })
})

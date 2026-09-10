import { test, expect } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import {
  conceptsRepository,
  blueprintsRepository,
} from '../src/db/repositories'
import { createQuestion } from '../src/lib/questions'
import {
  createParentSession,
  createStudentSession,
} from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * F048: closes the two gaps its own tracker note flagged as not built -- keyboard navigation
 * between review cards, and the pattern-tagging (F057) checkboxes. Needs two questions on the
 * paper (unlike happy-path.spec.ts's one) so there is a second card for j/Down to move focus to.
 */

let db: Db
let parent: TestSession
let student: TestSession
let studentId: string
let conceptId: string
let blueprintId: string
let paperId: string
let attemptId: string
const questionIds: Array<string> = []

test.beforeAll(async () => {
  db = createDb()
  parent = await createParentSession('e2e-evalkbd-parent')

  const subject = await db
    .selectFrom('subjects')
    .selectAll()
    .where('code', '=', 'MATH-SEED')
    .executeTakeFirstOrThrow()
  const chapter = await db
    .selectFrom('chapters')
    .selectAll()
    .where('subject_id', '=', subject.id)
    .where('chapter_no', '=', 1)
    .executeTakeFirstOrThrow()

  const concept = await conceptsRepository.insert(db, {
    chapter_id: chapter.id,
    board: 'CBSE',
    class: 7,
    code: `C7M-1.E2EKBD-${Date.now()}`,
    name: 'E2E keyboard-nav fixture concept',
    difficulty_base: 'Easy',
  })
  conceptId = concept.id

  const q1 = await createQuestion(db, {
    concept_id: concept.id,
    board: 'CBSE',
    class: 7,
    bloom: 'Remember',
    difficulty: 'Easy',
    marks: 1,
    type: 'mcq',
    text: 'E2E kbd fixture question one: 2 + 2?',
    answer: '4',
    created_by: 'e2e-evalkbd-fixture',
    options: [
      { label: 'A', text: '4', is_correct: true, order_index: 1 },
      { label: 'B', text: '5', is_correct: false, order_index: 2 },
    ],
  })
  const q2 = await createQuestion(db, {
    concept_id: concept.id,
    board: 'CBSE',
    class: 7,
    bloom: 'Remember',
    difficulty: 'Easy',
    marks: 1,
    type: 'mcq',
    text: 'E2E kbd fixture question two: 3 + 3?',
    answer: '6',
    created_by: 'e2e-evalkbd-fixture',
    options: [
      { label: 'A', text: '6', is_correct: true, order_index: 1 },
      { label: 'B', text: '7', is_correct: false, order_index: 2 },
    ],
  })
  questionIds.push(q1.id, q2.id)

  const blueprint = await blueprintsRepository.insert(db, {
    subject_id: subject.id,
    board: 'CBSE',
    class: 7,
    name: 'E2E kbd fixture blueprint',
    duration_min: 30,
    total_marks: 2,
    sections: JSON.stringify([
      {
        name: 'Section A',
        marks_per_question: 1,
        count: 2,
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
  blueprintId = blueprint.id

  const studentRes = await fetch('http://localhost:3000/api/students', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: parent.cookie,
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({
      name: 'E2E Kbd Kid',
      class: 7,
      board: 'CBSE',
      consent_accepted: true,
    }),
  }).then((r) => r.json())
  studentId = studentRes.id
  student = await createStudentSession(
    'e2e-evalkbd-student',
    parent.householdId,
    studentId,
  )

  const generateRes = await fetch('http://localhost:3000/api/papers/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: parent.cookie,
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({
      student_id: studentId,
      blueprint_id: blueprintId,
      chapter_ids: [chapter.id],
    }),
  }).then((r) => r.json())
  paperId = generateRes.paper.id

  const attemptRes = await fetch('http://localhost:3000/api/attempts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: student.cookie,
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ paper_id: paperId, mode: 'online' }),
  }).then((r) => r.json())
  attemptId = attemptRes.id

  for (const pq of generateRes.paperQuestions as Array<{ id: string }>) {
    await fetch(`http://localhost:3000/api/attempts/${attemptId}/answer`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: student.cookie,
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ paper_question_id: pq.id, selected_option: 'B' }),
    })
  }
  await fetch(`http://localhost:3000/api/attempts/${attemptId}/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: student.cookie,
      origin: 'http://localhost:3000',
    },
    body: '{}',
  })
})

test.afterAll(async () => {
  if (attemptId) {
    await db
      .deleteFrom('pattern_hits')
      .where(
        'evaluation_item_id',
        'in',
        db
          .selectFrom('evaluation_items')
          .select('id')
          .where(
            'evaluation_id',
            'in',
            db
              .selectFrom('evaluations')
              .select('id')
              .where('attempt_id', '=', attemptId),
          ),
      )
      .execute()
    await db
      .deleteFrom('evaluation_items')
      .where(
        'evaluation_id',
        'in',
        db
          .selectFrom('evaluations')
          .select('id')
          .where('attempt_id', '=', attemptId),
      )
      .execute()
    await db
      .deleteFrom('evaluations')
      .where('attempt_id', '=', attemptId)
      .execute()
    await db
      .deleteFrom('attempt_answers')
      .where('attempt_id', '=', attemptId)
      .execute()
    await db.deleteFrom('attempts').where('id', '=', attemptId).execute()
  }
  if (paperId) {
    await db
      .deleteFrom('paper_questions')
      .where('paper_id', '=', paperId)
      .execute()
    await db.deleteFrom('papers').where('id', '=', paperId).execute()
  }
  await db
    .deleteFrom('households')
    .where('id', '=', parent.householdId)
    .execute()
  await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
  if (questionIds.length > 0) {
    await db.deleteFrom('questions').where('id', 'in', questionIds).execute()
  }
  await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
  await db.destroy()
})

test('evaluation review: keyboard navigation and pattern tagging', async ({
  page,
}) => {
  await page.goto('/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.fill('#email', parent.email)
  await page.fill('#password', parent.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/home')

  await page.goto(`/evaluate/${attemptId}`, { waitUntil: 'networkidle' })
  const cards = page.getByTestId('review-card')
  await expect(cards).toHaveCount(2)

  // Focus the first card directly (clicking non-interactive header text doesn't bubble focus to
  // the tabIndex ancestor in real browsers), then confirm j/ArrowDown moves focus to the second.
  await cards.nth(0).evaluate((el) => (el as HTMLElement).focus())
  await expect(cards.nth(0)).toBeFocused()
  await page.keyboard.press('j')
  await expect(cards.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(cards.nth(0)).toBeFocused()

  // Tag the first item's answer with a behaviour pattern, save via the real Save button (not the
  // Enter-to-save shortcut, to keep this assertion about the checkbox independent of the other
  // keyboard behaviour), then confirm the pattern label is still checked after the PATCH response
  // re-renders the card -- i.e. the round trip through pattern_hits didn't drop the selection.
  const firstCard = cards.nth(0)
  // Pattern checkboxes are rendered as <label><input/>{code} — {name}</label> -- locate the
  // checkbox by its visible "P1 — ..." label text rather than by position, since "she actually
  // knew this" is also a checkbox and ordering shouldn't be load-bearing for the test.
  const p1Checkbox = firstCard
    .locator('label', { hasText: /^P1 —/ })
    .locator('input[type="checkbox"]')
  await expect(p1Checkbox).toBeVisible()
  await p1Checkbox.check()
  await firstCard.getByRole('button', { name: 'Save' }).click()
  await expect(p1Checkbox).toBeChecked()
})

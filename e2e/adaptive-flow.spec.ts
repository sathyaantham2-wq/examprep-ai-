import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { chaptersRepository, conceptsRepository } from '../src/db/repositories'
import { createQuestion } from '../src/lib/questions'
import { createParentSession, createStudentSession } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * The first-time student journey in a real browser: sign in, finish the profile (subject cards
 * turn blue with a tick, and clicking again clears them), see the personalised home, take the
 * Easy first assessment from "Generate my question paper", get marked at once, and see the concept
 * level on the home page. Fixtures (a subject with one chapter, one concept and its questions) are
 * built directly in the database, like the other E2E specs.
 */

let db: Db
let parent: TestSession
let student: TestSession
let studentId: string
let subjectId: string
let subjectName: string
let chapterId: string
let conceptId: string
const tag = `e2e-adaptive-${Date.now()}`
const paperIds: Array<string> = []
const attemptIds: Array<string> = []

test.beforeAll(async () => {
  db = createDb()
  parent = await createParentSession('e2e-adapt-parent')

  const seed = await db.selectFrom('subjects').selectAll().where('code', '=', 'MATH-SEED').executeTakeFirstOrThrow()
  const seedChapter = await db
    .selectFrom('chapters')
    .selectAll()
    .where('subject_id', '=', seed.id)
    .where('chapter_no', '=', 1)
    .executeTakeFirstOrThrow()

  subjectName = `Adaptive E2E subject ${Date.now()}`
  const subject = await db
    .insertInto('subjects')
    .values({ board: 'CBSE', class: 7, name: subjectName, code: `E2E-AD-${Date.now()}`, language: 'English', is_active: true })
    .returningAll()
    .executeTakeFirstOrThrow()
  subjectId = subject.id

  const chapterNo = 8000 + Math.floor(Math.random() * 900)
  const chapter = await chaptersRepository.insert(db, {
    subject_id: subject.id,
    source_id: seedChapter.source_id,
    part: 'I',
    chapter_no: chapterNo,
    name: 'Adaptive E2E chapter',
    order_index: chapterNo,
  })
  chapterId = chapter.id
  const concept = await conceptsRepository.insert(db, {
    chapter_id: chapter.id,
    board: 'CBSE',
    class: 7,
    code: `E2E-AD-${Date.now()}`,
    name: 'Adaptive E2E concept',
    difficulty_base: 'Easy',
  })
  conceptId = concept.id
  for (let i = 0; i < 12; i++) {
    await createQuestion(db, {
      concept_id: concept.id,
      board: 'CBSE',
      class: 7,
      bloom: 'Remember',
      difficulty: 'Easy',
      marks: 1,
      type: 'mcq',
      text: `${tag} question ${i}`,
      answer: 'A',
      created_by: tag,
      options: [
        { label: 'A', text: 'right', is_correct: true, order_index: 1 },
        { label: 'B', text: 'wrong', is_correct: false, order_index: 2 },
      ],
    })
  }

  const created = await fetch('http://localhost:3000/api/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: parent.cookie, origin: 'http://localhost:3000' },
    body: JSON.stringify({ name: 'Adaptive E2E Kid', class: 7, board: 'CBSE', consent_accepted: true }),
  }).then((r) => r.json())
  studentId = created.id
  student = await createStudentSession('e2e-adapt-student', parent.householdId, studentId)
})

test.afterAll(async () => {
  if (attemptIds.length > 0) {
    const evaluations = await db.selectFrom('evaluations').select('id').where('attempt_id', 'in', attemptIds).execute()
    const evaluationIds = evaluations.map((e) => e.id)
    if (evaluationIds.length > 0) {
      await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', evaluationIds).execute()
      await db.deleteFrom('evaluations').where('id', 'in', evaluationIds).execute()
    }
    await db.deleteFrom('attempt_answers').where('attempt_id', 'in', attemptIds).execute()
    await db.deleteFrom('attempts').where('id', 'in', attemptIds).execute()
  }
  if (paperIds.length > 0) {
    await db.deleteFrom('paper_questions').where('paper_id', 'in', paperIds).execute()
    await db.deleteFrom('papers').where('id', 'in', paperIds).execute()
  }
  await db.deleteFrom('concept_status').where('concept_id', '=', conceptId).execute()
  await db.deleteFrom('concept_mastery').where('concept_id', '=', conceptId).execute()
  await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
  await db.deleteFrom('questions').where('created_by', '=', tag).execute()
  await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
  await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
  await db.updateTable('subjects').set({ is_active: false }).where('id', '=', subjectId).execute()
  await db.destroy()
})

async function signInUi(page: Page, email: string, password: string) {
  await page.goto('/', { waitUntil: 'networkidle' })
  // Hydration margin, same reason as the other specs.
  await page.waitForTimeout(2000)
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('first-time student: profile, personalised home, Easy assessment, marked at once', async ({ page }) => {
  await signInUi(page, student.email, student.password)

  // A new student is sent to profile setup first.
  await page.waitForURL('**/profile-setup')
  await expect(page.getByRole('heading', { name: 'Set up your profile' })).toBeVisible()
  await page.waitForTimeout(800)
  // No class is pre-selected: she chooses her own.
  await page.selectOption('#student-class', '7')

  const card = page.getByRole('checkbox', { name: new RegExp(subjectName) })
  await expect(card).toHaveAttribute('aria-checked', 'false')
  const saveButton = page.getByRole('button', { name: 'Save and continue' })
  await expect(saveButton).toBeDisabled()

  // Selecting turns the card blue with a tick; selecting again clears it.
  await card.click()
  await expect(card).toHaveAttribute('aria-checked', 'true')
  await expect(card).toHaveClass(/bg-blue-600/)
  await expect(card).toContainText('✓')
  await card.click()
  await expect(card).toHaveAttribute('aria-checked', 'false')
  await expect(saveButton).toBeDisabled()

  await card.click()
  await saveButton.click()

  // Owner decision 2026-09-23: /my-paper is her default landing page now, straight after
  // finishing her profile -- not /student ("Your progress"), which is still reachable from the
  // sidebar (checked later, via "Back to my progress" after this attempt is marked).
  // "Generate my question paper": a short Easy assessment made from her profile -- Subject,
  // Questions, Difficulty and Question type are real controls now, defaulting to the same 10
  // Easy MCQ-only shape a first assessment always used to be.
  await page.waitForURL('**/my-paper**')
  await expect(page.getByText('Assessment Details')).toBeVisible()
  await expect(page.getByLabel('Questions')).toHaveValue('10')
  await expect(
    page.getByText('10 questions (10 marks)', { exact: false }),
  ).toBeVisible()
  // Scoped to the plan summary on purpose: "Multiple choice" is now also an <option> in the
  // Question type dropdown, so a bare getByText('Multiple choice') resolves to two elements and
  // fails Playwright's strict mode.
  await expect(
    page.getByText('(10 marks) -- Multiple choice', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Generate Assessment' }).click()

  // Answer every question (all the right option), then submit.
  await page.waitForURL('**/attempt/**')
  await expect(page.getByText(new RegExp(`${tag} question`)).first()).toBeVisible()
  const rights = page.getByLabel(/A\. right/)
  const count = await rights.count()
  expect(count).toBe(10)
  // Let the saved-answer load settle so it cannot overwrite the first clicks.
  await page.waitForTimeout(700)
  for (let i = 0; i < count; i++) {
    await rights.nth(i).click()
    await expect(rights.nth(i)).toBeChecked()
  }
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Review & submit' }).click()
  await page.getByRole('button', { name: 'Submit' }).click()

  // Marked at once: score plus the concept's level, and no answer key anywhere.
  await expect(page.getByRole('heading', { name: 'Well done, Adaptive E2E Kid' })).toBeVisible()
  await expect(page.getByText('You scored 10 out of 10 (100%).')).toBeVisible()
  await expect(page.getByText('Adaptive E2E concept')).toBeVisible()
  await expect(page.getByText(/now (Developing|Proficient|Beginner)/)).toBeVisible()

  const papers = await db.selectFrom('papers').select('id').where('student_id', '=', studentId).execute()
  paperIds.push(...papers.map((p) => p.id))
  const attempts = await db.selectFrom('attempts').select('id').where('student_id', '=', studentId).execute()
  attemptIds.push(...attempts.map((a) => a.id))

  // Back on the home page the concept now has a level.
  await page.getByRole('link', { name: 'Back to my progress' }).click()
  await page.waitForURL('**/student')
  await expect(page.getByText('Adaptive E2E concept').first()).toBeVisible()
  await expect(page.getByText('Concepts started').first()).toBeVisible()
  await expect(page.getByText('1 of 1', { exact: true })).toBeVisible()
})

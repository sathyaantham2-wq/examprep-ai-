import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
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
 * F104: "sign in, generate paper, download PDF, attempt, evaluate, see tracker update." A real
 * browser drives the real UI throughout; only fixture setup (concept/question/blueprint, and the
 * student login linkage F112 doesn't self-serve yet) goes through direct DB/repository calls, the
 * same pattern every integration test in this repo already uses. Three real UI sign-ins (parent,
 * then student, then parent again) exercise the actual login form, not a cookie shortcut.
 *
 * Building this surfaced a real bug, fixed alongside it: sign-in unconditionally routed every
 * parent to /onboarding even after F071 added a real /home dashboard, because that redirect
 * logic predated F071 and was never revisited.
 */

let db: Db
let parent: TestSession
let student: TestSession
let studentId: string
let subjectId: string
let conceptId: string
let blueprintId: string
let paperId: string
let attemptId: string
const questionIds: Array<string> = []

test.beforeAll(async () => {
  db = createDb()
  parent = await createParentSession('e2e-parent')

  const subject = await db
    .selectFrom('subjects')
    .selectAll()
    .where('code', '=', 'MATH-SEED')
    .executeTakeFirstOrThrow()
  subjectId = subject.id
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
    code: `C7M-1.E2E-${Date.now()}`,
    name: 'E2E fixture concept',
    difficulty_base: 'Easy',
  })
  conceptId = concept.id

  const question = await createQuestion(db, {
    concept_id: concept.id,
    board: 'CBSE',
    class: 7,
    bloom: 'Remember',
    difficulty: 'Easy',
    marks: 1,
    type: 'mcq',
    text: 'E2E fixture question: what is 2 + 2?',
    answer: '4',
    created_by: 'e2e-fixture',
    options: [
      { label: 'A', text: '4', is_correct: true, order_index: 1 },
      { label: 'B', text: '5', is_correct: false, order_index: 2 },
    ],
  })
  questionIds.push(question.id)

  const blueprint = await blueprintsRepository.insert(db, {
    subject_id: subject.id,
    board: 'CBSE',
    class: 7,
    // Deliberately not named "... fixture blueprint" (every other test's convention) -- GET
    // /api/blueprints now filters that name pattern out of the real /generate picker (papers.ts's
    // listBySubject), since a real admin's picker was otherwise full of leftover test junk. This
    // one needs to actually appear in the UI the test drives.
    name: 'E2E happy-path blueprint',
    duration_min: 30,
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
  blueprintId = blueprint.id

  // Add the student via the real API (as the E2E flow's parent would), then link a login for
  // them the same way every other test in this repo does -- F112 self-service doesn't exist.
  const studentRes = await fetch('http://localhost:3000/api/students', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: parent.cookie,
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({
      name: 'E2E Kid',
      class: 7,
      board: 'CBSE',
      consent_accepted: true,
    }),
  }).then((r) => r.json())
  studentId = studentRes.id
  student = await createStudentSession(
    'e2e-student',
    parent.householdId,
    studentId,
  )
})

test.afterAll(async () => {
  if (attemptId) {
    await db
      .deleteFrom('habit_observations')
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
    .deleteFrom('concept_mastery')
    .where('concept_id', '=', conceptId)
    .execute()
  await db
    .deleteFrom('concept_status')
    .where('concept_id', '=', conceptId)
    .execute()
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

async function signInUi(page: Page, email: string, password: string) {
  await page.goto('/', { waitUntil: 'networkidle' })
  // TanStack Start server-renders this page before client hydration attaches the form's
  // onSubmit handler -- clicking before hydration finishes falls through to a native HTML
  // submit (no `name` attrs on the inputs, so it reloads "/" with an empty query string and
  // resets all form state). networkidle isn't a strong enough signal on its own in this dev
  // environment; this margin is what actually made it reliable.
  await page.waitForTimeout(2000)
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

// No shared app-shell/nav exists across screens yet, so "Sign out" isn't always reachable from
// wherever the flow currently is (e.g. /generate has no such button) -- this calls the real
// better-auth endpoint directly, the same one the UI's Sign out buttons call, then clears the
// resulting empty-session cookie state with a fresh navigation.
async function signOutApi(page: Page) {
  await page.request.post('/api/auth/sign-out', {
    headers: {
      origin: 'http://localhost:3000',
      'content-type': 'application/json',
    },
    data: {},
  })
  await page.goto('/', { waitUntil: 'networkidle' })
}

test('happy path: sign in, generate paper, download PDF, attempt, evaluate, tracker updates', async ({
  page,
}) => {
  // 1. Sign in as parent via the real login form. The bug fix under test: this must land on
  // /home (a student already exists), not /onboarding.
  await signInUi(page, parent.email, parent.password)
  await page.waitForURL('**/home')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  // 2. Generate a paper via the real /generate form.
  await page.goto('/generate', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  // generate.tsx auto-selects the student when this household only has one (no #student
  // dropdown rendered at all in that case -- this fixture creates exactly one, "E2E Kid").
  // Two subjects exist for CBSE/Class 7 (Mathematics, Science) -- only auto-selected when
  // there's exactly one, so this must still be picked explicitly.
  await page.selectOption('#subject', subjectId)
  await page.waitForTimeout(300)
  // Two non-fixture blueprints exist for MATH-SEED (the pre-existing "Seed practice blueprint"
  // plus this fixture's own) -- the #blueprint dropdown only renders once there's more than one
  // real option, which is the case here.
  await page.selectOption('#blueprint', blueprintId)
  // Chapters now default to all pre-checked (the sensible default for a prototype-stage bank).
  // MATH-SEED has 15 chapters, most holding unrelated leftover content from other tests --
  // uncheck every one except "Ch 1" so this test stays scoped to its own fixture question the
  // same way it always was, rather than the generator being free to draw from any of them.
  const chapterLabels = page.locator('label').filter({ hasText: /^I Ch \d+:/ })
  const chapterCount = await chapterLabels.count()
  for (let i = 0; i < chapterCount; i++) {
    const label = chapterLabels.nth(i)
    const text = await label.textContent()
    if (!text?.includes('Ch 1:')) {
      await label.getByRole('checkbox').uncheck()
    }
  }

  const generateResponsePromise = page.waitForResponse(
    (r) =>
      r.url().includes('/api/papers/generate') &&
      r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Create paper' }).click()
  const generateResponse = await generateResponsePromise
  const generated = await generateResponse.json()
  paperId = generated.paper.id
  expect(generated.paperQuestions).toHaveLength(1)
  await expect(page.getByText(/Paper ready/)).toBeVisible()

  // 3. Download PDF -- verify the real render pipeline (F033) produces an actual PDF.
  const pdfResponse = await page.request.get(`/api/papers/${paperId}/pdf`)
  expect(pdfResponse.ok()).toBe(true)
  expect(pdfResponse.headers()['content-type']).toContain('application/pdf')
  const pdfBytes = await pdfResponse.body()
  expect(pdfBytes.length).toBeGreaterThan(1000)

  // 4. Sign out, sign in as the student, attempt the paper through the real test-runner UI.
  await signOutApi(page)
  await signInUi(page, student.email, student.password)
  // Sign-in itself is async (the session cookie lands after the POST /api/auth/sign-in/email
  // response), and signInUi returns as soon as the button is clicked -- without waiting for the
  // student's post-login redirect, the very next page.request call can fire before the cookie
  // exists, hitting requireRole's 401 (null body, hence "Unexpected end of JSON input" on .json()).
  await page.waitForURL('**/student')

  const attemptCreate = await page.request.post('/api/attempts', {
    data: { paper_id: paperId, mode: 'online' },
  })
  if (!attemptCreate.ok()) {
    throw new Error(
      `POST /api/attempts failed: ${attemptCreate.status()} ${await attemptCreate.text()}`,
    )
  }
  const attempt = await attemptCreate.json()
  attemptId = attempt.id

  await page.goto(`/attempt/${attemptId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await expect(page.getByText('E2E fixture question')).toBeVisible()
  await page.getByLabel(/A\. 4/).check()
  await page.waitForTimeout(800) // autosave debounce (F040)
  await page.getByRole('button', { name: 'Review & submit' }).click()
  await page.getByRole('button', { name: 'Submit' }).click()
  await expect(page.getByRole('heading', { name: 'Submitted' })).toBeVisible()

  // 5. Sign out, sign back in as parent, evaluate and confirm through the real workspace UI.
  await signOutApi(page)
  await signInUi(page, parent.email, parent.password)
  await page.waitForURL('**/home')

  await page.goto(`/evaluate/${attemptId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)

  // F058: rate one presentation habit before confirming -- the whole point of "before
  // confirming" is that PATCH .../habits 409s afterward, so this has to happen first.
  // CardTitle renders a styled <div>, not a semantic heading, so this is a text match rather
  // than getByRole('heading', ...) -- unlike the page's own <h1> elements.
  await expect(page.getByText('Presentation habits')).toBeVisible()
  await page
    .locator('label', { hasText: 'present' })
    .first()
    .locator('input[type="radio"]')
    .check()
  await page.getByRole('button', { name: 'Save habits' }).click()
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()

  await page.getByRole('button', { name: 'Confirm all' }).click()
  await expect(page.getByText(/Confirmed --/)).toBeVisible()

  // 6. See the tracker/dashboard update -- the real score this attempt earned, and the habit
  // rating just saved showing up in the trend.
  await page.goto('/home')
  // "100%" also appears twice more as chart axis/point labels (F075) once real score history
  // exists, so a bare getByText('100%') is ambiguous -- anchor to the summary line itself.
  await expect(page.getByText(/Latest score 100%/)).toBeVisible()
  await expect(page.getByText('Presentation habits')).toBeVisible()
  await expect(page.getByText('latest: present')).toBeVisible()
})

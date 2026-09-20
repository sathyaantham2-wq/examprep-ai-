import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createDb } from '../src/db/connection'
import type { Db } from '../src/db/connection'
import { blueprintsRepository, chaptersRepository, conceptsRepository } from '../src/db/repositories'
import { createQuestion } from '../src/lib/questions'
import { createParentSession, createStudentSession } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'

/**
 * The review screen a student sees after a paper with written answers: the AI marks are already
 * there (seeded directly, since no AI key runs in tests), she can open a disagreement box, and
 * accepting the marks finishes the paper and shows her grade. The AI conversation itself is covered
 * by the integration tests.
 */

let db: Db
let parent: TestSession
let student: TestSession
let studentId: string
let chapterId: string
let conceptId: string
let blueprintId: string
let paperId = ''
let attemptId = ''
let openAttemptId = ''
const tag = `e2e-review-${Date.now()}`

test.beforeAll(async () => {
  db = createDb()
  parent = await createParentSession('e2e-review-parent')
  const created = await fetch('http://localhost:3000/api/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: parent.cookie, origin: 'http://localhost:3000' },
    body: JSON.stringify({ name: 'Review E2E Kid', class: 7, board: 'CBSE', consent_accepted: true }),
  }).then((r) => r.json())
  studentId = created.id
  student = await createStudentSession('e2e-review-student', parent.householdId, studentId)

  const subject = await db.selectFrom('subjects').selectAll().where('code', '=', 'MATH-SEED').executeTakeFirstOrThrow()
  const seedChapter = await db
    .selectFrom('chapters')
    .selectAll()
    .where('subject_id', '=', subject.id)
    .where('chapter_no', '=', 1)
    .executeTakeFirstOrThrow()
  const chapterNo = 7000 + Math.floor(Math.random() * 900)
  const chapter = await chaptersRepository.insert(db, {
    subject_id: subject.id,
    source_id: seedChapter.source_id,
    part: 'I',
    chapter_no: chapterNo,
    name: 'Review E2E chapter',
    order_index: chapterNo,
  })
  chapterId = chapter.id
  const concept = await conceptsRepository.insert(db, {
    chapter_id: chapter.id,
    board: 'CBSE',
    class: 7,
    code: `E2E-RV-${Date.now()}`,
    name: 'Review E2E concept',
    difficulty_base: 'Easy',
  })
  conceptId = concept.id

  const mcq = await createQuestion(db, {
    concept_id: concept.id,
    board: 'CBSE',
    class: 7,
    bloom: 'Remember',
    difficulty: 'Easy',
    marks: 1,
    type: 'mcq',
    text: `${tag} mcq`,
    answer: 'A',
    created_by: tag,
    options: [
      { label: 'A', text: 'right', is_correct: true, order_index: 1 },
      { label: 'B', text: 'wrong', is_correct: false, order_index: 2 },
    ],
  })
  const written: Array<{ id: string }> = []
  for (let i = 0; i < 2; i++) {
    written.push(
      await createQuestion(db, {
        concept_id: concept.id,
        board: 'CBSE',
        class: 7,
        bloom: 'Analyse',
        difficulty: 'Hard',
        marks: 2,
        type: 'short_answer',
        text: `${tag} written question ${i}`,
        answer: 'SECRET-EXPECTED-ANSWER',
        created_by: tag,
        step_marks: [
          { step_no: 1, description: 'Sets up', marks: 1 },
          { step_no: 2, description: 'Finishes', marks: 1 },
        ],
      }),
    )
  }
  const blueprint = await blueprintsRepository.insert(db, {
    subject_id: subject.id,
    board: 'CBSE',
    class: 7,
    name: 'Answer review fixture blueprint',
    duration_min: 20,
    total_marks: 5,
    sections: JSON.stringify([{ name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] }]),
    bloom_targets: JSON.stringify({ Remember: 0, Understand: 0, Apply: 0, Analyse: 0, Evaluate: 0, Create: 0 }),
  })
  blueprintId = blueprint.id

  // An adaptive paper that has been submitted and marked by the AI, but not yet accepted.
  const paper = await db
    .insertInto('papers')
    .values({
      student_id: studentId,
      blueprint_id: blueprint.id,
      subject_id: subject.id,
      chapter_ids: [chapter.id],
      title: 'Review E2E paper',
      total_marks: 5,
      duration_min: 20,
      weighting: JSON.stringify({ adaptive: { enabled: true } }),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  paperId = paper.id
  const slotIds: Array<string> = []
  const questions = [mcq.id, written[0].id, written[1].id]
  for (const [index, questionId] of questions.entries()) {
    const slot = await db
      .insertInto('paper_questions')
      .values({
        paper_id: paper.id,
        question_id: questionId,
        section: index === 0 ? 'Section A' : 'Section B',
        position: index + 1,
        marks: index === 0 ? 1 : 2,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    slotIds.push(slot.id)
  }
  const attempt = await db
    .insertInto('attempts')
    .values({ student_id: studentId, paper_id: paper.id, mode: 'online', status: 'submitted', submitted_at: new Date() })
    .returning('id')
    .executeTakeFirstOrThrow()
  attemptId = attempt.id
  // A second, still open attempt on the same paper, for the answer boxes.
  const open = await db
    .insertInto('attempts')
    .values({ student_id: studentId, paper_id: paper.id, mode: 'online', status: 'in_progress' })
    .returning('id')
    .executeTakeFirstOrThrow()
  openAttemptId = open.id
  await db
    .insertInto('attempt_answers')
    .values([
      { attempt_id: attempt.id, paper_question_id: slotIds[0], selected_option: 'A', source: 'typed' },
      { attempt_id: attempt.id, paper_question_id: slotIds[1], response_text: 'My first working', source: 'typed' },
      { attempt_id: attempt.id, paper_question_id: slotIds[2], response_text: 'My second working', source: 'typed' },
    ])
    .execute()
  const evaluation = await db
    .insertInto('evaluations')
    .values({ attempt_id: attempt.id, total_marks: 5, evaluated_by: 'ai' })
    .returning('id')
    .executeTakeFirstOrThrow()
  await db
    .insertInto('evaluation_items')
    .values([
      { evaluation_id: evaluation.id, paper_question_id: slotIds[0], marks_awarded: 1, marks_max: 1, feedback: 'Correct.' },
      { evaluation_id: evaluation.id, paper_question_id: slotIds[1], marks_awarded: 1, marks_max: 2, ai_marks: 1, feedback: 'Show the last step.' },
      { evaluation_id: evaluation.id, paper_question_id: slotIds[2], marks_awarded: 2, marks_max: 2, ai_marks: 2, feedback: 'Well done.' },
    ])
    .execute()
})

test.afterAll(async () => {
  await db.deleteFrom('evaluation_items').where('evaluation_id', 'in', db.selectFrom('evaluations').select('id').where('attempt_id', '=', attemptId)).execute()
  await db.deleteFrom('evaluations').where('attempt_id', '=', attemptId).execute()
  await db.deleteFrom('attempt_answers').where('attempt_id', 'in', [attemptId, openAttemptId]).execute()
  await db.deleteFrom('attempts').where('id', 'in', [attemptId, openAttemptId]).execute()
  await db.deleteFrom('paper_questions').where('paper_id', '=', paperId).execute()
  await db.deleteFrom('papers').where('id', '=', paperId).execute()
  await db.deleteFrom('concept_status').where('concept_id', '=', conceptId).execute()
  await db.deleteFrom('concept_mastery').where('concept_id', '=', conceptId).execute()
  await db.deleteFrom('households').where('id', '=', parent.householdId).execute()
  await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
  await db.deleteFrom('questions').where('created_by', '=', tag).execute()
  await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
  await db.deleteFrom('chapters').where('id', '=', chapterId).execute()
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

test('student reviews AI marks on written answers, opens a disagreement box, then accepts', async ({ page }) => {
  await signInUi(page, student.email, student.password)
  await page.waitForURL('**/profile-setup')
  await page.goto(`/attempt/${attemptId}`, { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: 'Check your marks' })).toBeVisible()
  await expect(page.getByText('Answers questioned: 0 of 5')).toBeVisible()
  await expect(page.getByText('Multiple choice: 1 of 1')).toBeVisible()
  await expect(page.getByText('Marks: 1 of 2')).toBeVisible()
  await expect(page.getByText('Marks: 2 of 2')).toBeVisible()
  await expect(page.getByText('Show the last step.')).toBeVisible()
  await expect(page.getByText('Your marks now: 4 of 5')).toBeVisible()
  // No answer key on the page, and nothing can be removed before the AI has looked again.
  await expect(page.getByText('SECRET-EXPECTED-ANSWER')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Remove this question/ })).toHaveCount(0)

  // The disagreement box opens, and Send waits for a real reason.
  await page.getByRole('button', { name: 'I disagree with this mark' }).first().click()
  const send = page.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()
  await page.getByLabel('Tell the AI why you disagree').fill('I showed the last step in line two')
  await expect(send).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByLabel('Tell the AI why you disagree')).toHaveCount(0)

  // Accepting finishes the paper and shows the grade.
  await page.getByRole('button', { name: 'I am happy with my marks. Finish.' }).click()
  await expect(page.getByRole('heading', { name: 'Well done, Review E2E Kid' })).toBeVisible()
  await expect(page.getByText('You scored 4 out of 5 (80%).')).toBeVisible()
})

test('written answers can be typed, spoken or photographed', async ({ page }) => {
  await signInUi(page, student.email, student.password)
  await page.waitForURL('**/profile-setup')
  await page.goto(`/attempt/${openAttemptId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  await expect(page.getByRole('button', { name: 'Photo of my answer' })).toHaveCount(2)
  await page.getByLabel('Your answer').first().fill('typed working')
  await expect(page.getByLabel('Your answer').first()).toHaveValue('typed working')

  // A photo is sent for reading. With no AI key set up the page says so and keeps her typed text.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  await page
    .getByLabel('Upload a photo of your handwritten answer')
    .first()
    .setInputFiles({ name: 'answer.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByRole('status').first()).toBeVisible()
  await expect(page.getByLabel('Your answer').first()).not.toHaveValue('')
})

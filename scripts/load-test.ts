import 'dotenv/config'
import { createDb } from '../src/db/connection'
import { conceptsRepository, blueprintsRepository } from '../src/db/repositories'
import { createQuestion } from '../src/lib/questions'
import { createParentSession, createStudentSession } from '../src/db/test-helpers'
import type { TestSession } from '../src/db/test-helpers'
import { p95 } from '../src/lib/percentiles'
import { Route as StudentsRoute } from '../src/routes/api/students'
import { Route as GenerateRoute } from '../src/routes/api/papers/generate'
import { Route as AttemptSubmitRoute } from '../src/routes/api/attempts/$id/submit'
import { Route as EvaluationsRoute } from '../src/routes/api/evaluations'

// F108 / T22 (tab12, "Cost ceiling", Automated, P2): "Simulate 50 concurrent generations and 20
// evaluations; record p95 latency and rupee cost per operation. Daily cap triggers a graceful
// message, not a crash." Deliberately a standalone script (`npm run loadtest`), not a
// vitest *.integration.test.ts file: every integration test already runs on every `npm test`
// invocation, and this repo's shared dev DB has shown real instability under sustained sequential
// load this session (see memory note examprep-test-suite-orphan-data) -- permanently adding a
// 50-concurrent-connection spike to the routine suite would make that worse, not better. This
// script is still fully automated and repeatable (exits non-zero on failure); it's just run
// deliberately, not on every commit.
//
// GENERATIONS default to 50, spread round-robin across HOUSEHOLDS parent-triggered households (so
// F112's per-student self-service quota, which only gates the student role, never applies).
// Paper generation itself never calls the AI model (it draws from the existing question bank;
// only AI-01 bank authoring does), so 0 AI cost for generations is the correct, honest result,
// not a bug. EVALUATIONS default to 20, each a real submitted attempt run through the actual
// evaluation route -- also 0 AI cost in this dev environment, since ANTHROPIC_API_KEY isn't
// configured here (same reason ai-grading.ts etc. have no unit test file of their own).
const GENERATIONS = Number(process.env.LOAD_TEST_GENERATIONS ?? 50)
const EVALUATIONS = Number(process.env.LOAD_TEST_EVALUATIONS ?? 20)
const HOUSEHOLDS = Number(process.env.LOAD_TEST_HOUSEHOLDS ?? 10)

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(route: { options: { server?: unknown } }, method: string): RouteHandler {
  const handlers = (route.options.server as { handlers: Record<string, RouteHandler> }).handlers
  return handlers[method]
}

function request(cookie: string, body?: unknown): Request {
  return new Request('http://localhost/test', {
    method: body ? 'POST' : 'GET',
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
}

interface Timing {
  ms: number
  // 0 means the operation never got as far as an HTTP response at all (e.g. the DB connection
  // pool refused a new connection) -- a harder failure than any real status code, and always
  // counted as "not graceful" in the pass/fail check below.
  status: number
  error?: string
}

interface StudentFixture {
  parent: TestSession
  student: TestSession
  studentId: string
}

async function main() {
  const db = createDb()
  const testStart = new Date()
  const householdIds: Array<string> = []
  let conceptId = ''
  let questionId = ''
  let blueprintId = ''

  try {
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
      code: `C7M-1.LOADTEST-${Date.now()}`,
      name: 'Load test fixture concept',
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
      text: 'Load test fixture question',
      answer: '1',
      created_by: 'load-test-fixture',
      options: [
        { label: 'A', text: '1', is_correct: true, order_index: 1 },
        { label: 'B', text: '2', is_correct: false, order_index: 2 },
      ],
    })
    questionId = question.id

    const blueprint = await blueprintsRepository.insert(db, {
      subject_id: subject.id,
      board: 'CBSE',
      class: 7,
      name: 'Load test fixture blueprint',
      duration_min: 10,
      total_marks: 1,
      sections: JSON.stringify([
        { name: 'Section A', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] },
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

    console.log(
      `Setting up ${HOUSEHOLDS} households for ${GENERATIONS} generations + ${EVALUATIONS} evaluations...`,
    )
    const createStudent = handlerFor(StudentsRoute, 'POST')
    const fixtures: Array<StudentFixture> = []
    for (let i = 0; i < HOUSEHOLDS; i++) {
      const parent = await createParentSession(`loadtest-${i}`)
      householdIds.push(parent.householdId)
      const studentResponse = await createStudent({
        request: request(parent.cookie, {
          name: `Load Test Kid ${i}`,
          class: 7,
          board: 'CBSE',
          consent_accepted: true,
        }),
      })
      if (studentResponse.status !== 201) {
        throw new Error(`Fixture setup failed: student creation returned ${studentResponse.status}`)
      }
      const student = await studentResponse.json()
      // Attempt submission is student-role-only -- a real logged-in student session is needed
      // alongside the parent one used for generation/evaluation.
      const studentSession = await createStudentSession(`loadtest-student-${i}`, parent.householdId, student.id)
      fixtures.push({ parent, student: studentSession, studentId: student.id })
    }

    // -- Generations: concurrent, round-robin across households, parent-triggered. Each call is
    // wrapped so a hard failure below the HTTP layer (e.g. the DB pooler refusing a new connection
    // under this much concurrency -- see the report printed below) is recorded as status 0 rather
    // than crashing the whole harness -- exactly the kind of failure T22 asks this script to
    // surface, not hide. --
    const generate = handlerFor(GenerateRoute, 'POST')
    const genTimings: Array<Timing> = await Promise.all(
      Array.from({ length: GENERATIONS }, async (_, i) => {
        const { parent, studentId } = fixtures[i % fixtures.length]
        const start = Date.now()
        try {
          const response = await generate({
            request: request(parent.cookie, {
              student_id: studentId,
              blueprint_id: blueprintId,
              chapter_ids: [chapter.id],
              recent_usage_window_days: 0,
            }),
          })
          return { ms: Date.now() - start, status: response.status }
        } catch (err) {
          return { ms: Date.now() - start, status: 0, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    )

    // -- Evaluations: each needs a real submitted attempt first (created sequentially -- only the
    // evaluate call itself is measured/concurrent, matching "20 evaluations" as its own op). --
    const submit = handlerFor(AttemptSubmitRoute, 'POST')
    const evaluate = handlerFor(EvaluationsRoute, 'POST')
    const attemptsByFixtureIndex: Array<{ fixtureIndex: number; attemptId: string }> = []
    for (let i = 0; i < EVALUATIONS; i++) {
      const fixtureIndex = i % fixtures.length
      const { studentId } = fixtures[fixtureIndex]
      // A student whose own generation call failed under load (see genTimings above) has no
      // paper to evaluate -- skip rather than throw, so one failed generation doesn't also
      // abort the whole evaluations phase.
      const paper = await db
        .selectFrom('papers')
        .select(['id', 'generated_at'])
        .where('student_id', '=', studentId)
        .orderBy('generated_at', 'desc')
        .executeTakeFirst()
      if (!paper) {
        console.warn(`Skipping evaluation ${i}: student ${studentId} has no generated paper`)
        continue
      }
      const attempt = await db
        .insertInto('attempts')
        .values({ paper_id: paper.id, student_id: studentId, mode: 'online', status: 'in_progress' })
        .returningAll()
        .executeTakeFirstOrThrow()
      const submitResponse = await submit({
        request: request(fixtures[fixtureIndex].student.cookie, { confirm_blanks: true }),
        params: { id: attempt.id },
      })
      if (submitResponse.status !== 200) {
        console.warn(`Skipping evaluation ${i}: attempt submit returned ${submitResponse.status}`)
        continue
      }
      attemptsByFixtureIndex.push({ fixtureIndex, attemptId: attempt.id })
    }

    const evalTimings: Array<Timing> = await Promise.all(
      attemptsByFixtureIndex.map(async ({ fixtureIndex, attemptId }) => {
        const start = Date.now()
        try {
          const response = await evaluate({
            request: request(fixtures[fixtureIndex].parent.cookie, { attempt_id: attemptId }),
          })
          return { ms: Date.now() - start, status: response.status }
        } catch (err) {
          return { ms: Date.now() - start, status: 0, error: err instanceof Error ? err.message : String(err) }
        }
      }),
    )

    const costRow = await db
      .selectFrom('ai_jobs')
      .select(['cost_inr'])
      .where('household_id', 'in', householdIds)
      .where('created_at', '>=', testStart)
      .execute()
    const totalCostInr = costRow.reduce((sum, row) => sum + (row.cost_inr ? Number(row.cost_inr) : 0), 0)

    // status 0 (never reached the HTTP layer, e.g. a DB connection pool refusal) counts as a hard
    // failure alongside a real 5xx -- both are "not graceful" per T22's own AC wording.
    const genErrors = genTimings.filter((t) => t.status === 0 || t.status >= 500)
    const evalErrors = evalTimings.filter((t) => t.status === 0 || t.status >= 500)
    const gen4xx = genTimings.filter((t) => t.status >= 400 && t.status < 500)
    const eval4xx = evalTimings.filter((t) => t.status >= 400 && t.status < 500)
    const totalOps = genTimings.length + evalTimings.length

    console.log('\n=== F108 / T22 load & cost report ===')
    console.log(
      `Generations: ${genTimings.length} (p95 ${p95(genTimings.map((t) => t.ms))}ms, ${gen4xx.length} graceful 4xx, ${genErrors.length} hard failures [5xx or connection-level])`,
    )
    console.log(
      `Evaluations: ${evalTimings.length} (p95 ${p95(evalTimings.map((t) => t.ms))}ms, ${eval4xx.length} graceful 4xx, ${evalErrors.length} hard failures [5xx or connection-level])`,
    )
    if (genErrors.length > 0 || evalErrors.length > 0) {
      const firstError = [...genErrors, ...evalErrors][0]
      console.log(`First hard failure: ${firstError.error ?? `HTTP ${firstError.status}`}`)
    }
    console.log(
      `Total AI cost this run: INR ${totalCostInr.toFixed(4)} (0 expected without ANTHROPIC_API_KEY configured)`,
    )
    console.log(`Cost per operation: INR ${(totalCostInr / totalOps).toFixed(6)}`)

    if (genErrors.length > 0 || evalErrors.length > 0) {
      console.error(
        '\nFAIL: at least one operation was a hard failure -- a cap/limit must degrade gracefully (4xx), never crash or exhaust the DB connection pool.',
      )
      process.exitCode = 1
    } else {
      console.log('\nPASS: no operation returned a 5xx under load.')
    }
  } finally {
    console.log('\nCleaning up load test fixtures...')
    if (householdIds.length > 0) {
      const studentRows = await db
        .selectFrom('students')
        .select('id')
        .where('household_id', 'in', householdIds)
        .execute()
      const studentIds = studentRows.map((s) => s.id)
      if (studentIds.length > 0) {
        await db.deleteFrom('attempts').where('student_id', 'in', studentIds).execute()
        await db.deleteFrom('papers').where('student_id', 'in', studentIds).execute()
      }
      await db.deleteFrom('ai_jobs').where('household_id', 'in', householdIds).execute()
      await db.deleteFrom('product_events').where('household_id', 'in', householdIds).execute()
      await db.deleteFrom('households').where('id', 'in', householdIds).execute()
    }
    if (blueprintId) await db.deleteFrom('blueprints').where('id', '=', blueprintId).execute()
    if (questionId) await db.deleteFrom('questions').where('id', '=', questionId).execute()
    if (conceptId) await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db.destroy()
  }
}

main()

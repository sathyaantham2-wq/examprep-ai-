import type { Db } from '../db/connection'
import type { QuestionType } from '../db/enums'
import {
  papersRepository,
  paperQuestionsRepository,
  attemptsRepository,
  attemptAnswersRepository,
  questionUsageRepository,
  conceptsRepository,
  conceptStatusRepository,
  conceptRemediationContentRepository,
  remediationTasksRepository,
  questionOptionsRepository,
  questionsRepository,
  evaluationItemsRepository,
} from '../db/repositories'
import {
  generateRemediationContent,
  isAiRemediationConfigured,
} from './ai-remediation'
import { createEvaluation, confirmEvaluation } from './evaluation'

// F066/F068: only objective types can be auto-scored with no AI/human step, which is what makes
// "scored immediately" (F068's AC) honest rather than a UI promise the backend can't keep.
const OBJECTIVE_TYPES: Array<QuestionType> = [
  'mcq',
  'assertion_reason',
  'match',
  'multi_statement',
  'fill_blank',
]
const DRILL_QUESTION_COUNT = 3
const READING_DISCIPLINE_TRIGGER_REASON = 'Reading discipline pattern'

export type BuildRemediationPackResult =
  | {
      ok: true
      task_id: string
      refresher: string | null
      examples: Array<{ problem: string; steps: Array<string> }>
      questions: Array<{
        id: string
        text: string
        type: QuestionType
        marks: number
        options: Array<{ label: string; text: string }>
      }>
      shortfall: boolean
      // F060: "wrong answers on [reversal-word questions] classified as reading discipline,
      // routed to a drill instead of re-teaching." 'reading_discipline' means this student's
      // recent wrong answers on this concept were dominated by that error type, not a genuine
      // knowledge gap -- the caller should present it as a careful-reading drill, not a lesson.
      drill_kind: 'concept_refresher' | 'reading_discipline'
    }
  | {
      ok: false
      reason: 'concept_not_found' | 'not_priority' | 'no_questions_available'
    }

/**
 * F066: "On PRIORITY flag the system builds: 2-3 line refresher, 2 solved examples, 3 practice
 * questions with hidden answers." Refuses to build one for a concept that isn't currently
 * flagged Priority for this student -- the AC's trigger condition, enforced here rather than
 * trusted from the caller.
 */
export async function buildRemediationPack(
  db: Db,
  input: { studentId: string; conceptId: string },
): Promise<BuildRemediationPackResult> {
  const status = await conceptStatusRepository.findOne(
    db,
    input.studentId,
    input.conceptId,
  )
  if (!status || status.status !== 'Priority') {
    return { ok: false, reason: 'not_priority' }
  }

  const concept = await conceptsRepository.findById(db, input.conceptId)
  if (!concept) return { ok: false, reason: 'concept_not_found' }

  // F060: if this student's recent wrong answers on this concept were mostly Reading Discipline
  // (not a knowledge gap -- she can do the maths, she missed the NOT/least/false), re-teaching
  // the concept is the wrong intervention. "Mostly" is a simple strict-majority-of-error-types
  // comparison, not a stated threshold from the plan (none exists), same kind of documented
  // default F118/F063 already use elsewhere in this codebase.
  const errorTypeCounts =
    await evaluationItemsRepository.countErrorTypesForConcept(
      db,
      input.studentId,
      input.conceptId,
    )
  const readingDisciplineCount =
    errorTypeCounts.find((r) => r.error_type === 'Reading Discipline')?.count ??
    0
  const otherErrorCount = errorTypeCounts
    .filter((r) => r.error_type !== 'Reading Discipline')
    .reduce((sum, r) => sum + Number(r.count), 0)
  const isReadingDisciplinePack =
    Number(readingDisciplineCount) > 0 &&
    Number(readingDisciplineCount) > otherErrorCount

  // F067: cached per concept, generated once, reused by every student who needs it. Skipped
  // entirely for a reading-discipline pack -- there is nothing to re-teach, so there is nothing
  // to cache or generate here.
  let cached:
    { refresher: string | null; examples: unknown } | null | undefined = null
  if (!isReadingDisciplinePack) {
    cached = await conceptRemediationContentRepository.findByConcept(
      db,
      input.conceptId,
    )
    if (!cached) {
      const student = isAiRemediationConfigured()
        ? await db
            .selectFrom('students')
            .select('household_id')
            .where('id', '=', input.studentId)
            .executeTakeFirstOrThrow()
        : null
      const aiResult = isAiRemediationConfigured()
        ? await generateRemediationContent(db, {
            conceptName: concept.name,
            conceptIdea: concept.idea,
            conceptRule: concept.rule,
            conceptExample: concept.example,
            householdId: student!.household_id,
            studentId: input.studentId,
          })
        : null
      cached = await conceptRemediationContentRepository.insert(db, {
        concept_id: input.conceptId,
        refresher: aiResult?.refresher ?? null,
        examples: JSON.stringify(aiResult?.examples ?? []),
        source: aiResult ? 'ai' : 'bank_fallback',
      })
    }
  }
  const refresher = isReadingDisciplinePack
    ? 'Not a knowledge gap -- her working shows she knows this concept. These questions have a NOT, least, false, or similar word that flips what is being asked; re-read the question itself before answering.'
    : (cached?.refresher ?? null)
  const examples = isReadingDisciplinePack ? [] : (cached?.examples ?? [])

  const drillQuestions = await questionsRepository.findRandomApprovedObjective(
    db,
    input.conceptId,
    OBJECTIVE_TYPES,
    DRILL_QUESTION_COUNT,
    isReadingDisciplinePack,
  )
  if (drillQuestions.length === 0) {
    return { ok: false, reason: 'no_questions_available' }
  }

  const optionsByQuestion = new Map(
    await Promise.all(
      drillQuestions.map(async (q) => {
        const options = await questionOptionsRepository.listByQuestion(db, q.id)
        return [
          q.id,
          options.map((o) => ({ label: o.label, text: o.text })),
        ] as const
      }),
    ),
  )

  const task = await remediationTasksRepository.insert(db, {
    student_id: input.studentId,
    concept_id: input.conceptId,
    // Persisted here rather than a new column -- trigger_reason is already the record of "why
    // this task exists," and loadTaskView derives drill_kind back out of it for a student
    // reopening an unfinished task, so the distinction survives without a migration.
    trigger_reason: isReadingDisciplinePack
      ? READING_DISCIPLINE_TRIGGER_REASON
      : 'Priority flag',
    refresher,
    examples: JSON.stringify(examples),
    question_ids: drillQuestions.map((q) => q.id),
    status: 'pending',
  })

  return {
    ok: true,
    task_id: task.id,
    refresher,
    examples: examples as Array<{ problem: string; steps: Array<string> }>,
    questions: drillQuestions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      marks: q.marks,
      options: optionsByQuestion.get(q.id) ?? [],
    })),
    shortfall: drillQuestions.length < DRILL_QUESTION_COUNT,
    drill_kind: isReadingDisciplinePack
      ? 'reading_discipline'
      : 'concept_refresher',
  }
}

export interface TaskView {
  refresher: string | null
  examples: Array<{ problem: string; steps: Array<string> }>
  questions: Array<{
    id: string
    text: string
    type: QuestionType
    marks: number
    options: Array<{ label: string; text: string }>
  }>
  drill_kind: 'concept_refresher' | 'reading_discipline'
}

/**
 * Re-derives the sanitized (no answer/is_correct) question view for an existing task -- used by
 * GET /api/remediation/:id when a student reopens a drill they haven't finished, so the view
 * doesn't depend on buildRemediationPack having just run in the same request.
 */
export async function loadTaskView(
  db: Db,
  task: {
    refresher: string | null
    examples: unknown
    question_ids: Array<string>
    trigger_reason: string
  },
): Promise<TaskView> {
  const questions =
    task.question_ids.length > 0
      ? await db
          .selectFrom('questions')
          .selectAll()
          .where('id', 'in', task.question_ids)
          .execute()
      : []
  const optionsByQuestion = new Map(
    await Promise.all(
      questions.map(async (q) => {
        const options = await questionOptionsRepository.listByQuestion(db, q.id)
        return [
          q.id,
          options.map((o) => ({ label: o.label, text: o.text })),
        ] as const
      }),
    ),
  )
  return {
    refresher: task.refresher,
    examples: task.examples
      ? (task.examples as Array<{ problem: string; steps: Array<string> }>)
      : [],
    questions: questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type,
      marks: q.marks,
      options: optionsByQuestion.get(q.id) ?? [],
    })),
    drill_kind:
      task.trigger_reason === READING_DISCIPLINE_TRIGGER_REASON
        ? 'reading_discipline'
        : 'concept_refresher',
  }
}

async function findOrCreateDrillBlueprint(
  db: Db,
  subjectId: string,
  board: string,
  classNum: number,
) {
  const existing = await db
    .selectFrom('blueprints')
    .selectAll()
    .where('subject_id', '=', subjectId)
    .where('name', '=', 'Auto remediation drill')
    .executeTakeFirst()
  if (existing) return existing

  // Content is irrelevant here -- a drill's questions are hand-picked by buildRemediationPack,
  // never selected by this blueprint's own sections/bloom_targets. It exists only so
  // papers.blueprint_id (NOT NULL) has something real to point at.
  return db
    .insertInto('blueprints')
    .values({
      subject_id: subjectId,
      board,
      class: classNum,
      name: 'Auto remediation drill',
      total_marks: 1,
      duration_min: 10,
      sections: JSON.stringify([]),
      bloom_targets: JSON.stringify({
        Remember: 0,
        Understand: 0,
        Apply: 0,
        Analyse: 0,
        Evaluate: 0,
        Create: 0,
      }),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export type SubmitDrillResult =
  | {
      ok: true
      percentage: number
      items: Array<{
        question_id: string
        marks_awarded: number
        marks_max: number
        error_type: string | null
      }>
      priority_cleared: boolean
    }
  | {
      ok: false
      reason: 'not_found' | 'already_completed' | 'concept_not_found'
    }

/**
 * F068: "Drill attempt scored immediately ... writes back to the concept ledger and can clear or
 * sustain the PRIORITY flag." Builds a real papers/attempt/evaluation chain and confirms it in
 * the same call -- unlike an exam paper, a drill has no parent-review gate between submit and
 * confirm, since every drill question is objective (deterministic code, never AI) and this is
 * low-stakes self-practice, not the graded record a parent reviews. confirmEvaluation() is the
 * exact function F047/F063's escalation logic already runs on, so "clears or sustains Priority"
 * falls out of that existing state machine rather than new logic here.
 */
export async function submitDrillAttempt(
  db: Db,
  input: {
    taskId: string
    studentId: string
    answers: Array<{
      question_id: string
      selected_option?: string
      response_text?: string
    }>
  },
): Promise<SubmitDrillResult> {
  const task = await remediationTasksRepository.findById(
    db,
    input.studentId,
    input.taskId,
  )
  if (!task) return { ok: false, reason: 'not_found' }
  if (task.status === 'completed') {
    return { ok: false, reason: 'already_completed' }
  }

  const concept = await conceptsRepository.findById(db, task.concept_id)
  if (!concept) return { ok: false, reason: 'concept_not_found' }
  const chapter = await db
    .selectFrom('chapters')
    .select('subject_id')
    .where('id', '=', concept.chapter_id)
    .executeTakeFirstOrThrow()

  const questions = await db
    .selectFrom('questions')
    .selectAll()
    .where('id', 'in', task.question_ids)
    .execute()
  const answerByQuestion = new Map(input.answers.map((a) => [a.question_id, a]))

  // createEvaluation/confirmEvaluation each open their own db.transaction() internally, and
  // Kysely's Postgres dialect here doesn't support nesting one transaction inside another (no
  // savepoints) -- so only the paper/attempt/answers writes below share one transaction; the
  // evaluate+confirm step runs as its own transaction afterward, same as the real exam flow
  // already does across separate HTTP requests.
  const drillWrite = await db.transaction().execute(async (trx) => {
    const blueprint = await findOrCreateDrillBlueprint(
      trx,
      chapter.subject_id,
      concept.board,
      concept.class,
    )

    const paper = await papersRepository.insert(trx, {
      student_id: input.studentId,
      blueprint_id: blueprint.id,
      blueprint_version: blueprint.version,
      subject_id: chapter.subject_id,
      chapter_ids: [concept.chapter_id],
      title: `Remediation drill: ${concept.name}`,
      total_marks: questions.reduce((sum, q) => sum + q.marks, 0),
      duration_min: blueprint.duration_min,
      theme: 'Clean School',
    })

    const paperQuestions = await paperQuestionsRepository.insertMany(
      trx,
      questions.map((q, index) => ({
        paper_id: paper.id,
        question_id: q.id,
        section: 'Drill',
        position: index + 1,
        marks: q.marks,
      })),
    )

    for (const q of questions) {
      await questionUsageRepository.insert(trx, {
        student_id: input.studentId,
        question_id: q.id,
        paper_id: paper.id,
      })
    }

    const attempt = await attemptsRepository.insert(trx, {
      paper_id: paper.id,
      student_id: input.studentId,
      mode: 'online',
      status: 'in_progress',
    })

    for (const pq of paperQuestions) {
      const answer = answerByQuestion.get(pq.question_id)
      if (!answer) continue
      await attemptAnswersRepository.upsert(trx, {
        attempt_id: attempt.id,
        paper_question_id: pq.id,
        response_text: answer.response_text,
        selected_option: answer.selected_option,
        source: 'typed',
      })
    }

    await attemptsRepository.update(trx, input.studentId, attempt.id, {
      status: 'submitted',
      submitted_at: new Date(),
      duration_used_sec: 0,
    })

    return { paperQuestions, attempt }
  })

  const created = await createEvaluation(db, drillWrite.attempt.id)
  const confirmed = await confirmEvaluation(db, created.evaluation.id)
  const items = await evaluationItemsRepository.listForEvaluation(
    db,
    created.evaluation.id,
  )

  await remediationTasksRepository.update(db, input.studentId, task.id, {
    status: 'completed',
    completed_at: new Date(),
  })

  const newStatus = await conceptStatusRepository.findOne(
    db,
    input.studentId,
    task.concept_id,
  )

  const questionIdByPaperQuestion = new Map(
    drillWrite.paperQuestions.map((pq) => [pq.id, pq.question_id]),
  )

  return {
    ok: true,
    percentage: Number(confirmed.percentage),
    items: items.map((item) => ({
      question_id: questionIdByPaperQuestion.get(item.paper_question_id)!,
      marks_awarded: Number(item.marks_awarded),
      marks_max: Number(item.marks_max),
      error_type: item.error_type,
    })),
    priority_cleared: newStatus?.status !== 'Priority',
  }
}

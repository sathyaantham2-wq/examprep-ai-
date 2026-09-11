import type { Db } from '../db/connection'
import type { HabitDrillKind, QuestionType } from '../db/enums'
import {
  habitsRepository,
  habitObservationsRepository,
  habitDrillTasksRepository,
  questionsRepository,
  questionOptionsRepository,
} from '../db/repositories'

const DRILL_QUESTION_COUNT = 3

// F070: how many characters of response_text count as "showed working" rather than a bare final
// answer. Not a number the plan specifies -- a documented default, the same kind RETEST_DAYS_BY_
// STATUS (src/lib/mastery.ts) and F060's reading-discipline majority rule already are.
export const MARK_TO_POINT_MIN_CHARS = 15

interface HabitDrillDefinition {
  kind: HabitDrillKind
  questionTypes: Array<QuestionType>
  instructions: string
}

// F070's three named drills (mark-to-point, three-check on assertion-reason, two-minute blank
// sweep), mapped onto the closest existing H1-H10 habit (seed-habits.ts) each one drills:
// H1 "Shows Working" -> mark-to-point, H9 "Checks Option Plausibility" -> the three-part
// assertion/reason/explanation check that IS "checking plausibility" for an AR question, and H5
// "Attempts Every Question" -> the blank sweep. Neither the mapping nor the pass thresholds below
// are specified anywhere in the plan beyond the three drill names -- a documented default.
export const HABIT_DRILL_CONFIG: Partial<Record<string, HabitDrillDefinition>> = {
  H1: {
    kind: 'mark_to_point',
    questionTypes: ['short_answer', 'long_answer'],
    instructions:
      'Write out every step that earns a mark, not just the final answer -- a bare number earns zero credit here even when it is correct.',
  },
  H9: {
    kind: 'three_check_ar',
    questionTypes: ['assertion_reason'],
    instructions:
      'For each pair: check the Assertion is true, check the Reason is true, then check whether the Reason actually explains the Assertion -- in that order, before you choose an option.',
  },
  H5: {
    kind: 'blank_sweep',
    questionTypes: [
      'mcq',
      'assertion_reason',
      'match',
      'multi_statement',
      'fill_blank',
    ],
    instructions:
      'Answer every question below. Write something -- even a guess -- rather than leaving one blank.',
  },
}

export interface HabitDrillAnswer {
  question_id: string
  selected_option?: string
  response_text?: string
}

/**
 * "Two-minute blank sweep" (H5): pass has nothing to do with correctness -- it is entirely about
 * not leaving anything unanswered, so this never looks at whether an answer is right.
 */
export function evaluateBlankSweep(params: {
  questionIds: Array<string>
  answers: Array<HabitDrillAnswer>
}): boolean {
  if (params.questionIds.length === 0) return false
  const byQuestion = new Map(params.answers.map((a) => [a.question_id, a]))
  return params.questionIds.every((id) => {
    const answer = byQuestion.get(id)
    return Boolean(
      answer &&
        ((answer.selected_option && answer.selected_option.length > 0) ||
          (answer.response_text && answer.response_text.trim().length > 0)),
    )
  })
}

/**
 * "Mark-to-point" (H1): pass is a proxy for "wrote working, not just a final answer" -- a minimum
 * response length on every question, also independent of whether the maths itself is correct.
 */
export function evaluateMarkToPoint(params: {
  questionIds: Array<string>
  answers: Array<HabitDrillAnswer>
  minChars?: number
}): boolean {
  if (params.questionIds.length === 0) return false
  const minChars = params.minChars ?? MARK_TO_POINT_MIN_CHARS
  const byQuestion = new Map(params.answers.map((a) => [a.question_id, a]))
  return params.questionIds.every((id) => {
    const answer = byQuestion.get(id)
    return Boolean(
      answer?.response_text &&
        answer.response_text.trim().length >= minChars,
    )
  })
}

/**
 * "Three-check on assertion-reason" (H9): unlike the other two kinds, this one IS about
 * correctness -- the three-part check (assertion true? reason true? does reason explain
 * assertion?) is encoded directly into an assertion_reason question's options, so getting every
 * one right is the honest proxy for having actually done the check.
 */
export function evaluateThreeCheckAr(params: { results: Array<boolean> }): boolean {
  return params.results.length > 0 && params.results.every(Boolean)
}

export type BuildHabitDrillResult =
  | {
      ok: true
      task_id: string
      habit_code: string
      habit_name: string
      drill_kind: HabitDrillKind
      instructions: string
      questions: Array<{
        id: string
        text: string
        type: QuestionType
        options: Array<{ label: string; text: string }>
      }>
    }
  | {
      ok: false
      reason:
        | 'habit_not_found'
        | 'no_drill_for_habit'
        | 'not_triggered'
        | 'no_questions_available'
    }

async function loadQuestionsWithOptions(db: Db, questionIds: Array<string>) {
  const questions =
    questionIds.length > 0
      ? await db
          .selectFrom('questions')
          .selectAll()
          .where('id', 'in', questionIds)
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
  return questions.map((q) => ({
    id: q.id,
    text: q.text,
    type: q.type,
    options: optionsByQuestion.get(q.id) ?? [],
  }))
}

/**
 * F070: "short drills targeting a habit ... with pass criteria." Mirrors buildRemediationPack's
 * shape (F066) -- parent/admin-triggered, refuses if the trigger condition isn't currently true --
 * but the trigger here is "the last two confirmed ratings for this habit were not present" (the
 * same "two in a row" shape F063 already uses for Priority), not a persisted flag, since habits
 * have no concept_status equivalent table.
 */
export async function buildHabitDrill(
  db: Db,
  input: { studentId: string; habitId: string },
): Promise<BuildHabitDrillResult> {
  const habit = await habitsRepository.findById(db, input.habitId)
  if (!habit) return { ok: false, reason: 'habit_not_found' }

  const config = HABIT_DRILL_CONFIG[habit.code]
  if (!config) return { ok: false, reason: 'no_drill_for_habit' }

  const recent = await habitObservationsRepository.recentRatingsForHabit(
    db,
    input.studentId,
    input.habitId,
    2,
  )
  const isTriggered =
    recent.length === 2 && recent.every((r) => r.rating !== 'present')
  if (!isTriggered) return { ok: false, reason: 'not_triggered' }

  const questions = await questionsRepository.findRandomApprovedByType(
    db,
    config.questionTypes,
    DRILL_QUESTION_COUNT,
  )
  if (questions.length === 0) return { ok: false, reason: 'no_questions_available' }

  const task = await habitDrillTasksRepository.insert(db, {
    student_id: input.studentId,
    habit_id: input.habitId,
    drill_kind: config.kind,
    instructions: config.instructions,
    question_ids: questions.map((q) => q.id),
    status: 'pending',
  })

  const questionViews = await loadQuestionsWithOptions(
    db,
    questions.map((q) => q.id),
  )

  return {
    ok: true,
    task_id: task.id,
    habit_code: habit.code,
    habit_name: habit.name,
    drill_kind: config.kind,
    instructions: config.instructions,
    questions: questionViews,
  }
}

export interface HabitDrillView {
  drill_kind: HabitDrillKind
  instructions: string
  questions: Array<{
    id: string
    text: string
    type: QuestionType
    options: Array<{ label: string; text: string }>
  }>
}

/** Re-derives the question view for an existing task -- GET /api/habit-drills/:id. */
export async function loadHabitDrillView(
  db: Db,
  task: {
    drill_kind: HabitDrillKind
    instructions: string
    question_ids: Array<string>
  },
): Promise<HabitDrillView> {
  return {
    drill_kind: task.drill_kind,
    instructions: task.instructions,
    questions: await loadQuestionsWithOptions(db, task.question_ids),
  }
}

export type SubmitHabitDrillResult =
  | { ok: true; passed: boolean }
  | { ok: false; reason: 'not_found' | 'already_completed' }

/**
 * F070's scoring step. Deliberately does NOT go through createEvaluation/confirmEvaluation (F062's
 * pipeline) the way F068's concept drills do -- that pipeline writes every item back to the
 * concept mastery ledger, and a habit drill's questions are picked for their TYPE, not because the
 * concept they happen to belong to is what this student is being diagnosed on. Scoring correctness
 * (three_check_ar) is done directly against question_options here instead.
 */
export async function submitHabitDrillAttempt(
  db: Db,
  input: {
    taskId: string
    studentId: string
    answers: Array<HabitDrillAnswer>
  },
): Promise<SubmitHabitDrillResult> {
  const task = await habitDrillTasksRepository.findById(
    db,
    input.studentId,
    input.taskId,
  )
  if (!task) return { ok: false, reason: 'not_found' }
  if (task.status === 'completed') return { ok: false, reason: 'already_completed' }

  let passed: boolean
  if (task.drill_kind === 'blank_sweep') {
    passed = evaluateBlankSweep({
      questionIds: task.question_ids,
      answers: input.answers,
    })
  } else if (task.drill_kind === 'mark_to_point') {
    passed = evaluateMarkToPoint({
      questionIds: task.question_ids,
      answers: input.answers,
    })
  } else {
    const answerByQuestion = new Map(
      input.answers.map((a) => [a.question_id, a]),
    )
    const results = await Promise.all(
      task.question_ids.map(async (questionId) => {
        const options = await questionOptionsRepository.listByQuestion(
          db,
          questionId,
        )
        const correct = options.find((o) => o.is_correct)
        const submitted = answerByQuestion.get(questionId)
        return Boolean(correct && submitted?.selected_option === correct.label)
      }),
    )
    passed = evaluateThreeCheckAr({ results })
  }

  await habitDrillTasksRepository.update(db, input.studentId, task.id, {
    status: 'completed',
    passed,
    completed_at: new Date(),
  })

  return { ok: true, passed }
}

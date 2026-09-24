import type { Db } from '../../db/connection'

export interface WrongQuestion {
  question_id: string
  text: string
  type: string
  her_answer: string | null
  correct_answer: string | null
  marks_awarded: number
  marks_max: number
  answered_at: string
}

/**
 * 2026-09-24, user feedback with a screenshot: the concept tracker showed the mastery-scoring
 * formula's internal weights and thresholds directly to a student, and had no answer at all to
 * what she actually asked for -- "where the wrong questions are". This is that: her most recent
 * questions on one concept, across every evaluated attempt (not just her latest paper), where she
 * did not get full marks -- most recent first, one row per question (a recycled question she got
 * wrong twice only shows her latest attempt at it).
 *
 * Reuses concept_answer_log, the same per-answer ledger GET /api/attempts/:id/result already
 * reads from for a single paper's review (T09 amendment, 2026-09-22) -- this is that same
 * post-confirmation "see the correct answer next to your own" allowance, just aggregated across
 * attempts and scoped to one concept instead of one paper.
 */
export async function getWrongQuestionsForConcept(
  db: Db,
  input: { studentId: string; conceptId: string; limit?: number },
): Promise<Array<WrongQuestion>> {
  const limit = input.limit ?? 5

  // Pulled wider than `limit` and de-duplicated by question in JS: the same bank question can be
  // served to her more than once, and a plain SQL LIMIT before de-duplication could return fewer
  // than `limit` distinct questions even when more exist.
  const rows = await db
    .selectFrom('concept_answer_log as l')
    .innerJoin('evaluations as e', 'e.id', 'l.evaluation_id')
    .select([
      'l.question_id',
      'l.marks_awarded',
      'l.marks_max',
      'l.answered_at',
    ])
    .where('l.student_id', '=', input.studentId)
    .where('l.concept_id', '=', input.conceptId)
    .where('e.confirmed_at', 'is not', null)
    .orderBy('l.answered_at', 'desc')
    .limit(limit * 4)
    .execute()

  const seen = new Set<string>()
  const deduped: typeof rows = []
  for (const row of rows) {
    if (Number(row.marks_awarded) >= Number(row.marks_max)) continue
    if (seen.has(row.question_id)) continue
    seen.add(row.question_id)
    deduped.push(row)
    if (deduped.length >= limit) break
  }
  if (deduped.length === 0) return []

  const questionIds = deduped.map((r) => r.question_id)
  const [questionRows, allOptions, answers] = await Promise.all([
    db
      .selectFrom('questions')
      .select(['id', 'text', 'type', 'answer'])
      .where('id', 'in', questionIds)
      .execute(),
    db
      .selectFrom('question_options')
      .select(['question_id', 'label', 'text', 'is_correct'])
      .where('question_id', 'in', questionIds)
      .execute(),
    // Her own chosen option, for MCQ-family types only -- a written answer's actual response text
    // is not fetched here (this view is "which questions, what was the mark, what's the right
    // answer", not a full transcript; that already exists per-paper on /attempt/:id).
    // attempt_answers has no question_id of its own (only paper_question_id) -- joined through
    // concept_answer_log, which already carries both, rather than a second join to paper_questions.
    db
      .selectFrom('attempt_answers as a')
      .innerJoin(
        'concept_answer_log as l',
        'l.paper_question_id',
        'a.paper_question_id',
      )
      .select(['l.question_id', 'a.selected_option'])
      .where('l.question_id', 'in', questionIds)
      .where('l.student_id', '=', input.studentId)
      .where('l.concept_id', '=', input.conceptId)
      .execute(),
  ])
  const questionById = new Map(questionRows.map((q) => [q.id, q]))
  const selectedByQuestion = new Map(
    answers.map((a) => [a.question_id, a.selected_option]),
  )
  const optionText = (
    questionId: string,
    label: string | null,
  ): string | null => {
    if (!label) return null
    return (
      allOptions.find((o) => o.question_id === questionId && o.label === label)
        ?.text ?? null
    )
  }
  const correctOptionFor = (questionId: string) =>
    allOptions.find((o) => o.question_id === questionId && o.is_correct)

  return deduped.map((row) => {
    const question = questionById.get(row.question_id)
    const correctOption = correctOptionFor(row.question_id)
    const selectedLabel = selectedByQuestion.get(row.question_id)
    const selectedText = optionText(row.question_id, selectedLabel ?? null)
    return {
      question_id: row.question_id,
      text: question?.text ?? '',
      type: question?.type ?? 'mcq',
      her_answer: selectedLabel
        ? `${selectedLabel}. ${selectedText ?? ''}`
        : null,
      correct_answer: correctOption
        ? `${correctOption.label}. ${correctOption.text}`
        : (question?.answer ?? null),
      marks_awarded: Number(row.marks_awarded),
      marks_max: Number(row.marks_max),
      answered_at: new Date(row.answered_at).toISOString(),
    }
  })
}

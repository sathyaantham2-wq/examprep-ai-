import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ThemeToggle } from '../../components/theme-toggle'
import { AnswerReview } from '../../components/answer-review'
import { WrittenAnswerInput } from '../../components/written-answer-input'
import { useSession } from '../../lib/auth-client'
import { playCoinSound } from '../../lib/reward-sound'

export const Route = createFileRoute('/attempt/$id')({ component: Attempt })

interface Question {
  paper_question_id: string
  position: number
  section: string
  concept_name: string | null
  marks: number
  type: string
  text: string
  hint: string | null
  options: Array<{ label: string; text: string }>
  saved_answer: {
    response_text: string | null
    selected_option: string | null
  } | null
}

interface AttemptData {
  attempt: { id: string; status: string; mode: string; started_at: string }
  student: { name: string; class: number; board: string }
  chapters: Array<{ part: string; chapter_no: number; name: string }>
  paper: {
    id: string
    title: string
    duration_min: number
    total_marks: number
  }
  questions: Array<Question>
}

interface AttemptResult {
  evaluated: boolean
  score: number
  total_marks: number
  percentage: number
  concepts: Array<{
    concept_id: string
    concept_name: string
    questions: number
    marks: number
    marks_max: number
    mastery_level: string | null
    previous_level: string | null
  }>
  // Per question: her marks and the correct answer -- allowed here, post-submission, per
  // CLAUDE.md's T09 amendment (2026-09-22). Merged client-side with the question text/her own
  // saved answer this screen already holds from GET /api/attempts/:id.
  questions: Array<{
    paper_question_id: string
    marks_awarded: number
    marks_max: number
    correct_answer: string | null
    // F049 / AI-08: written per lost-mark question at evaluation time; null on the ones she
    // got right.
    feedback: string | null
    error_type: string | null
    // F126 / AI-13: null until someone asks for it; cached per question once generated.
    explanation: string | null
  }>
}

interface AnswerState {
  selected_option?: string
  response_text?: string
}

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds))
  const m = Math.floor(clamped / 60)
  const s = clamped % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function Attempt() {
  const { id } = Route.useParams()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [data, setData] = useState<AttemptData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Partial<Record<string, AnswerState>>>(
    {},
  )
  const [flagged, setFlagged] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'answering' | 'reviewing'>('answering')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [pointsEarned, setPointsEarned] = useState<{ points: number; coins: number } | null>(null)
  // F126: explanations fetched after the result loaded, keyed by paper_question_id. Kept apart
  // from `result` so asking for one never re-renders the whole marked paper.
  // Partial<Record<...>>, same as `answers` above: indexing a key that isn't there yet is the
  // normal case here, and the type should say so.
  const [explanations, setExplanations] = useState<
    Partial<Record<string, string>>
  >({})
  const [explaining, setExplaining] = useState<string | null>(null)
  const [explainError, setExplainError] = useState<
    Partial<Record<string, string>>
  >({})
  const [now, setNow] = useState(() => Date.now())
  const saveTimers = useRef<
    Partial<Record<string, ReturnType<typeof setTimeout>>>
  >({})
  // Seconds spent per question, estimated as the time since her previous answer (capped so a
  // break does not count). Feeds the concept's average response time.
  const lastEventAt = useRef<number>(Date.now())
  const secondsSpent = useRef<Partial<Record<string, number>>>({})

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch(`/api/attempts/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          setLoadError(
            r.status === 404
              ? 'Attempt not found.'
              : 'Could not load this attempt.',
          )
          return
        }
        const body: AttemptData = await r.json()
        setData(body)
        const initial: Record<string, AnswerState> = {}
        for (const q of body.questions) {
          if (q.saved_answer) {
            initial[q.paper_question_id] = {
              selected_option: q.saved_answer.selected_option ?? undefined,
              response_text: q.saved_answer.response_text ?? undefined,
            }
          }
        }
        setAnswers(initial)
      })
      .catch(() => setLoadError('Could not load this attempt.'))
  }, [isPending, session, role, navigate, id])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const remainingSeconds = useMemo(() => {
    if (!data) return null
    const deadline =
      new Date(data.attempt.started_at).getTime() +
      data.paper.duration_min * 60_000
    return (deadline - now) / 1000
  }, [data, now])

  function saveAnswer(paperQuestionId: string, next: AnswerState) {
    const stamp = Date.now()
    const elapsed = Math.min(600, Math.max(0, Math.round((stamp - lastEventAt.current) / 1000)))
    lastEventAt.current = stamp
    secondsSpent.current[paperQuestionId] = (secondsSpent.current[paperQuestionId] ?? 0) + elapsed
    setAnswers((prev) => ({ ...prev, [paperQuestionId]: next }))
    if (saveTimers.current[paperQuestionId]) {
      clearTimeout(saveTimers.current[paperQuestionId])
    }
    saveTimers.current[paperQuestionId] = setTimeout(() => {
      fetch(`/api/attempts/${id}/answer`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paper_question_id: paperQuestionId,
          ...next,
          time_spent_sec: secondsSpent.current[paperQuestionId] ?? 0,
        }),
      }).catch(() => {
        // F040 autosave -- a single dropped save isn't fatal, the next edit or the review-step
        // submit will carry the latest value again. No offline queue exists yet.
      })
    }, 600)
  }

  function toggleFlag(paperQuestionId: string) {
    setFlagged((prev) => {
      const next = new Set(prev)
      if (next.has(paperQuestionId)) next.delete(paperQuestionId)
      else next.add(paperQuestionId)
      return next
    })
  }

  function isBlank(q: Question): boolean {
    const a = answers[q.paper_question_id]
    return !a || (!a.selected_option && !(a.response_text?.trim() ?? ''))
  }

  // Loads the finished result once marks are final (also called by the review screen).
  const showResult = useCallback(async () => {
    const marked = await fetch(`/api/attempts/${id}/result`)
    if (marked.ok) setResult((await marked.json()) as AttemptResult)
  }, [id])

  // F126: generating is an explicit action, not something opening the result triggers for every
  // question -- the first request for a given question pays for it, everyone after reads the cache.
  async function explain(paperQuestionId: string) {
    setExplaining(paperQuestionId)
    setExplainError((prev) => ({ ...prev, [paperQuestionId]: '' }))
    try {
      const response = await fetch(`/api/attempts/${id}/explanation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paper_question_id: paperQuestionId }),
      })
      const body = (await response.json().catch(() => null)) as {
        explanation?: string
        message?: string
      } | null
      if (!response.ok || !body?.explanation) {
        setExplainError((prev) => ({
          ...prev,
          [paperQuestionId]:
            body?.message ?? 'Could not explain this one right now.',
        }))
        return
      }
      setExplanations((prev) => ({
        ...prev,
        [paperQuestionId]: body.explanation!,
      }))
    } finally {
      setExplaining(null)
    }
  }

  async function doSubmit(confirmBlanks: boolean) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const response = await fetch(`/api/attempts/${id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_blanks: confirmBlanks }),
      })
      if (!response.ok) {
        const body = await response.json()
        setSubmitError(body.message ?? body.error ?? 'Could not submit.')
        return
      }
      const body = (await response.json().catch(() => null)) as {
        evaluation_id?: string | null
        points_earned?: { points: number; coins: number } | null
      } | null
      setSubmitted(true)
      // A paper made only of multiple-choice questions is marked at once; show how it went.
      if (body?.evaluation_id) await showResult()
      // F125: best-effort reward -- a missing/failed sound (autoplay policy, no Web Audio) never
      // blocks or delays the result above, which is why this runs after, not gating, showResult().
      if (body?.points_earned && body.points_earned.points > 0) {
        setPointsEarned(body.points_earned)
        playCoinSound()
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }
  if (loadError) {
    return <div className="p-8 text-body text-destructive">{loadError}</div>
  }
  if (!data) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }
  if (data.attempt.status !== 'in_progress' || submitted) {
    if (result?.evaluated) {
      return (
        <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-8">
          <h1 className="text-h1">Well done, {data.student.name}</h1>
          <p className="text-body">
            You scored {result.score} out of {result.total_marks} ({Math.round(result.percentage)}%).
          </p>
          {pointsEarned && pointsEarned.points > 0 && (
            <div
              className="coin-reward bg-primary/5 border-primary/20 flex items-center gap-3 rounded-md border p-3"
              role="status"
            >
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-primary shrink-0"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5M12 16h.01" />
              </svg>
              <p className="text-body">
                <span className="font-semibold">
                  +{pointsEarned.points} points, +{pointsEarned.coins} coins!
                </span>{' '}
                <span className="text-muted-foreground">
                  See where you stand on the{' '}
                  <a href="/leaderboard" className="text-primary underline-offset-4 hover:underline">
                    leaderboard
                  </a>
                  .
                </span>
              </p>
            </div>
          )}
          {/* Her own paper back, with her own answers marked, plus the correct answer next to
              them (T09 amendment, 2026-09-22 -- GET /api/attempts/:id/result documents why).
              data.questions still holds the text/options/her saved answer from the earlier
              GET /api/attempts/:id fetch -- merged here by paper_question_id, not re-fetched. */}
          <div className="space-y-3">
            <h2 className="text-h3">Your answers</h2>
            {data.questions.map((q) => {
              const scored = result.questions.find(
                (r) => r.paper_question_id === q.paper_question_id,
              )
              const correct =
                scored != null && scored.marks_max > 0
                  ? scored.marks_awarded >= scored.marks_max
                  : null
              // `answers` (local state) is what she actually submitted: it starts seeded from
              // q.saved_answer on page load (see the initial GET effect above) and is then kept
              // live as she answers/changes her mind during the exam. q.saved_answer itself is
              // never refetched after that initial load, so on a paper answered and reviewed in
              // one sitting it is a snapshot from BEFORE she started -- typically blank -- even
              // though she went on to answer and score correctly. Falling back to q.saved_answer
              // only matters when this screen is opened fresh in a later session, where `answers`
              // was just re-seeded from the (by then accurate) saved_answer anyway.
              const savedSelected =
                answers[q.paper_question_id]?.selected_option ??
                q.saved_answer?.selected_option
              const savedText =
                answers[q.paper_question_id]?.response_text ??
                q.saved_answer?.response_text
              const yourAnswer =
                // Same rule as the answering screen above: option-bearing types show the option
                // she picked, everything else shows what she wrote.
                q.options.length > 0
                  ? savedSelected
                    ? `${savedSelected}. ${
                        q.options.find((o) => o.label === savedSelected)
                          ?.text ?? ''
                      }`
                    : '(blank)'
                  : savedText || '(blank)'
              return (
                <Card key={q.paper_question_id}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <CardTitle className="text-body font-medium">
                        {q.position}. {q.text}
                      </CardTitle>
                      {scored && (
                        <span
                          className={
                            correct
                              ? 'text-small shrink-0 font-medium text-emerald-600 dark:text-emerald-400'
                              : 'text-small text-destructive shrink-0 font-medium'
                          }
                        >
                          {correct ? '✓' : '✗'} {scored.marks_awarded}/
                          {scored.marks_max}
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-small text-muted-foreground">
                        Your answer
                      </p>
                      <p className="text-body whitespace-pre-wrap">
                        {yourAnswer}
                      </p>
                    </div>
                    {scored?.correct_answer && (
                      <div>
                        <p className="text-small text-muted-foreground">
                          Correct answer
                        </p>
                        <p className="text-body whitespace-pre-wrap">
                          {scored.correct_answer}
                        </p>
                      </div>
                    )}
                    {scored?.feedback && (
                      <div className="bg-muted rounded-md p-3">
                        <p className="text-small text-muted-foreground">
                          What to fix
                          {scored.error_type ? ` · ${scored.error_type}` : ''}
                        </p>
                        <p className="text-body">{scored.feedback}</p>
                      </div>
                    )}

                    {(() => {
                      const shown =
                        explanations[q.paper_question_id] ??
                        scored?.explanation ??
                        null
                      const failed = explainError[q.paper_question_id]
                      if (shown) {
                        return (
                          <div className="bg-primary/5 border-primary/20 rounded-md border p-3">
                            <p className="text-small text-muted-foreground mb-1">
                              How to do it
                            </p>
                            <p className="text-body whitespace-pre-wrap">
                              {shown}
                            </p>
                          </div>
                        )
                      }
                      return (
                        <div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={explaining === q.paper_question_id}
                            onClick={() => void explain(q.paper_question_id)}
                          >
                            {explaining === q.paper_question_id
                              ? 'Working it out…'
                              : 'Explain this'}
                          </Button>
                          {failed && (
                            <p
                              className="text-small text-destructive mt-2"
                              role="alert"
                            >
                              {failed}
                            </p>
                          )}
                        </div>
                      )
                    })()}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex flex-wrap gap-3">
            <a href="/my-paper">
              <Button>Practise again</Button>
            </a>
            <a href="/student">
              <Button variant="outline">Back to my progress</Button>
            </a>
          </div>
        </div>
      )
    }
    return <AnswerReview attemptId={id} onEvaluated={() => void showResult()} />
  }

  const blanks = data.questions.filter(isBlank)
  const sections = [...new Set(data.questions.map((q) => q.section))]

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">{data.paper.title}</h1>
          <p className="text-small text-muted-foreground">
            {data.student.name} · {data.student.class === 0 ? 'Competitive exam' : `Class ${data.student.class}`} ·{' '}
            {data.paper.total_marks} marks
          </p>
          {data.chapters.length > 0 && (
            <p className="text-small text-muted-foreground">
              {data.chapters
                .map((c) => `Ch ${c.chapter_no}: ${c.name}`)
                .join(' · ')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 no-print">
          <span
            className={
              remainingSeconds !== null && remainingSeconds <= 0
                ? 'text-small text-destructive font-medium'
                : 'text-small text-muted-foreground font-medium'
            }
          >
            {remainingSeconds !== null && remainingSeconds <= 0
              ? "Time's up"
              : formatClock(remainingSeconds ?? 0)}
          </span>
          <ThemeToggle />
        </div>
      </div>

      {mode === 'answering' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 no-print">
            {sections.map((s) => (
              <a
                key={s}
                href={`#section-${s}`}
                className="text-small rounded-full border px-3 py-1 hover:bg-accent"
              >
                {s}
              </a>
            ))}
          </div>

          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section}>
                <h2 id={`section-${section}`} className="text-h3 mb-3">
                  {section}
                </h2>
                <div className="space-y-4">
                  {data.questions
                    .filter((q) => q.section === section)
                    .map((q) => (
                      <Card key={q.paper_question_id}>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-4">
                            <CardTitle className="text-body font-medium">
                              {q.position}. {q.text}
                            </CardTitle>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-small text-muted-foreground">
                                {q.marks} mk
                              </span>
                              <Button
                                type="button"
                                variant={
                                  flagged.has(q.paper_question_id)
                                    ? 'default'
                                    : 'outline'
                                }
                                size="sm"
                                onClick={() => toggleFlag(q.paper_question_id)}
                              >
                                {flagged.has(q.paper_question_id)
                                  ? 'Flagged'
                                  : 'Flag'}
                              </Button>
                            </div>
                          </div>
                          {q.hint && (
                            <CardDescription>Hint: {q.hint}</CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          {/* Any objective type that carries options gets the radio list, not
                              just 'mcq': assertion_reason, match and multi_statement are already
                              objective in scoring.ts (compared, never AI-graded) and already
                              render their options in the PDF templates, but this screen used to
                              drop them into the free-text box, so a student saw four options on
                              the printed paper and none on screen. */}
                          {q.options.length > 0 ? (
                            <div className="space-y-2">
                              {q.options.map((opt) => (
                                <label
                                  key={opt.label}
                                  className="text-body flex items-center gap-2"
                                >
                                  <input
                                    type="radio"
                                    name={q.paper_question_id}
                                    checked={
                                      answers[q.paper_question_id]
                                        ?.selected_option === opt.label
                                    }
                                    onChange={() =>
                                      saveAnswer(q.paper_question_id, {
                                        selected_option: opt.label,
                                      })
                                    }
                                  />
                                  {opt.label}. {opt.text}
                                </label>
                              ))}
                            </div>
                          ) : (
                            <WrittenAnswerInput
                              attemptId={id}
                              paperQuestionId={q.paper_question_id}
                              value={
                                answers[q.paper_question_id]?.response_text ??
                                ''
                              }
                              onChange={(text) =>
                                saveAnswer(q.paper_question_id, {
                                  response_text: text,
                                })
                              }
                            />
                          )}
                          {q.concept_name && (
                            <p className="text-small text-muted-foreground mt-3">
                              Concept: {q.concept_name}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </div>
            ))}
          </div>

          <Button className="mt-6" onClick={() => setMode('reviewing')}>
            Review & submit
          </Button>
        </>
      )}

      {mode === 'reviewing' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Review before submitting</CardTitle>
            <CardDescription>
              {blanks.length === 0
                ? 'Every question has an answer.'
                : `${blanks.length} question${blanks.length === 1 ? ' is' : 's are'} still blank.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-6 gap-2">
              {data.questions.map((q) => (
                <div
                  key={q.paper_question_id}
                  className={
                    'text-small flex h-9 items-center justify-center rounded-md border ' +
                    (isBlank(q)
                      ? 'border-destructive text-destructive'
                      : flagged.has(q.paper_question_id)
                        ? 'border-primary text-primary'
                        : 'text-muted-foreground')
                  }
                  title={
                    isBlank(q)
                      ? 'Blank'
                      : flagged.has(q.paper_question_id)
                        ? 'Flagged'
                        : 'Answered'
                  }
                >
                  {q.position}
                </div>
              ))}
            </div>
            {submitError && (
              <p className="text-small text-destructive" role="alert">
                {submitError}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setMode('answering')}
                disabled={submitting}
              >
                Back to answers
              </Button>
              <Button
                onClick={() => doSubmit(blanks.length > 0)}
                disabled={submitting}
              >
                {submitting
                  ? 'Submitting…'
                  : blanks.length > 0
                    ? 'Submit anyway'
                    : 'Submit'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

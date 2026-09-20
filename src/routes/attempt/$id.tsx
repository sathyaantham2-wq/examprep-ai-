import { useEffect, useMemo, useRef, useState } from 'react'
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
import { useSession } from '../../lib/auth-client'

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
      const body = (await response.json().catch(() => null)) as { evaluation_id?: string | null } | null
      setSubmitted(true)
      // A paper made only of multiple-choice questions is marked at once; show how it went.
      if (body?.evaluation_id) {
        const marked = await fetch(`/api/attempts/${id}/result`)
        if (marked.ok) setResult(await marked.json())
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
          <div className="space-y-2">
            {result.concepts.map((c) => (
              <div key={c.concept_id} className="text-body rounded-md border p-3">
                <p className="font-medium">{c.concept_name}</p>
                <p className="text-small text-muted-foreground">
                  {c.marks} of {c.marks_max} marks on {c.questions} question{c.questions === 1 ? '' : 's'}
                  {c.mastery_level ? ` · now ${c.mastery_level}` : ''}
                  {c.previous_level && c.mastery_level && c.previous_level !== c.mastery_level
                    ? ` (was ${c.previous_level})`
                    : ''}
                </p>
              </div>
            ))}
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
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-h1 mb-2">
          {submitted ? 'Submitted' : 'Already closed'}
        </h1>
        <p className="text-body text-muted-foreground">
          {submitted
            ? 'Your answers have been recorded. Your parent will review and confirm the marks.'
            : 'This attempt is no longer in progress.'}
        </p>
        <a href="/student" className="text-small text-primary mt-4 inline-block underline-offset-4 hover:underline">
          Back to my progress
        </a>
      </div>
    )
  }

  const blanks = data.questions.filter(isBlank)
  const sections = [...new Set(data.questions.map((q) => q.section))]

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">{data.paper.title}</h1>
          <p className="text-small text-muted-foreground">
            {data.student.name} · Class {data.student.class} ·{' '}
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
                          {q.type === 'mcq' && q.options.length > 0 ? (
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
                            <textarea
                              className="border-input min-h-24 w-full rounded-md border bg-transparent p-2 text-sm shadow-xs"
                              value={
                                answers[q.paper_question_id]?.response_text ??
                                ''
                              }
                              onChange={(e) =>
                                saveAnswer(q.paper_question_id, {
                                  response_text: e.target.value,
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

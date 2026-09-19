import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'
import { ThemeToggle } from '../components/theme-toggle'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/remediation')({
  component: RemediationHub,
})

interface ConceptTaskSummary {
  id: string
  concept_name: string
  status: 'pending' | 'in_progress' | 'completed'
  created_at: string
  trigger_reason: string
}

interface HabitDrillTaskSummary {
  id: string
  habit_code: string
  habit_name: string
  drill_kind: 'mark_to_point' | 'three_check_ar' | 'blank_sweep'
  status: 'pending' | 'completed'
  passed: boolean | null
  created_at: string
}

// F070: the two open-drill kinds share one hub screen (tab06 /remediation "Both: Open drills"),
// tagged client-side after fetching each list separately -- the backend never merges them into one
// endpoint, since a concept remediation task and a habit micro-drill are different tables with
// different shapes (src/lib/remediation.ts vs src/lib/habit-drills.ts).
type ListItem =
  | { kind: 'concept'; task: ConceptTaskSummary }
  | { kind: 'habit'; task: HabitDrillTaskSummary }

interface WorkedExample {
  problem: string
  steps: Array<string>
}

interface DrillQuestion {
  id: string
  text: string
  type: string
  marks?: number
  options: Array<{ label: string; text: string }>
}

interface ConceptTaskDetail {
  id: string
  status: string
  refresher: string | null
  examples: Array<WorkedExample>
  questions: Array<DrillQuestion>
  drill_kind: 'concept_refresher' | 'reading_discipline'
  video_url: string | null
  video_title: string | null
}

interface HabitDrillDetail {
  id: string
  status: string
  passed: boolean | null
  instructions: string
  questions: Array<DrillQuestion>
  drill_kind: 'mark_to_point' | 'three_check_ar' | 'blank_sweep'
}

// F060: a reading-discipline drill isn't a re-teach, so it shouldn't be labelled "Refresher" --
// this reads the trigger_reason the backend already persists (see remediation.ts's
// READING_DISCIPLINE_TRIGGER_REASON) rather than needing its own field on the list endpoint.
const READING_DISCIPLINE_TRIGGER_REASON = 'Reading discipline pattern'

interface ConceptAttemptResult {
  percentage: number
  priority_cleared: boolean
}

interface HabitDrillAttemptResult {
  ok: true
  passed: boolean
}

/**
 * F066-F068, F070 (tab06 /remediation, "Both" roles): open drills, refresher + solved examples +
 * 3 practice questions, attempt now -- extended here to also list and let a student attempt habit
 * micro-drills (F070) alongside concept remediation tasks (F066-F068) in the same hub. A parent
 * currently triggers either kind via its own POST .../generate endpoint directly (no button here
 * yet); this screen is where the student actually works through one.
 */
function RemediationHub() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [items, setItems] = useState<Array<ListItem> | null>(null)
  const [selected, setSelected] = useState<
    { kind: 'concept'; id: string } | { kind: 'habit'; id: string } | null
  >(null)
  const [conceptDetail, setConceptDetail] = useState<ConceptTaskDetail | null>(
    null,
  )
  const [habitDetail, setHabitDetail] = useState<HabitDrillDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [conceptResult, setConceptResult] =
    useState<ConceptAttemptResult | null>(null)
  const [habitResult, setHabitResult] = useState<HabitDrillAttemptResult | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  function refreshLists() {
    Promise.all([
      fetch('/api/remediation').then((r) => r.json()),
      fetch('/api/habit-drills').then((r) => r.json()),
    ]).then(
      ([conceptData, habitData]: [
        { tasks: Array<ConceptTaskSummary> },
        { tasks: Array<HabitDrillTaskSummary> },
      ]) => {
        setItems([
          ...conceptData.tasks.map((task): ListItem => ({ kind: 'concept', task })),
          ...habitData.tasks.map((task): ListItem => ({ kind: 'habit', task })),
        ])
      },
    )
  }

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    refreshLists()
  }, [isPending, session, role, navigate])

  function openConceptTask(id: string) {
    setSelected({ kind: 'concept', id })
    setConceptDetail(null)
    setHabitDetail(null)
    setAnswers({})
    setConceptResult(null)
    setHabitResult(null)
    setError(null)
    fetch(`/api/remediation/${id}`)
      .then((r) => r.json())
      .then(setConceptDetail)
  }

  function openHabitTask(id: string) {
    setSelected({ kind: 'habit', id })
    setConceptDetail(null)
    setHabitDetail(null)
    setAnswers({})
    setConceptResult(null)
    setHabitResult(null)
    setError(null)
    fetch(`/api/habit-drills/${id}`)
      .then((r) => r.json())
      .then(setHabitDetail)
  }

  async function submitConceptAttempt() {
    if (!conceptDetail) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/remediation/${conceptDetail.id}/attempt`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            answers: conceptDetail.questions.map((q) => ({
              question_id: q.id,
              selected_option: answers[q.id],
            })),
          }),
        },
      )
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not score this drill.')
        return
      }
      setConceptResult(body)
      refreshLists()
    } finally {
      setSubmitting(false)
    }
  }

  async function submitHabitAttempt() {
    if (!habitDetail) return
    setSubmitting(true)
    setError(null)
    try {
      const isTextResponse = habitDetail.drill_kind === 'mark_to_point'
      const response = await fetch(`/api/habit-drills/${habitDetail.id}/attempt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: habitDetail.questions.map((q) =>
            isTextResponse
              ? { question_id: q.id, response_text: answers[q.id] }
              : { question_id: q.id, selected_option: answers[q.id] },
          ),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not score this drill.')
        return
      }
      setHabitResult(body)
      refreshLists()
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Practice drills</h1>
          <p className="text-body text-muted-foreground">
            A quick refresher and three questions for the concepts and habits
            that need it most.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {!selected && (
        <div className="space-y-3">
          {items !== null && items.length === 0 && (
            <Card>
              <CardContent className="pt-6">
                <p className="text-body text-muted-foreground">
                  No drills right now — nothing is flagged as needing extra
                  practice.
                </p>
              </CardContent>
            </Card>
          )}
          {items?.map((item) =>
            item.kind === 'concept' ? (
              <Card key={`concept-${item.task.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-h3">
                      {item.task.concept_name}
                    </CardTitle>
                    <span className="text-small text-muted-foreground">
                      {item.task.status === 'completed' ? 'Done' : 'Open'}
                    </span>
                  </div>
                  {item.task.trigger_reason ===
                    READING_DISCIPLINE_TRIGGER_REASON && (
                    <CardDescription>
                      Careful-reading practice — not a concept re-teach
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <Button
                    variant={item.task.status === 'completed' ? 'outline' : 'default'}
                    onClick={() => openConceptTask(item.task.id)}
                  >
                    {item.task.status === 'completed' ? 'Review' : 'Attempt now'}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card key={`habit-${item.task.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-h3">
                      {item.task.habit_name}
                    </CardTitle>
                    <span className="text-small text-muted-foreground">
                      {item.task.status === 'completed'
                        ? item.task.passed
                          ? 'Passed'
                          : 'Not yet'
                        : 'Open'}
                    </span>
                  </div>
                  <CardDescription>Habit micro-drill</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant={item.task.status === 'completed' ? 'outline' : 'default'}
                    onClick={() => openHabitTask(item.task.id)}
                  >
                    {item.task.status === 'completed' ? 'Review' : 'Attempt now'}
                  </Button>
                </CardContent>
              </Card>
            ),
          )}
        </div>
      )}

      {selected && !conceptDetail && !habitDetail && (
        <p className="text-body text-muted-foreground">Loading…</p>
      )}

      {selected?.kind === 'concept' && conceptDetail && (
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => setSelected(null)}>
            ← Back to drills
          </Button>

          {conceptDetail.refresher && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">
                  {conceptDetail.drill_kind === 'reading_discipline'
                    ? 'Why this drill'
                    : 'Refresher'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-body">{conceptDetail.refresher}</p>
                {conceptDetail.video_url && (
                  <a
                    href={conceptDetail.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-small text-primary inline-block underline-offset-4 hover:underline"
                  >
                    Watch: {conceptDetail.video_title ?? 'concept video'}
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {conceptDetail.examples.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Worked examples</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {conceptDetail.examples.map((ex, i) => (
                  <div key={i}>
                    <p className="text-body font-medium">{ex.problem}</p>
                    <ol className="text-small text-muted-foreground list-inside list-decimal">
                      {ex.steps.map((step, j) => (
                        <li key={j}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Practice questions</CardTitle>
              <CardDescription>
                {conceptResult
                  ? `Scored ${conceptResult.percentage}% — ${
                      conceptResult.priority_cleared
                        ? 'this concept is no longer flagged as urgent.'
                        : 'keep practicing — one more good attempt clears the flag.'
                    }`
                  : 'Answer all three, then submit.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {conceptDetail.questions.map((q, i) => (
                <div key={q.id} className="space-y-1.5">
                  <p className="text-body font-medium">
                    {i + 1}. {q.text}
                  </p>
                  {q.options.map((o) => (
                    <label
                      key={o.label}
                      className="text-small flex items-center gap-2"
                    >
                      <input
                        type="radio"
                        name={q.id}
                        disabled={Boolean(conceptResult)}
                        checked={answers[q.id] === o.label}
                        onChange={() =>
                          setAnswers((prev) => ({ ...prev, [q.id]: o.label }))
                        }
                      />
                      {o.label}. {o.text}
                    </label>
                  ))}
                </div>
              ))}

              {error && (
                <p className="text-small text-destructive" role="alert">
                  {error}
                </p>
              )}

              {!conceptResult && (
                <Button
                  onClick={submitConceptAttempt}
                  disabled={
                    submitting ||
                    conceptDetail.questions.some((q) => !answers[q.id])
                  }
                >
                  {submitting ? 'Scoring…' : 'Submit'}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {selected?.kind === 'habit' && habitDetail && (
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => setSelected(null)}>
            ← Back to drills
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-h3">How to do this drill</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-body">{habitDetail.instructions}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Questions</CardTitle>
              <CardDescription>
                {habitResult
                  ? habitResult.passed
                    ? 'Passed — nice work.'
                    : 'Not quite — try the next one that comes up.'
                  : 'Answer all of them, then submit.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {habitDetail.questions.map((q, i) => (
                <div key={q.id} className="space-y-1.5">
                  <p className="text-body font-medium">
                    {i + 1}. {q.text}
                  </p>
                  {habitDetail.drill_kind === 'mark_to_point' ? (
                    <Textarea
                      disabled={Boolean(habitResult)}
                      value={answers[q.id] ?? ''}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      placeholder="Write your working here"
                    />
                  ) : (
                    q.options.map((o) => (
                      <label
                        key={o.label}
                        className="text-small flex items-center gap-2"
                      >
                        <input
                          type="radio"
                          name={q.id}
                          disabled={Boolean(habitResult)}
                          checked={answers[q.id] === o.label}
                          onChange={() =>
                            setAnswers((prev) => ({ ...prev, [q.id]: o.label }))
                          }
                        />
                        {o.label}. {o.text}
                      </label>
                    ))
                  )}
                </div>
              ))}

              {error && (
                <p className="text-small text-destructive" role="alert">
                  {error}
                </p>
              )}

              {!habitResult && (
                <Button
                  onClick={submitHabitAttempt}
                  disabled={
                    submitting ||
                    habitDetail.questions.some((q) => !answers[q.id])
                  }
                >
                  {submitting ? 'Scoring…' : 'Submit'}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

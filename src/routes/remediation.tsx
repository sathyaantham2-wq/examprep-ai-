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
import { ThemeToggle } from '../components/theme-toggle'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/remediation')({
  component: RemediationHub,
})

interface TaskSummary {
  id: string
  concept_name: string
  status: 'pending' | 'in_progress' | 'completed'
  created_at: string
  trigger_reason: string
}

interface WorkedExample {
  problem: string
  steps: Array<string>
}

interface DrillQuestion {
  id: string
  text: string
  type: string
  marks: number
  options: Array<{ label: string; text: string }>
}

interface TaskDetail {
  id: string
  status: string
  refresher: string | null
  examples: Array<WorkedExample>
  questions: Array<DrillQuestion>
  drill_kind: 'concept_refresher' | 'reading_discipline'
}

// F060: a reading-discipline drill isn't a re-teach, so it shouldn't be labelled "Refresher" --
// this reads the trigger_reason the backend already persists (see remediation.ts's
// READING_DISCIPLINE_TRIGGER_REASON) rather than needing its own field on the list endpoint.
const READING_DISCIPLINE_TRIGGER_REASON = 'Reading discipline pattern'

interface AttemptResult {
  percentage: number
  priority_cleared: boolean
}

/**
 * F066-F068 (tab06 /remediation, "Both" roles): open drills, refresher + solved examples + 3
 * practice questions, attempt now. Built for the student side of the loop -- a parent currently
 * triggers a new pack via POST /api/remediation/generate directly (no button here yet); this
 * screen is where the student actually works through one.
 */
function RemediationHub() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [tasks, setTasks] = useState<Array<TaskSummary> | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/remediation')
      .then((r) => r.json())
      .then((data: { tasks: Array<TaskSummary> }) => setTasks(data.tasks))
  }, [isPending, session, role, navigate])

  function openTask(id: string) {
    setSelectedId(id)
    setDetail(null)
    setAnswers({})
    setResult(null)
    setError(null)
    fetch(`/api/remediation/${id}`)
      .then((r) => r.json())
      .then(setDetail)
  }

  async function submitAttempt() {
    if (!detail) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch(`/api/remediation/${detail.id}/attempt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: detail.questions.map((q) => ({
            question_id: q.id,
            selected_option: answers[q.id],
          })),
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not score this drill.')
        return
      }
      setResult(body)
      fetch('/api/remediation')
        .then((r) => r.json())
        .then((data: { tasks: Array<TaskSummary> }) => setTasks(data.tasks))
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
            A quick refresher and three questions for the concepts that need it
            most.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {!selectedId && (
        <div className="space-y-3">
          {tasks !== null && tasks.length === 0 && (
            <Card>
              <CardContent className="pt-6">
                <p className="text-body text-muted-foreground">
                  No drills right now — nothing is flagged as needing extra
                  practice.
                </p>
              </CardContent>
            </Card>
          )}
          {tasks?.map((t) => (
            <Card key={t.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-h3">{t.concept_name}</CardTitle>
                  <span className="text-small text-muted-foreground">
                    {t.status === 'completed' ? 'Done' : 'Open'}
                  </span>
                </div>
                {t.trigger_reason === READING_DISCIPLINE_TRIGGER_REASON && (
                  <CardDescription>
                    Careful-reading practice — not a concept re-teach
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <Button
                  variant={t.status === 'completed' ? 'outline' : 'default'}
                  onClick={() => openTask(t.id)}
                >
                  {t.status === 'completed' ? 'Review' : 'Attempt now'}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedId && !detail && (
        <p className="text-body text-muted-foreground">Loading…</p>
      )}

      {selectedId && detail && (
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => setSelectedId(null)}>
            ← Back to drills
          </Button>

          {detail.refresher && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">
                  {detail.drill_kind === 'reading_discipline'
                    ? 'Why this drill'
                    : 'Refresher'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body">{detail.refresher}</p>
              </CardContent>
            </Card>
          )}

          {detail.examples.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Worked examples</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {detail.examples.map((ex, i) => (
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
                {result
                  ? `Scored ${result.percentage}% — ${
                      result.priority_cleared
                        ? 'this concept is no longer flagged as urgent.'
                        : 'keep practicing — one more good attempt clears the flag.'
                    }`
                  : 'Answer all three, then submit.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.questions.map((q, i) => (
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
                        disabled={Boolean(result)}
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

              {!result && (
                <Button
                  onClick={submitAttempt}
                  disabled={
                    submitting || detail.questions.some((q) => !answers[q.id])
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

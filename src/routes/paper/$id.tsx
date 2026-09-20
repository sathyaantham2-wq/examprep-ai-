import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/paper/$id')({ component: PaperWorkflow })

interface Option {
  question_id: string
  label: string
  text: string
  is_correct: boolean
  order_index: number
}

interface PaperQuestion {
  id: string
  section: string
  position: number
  marks: number
  type: string
  bloom: string
  text: string
  answer: string
  options: Array<Option>
}

interface AttemptRow {
  id: string
  mode: string
  status: 'in_progress' | 'submitted' | 'evaluated'
  started_at: string
  submitted_at: string | null
  evaluation_id: string | null
  confirmed_at: string | null
  percentage: string | null
  actual_score: string | null
  total_marks: string | null
}

interface WorkflowData {
  paper: {
    id: string
    title: string
    total_marks: number
    duration_min: number
  }
  student: { id: string; name: string } | null
  chapters: Array<{ id: string; part: string; chapter_no: number; name: string }>
  questions: Array<PaperQuestion>
  attempts: Array<AttemptRow>
}

type StepState = 'done' | 'current' | 'waiting'

function StepBadge({ state, n }: { state: StepState; n: number }) {
  const cls =
    state === 'done'
      ? 'bg-primary text-primary-foreground'
      : state === 'current'
        ? 'border-primary text-primary border-2'
        : 'text-muted-foreground border'
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium ${cls}`}
    >
      {state === 'done' ? '✓' : n}
    </span>
  )
}

function PaperWorkflow() {
  const { id } = Route.useParams()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role
  const [data, setData] = useState<WorkflowData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/papers/${id}/workflow`)
    if (!response.ok) {
      setError(
        response.status === 404
          ? 'This paper was not found.'
          : 'Could not load the paper.',
      )
      return
    }
    setData(await response.json())
  }, [id])

  useEffect(() => {
    if (isPending) return
    if (!session || (role !== 'parent' && role !== 'teacher' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    void load()
    // The student works on her own device, so poll to notice when she submits.
    const timer = setInterval(() => void load(), 10000)
    return () => clearInterval(timer)
  }, [isPending, session, role, navigate, load])

  if (isPending || !session || (role !== 'parent' && role !== 'teacher' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }
  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <p className="text-body text-destructive" role="alert">
          {error}
        </p>
        <a href="/generate" className="text-primary underline">
          Back to generate a paper
        </a>
      </div>
    )
  }
  if (!data) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const name = data.student?.name ?? 'The student'
  const latest = data.attempts.at(0) ?? null
  const submitted = latest !== null && latest.status !== 'in_progress'
  const confirmed = latest?.confirmed_at != null
  const started = latest !== null

  const states: Array<StepState> = [
    'done',
    submitted ? 'done' : 'current',
    submitted ? 'done' : 'waiting',
    confirmed ? 'done' : submitted ? 'current' : 'waiting',
    confirmed ? 'done' : 'waiting',
    confirmed ? 'current' : 'waiting',
  ]

  const sections: Array<{ name: string; items: Array<PaperQuestion> }> = []
  for (const q of data.questions) {
    let s = sections.find((x) => x.name === q.section)
    if (!s) {
      s = { name: q.section, items: [] }
      sections.push(s)
    }
    s.items.push(q)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-h1">{data.paper.title}</h1>
        <p className="text-body text-muted-foreground">
          {data.paper.total_marks} marks · {data.paper.duration_min} minutes ·{' '}
          {data.chapters
            .map((c) => `${c.part} Ch ${c.chapter_no}`)
            .join(', ')}{' '}
          · for {name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">What happens next</CardTitle>
          <CardDescription>
            Each step lights up as it happens. This page refreshes by itself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <li className="flex gap-3">
              <StepBadge state={states[0]} n={1} />
              <div>
                <p className="font-medium">Paper created</p>
                <p className="text-small text-muted-foreground">
                  The questions are listed below.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <StepBadge state={states[1]} n={2} />
              <div className="space-y-1">
                <p className="font-medium">
                  {name} attempts the paper
                  {started && !submitted ? ' (in progress)' : ''}
                  {submitted ? ' (finished)' : ''}
                </p>
                {!submitted && (
                  <p className="text-small text-muted-foreground">
                    Online: {name} signs in, opens "Papers to attempt" and starts
                    this paper. On paper: print it, and she writes her answers.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <a
                    href={`/api/papers/${data.paper.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button type="button" size="sm" variant="outline">
                      Download PDF
                    </Button>
                  </a>
                  <a href="/student">
                    <Button type="button" size="sm" variant="outline">
                      Open student home
                    </Button>
                  </a>
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <StepBadge state={states[2]} n={3} />
              <div>
                <p className="font-medium">She submits her answers</p>
                <p className="text-small text-muted-foreground">
                  {submitted
                    ? `Submitted${latest.submitted_at ? ` on ${new Date(latest.submitted_at).toLocaleString()}` : ''}.`
                    : 'Waiting for the submission.'}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <StepBadge state={states[3]} n={4} />
              <div className="space-y-1">
                <p className="font-medium">You review and confirm the marks</p>
                <p className="text-small text-muted-foreground">
                  The system proposes marks step by step. Nothing counts until you
                  confirm.
                </p>
                {submitted && role === 'teacher' && (
                  <p className="text-small text-muted-foreground">
                    Only a parent can confirm the marks. You can follow the
                    result here once they do.
                  </p>
                )}
                {submitted && role !== 'teacher' && (
                  <a href={`/evaluate/${latest.id}`}>
                    <Button type="button" size="sm">
                      {confirmed ? 'Open the review' : 'Review and evaluate'}
                    </Button>
                  </a>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <StepBadge state={states[4]} n={5} />
              <div className="space-y-1">
                <p className="font-medium">Report: knowledge gaps and habits</p>
                {confirmed && latest.evaluation_id ? (
                  <>
                    <p className="text-small text-muted-foreground">
                      Score {latest.actual_score} of {latest.total_marks} (
                      {latest.percentage}%).
                    </p>
                    <a href={`/evaluation/${latest.evaluation_id}/report`}>
                      <Button type="button" size="sm">
                        Open the report
                      </Button>
                    </a>
                  </>
                ) : (
                  <p className="text-small text-muted-foreground">
                    Ready after you confirm the marks.
                  </p>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <StepBadge state={states[5]} n={6} />
              <div className="space-y-1">
                <p className="font-medium">Dashboard and concept tracker update</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href="/home">
                    <Button type="button" size="sm" variant="outline">
                      Parent dashboard
                    </Button>
                  </a>
                  {data.student && (
                    <a href={`/tracker/${data.student.id}`}>
                      <Button type="button" size="sm" variant="outline">
                        Concept tracker
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-h3">Questions</CardTitle>
              <CardDescription>
                {data.questions.length} questions. This view is for you only, the
                answer key is never shown to {name}.
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? 'Hide answer key' : 'Show answer key'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {sections.map((s) => (
            <div key={s.name} className="space-y-3">
              <h2 className="text-h4 font-medium">{s.name}</h2>
              {s.items.map((q) => (
                <div key={q.id} className="rounded-md border p-3">
                  <p className="text-body">
                    <span className="font-medium">Q{q.position}.</span> {q.text}{' '}
                    <span className="text-small text-muted-foreground">
                      [{q.marks} {q.marks === 1 ? 'mark' : 'marks'}]
                    </span>
                  </p>
                  {q.options.length > 0 && (
                    <ul className="text-small mt-2 space-y-1">
                      {q.options.map((o) => (
                        <li key={o.label}>
                          {o.label}. {o.text}
                          {showKey && o.is_correct ? '  ✓' : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {showKey && q.options.length === 0 && (
                    <p className="text-small text-muted-foreground mt-2">
                      Answer: {q.answer}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

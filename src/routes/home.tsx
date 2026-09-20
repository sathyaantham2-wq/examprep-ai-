import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { ThemeToggle } from '../components/theme-toggle'
import { LineChart } from '../components/charts/line-chart'
import { StatusDistributionBar } from '../components/charts/status-distribution-bar'
import { useSession } from '../lib/auth-client'
import { STATUS } from '../components/charts/palette'

export const Route = createFileRoute('/home')({ component: ParentDashboard })

interface Student {
  id: string
  name: string
  class: number
  board: string
}

interface PriorityConcept {
  concept_id: string
  concept_name: string
  status: string
}

interface ScorePoint {
  date: string
  percentage: number
  delivery_gap: number
}

interface SubjectCard {
  subject_id: string
  subject_name: string
  latest_score: { percentage: number; delivery_gap: number } | null
  trend: 'up' | 'down' | 'flat' | null
  priority_concepts: Array<PriorityConcept>
  next_action: string
  pending_uploads: Array<unknown>
  score_history: Array<ScorePoint>
}

interface PatternFrequency {
  pattern_id: string
  pattern_code: string
  pattern_name: string
  count: number
}

interface LastPaperEvaluated {
  paper_title: string
  percentage: number
  confirmed_at: string
}

interface PendingItem {
  kind: 'remediation' | 'habit_drill'
  id: string
  label: string
}

interface SessionRecap {
  last_session_date: string | null
  last_paper_evaluated: LastPaperEvaluated | null
  current_priority_concepts: Array<{
    concept_id: string
    concept_name: string
    subject_name: string
  }>
  pending_items: Array<PendingItem>
}

interface NeedsEvaluation {
  attempt_id: string
  paper_title: string
  submitted_at: string
}

interface Dashboard {
  subjects: Array<SubjectCard>
  concept_status_distribution: Record<string, number>
  pattern_frequency: Array<PatternFrequency>
  recap: SessionRecap
  needs_evaluation: Array<NeedsEvaluation>
}

interface DailyNudge {
  id: string
  action_text: string
  status: 'pending' | 'done' | 'skipped'
}

interface HabitTrendRow {
  habit_id: string
  habit_code: string
  habit_name: string
  observations: Array<{
    rating: 'present' | 'partial' | 'absent'
    confirmed_at: string
  }>
}

const HABIT_RATING_COLOR: Record<string, string> = {
  present: STATUS.good,
  partial: STATUS.warning,
  absent: STATUS.critical,
}
const HABIT_RATING_LETTER: Record<string, string> = {
  present: 'P',
  partial: '~',
  absent: 'A',
}

const TREND_ARROW: Record<string, string> = { up: '↑', down: '↓', flat: '→' }
const TREND_LABEL: Record<string, string> = {
  up: 'Improving',
  down: 'Slipping',
  flat: 'Steady',
}

/**
 * F071 (tab06 /home): the screen half of the parent dashboard -- GET /api/dashboard/:studentId
 * (F071's data half) already existed with no UI consuming it. Renders subject cards exactly per
 * the AC: latest score + Delivery Gap, a trend arrow, the top 3 priority/weak concepts, a single
 * next action sentence, and pending uploads (always empty until F050 lands).
 */
function ParentDashboard() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [students, setStudents] = useState<Array<Student> | null>(null)
  const [studentId, setStudentId] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loadingDashboard, setLoadingDashboard] = useState(false)
  const [habitTrend, setHabitTrend] = useState<Array<HabitTrendRow>>([])
  const [nudge, setNudge] = useState<DailyNudge | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || (role !== 'parent' && role !== 'teacher' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students')
      .then((r) => r.json())
      .then((data: Array<Student>) => {
        setStudents(data)
        if (data.length > 0) setStudentId(data[0].id)
      })
  }, [isPending, session, role, navigate])

  useEffect(() => {
    if (!studentId) {
      setDashboard(null)
      return
    }
    setLoadingDashboard(true)
    fetch(`/api/dashboard/${studentId}`)
      .then((r) => r.json())
      .then(setDashboard)
      .finally(() => setLoadingDashboard(false))
  }, [studentId])

  useEffect(() => {
    if (!studentId) {
      setHabitTrend([])
      return
    }
    fetch(`/api/students/${studentId}/habits/trend`)
      .then((r) => r.json())
      .then(setHabitTrend)
  }, [studentId])

  useEffect(() => {
    if (!studentId) {
      setNudge(null)
      return
    }
    fetch(`/api/nudges/today?student_id=${studentId}`)
      .then((r) => r.json())
      .then((body: { nudge: DailyNudge }) => setNudge(body.nudge))
  }, [studentId])

  async function markNudge(status: 'done' | 'skipped') {
    if (!nudge) return
    const response = await fetch(`/api/nudges/${nudge.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ student_id: studentId, status }),
    })
    if (response.ok) {
      const body = await response.json()
      setNudge(body.nudge)
    }
  }

  if (isPending || !session || (role !== 'parent' && role !== 'teacher' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Dashboard</h1>
          <p className="text-body text-muted-foreground">
            Where the marks are going, subject by subject.
          </p>
        </div>
        <div className="no-print flex items-center gap-4">
          {studentId && (
            <a
              href={`/tracker/${studentId}`}
              className="text-small text-primary underline-offset-4 hover:underline"
            >
              Concept tracker
            </a>
          )}
          <a
            href="/onboarding"
            className="text-small text-primary underline-offset-4 hover:underline"
          >
            Manage students
          </a>
          <ThemeToggle />
        </div>
      </div>

      {dashboard && dashboard.needs_evaluation.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-h3">Needs evaluation</CardTitle>
            <CardDescription>
              Submitted, waiting on you to confirm marks before it counts
              toward mastery.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dashboard.needs_evaluation.map((e) => (
              <div
                key={e.attempt_id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div>
                  <p className="text-body">{e.paper_title}</p>
                  <p className="text-small text-muted-foreground">
                    Submitted {new Date(e.submitted_at).toLocaleDateString()}
                  </p>
                </div>
                <a href={`/evaluate/${e.attempt_id}`}>
                  <Button size="sm">Evaluate</Button>
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {students !== null && students.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-body text-muted-foreground">
              No students yet.{' '}
              <a
                href="/onboarding"
                className="text-primary underline-offset-4 hover:underline"
              >
                Add one first
              </a>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {students !== null && students.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStudentId(s.id)}
              className={
                'text-small rounded-full border px-3 py-1 ' +
                (s.id === studentId
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input')
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {nudge && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-h3">Today's action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p
              className={
                nudge.status === 'skipped'
                  ? 'text-body text-muted-foreground line-through'
                  : 'text-body'
              }
            >
              {nudge.action_text}
            </p>
            {nudge.status === 'pending' ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => markNudge('done')}
                  className="text-small rounded-md border border-primary bg-primary px-3 py-1.5 text-primary-foreground"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => markNudge('skipped')}
                  className="text-small border-input rounded-md border px-3 py-1.5"
                >
                  Skip
                </button>
              </div>
            ) : (
              <p className="text-small text-muted-foreground">
                Marked {nudge.status} today.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {loadingDashboard && (
        <p className="text-body text-muted-foreground">Loading dashboard…</p>
      )}

      {dashboard && dashboard.subjects.length === 0 && !loadingDashboard && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-body text-muted-foreground">
              No papers generated for this student yet —{' '}
              <a
                href="/generate"
                className="text-primary underline-offset-4 hover:underline"
              >
                generate the first one
              </a>
              .
            </p>
          </CardContent>
        </Card>
      )}

      {dashboard && dashboard.subjects.length > 0 && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Since you last checked in</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-small text-muted-foreground">
                {dashboard.recap.last_session_date
                  ? `Last session: ${dashboard.recap.last_session_date}`
                  : 'No sessions yet.'}
              </p>
              {dashboard.recap.last_paper_evaluated && (
                <p className="text-small text-muted-foreground">
                  Last paper evaluated:{' '}
                  {dashboard.recap.last_paper_evaluated.paper_title} (
                  {dashboard.recap.last_paper_evaluated.percentage}%)
                </p>
              )}
              {dashboard.recap.current_priority_concepts.length > 0 && (
                <div className="text-small">
                  <span className="text-muted-foreground">
                    Priority concepts:{' '}
                  </span>
                  {dashboard.recap.current_priority_concepts
                    .map((c) => `${c.concept_name} (${c.subject_name})`)
                    .join(', ')}
                </div>
              )}
              {dashboard.recap.pending_items.length > 0 && (
                <div className="text-small">
                  <span className="text-muted-foreground">
                    Pending: {dashboard.recap.pending_items.length} open
                    drill{dashboard.recap.pending_items.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {dashboard.subjects.map((subject) => (
            <Card key={subject.subject_id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-h3">
                    {subject.subject_name}
                  </CardTitle>
                  {subject.trend && (
                    <span className="text-small text-muted-foreground">
                      {TREND_ARROW[subject.trend]} {TREND_LABEL[subject.trend]}
                    </span>
                  )}
                </div>
                <CardDescription>
                  {subject.latest_score
                    ? `Latest score ${subject.latest_score.percentage}% — Delivery Gap ${subject.latest_score.delivery_gap}%`
                    : 'No evaluated papers yet for this subject.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {subject.priority_concepts.length > 0 && (
                  <div>
                    <p className="text-small font-medium">
                      Priority &amp; weak concepts
                    </p>
                    <ul className="text-small text-muted-foreground list-inside list-disc">
                      {subject.priority_concepts.map((c) => (
                        <li key={c.concept_id}>
                          {c.concept_name} — {c.status}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-body">{subject.next_action}</p>
                {subject.pending_uploads.length > 0 && (
                  <p className="text-small text-muted-foreground">
                    {subject.pending_uploads.length} upload(s) pending review.
                  </p>
                )}

                {subject.score_history.length > 0 && (
                  <div className="grid gap-4 pt-2">
                    <div>
                      <p className="text-small mb-1 font-medium">
                        Score over time
                      </p>
                      <LineChart
                        series={[
                          {
                            label: subject.subject_name,
                            points: subject.score_history.map((p) => ({
                              x: p.date,
                              y: p.percentage,
                            })),
                          },
                        ]}
                        yFormat={(n) => `${n}%`}
                      />
                    </div>
                    <div>
                      <p className="text-small mb-1 font-medium">
                        Delivery Gap over time
                      </p>
                      <LineChart
                        series={[
                          {
                            label: subject.subject_name,
                            points: subject.score_history.map((p) => ({
                              x: p.date,
                              y: p.delivery_gap,
                            })),
                          },
                        ]}
                        yFormat={(n) => `${n}%`}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle className="text-h3">
                Concept status distribution
              </CardTitle>
              <CardDescription>Across every subject.</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusDistributionBar
                counts={dashboard.concept_status_distribution}
              />
            </CardContent>
          </Card>

          {dashboard.pattern_frequency.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Recurring patterns</CardTitle>
                <CardDescription>
                  Behaviour patterns flagged during review, aggregated across
                  every subject — not just one paper.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {dashboard.pattern_frequency.map((p) => (
                  <div
                    key={p.pattern_id}
                    className="flex items-center justify-between"
                  >
                    <span className="text-small">
                      {p.pattern_code} — {p.pattern_name}
                    </span>
                    <span className="text-small text-muted-foreground">
                      {p.count}×
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {habitTrend.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Presentation habits</CardTitle>
                <CardDescription>
                  Every confirmed paper's rating, oldest to newest. P = present,
                  ~ = partial, A = absent.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {habitTrend.map((h) => {
                  const latest = h.observations[h.observations.length - 1]
                  return (
                    <div
                      key={h.habit_id}
                      className="flex items-center justify-between gap-4"
                    >
                      <span className="text-small">
                        {h.habit_code} — {h.habit_name}
                      </span>
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {h.observations.map((o, i) => (
                            <span
                              key={i}
                              title={`${o.rating} — ${new Date(o.confirmed_at).toLocaleDateString()}`}
                              className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-medium text-white"
                              style={{
                                background: HABIT_RATING_COLOR[o.rating],
                              }}
                            >
                              {HABIT_RATING_LETTER[o.rating]}
                            </span>
                          ))}
                        </div>
                        <span className="text-small text-muted-foreground">
                          latest: {latest.rating}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { AppShell } from '../components/app-shell'
import { LineChart } from '../components/charts/line-chart'
import { StatusDistributionBar } from '../components/charts/status-distribution-bar'
import { useSession } from '../lib/auth-client'
import { STATUS } from '../components/charts/palette'
import { PageLoading, PageSkeleton } from '../components/page-loading'

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

const HABIT_RATING_WORD: Record<string, string> = {
  present: 'Present',
  partial: 'Partly',
  absent: 'Missing',
}

const TREND_ARROW: Record<string, string> = { up: '↑', down: '↓', flat: '→' }
const TREND_COLOR: Record<string, string> = {
  up: STATUS.good,
  down: STATUS.critical,
  flat: 'var(--muted-foreground)',
}

// delivery_gap is knowledge_score minus actual_score (src/lib/evaluation.ts) -- a count of marks,
// not a percentage. This screen used to print it with a "%" suffix.
function formatMarks(n: number) {
  return `${n} mark${n === 1 ? '' : 's'}`
}
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
    if (
      !session ||
      (role !== 'parent' && role !== 'teacher' && role !== 'admin')
    ) {
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

  if (
    isPending ||
    !session ||
    (role !== 'parent' && role !== 'teacher' && role !== 'admin')
  ) {
    return <PageLoading />
  }

  const activeStudent = students?.find((s) => s.id === studentId) ?? null
  const recap = dashboard?.recap

  // Reworked for readability (2026-09-30): the things waiting on the parent come first, then a
  // three-number recap, then subjects with their one next-action sentence up top and the trend
  // charts folded away, and only then the pattern/habit detail. Delivery Gap is explained in
  // plain words once, and shown in marks (what it actually is) instead of a "%".
  return (
    <AppShell active="home" studentId={studentId || undefined}>
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-h1">Dashboard</h1>
            <p className="text-body text-muted-foreground">
              {activeStudent
                ? `${activeStudent.name} · Class ${activeStudent.class} · ${activeStudent.board}`
                : 'Where the marks are going, subject by subject.'}
            </p>
          </div>
          <div className="no-print flex items-center gap-2">
            {/* Concept tracker is the sidebar's Progress link. Manage students has no sidebar
              equivalent yet, so it stays here. */}
            <a href="/onboarding">
              <Button variant="outline" size="sm">
                Manage students
              </Button>
            </a>
            <a href="/generate">
              <Button size="sm">Generate paper</Button>
            </a>
          </div>
        </div>

        {students !== null && students.length > 1 && (
          <div
            className="mb-6 flex flex-wrap gap-2"
            role="group"
            aria-label="Choose student"
          >
            {students.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === studentId}
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

        {students === null && <PageSkeleton />}

        {students !== null && students.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">
                Welcome! Let&apos;s get started
              </CardTitle>
              <CardDescription>
                Add your child first, then generate their first question paper.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a href="/onboarding">
                <Button>Add a student</Button>
              </a>
            </CardContent>
          </Card>
        )}

        {dashboard && dashboard.needs_evaluation.length > 0 && (
          <Card className="border-primary/40 mb-4">
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
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

        {nudge && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-h3">Today&apos;s action</CardTitle>
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
                  <Button size="sm" onClick={() => void markNudge('done')}>
                    Done
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void markNudge('skipped')}
                  >
                    Skip
                  </Button>
                </div>
              ) : (
                <p className="text-small text-muted-foreground">
                  Marked {nudge.status} today.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {loadingDashboard && !dashboard && <PageSkeleton />}

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

        {dashboard && recap && dashboard.subjects.length > 0 && (
          <div className="space-y-4">
            <section>
              <h2 className="text-h3 mb-2">Since you last checked in</h2>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div
                  data-slot="card"
                  className="tile bg-card border-border rounded-2xl border p-4"
                  style={{ '--tile-color': 'var(--g-violet)' } as CSSProperties}
                >
                  <dt className="text-caption text-muted-foreground">
                    Last session
                  </dt>
                  <dd className="text-body mt-1 font-semibold">
                    {recap.last_session_date ?? 'No sessions yet'}
                  </dd>
                </div>
                <div
                  data-slot="card"
                  className="tile bg-card border-border rounded-2xl border p-4"
                  style={{ '--tile-color': 'var(--g-pink)' } as CSSProperties}
                >
                  <dt className="text-caption text-muted-foreground">
                    Last paper evaluated
                  </dt>
                  <dd className="text-body mt-1 font-semibold">
                    {recap.last_paper_evaluated
                      ? `${recap.last_paper_evaluated.percentage}%`
                      : '—'}
                  </dd>
                  {recap.last_paper_evaluated && (
                    <dd className="text-caption text-muted-foreground truncate">
                      {recap.last_paper_evaluated.paper_title}
                    </dd>
                  )}
                </div>
                <div
                  data-slot="card"
                  className="tile bg-card border-border rounded-2xl border p-4"
                  style={{ '--tile-color': 'var(--g-cyan)' } as CSSProperties}
                >
                  <dt className="text-caption text-muted-foreground">
                    Open drills
                  </dt>
                  <dd className="text-body mt-1 font-semibold">
                    {recap.pending_items.length}
                  </dd>
                </div>
              </dl>
              {recap.current_priority_concepts.length > 0 && (
                <p className="text-small mt-3">
                  <span className="text-muted-foreground">
                    Priority concepts:{' '}
                  </span>
                  {recap.current_priority_concepts
                    .map((c) => `${c.concept_name} (${c.subject_name})`)
                    .join(', ')}
                </p>
              )}
            </section>

            <h2 className="text-h3 pt-2">Subjects</h2>
            {dashboard.subjects.map((subject) => (
              <Card key={subject.subject_id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-h3">
                      {subject.subject_name}
                    </CardTitle>
                    {subject.trend && (
                      <span
                        className="text-small shrink-0 font-medium"
                        style={{ color: TREND_COLOR[subject.trend] }}
                      >
                        {TREND_ARROW[subject.trend]}{' '}
                        {TREND_LABEL[subject.trend]}
                      </span>
                    )}
                  </div>
                  <CardDescription>
                    {subject.latest_score
                      ? `Latest score ${subject.latest_score.percentage}% — Delivery Gap ${formatMarks(subject.latest_score.delivery_gap)}`
                      : 'No evaluated papers yet for this subject.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* The one sentence a parent should act on comes first. */}
                  <p className="text-body bg-muted/50 rounded-md p-3">
                    {subject.next_action}
                  </p>
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
                  {subject.pending_uploads.length > 0 && (
                    <p className="text-small text-muted-foreground">
                      {subject.pending_uploads.length} upload(s) pending review.
                    </p>
                  )}

                  {subject.score_history.length > 0 && (
                    <details>
                      <summary className="text-small text-primary cursor-pointer select-none">
                        Show score and Delivery Gap over time
                      </summary>
                      <div className="grid gap-4 pt-3">
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
                            Delivery Gap over time (marks)
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
                            yFormat={(n) => `${n}`}
                          />
                        </div>
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            ))}

            <p className="text-caption text-muted-foreground">
              <strong>Delivery Gap</strong> = marks lost even though she knew
              the answer (for example, stopping before the last step). The other
              lost marks are knowledge gaps.
            </p>

            <h2 className="text-h3 pt-2">Patterns and habits</h2>
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
                    Behaviour patterns flagged during review, added up across
                    every subject — not just one paper.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {dashboard.pattern_frequency.map((p) => (
                    <div
                      key={p.pattern_id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-small">
                        {p.pattern_name}{' '}
                        <span className="text-muted-foreground">
                          ({p.pattern_code})
                        </span>
                      </span>
                      <span className="text-small text-muted-foreground shrink-0">
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
                    Did she show each habit in her confirmed papers? One dot per
                    paper, oldest to newest.
                  </CardDescription>
                  <div className="text-caption text-muted-foreground flex flex-wrap gap-3 pt-1">
                    {(['present', 'partial', 'absent'] as const).map((r) => (
                      <span key={r} className="flex items-center gap-1.5">
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-medium text-white"
                          style={{ background: HABIT_RATING_COLOR[r] }}
                          aria-hidden="true"
                        >
                          {HABIT_RATING_LETTER[r]}
                        </span>
                        {HABIT_RATING_WORD[r]}
                      </span>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {habitTrend.map((h) => {
                    const latest = h.observations[h.observations.length - 1]
                    return (
                      <div
                        key={h.habit_id}
                        className="flex flex-wrap items-center justify-between gap-2"
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
    </AppShell>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
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

interface Dashboard {
  subjects: Array<SubjectCard>
  concept_status_distribution: Record<string, number>
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

  useEffect(() => {
    if (isPending) return
    if (!session || (role !== 'parent' && role !== 'admin')) {
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

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
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
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

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
              <CardTitle className="text-h3">Concept status distribution</CardTitle>
              <CardDescription>Across every subject.</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusDistributionBar counts={dashboard.concept_status_distribution} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

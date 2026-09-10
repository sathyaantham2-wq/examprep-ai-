import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/summary/weekly')({
  component: WeeklySummaryScreen,
})

interface Student {
  id: string
  name: string
}

interface SubjectWeekScore {
  subject_name: string
  avg_percentage: number
}

interface FocusConcept {
  concept_id: string
  concept_name: string
}

interface WeeklySummary {
  week_start: string
  week_end: string
  best_subject: SubjectWeekScore | null
  most_improved_concept: (FocusConcept & { delta: number }) | null
  urgent_concept: FocusConcept | null
  seven_day_plan: Array<FocusConcept>
  cumulative_stats: {
    this_week: { evaluations_count: number; avg_percentage: number | null }
    last_week: { evaluations_count: number; avg_percentage: number | null }
  }
}

/**
 * F074 (tab06 /summary/weekly): best subject, most improved concept, urgent concept, 7-day plan,
 * cumulative stats vs last week -- reads GET /api/summary/weekly/:studentId (this feature's own
 * data half, built alongside this screen). Defaults to the trailing 7 days; no week picker yet.
 */
function WeeklySummaryScreen() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [students, setStudents] = useState<Array<Student> | null>(null)
  const [studentId, setStudentId] = useState('')
  const [summary, setSummary] = useState<WeeklySummary | null>(null)
  const [loading, setLoading] = useState(false)

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
      setSummary(null)
      return
    }
    setLoading(true)
    fetch(`/api/summary/weekly/${studentId}`)
      .then((r) => r.json())
      .then(setSummary)
      .finally(() => setLoading(false))
  }, [studentId])

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const delta =
    summary &&
    summary.cumulative_stats.this_week.avg_percentage !== null &&
    summary.cumulative_stats.last_week.avg_percentage !== null
      ? summary.cumulative_stats.this_week.avg_percentage -
        summary.cumulative_stats.last_week.avg_percentage
      : null

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Weekly summary</h1>
          {summary && (
            <p className="text-body text-muted-foreground">
              {summary.week_start} to {summary.week_end}
            </p>
          )}
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

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

      {loading && <p className="text-body text-muted-foreground">Loading…</p>}

      {summary && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">This week vs last week</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-body">
                {summary.cumulative_stats.this_week.evaluations_count} evaluated
                paper(s) this week
                {summary.cumulative_stats.this_week.avg_percentage !== null &&
                  ` — average ${summary.cumulative_stats.this_week.avg_percentage}%`}
                {delta !== null && (
                  <span className="text-muted-foreground">
                    {' '}
                    ({delta >= 0 ? '+' : ''}
                    {delta}% vs last week)
                  </span>
                )}
              </p>
              <p className="text-small text-muted-foreground">
                Last week: {summary.cumulative_stats.last_week.evaluations_count}{' '}
                evaluated paper(s)
                {summary.cumulative_stats.last_week.avg_percentage !== null &&
                  `, average ${summary.cumulative_stats.last_week.avg_percentage}%`}
              </p>
            </CardContent>
          </Card>

          {summary.best_subject && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Best subject this week</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body">
                  {summary.best_subject.subject_name} —{' '}
                  {summary.best_subject.avg_percentage}%
                </p>
              </CardContent>
            </Card>
          )}

          {summary.most_improved_concept && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Most improved concept</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-body">
                  {summary.most_improved_concept.concept_name} — up{' '}
                  {summary.most_improved_concept.delta}%
                </p>
              </CardContent>
            </Card>
          )}

          {summary.urgent_concept && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Needs attention</CardTitle>
                <CardDescription>
                  The most urgent concept on the tracker right now.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-body">{summary.urgent_concept.concept_name}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Next 7 days</CardTitle>
            </CardHeader>
            <CardContent>
              {summary.seven_day_plan.length === 0 ? (
                <p className="text-body text-muted-foreground">
                  Nothing flagged — keep up the current pace.
                </p>
              ) : (
                <ul className="text-body list-inside list-disc">
                  {summary.seven_day_plan.map((c) => (
                    <li key={c.concept_id}>{c.concept_name}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

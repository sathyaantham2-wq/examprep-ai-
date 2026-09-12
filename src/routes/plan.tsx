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

export const Route = createFileRoute('/plan')({ component: StudyPlanScreen })

interface PlanDay {
  day_number: number
  date: string
  subject_name: string | null
  concept_name: string | null
  activity: string
  completed: boolean
}

interface StudyPlan {
  id: string
  week_start: string
  days: Array<PlanDay>
  status: string
}

interface ExamCountdown {
  exam_name: string
  exam_date: string
  days_remaining: number
}

interface SyllabusCoverage {
  strong_pct: number
  untested_chapters: Array<{ chapter_id: string; chapter_name: string }>
}

interface ExamCountdownReport {
  countdowns: Array<ExamCountdown>
  syllabus_coverage: SyllabusCoverage
}

/**
 * F077/F078/F079 (tab06 /plan "Both": 7-day plan, exam countdown, daily tasks, regenerate). Built
 * for the student's own view, the same scope decision remediation.tsx already made for its own
 * "Both" screen -- a parent reaches the same data via the API directly for now.
 */
function StudyPlanScreen() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [plan, setPlan] = useState<StudyPlan | null>(null)
  const [countdown, setCountdown] = useState<ExamCountdownReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  function loadPlan() {
    setLoading(true)
    Promise.all([
      fetch('/api/study-plan').then((r) => r.json()),
      fetch('/api/exam-countdown').then((r) => r.json()),
    ])
      .then(([planData, countdownData]: [{ plan: StudyPlan | null }, ExamCountdownReport]) => {
        setPlan(planData.plan)
        setCountdown(countdownData)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    loadPlan()
  }, [isPending, session, role, navigate])

  async function regenerate() {
    setRegenerating(true)
    try {
      const response = await fetch('/api/study-plan/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await response.json()
      if (response.ok) setPlan(body.plan)
    } finally {
      setRegenerating(false)
    }
  }

  async function toggleDay(dayNumber: number, completed: boolean) {
    if (!plan) return
    // Optimistic update -- ticking a box should feel instant.
    setPlan({
      ...plan,
      days: plan.days.map((d) =>
        d.day_number === dayNumber ? { ...d, completed } : d,
      ),
    })
    const response = await fetch(
      `/api/study-plan/${plan.id}/days/${dayNumber}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ completed }),
      },
    )
    if (response.ok) {
      const body = await response.json()
      setPlan(body.plan)
    } else {
      loadPlan() // revert the optimistic update to real server state
    }
  }

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">This week's plan</h1>
          <p className="text-body text-muted-foreground">
            One focus a day, built from what needs practice most.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {loading && (
        <p className="text-body text-muted-foreground">Loading…</p>
      )}

      {!loading && countdown && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-h3">Exam countdown</CardTitle>
            <CardDescription>
              {countdown.syllabus_coverage.strong_pct}% of the syllabus at
              Strong.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {countdown.countdowns.length === 0 && (
              <p className="text-small text-muted-foreground">
                No exam dates on file yet.
              </p>
            )}
            {countdown.countdowns.map((c) => (
              <div
                key={c.exam_name}
                className="flex items-center justify-between text-small"
              >
                <span>{c.exam_name}</span>
                <span className="text-muted-foreground">
                  {c.days_remaining >= 0
                    ? `${c.days_remaining} day${c.days_remaining === 1 ? '' : 's'} left`
                    : 'Past'}
                </span>
              </div>
            ))}
            {countdown.syllabus_coverage.untested_chapters.length > 0 && (
              <p className="text-small text-muted-foreground">
                Not yet attempted:{' '}
                {countdown.syllabus_coverage.untested_chapters
                  .map((c) => c.chapter_name)
                  .join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !plan && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <p className="text-body text-muted-foreground">
              No plan yet for this week.
            </p>
            <Button onClick={regenerate} disabled={regenerating}>
              {regenerating ? 'Building…' : 'Build this week’s plan'}
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && plan && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-small text-muted-foreground">
              Week of {plan.week_start}
            </span>
            <Button
              variant="outline"
              onClick={regenerate}
              disabled={regenerating}
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </div>

          <div className="space-y-3">
            {plan.days.map((day) => (
              <Card key={day.day_number}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-h3 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={day.completed}
                        onChange={(e) => toggleDay(day.day_number, e.target.checked)}
                        aria-label={`Mark day ${day.day_number} done`}
                      />
                      <span className={day.completed ? 'line-through text-muted-foreground' : ''}>
                        Day {day.day_number} — {day.date}
                      </span>
                    </CardTitle>
                    {day.subject_name && (
                      <span className="text-small text-muted-foreground">
                        {day.subject_name}
                      </span>
                    )}
                  </div>
                  {day.concept_name && (
                    <CardDescription>{day.concept_name}</CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <p className="text-body">{day.activity}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

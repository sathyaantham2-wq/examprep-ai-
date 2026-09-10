import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { MasteryRing } from '../components/mastery-ring'
import { ThemeToggle } from '../components/theme-toggle'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/student')({ component: StudentHome })

interface ChapterMastery {
  chapter_id: string
  chapter_name: string
  mastery_pct: number
}

interface FocusConcept {
  concept_id: string
  concept_name: string
}

interface StudentDashboard {
  chapters: Array<ChapterMastery>
  streak_days: number
  today_focus: FocusConcept | null
  recent_improvements: Array<FocusConcept>
}

/**
 * F072 (tab06 /student): "Mastery rings, today's drill, streak, recent wins" — no red shaming
 * language, so this screen never shows a raw status word (Weak/Priority/etc.), only concept
 * names and positive framing.
 */
function StudentHome() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/student-dashboard')
      .then((r) => r.json())
      .then(setDashboard)
      .finally(() => setLoading(false))
  }, [isPending, session, role, navigate])

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Your progress</h1>
          <p className="text-body text-muted-foreground">
            {dashboard && dashboard.streak_days > 0
              ? `${dashboard.streak_days} day streak — keep it going!`
              : 'Practice today to start a streak.'}
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {loading && <p className="text-body text-muted-foreground">Loading…</p>}

      {dashboard && (
        <div className="space-y-4">
          {dashboard.today_focus && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Today's focus</CardTitle>
                <CardDescription>
                  A good concept to practice next.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-body">{dashboard.today_focus.concept_name}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Chapter mastery</CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.chapters.length === 0 ? (
                <p className="text-body text-muted-foreground">
                  No chapters attempted yet — your first paper will show up
                  here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-6">
                  {dashboard.chapters.map((c) => (
                    <MasteryRing
                      key={c.chapter_id}
                      percent={c.mastery_pct}
                      label={c.chapter_name}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {dashboard.recent_improvements.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Recent wins</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-body list-inside list-disc">
                  {dashboard.recent_improvements.map((c) => (
                    <li key={c.concept_id}>{c.concept_name}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

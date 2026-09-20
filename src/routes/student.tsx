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
import { MasteryRing } from '../components/mastery-ring'
import { ThemeToggle } from '../components/theme-toggle'
import { signOut, useSession } from '../lib/auth-client'

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

interface IncomingInvite {
  id: string
  guardian_name: string
  guardian_role: string
}

interface SharingState {
  invites: Array<IncomingInvite>
  linkedTo: { guardian_name: string; guardian_role: string } | null
}

interface PaperListItem {
  id: string
  title: string
  total_marks: number
  duration_min: number
  generated_at: string
  attempt: { id: string; status: string } | null
}

/**
 * F072 (tab06 /student): "Mastery rings, today's drill, streak, recent wins" — no red shaming
 * language, so this screen never shows a raw status word (Weak/Priority/etc.), only concept
 * names and positive framing.
 *
 * F123: also the entry point into the online test engine (M08) -- GET /api/papers lists this
 * student's generated papers with their attempt status; Start/Continue is the only way a
 * generated paper was ever reachable before this, since nothing else surfaced a paper's id.
 */
function StudentHome() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [dashboard, setDashboard] = useState<StudentDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [papers, setPapers] = useState<Array<PaperListItem> | null>(null)
  const [sharing, setSharing] = useState<SharingState | null>(null)
  const [sharingError, setSharingError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)

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
    fetch('/api/papers')
      .then((r) => r.json())
      .then(setPapers)
    void loadSharing()
  }, [isPending, session, role, navigate])

  async function loadSharing() {
    const response = await fetch('/api/guardian-invites/incoming')
    if (response.ok) setSharing(await response.json())
  }

  // Approving lets a parent or teacher see her progress; she can stop it at any time.
  async function answerInvite(id: string, approve: boolean) {
    setSharingError(null)
    const response = await fetch(`/api/guardian-invites/${id}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approve }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      setSharingError(body?.error ?? 'Could not answer this request.')
    }
    await loadSharing()
  }

  async function stopSharing() {
    setSharingError(null)
    const response = await fetch('/api/guardian-invites/leave', { method: 'POST' })
    if (!response.ok) setSharingError('Could not stop sharing.')
    await loadSharing()
  }

  // F123: a paper with no attempt yet needs one created (POST /api/attempts) before there's an
  // id to navigate to; a paper already in_progress just resumes at its existing attempt id --
  // POST-ing again would be a second, orphaned attempt row for the same paper.
  async function startOrResume(paper: PaperListItem) {
    setStartError(null)
    if (paper.attempt && paper.attempt.status === 'in_progress') {
      navigate({ to: '/attempt/$id', params: { id: paper.attempt.id } })
      return
    }
    setStartingId(paper.id)
    try {
      const response = await fetch('/api/attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paper_id: paper.id, mode: 'online' }),
      })
      const body = await response.json()
      if (!response.ok) {
        setStartError(body.error ?? 'Could not start this paper.')
        return
      }
      navigate({ to: '/attempt/$id', params: { id: body.id } })
    } finally {
      setStartingId(null)
    }
  }

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
        <div className="no-print flex items-center gap-2">
          <a href="/generate">
            <Button size="sm">Make a paper</Button>
          </a>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut().then(() => navigate({ to: '/' }))}
          >
            Sign out
          </Button>
        </div>
      </div>

      {sharing && (sharing.invites.length > 0 || sharing.linkedTo) && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-h3">Sharing your progress</CardTitle>
            <CardDescription>
              Only people you approve can see your progress. You can stop at any
              time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sharingError && (
              <p className="text-small text-destructive" role="alert">
                {sharingError}
              </p>
            )}
            {sharing.linkedTo && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <p className="text-body">
                  {sharing.linkedTo.guardian_name} (
                  {sharing.linkedTo.guardian_role}) can see your progress.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void stopSharing()}
                >
                  Stop sharing
                </Button>
              </div>
            )}
            {sharing.invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between gap-3 rounded-md border p-3"
              >
                <p className="text-body">
                  {inv.guardian_name} ({inv.guardian_role}) wants to follow your
                  progress.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void answerInvite(inv.id, true)}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void answerInvite(inv.id, false)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {papers && papers.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-h3">Papers to attempt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {startError && (
              <p className="text-small text-destructive" role="alert">
                {startError}
              </p>
            )}
            {papers.map((p) => {
              const status = p.attempt?.status
              const isDone = status === 'submitted' || status === 'evaluated'
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="text-body">{p.title}</p>
                    <p className="text-small text-muted-foreground">
                      {p.total_marks} marks, {p.duration_min} min
                    </p>
                  </div>
                  {isDone ? (
                    <span className="text-small text-muted-foreground">
                      Completed
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={startingId === p.id}
                      onClick={() => void startOrResume(p)}
                    >
                      {startingId === p.id
                        ? 'Starting…'
                        : status === 'in_progress'
                          ? 'Continue'
                          : 'Start'}
                    </Button>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

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

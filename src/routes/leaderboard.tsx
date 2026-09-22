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
import { AppShell } from '../components/app-shell'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/leaderboard')({ component: Leaderboard })

interface ProfileSubject {
  id: string
  name: string
  has_content: boolean
}

interface LeaderboardEntry {
  rank: number
  nickname: string
  points: number
}

interface LeaderboardView {
  entries: Array<LeaderboardEntry>
  me: {
    points: number
    rank: number | null
    optedIn: boolean
    nickname: string | null
  } | null
}

/**
 * F125 (second slice, tab06 has no row for this screen yet -- see the backlog entry's note).
 * Points/coins are earned automatically (confirmEvaluation, src/lib/points.ts); this screen is
 * only about the anonymous, opt-in leaderboard layered on top of that ledger. Nothing here shows
 * a real name, another student's answers, or her concept-level performance -- an aggregate point
 * total and a rank, same as the API returns.
 */
function Leaderboard() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [subjects, setSubjects] = useState<Array<ProfileSubject>>([])
  const [subjectId, setSubjectId] = useState('')
  const [view, setView] = useState<LeaderboardView | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students/me/profile')
      .then((r) => r.json())
      .then(
        (data: {
          profile: { board: string; class: number; subject_ids: Array<string> }
          options: Array<{
            board: string
            class: number
            subjects: Array<ProfileSubject>
          }>
        }) => {
          const offered =
            data.options.find(
              (o) =>
                o.board === data.profile.board &&
                o.class === data.profile.class,
            )?.subjects ?? []
          const mine = offered.filter(
            (s) => data.profile.subject_ids.includes(s.id) && s.has_content,
          )
          setSubjects(mine)
          if (mine.length > 0) setSubjectId(mine[0].id)
        },
      )
  }, [isPending, session, role, navigate])

  async function loadLeaderboard(subject: string) {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/leaderboard?subject_id=${subject}`)
      if (!response.ok) {
        setView(null)
        setError('Could not load the leaderboard right now.')
        return
      }
      setView(await response.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (subjectId) void loadLeaderboard(subjectId)
  }, [subjectId])

  async function toggleOptIn(nextOptIn: boolean) {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/students/me/leaderboard-opt-in', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opt_in: nextOptIn }),
      })
      if (!response.ok) {
        setError('Could not update that right now.')
        return
      }
      if (subjectId) await loadLeaderboard(subjectId)
    } finally {
      setSaving(false)
    }
  }

  async function rerollNickname() {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/students/me/leaderboard-opt-in', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regenerate_nickname: true }),
      })
      if (!response.ok) {
        setError('Could not update that right now.')
        return
      }
      if (subjectId) await loadLeaderboard(subjectId)
    } finally {
      setSaving(false)
    }
  }

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <AppShell variant="student" active="leaderboard">
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <div className="mb-6">
          <h1 className="text-h1">Leaderboard</h1>
          <p className="text-body text-muted-foreground">
            Points for correct answers -- harder questions pay more.
          </p>
        </div>

        {subjects.length > 1 && (
          <div
            className="mb-4 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Subject"
          >
            {subjects.map((s) => (
              <Button
                key={s.id}
                type="button"
                size="sm"
                variant={s.id === subjectId ? 'default' : 'outline'}
                onClick={() => setSubjectId(s.id)}
              >
                {s.name}
              </Button>
            ))}
          </div>
        )}

        {error && (
          <p className="text-small text-destructive mb-4" role="alert">
            {error}
          </p>
        )}

        {view?.me && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-h3">You</CardTitle>
              <CardDescription>
                {view.me.optedIn
                  ? 'Visible on the leaderboard below as your nickname -- never your real name.'
                  : 'Your points are private until you join the leaderboard below.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-body flex items-center justify-between">
                <span className="text-muted-foreground">Points</span>
                <span className="font-medium">{view.me.points}</span>
              </div>
              {view.me.optedIn && (
                <>
                  <div className="text-body flex items-center justify-between">
                    <span className="text-muted-foreground">Your rank</span>
                    <span className="font-medium">{view.me.rank ?? '—'}</span>
                  </div>
                  <div className="text-body flex items-center justify-between">
                    <span className="text-muted-foreground">Your nickname</span>
                    <span className="font-medium">{view.me.nickname}</span>
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void toggleOptIn(!view.me!.optedIn)}
                >
                  {view.me.optedIn
                    ? 'Leave the leaderboard'
                    : 'Join the leaderboard'}
                </Button>
                {view.me.optedIn && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void rerollNickname()}
                  >
                    New nickname
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Top of the class</CardTitle>
            <CardDescription>
              Same board, class and subject as you. Anonymous names only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && (
              <p className="text-body text-muted-foreground">Loading…</p>
            )}
            {!loading && view && view.entries.length === 0 && (
              <p className="text-body text-muted-foreground">
                Nobody has joined the leaderboard here yet -- be the first!
              </p>
            )}
            {!loading && view && view.entries.length > 0 && (
              <table className="text-small w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pb-2 font-normal">Rank</th>
                    <th className="pb-2 font-normal">Nickname</th>
                    <th className="pb-2 text-right font-normal">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {view.entries.map((e) => (
                    <tr
                      key={e.rank}
                      className={`border-t ${e.nickname === view.me?.nickname ? 'bg-primary/5' : ''}`}
                    >
                      <td className="py-2 pr-2">{e.rank}</td>
                      <td className="py-2 pr-2">{e.nickname}</td>
                      <td className="py-2 text-right">{e.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}

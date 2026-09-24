import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { AppShell } from '../components/app-shell'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/papers-attempted')({ component: PapersAttempted })

interface PaperListItem {
  id: string
  title: string
  total_marks: number
  duration_min: number
  generated_at: string
  attempt: { id: string; status: string; attempted_at: string } | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * F123 follow-up (2026-09-24, user feedback with a screenshot): "Papers to attempt" on /student
 * was showing completed papers too, mislabeled and unclickable -- a dead end with no way back
 * into a finished paper. This is that missing page: every paper she has actually finished
 * submitting (marked already, or waiting on marks), each opening into /attempt/:id -- the same
 * screen a fresh submission lands on, with her date, her answers next to the right ones, and why
 * she lost each mark, per CLAUDE.md's T09 amendment. In-progress papers stay on /student's own
 * "Papers to attempt" (Continue), since she hasn't finished attempting those yet.
 */
function PapersAttempted() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [papers, setPapers] = useState<Array<PaperListItem> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/papers')
      .then((r) => {
        if (!r.ok) throw new Error('failed')
        return r.json()
      })
      .then(setPapers)
      .catch(() => setLoadError('Could not load your papers.'))
  }, [isPending, session, role, navigate])

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const attempted = (papers ?? []).filter(
    (p) => p.attempt && p.attempt.status !== 'in_progress',
  )

  return (
    <AppShell variant="student" active="papers">
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <div className="mb-6">
          <h1 className="text-h1">Papers attempted</h1>
          <p className="text-body text-muted-foreground">
            Every paper you have finished. Tap one to see your answers and marks again.
          </p>
        </div>

        {loadError && (
          <p className="text-small text-destructive" role="alert">
            {loadError}
          </p>
        )}

        {papers === null && !loadError ? (
          <p className="text-body text-muted-foreground">Loading…</p>
        ) : attempted.length === 0 ? (
          <Card>
            <CardContent className="text-body text-muted-foreground pt-6">
              You haven't attempted any papers yet.{' '}
              <a
                href="/my-paper"
                className="text-primary underline-offset-4 hover:underline"
              >
                Generate one
              </a>{' '}
              to get started.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Your finished papers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {attempted.map((p) => {
                const evaluated = p.attempt?.status === 'evaluated'
                return (
                  <a
                    key={p.id}
                    href={`/attempt/${p.attempt!.id}`}
                    className="hover:bg-accent flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div>
                      <p className="text-body">{p.title}</p>
                      <p className="text-small text-muted-foreground">
                        {p.total_marks} marks, {p.duration_min} min ·{' '}
                        {formatDate(p.attempt!.attempted_at)}
                      </p>
                    </div>
                    <span
                      className={
                        evaluated
                          ? 'text-small shrink-0 text-emerald-600 dark:text-emerald-400'
                          : 'text-small text-muted-foreground shrink-0'
                      }
                    >
                      {evaluated ? 'Completed' : 'Awaiting marks'}
                    </span>
                  </a>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}

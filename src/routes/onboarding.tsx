import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { AppShell } from '../components/app-shell'
import { signOut, useSession } from '../lib/auth-client'

export const Route = createFileRoute('/onboarding')({ component: Onboarding })

interface Student {
  id: string
  name: string
  class: number
  board: string
}

interface Invite {
  id: string
  student_email: string
  status: 'pending' | 'approved' | 'declined' | 'revoked'
  student_name: string | null
}

const STATUS_TEXT: Record<Invite['status'], string> = {
  pending: 'Waiting for the student to approve',
  approved: 'Following',
  declined: 'Declined by the student',
  revoked: 'Stopped',
}

// One student, one login: students sign up on their own. A parent or teacher follows a student
// by sending an invite to her email, and she approves it from her own account.
function Onboarding() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [students, setStudents] = useState<Array<Student> | null>(null)
  const [invites, setInvites] = useState<Array<Invite>>([])
  const [showForm, setShowForm] = useState(false)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const role = (session?.user as { role?: string } | undefined)?.role
  const isTeacher = role === 'teacher'

  const load = useCallback(async () => {
    const [s, i] = await Promise.all([
      fetch('/api/students').then((r) => r.json()),
      fetch('/api/guardian-invites').then((r) => r.json()),
    ])
    setStudents(s as Array<Student>)
    setInvites(i as Array<Invite>)
  }, [])

  useEffect(() => {
    if (isPending) return
    if (
      !session ||
      (role !== 'parent' && role !== 'teacher' && role !== 'admin')
    ) {
      navigate({ to: '/' })
      return
    }
    void load()
  }, [isPending, session, role, navigate, load])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/guardian-invites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ student_email: email, consent }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(
          typeof body.error === 'string'
            ? body.error
            : 'Enter the student’s email and tick the box to continue.',
        )
        return
      }
      setNotice(
        'Request sent. The student signs in with her own account and approves it. Ask her to check her email or her home page.',
      )
      setEmail('')
      setConsent(false)
      setShowForm(false)
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(id: string) {
    await fetch(`/api/guardian-invites/${id}/revoke`, { method: 'POST' })
    await load()
  }

  if (
    isPending ||
    !session ||
    (role !== 'parent' && role !== 'teacher' && role !== 'admin')
  ) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <AppShell active={null}>
      <div className="mx-auto max-w-2xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-h1">Your students</h1>
            <p className="text-body text-muted-foreground">
              Each student has her own login. Add a student to follow her
              progress.
            </p>
          </div>
          <div className="flex items-center gap-2 no-print">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut().then(() => navigate({ to: '/' }))}
            >
              Sign out
            </Button>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-h3">Students</CardTitle>
                <CardDescription>
                  {students === null
                    ? 'Loading…'
                    : students.length === 0
                      ? 'No students yet. Use Add student.'
                      : `${students.length} student${students.length === 1 ? '' : 's'} you follow.`}
                </CardDescription>
              </div>
              <Button type="button" onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : 'Add student'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {notice && (
              <p className="text-small text-muted-foreground" role="status">
                {notice}
              </p>
            )}
            {showForm && (
              <form
                onSubmit={handleInvite}
                className="space-y-3 rounded-md border p-3"
              >
                <p className="text-small text-muted-foreground">
                  The student must first create her own account (student sign-up
                  with her email, a username and a password). Enter the email
                  she used.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="student-email">Student’s email</Label>
                  <Input
                    id="student-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Label className="items-start">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span className="text-small font-normal">
                    I am this student’s{' '}
                    {isTeacher ? 'teacher' : 'parent or guardian'} and I agree
                    to her practice and exam data being used to generate papers,
                    mark attempts and track her progress.
                  </span>
                </Label>
                {error && (
                  <p className="text-small text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={submitting || !consent}>
                  {submitting ? 'Sending…' : 'Send request'}
                </Button>
              </form>
            )}

            {students?.map((s) => (
              <div
                key={s.id}
                className="text-body flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span>
                  {s.name}{' '}
                  <span className="text-small text-muted-foreground">
                    {s.board} · Class {s.class}
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <a href="/home">
                    <Button type="button" variant="outline" size="sm">
                      Dashboard
                    </Button>
                  </a>
                  <a href={`/tracker/${s.id}`}>
                    <Button type="button" variant="outline" size="sm">
                      Concept tracker
                    </Button>
                  </a>
                  {!isTeacher && (
                    <a href="/generate">
                      <Button type="button" size="sm">
                        Generate paper
                      </Button>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {invites.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-h3">Requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {invites.map((inv) => (
                <div
                  key={inv.id}
                  className="text-body flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span>
                    {inv.student_name ?? inv.student_email}
                    <span className="text-small text-muted-foreground">
                      {' '}
                      · {STATUS_TEXT[inv.status]}
                    </span>
                  </span>
                  {(inv.status === 'pending' || inv.status === 'approved') && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleRevoke(inv.id)}
                    >
                      {inv.status === 'pending'
                        ? 'Cancel request'
                        : 'Stop following'}
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  )
}

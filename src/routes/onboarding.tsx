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
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { ThemeToggle } from '../components/theme-toggle'
import { signOut, useSession } from '../lib/auth-client'

export const Route = createFileRoute('/onboarding')({ component: Onboarding })

interface Student {
  id: string
  name: string
  class: number
  board: string
  school: string | null
  user_id: string | null
}

function Onboarding() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [students, setStudents] = useState<Array<Student> | null>(null)
  const [name, setName] = useState('')
  const [studentClass, setStudentClass] = useState('7')
  const [board, setBoard] = useState('CBSE')
  const [school, setSchool] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [loginFormFor, setLoginFormFor] = useState<string | null>(null)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginSubmitting, setLoginSubmitting] = useState(false)

  const role = (session?.user as { role?: string } | undefined)?.role

  useEffect(() => {
    if (isPending) return
    // F010: POST /api/students and /api/students/:id/login both accept 'parent' or 'admin' --
    // this screen's own guard excluding admin was a gap, not a deliberate restriction. An admin
    // household (e.g. the account created for real-content authoring) had no way to add a
    // student or create that student's own login without it.
    if (!session || (role !== 'parent' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students')
      .then((r) => r.json())
      .then(setStudents)
  }, [isPending, session, role, navigate])

  async function handleAddStudent(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/students', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          class: Number(studentClass),
          board,
          school: school || undefined,
          consent_accepted: consent,
        }),
      })
      if (!response.ok) {
        const body = await response.json()
        setError(
          body.error?.formErrors?.[0] ??
            body.error?.fieldErrors?.consent_accepted?.[0] ??
            'Could not add student — check the fields above.',
        )
        return
      }
      const created: Student = await response.json()
      setStudents((prev) => [...(prev ?? []), created])
      setName('')
      setSchool('')
      setConsent(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCreateLogin(e: React.FormEvent, studentId: string) {
    e.preventDefault()
    setLoginError(null)
    setLoginSubmitting(true)
    try {
      const response = await fetch(`/api/students/${studentId}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      })
      if (!response.ok) {
        const body = await response.json()
        setLoginError(
          body.error?.formErrors?.[0] ??
            (typeof body.error === 'string' ? body.error : null) ??
            'Could not create a login for this student.',
        )
        return
      }
      const createdUser: { id: string } = await response.json()
      setStudents(
        (prev) =>
          prev?.map((s) =>
            s.id === studentId ? { ...s, user_id: createdUser.id } : s,
          ) ?? null,
      )
      setLoginFormFor(null)
      setLoginEmail('')
      setLoginPassword('')
    } finally {
      setLoginSubmitting(false)
    }
  }

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Setup</h1>
          <p className="text-body text-muted-foreground">
            Add the students in your household. Everything else builds on this.
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-h3">Students</CardTitle>
          <CardDescription>
            {students === null
              ? 'Loading…'
              : students.length === 0
                ? 'No students yet — add one below.'
                : `${students.length} student${students.length === 1 ? '' : 's'} on this account.`}
          </CardDescription>
        </CardHeader>
        {students && students.length > 0 && (
          <CardContent className="space-y-3">
            {students.map((s) => (
              <div key={s.id} className="rounded-md border px-3 py-2">
                <div className="text-body flex items-center justify-between">
                  <span>{s.name}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-small text-muted-foreground">
                      {s.board} · Class {s.class}
                    </span>
                    <a href="/generate">
                      <Button type="button" variant="outline" size="sm">
                        Generate paper
                      </Button>
                    </a>
                    {s.user_id ? (
                      <span className="text-small text-muted-foreground">
                        Login active
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setLoginFormFor(loginFormFor === s.id ? null : s.id)
                          setLoginError(null)
                        }}
                      >
                        {loginFormFor === s.id ? 'Cancel' : 'Create login'}
                      </Button>
                    )}
                  </div>
                </div>
                {loginFormFor === s.id && (
                  <form
                    onSubmit={(e) => handleCreateLogin(e, s.id)}
                    className="mt-3 space-y-3 border-t pt-3"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`login-email-${s.id}`}>
                        {s.name}'s email
                      </Label>
                      <Input
                        id={`login-email-${s.id}`}
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`login-password-${s.id}`}>Password</Label>
                      <Input
                        id={`login-password-${s.id}`}
                        type="password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        minLength={8}
                      />
                    </div>
                    {loginError && (
                      <p className="text-small text-destructive" role="alert">
                        {loginError}
                      </p>
                    )}
                    <Button type="submit" size="sm" disabled={loginSubmitting}>
                      {loginSubmitting ? 'Creating…' : 'Create login'}
                    </Button>
                  </form>
                )}
              </div>
            ))}
            <a
              href="/generate"
              className="text-small text-primary underline-offset-4 hover:underline"
            >
              Generate a paper →
            </a>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Add a student</CardTitle>
          <CardDescription>
            Consent is required once per student before any paper can be
            generated for them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddStudent} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="student-name">Name</Label>
              <Input
                id="student-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="student-class">Class</Label>
                <Input
                  id="student-class"
                  type="number"
                  min={1}
                  max={12}
                  value={studentClass}
                  onChange={(e) => setStudentClass(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="student-board">Board</Label>
                <Input
                  id="student-board"
                  value={board}
                  onChange={(e) => setBoard(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student-school">School (optional)</Label>
              <Input
                id="student-school"
                value={school}
                onChange={(e) => setSchool(e.target.value)}
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
                I consent to this student's data being used to generate and
                evaluate practice papers.
              </span>
            </Label>
            {error && (
              <p className="text-small text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={submitting || !consent}>
              {submitting ? 'Adding…' : 'Add student'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

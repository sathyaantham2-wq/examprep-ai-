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
import { signIn, signOut, signUp, useSession } from '../lib/auth-client'

export const Route = createFileRoute('/')({ component: Home })

type Mode = 'sign-in' | 'sign-up'
type AccountType = 'student' | 'parent'

function Home() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('sign-in')
  // Owner decision 2026-09-22: parent sign-up reopened (auth.ts's before-hook gates the actual
  // HTTP request; this is just the form's half). Student stays the default -- it was the only
  // option until now, and is still the more common case.
  const [accountType, setAccountType] = useState<AccountType>('student')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [guardianOk, setGuardianOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const role = (session?.user as { role?: string } | undefined)?.role

  // One redirect source, reacting to session state, covers both the "just submitted the sign-in
  // form" case and "already had a session and loaded / directly" case -- these used to be two
  // separate call sites (one here at render time, one duplicated inside handleSubmit) that could
  // race and send a parent to two different destinations in the same load, which is the bug this
  // consolidation fixes. Render-time navigate() calls are also a React rules-of-hooks violation
  // (the "Cannot update a component while rendering" warning) that a useEffect avoids.
  useEffect(() => {
    if (isPending || !session) return
    if (role === 'parent' || role === 'teacher' || role === 'admin') {
      fetch('/api/students')
        .then((r) => r.json())
        .then((students: Array<unknown>) => {
          navigate({ to: students.length > 0 ? '/home' : '/onboarding' })
        })
    } else if (role === 'student') {
      // First sign-in: a student finishes her profile (name, class, syllabus, subjects) before
      // anything else. A paused or failing profile call just falls through to her home screen.
      fetch('/api/students/me')
        .then((r) => (r.ok ? r.json() : null))
        .then((me: { profile_complete?: boolean } | null) => {
          navigate({
            to:
              me && me.profile_complete === false
                ? '/profile-setup'
                : '/student',
          })
        })
        .catch(() => navigate({ to: '/student' }))
    }
  }, [isPending, session, role, navigate])

  if (
    !isPending &&
    session &&
    role !== 'parent' &&
    role !== 'teacher' &&
    role !== 'admin' &&
    role !== 'student'
  ) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-h3">Signed in</CardTitle>
            <CardDescription>
              Signed in as {session.user.name} ({role}). There's no home screen
              for this role yet -- a direct link (e.g. to /attempt/:id) is the
              only way in for now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => signOut()}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // F006: "email+password and Google OAuth" -- the server side (socialProviders, the
  // databaseHooks that assign a fresh household_id/role) was already wired and conditional on
  // GOOGLE_CLIENT_ID/SECRET existing; this button was the missing half, withheld until real
  // credentials existed to test against. signIn.social redirects to Google and back to this same
  // page -- the useEffect above (watching useSession()) does the actual post-login redirect,
  // exactly like the email/password path.
  async function handleGoogleSignIn() {
    setError(null)
    await signIn.social({ provider: 'google', callbackURL: '/' })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        const result = await signIn.email({ email, password })
        if (result.error) {
          setError(result.error.message ?? 'Sign in failed')
          return
        }
        // The useEffect above reacts to useSession() picking up the new session and does the
        // actual redirect -- nothing further to do here once sign-in itself succeeds.
      } else {
        if (password !== confirmPassword) {
          setError('The two passwords do not match.')
          return
        }
        if (accountType === 'student' && !guardianOk) {
          setError('Please confirm that your parent or guardian agrees.')
          return
        }
        const result = await signUp.email({
          name,
          email,
          password,
          signup_type: accountType,
        })
        if (result.error) {
          setError(result.error.message ?? 'Sign up failed')
          return
        }
        // No email confirmation step: the account works immediately, so sign straight in and let
        // the redirect effect above take her to her first screen.
        const signedIn = await signIn.email({ email, password })
        if (signedIn.error) {
          setError(signedIn.error.message ?? 'Account created. Please sign in.')
          setMode('sign-in')
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="absolute top-6 right-6 no-print">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <h1 className="text-display mb-2 text-center">ExamPrep AI</h1>
        <p className="text-body text-muted-foreground mb-8 text-center">
          Find out which marks she lost because she didn't know it — and which
          because she stopped writing too early.
        </p>

        <Card>
          <CardHeader>
            <CardTitle className="text-h3">
              {mode === 'sign-in' ? 'Sign in' : 'Create your account'}
            </CardTitle>
            <CardDescription>
              {mode === 'sign-in'
                ? 'Sign in with the email and password you signed up with.'
                : accountType === 'student'
                  ? 'Create your own student login. You will set up your class and subjects next.'
                  : 'Create your parent login. You will add your child and pick her syllabus next.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'sign-up' && (
                  <>
                    <div className="space-y-1.5">
                      <Label>I am signing up as a</Label>
                      <div className="grid grid-cols-2 gap-2">
                        {(['student', 'parent'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setAccountType(t)}
                            className={
                              'rounded-md border px-3 py-2 text-sm font-medium capitalize ' +
                              (accountType === t
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-input')
                            }
                          >
                            {t === 'student' ? 'Student' : 'Parent / Guardian'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="name">
                        {accountType === 'student'
                          ? 'Your name'
                          : 'Your name (parent/guardian)'}
                      </Label>
                      <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>
                  </>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
                {mode === 'sign-up' && (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="confirm-password">Confirm password</Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                      />
                    </div>
                    {accountType === 'student' && (
                      <Label className="items-start">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={guardianOk}
                          onChange={(e) => setGuardianOk(e.target.checked)}
                        />
                        <span className="text-small font-normal">
                          My parent or guardian agrees to my using ExamPrep AI.
                        </span>
                      </Label>
                    )}
                  </>
                )}
                {error && (
                  <p className="text-small text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting
                    ? 'Please wait…'
                    : mode === 'sign-in'
                      ? 'Sign in'
                      : 'Sign up'}
                </Button>
              </form>
            }

            {mode === 'sign-in' && (
              <>
                <div className="my-4 flex items-center gap-3">
                  <div className="bg-border h-px flex-1" />
                  <span className="text-small text-muted-foreground">or</span>
                  <div className="bg-border h-px flex-1" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void handleGoogleSignIn()}
                >
                  Continue with Google
                </Button>
              </>
            )}

            {
              <p className="text-small text-muted-foreground mt-4 text-center">
                {mode === 'sign-in' ? (
                  <>
                    New here?{' '}
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => setMode('sign-up')}
                    >
                      Create an account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{' '}
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => setMode('sign-in')}
                    >
                      Sign in
                    </button>
                  </>
                )}
              </p>
            }
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

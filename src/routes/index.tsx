import { useState } from 'react'
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

function Home() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signedUp, setSignedUp] = useState(false)

  const role = (session?.user as { role?: string } | undefined)?.role

  // Only the parent role has a home to land on (/onboarding). A student or admin session has no
  // screen to redirect into yet -- bouncing them to /onboarding would immediately bounce back
  // here (it redirects anyone who isn't 'parent'), so this renders a plain signed-in notice
  // instead of looping.
  if (!isPending && session && role === 'parent') {
    navigate({ to: '/onboarding' })
  }

  if (!isPending && session && role !== 'parent') {
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
        const signedInRole = (result.data.user as { role?: string }).role
        if (signedInRole === 'parent') {
          navigate({ to: '/onboarding' })
        }
        // Any other role has no home screen yet -- staying on `/` is what shows the
        // "Signed in" notice above once useSession() picks up the new session.
      } else {
        const result = await signUp.email({ name, email, password })
        if (result.error) {
          setError(result.error.message ?? 'Sign up failed')
          return
        }
        // F006: requireEmailVerification is on and M16 (transactional email) doesn't exist yet --
        // the server logs the verification link to its own console rather than emailing it, so
        // there is nothing more this screen can do for a real user until M16 lands.
        setSignedUp(true)
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
                ? 'Parents sign in here to manage their household.'
                : 'A new account starts your own household — students are added afterwards.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {signedUp ? (
              <div className="text-body space-y-4">
                <p>
                  Account created. Check the server log for a verification link
                  (email delivery isn't wired up yet) and open it before signing
                  in.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSignedUp(false)
                    setMode('sign-in')
                  }}
                >
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'sign-up' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
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
            )}

            {!signedUp && (
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
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

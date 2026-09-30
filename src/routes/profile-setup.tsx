import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { ThemeToggle } from '../components/theme-toggle'
import { signOut, useSession } from '../lib/auth-client'
import { PageLoading } from '../components/page-loading'

export const Route = createFileRoute('/profile-setup')({
  component: ProfileSetup,
  validateSearch: (search: Record<string, unknown>): { name?: string } => ({
    name: typeof search.name === 'string' ? search.name : undefined,
  }),
})

interface Profile {
  name: string
  class: number
  board: string
  profile_complete: boolean
  subject_ids: Array<string>
}

// A student's first screen: just her name. Board, class and (indirectly) subjects are the next
// step, on /choose-board -- split out 2026-09-27 so that step can use a tile picker instead of a
// dropdown, with the class row disappearing entirely for a class-less syllabus like Civil
// Services, and so this screen stays a single, quick question.
function ProfileSetup() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [name, setName] = useState(search.name ?? '')
  const [isEdit, setIsEdit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students/me/profile')
      .then((r) => r.json())
      .then((data: { profile: Profile }) => {
        setIsEdit(data.profile.profile_complete)
        // A name already typed on this screen (e.g. coming back via choose-board's Back button)
        // wins over the saved one -- don't clobber what she just typed with a stale fetch.
        if (!search.name) setName(data.profile.name)
        setLoaded(true)
      })
  }, [isPending, session, role, navigate, search.name])

  function next(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Enter your name.')
    navigate({ to: '/choose-board', search: { name: name.trim() } })
  }

  if (isPending || !session || role !== 'student' || !loaded) {
    return <PageLoading />
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">{isEdit ? 'Your profile' : 'Set up your profile'}</h1>
          <p className="text-body text-muted-foreground">
            {isEdit ? 'Update your name, then your board and class.' : "What's your name? Your board and class come next."}
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <ThemeToggle />
          {!isEdit && (
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate({ to: '/' }))}>
              Sign out
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={next} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">About you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="student-name">Student name</Label>
              <Input
                id="student-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>
          </CardContent>
        </Card>

        {error && (
          <p className="text-small text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </div>
  )
}

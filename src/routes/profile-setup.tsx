import { useEffect, useMemo, useState } from 'react'
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
import { SubjectCard } from '../components/subject-card'
import { ThemeToggle } from '../components/theme-toggle'
import { signOut, useSession } from '../lib/auth-client'

export const Route = createFileRoute('/profile-setup')({ component: ProfileSetup })

interface ProfileSubject {
  id: string
  name: string
  code: string
  has_content: boolean
}

interface ProfileOption {
  board: string
  class: number
  subjects: Array<ProfileSubject>
}

interface Profile {
  name: string
  class: number
  board: string
  profile_complete: boolean
  subject_ids: Array<string>
}

// A student's first screen. Name, class, syllabus and at least one subject are required before
// she can reach her home page; everything the adaptive engine does starts from this profile.
function ProfileSetup() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [options, setOptions] = useState<Array<ProfileOption> | null>(null)
  const [name, setName] = useState('')
  const [board, setBoard] = useState('')
  const [classNo, setClassNo] = useState<number | null>(null)
  const [selected, setSelected] = useState<Array<string>>([])
  const [isEdit, setIsEdit] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students/me/profile')
      .then((r) => r.json())
      .then((data: { profile: Profile; options: Array<ProfileOption> }) => {
        setOptions(data.options)
        setIsEdit(data.profile.profile_complete)
        setName(data.profile.name)
        const match = data.options.find(
          (o) => o.board === data.profile.board && o.class === data.profile.class,
        )
        // A new student picks her own class: nothing is pre-selected until the profile is saved.
        const boardsOffered = [...new Set(data.options.map((o) => o.board))]
        if (data.profile.profile_complete && match) {
          setBoard(match.board)
          setClassNo(match.class)
          setSelected(data.profile.subject_ids)
        } else {
          setBoard(boardsOffered.length === 1 ? boardsOffered[0] : '')
          setClassNo(null)
          setSelected([])
        }
      })
  }, [isPending, session, role, navigate])

  const boards = useMemo(() => [...new Set((options ?? []).map((o) => o.board))], [options])
  const classes = useMemo(
    () => (options ?? []).filter((o) => o.board === board).map((o) => o.class),
    [options, board],
  )
  const subjects = useMemo(
    () => (options ?? []).find((o) => o.board === board && o.class === classNo)?.subjects ?? [],
    [options, board, classNo],
  )

  function changeBoard(next: string) {
    setBoard(next)
    setClassNo(null)
    setSelected([])
  }

  function changeClass(next: number) {
    setClassNo(next)
    setSelected([])
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id],
    )
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError('Enter your name.')
    if (classNo === null || !board) return setError('Choose your class and syllabus.')
    if (selected.length === 0) return setError('Choose at least one subject.')
    setSaving(true)
    try {
      const response = await fetch('/api/students/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, class: classNo, board, subject_ids: selected }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(typeof body?.error === 'string' ? body.error : 'Could not save. Check the form and try again.')
        return
      }
      navigate({ to: '/student' })
    } finally {
      setSaving(false)
    }
  }

  if (isPending || !session || role !== 'student' || options === null) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">{isEdit ? 'Your profile' : 'Set up your profile'}</h1>
          <p className="text-body text-muted-foreground">
            Tell us your class and subjects. Your practice papers are built around this.
          </p>
        </div>
        <div className="no-print flex items-center gap-2">
          <ThemeToggle />
          {!isEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut().then(() => navigate({ to: '/' }))}
            >
              Sign out
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">
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
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="student-class">Class</Label>
                <select
                  id="student-class"
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                  value={classNo ?? ''}
                  onChange={(e) => changeClass(Number(e.target.value))}
                >
                  <option value="" disabled>
                    Choose your class
                  </option>
                  {classes.map((c) => (
                    <option key={c} value={c}>
                      Class {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="student-board">Syllabus</Label>
                <select
                  id="student-board"
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                  value={board}
                  onChange={(e) => changeBoard(e.target.value)}
                >
                  <option value="" disabled>
                    Choose your syllabus
                  </option>
                  {boards.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Subjects you want to practise</CardTitle>
            <CardDescription>
              Tap a subject to select it. Tap again to remove it. Choose one or more.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subjects.length === 0 ? (
              <p className="text-body text-muted-foreground">
                No subjects are available for this class yet.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Subjects">
                {subjects.map((subject) => (
                  <SubjectCard
                    key={subject.id}
                    name={subject.name}
                    note={subject.has_content ? undefined : 'Practice papers coming soon'}
                    selected={selected.includes(subject.id)}
                    onToggle={() => toggle(subject.id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <p className="text-small text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={saving || selected.length === 0}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save and continue'}
        </Button>
      </form>
    </div>
  )
}

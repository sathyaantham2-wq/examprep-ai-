import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, GraduationCap, Landmark, Lock, Users } from 'lucide-react'
import { Button } from '../components/ui/button'
import { ThemeToggle } from '../components/theme-toggle'
import { cn } from '../lib/utils'
import { signOut, useSession } from '../lib/auth-client'

// Classes shown in the class list even before their content is loaded.
const PLANNED_CLASSES = [6, 7, 8, 9, 10, 11, 12]
// Competitive-exam syllabuses offered next to the school boards. They are not school classes, so
// the class list does not apply to them, and they are never saved: there is nothing to save until
// their subjects exist.
const PLANNED_SYLLABUSES = [{ value: 'planned:groups', label: 'Groups (State PSC)' }]
// The competitive-exam track is stored as board CIVILS with class 0 (no school class).
const COMPETITIVE_BOARD = 'CIVILS'
const boardLabel = (board: string) => (board === COMPETITIVE_BOARD ? 'Civil Services / UPSC' : board)
const isPlannedSyllabus = (value: string) => value.startsWith('planned:')
// A small per-board icon, purely decorative -- falls back to the graduation cap for any school
// board this list doesn't know about yet (new boards are a data load, never a code change).
const boardIcon = (board: string) => {
  if (board === COMPETITIVE_BOARD) return Landmark
  return GraduationCap
}

export const Route = createFileRoute('/choose-board')({
  component: ChooseBoard,
  validateSearch: (search: Record<string, unknown>): { name?: string } => ({
    name: typeof search.name === 'string' ? search.name : undefined,
  }),
})

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

// A shared look for both the board tiles and the class tiles: an elevated card that lifts on
// hover and gains a glowing ring once selected -- the "3D, professional" tile style requested to
// replace the old plain <select> dropdowns.
function Tile({
  selected,
  disabled,
  onClick,
  children,
  className,
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-2 rounded-xl border bg-card p-5 text-center',
        'shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] transition-all duration-200 ease-out',
        !disabled &&
          'hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_12px_24px_-8px_rgba(0,0,0,0.18)] cursor-pointer',
        !disabled && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected &&
          'border-primary ring-2 ring-primary/50 shadow-[0_12px_24px_-8px_rgba(0,0,0,0.22)] -translate-y-1',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      {selected && (
        <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
      {children}
    </button>
  )
}

// Board + class picker: the second step of setting up her profile. Not a dropdown any more (user
// decision 2026-09-27) -- boards are one row of tiles, classes are a second row of tiles that
// disappears entirely for a class-less syllabus like Civil Services, exactly like the old
// <select disabled> did, just visually clearer now that there is nothing to pick.
function ChooseBoard() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [options, setOptions] = useState<Array<ProfileOption> | null>(null)
  const [name, setName] = useState(search.name ?? '')
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
        // Prefer the name step 1 just collected; a saved profile's name only matters if this page
        // is reached directly (e.g. a refresh) without going through step 1 first.
        if (!search.name) setName(data.profile.name)
        const boardsOffered = [...new Set(data.options.map((o) => o.board))]
        const match = data.options.find(
          (o) => o.board === data.profile.board && o.class === data.profile.class,
        )
        if (data.profile.profile_complete && match) {
          setBoard(match.board)
          setClassNo(match.class)
        } else {
          setBoard(boardsOffered.includes('CBSE') ? 'CBSE' : boardsOffered.length === 1 ? boardsOffered[0] : '')
          setClassNo(null)
        }
      })
  }, [isPending, session, role, navigate, search.name])

  // No name at all (neither carried over from step 1 nor already saved) -- send her back to fill
  // it in first, rather than letting her save a nameless profile.
  useEffect(() => {
    if (options !== null && !name.trim() && !search.name) {
      navigate({ to: '/profile-setup' })
    }
  }, [options, name, search.name, navigate])

  const boards = useMemo(() => [...new Set((options ?? []).map((o) => o.board))], [options])
  const plannedBoard = isPlannedSyllabus(board)
  const competitive = board === COMPETITIVE_BOARD
  const classes = useMemo(
    () =>
      competitive
        ? []
        : [
            ...new Set([
              ...PLANNED_CLASSES,
              ...(options ?? []).filter((o) => o.board === board).map((o) => o.class),
            ]),
          ].sort((a, b) => a - b),
    [options, board, competitive],
  )
  const subjects = useMemo(
    () => (options ?? []).find((o) => o.board === board && o.class === classNo)?.subjects ?? [],
    [options, board, classNo],
  )
  const classHasSubjects = (c: number) =>
    ((options ?? []).find((o) => o.board === board && o.class === c)?.subjects.length ?? 0) > 0

  // 2026-09-24, user decision: she no longer ticks subjects here -- every subject offered for her
  // class/board is enabled automatically, and which ONE to build a paper from is chosen later, on
  // /my-paper's own Subject dropdown at generation time.
  useEffect(() => {
    setSelected(subjects.map((s) => s.id))
  }, [subjects])

  function changeBoard(next: string) {
    setBoard(next)
    setClassNo(next === COMPETITIVE_BOARD ? 0 : null)
    setError(null)
  }

  function changeClass(next: number) {
    setClassNo(next)
    setError(null)
  }

  async function save() {
    setError(null)
    if (plannedBoard) return setError('This syllabus is coming soon. Choose CBSE to continue.')
    if (classNo === null || !board) return setError('Choose your board and class.')
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
        setError(typeof body?.error === 'string' ? body.error : 'Could not save. Check your choices and try again.')
        return
      }
      // Owner decision 2026-09-23: /my-paper is her default landing page now, not /student.
      navigate({ to: '/my-paper' })
    } finally {
      setSaving(false)
    }
  }

  if (isPending || !session || role !== 'student' || options === null) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const canSave = !plannedBoard && classNo !== null && !!board && selected.length > 0

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Choose your board</h1>
          <p className="text-body text-muted-foreground">
            Pick your syllabus, then your class. Your practice papers are built around this.
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

      <section className="mb-8">
        <h2 className="text-h3 mb-3">Syllabus</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {boards.map((b) => {
            const Icon = boardIcon(b)
            return (
              <Tile key={b} selected={board === b} onClick={() => changeBoard(b)}>
                <Icon className="size-7 text-primary" strokeWidth={1.5} />
                <span className="text-body font-semibold">{boardLabel(b)}</span>
              </Tile>
            )
          })}
          {PLANNED_SYLLABUSES.map((b) => (
            <Tile key={b.value} selected={false} disabled onClick={() => {}}>
              <Users className="size-7 text-muted-foreground" strokeWidth={1.5} />
              <span className="text-body font-semibold">{b.label}</span>
              <span className="flex items-center gap-1 text-small text-muted-foreground">
                <Lock className="size-3" /> Coming soon
              </span>
            </Tile>
          ))}
        </div>
      </section>

      {board && !plannedBoard && !competitive && (
        <section className="mb-8">
          <h2 className="text-h3 mb-3">Class</h2>
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
            {classes.map((c) => {
              const hasSubjects = classHasSubjects(c)
              return (
                <Tile
                  key={c}
                  selected={classNo === c}
                  disabled={!hasSubjects}
                  onClick={() => changeClass(c)}
                >
                  <span className="text-small font-medium text-muted-foreground">Class</span>
                  <span className="text-h2 -mt-1 leading-none">{c}</span>
                  {!hasSubjects && (
                    <span className="text-small text-muted-foreground">Coming soon</span>
                  )}
                </Tile>
              )
            })}
          </div>
        </section>
      )}

      {board && competitive && (
        <p className="mb-8 text-small text-muted-foreground" role="status">
          Civil Services / UPSC has no school class -- you're all set on that front.
        </p>
      )}

      {classNo !== null && !plannedBoard && !competitive && subjects.length === 0 && (
        <p className="mb-4 text-small text-muted-foreground" role="status">
          No subjects are available for this class yet. Content is coming soon.
        </p>
      )}

      {error && (
        <p className="mb-4 text-small text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => navigate({ to: '/profile-setup', search: { name } })}>
          Back
        </Button>
        <Button onClick={save} disabled={saving || !canSave} className="flex-1">
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save and continue'}
        </Button>
      </div>
    </div>
  )
}

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
import { Label } from '../components/ui/label'
import { ThemeToggle } from '../components/theme-toggle'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/generate')({ component: GeneratePaper })

interface Student {
  id: string
  name: string
  class: number
  board: string
}

interface Subject {
  id: string
  name: string
}

interface Blueprint {
  id: string
  name: string
  total_marks: number
  duration_min: number
}

interface Chapter {
  id: string
  chapter_no: number
  name: string
  part: string
}

interface Shortfall {
  section: string
  bucket?: string
  reason: string
}

interface GenerateResult {
  paper: { id: string; total_marks: number }
  paperQuestions: Array<unknown>
  shortfalls: Array<Shortfall>
}

function GeneratePaper() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [students, setStudents] = useState<Array<Student> | null>(null)
  const [subjects, setSubjects] = useState<Array<Subject>>([])
  const [blueprints, setBlueprints] = useState<Array<Blueprint>>([])
  const [chapters, setChapters] = useState<Array<Chapter>>([])

  const [studentId, setStudentId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [blueprintId, setBlueprintId] = useState('')
  const [chapterIds, setChapterIds] = useState<Array<string>>([])

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)

  useEffect(() => {
    if (isPending) return
    // POST /api/papers/generate accepts 'student'/'parent'/'admin' -- this screen's own guard
    // excluding admin was the same gap as /onboarding's (fixed 2026-09-18): an admin household
    // had no UI path to generate a paper at all, only a direct API/script call.
    if (!session || (role !== 'parent' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students')
      .then((r) => r.json())
      .then(setStudents)
  }, [isPending, session, role, navigate])

  const selectedStudent = students?.find((s) => s.id === studentId)

  useEffect(() => {
    setSubjectId('')
    setSubjects([])
    if (!selectedStudent) return
    fetch(
      `/api/syllabus/subjects?board=${encodeURIComponent(selectedStudent.board)}&class=${selectedStudent.class}`,
    )
      .then((r) => r.json())
      .then((data: Array<Subject>) => {
        setSubjects(data)
        if (data.length === 1) setSubjectId(data[0].id)
      })
    // selectedStudent is derived from studentId + students every render -- keying off studentId
    // (a primitive) is what actually avoids re-fetching on every unrelated re-render.
  }, [studentId])

  useEffect(() => {
    setBlueprintId('')
    setBlueprints([])
    setChapterIds([])
    setChapters([])
    if (!subjectId) return
    fetch(`/api/blueprints?subject_id=${subjectId}`)
      .then((r) => r.json())
      .then(setBlueprints)
    fetch(`/api/syllabus/chapters?subject_id=${subjectId}`)
      .then((r) => r.json())
      .then(setChapters)
  }, [subjectId])

  function toggleChapter(id: string) {
    setChapterIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/papers/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          blueprint_id: blueprintId,
          chapter_ids: chapterIds,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Could not generate the paper.')
        return
      }
      setResult(body)
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Generate a paper</h1>
          <p className="text-body text-muted-foreground">
            Pick a student, a blueprint and the chapters to cover.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">New paper</CardTitle>
          <CardDescription>
            Question selection weights weak and priority concepts regardless of
            any difficulty you'd otherwise pick -- see F119.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {students !== null && students.length === 0 ? (
            <p className="text-body text-muted-foreground">
              No students yet.{' '}
              <a
                href="/onboarding"
                className="text-primary underline-offset-4 hover:underline"
              >
                Add one first
              </a>
              .
            </p>
          ) : (
            <form onSubmit={handleGenerate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="student">Student</Label>
                <select
                  id="student"
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select a student
                  </option>
                  {students?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (Class {s.class})
                    </option>
                  ))}
                </select>
              </div>

              {studentId && (
                <div className="space-y-1.5">
                  <Label htmlFor="subject">Subject</Label>
                  <select
                    id="subject"
                    className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select a subject
                    </option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {subjectId && (
                <div className="space-y-1.5">
                  <Label htmlFor="blueprint">Blueprint</Label>
                  <select
                    id="blueprint"
                    className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                    value={blueprintId}
                    onChange={(e) => setBlueprintId(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select a blueprint
                    </option>
                    {blueprints.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} — {b.total_marks} marks, {b.duration_min} min
                      </option>
                    ))}
                  </select>
                  {blueprints.length === 0 && (
                    <p className="text-small text-muted-foreground">
                      No blueprints exist for this subject yet — an admin needs
                      to author one (F029, no admin screen exists yet either).
                    </p>
                  )}
                </div>
              )}

              {subjectId && chapters.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Chapters</Label>
                  <div className="space-y-1 rounded-md border p-3">
                    {chapters.map((c) => (
                      <label
                        key={c.id}
                        className="text-small flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          checked={chapterIds.includes(c.id)}
                          onChange={() => toggleChapter(c.id)}
                        />
                        {c.part} Ch {c.chapter_no}: {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-small text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={
                  submitting ||
                  !studentId ||
                  !blueprintId ||
                  chapterIds.length === 0
                }
              >
                {submitting ? 'Generating…' : 'Generate paper'}
              </Button>
            </form>
          )}

          {result && (
            <div className="text-body mt-6 space-y-2 rounded-md border p-4">
              <p>
                Paper generated — {result.paperQuestions.length} questions,{' '}
                {result.paper.total_marks} marks.
              </p>
              {result.shortfalls.length > 0 && (
                <div className="text-small text-destructive">
                  <p className="font-medium">
                    Shortfalls (bank came up short):
                  </p>
                  <ul className="list-inside list-disc">
                    {result.shortfalls.map((s, i) => (
                      <li key={i}>
                        {s.section}
                        {s.bucket ? ` (${s.bucket})` : ''}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-small text-muted-foreground">
                There's no paper detail or PDF-download screen yet — the paper
                (id {result.paper.id}) exists in the database and its PDF can be
                fetched via the API, but only that.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

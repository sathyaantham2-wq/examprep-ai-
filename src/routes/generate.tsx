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
    if (!session || (role !== 'parent' && role !== 'admin' && role !== 'student')) {
      navigate({ to: '/' })
      return
    }
    // A student's papers are built from her own mastery on her own page.
    if (role === 'student') {
      navigate({ to: '/my-paper' })
      return
    }
    fetch('/api/students')
      .then((r) => r.json())
      .then((data: Array<Student>) => {
        setStudents(data)
        // The common case is one child -- picking her is not a real decision, so it shouldn't
        // cost a click. A household with more than one still gets the dropdown below.
        if (data.length === 1) setStudentId(data[0].id)
      })
  }, [isPending, session, role, navigate])

  const selectedStudent = students?.find((s) => s.id === studentId)

  useEffect(() => {
    setSubjectId('')
    setSubjects([])
    if (!selectedStudent) return
    fetch(
      `/api/syllabus/subjects?board=${encodeURIComponent(selectedStudent.board)}&class=${selectedStudent.class}&with_content=1`,
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
      .then((data: Array<Blueprint>) => {
        setBlueprints(data)
        // A prototype-stage subject typically has exactly one real blueprint -- asking a parent
        // to choose "which blueprint" when there is only one option is pure friction, so this
        // only becomes a visible choice once a second one genuinely exists.
        if (data.length === 1) setBlueprintId(data[0].id)
      })
    fetch(`/api/syllabus/chapters?subject_id=${subjectId}`)
      .then((r) => r.json())
      .then((data: Array<Chapter>) => {
        setChapters(data)
        // Covering every available chapter is the sensible default -- narrowing to a subset is
        // the exception, not the common case, so it starts pre-checked rather than empty.
        setChapterIds(data.map((c) => c.id))
      })
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
      // Straight to the paper's page, where the questions and the whole attempt -> review ->
      // report -> dashboard loop are laid out; an empty paper stays here with its explanation.
      if (body.paperQuestions.length > 0) {
        // A student goes back to her own page, where the new paper is waiting under "Papers to
        // attempt"; the parent-facing paper page holds the answer key and is not hers to open.
        await (role === 'student'
          ? navigate({ to: '/student' })
          : navigate({ to: '/paper/$id', params: { id: body.paper.id } }))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending || !session || (role !== 'parent' && role !== 'admin' && role !== 'student')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">
            {selectedStudent ? `Hello, ${selectedStudent.name}` : 'Generate a paper'}
          </h1>
          <p className="text-body text-muted-foreground">
            {selectedStudent
              ? 'Pick a subject and generate her next paper.'
              : 'Pick a student to get started.'}
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
              {students !== null && students.length > 1 && (
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
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (Class {s.class})
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

              {subjectId && blueprints.length > 1 && (
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
                </div>
              )}
              {subjectId && blueprints.length === 0 && (
                <p className="text-small text-muted-foreground">
                  No paper format exists for this subject yet — an admin can
                  create one at{' '}
                  <a
                    href="/admin/blueprints"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    /admin/blueprints
                  </a>
                  .
                </p>
              )}

              {subjectId && chapters.length > 1 && (
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
                {submitting ? 'Creating…' : 'Create paper'}
              </Button>
            </form>
          )}

          {result && result.paperQuestions.length === 0 ? (
            <div className="text-body mt-6 space-y-2 rounded-md border p-4">
              <p className="font-medium">
                Couldn't create a paper this time — the question bank came up
                empty for this chapter right now.
              </p>
              <p className="text-small text-muted-foreground">
                This usually means most of this chapter's questions were
                already used in a paper very recently. Try again in a little
                while, or cover a different chapter.
              </p>
              {result.shortfalls.length > 0 && (
                <ul className="text-small text-muted-foreground list-inside list-disc">
                  {result.shortfalls.map((s, i) => (
                    <li key={i}>{s.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            result && (
              <div className="text-body mt-6 space-y-3 rounded-md border p-4">
                <p>
                  Paper ready — {result.paperQuestions.length} questions,{' '}
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
                <div className="flex flex-wrap items-center gap-3">
                  <a href={`/api/papers/${result.paper.id}/pdf`} target="_blank" rel="noreferrer">
                    <Button type="button" size="sm">
                      Download PDF
                    </Button>
                  </a>
                  <p className="text-small text-muted-foreground">
                    Also ready for web practice — it'll show up in{' '}
                    {selectedStudent?.name ?? 'her'} own "Papers to attempt"
                    list next time she logs in.
                  </p>
                </div>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}

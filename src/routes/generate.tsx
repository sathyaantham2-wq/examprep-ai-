import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Label } from '../components/ui/label'
import { AppShell } from '../components/app-shell'
import { useSession } from '../lib/auth-client'
import { PAPER_THEMES, DEFAULT_THEME, THEME_BLURB } from '../lib/pdf/themes'
import type { PaperTheme } from '../lib/pdf/themes'

const FORM_ID = 'generate-paper-form'

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
  const [chapterSearch, setChapterSearch] = useState('')
  const [theme, setTheme] = useState<PaperTheme>(DEFAULT_THEME)

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<GenerateResult | null>(null)

  useEffect(() => {
    if (isPending) return
    // POST /api/papers/generate accepts 'student'/'parent'/'admin' -- this screen's own guard
    // excluding admin was the same gap as /onboarding's (fixed 2026-09-18): an admin household
    // had no UI path to generate a paper at all, only a direct API/script call.
    if (
      !session ||
      (role !== 'parent' && role !== 'admin' && role !== 'student')
    ) {
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

  // Chapters render grouped under their part (Part I / Part II / ...) rather than as one flat
  // list -- CLAUDE.md: chapter identity is (book, part, chapter_number), never the number alone,
  // and Ganita Prakash's repeated chapter numbers across parts make that distinction visible to
  // a parent, not just to the schema. Order of first appearance in the fetched list is kept. The
  // search box filters this same grouped structure by name (case-insensitive); Select All / Clear
  // All always act on every chapter, not just what the search currently shows, so the count in
  // the summary panel never surprises a parent who typed something and then clicked it.
  const chaptersByPart = useMemo(() => {
    const query = chapterSearch.trim().toLowerCase()
    const matches = query
      ? chapters.filter((c) => c.name.toLowerCase().includes(query))
      : chapters
    const groups: Array<{ part: string; chapters: Array<Chapter> }> = []
    for (const c of matches) {
      let group = groups.find((g) => g.part === c.part)
      if (!group) {
        group = { part: c.part, chapters: [] }
        groups.push(group)
      }
      group.chapters.push(c)
    }
    return groups
  }, [chapters, chapterSearch])

  const selectedBlueprint = blueprints.find((b) => b.id === blueprintId)

  // A lightweight progress indicator, not a wizard gate -- every card is always visible and
  // fillable in order top to bottom (F032/F119's shortfall and weighting disclosures need to stay
  // reachable regardless of "step"), this just reflects how far along a parent already is.
  const currentStep =
    !studentId || !subjectId ? 1 : chapterIds.length === 0 ? 2 : 3
  const readyToGenerate =
    Boolean(studentId) && Boolean(blueprintId) && chapterIds.length > 0

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
          theme,
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

  if (
    isPending ||
    !session ||
    (role !== 'parent' && role !== 'admin' && role !== 'student')
  ) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const resultPanel = result && (
    <div className="mt-6">
      {result.paperQuestions.length === 0 ? (
        <div className="text-body space-y-2 rounded-md border p-4">
          <p className="font-medium">
            Couldn't create a paper this time — the question bank came up empty
            for this chapter right now.
          </p>
          <p className="text-small text-muted-foreground">
            This usually means most of this chapter's questions were already
            used in a paper very recently. Try again in a little while, or cover
            a different chapter.
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
        <div className="text-body bg-primary/5 border-primary/20 space-y-3 rounded-md border p-4">
          <p>
            Paper ready — {result.paperQuestions.length} questions,{' '}
            {result.paper.total_marks} marks.
          </p>
          {result.shortfalls.length > 0 && (
            <div className="text-small text-destructive">
              <p className="font-medium">Shortfalls (bank came up short):</p>
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
            <a
              href={`/api/papers/${result.paper.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <Button type="button" size="sm">
                Download PDF
              </Button>
            </a>
            <p className="text-small text-muted-foreground">
              Also ready for web practice — it'll show up in{' '}
              {selectedStudent?.name ?? 'her'} own "Papers to attempt" list next
              time she logs in.
            </p>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <AppShell active="generate" studentId={studentId || undefined}>
      <div className="mx-auto max-w-5xl p-6 md:p-8">
        {/* Hero: the app's own tokens (primary at low opacity), not a stock sky-gradient
            illustration -- one original line-art icon, no purchased/AI-trope artwork. */}
        <div className="from-primary/10 via-card to-card border-border relative mb-6 overflow-hidden rounded-2xl border bg-gradient-to-br p-6 sm:p-8">
          <div className="max-w-lg">
            <h1 className="display-title text-display">
              {selectedStudent
                ? `Generate ${selectedStudent.name}'s question paper`
                : 'Generate a question paper'}
            </h1>
            <p className="text-body text-muted-foreground mt-2">
              {selectedStudent
                ? 'Pick a subject and the chapters to cover -- weak and priority concepts are weighted in automatically.'
                : 'Pick a student to get started.'}
            </p>
            {selectedStudent && (
              <span className="text-caption text-muted-foreground border-border bg-card mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1">
                {selectedStudent.board} · Class {selectedStudent.class}
              </span>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                'Quick & easy',
                'Matches her syllabus',
                'Built for practice',
              ].map((label) => (
                <span
                  key={label}
                  className="text-caption bg-card border-border inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-primary"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {label}
                </span>
              ))}
            </div>
          </div>
          <svg
            width="96"
            height="96"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary/25 pointer-events-none absolute right-4 bottom-0 hidden sm:block md:right-8"
            aria-hidden="true"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
            <path d="M9 7h7M9 11h7" />
          </svg>
        </div>

        {/* Progress indicator -- reflects where a parent already is, never hides a card. */}
        <div className="no-print mb-8 flex items-center gap-3">
          {(
            ['Select subject', 'Choose chapters', 'Review & generate'] as const
          ).map((label, i) => {
            const step = i + 1
            const state =
              step < currentStep
                ? 'done'
                : step === currentStep
                  ? 'active'
                  : 'upcoming'
            return (
              <div
                key={label}
                className="flex flex-1 items-center gap-3 last:flex-none"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={
                      state === 'upcoming'
                        ? 'border-border text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold'
                        : 'bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold'
                    }
                  >
                    {state === 'done' ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      step
                    )}
                  </div>
                  <span
                    className={
                      state === 'upcoming'
                        ? 'text-small text-muted-foreground hidden sm:inline'
                        : 'text-small hidden font-medium sm:inline'
                    }
                  >
                    {label}
                  </span>
                </div>
                {step < 3 && (
                  <div
                    className={
                      state === 'done'
                        ? 'bg-primary h-px flex-1'
                        : 'bg-border h-px flex-1'
                    }
                  />
                )}
              </div>
            )
          })}
        </div>

        {students !== null && students.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
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
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-6 md:col-span-2">
              <form
                id={FORM_ID}
                onSubmit={handleGenerate}
                className="space-y-6"
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="text-h3">
                      1 · Student &amp; subject
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
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
                              {b.name} — {b.total_marks} marks, {b.duration_min}{' '}
                              min
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {subjectId && blueprints.length === 0 && (
                      <p className="text-small text-muted-foreground">
                        No paper format exists for this subject yet — an admin
                        can create one at{' '}
                        <a
                          href="/admin/blueprints"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          /admin/blueprints
                        </a>
                        .
                      </p>
                    )}
                  </CardContent>
                </Card>

                {subjectId && chapters.length > 1 && (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-3">
                        <CardTitle className="text-h3">2 · Chapters</CardTitle>
                        <span className="text-caption text-muted-foreground bg-muted rounded-full px-2.5 py-1">
                          {chapters.length} chapters available
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      <div className="flex flex-wrap gap-2">
                        <div className="border-input flex h-9 flex-1 items-center gap-2 rounded-md border px-3">
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-muted-foreground shrink-0"
                          >
                            <circle cx="11" cy="11" r="7" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                          <input
                            type="text"
                            value={chapterSearch}
                            onChange={(e) => setChapterSearch(e.target.value)}
                            placeholder="Search chapters…"
                            className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setChapterIds(chapters.map((c) => c.id))
                          }
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setChapterIds([])}
                        >
                          Clear all
                        </Button>
                      </div>
                      {chaptersByPart.length === 0 && (
                        <p className="text-small text-muted-foreground">
                          No chapter matches "{chapterSearch}".
                        </p>
                      )}
                      {chaptersByPart.map((group) => (
                        <div key={group.part}>
                          <div className="text-caption text-muted-foreground mb-2 font-semibold tracking-wide uppercase">
                            Part {group.part}
                          </div>
                          <div className="rounded-md border">
                            {group.chapters.map((c) => (
                              <label
                                key={c.id}
                                className="text-small hover:bg-muted/50 flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                              >
                                <input
                                  type="checkbox"
                                  checked={chapterIds.includes(c.id)}
                                  onChange={() => toggleChapter(c.id)}
                                  className="size-4 shrink-0"
                                />
                                <span>
                                  {c.part} Ch {c.chapter_no}: {c.name}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {subjectId && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-h3">3 · Theme</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {PAPER_THEMES.map((t) => (
                          <label
                            key={t}
                            className={`has-[:focus-visible]:ring-ring flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 ${
                              theme === t
                                ? 'border-primary bg-primary/5 ring-primary ring-1'
                                : 'border-input hover:bg-muted/50'
                            }`}
                          >
                            <input
                              type="radio"
                              name="theme"
                              value={t}
                              checked={theme === t}
                              onChange={() => setTheme(t)}
                              className="sr-only"
                            />
                            <span className="text-small font-semibold">
                              {t}
                            </span>
                            <span className="text-caption text-muted-foreground">
                              {THEME_BLURB[t]}
                            </span>
                          </label>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {error && (
                  <p className="text-small text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </form>

              {resultPanel}
            </div>

            <div className="md:col-span-1">
              <Card className="md:sticky md:top-6">
                <CardHeader>
                  <CardTitle className="text-h3">Paper summary</CardTitle>
                </CardHeader>
                <CardContent className="text-small space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Subject</span>
                    <span className="font-medium">
                      {subjects.find((s) => s.id === subjectId)?.name ?? '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Format</span>
                    <span className="font-medium">
                      {selectedBlueprint
                        ? `${selectedBlueprint.total_marks} marks · ${selectedBlueprint.duration_min} min`
                        : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Chapters</span>
                    <span className="font-medium">
                      {chapterIds.length} of {chapters.length} selected
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Theme</span>
                    <span className="font-medium">{theme}</span>
                  </div>
                  <div className="bg-muted text-caption text-muted-foreground rounded-md p-3 leading-relaxed">
                    Question selection weights weak and priority concepts
                    regardless of any difficulty you'd otherwise pick — see
                    F119.
                  </div>

                  <div
                    className={
                      readyToGenerate
                        ? 'bg-primary/5 border-primary/20 flex gap-2.5 rounded-md border p-3'
                        : 'bg-muted flex gap-2.5 rounded-md p-3'
                    }
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={
                        readyToGenerate
                          ? 'text-primary mt-0.5 shrink-0'
                          : 'text-muted-foreground mt-0.5 shrink-0'
                      }
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    <div>
                      <p className="text-small font-semibold">
                        {readyToGenerate
                          ? 'Ready to generate!'
                          : 'Almost there'}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {readyToGenerate
                          ? "Her paper will be built from the chapters and theme you've chosen."
                          : 'Pick a student, subject and at least one chapter to continue.'}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    form={FORM_ID}
                    size="lg"
                    className="w-full"
                    disabled={submitting || !readyToGenerate}
                  >
                    {submitting ? 'Creating…' : 'Generate question paper'}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

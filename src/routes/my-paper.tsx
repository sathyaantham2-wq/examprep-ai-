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
import { SubjectCard } from '../components/subject-card'
import { AppShell } from '../components/app-shell'
import { useSession } from '../lib/auth-client'
import { PAPER_THEMES, DEFAULT_THEME, THEME_BLURB } from '../lib/pdf/themes'
import type { PaperTheme } from '../lib/pdf/themes'

export const Route = createFileRoute('/my-paper')({
  component: MyPaper,
  validateSearch: (search: Record<string, unknown>): { subject?: string } => ({
    subject: typeof search.subject === 'string' ? search.subject : undefined,
  }),
})

interface ProfileSubject {
  id: string
  name: string
  has_content: boolean
}

interface PlanConcept {
  concept_id: string
  concept_name: string
  chapter_name: string
  level_name: string
  mastery_score: number | null
  mastery_level: string | null
  questions_planned: number
  reasons: Array<string>
}

interface Plan {
  subject_name: string
  is_initial_assessment: boolean
  chapters: Array<{
    id: string
    name: string
    part: string
    chapter_no: number
  }>
  concepts: Array<PlanConcept>
  total_questions: number
  total_marks: number
  difficulty_range: { min: string; max: string }
  estimated_minutes: number
  question_types: Array<string>
}

interface ChapterChoice {
  id: string
  name: string
  part: string
  chapter_no: number
}

// "Generate My Question Paper": the recommendation comes from her own concept mastery. She can
// accept it as it is, or change the chapters, then start the test.
function MyPaper() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const search = Route.useSearch()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [subjects, setSubjects] = useState<Array<ProfileSubject>>([])
  const [subjectId, setSubjectId] = useState('')
  const [allChapters, setAllChapters] = useState<Array<ChapterChoice>>([])
  const [chapterIds, setChapterIds] = useState<Array<string> | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // No F-number covers the adaptive layer itself yet (see memory examprep_adaptive_learning.md)
  // -- this rides the same already-Done F034/F120 theme pack pipeline the parent's /generate
  // screen exposes, just on the student's own paper. Hers to pick: it only changes how the PDF
  // looks, never a mark or a question.
  const [theme, setTheme] = useState<PaperTheme>(DEFAULT_THEME)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/students/me/profile')
      .then((r) => r.json())
      .then(
        (data: {
          profile: { board: string; class: number; subject_ids: Array<string> }
          options: Array<{
            board: string
            class: number
            subjects: Array<ProfileSubject>
          }>
        }) => {
          const offered =
            data.options.find(
              (o) =>
                o.board === data.profile.board &&
                o.class === data.profile.class,
            )?.subjects ?? []
          const mine = offered.filter((s) =>
            data.profile.subject_ids.includes(s.id),
          )
          setSubjects(mine)
          const preferred = mine.find(
            (s) => s.id === search.subject && s.has_content,
          )
          const first = preferred ?? mine.find((s) => s.has_content)
          if (first) setSubjectId(first.id)
        },
      )
  }, [isPending, session, role, navigate, search.subject])

  useEffect(() => {
    setPlan(null)
    setChapterIds(null)
    setAllChapters([])
    if (!subjectId) return
    fetch(`/api/syllabus/chapters?subject_id=${subjectId}`)
      .then((r) => r.json())
      .then((data: Array<ChapterChoice>) => setAllChapters(data))
    void loadPlan(subjectId, null)
  }, [subjectId])

  async function loadPlan(subject: string, chapters: Array<string> | null) {
    setLoadingPlan(true)
    setError(null)
    try {
      const query = new URLSearchParams({ subject_id: subject })
      if (chapters && chapters.length > 0)
        query.set('chapter_ids', chapters.join(','))
      const response = await fetch(`/api/adaptive/plan?${query}`)
      const body = await response.json()
      if (!response.ok) {
        setPlan(null)
        setError(body.message ?? 'Could not prepare your paper.')
        return
      }
      setPlan(body)
      if (chapters === null)
        setChapterIds(body.chapters.map((c: { id: string }) => c.id))
    } finally {
      setLoadingPlan(false)
    }
  }

  function toggleChapter(id: string) {
    const current = chapterIds ?? []
    const next = current.includes(id)
      ? current.filter((c) => c !== id)
      : [...current, id]
    if (next.length === 0) return
    setChapterIds(next)
    void loadPlan(subjectId, next)
  }

  async function startTest() {
    if (!plan || !chapterIds) return
    setStarting(true)
    setError(null)
    try {
      const generated = await fetch('/api/papers/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          adaptive: true,
          subject_id: subjectId,
          chapter_ids: chapterIds,
          theme,
        }),
      })
      const paper = await generated.json()
      if (!generated.ok) {
        setError(
          paper.message ??
            (typeof paper.error === 'string'
              ? paper.error
              : 'Could not create the paper.'),
        )
        return
      }
      if (paper.paperQuestions.length === 0) {
        setError(
          'The question bank ran short for these chapters right now. Try other chapters or try again later.',
        )
        return
      }
      const attempt = await fetch('/api/attempts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paper_id: paper.paper.id, mode: 'online' }),
      })
      const started = await attempt.json()
      if (!attempt.ok) {
        setError(
          typeof started.error === 'string'
            ? started.error
            : 'Could not start the test.',
        )
        return
      }
      await navigate({ to: '/attempt/$id', params: { id: started.id } })
    } finally {
      setStarting(false)
    }
  }

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const withContent = subjects.filter((s) => s.has_content)

  return (
    <AppShell variant="student" active="generate">
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        {/* Hero: same treatment as the parent's /generate -- the app's own --primary token at low
          opacity, one original line-art icon, never a stock illustration. */}
        <div className="from-primary/10 via-card to-card border-border relative mb-6 overflow-hidden rounded-2xl border bg-gradient-to-br p-6 sm:p-8">
          <div className="max-w-lg">
            <h1 className="display-title text-display">
              Generate my question paper
            </h1>
            <p className="text-body text-muted-foreground mt-2">
              Built from what you already know and what needs more practice.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['Personalised for you', 'Graded instantly', 'No pressure'].map(
                (label) => (
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
                ),
              )}
            </div>
          </div>
          <svg
            width="80"
            height="80"
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

        {subjects.length > 0 && withContent.length === 0 && (
          <Card>
            <CardContent className="text-body pt-6 text-muted-foreground">
              Practice papers for your subjects are coming soon.{' '}
              <a
                href="/profile-setup"
                className="text-primary underline-offset-4 hover:underline"
              >
                Change subjects
              </a>
            </CardContent>
          </Card>
        )}

        {withContent.length > 1 && (
          <div
            className="mb-4 grid gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label="Subject"
          >
            {withContent.map((s) => (
              <SubjectCard
                key={s.id}
                name={s.name}
                selected={s.id === subjectId}
                onToggle={() => setSubjectId(s.id)}
              />
            ))}
          </div>
        )}

        {loadingPlan && !plan && (
          <p className="text-body text-muted-foreground">
            Preparing your paper…
          </p>
        )}

        {plan && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">
                  {plan.is_initial_assessment
                    ? 'Your first assessment'
                    : `${plan.subject_name} practice`}
                </CardTitle>
                <CardDescription>
                  {plan.is_initial_assessment
                    ? 'Easy questions to find out what you already know. There is no pressure.'
                    : 'More questions on concepts you are still learning, a few revision questions on the ones you know well.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="text-body grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  <div>
                    <dt className="text-small text-muted-foreground">
                      Subject
                    </dt>
                    <dd>{plan.subject_name}</dd>
                  </div>
                  <div>
                    <dt className="text-small text-muted-foreground">
                      Questions
                    </dt>
                    <dd>
                      {plan.total_questions} ({plan.total_marks} marks)
                    </dd>
                  </div>
                  <div>
                    <dt className="text-small text-muted-foreground">
                      Difficulty
                    </dt>
                    <dd>
                      {plan.difficulty_range.min === plan.difficulty_range.max
                        ? plan.difficulty_range.min
                        : `${plan.difficulty_range.min} to ${plan.difficulty_range.max}`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-small text-muted-foreground">Time</dt>
                    <dd>About {plan.estimated_minutes} min</dd>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <dt className="text-small text-muted-foreground">
                      Question types
                    </dt>
                    <dd>{plan.question_types.join(', ')}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            {allChapters.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-h3">Chapters</CardTitle>
                  <CardDescription>
                    We picked these for you. You can change them.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  {allChapters.map((c) => (
                    <label
                      key={c.id}
                      className="text-small flex items-center gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={(chapterIds ?? []).includes(c.id)}
                        onChange={() => toggleChapter(c.id)}
                      />
                      {c.part} Ch {c.chapter_no}: {c.name}
                    </label>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* "What this paper covers" (plan.concepts breakdown) is intentionally hidden
                here at the user's request -- the data is still fetched and used elsewhere
                on this screen (summary fields above), just not rendered as its own table. */}

            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Paper look</CardTitle>
                <CardDescription>
                  Just the PDF's style -- pick whichever you like.
                </CardDescription>
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
                      <span className="text-small font-semibold">{t}</span>
                      <span className="text-caption text-muted-foreground">
                        {THEME_BLURB[t]}
                      </span>
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            {error && (
              <p className="text-small text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              className="w-full"
              size="lg"
              disabled={starting || loadingPlan}
              onClick={() => void startTest()}
            >
              {starting ? 'Getting your test ready…' : 'Start test'}
            </Button>
          </div>
        )}

        {!plan && error && (
          <p className="text-small text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </AppShell>
  )
}

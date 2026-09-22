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
import { AppShell } from '../components/app-shell'
import { useSession } from '../lib/auth-client'
import { DEFAULT_THEME } from '../lib/pdf/themes'

export const Route = createFileRoute('/my-paper')({
  component: MyPaper,
  validateSearch: (search: Record<string, unknown>): { subject?: string } => ({
    subject: typeof search.subject === 'string' ? search.subject : undefined,
  }),
})

// Real tiers, not "Medium" -- same DIFFICULTY_TIERS /generate.tsx uses (sourced from
// src/routes/api/papers/generate.ts). '' means no ceiling (F119's default: every difficulty
// stays eligible, weighted toward weak/priority concepts).
const DIFFICULTY_TIERS = ['Easy', 'Hard', 'Hardest'] as const
type DifficultyTier = (typeof DIFFICULTY_TIERS)[number]

// Mirrors src/lib/adaptive/plan.ts's QUESTION_COUNT_OPTIONS -- kept as a local literal rather
// than an import, since that file pulls in server-only modules (db/connection, pg) that must
// never end up in the client bundle.
const QUESTION_COUNT_OPTIONS = [10, 20, 30] as const

const QUESTION_TYPES = [
  { value: 'combined', label: 'Combined' },
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'written', label: 'Written' },
] as const
type QuestionType = (typeof QUESTION_TYPES)[number]['value']

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
  // No F-number covers the adaptive layer itself yet (see memory examprep_adaptive_learning.md).
  // The theme picker was removed from this screen at the user's request -- every paper from here
  // still renders through the same already-Done F034/F120 theme pack pipeline, just fixed to the
  // default theme rather than exposing a choice.

  // Real, student-driven controls -- unlike the theme, these actually change what gets generated
  // (buildPaperPlan honours all three; difficulty_ceiling already worked for adaptive papers
  // before this screen exposed it, same as /generate's F119 selector).
  const [questionCount, setQuestionCount] =
    useState<(typeof QUESTION_COUNT_OPTIONS)[number]>(10)
  const [questionType, setQuestionType] = useState<QuestionType>('combined')
  const [difficultyCeiling, setDifficultyCeiling] = useState<
    DifficultyTier | ''
  >('')

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
          profile: { board: string; class: number }
          options: Array<{
            board: string
            class: number
            subjects: Array<ProfileSubject>
          }>
        }) => {
          // Every subject offered for her board + class, not just the ones she pre-selected
          // during profile setup -- picking a subject now happens right here, at generation
          // time, instead of being locked in earlier.
          const offered =
            data.options.find(
              (o) =>
                o.board === data.profile.board &&
                o.class === data.profile.class,
            )?.subjects ?? []
          setSubjects(offered)
          const preferred = offered.find(
            (s) => s.id === search.subject && s.has_content,
          )
          const first = preferred ?? offered.find((s) => s.has_content)
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
    void loadPlan(subjectId, null, questionCount, questionType)
    // Only the subject should reset chapters and re-fetch them -- questionCount/questionType
    // changes reuse the current chapter selection via their own handlers (updateQuestionCount/
    // updateQuestionType below) instead of an effect, so they're deliberately not dependencies
    // here.
  }, [subjectId])

  async function loadPlan(
    subject: string,
    chapters: Array<string> | null,
    count: number,
    type: QuestionType,
  ) {
    setLoadingPlan(true)
    setError(null)
    try {
      const query = new URLSearchParams({
        subject_id: subject,
        question_count: String(count),
        question_type: type,
      })
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
    void loadPlan(subjectId, next, questionCount, questionType)
  }

  function updateQuestionCount(count: (typeof QUESTION_COUNT_OPTIONS)[number]) {
    setQuestionCount(count)
    if (subjectId) void loadPlan(subjectId, chapterIds, count, questionType)
  }

  function updateQuestionType(type: QuestionType) {
    setQuestionType(type)
    if (subjectId) void loadPlan(subjectId, chapterIds, questionCount, type)
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
          theme: DEFAULT_THEME,
          adaptive_question_count: questionCount,
          adaptive_question_type: questionType,
          ...(difficultyCeiling
            ? { difficulty_ceiling: difficultyCeiling }
            : {}),
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

        {withContent.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-h3">Assessment details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="my-paper-subject">Subject</Label>
                  <select
                    id="my-paper-subject"
                    className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                    value={subjectId}
                    onChange={(e) => setSubjectId(e.target.value)}
                  >
                    {withContent.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="my-paper-questions">Questions</Label>
                  <select
                    id="my-paper-questions"
                    className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                    value={questionCount}
                    onChange={(e) =>
                      updateQuestionCount(
                        Number(e.target.value) as (typeof QUESTION_COUNT_OPTIONS)[number],
                      )
                    }
                  >
                    {QUESTION_COUNT_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n} questions
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="my-paper-difficulty">Difficulty</Label>
                  <select
                    id="my-paper-difficulty"
                    className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                    value={difficultyCeiling}
                    onChange={(e) =>
                      setDifficultyCeiling(e.target.value as DifficultyTier | '')
                    }
                  >
                    <option value="">Any (auto)</option>
                    {DIFFICULTY_TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label>Time</Label>
                  <div className="border-input text-muted-foreground flex h-9 w-full items-center gap-2 rounded-md border bg-transparent px-3 text-sm">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 3" />
                    </svg>
                    {plan ? `About ${plan.estimated_minutes} min` : '—'}
                  </div>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="my-paper-question-type">
                    Question type
                  </Label>
                  <select
                    id="my-paper-question-type"
                    className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                    value={questionType}
                    onChange={(e) =>
                      updateQuestionType(e.target.value as QuestionType)
                    }
                  >
                    {QUESTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="text-caption text-muted-foreground mt-3">
                {plan
                  ? `This paper will have ${plan.total_questions} question${plan.total_questions === 1 ? '' : 's'} (${plan.total_marks} marks) -- ${plan.question_types.join(', ')}. Weak and priority concepts still get more questions, same as F119.`
                  : loadingPlan
                    ? 'Preparing your paper…'
                    : questionType === 'written'
                      ? "Written practice only appears once she's ready for it -- if she isn't yet, this falls back to multiple choice."
                      : 'Weak and priority concepts get more questions, same as F119.'}
              </p>
            </CardContent>
          </Card>
        )}

        {plan && (
          <div className="space-y-4">
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

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './ui/card'

export interface ConceptView {
  concept_id: string
  concept_code: string
  concept_name: string
  mastery_score: number | null
  mastery_level: string
  current_difficulty: string
  accuracy: number | null
  recent_accuracy: number | null
  questions_attempted: number
  retention: string
  why: Array<string>
  video_url: string | null
  video_title: string | null
}

export interface ChapterView {
  chapter_id: string
  chapter_name: string
  part: string
  chapter_no: number
  average_mastery: number | null
  concepts: Array<ConceptView>
}

export interface SubjectView {
  subject_id: string
  subject_name: string
  has_content: boolean
  concepts_total: number
  concepts_assessed: number
  average_mastery: number | null
  mastered_count: number
  chapters: Array<ChapterView>
}

interface Brief {
  concept_id: string
  concept_name: string
  subject_name: string
  mastery_score: number
  mastery_level: string
  video_url?: string | null
  video_title?: string | null
}

// Links are shown to a student, so only real https addresses are made clickable.
export function VideoLink({
  url,
  title,
}: {
  url: string | null | undefined
  title?: string | null
}) {
  if (!url || !url.startsWith('https://')) return null
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-small text-primary inline-block underline-offset-4 hover:underline"
    >
      Watch: {title ?? 'concept video'}
    </a>
  )
}

export interface AdaptiveOverviewData {
  student: { id: string; name: string; class: number; board: string }
  subjects: Array<SubjectView>
  overall: {
    concepts_total: number
    concepts_assessed: number
    average_mastery: number | null
    mastered_count: number
  }
  current_difficulty: string
  strong_concepts: Array<Brief>
  needs_improvement: Array<Brief>
  retention_due: Array<{
    concept_id: string
    concept_name: string
    subject_name: string
  }>
  recommended_next: {
    subject_id: string
    subject_name: string
    chapter_name: string
    concept_name: string
    level: string
    current_difficulty: string
    recommended_difficulty: string
    is_initial_assessment: boolean
    video_url: string | null
    video_title: string | null
  } | null
}

// One shade family for every level, so no level reads as a warning colour.
const LEVEL_STYLE: Record<string, string> = {
  'Not started': 'bg-muted text-muted-foreground',
  Beginner: 'bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  Developing: 'bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-50',
  Proficient: 'bg-blue-200 text-blue-950 dark:bg-blue-800 dark:text-blue-50',
  Advanced: 'bg-blue-500 text-white',
  Mastered: 'bg-blue-700 text-white',
}

export function LevelBadge({ level }: { level: string }) {
  return (
    <span
      className={`text-small inline-block rounded-full px-2.5 py-0.5 font-medium ${LEVEL_STYLE[level] ?? LEVEL_STYLE['Not started']}`}
    >
      {level}
    </span>
  )
}

export function ScoreBar({ score }: { score: number | null }) {
  const pct = Math.max(0, Math.min(100, score ?? 0))
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded-full"
      role="img"
      aria-label={
        score === null
          ? 'Not started'
          : `Mastery ${Math.round(score)} out of 100`
      }
    >
      <div
        className="h-full rounded-full bg-blue-600"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-card border-border rounded-xl border p-4">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-h2 mt-1 font-semibold">{value}</dd>
    </div>
  )
}

/**
 * The student's own progress overview on /student.
 *
 * Reworked for readability (2026-09-30): this used to print every concept of every enrolled
 * subject as one long open list -- several hundred rows once a student is enrolled in all of her
 * class's subjects -- with the one thing she should do next buried among them. Order now follows
 * what she needs first: what to do next, papers waiting, a four-number summary, what needs work,
 * and only then the per-subject detail, which stays collapsed until she opens a subject. The
 * "Welcome" card moved into /student's own page header.
 */
export function AdaptiveOverview({
  data,
  afterRecommended,
}: {
  data: AdaptiveOverviewData
  afterRecommended?: ReactNode
}) {
  const [openConcept, setOpenConcept] = useState<string | null>(null)
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(new Set())
  const next = data.recommended_next

  function toggleSubject(id: string) {
    setOpenSubjects((prev) => {
      const updated = new Set(prev)
      if (updated.has(id)) updated.delete(id)
      else updated.add(id)
      return updated
    })
  }

  return (
    <div className="space-y-4">
      {next && (
        <div className="from-primary/15 via-card to-card border-primary/40 rounded-2xl border bg-gradient-to-br p-5">
          <p className="text-caption text-primary font-semibold tracking-wide uppercase">
            Recommended next
          </p>
          <h2 className="text-h2 mt-1">{next.concept_name}</h2>
          <p className="text-small text-muted-foreground mt-1">
            {next.subject_name} · {next.chapter_name}
          </p>
          <p className="text-small text-muted-foreground mt-2">
            {next.is_initial_assessment
              ? 'Start with a short Easy assessment so we can find your level.'
              : `Your level: ${next.level === 'Not started' ? 'not assessed yet' : next.level} · Suggested difficulty: ${next.recommended_difficulty}`}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <a href={`/my-paper?subject=${next.subject_id}`}>
              <Button>
                {next.is_initial_assessment
                  ? 'Take my first assessment'
                  : 'Generate my question paper'}
              </Button>
            </a>
            {!next.is_initial_assessment && (
              <VideoLink url={next.video_url} title={next.video_title} />
            )}
          </div>
        </div>
      )}

      {afterRecommended}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Average mastery"
          value={
            data.overall.average_mastery === null
              ? '–'
              : Math.round(data.overall.average_mastery)
          }
        />
        <StatTile
          label="Concepts started"
          value={
            <>
              {data.overall.concepts_assessed}
              <span className="text-small text-muted-foreground font-normal">
                {' '}
                of {data.overall.concepts_total}
              </span>
            </>
          }
        />
        <StatTile label="Mastered" value={data.overall.mastered_count} />
        <StatTile label="Current difficulty" value={data.current_difficulty} />
      </dl>

      {(data.needs_improvement.length > 0 ||
        data.retention_due.length > 0 ||
        data.strong_concepts.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.needs_improvement.length > 0 && (
            <Card className="border-primary/40">
              <CardHeader>
                <CardTitle className="text-h3">Needs improvement</CardTitle>
                <CardDescription>
                  {data.needs_improvement.length} concept
                  {data.needs_improvement.length === 1 ? '' : 's'} could use
                  more practice. These get more questions in your next paper.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <a href="/needs-improvement">
                  <Button size="sm">See what needs improvement</Button>
                </a>
              </CardContent>
            </Card>
          )}
          {data.retention_due.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Time to revise</CardTitle>
                <CardDescription>
                  You knew these well. A quick revision keeps them fresh.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-body list-inside list-disc space-y-1">
                  {data.retention_due.map((c) => (
                    <li key={c.concept_id}>{c.concept_name}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {data.strong_concepts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Strong concepts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.strong_concepts.map((c) => (
                  <div
                    key={c.concept_id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-body">{c.concept_name}</span>
                    <LevelBadge level={c.mastery_level} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {data.subjects.length > 0 && (
        <div className="space-y-3 pt-2">
          <h2 className="text-h3">Your subjects</h2>
          {data.subjects.map((subject) => {
            const open = openSubjects.has(subject.subject_id)
            const startedPct =
              subject.concepts_total > 0
                ? Math.round(
                    (subject.concepts_assessed / subject.concepts_total) * 100,
                  )
                : 0
            return (
              <Card key={subject.subject_id} className="gap-0 py-0">
                <button
                  type="button"
                  onClick={() => toggleSubject(subject.subject_id)}
                  aria-expanded={subject.has_content ? open : undefined}
                  disabled={!subject.has_content}
                  className="hover:bg-muted/40 flex w-full items-center gap-4 rounded-xl p-4 text-left disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold">
                      {subject.subject_name}
                    </p>
                    <p className="text-small text-muted-foreground">
                      {subject.has_content
                        ? `${subject.concepts_assessed} of ${subject.concepts_total} concepts started` +
                          (subject.average_mastery === null
                            ? ''
                            : ` · average mastery ${Math.round(subject.average_mastery)}`)
                        : 'Practice papers coming soon'}
                    </p>
                    {subject.has_content && (
                      <div
                        className="bg-muted mt-2 h-1.5 w-full overflow-hidden rounded-full"
                        aria-hidden="true"
                      >
                        <div
                          className="bg-primary h-full rounded-full"
                          style={{ width: `${startedPct}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {subject.has_content && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                      {open ? 'Hide' : 'Details'}
                      <ChevronIcon open={open} />
                    </span>
                  )}
                </button>
                {subject.has_content && open && (
                  <CardContent className="border-border space-y-5 border-t px-4 py-4">
                    {subject.chapters.map((chapter) => (
                      <div key={chapter.chapter_id}>
                        <p className="text-body mb-2 font-medium">
                          {chapter.part} Ch {chapter.chapter_no}:{' '}
                          {chapter.chapter_name}
                        </p>
                        <div className="space-y-2">
                          {chapter.concepts.map((concept) => {
                            const conceptOpen =
                              openConcept === concept.concept_id
                            return (
                              <div
                                key={concept.concept_id}
                                className="rounded-md border p-3"
                              >
                                <button
                                  type="button"
                                  className="flex w-full items-center justify-between gap-3 text-left"
                                  aria-expanded={conceptOpen}
                                  onClick={() =>
                                    setOpenConcept(
                                      conceptOpen ? null : concept.concept_id,
                                    )
                                  }
                                >
                                  <span className="text-body">
                                    {concept.concept_name}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-2">
                                    <span className="text-small text-muted-foreground w-8 text-right">
                                      {concept.mastery_score === null
                                        ? '–'
                                        : Math.round(concept.mastery_score)}
                                    </span>
                                    <LevelBadge level={concept.mastery_level} />
                                  </span>
                                </button>
                                <div className="mt-2">
                                  <ScoreBar score={concept.mastery_score} />
                                </div>
                                {conceptOpen && (
                                  <div className="text-small text-muted-foreground mt-3 space-y-1">
                                    <p>
                                      Difficulty now:{' '}
                                      {concept.current_difficulty} ·{' '}
                                      {concept.questions_attempted} questions
                                      answered
                                      {concept.accuracy !== null &&
                                        ` · accuracy ${Math.round(concept.accuracy)}%`}
                                      {concept.recent_accuracy !== null &&
                                        ` · recent ${Math.round(concept.recent_accuracy)}%`}
                                    </p>
                                    {concept.why.map((line, i) => (
                                      <p key={i}>{line}</p>
                                    ))}
                                    <VideoLink
                                      url={concept.video_url}
                                      title={concept.video_title}
                                    />
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

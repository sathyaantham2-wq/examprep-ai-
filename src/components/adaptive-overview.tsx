import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

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
export function VideoLink({ url, title }: { url: string | null | undefined; title?: string | null }) {
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
  retention_due: Array<{ concept_id: string; concept_name: string; subject_name: string }>
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
      aria-label={score === null ? 'Not started' : `Mastery ${Math.round(score)} out of 100`}
    >
      <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function AdaptiveOverview({
  data,
  afterRecommended,
}: {
  data: AdaptiveOverviewData
  afterRecommended?: ReactNode
}) {
  const [openConcept, setOpenConcept] = useState<string | null>(null)
  const next = data.recommended_next

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-h2">Welcome, {data.student.name}</CardTitle>
          <CardDescription>
            {data.student.class === 0 ? "Competitive exam" : `Class ${data.student.class}`} · {data.student.board === "CIVILS" ? "Civil Services / UPSC" : data.student.board} syllabus
          </CardDescription>
        </CardHeader>
      </Card>

      {next && (
        <Card className="border-blue-600">
          <CardHeader>
            <CardTitle className="text-h3">Recommended next</CardTitle>
            <CardDescription>
              {next.is_initial_assessment ? 'Start with an Easy assessment' : 'The best thing to practise right now'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-body">
              {next.subject_name} → {next.chapter_name} → {next.concept_name}
            </p>
            <p className="text-small text-muted-foreground">
              Current level: {next.level === 'Not started' ? 'not assessed yet' : next.level} · Recommended difficulty:{' '}
              {next.recommended_difficulty}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <a href={`/my-paper?subject=${next.subject_id}`}>
                <Button>{next.is_initial_assessment ? 'Take my first assessment' : 'Generate my question paper'}</Button>
              </a>
              {!next.is_initial_assessment && <VideoLink url={next.video_url} title={next.video_title} />}
            </div>
          </CardContent>
        </Card>
      )}

      {afterRecommended}

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Overall progress</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="text-body grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-small text-muted-foreground">Average mastery</dt>
              <dd className="text-h3">
                {data.overall.average_mastery === null ? '–' : Math.round(data.overall.average_mastery)}
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted-foreground">Concepts started</dt>
              <dd className="text-h3">
                {data.overall.concepts_assessed} of {data.overall.concepts_total}
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted-foreground">Mastered</dt>
              <dd className="text-h3">{data.overall.mastered_count}</dd>
            </div>
            <div>
              <dt className="text-small text-muted-foreground">Current difficulty</dt>
              <dd className="text-h3">{data.current_difficulty}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {(data.strong_concepts.length > 0 || data.needs_improvement.length > 0 || data.retention_due.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.strong_concepts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-h3">Strong concepts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.strong_concepts.map((c) => (
                  <div key={c.concept_id} className="flex items-center justify-between gap-2">
                    <span className="text-body">{c.concept_name}</span>
                    <LevelBadge level={c.mastery_level} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {data.needs_improvement.length > 0 && (
            <Card className="border-blue-600">
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
            <Card className="sm:col-span-2">
              <CardHeader>
                <CardTitle className="text-h3">Time to revise</CardTitle>
                <CardDescription>You knew these well. A quick revision keeps them fresh.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-body list-inside list-disc">
                  {data.retention_due.map((c) => (
                    <li key={c.concept_id}>{c.concept_name}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {data.subjects.map((subject) => (
        <Card key={subject.subject_id}>
          <CardHeader>
            <CardTitle className="text-h3">{subject.subject_name}</CardTitle>
            <CardDescription>
              {subject.has_content
                ? `${subject.concepts_assessed} of ${subject.concepts_total} concepts started` +
                  (subject.average_mastery === null ? '' : ` · average mastery ${Math.round(subject.average_mastery)}`)
                : 'Practice papers coming soon'}
            </CardDescription>
          </CardHeader>
          {subject.has_content && (
            <CardContent className="space-y-5">
              {subject.chapters.map((chapter) => (
                <div key={chapter.chapter_id}>
                  <p className="text-body mb-2 font-medium">
                    {chapter.part} Ch {chapter.chapter_no}: {chapter.chapter_name}
                  </p>
                  <div className="space-y-2">
                    {chapter.concepts.map((concept) => {
                      const open = openConcept === concept.concept_id
                      return (
                        <div key={concept.concept_id} className="rounded-md border p-3">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 text-left"
                            aria-expanded={open}
                            onClick={() => setOpenConcept(open ? null : concept.concept_id)}
                          >
                            <span className="text-body">{concept.concept_name}</span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="text-small text-muted-foreground w-8 text-right">
                                {concept.mastery_score === null ? '–' : Math.round(concept.mastery_score)}
                              </span>
                              <LevelBadge level={concept.mastery_level} />
                            </span>
                          </button>
                          <div className="mt-2">
                            <ScoreBar score={concept.mastery_score} />
                          </div>
                          {open && (
                            <div className="text-small mt-3 space-y-1 text-muted-foreground">
                              <p>
                                Difficulty now: {concept.current_difficulty} · {concept.questions_attempted} questions
                                answered
                                {concept.accuracy !== null && ` · accuracy ${Math.round(concept.accuracy)}%`}
                                {concept.recent_accuracy !== null &&
                                  ` · recent ${Math.round(concept.recent_accuracy)}%`}
                              </p>
                              {concept.why.map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                              <VideoLink url={concept.video_url} title={concept.video_title} />
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
      ))}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { AppShell } from '../components/app-shell'
import {
  LevelBadge,
  ScoreBar,
  VideoLink,
} from '../components/adaptive-overview'
import type {
  AdaptiveOverviewData,
  ConceptView,
} from '../components/adaptive-overview'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/needs-improvement')({
  component: NeedsImprovement,
})

interface ConceptDetail extends ConceptView {
  subject_name: string
  chapter_name: string | null
}

interface WrongQuestion {
  question_id: string
  text: string
  type: string
  her_answer: string | null
  correct_answer: string | null
  marks_awarded: number
  marks_max: number
  answered_at: string
}

// Cross-references data.needs_improvement (a flat, subject-agnostic brief) against
// data.subjects[].chapters[].concepts[] (the fuller per-concept breakdown the same overview
// endpoint already returns) so this page can show accuracy, difficulty and "why" without a
// second API call. Falls back to the brief alone if a concept somehow isn't in either place.
function findConceptDetail(
  data: AdaptiveOverviewData,
  conceptId: string,
): ConceptDetail | null {
  for (const subject of data.subjects) {
    for (const chapter of subject.chapters) {
      const concept = chapter.concepts.find((c) => c.concept_id === conceptId)
      if (concept) {
        return {
          ...concept,
          subject_name: subject.subject_name,
          chapter_name: `${chapter.part} Ch ${chapter.chapter_no}: ${chapter.chapter_name}`,
        }
      }
    }
  }
  return null
}

// 2026-09-24, user feedback with a screenshot: one card was showing question text this compact;
// this stays true to that scale, one line of question + a two-column her-answer/correct-answer
// pair, rather than a full replica of the paper-review screen.
function WrongQuestionCard({ q }: { q: WrongQuestion }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-body">{q.text}</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="text-caption text-muted-foreground">Her answer</p>
          <p className="text-small text-destructive">
            {q.her_answer ?? '(not answered)'}
          </p>
        </div>
        <div>
          <p className="text-caption text-muted-foreground">Correct answer</p>
          <p className="text-small text-emerald-600 dark:text-emerald-400">
            {q.correct_answer ?? '—'}
          </p>
        </div>
      </div>
      <p className="text-caption text-muted-foreground mt-1.5">
        {q.marks_awarded} of {q.marks_max} marks
      </p>
    </div>
  )
}

// A dedicated page for the concepts a student's next paper will weight more heavily -- pulled
// out of /student's own card (which was getting crowded) into its own, more spacious layout with
// a distinct card design per concept, rather than the flat list it used to be.
//
// Redesigned 2026-09-24 (user feedback with a screenshot): the card used to print the mastery
// scoring model's own internal weights and thresholds straight to a student ("Accuracy 66.7% x
// 0.6, recent 83.3% x 0.2, difficulty reached 0 x 0.1..."). The API now sends one plain sentence
// instead (src/lib/adaptive/overview.ts's friendlySummary); this page adds what she actually
// asked for on top of it -- her own wrong questions for that concept, one card each, most recent
// first -- and a link to this app's existing practice-drill hub for more help.
function NeedsImprovement() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [overview, setOverview] = useState<AdaptiveOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [wrongByConcept, setWrongByConcept] = useState<
    Record<string, Array<WrongQuestion>>
  >({})

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'student') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/adaptive/overview')
      .then((r) => (r.ok ? r.json() : null))
      .then(setOverview)
      .finally(() => setLoading(false))
  }, [isPending, session, role, navigate])

  const concepts = overview
    ? overview.needs_improvement.map(
        (brief) => findConceptDetail(overview, brief.concept_id) ?? brief,
      )
    : []

  // One request per flagged concept, fired once the list is known. This page only ever shows a
  // bounded, usually-small set of concepts (F119's own 40% weak/priority weighting keeps the
  // "needs improvement" list from growing unbounded), so fetching all of them up front -- rather
  // than only on expand -- is the simpler design for a page whose whole purpose is this detail.
  useEffect(() => {
    for (const c of concepts) {
      if (c.concept_id in wrongByConcept) continue
      fetch(`/api/adaptive/concepts/${c.concept_id}/wrong-questions`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { questions: Array<WrongQuestion> } | null) => {
          setWrongByConcept((prev) => ({
            ...prev,
            [c.concept_id]: body?.questions ?? [],
          }))
        })
    }
    // Deliberately keyed on `overview`, not the derived `concepts` array: a fresh `concepts`
    // array identity from the same overview would just re-check the same ids against
    // wrongByConcept and fetch nothing new (the `in` guard above is what actually prevents
    // re-fetching), so there is no missing dependency here -- this project has no
    // react-hooks/exhaustive-deps rule configured to say so itself.
  }, [overview])

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <AppShell variant="student" active={null}>
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <a
          href="/student"
          className="text-small text-primary mb-4 inline-flex items-center gap-1 underline-offset-4 hover:underline"
        >
          ← Back to your progress
        </a>

        <div className="from-primary/10 via-card to-card border-border relative mb-6 overflow-hidden rounded-2xl border bg-gradient-to-br p-6 sm:p-8">
          <h1 className="display-title text-display">Concepts to work on</h1>
          <p className="text-body text-muted-foreground mt-2 max-w-lg">
            These get more questions in your next paper. Watch the video first
            if there is one -- no pressure, just a head start.
          </p>
        </div>

        {loading && <p className="text-body text-muted-foreground">Loading…</p>}

        {!loading && concepts.length === 0 && (
          <Card>
            <CardContent className="text-body text-muted-foreground pt-6">
              Nothing flagged right now -- nice work!
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {concepts.map((c) => {
            const full = 'chapter_name' in c ? c : null
            // Defaults to [] rather than checking for undefined -- this repo's tsconfig has no
            // noUncheckedIndexedAccess, so a plain index access on a Record type is already
            // (unsoundly) typed as never undefined, which makes an explicit undefined check on it
            // a lint-flagged always-true condition even though it can genuinely be missing before
            // the fetch below resolves. Defaulting the value itself sidesteps that entirely.
            const wrong = wrongByConcept[c.concept_id] ?? []
            return (
              <Card key={c.concept_id}>
                <CardHeader>
                  <p className="text-caption text-muted-foreground">
                    {c.subject_name}
                    {full?.chapter_name ? ` · ${full.chapter_name}` : ''}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-h3">{c.concept_name}</CardTitle>
                    <LevelBadge level={c.mastery_level} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ScoreBar score={c.mastery_score} />
                  {full && (
                    <div className="text-small text-muted-foreground space-y-1">
                      <p>
                        Difficulty now: {full.current_difficulty} ·{' '}
                        {full.questions_attempted} questions answered
                        {full.accuracy !== null &&
                          ` · accuracy ${Math.round(full.accuracy)}%`}
                      </p>
                      {full.why.map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  )}

                  <VideoLink url={c.video_url} title={c.video_title} />

                  {wrong.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-small font-medium">
                        Where she lost marks
                      </p>
                      <div className="space-y-2">
                        {wrong.map((q) => (
                          <WrongQuestionCard key={q.question_id} q={q} />
                        ))}
                      </div>
                    </div>
                  )}

                  <a
                    href="/remediation"
                    className="text-small text-primary inline-block underline-offset-4 hover:underline"
                  >
                    More practice and worked examples →
                  </a>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}

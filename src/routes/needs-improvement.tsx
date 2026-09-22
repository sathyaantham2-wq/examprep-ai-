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

// A dedicated page for the concepts a student's next paper will weight more heavily -- pulled
// out of /student's own card (which was getting crowded) into its own, more spacious layout with
// a distinct card design per concept, rather than the flat list it used to be.
function NeedsImprovement() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [overview, setOverview] = useState<AdaptiveOverviewData | null>(null)
  const [loading, setLoading] = useState(true)

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

  if (isPending || !session || role !== 'student') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const concepts = overview
    ? overview.needs_improvement.map(
        (brief) => findConceptDetail(overview, brief.concept_id) ?? brief,
      )
    : []

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
          <h1 className="display-title text-display">
            Concepts to work on
          </h1>
          <p className="text-body text-muted-foreground mt-2 max-w-lg">
            These get more questions in your next paper. Watch the video
            first if there is one -- no pressure, just a head start.
          </p>
        </div>

        {loading && (
          <p className="text-body text-muted-foreground">Loading…</p>
        )}

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
            return (
              <Card key={c.concept_id}>
                <CardHeader>
                  <p className="text-caption text-muted-foreground">
                    {c.subject_name}
                    {full?.chapter_name ? ` · ${full.chapter_name}` : ''}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-h3">
                      {c.concept_name}
                    </CardTitle>
                    <LevelBadge level={c.mastery_level} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ScoreBar score={c.mastery_score} />
                  {full && (
                    <p className="text-small text-muted-foreground">
                      Difficulty now: {full.current_difficulty} ·{' '}
                      {full.questions_attempted} questions answered
                      {full.accuracy !== null &&
                        ` · accuracy ${Math.round(full.accuracy)}%`}
                      {full.recent_accuracy !== null &&
                        ` · recent ${Math.round(full.recent_accuracy)}%`}
                    </p>
                  )}
                  {full && full.why.length > 0 && (
                    <ul className="text-small text-muted-foreground list-inside list-disc">
                      {full.why.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                  <VideoLink url={c.video_url} title={c.video_title} />
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}

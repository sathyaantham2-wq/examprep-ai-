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
  ChapterView,
} from '../components/adaptive-overview'
import { useSession } from '../lib/auth-client'

export const Route = createFileRoute('/needs-improvement')({
  component: NeedsImprovement,
})

interface ChapterDetail extends ChapterView {
  subject_name: string
}

// The chapter a flagged concept belongs to, with every concept in it (not just the flagged one)
// -- data.subjects[].chapters[] already carries the full roster the same overview call returns.
function findChapterDetail(
  data: AdaptiveOverviewData,
  conceptId: string,
): ChapterDetail | null {
  for (const subject of data.subjects) {
    for (const chapter of subject.chapters) {
      if (chapter.concepts.some((c) => c.concept_id === conceptId)) {
        return { ...chapter, subject_name: subject.subject_name }
      }
    }
  }
  return null
}

// A dedicated page for the concepts a student's next paper will weight more heavily -- pulled
// out of /student's own card (which was getting crowded) into its own, more spacious layout.
//
// Redesigned 2026-09-24 (user feedback, twice, both with a screenshot). First pass: the card was
// printing the mastery-scoring model's own internal weights and thresholds straight to a student
// ("Accuracy 66.7% x 0.6..."), replaced with one plain sentence (src/lib/adaptive/overview.ts's
// friendlySummary), and her own wrong questions for the flagged concept were added below it.
// Second pass, on seeing that: wrong questions stay out of this screen entirely -- they are the
// input the mastery engine already uses to build her next paper, not something to show her here
// -- and what she actually wants instead is chapter context: every concept in the chapter the
// flagged one belongs to, each with its own mastery bar and video, so she can see where she
// stands across the whole chapter, not just the one concept that got flagged. (The wrong-questions
// query and route this replaces are left in place, tested and working, for wherever they turn out
// to belong instead.)
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

  // One card per chapter that has at least one flagged concept, deduplicated -- two flagged
  // concepts in the same chapter show that chapter once, not twice.
  const chapters: Array<ChapterDetail> = []
  const seenChapterIds = new Set<string>()
  if (overview) {
    for (const brief of overview.needs_improvement) {
      const chapter = findChapterDetail(overview, brief.concept_id)
      if (chapter && !seenChapterIds.has(chapter.chapter_id)) {
        seenChapterIds.add(chapter.chapter_id)
        chapters.push(chapter)
      }
    }
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
            Every concept in each flagged chapter, so you can see where you
            stand across the whole thing. Watch a video first if there is one --
            no pressure, just a head start.
          </p>
        </div>

        {loading && <p className="text-body text-muted-foreground">Loading…</p>}

        {!loading && chapters.length === 0 && (
          <Card>
            <CardContent className="text-body text-muted-foreground pt-6">
              Nothing flagged right now -- nice work!
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {chapters.map((chapter) => (
            <Card key={chapter.chapter_id}>
              <CardHeader>
                <p className="text-caption text-muted-foreground">
                  {chapter.subject_name}
                </p>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-h3">
                    {chapter.part} Ch {chapter.chapter_no}:{' '}
                    {chapter.chapter_name}
                  </CardTitle>
                  <span className="text-caption text-muted-foreground shrink-0">
                    {chapter.concepts.length} concept
                    {chapter.concepts.length === 1 ? '' : 's'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {chapter.concepts.map((concept) => (
                  <div
                    key={concept.concept_id}
                    className="space-y-2 rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-body">{concept.concept_name}</p>
                      <LevelBadge level={concept.mastery_level} />
                    </div>
                    <ScoreBar score={concept.mastery_score} />
                    <VideoLink
                      url={concept.video_url}
                      title={concept.video_title}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

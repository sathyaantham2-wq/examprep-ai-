import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { ThemeToggle } from '../../../components/theme-toggle'
import { useSession } from '../../../lib/auth-client'

export const Route = createFileRoute('/evaluation/$id/report')({
  component: Report,
})

interface ErrorInventoryRow {
  position: number
  section: string
  concept_name: string
  marks_max: number
  marks_awarded: number
  marks_lost: number
  error_type: string | null
  knowledge_known: boolean | null
  feedback: string
  patterns: Array<{ code: string; name: string }>
}

interface ConceptPerformanceRow {
  concept_id: string
  concept_name: string
  marks_awarded: number
  marks_max: number
  percentage: number
}

interface DiagnosisReport {
  meta: { paper_title: string; student_name: string }
  score: { actual: number; total: number; percentage: number; grade: string }
  knowledge_score: number
  delivery_gap: number
  error_inventory: Array<ErrorInventoryRow>
  concept_performance: Array<ConceptPerformanceRow>
  pattern_hits: Array<{
    pattern_code: string
    pattern_name: string
    count: number
  }>
  habit_status: Array<{
    habit_code: string
    habit_name: string
    rating: string
  }>
  actions: {
    ranked: Array<{ concept_name: string; status: string; action: string }>
    parent_action: string
  }
}

function Report() {
  const { id } = Route.useParams()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [report, setReport] = useState<DiagnosisReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    // GET /api/evaluations/:id/report has always accepted 'parent' or 'admin' -- same
    // admin-exclusion gap fixed elsewhere this session (onboarding, generate, home, evaluate).
    if (!session || (role !== 'parent' && role !== 'teacher' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    fetch(`/api/evaluations/${id}/report`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          setError(
            body.error ??
              (r.status === 404
                ? 'Report not found.'
                : 'Could not load this report.'),
          )
          return
        }
        setReport(await r.json())
      })
      .catch(() => setError('Could not load this report.'))
  }, [isPending, session, role, navigate, id])

  if (isPending || !session || (role !== 'parent' && role !== 'teacher' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }
  if (error) {
    return <div className="p-8 text-body text-destructive">{error}</div>
  }
  if (!report) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">{report.meta.paper_title}</h1>
          <p className="text-body text-muted-foreground">
            {report.meta.student_name}
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <a href={`/api/evaluations/${id}/report/pdf`}>
            <Button variant="outline" size="sm">
              Download PDF
            </Button>
          </a>
          <ThemeToggle />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Score</CardDescription>
            <CardTitle className="text-h2">
              {report.score.percentage}%
            </CardTitle>
          </CardHeader>
          <CardContent className="text-small text-muted-foreground">
            {report.score.actual}/{report.score.total} -- Grade{' '}
            {report.score.grade}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Knowledge Score</CardDescription>
            <CardTitle className="text-h2">{report.knowledge_score}</CardTitle>
          </CardHeader>
          <CardContent className="text-small text-muted-foreground">
            What she'd score if delivery habits weren't costing marks
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Delivery Gap</CardDescription>
            <CardTitle className="text-h2">{report.delivery_gap}</CardTitle>
          </CardHeader>
          <CardContent className="text-small text-muted-foreground">
            Marks lost to habit, not knowledge
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-h3">This week</CardTitle>
          <CardDescription>{report.actions.parent_action}</CardDescription>
        </CardHeader>
        {report.actions.ranked.length > 0 && (
          <CardContent className="space-y-1">
            {report.actions.ranked.map((a, i) => (
              <p key={i} className="text-small text-muted-foreground">
                {a.action}
              </p>
            ))}
          </CardContent>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-h3">Error inventory</CardTitle>
          <CardDescription>
            {report.error_inventory.length === 0
              ? 'No marks were lost -- full marks on every question.'
              : `${report.error_inventory.length} question${report.error_inventory.length === 1 ? '' : 's'} lost marks.`}
          </CardDescription>
        </CardHeader>
        {report.error_inventory.length > 0 && (
          <CardContent className="space-y-3">
            {report.error_inventory.map((row) => (
              <div key={row.position} className="rounded-md border p-3">
                <div className="text-body flex items-center justify-between">
                  <span>
                    Q{row.position} -- {row.concept_name}
                  </span>
                  <span className="text-small text-destructive">
                    -{row.marks_lost} mark{row.marks_lost === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-small text-muted-foreground">
                  {row.error_type ?? 'Unclassified'}
                  {row.knowledge_known ? ' -- she knew it' : ''}
                  {row.patterns.length > 0
                    ? ` -- ${row.patterns.map((p) => p.name).join(', ')}`
                    : ''}
                </p>
                {row.feedback && (
                  <p className="text-small mt-1">{row.feedback}</p>
                )}
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-h3">Concept-wise performance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {report.concept_performance.map((c) => (
            <div
              key={c.concept_id}
              className="text-body flex items-center justify-between"
            >
              <span>{c.concept_name}</span>
              <span className="text-small text-muted-foreground">
                {c.marks_awarded}/{c.marks_max} ({c.percentage}%)
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {report.habit_status.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-h3">Delivery habits observed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {report.habit_status.map((h) => (
              <p key={h.habit_code} className="text-small">
                {h.habit_name}: {h.rating}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

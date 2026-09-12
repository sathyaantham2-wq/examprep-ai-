import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent } from '../../components/ui/card'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/funnel')({ component: AdminFunnel })

const STAGE_LABELS: Record<string, string> = {
  paper_generated: 'Paper generated',
  paper_downloaded: 'Paper downloaded',
  attempt_submitted: 'Attempt submitted',
  attempt_uploaded: 'Scan uploaded',
  evaluation_completed: 'Evaluation completed',
  remediation_started: 'Remediation started',
}

interface FunnelStage {
  event_type: string
  households: number
  students: number
  events: number
  pct_of_first_stage: number | null
}

interface FunnelReport {
  from: string
  to: string
  stages: Array<FunnelStage>
}

/**
 * F093 (tab03): "Events: paper generated, downloaded, attempted, uploaded, evaluated,
 * remediated; funnel view." No screen route is named in tab06 for this -- same standalone-admin-
 * screen pattern already used for /admin/coverage and /admin/usage, none of which tab06 names
 * either.
 */
function AdminFunnel() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [report, setReport] = useState<FunnelReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/admin/product-funnel')
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load the product funnel.')
        return r.json() as Promise<FunnelReport>
      })
      .then(setReport)
      .catch((err: Error) => setLoadError(err.message))
  }, [isPending, session, role, navigate])

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Product funnel</h1>
          <p className="text-body text-muted-foreground">
            Households reaching each stage, trailing 30 days.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {loadError && (
        <p className="text-small text-destructive mb-4" role="alert">
          {loadError}
        </p>
      )}

      {report && (
        <div className="space-y-2">
          {report.stages.map((stage) => (
            <Card key={stage.event_type}>
              <CardContent className="flex items-center justify-between gap-4 pt-6">
                <div>
                  <p className="text-body font-medium">
                    {STAGE_LABELS[stage.event_type] ?? stage.event_type}
                  </p>
                  <p className="text-small text-muted-foreground">
                    {stage.households} household{stage.households === 1 ? '' : 's'} ·{' '}
                    {stage.students} student{stage.students === 1 ? '' : 's'} · {stage.events}{' '}
                    event{stage.events === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="text-h3">
                  {stage.pct_of_first_stage === null ? '—' : `${stage.pct_of_first_stage}%`}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

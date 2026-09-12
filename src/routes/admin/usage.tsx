import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent } from '../../components/ui/card'
import { Label } from '../../components/ui/label'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/usage')({ component: AdminUsage })

type GroupBy = 'day' | 'feature' | 'student'

interface UsageBucket {
  group_key: string | null
  label: string
  calls: number
  tokens_in: number
  tokens_out: number
  cost_inr: number
  avg_latency_ms: number | null
  error_count: number
}

interface UsageReport {
  from: string
  to: string
  group_by: GroupBy
  totals: {
    calls: number
    tokens_in: number
    tokens_out: number
    cost_inr: number
    error_count: number
  }
  buckets: Array<UsageBucket>
}

/**
 * F091 (tab06 /admin/usage, "AI usage & cost"): tokens and cost by day, feature and student, from
 * the ai_jobs log every AI-*.ts call site now writes to. Rate-limit status and alerts (also named
 * in tab06's Key Elements) belong to F092/F121 -- separate not-yet-built features -- so this
 * screen sticks to what F091's own AC actually promises: logging and this dashboard.
 */
function AdminUsage() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [groupBy, setGroupBy] = useState<GroupBy>('day')
  const [report, setReport] = useState<UsageReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
    }
  }, [isPending, session, role, navigate])

  useEffect(() => {
    if (isPending || !session || role !== 'admin') return
    setLoadError(null)
    fetch(`/api/admin/ai-usage?group_by=${groupBy}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load AI usage.')
        return r.json() as Promise<UsageReport>
      })
      .then(setReport)
      .catch((err: Error) => setLoadError(err.message))
  }, [isPending, session, role, groupBy])

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">AI usage & cost</h1>
          <p className="text-body text-muted-foreground">
            Trailing 30 days of every logged AI call: tokens, cost and latency.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {report && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-small text-muted-foreground">Calls</p>
              <p className="text-h3">{report.totals.calls}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-small text-muted-foreground">Cost (₹)</p>
              <p className="text-h3">{report.totals.cost_inr.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-small text-muted-foreground">Tokens in/out</p>
              <p className="text-h3">
                {report.totals.tokens_in}/{report.totals.tokens_out}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-small text-muted-foreground">Errors</p>
              <p className="text-h3">{report.totals.error_count}</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="group-by">Group by</Label>
            <select
              id="group-by"
              className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            >
              <option value="day">Day</option>
              <option value="feature">Feature</option>
              <option value="student">Student</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {loadError && (
        <p className="text-small text-destructive mb-4" role="alert">
          {loadError}
        </p>
      )}

      {report && (
        <div className="overflow-x-auto">
          <table className="text-small w-full border-collapse">
            <thead>
              <tr>
                <th className="text-muted-foreground p-1.5 text-left font-normal">
                  {report.group_by === 'day'
                    ? 'Day'
                    : report.group_by === 'feature'
                      ? 'Feature'
                      : 'Student'}
                </th>
                <th className="text-muted-foreground p-1.5 text-left font-normal">Calls</th>
                <th className="text-muted-foreground p-1.5 text-left font-normal">Tokens in</th>
                <th className="text-muted-foreground p-1.5 text-left font-normal">Tokens out</th>
                <th className="text-muted-foreground p-1.5 text-left font-normal">Cost (₹)</th>
                <th className="text-muted-foreground p-1.5 text-left font-normal">
                  Avg latency (ms)
                </th>
                <th className="text-muted-foreground p-1.5 text-left font-normal">Errors</th>
              </tr>
            </thead>
            <tbody>
              {report.buckets.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-muted-foreground p-3 text-center">
                    No AI calls logged in this window.
                  </td>
                </tr>
              )}
              {report.buckets.map((bucket) => (
                <tr key={bucket.group_key ?? 'null'} className="border-border border-t">
                  <td className="p-1.5">{bucket.label}</td>
                  <td className="p-1.5">{bucket.calls}</td>
                  <td className="p-1.5">{bucket.tokens_in}</td>
                  <td className="p-1.5">{bucket.tokens_out}</td>
                  <td className="p-1.5">{bucket.cost_inr.toFixed(2)}</td>
                  <td className="p-1.5">
                    {bucket.avg_latency_ms === null ? '—' : Math.round(bucket.avg_latency_ms)}
                  </td>
                  <td className="p-1.5">{bucket.error_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

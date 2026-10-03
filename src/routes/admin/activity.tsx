import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Card, CardContent } from '../../components/ui/card'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'
import { PageLoading } from '../../components/page-loading'
import type { ActivityReport } from '../../lib/student-activity'

export const Route = createFileRoute('/admin/activity')({
  component: AdminActivity,
})

const WINDOWS = [7, 30, 90] as const

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes - hours * 60)
  return `${hours} h ${rest} min`
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Admin: how many students use the web app and for how many minutes (2026-10-03 request). No
 * tab06 screen names this, same standalone-admin-screen pattern as /admin/funnel and
 * /admin/usage. Minutes are active time from the in-app pings, not time with a tab merely open.
 */
function AdminActivity() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [days, setDays] = useState<number>(30)
  const [report, setReport] = useState<ActivityReport | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    setLoadError(null)
    fetch(`/api/admin/student-activity?days=${days}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load student activity.')
        return r.json() as Promise<ActivityReport>
      })
      .then(setReport)
      .catch((err: Error) => setLoadError(err.message))
  }, [isPending, session, role, navigate, days])

  if (isPending || !session || role !== 'admin') {
    return <PageLoading />
  }

  const maxMinutes = report
    ? Math.max(1, ...report.daily.map((d) => d.minutes))
    : 1

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-h1">Student activity</h1>
          <p className="text-body text-muted-foreground">
            Students using the web app and the minutes they spend in it.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      <div className="mb-4 flex gap-2" role="group" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setDays(w)}
            className={
              'rounded-md border px-3 py-1.5 text-sm font-medium ' +
              (days === w
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input')
            }
          >
            Last {w} days
          </button>
        ))}
      </div>

      {loadError && (
        <p className="text-small text-destructive mb-4" role="alert">
          {loadError}
        </p>
      )}

      {report && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Students with a login" value={report.students_with_login} />
            <Stat label="Active today" value={report.active_today} />
            <Stat label="Active, last 7 days" value={report.active_7d} />
            <Stat
              label={`Active, last ${report.window_days} days`}
              value={report.active_window}
            />
            <Stat label="Total time" value={formatMinutes(report.total_minutes)} />
            <Stat
              label="Average per active day"
              value={formatMinutes(report.avg_minutes_per_active_day)}
            />
          </dl>

          <p className="text-small text-muted-foreground">
            {report.tracking_since
              ? `Time is measured from ${report.tracking_since}; earlier use was not recorded.`
              : 'No activity recorded yet. Time is measured from the moment students next use the app.'}
          </p>

          <Card>
            <CardContent className="pt-6">
              <h2 className="text-h3 mb-3">Minutes per day</h2>
              <ul className="space-y-1">
                {report.daily.map((d) => (
                  <li key={d.day} className="flex items-center gap-3 text-small">
                    <span className="text-muted-foreground w-24 shrink-0">
                      {d.day}
                    </span>
                    <span
                      className="bg-primary/70 h-3 rounded-sm"
                      style={{ width: `${(d.minutes / maxMinutes) * 55}%`, minWidth: d.minutes > 0 ? 3 : 0 }}
                      aria-hidden="true"
                    />
                    <span>
                      {formatMinutes(d.minutes)} · {d.active_students} student
                      {d.active_students === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="overflow-x-auto pt-6">
              <h2 className="text-h3 mb-3">Each student</h2>
              <table className="w-full text-left text-small">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Student</th>
                    <th className="py-1 pr-3 font-medium">Class</th>
                    <th className="py-1 pr-3 font-medium">Today</th>
                    <th className="py-1 pr-3 font-medium">
                      Last {report.window_days} days
                    </th>
                    <th className="py-1 pr-3 font-medium">Days active</th>
                    <th className="py-1 pr-3 font-medium">Papers submitted</th>
                    <th className="py-1 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {report.students.map((s) => (
                    <tr key={s.student_id} className="border-t">
                      <td className="py-1.5 pr-3">{s.name}</td>
                      <td className="py-1.5 pr-3">{s.class}</td>
                      <td className="py-1.5 pr-3">{formatMinutes(s.minutes_today)}</td>
                      <td className="py-1.5 pr-3">
                        {formatMinutes(s.minutes_in_window)}
                      </td>
                      <td className="py-1.5 pr-3">{s.active_days}</td>
                      <td className="py-1.5 pr-3">{s.papers_submitted}</td>
                      <td className="py-1.5">{formatLastSeen(s.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <dt className="text-small text-muted-foreground">{label}</dt>
        <dd className="text-h2 mt-1">{value}</dd>
      </CardContent>
    </Card>
  )
}

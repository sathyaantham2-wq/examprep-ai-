import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/tracker/$studentId')({
  component: ConceptTracker,
})

const STATUSES = [
  'Strong',
  'Needs Practice',
  'Weak',
  'Priority',
  'Maintenance',
] as const

interface TrackerRow {
  student_id: string
  concept_id: string
  concept_code: string
  concept_name: string
  subject_id: string
  subject_name: string
  attempts: number
  avg_ratio: string | null
  last_ratio: string | null
  trend: 'up' | 'down' | 'flat' | null
  status: (typeof STATUSES)[number]
  flagged_at: string | null
  next_retest_at: string | null
  last_tested_date: string | null
}

type SortKey =
  | 'concept_code'
  | 'subject_name'
  | 'attempts'
  | 'last_ratio'
  | 'status'
  | 'last_tested_date'

const TREND_SYMBOL: Record<string, string> = { up: '↑', down: '↓', flat: '→' }
const TREND_CLASS: Record<string, string> = {
  up: 'text-green-600 dark:text-green-400',
  down: 'text-destructive',
  flat: 'text-muted-foreground',
}

function toCsvValue(v: string | number | null): string {
  const s = v === null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * F064 (tab06 /tracker/:studentId): "Sortable table by concept with attempts, latest, trend,
 * status, last tested date; filter by status; export to CSV/PDF." Only the backend
 * (GET /api/tracker/:studentId) existed before this -- the screen itself was never built,
 * discovered live while answering a parent's "where do I see concept-wise strengths and
 * weaknesses" question. PDF export is not built here (no PDF renderer wired to this data); CSV
 * export is a client-side download of the currently filtered/sorted rows, no new backend needed.
 * Raw status words are shown here deliberately -- this is the Parent-role screen, distinct from
 * /student (F072) which never shows them, per CLAUDE.md's "no red shaming language" rule that
 * applies only to the student-facing view.
 */
function ConceptTracker() {
  const { studentId } = Route.useParams()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [rows, setRows] = useState<Array<TrackerRow> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('concept_code')
  const [sortDesc, setSortDesc] = useState(false)

  useEffect(() => {
    if (isPending) return
    if (!session || (role !== 'parent' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : ''
    fetch(`/api/tracker/${studentId}${qs}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          setError(body.error ?? 'Could not load the concept tracker.')
          return
        }
        setRows(await r.json())
      })
      .catch(() => setError('Could not load the concept tracker.'))
  }, [isPending, session, role, navigate, studentId, statusFilter])

  const sortedRows = useMemo(() => {
    if (!rows) return []
    const copy = [...rows]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'attempts') {
        cmp = a.attempts - b.attempts
      } else if (sortKey === 'last_ratio') {
        cmp = Number(a.last_ratio ?? -1) - Number(b.last_ratio ?? -1)
      } else if (sortKey === 'last_tested_date') {
        cmp = (a.last_tested_date ?? '').localeCompare(b.last_tested_date ?? '')
      } else {
        cmp = a[sortKey].localeCompare(b[sortKey])
      }
      return sortDesc ? -cmp : cmp
    })
    return copy
  }, [rows, sortKey, sortDesc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc((d) => !d)
    } else {
      setSortKey(key)
      setSortDesc(false)
    }
  }

  function exportCsv() {
    const header = [
      'Concept code',
      'Concept',
      'Subject',
      'Attempts',
      'Latest %',
      'Trend',
      'Status',
      'Last tested',
    ]
    const lines = [header.join(',')]
    for (const r of sortedRows) {
      lines.push(
        [
          toCsvValue(r.concept_code),
          toCsvValue(r.concept_name),
          toCsvValue(r.subject_name),
          toCsvValue(r.attempts),
          toCsvValue(r.last_ratio !== null ? `${Math.round(Number(r.last_ratio) * 100)}%` : ''),
          toCsvValue(r.trend ?? ''),
          toCsvValue(r.status),
          toCsvValue(r.last_tested_date ?? ''),
        ].join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `concept-tracker-${studentId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function sortHeader(key: SortKey, label: string) {
    return (
      <button
        type="button"
        className="text-small flex items-center gap-1 font-medium hover:underline"
        onClick={() => toggleSort(key)}
      >
        {label}
        {sortKey === key && <span>{sortDesc ? '▼' : '▲'}</span>}
      </button>
    )
  }

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Concept tracker</h1>
          <p className="text-body text-muted-foreground">
            Every tracked concept, cumulative across all attempts.
          </p>
        </div>
        <div className="no-print flex items-center gap-4">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows?.length}>
            Export CSV
          </Button>
          <ThemeToggle />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Filter</CardTitle>
          <CardDescription>Narrow the table to one status.</CardDescription>
        </CardHeader>
        <CardContent>
          <select
            className="border-input flex h-9 w-full max-w-xs rounded-md border bg-transparent px-3 text-sm shadow-xs"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {error && (
        <p className="text-small text-destructive mt-4" role="alert">
          {error}
        </p>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="text-body text-muted-foreground mt-4">
          No tracked concepts yet — they appear here once a paper for this
          student has been evaluated and confirmed.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="p-2">{sortHeader('concept_code', 'Concept')}</th>
                <th className="p-2">{sortHeader('subject_name', 'Subject')}</th>
                <th className="p-2">{sortHeader('attempts', 'Attempts')}</th>
                <th className="p-2">{sortHeader('last_ratio', 'Latest %')}</th>
                <th className="p-2">Trend</th>
                <th className="p-2">{sortHeader('status', 'Status')}</th>
                <th className="p-2">
                  {sortHeader('last_tested_date', 'Last tested')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r.concept_id} className="border-b last:border-0">
                  <td className="p-2">
                    <div className="font-medium">{r.concept_code}</div>
                    <div className="text-muted-foreground text-xs">
                      {r.concept_name}
                    </div>
                  </td>
                  <td className="p-2">{r.subject_name}</td>
                  <td className="p-2">{r.attempts}</td>
                  <td className="p-2">
                    {r.last_ratio !== null
                      ? `${Math.round(Number(r.last_ratio) * 100)}%`
                      : '—'}
                  </td>
                  <td className={`p-2 ${r.trend ? TREND_CLASS[r.trend] : ''}`}>
                    {r.trend ? TREND_SYMBOL[r.trend] : '—'}
                  </td>
                  <td className="p-2">{r.status}</td>
                  <td className="p-2">{r.last_tested_date ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { AppShell } from '../../components/app-shell'
import { PageLoading, PageSkeleton } from '../../components/page-loading'
import { useSession } from '../../lib/auth-client'
import { REPORT_REASON_LABEL } from '../../lib/question-reports-shared'
import type { ReportReason } from '../../lib/question-reports-shared'

export const Route = createFileRoute('/admin/reports')({
  component: AdminReports,
})

type Status = 'open' | 'resolved' | 'dismissed' | 'all'

interface ReportRow {
  id: string
  reason: ReportReason
  comment: string
  status: 'open' | 'resolved' | 'dismissed'
  created_at: string
  question_id: string
  question_text: string
  question_type: string
  expected_answer: string
  student_answer: string | null
  marks_awarded: string | null
  marks_max: string | null
}

/**
 * F129: the student "Report a problem" queue. Each report shows the question, its answer key and
 * what the student wrote, side by side, so a spelling-only "marked wrong" is obvious at a glance.
 * Resolving here only closes the report -- fixing or retiring the question is done in
 * /admin/questions, and a confirmed mark is corrected through the normal evaluation flow.
 */
function AdminReports() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [status, setStatus] = useState<Status>('open')
  const [rows, setRows] = useState<Array<ReportRow> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    setRows(null)
    fetch(`/api/admin/question-reports?status=${status}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json() as Promise<Array<ReportRow>>
      })
      .then(setRows)
      .catch(() => setError('Could not load reports.'))
  }, [isPending, session, role, navigate, status])

  async function setReportStatus(id: string, next: ReportRow['status']) {
    setPendingId(id)
    setError(null)
    try {
      const response = await fetch('/api/admin/question-reports', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      })
      if (!response.ok) {
        setError('Could not update that report.')
        return
      }
      setRows((prev) =>
        (prev ?? [])
          .map((r) => (r.id === id ? { ...r, status: next } : r))
          .filter((r) => status === 'all' || r.status === status),
      )
    } finally {
      setPendingId(null)
    }
  }

  if (isPending || !session || role !== 'admin') return <PageLoading />

  return (
    <AppShell active="reports">
      <div className="mx-auto max-w-3xl p-4 sm:p-8">
        <div className="mb-6">
          <h1 className="text-h1">Question reports</h1>
          <p className="text-body text-muted-foreground">
            Problems students have flagged on questions, with what they wrote
            next to the answer key.
          </p>
        </div>

        <div
          className="mb-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Filter"
        >
          {(['open', 'resolved', 'dismissed', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={
                'text-small rounded-full border px-3 py-1 capitalize ' +
                (status === s
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input')
              }
            >
              {s}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-small text-destructive mb-4" role="alert">
            {error}
          </p>
        )}

        {rows === null && !error && <PageSkeleton />}
        {rows?.length === 0 && (
          <Card>
            <CardContent className="text-body text-muted-foreground pt-6">
              No {status === 'all' ? '' : status} reports.
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {rows?.map((r) => (
            <Card key={r.id}>
              <CardHeader>
                <p className="field-label">
                  {REPORT_REASON_LABEL[r.reason]} ·{' '}
                  {new Date(r.created_at).toLocaleDateString()} · {r.status}
                </p>
                <CardTitle className="question-text">
                  {r.question_text}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="answer-box">
                  <p className="field-label">Student says</p>
                  <p className="answer-text">{r.comment}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="answer-box answer-box-mine">
                    <p className="field-label">
                      Student answered
                      {r.marks_max !== null &&
                        ` · ${Number(r.marks_awarded)}/${Number(r.marks_max)}`}
                    </p>
                    <p className="answer-text whitespace-pre-wrap">
                      {r.student_answer || '(blank / not yet answered)'}
                    </p>
                  </div>
                  <div className="answer-box answer-box-right">
                    <p className="field-label">Answer key</p>
                    <p className="answer-text whitespace-pre-wrap">
                      {r.expected_answer}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.status !== 'resolved' && (
                    <Button
                      size="sm"
                      disabled={pendingId === r.id}
                      onClick={() => void setReportStatus(r.id, 'resolved')}
                    >
                      Mark resolved
                    </Button>
                  )}
                  {r.status !== 'dismissed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pendingId === r.id}
                      onClick={() => void setReportStatus(r.id, 'dismissed')}
                    >
                      Dismiss
                    </Button>
                  )}
                  {r.status !== 'open' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingId === r.id}
                      onClick={() => void setReportStatus(r.id, 'open')}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  )
}

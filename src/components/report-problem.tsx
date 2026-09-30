import { useState } from 'react'
import { Flag } from 'lucide-react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import {
  REPORT_COMMENT_MAX,
  REPORT_COMMENT_MIN,
  REPORT_REASON_LABEL,
} from '../lib/question-reports-shared'
import type { ReportReason } from '../lib/question-reports-shared'

/**
 * F129: "Report a problem" on one question -- a reason and a line or two of feedback. Offered
 * while answering (a question can be wrong before she answers it) and on the marked result
 * (including "my answer is right but was marked wrong", e.g. a spelling-only difference).
 */
export function ReportProblem({
  attemptId,
  paperQuestionId,
  reported,
  onReported,
  reasons,
}: {
  attemptId: string
  paperQuestionId: string
  reported: boolean
  onReported: (paperQuestionId: string) => void
  /** Which reasons fit where it is shown -- "marked wrong" only makes sense after marking. */
  reasons: Array<ReportReason>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReportReason>(reasons[0])
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (reported) {
    return (
      <p className="text-caption text-muted-foreground inline-flex items-center gap-1.5">
        <Flag className="size-3.5" aria-hidden="true" />
        Reported — thank you, we will check this question.
      </p>
    )
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground no-print"
        onClick={() => setOpen(true)}
      >
        <Flag />
        Report a problem
      </Button>
    )
  }

  const trimmed = comment.trim()
  const tooShort = trimmed.length < REPORT_COMMENT_MIN

  async function send() {
    setSending(true)
    setError(null)
    try {
      const response = await fetch(`/api/attempts/${attemptId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paper_question_id: paperQuestionId,
          reason,
          comment: trimmed,
        }),
      })
      if (response.ok || response.status === 409) {
        onReported(paperQuestionId)
        return
      }
      setError('Could not send your report. Please try again.')
    } catch {
      setError('Could not send your report. Please check your connection.')
    } finally {
      setSending(false)
    }
  }

  const fieldId = `report-${paperQuestionId}`
  return (
    <div className="bg-muted/60 border-border no-print space-y-3 rounded-xl border p-3">
      <fieldset className="space-y-1.5">
        <legend className="text-small mb-1 font-semibold">
          What is the problem?
        </legend>
        {reasons.map((r) => (
          <label key={r} className="text-small flex items-center gap-2">
            <input
              type="radio"
              name={`${fieldId}-reason`}
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
            />
            {REPORT_REASON_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={fieldId} className="text-small font-semibold">
          Tell us in a line or two
        </label>
        <Textarea
          id={fieldId}
          rows={2}
          maxLength={REPORT_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="For example: I wrote the right word, only the spelling was different."
        />
        <p className="text-caption text-muted-foreground text-right">
          {trimmed.length}/{REPORT_COMMENT_MAX}
        </p>
      </div>
      {error && (
        <p className="text-small text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={sending || tooShort}
          onClick={() => void send()}
        >
          {sending ? 'Sending…' : 'Send report'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

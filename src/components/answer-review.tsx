import { useCallback, useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

export interface ReviewItem {
  item_id: string
  position: number
  section: string
  concept_name: string | null
  question_text: string
  student_answer: string
  marks_awarded: number
  marks_max: number
  feedback: string | null
  dispute: { comment: string; reply: string; marks_before: number; marks_after: number } | null
  excluded: boolean
}

interface ReviewData {
  state: 'none' | 'waiting_for_parent' | 'review' | 'evaluated'
  disputes_used: number
  disputes_max: number
  written: Array<ReviewItem>
  objective: { marks: number; marks_max: number; count: number }
  total_now: number
  total_max: number
}

const ERROR_TEXT: Record<string, string> = {
  comment_length: 'Write a little more about why you disagree (at least a few words).',
  limit_reached: 'You have already questioned 5 answers on this paper.',
  already_disputed: 'This answer has already been looked at again.',
  already_removed: 'This question is already removed.',
  not_reviewable: 'These marks can no longer be changed.',
  ai_unavailable: 'The AI is not available right now. Try again later.',
  ai_limit: 'The AI has reached its limit for now. Try again later.',
  ai_failed: 'The AI could not look at this right now. Try again in a moment. Nothing was used up.',
}

// After a paper with written answers is submitted: the AI has marked it and the student can look
// it over. She may tell the AI why she disagrees with a mark (once per answer, up to 5 answers),
// remove a question that she still disputes, and then accept her marks.
export function AnswerReview({
  attemptId,
  onEvaluated,
}: {
  attemptId: string
  onEvaluated: () => void
}) {
  const [data, setData] = useState<ReviewData | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)

  const load = useCallback(async () => {
    const response = await fetch(`/api/attempts/${attemptId}/review`)
    if (!response.ok) return
    const body = (await response.json()) as ReviewData
    setData(body)
    if (body.state === 'evaluated') onEvaluated()
  }, [attemptId, onEvaluated])

  useEffect(() => {
    void load()
  }, [load])

  async function sendDispute(itemId: string) {
    setBusy(itemId)
    setError(null)
    try {
      const response = await fetch(`/api/attempts/${attemptId}/items/${itemId}/dispute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError({ id: itemId, text: ERROR_TEXT[body?.error ?? ''] ?? 'Something went wrong. Try again.' })
        return
      }
      setOpenId(null)
      setComment('')
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function removeQuestion(itemId: string) {
    if (!window.confirm('Remove this question from your grade? Your grade will be worked out from the other answers only.')) {
      return
    }
    setBusy(itemId)
    setError(null)
    try {
      const response = await fetch(`/api/attempts/${attemptId}/items/${itemId}/remove`, { method: 'POST' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        setError({ id: itemId, text: ERROR_TEXT[body?.error ?? ''] ?? 'Something went wrong. Try again.' })
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function accept() {
    setBusy('finalize')
    setError(null)
    try {
      const response = await fetch(`/api/attempts/${attemptId}/finalize`, { method: 'POST' })
      if (!response.ok) {
        setError({ id: 'finalize', text: 'Could not finish just now. Try again.' })
        return
      }
      onEvaluated()
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <div className="text-body p-8 text-muted-foreground">Loading…</div>

  if (data.state !== 'review') {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <h1 className="text-h1 mb-2">Submitted</h1>
        <p className="text-body text-muted-foreground">
          {data.state === 'none'
            ? 'This attempt is not finished yet.'
            : 'Your answers have been recorded. Your parent will review and confirm the marks.'}
        </p>
        <a href="/student" className="text-small text-primary mt-4 inline-block underline-offset-4 hover:underline">
          Back to my progress
        </a>
      </div>
    )
  }

  const limitReached = data.disputes_used >= data.disputes_max

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <div>
        <h1 className="text-h1">Check your marks</h1>
        <p className="text-body text-muted-foreground">
          The AI has marked your written answers. If you think a mark is unfair, tell the AI why and it will look again.
          You can question up to {data.disputes_max} answers. If you still disagree after that, you can remove the question
          from your grade.
        </p>
      </div>

      <Card>
        <CardContent className="text-body flex flex-wrap items-center justify-between gap-2 pt-6">
          <span>
            Multiple choice: {data.objective.marks} of {data.objective.marks_max}{' '}
            <span className="text-small text-muted-foreground">(marked by the answer key)</span>
          </span>
          <span className="text-small text-muted-foreground">
            Answers questioned: {data.disputes_used} of {data.disputes_max}
          </span>
        </CardContent>
      </Card>

      {data.written.map((item) => (
        <Card key={item.item_id} className={item.excluded ? 'opacity-60' : undefined}>
          <CardHeader>
            <CardTitle className="text-h3">
              Question {item.position}
              {item.concept_name ? <span className="text-small text-muted-foreground"> · {item.concept_name}</span> : null}
            </CardTitle>
            <CardDescription>{item.question_text}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-small text-muted-foreground">Your answer</p>
              <p className="text-body whitespace-pre-wrap">{item.student_answer || '(blank)'}</p>
            </div>
            <div className="text-body flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {item.excluded ? 'Removed from your grade' : `Marks: ${item.marks_awarded} of ${item.marks_max}`}
              </span>
              {item.feedback && !item.excluded && <span className="text-small text-muted-foreground">{item.feedback}</span>}
            </div>

            {item.dispute && (
              <div className="space-y-2" aria-label="Your conversation with the AI">
                <div className="ml-auto max-w-[85%] rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">
                  {item.dispute.comment}
                </div>
                <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm">
                  {item.dispute.reply}
                  <span className="text-small mt-1 block text-muted-foreground">
                    {item.dispute.marks_after > item.dispute.marks_before
                      ? `Mark raised from ${item.dispute.marks_before} to ${item.dispute.marks_after}.`
                      : `Mark stays at ${item.dispute.marks_after}.`}
                  </span>
                </div>
              </div>
            )}

            {!item.excluded && !item.dispute && openId !== item.item_id && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={limitReached || busy !== null}
                onClick={() => {
                  setOpenId(item.item_id)
                  setComment('')
                  setError(null)
                }}
              >
                I disagree with this mark
              </Button>
            )}
            {!item.excluded && !item.dispute && limitReached && (
              <p className="text-small text-muted-foreground">You have questioned the most answers allowed on one paper.</p>
            )}

            {openId === item.item_id && (
              <div className="space-y-2">
                <label className="text-small block" htmlFor={`why-${item.item_id}`}>
                  Tell the AI why you disagree
                </label>
                <textarea
                  id={`why-${item.item_id}`}
                  className="border-input min-h-20 w-full rounded-md border bg-transparent p-2 text-sm shadow-xs"
                  value={comment}
                  maxLength={600}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={busy !== null || comment.trim().length < 5} onClick={() => void sendDispute(item.item_id)}>
                    {busy === item.item_id ? 'The AI is looking again…' : 'Send'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => setOpenId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {item.dispute && !item.excluded && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void removeQuestion(item.item_id)}
              >
                Still not happy? Remove this question from my grade
              </Button>
            )}

            {error?.id === item.item_id && (
              <p className="text-small text-destructive" role="alert">
                {error.text}
              </p>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-body">
            Your marks now: <span className="font-medium">{data.total_now} of {data.total_max}</span>
          </p>
          <Button disabled={busy !== null} onClick={() => void accept()}>
            {busy === 'finalize' ? 'Finishing…' : 'I am happy with my marks. Finish.'}
          </Button>
        </CardContent>
      </Card>
      {error?.id === 'finalize' && (
        <p className="text-small text-destructive" role="alert">
          {error.text}
        </p>
      )}
    </div>
  )
}

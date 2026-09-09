import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Label } from '../../components/ui/label'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/evaluate/$attemptId')({
  component: Evaluate,
})

const ERROR_TYPES = [
  'Conceptual Gap',
  'Calculation Error',
  'Presentation Issue',
  'Formula/Definition Error',
  'Incomplete',
  'Not Attempted',
  'Reading Discipline',
]

interface Item {
  id: string
  paper_question_id: string
  marks_awarded: string
  marks_max: string
  ai_marks: string | null
  error_type: string | null
  ai_error_type: string | null
  knowledge_known: boolean | null
  feedback: string | null
  position: number | null
  section: string | null
  question_text: string | null
  question_type: string | null
  correct_answer: string | null
  options: Array<{ label: string; text: string; is_correct: boolean }>
  student_answer: {
    selected_option: string | null
    response_text: string | null
  } | null
}

interface Evaluation {
  id: string
  confirmed_at: string | null
  actual_score: string | null
  knowledge_score: string | null
  percentage: string | null
  grade: string | null
}

interface EditState {
  marks: string
  error_type: string
  knowledge_known: 'unset' | 'true' | 'false'
  feedback: string
}

function studentAnswerText(item: Item): string {
  if (!item.student_answer) return '(no answer saved)'
  if (item.student_answer.selected_option) {
    return `Selected: ${item.student_answer.selected_option}`
  }
  return item.student_answer.response_text || '(blank)'
}

function Evaluate() {
  const { attemptId } = Route.useParams()
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [evaluation, setEvaluation] = useState<Evaluation | null>(null)
  const [items, setItems] = useState<Array<Item>>([])
  const [edits, setEdits] = useState<Partial<Record<string, EditState>>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'parent') {
      navigate({ to: '/' })
      return
    }
    ;(async () => {
      const createResponse = await fetch('/api/evaluations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId }),
      })
      if (!createResponse.ok) {
        const body = await createResponse.json().catch(() => ({}))
        setLoadError(body.error ?? 'Could not evaluate this attempt.')
        return
      }
      const created = await createResponse.json()
      const detailResponse = await fetch(
        `/api/evaluations/${created.evaluation.id}`,
      )
      if (!detailResponse.ok) {
        setLoadError('Could not load the evaluation details.')
        return
      }
      const detail = await detailResponse.json()
      setEvaluation(detail.evaluation)
      setItems(detail.items)
      const initialEdits: Record<string, EditState> = {}
      for (const item of detail.items as Array<Item>) {
        initialEdits[item.id] = {
          marks: item.marks_awarded,
          error_type: item.error_type ?? '',
          knowledge_known:
            item.knowledge_known === null
              ? 'unset'
              : item.knowledge_known
                ? 'true'
                : 'false',
          feedback: item.feedback ?? '',
        }
      }
      setEdits(initialEdits)
    })()
  }, [isPending, session, role, navigate, attemptId])

  function updateEdit(itemId: string, patch: Partial<EditState>) {
    setEdits((prev) => {
      const current: EditState = prev[itemId] ?? {
        marks: '',
        error_type: '',
        knowledge_known: 'unset',
        feedback: '',
      }
      return { ...prev, [itemId]: { ...current, ...patch } }
    })
  }

  async function saveItem(item: Item) {
    if (!evaluation) return
    const edit = edits[item.id]
    if (!edit) return
    setSavingId(item.id)
    try {
      const response = await fetch(
        `/api/evaluations/${evaluation.id}/items/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            marks: Number(edit.marks),
            error_type: edit.error_type || null,
            knowledge_known:
              edit.knowledge_known === 'unset'
                ? null
                : edit.knowledge_known === 'true',
            feedback: edit.feedback || undefined,
          }),
        },
      )
      if (response.ok) {
        const updated = await response.json()
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, ...updated } : i)),
        )
      }
    } finally {
      setSavingId(null)
    }
  }

  async function handleConfirm() {
    if (!evaluation) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const response = await fetch(
        `/api/evaluations/${evaluation.id}/confirm`,
        { method: 'POST' },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setConfirmError(body.error ?? 'Could not confirm this evaluation.')
        return
      }
      const updated = await response.json()
      setEvaluation(updated)
    } finally {
      setConfirming(false)
    }
  }

  if (isPending || !session || role !== 'parent') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }
  if (loadError) {
    return <div className="p-8 text-body text-destructive">{loadError}</div>
  }
  if (!evaluation) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  const isConfirmed = Boolean(evaluation.confirmed_at)

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Evaluation review</h1>
          <p className="text-body text-muted-foreground">
            {isConfirmed
              ? `Confirmed -- ${evaluation.percentage}% (${evaluation.grade})`
              : 'AI-proposed marks below are editable until you confirm.'}
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const edit = edits[item.id]
          return (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-body font-medium">
                  {item.position}. {item.question_text}
                </CardTitle>
                <CardDescription>
                  Student answer: {studentAnswerText(item)}
                  {item.options.length > 0 && (
                    <>
                      {' '}
                      -- correct:{' '}
                      {item.options.find((o) => o.is_correct)?.label ??
                        item.correct_answer}
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {isConfirmed ? (
                  <p className="text-small text-muted-foreground">
                    {item.marks_awarded}/{item.marks_max} marks
                    {item.error_type ? ` -- ${item.error_type}` : ''}
                    {item.feedback ? ` -- ${item.feedback}` : ''}
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor={`marks-${item.id}`}>
                          Marks (of {item.marks_max})
                        </Label>
                        <input
                          id={`marks-${item.id}`}
                          type="number"
                          className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                          value={edit?.marks ?? ''}
                          onChange={(e) =>
                            updateEdit(item.id, { marks: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`error-${item.id}`}>Error type</Label>
                        <select
                          id={`error-${item.id}`}
                          className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                          value={edit?.error_type ?? ''}
                          onChange={(e) =>
                            updateEdit(item.id, { error_type: e.target.value })
                          }
                        >
                          <option value="">(none)</option>
                          {ERROR_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`feedback-${item.id}`}>Feedback</Label>
                      <textarea
                        id={`feedback-${item.id}`}
                        className="border-input min-h-16 w-full rounded-md border bg-transparent p-2 text-sm shadow-xs"
                        value={edit?.feedback ?? ''}
                        onChange={(e) =>
                          updateEdit(item.id, { feedback: e.target.value })
                        }
                      />
                    </div>
                    <label className="text-small flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={edit?.knowledge_known === 'true'}
                        onChange={(e) =>
                          updateEdit(item.id, {
                            knowledge_known: e.target.checked
                              ? 'true'
                              : 'unset',
                          })
                        }
                      />
                      She actually knew this -- credit it to the Knowledge Score
                      (F055)
                    </label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveItem(item)}
                      disabled={savingId === item.id}
                    >
                      {savingId === item.id ? 'Saving…' : 'Save'}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {!isConfirmed && (
        <div className="mt-6 space-y-2">
          {confirmError && (
            <p className="text-small text-destructive" role="alert">
              {confirmError}
            </p>
          )}
          <Button onClick={handleConfirm} disabled={confirming}>
            {confirming ? 'Confirming…' : 'Confirm all'}
          </Button>
        </div>
      )}
    </div>
  )
}

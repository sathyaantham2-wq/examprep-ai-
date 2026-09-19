import { useEffect, useRef, useState } from 'react'
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
  pattern_ids: Array<string>
}

interface Pattern {
  id: string
  code: string
  name: string
}

interface Habit {
  id: string
  code: string
  name: string
  rating: 'present' | 'partial' | 'absent' | null
}

const HABIT_RATINGS = ['present', 'partial', 'absent'] as const

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
  pattern_ids: Array<string>
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
  const [patterns, setPatterns] = useState<Array<Pattern>>([])
  const [habits, setHabits] = useState<Array<Habit>>([])
  const [habitEdits, setHabitEdits] = useState<
    Record<string, 'present' | 'partial' | 'absent' | 'unset'>
  >({})
  const [savingHabits, setSavingHabits] = useState(false)
  const [habitsSaved, setHabitsSaved] = useState(false)
  const [edits, setEdits] = useState<Partial<Record<string, EditState>>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  // F048: keyboard navigation between review cards -- j/k or Down/Up move focus, Enter saves the
  // focused item and advances. cardRefs is keyed by item id rather than index so focus survives
  // re-renders after a save reorders nothing but still replaces array identity.
  const cardRefs = useRef<Partial<Record<string, HTMLDivElement | null>>>({})

  useEffect(() => {
    if (isPending) return
    // Every /api/evaluations* route this screen calls has always accepted 'parent' or 'admin' --
    // this guard excluding admin was the same gap as /onboarding, /generate, /home (fixed
    // 2026-09-18/19): an admin household had no UI path to evaluate a submitted attempt at all.
    if (!session || (role !== 'parent' && role !== 'admin')) {
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
      setPatterns(detail.patterns ?? [])
      setHabits(detail.habits ?? [])
      const initialHabitEdits: Record<
        string,
        'present' | 'partial' | 'absent' | 'unset'
      > = {}
      for (const h of detail.habits as Array<Habit>) {
        initialHabitEdits[h.id] = h.rating ?? 'unset'
      }
      setHabitEdits(initialHabitEdits)
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
          pattern_ids: item.pattern_ids,
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
        pattern_ids: [],
      }
      return { ...prev, [itemId]: { ...current, ...patch } }
    })
  }

  function togglePattern(itemId: string, patternId: string) {
    const current = edits[itemId]?.pattern_ids ?? []
    const next = current.includes(patternId)
      ? current.filter((id) => id !== patternId)
      : [...current, patternId]
    updateEdit(itemId, { pattern_ids: next })
  }

  function focusCard(itemId: string | undefined) {
    if (!itemId) return
    cardRefs.current[itemId]?.focus()
  }

  function handleCardKeyDown(
    e: React.KeyboardEvent<HTMLDivElement>,
    item: Item,
    index: number,
  ) {
    // Only act when the card itself has focus -- typing "j"/"k" inside the feedback textarea or
    // marks input must not hijack the keystroke.
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      focusCard(items[index + 1]?.id)
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      focusCard(items[index - 1]?.id)
    } else if (e.key === 'Enter' && !evaluation?.confirmed_at) {
      e.preventDefault()
      void saveItem(item).then(() => focusCard(items[index + 1]?.id))
    }
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
            pattern_ids: edit.pattern_ids,
          }),
        },
      )
      if (response.ok) {
        const updated = await response.json()
        const patternIds = (
          updated.pattern_hits as Array<{ pattern_id: string }>
        ).map((h) => h.pattern_id)
        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? { ...i, ...updated, pattern_ids: patternIds }
              : i,
          ),
        )
      }
    } finally {
      setSavingId(null)
    }
  }

  async function saveHabits() {
    if (!evaluation) return
    setSavingHabits(true)
    setHabitsSaved(false)
    try {
      const observations = Object.entries(habitEdits)
        .filter(([, rating]) => rating !== 'unset')
        .map(([habit_id, rating]) => ({ habit_id, rating }))
      const response = await fetch(`/api/evaluations/${evaluation.id}/habits`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ observations }),
      })
      if (response.ok) setHabitsSaved(true)
    } finally {
      setSavingHabits(false)
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

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
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
          {!isConfirmed && (
            <p className="text-small text-muted-foreground mt-1">
              Keyboard: ↓/j and ↑/k move between questions, Enter saves and
              advances.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 no-print">
          {isConfirmed && (
            <a href={`/evaluation/${evaluation.id}/report`}>
              <Button variant="outline" size="sm">
                View report
              </Button>
            </a>
          )}
          <ThemeToggle />
        </div>
      </div>

      <div className="space-y-4">
        {items.map((item, index) => {
          const edit = edits[item.id]
          return (
            // Card itself isn't a forwardRef component, so the focusable/keyboard-nav element is
            // this wrapping div rather than the Card -- ref, tabIndex and onKeyDown all need a
            // real DOM node.
            <div
              key={item.id}
              data-testid="review-card"
              ref={(el) => {
                cardRefs.current[item.id] = el
              }}
              tabIndex={0}
              onKeyDown={(e) => handleCardKeyDown(e, item, index)}
              className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
            >
              <Card>
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
                              updateEdit(item.id, {
                                error_type: e.target.value,
                              })
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
                        She actually knew this -- credit it to the Knowledge
                        Score (F055)
                      </label>
                      {patterns.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-small font-medium">
                            Behaviour patterns (F057)
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {patterns.map((p) => (
                              <label
                                key={p.id}
                                className="text-small flex items-center gap-1.5"
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    edit?.pattern_ids.includes(p.id) ?? false
                                  }
                                  onChange={() => togglePattern(item.id, p.id)}
                                />
                                {p.code} — {p.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
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
            </div>
          )
        })}
      </div>

      {habits.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-h3">Presentation habits</CardTitle>
            <CardDescription>
              {isConfirmed
                ? 'Rated for this paper.'
                : 'Rate how she showed up on each habit this paper, before confirming.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {habits.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-4"
              >
                <span className="text-small">
                  {h.code} — {h.name}
                </span>
                {isConfirmed ? (
                  <span className="text-small text-muted-foreground">
                    {habitEdits[h.id] !== 'unset'
                      ? habitEdits[h.id]
                      : 'Not rated'}
                  </span>
                ) : (
                  <div className="flex gap-3">
                    {HABIT_RATINGS.map((r) => (
                      <label
                        key={r}
                        className="text-small flex items-center gap-1"
                      >
                        <input
                          type="radio"
                          name={`habit-${h.id}`}
                          checked={habitEdits[h.id] === r}
                          onChange={() =>
                            setHabitEdits((prev) => ({ ...prev, [h.id]: r }))
                          }
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!isConfirmed && (
              <Button
                size="sm"
                variant="outline"
                onClick={saveHabits}
                disabled={savingHabits}
              >
                {savingHabits
                  ? 'Saving…'
                  : habitsSaved
                    ? 'Saved'
                    : 'Save habits'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

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

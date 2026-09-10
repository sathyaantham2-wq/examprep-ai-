import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/questions')({
  component: AdminQuestions,
})

interface Subject {
  id: string
  name: string
}
interface Concept {
  id: string
  name: string
  code: string
}
interface QuestionOption {
  label: string
  text: string
  is_correct: boolean
}
interface QuestionRow {
  id: string
  text: string
  type: string
  marks: number
  bloom: string
  difficulty: string
  status: string
  review_tier: string
  concept_id: string
  answer: string
  is_reversal_word: boolean
}

const BLOOM_LEVELS = [
  'Remember',
  'Understand',
  'Apply',
  'Analyse',
  'Evaluate',
  'Create',
]
const DIFFICULTIES = ['Easy', 'Hard', 'Hardest']

/**
 * F084 (tab06 /admin/questions): "Filterable bank, editor, bulk import, AI generate, review
 * queue." Launch scope is CBSE Class 7 (CLAUDE.md) so subjects are fetched for that board/class
 * directly rather than building a full board/class picker nobody needs yet.
 */
function AdminQuestions() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [subjects, setSubjects] = useState<Array<Subject>>([])
  const [subjectId, setSubjectId] = useState('')
  const [concepts, setConcepts] = useState<Array<Concept>>([])
  const [conceptId, setConceptId] = useState('')

  const [draftQuestions, setDraftQuestions] =
    useState<Array<QuestionRow> | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedOptions, setExpandedOptions] = useState<Array<QuestionOption>>(
    [],
  )
  const [rejectNote, setRejectNote] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)

  const [genBloom, setGenBloom] = useState('Remember')
  const [genDifficulty, setGenDifficulty] = useState('Easy')
  const [genCount, setGenCount] = useState(3)
  const [genResult, setGenResult] = useState<{
    generated: Array<unknown>
    rejected: Array<{ reason: string }>
    ai_configured: boolean
    message?: string
  } | null>(null)
  const [generating, setGenerating] = useState(false)

  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{
    imported?: number
    rejected?: Array<unknown>
  } | null>(null)

  function refreshDrafts() {
    fetch('/api/questions?status=draft&pageSize=50')
      .then((r) => r.json())
      .then((data: { items: Array<QuestionRow> }) =>
        setDraftQuestions(data.items),
      )
  }

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/syllabus/subjects?board=CBSE&class=7')
      .then((r) => r.json())
      .then((data: Array<Subject>) => {
        setSubjects(data)
        if (data.length === 1) setSubjectId(data[0].id)
      })
    refreshDrafts()
  }, [isPending, session, role, navigate])

  useEffect(() => {
    setConceptId('')
    setConcepts([])
    if (!subjectId) return
    fetch(`/api/syllabus/concepts?subject_id=${subjectId}`)
      .then((r) => r.json())
      .then(setConcepts)
  }, [subjectId])

  async function toggleExpand(q: QuestionRow) {
    if (expandedId === q.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(q.id)
    setRejectNote('')
    setReviewError(null)
    const detail = await (await fetch(`/api/questions/${q.id}`)).json()
    setExpandedOptions(detail.options ?? [])
  }

  async function approve(id: string, note?: string) {
    setReviewError(null)
    const response = await fetch(`/api/questions/${id}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    const body = await response.json()
    if (!response.ok) {
      setReviewError(body.error ?? 'Could not approve.')
      return
    }
    setExpandedId(null)
    refreshDrafts()
  }

  async function reject(id: string) {
    if (!rejectNote.trim()) {
      setReviewError('A reason is required to reject a question.')
      return
    }
    setReviewError(null)
    const response = await fetch(`/api/questions/${id}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: rejectNote }),
    })
    const body = await response.json()
    if (!response.ok) {
      setReviewError(body.error ?? 'Could not reject.')
      return
    }
    setExpandedId(null)
    refreshDrafts()
  }

  // F060: the only place in any screen a reversal-word tag can be set or corrected -- previously
  // API/CSV-only. PATCHes and updates local state directly rather than a full refreshDrafts()
  // round trip, since approve/reject already close the expanded row but this shouldn't.
  async function toggleReversalWord(q: QuestionRow) {
    const next = !q.is_reversal_word
    const response = await fetch(`/api/questions/${q.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_reversal_word: next }),
    })
    if (!response.ok) return
    setDraftQuestions(
      (prev) =>
        prev?.map((r) =>
          r.id === q.id ? { ...r, is_reversal_word: next } : r,
        ) ?? null,
    )
  }

  async function generate() {
    if (!conceptId) return
    setGenerating(true)
    setGenResult(null)
    try {
      const response = await fetch('/api/questions/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          concept_id: conceptId,
          count: genCount,
          bloom: genBloom,
          difficulty: genDifficulty,
        }),
      })
      const body = await response.json()
      setGenResult(body)
      refreshDrafts()
    } finally {
      setGenerating(false)
    }
  }

  async function submitImport(e: React.FormEvent) {
    e.preventDefault()
    if (!importFile) return
    const formData = new FormData()
    formData.append('file', importFile)
    const response = await fetch('/api/questions/bulk-import', {
      method: 'POST',
      body: formData,
    })
    const body = await response.json()
    setImportResult(body)
    refreshDrafts()
  }

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Question bank admin</h1>
          <p className="text-body text-muted-foreground">
            Review AI drafts, generate more, and bulk import.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-h3">Review queue</CardTitle>
          <CardDescription>
            Draft questions — only Approved questions are eligible for papers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draftQuestions !== null && draftQuestions.length === 0 && (
            <p className="text-body text-muted-foreground">
              Nothing pending review.
            </p>
          )}
          {draftQuestions?.map((q) => (
            <div key={q.id} className="rounded-md border p-3">
              <button
                type="button"
                className="text-body w-full text-left"
                onClick={() => toggleExpand(q)}
              >
                {q.text}{' '}
                <span className="text-small text-muted-foreground">
                  ({q.bloom}, {q.difficulty}, {q.marks} mark
                  {q.marks === 1 ? '' : 's'}, Tier {q.review_tier})
                </span>
              </button>
              {expandedId === q.id && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  {expandedOptions.length > 0 && (
                    <ul className="text-small list-inside list-disc">
                      {expandedOptions.map((o) => (
                        <li
                          key={o.label}
                          className={o.is_correct ? 'font-medium' : ''}
                        >
                          {o.label}. {o.text} {o.is_correct ? '(correct)' : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-small text-muted-foreground">
                    Answer: {q.answer}
                  </p>
                  <label className="text-small flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={q.is_reversal_word}
                      onChange={() => toggleReversalWord(q)}
                    />
                    Reversal-word (NOT / least / false) — wrong answers here get
                    classified as reading discipline, not a concept gap
                  </label>
                  {reviewError && (
                    <p className="text-small text-destructive" role="alert">
                      {reviewError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => approve(q.id, undefined)}>
                      Approve
                    </Button>
                    <input
                      className="border-input h-8 flex-1 rounded-md border bg-transparent px-2 text-sm"
                      placeholder="Reason (required to reject)"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => reject(q.id)}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-h3">Generate with AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <select
              id="subject"
              className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="" disabled>
                Select a subject
              </option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {subjectId && (
            <div className="space-y-1.5">
              <Label htmlFor="concept">Concept</Label>
              <select
                id="concept"
                className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={conceptId}
                onChange={(e) => setConceptId(e.target.value)}
              >
                <option value="" disabled>
                  Select a concept
                </option>
                {concepts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="bloom">Bloom</Label>
              <select
                id="bloom"
                className="border-input flex h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={genBloom}
                onChange={(e) => setGenBloom(e.target.value)}
              >
                {BLOOM_LEVELS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="difficulty">Difficulty</Label>
              <select
                id="difficulty"
                className="border-input flex h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={genDifficulty}
                onChange={(e) => setGenDifficulty(e.target.value)}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="count">Count</Label>
              <input
                id="count"
                type="number"
                min={1}
                max={20}
                className="border-input flex h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
              />
            </div>
          </div>
          <Button onClick={generate} disabled={!conceptId || generating}>
            {generating ? 'Generating…' : 'Generate'}
          </Button>
          {genResult && (
            <div className="text-small rounded-md border p-3">
              {genResult.ai_configured === false ? (
                <p className="text-muted-foreground">{genResult.message}</p>
              ) : (
                <p>
                  {genResult.generated.length} question(s) added to the review
                  queue, {genResult.rejected.length} rejected by the scope
                  guardrail.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Bulk import</CardTitle>
          <CardDescription>CSV or JSON file of questions.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitImport} className="flex items-center gap-2">
            <input
              type="file"
              accept=".csv,.json"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" disabled={!importFile}>
              Import
            </Button>
          </form>
          {importResult && (
            <p className="text-small text-muted-foreground mt-2">
              Imported {importResult.imported ?? 0}, rejected{' '}
              {importResult.rejected?.length ?? 0}.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

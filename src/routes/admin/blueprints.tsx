import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Label } from '../../components/ui/label'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/blueprints')({
  component: AdminBlueprints,
})

interface Subject {
  id: string
  name: string
}

const BLOOM_LEVELS = ['Remember', 'Understand', 'Apply', 'Analyse', 'Evaluate', 'Create'] as const

interface SectionForm {
  name: string
  marks_per_question: number
  count: number
  bloom_allowed: Array<string>
}

let sectionKey = 0
function newSection(): SectionForm & { key: number } {
  sectionKey += 1
  return { key: sectionKey, name: '', marks_per_question: 1, count: 1, bloom_allowed: ['Remember'] }
}

/**
 * F086 (folded into the /admin section per tab06's M17 grouping -- no separate blueprint route
 * is listed there, but POST /api/blueprints already exists fully server-validated with nowhere
 * to enter it from): "Form-based blueprint builder with live validation that section marks sum
 * to the paper total." The schema has no separate declared-total field (total_marks is always
 * server-computed from sections) so "target total" here is a client-side planning aid -- the
 * coach types the paper's real total up front and the form shows whether the sections they've
 * added so far match it, live, before they submit.
 */
function AdminBlueprints() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [subjects, setSubjects] = useState<Array<Subject>>([])
  const [subjectId, setSubjectId] = useState('')
  const [name, setName] = useState('')
  const [durationMin, setDurationMin] = useState(180)
  const [targetTotal, setTargetTotal] = useState(80)
  const [sections, setSections] = useState<Array<SectionForm & { key: number }>>([
    newSection(),
  ])
  const [bloomTargets, setBloomTargets] = useState<Record<string, number>>({
    Remember: 20,
    Understand: 20,
    Apply: 30,
    Analyse: 20,
    Evaluate: 5,
    Create: 5,
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<{ id: string; total_marks: number } | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/syllabus/subjects?board=CBSE&class=7')
      .then((r) => r.json())
      .then(setSubjects)
  }, [isPending, session, role, navigate])

  const sectionsTotal = sections.reduce((sum, s) => sum + s.count * s.marks_per_question, 0)
  const totalsMatch = sectionsTotal === targetTotal
  const bloomTotal = Object.values(bloomTargets).reduce((a, b) => a + b, 0)
  const bloomMatches = bloomTotal === 100

  function updateSection(key: number, patch: Partial<SectionForm>) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  function toggleBloom(key: number, level: string) {
    setSections((prev) =>
      prev.map((s) =>
        s.key === key
          ? {
              ...s,
              bloom_allowed: s.bloom_allowed.includes(level)
                ? s.bloom_allowed.filter((b) => b !== level)
                : [...s.bloom_allowed, level],
            }
          : s,
      ),
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCreated(null)
    setSubmitting(true)
    try {
      const response = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject_id: subjectId,
          board: 'CBSE',
          class: 7,
          name,
          duration_min: durationMin,
          sections: sections.map(({ key, ...s }) => {
            void key
            return s
          }),
          bloom_targets: bloomTargets,
        }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(JSON.stringify(body.error ?? body))
        return
      }
      setCreated(body)
      setSections([newSection()])
      setName('')
    } finally {
      setSubmitting(false)
    }
  }

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Blueprint builder</h1>
          <p className="text-body text-muted-foreground">
            Enter your school's real paper pattern so mocks match it.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">New blueprint</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <select
                  id="subject"
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  required
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
              <div className="space-y-1.5">
                <Label htmlFor="name">Blueprint name</Label>
                <input
                  id="name"
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Term 1 Mock"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="duration">Duration (min)</Label>
                <input
                  id="duration"
                  type="number"
                  min={1}
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="target">Target total marks</Label>
                <input
                  id="target"
                  type="number"
                  min={1}
                  className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={targetTotal}
                  onChange={(e) => setTargetTotal(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Sections</Label>
                <span
                  className={
                    'text-small ' +
                    (totalsMatch ? 'text-muted-foreground' : 'text-destructive')
                  }
                >
                  {sectionsTotal} / {targetTotal} marks
                  {totalsMatch ? ' ✓' : ''}
                </span>
              </div>
              {sections.map((s) => (
                <div key={s.key} className="space-y-2 rounded-md border p-3">
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      className="border-input col-span-3 flex h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                      placeholder="Section name (e.g. Section A)"
                      value={s.name}
                      onChange={(e) => updateSection(s.key, { name: e.target.value })}
                      required
                    />
                    <div className="space-y-1">
                      <Label className="text-small">Marks each</Label>
                      <input
                        type="number"
                        min={1}
                        className="border-input flex h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                        value={s.marks_per_question}
                        onChange={(e) =>
                          updateSection(s.key, { marks_per_question: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-small">Count</Label>
                      <input
                        type="number"
                        min={1}
                        className="border-input flex h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                        value={s.count}
                        onChange={(e) => updateSection(s.key, { count: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-small">Section marks</Label>
                      <p className="text-small pt-1.5">{s.count * s.marks_per_question}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {BLOOM_LEVELS.map((level) => (
                      <label key={level} className="text-small flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={s.bloom_allowed.includes(level)}
                          onChange={() => toggleBloom(s.key, level)}
                        />
                        {level}
                      </label>
                    ))}
                  </div>
                  {sections.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSections((prev) => prev.filter((x) => x.key !== s.key))}
                    >
                      Remove section
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSections((prev) => [...prev, newSection()])}
              >
                Add section
              </Button>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Bloom targets (%)</Label>
                <span
                  className={
                    'text-small ' +
                    (bloomMatches ? 'text-muted-foreground' : 'text-destructive')
                  }
                >
                  {bloomTotal} / 100{bloomMatches ? ' ✓' : ''}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {BLOOM_LEVELS.map((level) => (
                  <div key={level} className="space-y-1">
                    <Label className="text-small">{level}</Label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="border-input flex h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                      value={bloomTargets[level]}
                      onChange={(e) =>
                        setBloomTargets((prev) => ({
                          ...prev,
                          [level]: Number(e.target.value),
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <p className="text-small text-destructive" role="alert">
                {error}
              </p>
            )}
            {created && (
              <p className="text-small text-muted-foreground">
                Created — total {created.total_marks} marks.
              </p>
            )}

            <Button
              type="submit"
              disabled={submitting || !subjectId || !name || !totalsMatch || !bloomMatches}
            >
              {submitting ? 'Creating…' : 'Create blueprint'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

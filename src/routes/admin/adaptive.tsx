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
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/adaptive')({ component: AdminAdaptive })

type Json = { [key: string]: number | Array<number> | Json }

interface AiStatus {
  provider: 'anthropic' | 'gemini' | null
  anthropic_key_set: boolean
  gemini_key_set: boolean
  forced: string | null
  models: { strong: string; cheap: string } | null
}

interface Subject {
  id: string
  board: string
  class: number
  name: string
  code: string
  is_active: boolean
  chapter_count: number
}

const GROUP_TITLES: Record<string, string> = {
  weights: 'Mastery score weights (must add up to 1)',
  levels: 'Level thresholds (lowest score of each level)',
  evidence: 'Evidence needed for Mastered',
  difficulty: 'Difficulty adjustment',
  adjustment: 'How fast a score can move',
  recency: 'Recent-question window',
  weightage: 'Question weightage across concepts',
  retention: 'Retention schedule (days, comma separated)',
}

function setPath(obj: Json, path: Array<string>, value: number | Array<number>): Json {
  const [head, ...rest] = path
  const copy: Json = { ...obj }
  copy[head] = rest.length === 0 ? value : setPath(obj[head] as Json, rest, value)
  return copy
}

function Fields({
  value,
  path,
  onChange,
}: {
  value: Json
  path: Array<string>
  onChange: (path: Array<string>, v: number | Array<number>) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Object.entries(value).map(([key, v]) => {
        const here = [...path, key]
        const id = `cfg-${here.join('-')}`
        if (Array.isArray(v)) {
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={id}>{key}</Label>
              <Input
                id={id}
                defaultValue={v.join(', ')}
                onBlur={(e) =>
                  onChange(
                    here,
                    e.target.value
                      .split(',')
                      .map((n) => Number(n.trim()))
                      .filter((n) => Number.isFinite(n) && n > 0),
                  )
                }
              />
            </div>
          )
        }
        if (typeof v === 'object') {
          return (
            <div key={key} className="sm:col-span-2">
              <p className="text-small mb-2 font-medium">{key}</p>
              <Fields value={v} path={here} onChange={onChange} />
            </div>
          )
        }
        return (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={id}>{key}</Label>
            <Input
              id={id}
              type="number"
              step="any"
              value={v}
              onChange={(e) => onChange(here, Number(e.target.value))}
            />
          </div>
        )
      })}
    </div>
  )
}

// Everything the adaptive learning engine uses is set here, and every change is audit logged.
function AdminAdaptive() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [config, setConfig] = useState<Json | null>(null)
  const [defaults, setDefaults] = useState<Json | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<Array<Subject>>([])
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [aiTest, setAiTest] = useState<string | null>(null)
  const [form, setForm] = useState({ board: 'CBSE', class: 7, name: '', code: '' })

  async function loadSubjects() {
    const r = await fetch('/api/admin/subjects')
    if (r.ok) setSubjects(await r.json())
  }

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/admin/mastery-settings')
      .then((r) => r.json())
      .then((d: { config: Json; defaults: Json }) => {
        setConfig(d.config)
        setDefaults(d.defaults)
      })
    void loadSubjects()
    fetch('/api/admin/ai-status')
      .then((r) => r.json())
      .then(setAi)
  }, [isPending, session, role, navigate])

  async function testAi() {
    setAiTest('Testing…')
    const response = await fetch('/api/admin/ai-status', { method: 'POST' })
    const body = (await response.json()) as { ok: boolean; provider?: string; model?: string; latency_ms?: number; error?: string | null }
    setAiTest(
      body.ok
        ? `Working: ${body.provider} (${body.model}) answered in ${body.latency_ms} ms.`
        : `Not working: ${body.error ?? 'unknown error'}`,
    )
  }

  async function saveConfig() {
    setMessage(null)
    setError(null)
    const response = await fetch('/api/admin/mastery-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    })
    const body = await response.json()
    if (!response.ok) {
      setError('These settings were not saved. Check that the weights add up to 1 and the thresholds increase.')
      return
    }
    setConfig(body.config)
    setMessage('Saved. New answers use these settings straight away.')
  }

  async function toggleSubject(subject: Subject) {
    await fetch(`/api/admin/subjects/${subject.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ is_active: !subject.is_active }),
    })
    await loadSubjects()
  }

  async function renameSubject(subject: Subject, name: string) {
    if (!name.trim() || name === subject.name) return
    await fetch(`/api/admin/subjects/${subject.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    await loadSubjects()
  }

  async function addSubject(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const response = await fetch('/api/admin/subjects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      setError(typeof body?.error === 'string' ? body.error : 'Could not add the subject.')
      return
    }
    setForm({ ...form, name: '', code: '' })
    await loadSubjects()
  }

  if (isPending || !session || role !== 'admin' || !config) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1">Adaptive learning settings</h1>
          <p className="text-body text-muted-foreground">
            Subjects, mastery rules and question weightage.{' '}
            <a href="/admin/videos" className="text-primary underline-offset-4 hover:underline">
              Concept videos
            </a>
          </p>
        </div>
        <ThemeToggle />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">AI provider</CardTitle>
          <CardDescription>
            Set ANTHROPIC_API_KEY or GEMINI_API_KEY in the deployment settings (see .env.example). Keys are never shown here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ai && (
            <p className="text-body">
              {ai.provider === null
                ? 'No AI key is set. Written answers wait for a parent to mark them.'
                : `In use: ${ai.provider === 'gemini' ? 'Google Gemini' : 'Anthropic Claude'}` +
                  (ai.models ? ` · main model ${ai.models.strong}, backup ${ai.models.cheap}` : '')}
            </p>
          )}
          {ai && (
            <p className="text-small text-muted-foreground">
              Anthropic key: {ai.anthropic_key_set ? 'set' : 'not set'} · Gemini key: {ai.gemini_key_set ? 'set' : 'not set'}
              {ai.forced ? ` · forced to ${ai.forced}` : ''}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" disabled={!ai?.provider} onClick={() => void testAi()}>
              Test connection
            </Button>
            {aiTest && <span className="text-small text-muted-foreground" role="status">{aiTest}</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Subjects</CardTitle>
          <CardDescription>
            Students choose from the active subjects of their class. Switching a subject off hides it; nothing is deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {subjects.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
              <Input
                aria-label={`Name of ${s.name}`}
                className="max-w-56"
                defaultValue={s.name}
                onBlur={(e) => void renameSubject(s, e.target.value)}
              />
              <span className="text-small text-muted-foreground">
                {s.board} · Class {s.class} · {s.code} · {s.chapter_count} chapters
              </span>
              <Button
                type="button"
                size="sm"
                variant={s.is_active ? 'outline' : 'default'}
                className="ml-auto"
                onClick={() => void toggleSubject(s)}
              >
                {s.is_active ? 'Deactivate' : 'Activate'}
              </Button>
            </div>
          ))}
          <form onSubmit={addSubject} className="grid gap-3 rounded-md border p-3 sm:grid-cols-5">
            <Input aria-label="Board" value={form.board} onChange={(e) => setForm({ ...form, board: e.target.value })} required />
            <Input
              aria-label="Class"
              type="number"
              min={1}
              max={12}
              value={form.class}
              onChange={(e) => setForm({ ...form, class: Number(e.target.value) })}
              required
            />
            <Input aria-label="Subject name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input aria-label="Subject code" placeholder="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            <Button type="submit">Add subject</Button>
          </form>
        </CardContent>
      </Card>

      {Object.entries(config).map(([group, value]) => {
        if (typeof value !== 'object') return null
        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-h3">{GROUP_TITLES[group] ?? group}</CardTitle>
            </CardHeader>
            <CardContent>
              <Fields
                value={value as Json}
                path={[group]}
                onChange={(path, v) => setConfig((c) => (c ? setPath(c, path, v) : c))}
              />
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Other</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(['correctCredit', 'weakPriorityFloorPercent'] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`cfg-${key}`}>{key}</Label>
              <Input
                id={`cfg-${key}`}
                type="number"
                step="any"
                value={config[key] as number}
                onChange={(e) => setConfig((c) => (c ? setPath(c, [key], Number(e.target.value)) : c))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {error && (
        <p className="text-small text-destructive" role="alert">
          {error}
        </p>
      )}
      {message && <p className="text-small text-muted-foreground" role="status">{message}</p>}
      <div className="flex gap-3">
        <Button onClick={() => void saveConfig()}>Save settings</Button>
        <Button variant="outline" onClick={() => defaults && setConfig(defaults)}>
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}

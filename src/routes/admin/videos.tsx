import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/videos')({ component: AdminVideos })

interface Subject {
  id: string
  name: string
  board: string
  class: number
  chapter_count: number
}

interface Chapter {
  id: string
  part: string
  chapter_no: number
  name: string
}

interface Concept {
  id: string
  chapter_id: string
  code: string
  name: string
  video_url: string | null
  video_title: string | null
}

type Draft = { url: string; title: string }

// Students see a "Watch" link under any concept they are weak in, if it has a video here.
function AdminVideos() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [subjects, setSubjects] = useState<Array<Subject>>([])
  const [subjectId, setSubjectId] = useState('')
  const [chapters, setChapters] = useState<Array<Chapter>>([])
  const [concepts, setConcepts] = useState<Array<Concept>>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [status, setStatus] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/admin/subjects')
      .then((r) => r.json())
      .then((list: Array<Subject>) => {
        const withChapters = list.filter((s) => s.chapter_count > 0)
        setSubjects(withChapters)
        if (withChapters.length > 0) setSubjectId(withChapters[0].id)
      })
  }, [isPending, session, role, navigate])

  useEffect(() => {
    if (!subjectId) return
    void Promise.all([
      fetch(`/api/syllabus/chapters?subject_id=${subjectId}`).then((r) => r.json()),
      fetch(`/api/syllabus/concepts?subject_id=${subjectId}`).then((r) => r.json()),
    ]).then(([ch, co]: [Array<Chapter>, Array<Concept>]) => {
      setChapters(ch)
      setConcepts(co)
      setDrafts(
        Object.fromEntries(co.map((c) => [c.id, { url: c.video_url ?? '', title: c.video_title ?? '' }])),
      )
      setStatus({})
    })
  }, [subjectId])

  const withVideo = useMemo(() => concepts.filter((c) => c.video_url).length, [concepts])

  async function save(concept: Concept) {
    const draft = drafts[concept.id]
    const url = draft.url.trim()
    const title = draft.title.trim()
    setStatus((s) => ({ ...s, [concept.id]: 'Saving…' }))
    const response = await fetch(`/api/syllabus/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ video_url: url === '' ? null : url, video_title: title === '' ? null : title }),
    })
    if (!response.ok) {
      setStatus((s) => ({ ...s, [concept.id]: 'Not saved. Use a full link that starts with https://' }))
      return
    }
    const updated = (await response.json()) as Concept
    setConcepts((list) => list.map((c) => (c.id === concept.id ? { ...c, video_url: updated.video_url, video_title: updated.video_title } : c)))
    setStatus((s) => ({ ...s, [concept.id]: 'Saved' }))
  }

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1">Concept videos</h1>
          <p className="text-body text-muted-foreground">
            Add a YouTube link for each concept. Students see it under concepts they need to improve.
          </p>
        </div>
        <ThemeToggle />
      </div>

      {subjects.length > 1 && (
        <select
          aria-label="Subject"
          className="border-input flex h-9 w-full max-w-xs rounded-md border bg-transparent px-3 text-sm shadow-xs"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} (Class {s.class}, {s.board})
            </option>
          ))}
        </select>
      )}
      <p className="text-small text-muted-foreground">
        {withVideo} of {concepts.length} concepts have a video.
      </p>

      {chapters.map((chapter) => {
        const rows = concepts.filter((c) => c.chapter_id === chapter.id)
        if (rows.length === 0) return null
        return (
          <Card key={chapter.id}>
            <CardHeader>
              <CardTitle className="text-h3">
                {chapter.part} Ch {chapter.chapter_no}: {chapter.name}
              </CardTitle>
              <CardDescription>{rows.length} concepts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {rows.map((concept) => {
                const draft = drafts[concept.id] ?? { url: '', title: '' }
                const changed = draft.url.trim() !== (concept.video_url ?? '') || draft.title.trim() !== (concept.video_title ?? '')
                return (
                  <div key={concept.id} className="space-y-2 rounded-md border p-3">
                    <p className="text-body">
                      <span className="text-small text-muted-foreground">{concept.code}</span> {concept.name}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                      <Input
                        aria-label={`Video link for ${concept.name}`}
                        placeholder="https://www.youtube.com/watch?v=…"
                        value={draft.url}
                        onChange={(e) => setDrafts((d) => ({ ...d, [concept.id]: { ...draft, url: e.target.value } }))}
                      />
                      <Input
                        aria-label={`Video title for ${concept.name}`}
                        placeholder="Video title"
                        value={draft.title}
                        onChange={(e) => setDrafts((d) => ({ ...d, [concept.id]: { ...draft, title: e.target.value } }))}
                      />
                      <Button type="button" size="sm" disabled={!changed} onClick={() => void save(concept)}>
                        Save
                      </Button>
                    </div>
                    {status[concept.id] && (
                      <p className="text-small text-muted-foreground" role="status">
                        {status[concept.id]}
                      </p>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

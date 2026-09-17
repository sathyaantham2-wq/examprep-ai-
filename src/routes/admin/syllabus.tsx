import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/syllabus')({
  component: AdminSyllabus,
})

interface Subject {
  id: string
  name: string
  code: string
  board: string
  class: number
}
interface Chapter {
  id: string
  part: string
  chapter_no: number
  name: string
  blurb: string | null
  in_scope_count: number
  out_scope_count: number
}
interface Concept {
  id: string
  code: string
  name: string
  difficulty_base: string
  target_question_count: number
  description: string | null
}
interface ScopeItem {
  id: string
  item_text: string
  page_ref: string | null
}
interface ChapterScope {
  in: Array<ScopeItem>
  out: Array<ScopeItem>
}

/**
 * F083 (tab06 /admin/syllabus): tab06 lists this screen's key elements as "Board/class/subject/
 * chapter/concept CRUD, scope authoring, source upload" -- but F015 (Done) already scoped a write
 * CRUD API OUT of this project, with the user's agreement: real curriculum scope has to be
 * grounded in the actual textbook via the /examprep-ingest-source and /examprep-scope-authoring
 * skills, not typed into a form from memory. Source upload is F085, separately blocked on no
 * PDF-parsing library being wired up. So this screen is deliberately read-only: a browser over
 * the hierarchy the skills already populate, for an admin to review what scope exists without a
 * raw DB query. Board/class fetched for CBSE/7 directly, same precedent as /admin/questions and
 * /admin/blueprints -- launch scope (CLAUDE.md) is the only board/class that exists yet.
 */
function AdminSyllabus() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [subjects, setSubjects] = useState<Array<Subject>>([])
  const [subjectId, setSubjectId] = useState('')
  const [chapters, setChapters] = useState<Array<Chapter>>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [expandedChapterId, setExpandedChapterId] = useState<string | null>(
    null,
  )
  const [concepts, setConcepts] = useState<Array<Concept>>([])
  const [scope, setScope] = useState<ChapterScope | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    fetch('/api/syllabus/subjects?board=CBSE&class=7')
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load subjects.')
        return r.json() as Promise<Array<Subject>>
      })
      .then((data) => {
        setSubjects(data)
        if (data.length === 1) setSubjectId(data[0].id)
      })
      .catch((err: Error) => setLoadError(err.message))
  }, [isPending, session, role, navigate])

  useEffect(() => {
    setChapters([])
    setExpandedChapterId(null)
    if (!subjectId) return
    fetch(`/api/syllabus/chapters?subject_id=${subjectId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load chapters.')
        return r.json() as Promise<Array<Chapter>>
      })
      .then(setChapters)
      .catch((err: Error) => setLoadError(err.message))
  }, [subjectId])

  async function toggleChapter(chapter: Chapter) {
    if (expandedChapterId === chapter.id) {
      setExpandedChapterId(null)
      return
    }
    setExpandedChapterId(chapter.id)
    setDetailLoading(true)
    setConcepts([])
    setScope(null)
    try {
      const [conceptsRes, scopeRes] = await Promise.all([
        fetch(`/api/syllabus/concepts?chapter_id=${chapter.id}`),
        fetch(`/api/syllabus/chapters/${chapter.id}/scope`),
      ])
      if (conceptsRes.ok) setConcepts(await conceptsRes.json())
      if (scopeRes.ok) setScope(await scopeRes.json())
    } finally {
      setDetailLoading(false)
    }
  }

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Syllabus</h1>
          <p className="text-body text-muted-foreground">
            Read-only view of the board/class/subject/chapter/concept hierarchy
            and each chapter&apos;s IN/OUT scope. Content is added via the
            ingest-source and scope-authoring skills, not from here.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {loadError && (
        <p className="text-small text-destructive mb-4" role="alert">
          {loadError}
        </p>
      )}

      {subjects.length > 1 && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <select
              id="subject"
              className="border-input flex h-9 w-full max-w-xs rounded-md border bg-transparent px-3 text-sm shadow-xs"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            >
              <option value="">Select a subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (Class {s.class})
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {subjects.length === 0 && !loadError && (
        <p className="text-body text-muted-foreground">
          No subjects found for CBSE Class 7 yet.
        </p>
      )}

      <div className="space-y-3">
        {chapters.map((chapter) => (
          <Card key={chapter.id}>
            <CardHeader
              className="cursor-pointer"
              onClick={() => void toggleChapter(chapter)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-h3">
                    {chapter.part} Ch {chapter.chapter_no}: {chapter.name}
                  </CardTitle>
                  {chapter.blurb && (
                    <CardDescription>{chapter.blurb}</CardDescription>
                  )}
                </div>
                <p className="text-small text-muted-foreground whitespace-nowrap">
                  {chapter.in_scope_count} in / {chapter.out_scope_count} out
                  of scope
                </p>
              </div>
            </CardHeader>

            {expandedChapterId === chapter.id && (
              <CardContent>
                {detailLoading && (
                  <p className="text-small text-muted-foreground">Loading…</p>
                )}

                {!detailLoading && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-small mb-2 font-medium">
                        Concepts ({concepts.length})
                      </p>
                      {concepts.length === 0 && (
                        <p className="text-small text-muted-foreground">
                          No concepts scoped for this chapter yet.
                        </p>
                      )}
                      <ul className="space-y-1">
                        {concepts.map((c) => (
                          <li key={c.id} className="text-small">
                            <span className="text-muted-foreground">
                              {c.code}
                            </span>{' '}
                            {c.name} — {c.difficulty_base}, target{' '}
                            {c.target_question_count}/concept
                          </li>
                        ))}
                      </ul>
                    </div>

                    {scope && (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-small mb-2 font-medium">
                            IN scope ({scope.in.length})
                          </p>
                          <ul className="space-y-1">
                            {scope.in.map((item) => (
                              <li key={item.id} className="text-small">
                                {item.item_text}
                                {item.page_ref && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    ({item.page_ref})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-small mb-2 font-medium">
                            OUT of scope ({scope.out.length})
                          </p>
                          <ul className="space-y-1">
                            {scope.out.map((item) => (
                              <li key={item.id} className="text-small">
                                {item.item_text}
                                {item.page_ref && (
                                  <span className="text-muted-foreground">
                                    {' '}
                                    ({item.page_ref})
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  ImagePlus,
  RotateCw,
  ScanText,
  Trash2,
} from 'lucide-react'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ThemeToggle } from '../../components/theme-toggle'
import { PageLoading } from '../../components/page-loading'
import { useSession } from '../../lib/auth-client'
import {
  blobToBase64,
  filesToPages,
  formatBytes,
  rotatePage,
} from '../../lib/scan-client'
import type { LocalPage } from '../../lib/scan-client'

// F050-F053: photograph a paper that was written by hand, have the answers read, check anything
// unsure next to the photo, then send it for marking. Used by the student herself or a parent of
// her household. Every rule shown here is enforced again by the server.
export const Route = createFileRoute('/scan/$attemptId')({ component: ScanPaper })

interface ScanPage {
  id: string
  page_number: number
  size_bytes: number
  extracted: boolean
  extraction_error: string | null
  purged: boolean
  url: string | null
}
interface ScanQuestion {
  id: string
  key: string
  position: number
  choice_group: string | null
  type: string
  marks: number
  text: string
  option_labels: Array<string>
}
interface BBox {
  x: number
  y: number
  w: number
  h: number
}
interface Detection {
  id: string
  scan_page_id: string
  detected_label: string
  paper_question_id: string | null
  response_text: string | null
  selected_option: string | null
  confidence: number
  bbox: BBox | null
  status: 'mapped' | 'unmapped' | 'duplicate' | 'confirmed' | 'discarded'
  confirmed: boolean
}
interface ScanState {
  attempt: { id: string; status: string; paper_id: string; paper_title: string }
  viewer_role: string
  ai_available: boolean
  threshold: number
  limits: { max_pages: number; max_bytes: number; max_page_bytes: number; retention_days: number }
  pages: Array<ScanPage>
  questions: Array<ScanQuestion>
  detections: Array<Detection>
  blockers: {
    unmapped: number
    duplicates: number
    unconfirmedLowConfidence: number
    missingPositions: Array<number>
  }
  can_apply: boolean
}

const PILL = {
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  muted: 'bg-muted text-muted-foreground',
}
const WARN_ROW =
  'bg-amber-50/60 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900'

function Pill({ tone, children }: { tone: keyof typeof PILL; children: React.ReactNode }) {
  return (
    <span className={`text-caption whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${PILL[tone]}`}>
      {children}
    </span>
  )
}

async function errorMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  return body?.message ?? fallback
}

function ScanPaper() {
  const { attemptId } = Route.useParams()
  const navigate = useNavigate()
  const { data: session, isPending } = useSession()
  const [state, setState] = useState<ScanState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const images = usePageImages(state?.pages ?? [])

  const load = useCallback(async () => {
    const response = await fetch(`/api/attempts/${attemptId}/scan`)
    if (!response.ok) {
      setLoadError(
        response.status === 404
          ? 'This paper was not found.'
          : await errorMessage(response, 'Could not load this paper.'),
      )
      return
    }
    setState((await response.json()) as ScanState)
  }, [attemptId])

  useEffect(() => {
    if (isPending) return
    if (!session) {
      void navigate({ to: '/' })
      return
    }
    void load()
    // Image links are signed for 10 minutes; refresh them while someone is still checking.
    const timer = window.setInterval(() => void load(), 8 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [isPending, session, navigate, load])

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <p className="text-body text-destructive" role="alert">
          {loadError}
        </p>
      </div>
    )
  }
  if (isPending || !state) return <PageLoading />

  const isStudent = state.viewer_role === 'student'
  const backHref = isStudent ? `/attempt/${attemptId}` : `/paper/${state.attempt.paper_id}`
  const closed = state.attempt.status !== 'in_progress'
  const readPages = state.pages.filter((p) => p.extracted).length

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-16 sm:p-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <a href={backHref} className="text-small text-primary hover:underline">
            ← Back to the paper
          </a>
          <h1 className="text-h1 mt-1">Upload written answers</h1>
          <p className="text-small text-muted-foreground">{state.attempt.paper_title}</p>
        </div>
        <ThemeToggle />
      </div>

      {closed ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-body">This paper has been sent for marking.</p>
            <a href={backHref}>
              <Button size="sm">Back to the paper</Button>
            </a>
          </CardContent>
        </Card>
      ) : (
        <>
          <PagesStep state={state} attemptId={attemptId} images={images} onChanged={load} />
          {state.pages.length > 0 && (
            <ReadStep state={state} attemptId={attemptId} onChanged={load} />
          )}
          {readPages > 0 && (
            <CheckStep state={state} attemptId={attemptId} images={images} onChanged={load} />
          )}
          {readPages > 0 && (
            <SendStep
              state={state}
              attemptId={attemptId}
              onDone={() =>
                void (isStudent
                  ? navigate({ to: '/attempt/$id', params: { id: attemptId } })
                  : navigate({ to: '/evaluate/$attemptId', params: { attemptId } }))
              }
            />
          )}
        </>
      )}
    </div>
  )
}

interface PageImage {
  src: string
  w: number
  h: number
}

/**
 * Page photos are fetched rather than put straight into <img src>: an image request (Sec-Fetch-Dest:
 * image) to an /api route is treated as a static file by the Nitro dev server and 404s, and a
 * fetched blob also keeps the signed link out of the page and gives the size the crops need.
 * Keyed by page id, so the 8-minute re-signing refresh doesn't download the photos again.
 */
function usePageImages(pages: Array<ScanPage>): Record<string, PageImage> {
  const [images, setImages] = useState<Record<string, PageImage>>({})
  const loading = useRef(new Set<string>())
  const wanted = pages.filter((p) => p.url).map((p) => `${p.id}|${p.url}`).join(',')

  useEffect(() => {
    const live = new Set<string>()
    for (const entry of wanted ? wanted.split(',') : []) {
      const [id, url] = entry.split('|')
      live.add(id)
      if (loading.current.has(id)) continue
      loading.current.add(id)
      void (async () => {
        try {
          const response = await fetch(url)
          if (!response.ok) throw new Error(String(response.status))
          const blob = await response.blob()
          const bitmap = await createImageBitmap(blob)
          const image = { src: URL.createObjectURL(blob), w: bitmap.width, h: bitmap.height }
          bitmap.close()
          setImages((prev) => ({ ...prev, [id]: image }))
        } catch {
          loading.current.delete(id)
        }
      })()
    }
    setImages((prev) => {
      const stale = Object.keys(prev).filter((id) => !live.has(id))
      if (stale.length === 0) return prev
      const next = { ...prev }
      for (const id of stale) {
        URL.revokeObjectURL(next[id].src)
        delete next[id]
        loading.current.delete(id)
      }
      return next
    })
  }, [wanted])

  return images
}

function PagesStep({
  state,
  attemptId,
  images,
  onChanged,
}: {
  state: ScanState
  attemptId: string
  images: Record<string, PageImage>
  onChanged: () => Promise<void>
}) {
  const [local, setLocal] = useState<Array<LocalPage>>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)

  const uploadedBytes = state.pages.reduce((sum, p) => sum + p.size_bytes, 0)
  const localBytes = local.reduce((sum, p) => sum + p.blob.size, 0)
  const totalPages = state.pages.length + local.length
  const overBytes = uploadedBytes + localBytes > state.limits.max_bytes
  const overPages = totalPages > state.limits.max_pages

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    setError(null)
    setBusy('Preparing the photos…')
    try {
      const pages = await filesToPages([...list])
      setLocal((prev) => [...prev, ...pages])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open those files.')
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
      if (cameraInput.current) cameraInput.current.value = ''
    }
  }

  function moveLocal(index: number, by: number) {
    setLocal((prev) => {
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item)
      return next
    })
  }

  async function upload() {
    setError(null)
    for (const [i, page] of local.entries()) {
      setBusy(`Uploading page ${i + 1} of ${local.length}…`)
      const response = await fetch(`/api/attempts/${attemptId}/scan/pages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ media_type: 'image/jpeg', image_base64: await blobToBase64(page.blob) }),
      })
      if (!response.ok) {
        setError(await errorMessage(response, `Could not upload ${page.source}.`))
        setLocal((prev) => prev.slice(i))
        setBusy(null)
        await onChanged()
        return
      }
      URL.revokeObjectURL(page.previewUrl)
    }
    setLocal([])
    setBusy(null)
    await onChanged()
  }

  async function moveUploaded(index: number, by: number) {
    const ids = state.pages.map((p) => p.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + by, 0, id)
    setBusy('Saving the order…')
    await fetch(`/api/attempts/${attemptId}/scan`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page_ids: ids }),
    })
    setBusy(null)
    await onChanged()
  }

  async function removeUploaded(id: string) {
    setBusy('Removing the page…')
    await fetch(`/api/attempts/${attemptId}/scan/pages/${id}`, { method: 'DELETE' })
    setBusy(null)
    await onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">1. Photos of the pages</CardTitle>
        <CardDescription>
          Lay each page flat in good light and photograph it straight on, one page per photo. A
          scanned PDF works too. Photos are stored encrypted and deleted after{' '}
          {state.limits.retention_days} days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.pages.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {state.pages.map((page, i) => (
              <li key={page.id} className="bg-card space-y-2 rounded-lg border p-2">
                {page.url ? (
                  page.id in images ? (
                    <img
                      src={images[page.id].src}
                      alt={`Page ${page.page_number}`}
                      className="aspect-[3/4] w-full rounded object-cover"
                    />
                  ) : (
                    <div className="bg-muted aspect-[3/4] w-full animate-pulse rounded" />
                  )
                ) : (
                  <div className="bg-muted text-small text-muted-foreground flex aspect-[3/4] items-center justify-center rounded p-2 text-center">
                    Photo deleted
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-small whitespace-nowrap font-medium">Page {page.page_number}</span>
                  {page.extraction_error ? (
                    <Pill tone="warn">Not read</Pill>
                  ) : page.extracted ? (
                    <Pill tone="ok">Read</Pill>
                  ) : (
                    <Pill tone="muted">Not read yet</Pill>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="outline" aria-label="Move earlier" disabled={i === 0 || !!busy} onClick={() => void moveUploaded(i, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon" variant="outline" aria-label="Move later" disabled={i === state.pages.length - 1 || !!busy} onClick={() => void moveUploaded(i, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon" variant="outline" aria-label={`Remove page ${page.page_number}`} disabled={!!busy} onClick={() => void removeUploaded(page.id)}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {local.length > 0 && (
          <div className="space-y-2">
            <p className="text-small font-medium">Ready to upload</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {local.map((page, i) => (
                <li key={page.key} className="space-y-2 rounded-lg border border-dashed p-2">
                  <img src={page.previewUrl} alt={page.source} className="aspect-[3/4] w-full rounded object-contain" />
                  <p className="text-caption text-muted-foreground truncate">{page.source}</p>
                  <div className="flex gap-1">
                    <Button size="icon" variant="outline" aria-label="Turn a quarter turn" disabled={!!busy} onClick={() => void rotatePage(page).then((r) => setLocal((prev) => prev.map((p) => (p.key === r.key ? r : p))))}>
                      <RotateCw />
                    </Button>
                    <Button size="icon" variant="outline" aria-label="Move earlier" disabled={i === 0} onClick={() => moveLocal(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="outline" aria-label="Move later" disabled={i === local.length - 1} onClick={() => moveLocal(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      aria-label="Remove"
                      onClick={() => {
                        URL.revokeObjectURL(page.previewUrl)
                        setLocal((prev) => prev.filter((p) => p.key !== page.key))
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void addFiles(e.target.files)} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!!busy} onClick={() => cameraInput.current?.click()}>
            <Camera /> Take a photo
          </Button>
          <Button type="button" variant="outline" disabled={!!busy} onClick={() => fileInput.current?.click()}>
            <ImagePlus /> Choose photos or PDF
          </Button>
          {local.length > 0 && (
            <Button type="button" disabled={!!busy || overBytes || overPages} onClick={() => void upload()}>
              Upload {local.length} {local.length === 1 ? 'page' : 'pages'}
            </Button>
          )}
        </div>

        <p className={`text-small ${overBytes || overPages ? 'text-destructive' : 'text-muted-foreground'}`}>
          {totalPages} of {state.limits.max_pages} pages · {formatBytes(uploadedBytes + localBytes)} of{' '}
          {formatBytes(state.limits.max_bytes)}
          {overBytes && ' — too large: remove a page to continue.'}
          {!overBytes && overPages && ' — too many pages: remove some to continue.'}
        </p>
        {busy && (
          <p className="text-small text-muted-foreground" role="status">
            {busy}
          </p>
        )}
        {error && (
          <p className="text-small text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ReadStep({
  state,
  attemptId,
  onChanged,
}: {
  state: ScanState
  attemptId: string
  onChanged: () => Promise<void>
}) {
  const [progress, setProgress] = useState<string | null>(null)
  const [errors, setErrors] = useState<Array<string>>([])
  const unread = state.pages.filter((p) => !p.extracted)

  async function readPages(pages: Array<ScanPage>) {
    const failed: Array<string> = []
    for (const [i, page] of pages.entries()) {
      setProgress(`Reading page ${page.page_number} (${i + 1} of ${pages.length})… this takes about 15 seconds a page.`)
      const response = await fetch(`/api/attempts/${attemptId}/scan/pages/${page.id}/extract`, { method: 'POST' })
      if (!response.ok) {
        failed.push(`Page ${page.page_number}: ${await errorMessage(response, 'could not be read.')}`)
        if (response.status === 429 || response.status === 503) break
      }
    }
    setErrors(failed)
    setProgress(null)
    await onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">2. Read the answers</CardTitle>
        <CardDescription>
          The answers are read from the photos and matched to their question numbers. Nothing is
          marked yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!state.ai_available ? (
          <p className="text-small text-destructive">
            Reading photos is not switched on yet. Type the answers on the paper screen instead.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button disabled={!!progress || unread.length === 0} onClick={() => void readPages(unread)}>
              <ScanText />
              {unread.length === 0
                ? 'All pages read'
                : `Read ${unread.length} ${unread.length === 1 ? 'page' : 'pages'}`}
            </Button>
            {unread.length === 0 && (
              <Button variant="outline" disabled={!!progress} onClick={() => void readPages(state.pages)}>
                Read all pages again
              </Button>
            )}
          </div>
        )}
        {progress && (
          <p className="text-small text-muted-foreground" role="status">
            {progress}
          </p>
        )}
        {[...errors, ...state.pages.filter((p) => p.extraction_error && !errors.length).map((p) => `Page ${p.page_number}: ${p.extraction_error}`)].map((e) => (
          <p key={e} className="text-small text-destructive" role="alert">
            {e}
          </p>
        ))}
      </CardContent>
    </Card>
  )
}

function Crop({ detection, page, image }: { detection: Detection; page?: ScanPage; image?: PageImage }) {
  if (!page || !image) return null
  const box = detection.bbox
  if (!box || box.w >= 1 || box.h >= 1) {
    return (
      <a href={image.src} target="_blank" rel="noreferrer" className="text-small text-primary hover:underline">
        See page {page.page_number}
      </a>
    )
  }
  // Pad the box a little so the first and last lines aren't clipped.
  const pad = 0.015
  const x = Math.max(0, box.x - pad)
  const y = Math.max(0, box.y - pad)
  const w = Math.min(1 - x, box.w + pad * 2)
  const h = Math.min(1 - y, box.h + pad * 2)
  const style: CSSProperties = {
    aspectRatio: `${w * image.w} / ${h * image.h}`,
    backgroundImage: `url("${image.src}")`,
    backgroundSize: `${100 / w}% auto`,
    backgroundPosition: `${w < 1 ? (x / (1 - w)) * 100 : 0}% ${h < 1 ? (y / (1 - h)) * 100 : 0}%`,
  }
  return (
    <a href={image.src} target="_blank" rel="noreferrer" title={`Open page ${page.page_number}`}>
      <div role="img" aria-label={`Handwriting on page ${page.page_number}`} className="w-full max-h-72 rounded border bg-white bg-no-repeat" style={style} />
    </a>
  )
}

function CheckStep({
  state,
  attemptId,
  images,
  onChanged,
}: {
  state: ScanState
  attemptId: string
  images: Record<string, PageImage>
  onChanged: () => Promise<void>
}) {
  const pagesById = useMemo(() => new Map(state.pages.map((p) => [p.id, p])), [state.pages])
  const live = state.detections.filter((d) => d.status !== 'discarded')
  const unassigned = live.filter((d) => d.status === 'unmapped')
  const discarded = state.detections.filter((d) => d.status === 'discarded')
  const positions = [...new Set(state.questions.map((q) => q.position))].sort((a, b) => a - b)
  const b = state.blockers
  const toCheck = b.unmapped + b.duplicates + b.unconfirmedLowConfidence

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">3. Check the answers</CardTitle>
        <CardDescription>
          {toCheck === 0
            ? 'Everything is matched. Have a quick look, then send it for marking.'
            : `${toCheck} ${toCheck === 1 ? 'answer needs' : 'answers need'} checking against the photo before marking.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {unassigned.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-body font-semibold">Which question is this?</h3>
            {unassigned.map((d) => (
              <DetectionCard key={d.id} detection={d} state={state} attemptId={attemptId} page={pagesById.get(d.scan_page_id)} image={images[d.scan_page_id]} onChanged={onChanged} />
            ))}
          </section>
        )}

        {positions.map((position) => {
          const members = state.questions.filter((q) => q.position === position)
          const memberIds = new Set(members.map((q) => q.id))
          const found = live.filter((d) => d.paper_question_id && memberIds.has(d.paper_question_id))
          const missing = b.missingPositions.includes(position)
          return (
            <section key={position} className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-body font-semibold">Q{position}</h3>
                <span className="text-small text-muted-foreground line-clamp-1">
                  {members.length > 1 ? members.map((m) => `${m.key}: ${m.text}`).join('  ·  OR  ·  ') : members[0]?.text}
                </span>
              </div>
              {found.length > 1 && (
                <p className="text-small text-amber-700 dark:text-amber-200">
                  More than one answer was found for this question. Keep the right one and mark the other &quot;Not an answer&quot;, or move it to its question.
                </p>
              )}
              {found.map((d) => (
                <DetectionCard key={d.id} detection={d} state={state} attemptId={attemptId} page={pagesById.get(d.scan_page_id)} image={images[d.scan_page_id]} onChanged={onChanged} />
              ))}
              {found.length === 0 && (
                <p className={`text-small rounded-md border p-3 ${missing ? WARN_ROW : ''}`}>
                  No answer found. Left blank, or on a page that hasn&apos;t been added?
                </p>
              )}
            </section>
          )
        })}

        {discarded.length > 0 && (
          <details className="rounded-md border p-3">
            <summary className="text-small cursor-pointer">Not answers ({discarded.length})</summary>
            <div className="mt-2 space-y-2">
              {discarded.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <span className="text-small text-muted-foreground line-clamp-1">{d.response_text ?? d.selected_option}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void fetch(`/api/attempts/${attemptId}/scan/detections/${d.id}`, {
                        method: 'PATCH',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ action: 'restore' }),
                      }).then(onChanged)
                    }
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

function DetectionCard({
  detection,
  state,
  attemptId,
  page,
  image,
  onChanged,
}: {
  detection: Detection
  state: ScanState
  attemptId: string
  page?: ScanPage
  image?: PageImage
  onChanged: () => Promise<void>
}) {
  const question = state.questions.find((q) => q.id === detection.paper_question_id)
  const [text, setText] = useState(detection.response_text ?? '')
  const [option, setOption] = useState(detection.selected_option ?? '')
  const [assignTo, setAssignTo] = useState(detection.paper_question_id ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(detection.response_text ?? '')
    setOption(detection.selected_option ?? '')
    setAssignTo(detection.paper_question_id ?? '')
  }, [detection.response_text, detection.selected_option, detection.paper_question_id])

  const target = state.questions.find((q) => q.id === assignTo) ?? question
  const isOptions = (target?.option_labels.length ?? 0) > 0
  const lowConfidence = detection.confidence < state.threshold
  const needsLook =
    detection.status === 'unmapped' ||
    detection.status === 'duplicate' ||
    (lowConfidence && !detection.confirmed)

  async function send(body: Record<string, unknown>) {
    setSaving(true)
    setError(null)
    const response = await fetch(`/api/attempts/${attemptId}/scan/detections/${detection.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (!response.ok) {
      setError(await errorMessage(response, 'Could not save that.'))
      return
    }
    await onChanged()
  }

  function confirm() {
    if (!assignTo) {
      setError('Choose which question this answers first.')
      return
    }
    void send({
      action: 'confirm',
      paper_question_id: assignTo,
      ...(isOptions ? { selected_option: option || null } : { response_text: text }),
    })
  }

  return (
    <div className={`space-y-3 rounded-lg border p-3 ${needsLook ? WARN_ROW : 'bg-card'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">
          Page {page?.page_number ?? '?'} · read as &quot;{detection.detected_label}&quot;
        </span>
        {detection.status === 'unmapped' && <Pill tone="warn">Needs a question</Pill>}
        {detection.status === 'duplicate' && <Pill tone="warn">Duplicate</Pill>}
        {detection.status !== 'unmapped' && detection.status !== 'duplicate' && (
          detection.confirmed ? (
            <Pill tone="ok">Checked</Pill>
          ) : lowConfidence ? (
            <Pill tone="warn">Unclear — please check</Pill>
          ) : (
            <Pill tone="ok">Clear</Pill>
          )
        )}
      </div>

      <Crop detection={detection} page={page} image={image} />

      {(detection.status === 'unmapped' || detection.status === 'duplicate') && (
        <label className="text-small block space-y-1">
          <span className="font-medium">This answers</span>
          <select className="border-input bg-background block h-10 w-full rounded-md border px-2" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">Choose a question…</option>
            {state.questions.map((q) => (
              <option key={q.id} value={q.id}>
                Q{q.key} — {q.text.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
      )}

      {isOptions ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Option chosen">
          {target?.option_labels.map((label) => (
            <Button key={label} type="button" size="sm" variant={option === label ? 'default' : 'outline'} role="radio" aria-checked={option === label} onClick={() => setOption(label)}>
              ({label})
            </Button>
          ))}
        </div>
      ) : (
        <textarea
          className="border-input bg-background text-body block min-h-24 w-full rounded-md border p-2"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="What was written"
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={saving} onClick={confirm}>
          <Check />
          {text !== (detection.response_text ?? '') || option !== (detection.selected_option ?? '') || assignTo !== (detection.paper_question_id ?? '')
            ? 'Save'
            : 'Looks right'}
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={() => void send({ action: 'discard' })}>
          Not an answer
        </Button>
      </div>
      {error && (
        <p className="text-small text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function SendStep({
  state,
  attemptId,
  onDone,
}: {
  state: ScanState
  attemptId: string
  onDone: () => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blankWarning, setBlankWarning] = useState<string | null>(null)

  async function send(confirmBlanks: boolean) {
    setSending(true)
    setError(null)
    const response = await fetch(`/api/attempts/${attemptId}/scan/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm_blanks: confirmBlanks }),
    })
    setSending(false)
    if (response.ok) {
      onDone()
      return
    }
    const body = (await response.json().catch(() => null)) as
      | { error?: string; message?: string; details?: { missing_positions?: Array<number> } }
      | null
    if (body?.error === 'blank_answers') {
      const list = (body.details?.missing_positions ?? []).map((p) => `Q${p}`).join(', ')
      setBlankWarning(`No answer was found for ${list}. They will be marked as blank.`)
      return
    }
    setError(body?.message ?? 'Could not send the paper for marking.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-h3">4. Send for marking</CardTitle>
        <CardDescription>
          {state.viewer_role === 'student'
            ? 'Your answers are marked the same way as a paper done on screen.'
            : 'Marks are proposed next, and nothing counts until you confirm them.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {blankWarning ? (
          <div className={`space-y-3 rounded-md border p-3 ${WARN_ROW}`}>
            <p className="text-small">{blankWarning}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={sending} onClick={() => void send(true)}>
                Send anyway
              </Button>
              <Button variant="outline" onClick={() => setBlankWarning(null)}>
                Go back and add pages
              </Button>
            </div>
          </div>
        ) : (
          <Button disabled={sending || !state.can_apply} onClick={() => void send(false)}>
            {sending ? 'Sending…' : 'Send for marking'}
          </Button>
        )}
        {!state.can_apply && (
          <p className="text-small text-muted-foreground">
            Check every answer marked above first.
          </p>
        )}
        {error && (
          <p className="text-small text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

import type { Db } from '../db/connection'
import {
  attemptAnswersRepository,
  attemptsRepository,
  paperQuestionsRepository,
  papersRepository,
  scanAccessRepository,
  scanDetectionsRepository,
  scanPagesRepository,
  uploadsRepository,
} from '../db/repositories'
import { resolveEnabledStudent } from './access'
import { transcribePage } from './ai-transcription'
import { isAiConfigured } from './ai-provider'
import {
  AiCapReachedError,
  StudentSpendCapReachedError,
  enforceStudentSpendBudget,
} from './ai-metering'
import { submitAttempt } from './attempt-submit'
import { decryptScan, encryptScan, signedScanPageUrl } from './scan-crypto'
import {
  OCR_CONFIDENCE_THRESHOLD,
  applyBlockers,
  buildScanKey,
  checkOption,
  computeStatuses,
  isBlocked,
  parsePageReadings,
  resolveLabel,
} from './scan-mapping'
import type { BBox, DetectionStatus, ScanSlot } from './scan-mapping'
import type { AuthedUser } from './session'

// F050-F053 + F097: a written paper, photographed page by page, read by a vision model, checked
// by a person, then submitted exactly like a typed attempt. The pure rules live in
// scan-mapping.ts; this file is the I/O around them.

/** F050: "20MB cap with clear errors". Pages arrive already compressed by the browser. */
export const MAX_SCAN_BYTES = 20 * 1024 * 1024
export const MAX_SCAN_PAGES = 20
/** One compressed page. Fits under the serverless request-body limit once base64-encoded. */
export const MAX_PAGE_BYTES = 3 * 1024 * 1024
export const SCAN_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** F097: page images are deleted this long after upload. The text read from them stays. */
export const SCAN_RETENTION_DAYS = 30

export class ScanError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
  toResponse(): Response {
    return Response.json(
      { error: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
      { status: this.status },
    )
  }
}

type Attempt = NonNullable<Awaited<ReturnType<typeof attemptsRepository.findById>>>

export interface ScanAccess {
  user: AuthedUser
  attempt: Attempt
  student: { id: string; household_id: string }
}

/**
 * The student herself, or a parent/admin of her household (F052/F053 name the parent as the one
 * who settles mapping and low-confidence readings). Anything else is a 404, never a 403, so
 * another household can't even learn the attempt exists (T02).
 */
export async function resolveScanAccess(
  db: Db,
  user: AuthedUser,
  attemptId: string,
): Promise<ScanAccess | Response> {
  if (user.role === 'student') {
    const student = await resolveEnabledStudent(db, user.id)
    if (student instanceof Response) return student
    const attempt = await attemptsRepository.findById(db, student.id, attemptId)
    if (!attempt) return new Response(null, { status: 404 })
    return { user, attempt, student: { id: student.id, household_id: student.household_id } }
  }
  if (user.role === 'parent' || user.role === 'admin') {
    const row = await scanAccessRepository.findAttemptInHousehold(db, user.householdId, attemptId)
    if (!row) return new Response(null, { status: 404 })
    const { student_household_id, ...attempt } = row
    return {
      user,
      attempt,
      student: { id: attempt.student_id, household_id: student_household_id },
    }
  }
  return new Response(null, { status: 404 })
}

/**
 * F050 entry point for a paper done on paper: the attempt to attach photos to. Reuses her open
 * attempt at this paper if there is one, otherwise starts an 'uploaded' one. A parent needs this
 * because only the student can start an attempt on screen, yet the parent is usually the one with
 * the printed pages and the phone. Returns null when the paper isn't reachable (a 404).
 */
export async function startScanAttempt(db: Db, user: AuthedUser, paperId: string) {
  let studentId: string
  if (user.role === 'student') {
    const student = await resolveEnabledStudent(db, user.id)
    if (student instanceof Response) return student
    const paper = await papersRepository.findById(db, student.id, paperId)
    if (!paper) return null
    studentId = student.id
  } else if (user.role === 'parent' || user.role === 'admin') {
    const paper = await scanAccessRepository.findPaperInHousehold(db, user.householdId, paperId)
    if (!paper) return null
    studentId = paper.student_id
  } else {
    return null
  }
  const open = (await attemptsRepository.list(db, studentId))
    .filter((a) => a.paper_id === paperId && a.status === 'in_progress')
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .at(0)
  if (open) return open
  return attemptsRepository.insert(db, {
    paper_id: paperId,
    student_id: studentId,
    mode: 'uploaded',
    status: 'in_progress',
  })
}

function requireOpen(access: ScanAccess) {
  if (access.attempt.status !== 'in_progress') {
    throw new ScanError(409, 'attempt_closed', 'This paper has already been sent for marking.')
  }
}

async function loadSlots(db: Db, paperId: string) {
  const rows = await paperQuestionsRepository.listForPaperWithQuestions(db, paperId)
  const options = await scanAccessRepository.optionLabelsForQuestions(
    db,
    [...new Set(rows.map((r) => r.question_id))],
  )
  const labelsByQuestion = new Map<string, Array<string>>()
  for (const o of options) {
    const list = labelsByQuestion.get(o.question_id) ?? []
    list.push(o.label)
    labelsByQuestion.set(o.question_id, list)
  }
  const slots: Array<ScanSlot & { type: string; marks: number }> = rows.map((r) => ({
    id: r.id,
    position: r.position,
    choiceGroup: r.choice_group,
    text: r.text,
    optionLabels: labelsByQuestion.get(r.question_id) ?? [],
    type: r.type,
    marks: Number(r.marks),
  }))
  return slots
}

type DetectionRow = Awaited<ReturnType<typeof scanDetectionsRepository.listForAttempt>>[number]

function toState(d: DetectionRow) {
  return {
    id: d.id,
    paperQuestionId: d.paper_question_id,
    confidence: Number(d.confidence),
    confirmed: d.confirmed_at !== null,
    discarded: d.status === 'discarded',
  }
}

async function recomputeStatuses(
  db: Db,
  access: ScanAccess,
  slots: Array<ScanSlot>,
): Promise<Array<DetectionRow & { status: DetectionStatus }>> {
  const detections = await scanDetectionsRepository.listForAttempt(
    db,
    access.student.id,
    access.attempt.id,
  )
  const statuses = computeStatuses(detections.map(toState), slots)
  await scanDetectionsRepository.setStatuses(db, access.student.id, statuses)
  return detections.map((d) => ({ ...d, status: statuses.get(d.id) ?? 'unmapped' }))
}

/**
 * Questions the student already answered on screen before photographing the rest. They are not
 * "missing" even though no photo shows them, and the scan doesn't overwrite them unless a photo
 * does show an answer for them.
 */
async function alreadyAnsweredPositions(db: Db, access: ScanAccess, slots: Array<ScanSlot>) {
  const answers = await attemptAnswersRepository.listForAttempt(db, access.attempt.id)
  const answered = new Set(
    answers
      .filter((a) => (a.response_text?.trim() ?? '') !== '' || a.selected_option)
      .map((a) => a.paper_question_id),
  )
  return new Set(slots.filter((s) => answered.has(s.id)).map((s) => s.position))
}

/** Everything the review screen needs. Never includes the answer key. */
export async function getScanState(db: Db, access: ScanAccess) {
  const slots = await loadSlots(db, access.attempt.paper_id)
  const paper = await papersRepository.findById(db, access.student.id, access.attempt.paper_id)
  const [pages, detections] = await Promise.all([
    scanPagesRepository.listForAttempt(db, access.student.id, access.attempt.id),
    access.attempt.status === 'in_progress'
      ? recomputeStatuses(db, access, slots)
      : scanDetectionsRepository.listForAttempt(db, access.student.id, access.attempt.id),
  ])
  const withStatus = detections.map((d) => ({ ...d, status: d.status as DetectionStatus }))
  const blockers = applyBlockers(withStatus.map((d) => ({ ...toState(d), status: d.status })), slots)
  const typed = await alreadyAnsweredPositions(db, access, slots)
  blockers.missingPositions = blockers.missingPositions.filter((p) => !typed.has(p))
  const key = buildScanKey(slots)
  const keyBySlot = new Map(key.map((k) => [k.slotId, k.key]))

  return {
    attempt: {
      id: access.attempt.id,
      status: access.attempt.status,
      mode: access.attempt.mode,
      paper_id: access.attempt.paper_id,
      paper_title: paper?.title ?? 'Question paper',
    },
    viewer_role: access.user.role,
    ai_available: isAiConfigured(),
    threshold: OCR_CONFIDENCE_THRESHOLD,
    limits: {
      max_pages: MAX_SCAN_PAGES,
      max_bytes: MAX_SCAN_BYTES,
      max_page_bytes: MAX_PAGE_BYTES,
      retention_days: SCAN_RETENTION_DAYS,
    },
    pages: pages.map((p) => ({
      id: p.id,
      page_number: p.page_number,
      size_bytes: p.size_bytes,
      extracted: p.extracted_at !== null,
      extraction_error: p.extraction_error,
      purged: p.purged_at !== null,
      url: p.purged_at ? null : signedScanPageUrl(p.id),
    })),
    questions: slots.map((s) => ({
      id: s.id,
      key: keyBySlot.get(s.id) ?? String(s.position),
      position: s.position,
      choice_group: s.choiceGroup,
      type: s.type,
      marks: s.marks,
      text: s.text,
      option_labels: s.optionLabels,
    })),
    detections: withStatus.map((d) => ({
      id: d.id,
      scan_page_id: d.scan_page_id,
      detected_label: d.detected_label,
      paper_question_id: d.paper_question_id,
      response_text: d.response_text,
      selected_option: d.selected_option,
      confidence: Number(d.confidence),
      bbox: d.bbox as BBox | null,
      status: d.status,
      confirmed: d.confirmed_at !== null,
    })),
    blockers,
    can_apply: access.attempt.status === 'in_progress' && pages.length > 0 && !isBlocked(blockers),
  }
}

async function scanUpload(db: Db, access: ScanAccess) {
  const existing = (await uploadsRepository.list(db, access.student.id)).find(
    (u) => u.attempt_id === access.attempt.id && u.kind === 'scan',
  )
  return (
    existing ??
    (await uploadsRepository.insert(db, {
      student_id: access.student.id,
      attempt_id: access.attempt.id,
      kind: 'scan',
      mime: 'image/jpeg',
      page_count: 0,
      size_bytes: 0,
      // Pages live encrypted in scan_pages, not in a file store -- there is no bucket path.
      storage_ref: `scan_pages:${access.attempt.id}`,
    }))
  )
}

async function syncUploadTotals(db: Db, access: ScanAccess, uploadId: string) {
  const pages = await scanPagesRepository.listForAttempt(db, access.student.id, access.attempt.id)
  await uploadsRepository.update(db, access.student.id, uploadId, {
    page_count: pages.length,
    size_bytes: pages.reduce((sum, p) => sum + p.size_bytes, 0),
  })
}

/** F050: one compressed page, appended after the existing ones. */
export async function addScanPage(
  db: Db,
  access: ScanAccess,
  input: { imageBase64: string; mediaType: (typeof SCAN_IMAGE_TYPES)[number] },
) {
  requireOpen(access)
  const image = Buffer.from(input.imageBase64, 'base64')
  if (image.length === 0 || image.length > MAX_PAGE_BYTES) {
    throw new ScanError(413, 'page_too_large', 'That page is too large. Each page must be under 3 MB.')
  }
  const pages = await scanPagesRepository.listForAttempt(db, access.student.id, access.attempt.id)
  if (pages.length >= MAX_SCAN_PAGES) {
    throw new ScanError(413, 'too_many_pages', `A paper can have at most ${MAX_SCAN_PAGES} pages.`)
  }
  const total = pages.reduce((sum, p) => sum + p.size_bytes, 0)
  if (total + image.length > MAX_SCAN_BYTES) {
    throw new ScanError(
      413,
      'scan_too_large',
      'These photos add up to more than 20 MB. Remove a page or retake photos at a lower size.',
    )
  }

  const upload = await scanUpload(db, access)
  const page = await scanPagesRepository.insert(db, {
    attempt_id: access.attempt.id,
    student_id: access.student.id,
    upload_id: upload.id,
    page_number: (pages.at(-1)?.page_number ?? 0) + 1,
    mime: input.mediaType,
    size_bytes: image.length,
    image: encryptScan(image),
    uploaded_by_user_id: access.user.id,
  })
  await syncUploadTotals(db, access, upload.id)
  if (access.attempt.mode !== 'uploaded') {
    await attemptsRepository.update(db, access.student.id, access.attempt.id, { mode: 'uploaded' })
  }
  return page
}

export async function removeScanPage(db: Db, access: ScanAccess, pageId: string) {
  requireOpen(access)
  const page = await scanPagesRepository.findMeta(db, access.student.id, pageId)
  if (!page || page.attempt_id !== access.attempt.id) throw new ScanError(404, 'not_found', 'Page not found.')
  await scanPagesRepository.remove(db, access.student.id, pageId)
  await syncUploadTotals(db, access, page.upload_id)
}

/** F050 "reorder": the full list of page ids, in the new order. */
export async function reorderScanPages(db: Db, access: ScanAccess, pageIds: Array<string>) {
  requireOpen(access)
  const pages = await scanPagesRepository.listForAttempt(db, access.student.id, access.attempt.id)
  const known = new Set(pages.map((p) => p.id))
  if (pageIds.length !== pages.length || new Set(pageIds).size !== pageIds.length || !pageIds.every((id) => known.has(id))) {
    throw new ScanError(400, 'bad_order', 'Send every page of this paper exactly once.')
  }
  for (const [i, id] of pageIds.entries()) {
    await scanPagesRepository.update(db, access.student.id, id, { page_number: i + 1 })
  }
}

/** F051 + F052: read one page and map what's on it to the paper's questions. */
export async function extractScanPage(db: Db, access: ScanAccess, pageId: string) {
  requireOpen(access)
  const page = await scanPagesRepository.findWithImage(db, pageId)
  if (!page || page.student_id !== access.student.id || page.attempt_id !== access.attempt.id) {
    throw new ScanError(404, 'not_found', 'Page not found.')
  }
  if (!page.image) throw new ScanError(410, 'purged', 'This photo has been deleted. Upload it again.')
  if (!isAiConfigured()) {
    throw new ScanError(503, 'ai_unavailable', 'Reading photos is not switched on yet. Type the answers instead.')
  }

  const slots = await loadSlots(db, access.attempt.paper_id)
  const key = buildScanKey(slots)
  const slotById = new Map(slots.map((s) => [s.id, s]))

  let raw: string | null
  try {
    await enforceStudentSpendBudget(db, { studentId: access.student.id })
    raw = await transcribePage(db, {
      imageBase64: decryptScan(page.image).toString('base64'),
      mediaType: page.mime,
      key,
      householdId: access.student.household_id,
      studentId: access.student.id,
    })
  } catch (error) {
    const limit =
      error instanceof AiCapReachedError || error instanceof StudentSpendCapReachedError
    const message = limit
      ? 'The photo reader has reached its limit for now. Try again later or type the answers.'
      : 'Could not read this page right now. Try again in a minute.'
    await scanPagesRepository.update(db, access.student.id, pageId, { extraction_error: message })
    throw new ScanError(limit ? 429 : 502, limit ? 'ai_limit' : 'ai_failed', message)
  }

  const readings = parsePageReadings(raw)
  if (readings === null) {
    const message = 'This page could not be read. Try a clearer, brighter photo taken straight on.'
    await scanPagesRepository.update(db, access.student.id, pageId, { extraction_error: message })
    throw new ScanError(422, 'unreadable', message)
  }

  const rows = readings.map((r) => {
    const slotId = resolveLabel(r.label, key)
    const slot = slotId ? slotById.get(slotId) : undefined
    const { option, confidence } = checkOption(r, slot?.optionLabels ?? [])
    return {
      attempt_id: access.attempt.id,
      student_id: access.student.id,
      scan_page_id: pageId,
      detected_label: r.label,
      paper_question_id: slotId,
      response_text: slot && slot.optionLabels.length > 0 ? null : r.text,
      selected_option: slot && slot.optionLabels.length > 0 ? option : r.option,
      confidence,
      bbox: r.bbox ? JSON.stringify(r.bbox) : null,
      status: 'mapped',
    }
  })
  await scanDetectionsRepository.replaceForPage(db, access.student.id, pageId, rows)
  await scanPagesRepository.update(db, access.student.id, pageId, {
    extracted_at: new Date(),
    extraction_error: null,
  })
  await recomputeStatuses(db, access, slots)
  return { found: rows.length }
}

/**
 * F052/F053: a person assigns, corrects, confirms or discards one reading. Any edit counts as
 * confirmation -- the person has looked at it next to the photo.
 */
export async function updateDetection(
  db: Db,
  access: ScanAccess,
  detectionId: string,
  input: {
    action: 'confirm' | 'discard' | 'restore'
    paper_question_id?: string | null
    response_text?: string | null
    selected_option?: string | null
  },
) {
  requireOpen(access)
  const detection = await scanDetectionsRepository.findById(db, access.student.id, detectionId)
  if (!detection || detection.attempt_id !== access.attempt.id) {
    throw new ScanError(404, 'not_found', 'Answer not found.')
  }
  const slots = await loadSlots(db, access.attempt.paper_id)

  if (input.action === 'discard') {
    await scanDetectionsRepository.update(db, access.student.id, detectionId, { status: 'discarded' })
  } else if (input.action === 'restore') {
    await scanDetectionsRepository.update(db, access.student.id, detectionId, { status: 'unmapped' })
  } else {
    const slotId =
      input.paper_question_id === undefined ? detection.paper_question_id : input.paper_question_id
    const slot = slotId ? slots.find((s) => s.id === slotId) : undefined
    if (slotId && !slot) throw new ScanError(400, 'bad_question', 'That question is not on this paper.')
    let selectedOption =
      input.selected_option === undefined ? detection.selected_option : input.selected_option
    if (slot && slot.optionLabels.length > 0) {
      selectedOption = slot.optionLabels.find((l) => l === selectedOption) ?? null
      if (!selectedOption) {
        throw new ScanError(400, 'choose_option', `Choose one of the options: ${slot.optionLabels.join(', ')}.`)
      }
    }
    const text = input.response_text === undefined ? detection.response_text : input.response_text
    await scanDetectionsRepository.update(db, access.student.id, detectionId, {
      paper_question_id: slotId ?? null,
      response_text: slot && slot.optionLabels.length > 0 ? null : (text?.slice(0, 4000) ?? null),
      selected_option: slot && slot.optionLabels.length > 0 ? selectedOption : null,
      status: 'mapped',
      confirmed_at: new Date(),
      confirmed_by_user_id: access.user.id,
    })
  }
  await recomputeStatuses(db, access, slots)
}

/**
 * The last step: every reading settled -> written into the attempt as its answers (source 'ocr')
 * and the attempt is submitted exactly as a typed one would be. The server re-checks every rule
 * here; the screen hiding the button is not the gate (F053: "must be confirmed before scoring").
 */
export async function applyScan(db: Db, access: ScanAccess, input: { confirmBlanks: boolean }) {
  requireOpen(access)
  const slots = await loadSlots(db, access.attempt.paper_id)
  const pages = await scanPagesRepository.listForAttempt(db, access.student.id, access.attempt.id)
  if (pages.length === 0) throw new ScanError(400, 'no_pages', 'Add a photo of at least one page first.')
  if (pages.some((p) => p.extracted_at === null)) {
    throw new ScanError(409, 'unread_pages', 'Some pages have not been read yet.')
  }
  const detections = await recomputeStatuses(db, access, slots)
  const blockers = applyBlockers(detections.map((d) => ({ ...toState(d), status: d.status })), slots)
  const typed = await alreadyAnsweredPositions(db, access, slots)
  blockers.missingPositions = blockers.missingPositions.filter((p) => !typed.has(p))
  if (isBlocked(blockers)) {
    throw new ScanError(409, 'needs_review', 'Some answers still need checking before marking.', blockers)
  }
  if (blockers.missingPositions.length > 0 && !input.confirmBlanks) {
    throw new ScanError(
      409,
      'blank_answers',
      `No answer was found for ${blockers.missingPositions.length} question(s).`,
      { missing_positions: blockers.missingPositions },
    )
  }

  for (const d of detections) {
    if ((d.status !== 'mapped' && d.status !== 'confirmed') || !d.paper_question_id) continue
    await attemptAnswersRepository.upsert(db, {
      attempt_id: access.attempt.id,
      paper_question_id: d.paper_question_id,
      response_text: d.response_text,
      selected_option: d.selected_option,
      source: 'ocr',
      ocr_confidence: Number(d.confidence),
      image_ref: `scan_page:${d.scan_page_id}`,
    })
  }
  return submitAttempt(db, access.attempt, access.student)
}

/** Serving one page image: decrypted only after the caller has checked signature and access. */
export async function loadScanImage(db: Db, user: AuthedUser, pageId: string) {
  const page = await scanPagesRepository.findWithImage(db, pageId)
  if (!page?.image) return null
  if (user.role === 'student') {
    const student = await resolveEnabledStudent(db, user.id)
    if (student instanceof Response || student.id !== page.student_id) return null
  } else if (user.role === 'parent' || user.role === 'admin') {
    if ((await scanAccessRepository.studentHouseholdId(db, page.student_id)) !== user.householdId) {
      return null
    }
  } else {
    return null
  }
  return { mime: page.mime, bytes: decryptScan(page.image) }
}

/** F097 retention, run from the daily cron. Returns how many page images were deleted. */
export async function purgeExpiredScans(db: Db, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - SCAN_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return scanPagesRepository.purgeOlderThan(db, cutoff)
}

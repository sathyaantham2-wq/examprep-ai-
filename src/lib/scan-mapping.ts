// F052 (page-to-question mapping) + F053 (low-confidence confirm loop): the pure rules, with no
// database, so they can be tested exhaustively. src/lib/scans.ts does the I/O around them.

/** Below this, a reading must be confirmed by a person before it can be marked (F053). */
export const OCR_CONFIDENCE_THRESHOLD = 0.85

export interface ScanSlot {
  id: string
  position: number
  choiceGroup: string | null
  text: string
  /** Option labels printed for this question (MCQ-style); empty for written answers. */
  optionLabels: Array<string>
}

export interface ScanKeyEntry {
  /** What the model is told to answer with: "7", or "7A" / "7B" for the two halves of an OR pair. */
  key: string
  slotId: string
  position: number
  text: string
  optionLabels: Array<string>
}

/**
 * One key per answerable slot. An OR pair prints as a single number, so its two members get "A"
 * and "B" keys. The model tells them apart by what the student actually answered, not by print
 * order: the paper template's order within a pair isn't guaranteed stable.
 */
export function buildScanKey(slots: Array<ScanSlot>): Array<ScanKeyEntry> {
  const byPosition = new Map<number, Array<ScanSlot>>()
  for (const slot of slots) {
    const list = byPosition.get(slot.position) ?? []
    list.push(slot)
    byPosition.set(slot.position, list)
  }
  const entries: Array<ScanKeyEntry> = []
  for (const position of [...byPosition.keys()].sort((a, b) => a - b)) {
    const members = [...(byPosition.get(position) ?? [])].sort((a, b) =>
      a.id.localeCompare(b.id),
    )
    members.forEach((slot, i) => {
      entries.push({
        key: members.length > 1 ? `${position}${String.fromCharCode(65 + i)}` : `${position}`,
        slotId: slot.id,
        position,
        text: slot.text,
        optionLabels: slot.optionLabels,
      })
    })
  }
  return entries
}

/** "Q.7", "7)", " 7a " -> "7A". What the model or a student writes varies; keys don't. */
export function normalizeLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/^\s*Q(UESTION)?\s*[.:-]?\s*/, '')
    .replace(/[\s.():-]/g, '')
}

/** The slot a label names, or null if it names none or is ambiguous (a bare OR-pair number). */
export function resolveLabel(label: string, key: Array<ScanKeyEntry>): string | null {
  const wanted = normalizeLabel(label)
  if (wanted === '') return null
  return key.find((entry) => entry.key === wanted)?.slotId ?? null
}

export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PageReading {
  label: string
  text: string | null
  option: string | null
  confidence: number
  bbox: BBox | null
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function parseBBox(raw: unknown): BBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null
  const [x, y, w, h] = raw.map(Number)
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
  // The model reports 0-1000 (Gemini's native box scale); anything <= 1 is already a fraction.
  const scale = Math.max(x, y, w, h) > 1 ? 1000 : 1
  const box = { x: clamp01(x / scale), y: clamp01(y / scale), w: w / scale, h: h / scale }
  box.w = clamp01(Math.min(box.w, 1 - box.x))
  box.h = clamp01(Math.min(box.h, 1 - box.y))
  return box.w > 0 && box.h > 0 ? box : null
}

/**
 * The model's JSON for one page -> clean readings. Anything malformed is dropped rather than
 * guessed at; a page that parses to nothing just shows up as "no answers found" for review.
 */
export function parsePageReadings(raw: string | null): Array<PageReading> | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return null
  }
  const answers = (parsed as { answers?: unknown }).answers
  if (!Array.isArray(answers)) return null
  const readings: Array<PageReading> = []
  for (const item of answers as Array<Record<string, unknown>>) {
    const label = typeof item.question === 'string' ? item.question.trim() : ''
    if (label === '') continue
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, 4000) : ''
    const option = typeof item.option === 'string' ? item.option.trim().slice(0, 20) : ''
    if (text === '' && option === '') continue
    readings.push({
      label: label.slice(0, 20),
      text: text || null,
      option: option || null,
      confidence: typeof item.confidence === 'number' ? clamp01(item.confidence) : 0,
      bbox: parseBBox(item.box),
    })
  }
  return readings
}

/**
 * A chosen option is only trusted if it's one the question actually printed. Anything else is kept
 * for the reviewer to see, but its confidence drops to 0 so a person must confirm or fix it.
 */
export function checkOption(
  reading: Pick<PageReading, 'option' | 'confidence'>,
  optionLabels: Array<string>,
): { option: string | null; confidence: number } {
  if (optionLabels.length === 0) return { option: null, confidence: reading.confidence }
  const match = optionLabels.find(
    (l) => normalizeLabel(l) === normalizeLabel(reading.option ?? ''),
  )
  return match
    ? { option: match, confidence: reading.confidence }
    : { option: reading.option, confidence: 0 }
}

export type DetectionStatus = 'mapped' | 'unmapped' | 'duplicate' | 'confirmed' | 'discarded'

export interface DetectionState {
  id: string
  paperQuestionId: string | null
  confidence: number
  confirmed: boolean
  discarded: boolean
}

/**
 * Status of every detection across all pages of one attempt. Two live detections for the same
 * question are both "duplicate" -- and so are two for different halves of one OR pair, since only
 * one alternative can be marked. A person has to settle it (F052: "duplicate detections raised to
 * the parent").
 */
export function computeStatuses(
  detections: Array<DetectionState>,
  slots: Array<Pick<ScanSlot, 'id' | 'choiceGroup'>>,
): Map<string, DetectionStatus> {
  const groupOf = new Map(slots.map((s) => [s.id, s.choiceGroup ?? s.id]))
  const liveCount = new Map<string, number>()
  for (const d of detections) {
    if (d.discarded || !d.paperQuestionId) continue
    const group = groupOf.get(d.paperQuestionId)
    if (!group) continue
    liveCount.set(group, (liveCount.get(group) ?? 0) + 1)
  }
  const statuses = new Map<string, DetectionStatus>()
  for (const d of detections) {
    const group = d.paperQuestionId ? groupOf.get(d.paperQuestionId) : undefined
    if (d.discarded) statuses.set(d.id, 'discarded')
    else if (!group) statuses.set(d.id, 'unmapped')
    else if ((liveCount.get(group) ?? 0) > 1) statuses.set(d.id, 'duplicate')
    else statuses.set(d.id, d.confirmed ? 'confirmed' : 'mapped')
  }
  return statuses
}

export interface ApplyBlockers {
  unmapped: number
  duplicates: number
  /** Detections below the confidence threshold that nobody has confirmed yet. */
  unconfirmedLowConfidence: number
  /** Printed question numbers with no answer found on any page (blank, or a missing page). */
  missingPositions: Array<number>
}

export function applyBlockers(
  detections: Array<DetectionState & { status: DetectionStatus }>,
  slots: Array<Pick<ScanSlot, 'id' | 'position' | 'choiceGroup'>>,
  threshold: number = OCR_CONFIDENCE_THRESHOLD,
): ApplyBlockers {
  const answeredGroups = new Set<string>()
  const groupOf = new Map(slots.map((s) => [s.id, s.choiceGroup ?? s.id]))
  let unmapped = 0
  let duplicates = 0
  let unconfirmedLowConfidence = 0
  for (const d of detections) {
    if (d.status === 'unmapped') unmapped += 1
    else if (d.status === 'duplicate') duplicates += 1
    else if (d.status === 'mapped' || d.status === 'confirmed') {
      if (d.paperQuestionId) answeredGroups.add(groupOf.get(d.paperQuestionId) ?? '')
      if (!d.confirmed && d.confidence < threshold) unconfirmedLowConfidence += 1
    }
  }
  const missing = new Set<number>()
  for (const slot of slots) {
    if (!answeredGroups.has(slot.choiceGroup ?? slot.id)) missing.add(slot.position)
  }
  return {
    unmapped,
    duplicates,
    unconfirmedLowConfidence,
    missingPositions: [...missing].sort((a, b) => a - b),
  }
}

export function isBlocked(b: ApplyBlockers): boolean {
  return b.unmapped > 0 || b.duplicates > 0 || b.unconfirmedLowConfidence > 0
}

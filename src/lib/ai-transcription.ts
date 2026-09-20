import type { Db } from '../db/connection'
import { enforceAiCallBudget, logAiJob } from './ai-metering'
import { callWithModelFallback, modelForFeature } from './ai-models'
import { completeText, isAiConfigured } from './ai-provider'

// AI-06 (tab07): handwriting transcription by a vision model.
const MODEL = modelForFeature('AI-06')

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// About 3 MB of image once encoded, which stays under a serverless request-body limit.
export const MAX_IMAGE_BASE64_CHARS = 4_000_000

export interface TranscriptionResult {
  text: string
  confidence: number
}

/**
 * Reads a photo of one handwritten answer and returns the text for the student to check and
 * correct. Returns null when no AI is configured or nothing legible was found; throws when the
 * vendor call fails. The photo is sent to the AI and is not stored anywhere.
 */
export async function transcribeHandwriting(
  db: Db,
  input: {
    imageBase64: string
    mediaType: string
    questionText: string
    householdId: string
    studentId: string
  },
): Promise<TranscriptionResult | null> {
  if (!isAiConfigured()) return null
  await enforceAiCallBudget(db, {
    feature: 'AI-06',
    model: MODEL,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const prompt = `The image is a photo of a Class 7 student's handwritten answer to this exam question:

${input.questionText}

Transcribe exactly what the student wrote, in reading order. The handwriting may be English or Telugu script, or both: keep each part in the script it is written in. Write maths in plain text (use x for multiplication, / for fractions, ^ for powers, sqrt() for roots). Do NOT solve the question, correct mistakes, complete unfinished working or add anything the student did not write. Write [unclear] in place of any word you cannot read.

Respond with ONLY a JSON object, no other text, matching exactly:
{
  "legible": boolean,
  "text": "the transcription",
  "confidence": number from 0 to 1
}`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof completeText>>
  let modelUsed = MODEL
  try {
    const outcome = await callWithModelFallback(MODEL, (model) =>
      completeText({
        model,
        prompt,
        maxTokens: 1500,
        images: [{ mediaType: input.mediaType, base64: input.imageBase64 }],
      }),
    )
    response = outcome.result
    modelUsed = outcome.modelUsed
  } catch (err) {
    await logAiJob(db, {
      feature: 'AI-06',
      model: MODEL,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  await logAiJob(db, {
    feature: 'AI-06',
    model: modelUsed,
    householdId: input.householdId,
    studentId: input.studentId,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    latencyMs: Date.now() - startedAt,
    status: 'success',
  })

  if (!response.text) return null
  try {
    const parsed = JSON.parse(response.text) as { legible?: boolean; text?: string; confidence?: number }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (parsed.legible === false || text === '') return null
    return {
      text: text.slice(0, 4000),
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
    }
  } catch {
    return null
  }
}

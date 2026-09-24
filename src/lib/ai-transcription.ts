import type { Db } from '../db/connection'
import { enforceAiCallBudget, logAiJob } from './ai-metering'
import { ModelCallError, callWithProviderChain } from './ai-models'
import { completeText, isAiConfigured } from './ai-provider'

// AI-06 (tab07): handwriting transcription by a vision model.
//
// 2026-09-24: this now goes through the same cross-vendor chain every other AI-*.ts feature does
// (see ai-models.ts's callWithProviderChain), but vision is the one case where that's a real risk
// the others aren't: Groq/Cerebras's default models here (llama-3.3-70b-versatile, gpt-oss-120b)
// are text-only. If the chain reaches one of them for this feature, the photo is silently ignored
// rather than read -- the model just answers from the prompt text alone, which asks it to
// transcribe an image it was never actually given, and it will most likely say so (legible:
// false) rather than hallucinate a transcription, but this hasn't been exercised against a real
// text-only model's actual behaviour. If handwriting transcription sees real use, either pin
// GROQ_MODEL_STRONG / CEREBRAS_MODEL_STRONG to a vision-capable model for those vendors, or -- more
// robustly -- give AI-06 its own chain that only includes vendors/models known to support images
// (Anthropic and Gemini both do today).
const FEATURE = 'AI-06'

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const
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
    feature: FEATURE,
    model: FEATURE,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const prompt = `The image is a photo of a school student's handwritten answer to this exam question:

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
  let modelUsed = FEATURE
  try {
    const outcome = await callWithProviderChain(FEATURE, (provider, model) =>
      completeText(
        {
          model,
          prompt,
          maxTokens: 1500,
          images: [{ mediaType: input.mediaType, base64: input.imageBase64 }],
        },
        provider,
      ),
    )
    response = outcome.result
    modelUsed = outcome.label
  } catch (err) {
    await logAiJob(db, {
      feature: FEATURE,
      model: err instanceof ModelCallError ? err.label : FEATURE,
      householdId: input.householdId,
      studentId: input.studentId,
      latencyMs: Date.now() - startedAt,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
  await logAiJob(db, {
    feature: FEATURE,
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
    const parsed = JSON.parse(response.text) as {
      legible?: boolean
      text?: string
      confidence?: number
    }
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (parsed.legible === false || text === '') return null
    return {
      text: text.slice(0, 4000),
      confidence:
        typeof parsed.confidence === 'number'
          ? Math.min(1, Math.max(0, parsed.confidence))
          : 0,
    }
  } catch {
    return null
  }
}

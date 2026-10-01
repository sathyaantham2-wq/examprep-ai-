import type { Db } from '../db/connection'
import { enforceAiCallBudget, logAiJob } from './ai-metering'
import { ModelCallError, VISION_PROVIDERS, callWithProviderChain } from './ai-models'
import { completeText, isAiConfigured } from './ai-provider'

// AI-06 (tab07): handwriting transcription by a vision model.
//
// Vision only: the provider chain is restricted to VISION_PROVIDERS (ai-models.ts), because a
// text-only model given a photo just answers from the prompt text and never reads the handwriting.
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
      undefined,
      { only: VISION_PROVIDERS },
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

/**
 * F051 (AI-06 on a whole page): reads every answer on one photographed page of a written paper.
 * Returns the model's raw JSON text for src/lib/scan-mapping.ts's parsePageReadings to validate,
 * or null when no vision-capable AI is configured. Throws when every vendor call fails. The key
 * lists each printed question number (OR pairs as "7A"/"7B") so the model can say which question
 * an answer belongs to. It never receives the answer key, a name or an email address.
 */
export async function transcribePage(
  db: Db,
  input: {
    imageBase64: string
    mediaType: string
    key: Array<{ key: string; text: string; optionLabels: Array<string> }>
    householdId: string
    studentId: string
  },
): Promise<string | null> {
  if (!isAiConfigured()) return null
  await enforceAiCallBudget(db, {
    feature: FEATURE,
    model: FEATURE,
    householdId: input.householdId,
    studentId: input.studentId,
  })

  const questionList = input.key
    .map((q) => {
      const options = q.optionLabels.length > 0 ? ` [choose one of: ${q.optionLabels.join(', ')}]` : ''
      return `${q.key}: ${q.text.replace(/\s+/g, ' ').slice(0, 160)}${options}`
    })
    .join('\n')

  const prompt = `The image is one photographed page of a school student's handwritten answer sheet for an exam. These are the exam's questions, each with the key you must use for it:

${questionList}

Find every answer on this page and say which question it answers. Rules:
- "question" is the key from the list above. The student usually writes the number before each answer. Where two keys share a number (like 7A and 7B, an either/or choice), decide which one the answer is for from what it is about. If you cannot tell, give just the number ("7").
- If you cannot read the number at all, use "?".
- For a question with options, put the option the student chose in "option" (exactly as listed) and leave "text" empty.
- Otherwise, put exactly what the student wrote in "text", in reading order. The handwriting may be English or Telugu script, or both: keep each part in the script it is written in, never romanise Telugu. Write maths in plain text (x for multiplication, / for fractions, ^ for powers, sqrt() for roots).
- Do NOT solve anything, correct mistakes, complete unfinished working or add anything the student did not write. Write [unclear] in place of any word you cannot read.
- Ignore rough work, crossed-out work and the printed question text itself.
- "confidence" (0 to 1) is how sure you are of BOTH the question number and the transcription.
- "box" is where the answer is on the page: [left, top, width, height] as fractions of the page width and height.

Respond with ONLY a JSON object, no other text:
{"answers": [{"question": "3", "text": "...", "option": "", "confidence": 0.9, "box": [0.1, 0.2, 0.8, 0.15]}]}
If there are no answers on the page, respond {"answers": []}.`

  const startedAt = Date.now()
  let response: Awaited<ReturnType<typeof completeText>>
  let modelUsed = FEATURE
  try {
    const outcome = await callWithProviderChain(
      FEATURE,
      (provider, model) =>
        completeText(
          {
            model,
            prompt,
            maxTokens: 6000,
            images: [{ mediaType: input.mediaType, base64: input.imageBase64 }],
          },
          provider,
        ),
      undefined,
      { only: VISION_PROVIDERS },
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
  return response.text
}

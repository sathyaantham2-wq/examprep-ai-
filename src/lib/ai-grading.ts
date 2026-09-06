import Anthropic from '@anthropic-ai/sdk'
import type { ErrorType } from '../db/enums'

const ERROR_TYPES = [
  'Conceptual Gap',
  'Calculation Error',
  'Presentation Issue',
  'Formula/Definition Error',
  'Incomplete',
  'Not Attempted',
] as const

// AI-05 in tab07: "Strong model" tier, same class used for question generation (AI-01).
const MODEL = 'claude-sonnet-5'

let cachedClient: Anthropic | null = null
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  cachedClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return cachedClient
}

export function isAiGradingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export interface SubjectiveGradingInput {
  questionText: string
  expectedAnswer: string
  marksMax: number
  stepMarks: Array<{ step_no: number; description: string; marks: number }>
  studentResponse: string
  conceptContext?: string
}

export interface SubjectiveGradingResult {
  stepMarksAwarded: Array<{
    step_no: number
    marks_awarded: number
    justification: string
  }>
  totalMarks: number
  errorType: ErrorType | null
  feedback: string
  confidence: number
  needsManualMarking: boolean
}

const NEEDS_MANUAL_MARKING: SubjectiveGradingResult = {
  stepMarksAwarded: [],
  totalMarks: 0,
  errorType: null,
  feedback: 'Needs manual marking.',
  confidence: 0,
  needsManualMarking: true,
}

/**
 * AI-05 (tab07): proposes marks per step with justification against the stored marking scheme.
 * Never final — the caller writes this to evaluation_items.ai_marks/ai_error_type, never directly
 * to marks_awarded/error_type, so a human must confirm before it counts (CLAUDE.md hard rule).
 * Returns null if no ANTHROPIC_API_KEY is configured — the caller falls back to "needs manual
 * marking" (this module's documented fallback per tab07), not a guess.
 */
export async function gradeSubjectiveAnswer(
  input: SubjectiveGradingInput,
): Promise<SubjectiveGradingResult | null> {
  const client = getClient()
  if (!client) return null

  const prompt = `You are grading one student's exam answer against a marking scheme. Only use what the response actually shows — never infer understanding it doesn't demonstrate. If the response is blank or genuinely illegible/unparseable, set "unreadable": true instead of guessing marks.

Question: ${input.questionText}
Expected answer: ${input.expectedAnswer}
Total marks available: ${input.marksMax}
Marking scheme:
${input.stepMarks.map((s) => `  Step ${s.step_no} (${s.marks} mark${s.marks === 1 ? '' : 's'}): ${s.description}`).join('\n')}
${input.conceptContext ? `Concept context: ${input.conceptContext}\n` : ''}
Student's response:
"""
${input.studentResponse}
"""

Respond with ONLY a JSON object, no other text, matching exactly:
{
  "unreadable": boolean,
  "steps": [{"step_no": number, "marks_awarded": number, "justification": "short reason citing the marking scheme step"}],
  "error_type": one of ${JSON.stringify(ERROR_TYPES)}, or null if full marks were awarded,
  "feedback": "one actionable sentence, max 25 words, naming the concept and the specific fix — no praise, no scolding",
  "confidence": number from 0 to 1
}`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  })

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock) return NEEDS_MANUAL_MARKING

  let parsed: unknown
  try {
    parsed = JSON.parse(textBlock.text)
  } catch {
    return NEEDS_MANUAL_MARKING
  }

  const result = parsed as {
    unreadable?: boolean
    steps?: Array<{
      step_no: number
      marks_awarded: number
      justification: string
    }>
    error_type?: ErrorType | null
    feedback?: string
    confidence?: number
  }

  if (result.unreadable) return NEEDS_MANUAL_MARKING

  const steps = result.steps ?? []
  const totalMarks = steps.reduce((sum, step) => sum + step.marks_awarded, 0)

  return {
    stepMarksAwarded: steps,
    totalMarks,
    errorType: result.error_type ?? null,
    feedback: result.feedback ?? '',
    confidence: result.confidence ?? 0,
    needsManualMarking: false,
  }
}

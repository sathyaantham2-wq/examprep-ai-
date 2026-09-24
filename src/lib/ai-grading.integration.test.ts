import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { householdsRepository, studentsRepository } from '../db/repositories'
import {
  MIN_GRADING_CONFIDENCE,
  gradeSubjectiveAnswer,
  reviewDisputedAnswer,
} from './ai-grading'
import { completeText } from './ai-provider'

// The vendor call is replaced; everything else (budget check, job logging, the provider chain's
// own retry-on-failure loop) is real. resolveProviderChain is stubbed to a single fixed vendor --
// the real function reads real env vars, which this test environment has no AI keys in, and
// callWithProviderChain (src/lib/ai-models.ts) would otherwise throw "no AI provider is
// configured" before ever reaching the mocked completeText below.
vi.mock('./ai-provider', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./ai-provider')),
  isAiConfigured: () => true,
  resolveProviderChain: () => ['anthropic'],
  completeText: vi.fn(),
}))

const stepMarks = [
  { step_no: 1, description: 'Sets up the working', marks: 1 },
  { step_no: 2, description: 'Reaches the answer', marks: 2 },
]

function reply(body: unknown, tokensIn = 100, tokensOut = 50) {
  vi.mocked(completeText).mockResolvedValue({
    text: JSON.stringify(body),
    tokensIn,
    tokensOut,
  })
}

/**
 * The grader's marks can be confirmed automatically on adaptive papers, so it must refuse to
 * propose marks it should not: low confidence, unreadable answers, vendor errors, and arithmetic
 * that breaks the marking scheme all end as "needs manual marking" (or are corrected).
 */
describe('gradeSubjectiveAnswer safeguards', () => {
  let db: Db
  let householdId: string
  let studentId: string

  const input = () => ({
    questionText: 'q',
    expectedAnswer: 'a',
    marksMax: 3,
    stepMarks,
    studentResponse: 'a worked answer',
    householdId,
    studentId,
  })

  beforeAll(async () => {
    db = createDb()
    const household = await householdsRepository.insert(db, {
      name: 'AI grading fixture household',
      plan: 'free',
    })
    householdId = household.id
    const student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'AI grading fixture kid',
      class: 7,
      board: 'CBSE',
      target_exams: JSON.stringify([]),
    })
    studentId = student.id
  })

  beforeEach(() => {
    vi.mocked(completeText).mockReset()
  })

  afterAll(async () => {
    await db
      .deleteFrom('ai_jobs')
      .where('household_id', '=', householdId)
      .execute()
    await db.deleteFrom('households').where('id', '=', householdId).execute()
    await db.destroy()
  })

  it('returns the AI marks when it is confident', async () => {
    reply({
      unreadable: false,
      steps: [
        { step_no: 1, marks_awarded: 1, justification: 'ok' },
        { step_no: 2, marks_awarded: 1, justification: 'partly' },
      ],
      error_type: 'Incomplete',
      feedback: 'Finish the working.',
      confidence: 0.9,
    })
    const result = await gradeSubjectiveAnswer(db, input())
    expect(result?.needsManualMarking).toBe(false)
    expect(result?.totalMarks).toBe(2)
  })

  it('sends a low-confidence grade to a person', async () => {
    reply({
      unreadable: false,
      steps: [{ step_no: 1, marks_awarded: 1, justification: 'maybe' }],
      error_type: null,
      feedback: '',
      confidence: MIN_GRADING_CONFIDENCE - 0.01,
    })
    expect((await gradeSubjectiveAnswer(db, input()))?.needsManualMarking).toBe(
      true,
    )
  })

  it('sends a missing confidence, an unreadable answer and non-JSON output to a person', async () => {
    reply({ steps: [{ step_no: 1, marks_awarded: 1, justification: 'x' }] })
    expect((await gradeSubjectiveAnswer(db, input()))?.needsManualMarking).toBe(
      true,
    )
    reply({ unreadable: true, confidence: 1 })
    expect((await gradeSubjectiveAnswer(db, input()))?.needsManualMarking).toBe(
      true,
    )
    vi.mocked(completeText).mockResolvedValue({
      text: 'not json',
      tokensIn: 1,
      tokensOut: 1,
    })
    expect((await gradeSubjectiveAnswer(db, input()))?.needsManualMarking).toBe(
      true,
    )
    vi.mocked(completeText).mockResolvedValue({
      text: null,
      tokensIn: 1,
      tokensOut: 0,
    })
    expect((await gradeSubjectiveAnswer(db, input()))?.needsManualMarking).toBe(
      true,
    )
  })

  it('sends a vendor error such as a rate limit to a person instead of failing marking', async () => {
    vi.mocked(completeText).mockRejectedValue(
      new Error('Gemini API 429: quota'),
    )
    const result = await gradeSubjectiveAnswer(db, input())
    expect(result?.needsManualMarking).toBe(true)
    const jobs = await db
      .selectFrom('ai_jobs')
      .select('status')
      .where('household_id', '=', householdId)
      .execute()
    expect(jobs.some((j) => j.status === 'error')).toBe(true)
  })

  it('never lets the model exceed the marking scheme or the question total', async () => {
    reply({
      unreadable: false,
      steps: [
        { step_no: 1, marks_awarded: 5, justification: 'too generous' },
        { step_no: 2, marks_awarded: 9, justification: 'too generous' },
        { step_no: 3, marks_awarded: -2, justification: 'negative' },
      ],
      error_type: null,
      feedback: '',
      confidence: 1,
    })
    const result = await gradeSubjectiveAnswer(db, input())
    expect(result?.stepMarksAwarded.map((s) => s.marks_awarded)).toEqual([
      1, 2, 0,
    ])
    expect(result?.totalMarks).toBe(3)
  })

  it('needs manual marking when the model gives no step marks at all', async () => {
    reply({
      unreadable: false,
      steps: [],
      error_type: null,
      feedback: '',
      confidence: 1,
    })
    expect((await gradeSubjectiveAnswer(db, input()))?.needsManualMarking).toBe(
      true,
    )
  })

  it('asks the model to be generous when it first marks an answer', async () => {
    reply({
      unreadable: false,
      steps: [{ step_no: 1, marks_awarded: 1, justification: 'x' }],
      error_type: null,
      feedback: '',
      confidence: 1,
    })
    await gradeSubjectiveAnswer(db, input())
    const sent = vi.mocked(completeText).mock.calls[0][0].prompt
    expect(sent).toMatch(/GENEROUS/)
    expect(sent).toMatch(/valid alternative/i)
  })

  describe('reviewDisputedAnswer (the student questions a mark)', () => {
    const dispute = () => ({
      questionText: 'q',
      expectedAnswer: 'PRIVATE-ANSWER',
      marksMax: 3,
      stepMarks,
      studentResponse: 'a worked answer',
      previousMarks: 1,
      previousFeedback: 'Show the last step.',
      studentComment: 'I did show it in the second line',
      householdId,
      studentId,
    })

    it('raises the mark when the model agrees, and tells the model not to reveal the answer', async () => {
      reply({
        steps: [
          { step_no: 1, marks_awarded: 1, justification: 'ok' },
          {
            step_no: 2,
            marks_awarded: 2,
            justification: 'the student was right',
          },
        ],
        reply: 'You are right. I have raised your mark.',
      })
      const result = await reviewDisputedAnswer(db, dispute())
      expect(result).toMatchObject({
        changed: true,
        totalMarks: 3,
        reply: 'You are right. I have raised your mark.',
      })
      const sent = vi.mocked(completeText).mock.calls[0][0].prompt
      expect(sent).toMatch(/GENEROUS/)
      expect(sent).toMatch(/NEVER reveal the correct answer/)
      expect(sent).toContain('I did show it in the second line')
    })

    it('never lowers a mark because the student asked', async () => {
      reply({
        steps: [{ step_no: 1, marks_awarded: 0, justification: 'harsher' }],
        reply: 'Looking again, I would give less.',
      })
      const result = await reviewDisputedAnswer(db, dispute())
      expect(result).toMatchObject({ changed: false, totalMarks: 1 })
    })

    it('caps a raised mark at the scheme', async () => {
      reply({
        steps: [
          { step_no: 1, marks_awarded: 9, justification: 'x' },
          { step_no: 2, marks_awarded: 9, justification: 'x' },
        ],
        reply: 'Raised.',
      })
      expect((await reviewDisputedAnswer(db, dispute()))?.totalMarks).toBe(3)
    })

    it('throws on an unusable reply so the student can try again', async () => {
      vi.mocked(completeText).mockResolvedValue({
        text: 'not json',
        tokensIn: 1,
        tokensOut: 1,
      })
      await expect(reviewDisputedAnswer(db, dispute())).rejects.toThrow(
        /could not be read/,
      )
      reply({ steps: [], reply: '' })
      await expect(reviewDisputedAnswer(db, dispute())).rejects.toThrow(
        /could not be read/,
      )
    })

    it('throws when the vendor call fails', async () => {
      vi.mocked(completeText).mockRejectedValue(new Error('Gemini API 429'))
      await expect(reviewDisputedAnswer(db, dispute())).rejects.toThrow(/429/)
    })
  })
})

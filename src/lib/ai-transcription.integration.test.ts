import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { householdsRepository, studentsRepository } from '../db/repositories'
import { transcribeHandwriting } from './ai-transcription'
import { completeText } from './ai-provider'

vi.mock('./ai-provider', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('./ai-provider')),
  isAiConfigured: () => true,
  completeText: vi.fn(),
}))

describe('transcribeHandwriting (AI-06)', () => {
  let db: Db
  let householdId: string
  let studentId: string
  const input = () => ({
    imageBase64: 'QUJD'.repeat(40),
    mediaType: 'image/jpeg',
    questionText: 'Find 2 + 3',
    householdId,
    studentId,
  })

  beforeAll(async () => {
    db = createDb()
    const household = await householdsRepository.insert(db, { name: 'AI transcription fixture household', plan: 'free' })
    householdId = household.id
    const student = await studentsRepository.insert(db, {
      household_id: household.id,
      name: 'AI transcription fixture kid',
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
    await db.deleteFrom('ai_jobs').where('household_id', '=', householdId).execute()
    await db.deleteFrom('households').where('id', '=', householdId).execute()
    await db.destroy()
  })

  it('sends the photo to the model and returns the text and confidence', async () => {
    vi.mocked(completeText).mockResolvedValue({
      text: JSON.stringify({ legible: true, text: '2 + 3 = 5', confidence: 0.8 }),
      tokensIn: 300,
      tokensOut: 20,
    })
    const result = await transcribeHandwriting(db, input())
    expect(result).toEqual({ text: '2 + 3 = 5', confidence: 0.8 })
    const call = vi.mocked(completeText).mock.calls[0][0]
    expect(call.images).toEqual([{ mediaType: 'image/jpeg', base64: 'QUJD'.repeat(40) }])
    expect(call.prompt).toMatch(/Telugu/)
    expect(call.prompt).toMatch(/Do NOT solve/)
    const jobs = await db.selectFrom('ai_jobs').select('feature').where('household_id', '=', householdId).execute()
    expect(jobs.map((j) => j.feature)).toContain('AI-06')
  })

  it('returns null for an illegible or empty photo and for output that is not JSON', async () => {
    vi.mocked(completeText).mockResolvedValue({
      text: JSON.stringify({ legible: false, text: '', confidence: 0.1 }),
      tokensIn: 1,
      tokensOut: 1,
    })
    expect(await transcribeHandwriting(db, input())).toBeNull()
    vi.mocked(completeText).mockResolvedValue({ text: 'sorry', tokensIn: 1, tokensOut: 1 })
    expect(await transcribeHandwriting(db, input())).toBeNull()
    vi.mocked(completeText).mockResolvedValue({ text: null, tokensIn: 1, tokensOut: 0 })
    expect(await transcribeHandwriting(db, input())).toBeNull()
  })

  it('throws when the vendor call fails', async () => {
    vi.mocked(completeText).mockRejectedValue(new Error('Gemini API 500'))
    await expect(transcribeHandwriting(db, input())).rejects.toThrow(/500/)
  })
})

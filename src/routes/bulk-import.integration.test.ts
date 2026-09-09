import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { conceptsRepository } from '../db/repositories'
import { createParentSession, promoteToAdmin } from '../db/test-helpers'
import type { TestSession } from '../db/test-helpers'
import { Route as BulkImportRoute } from './api/questions/bulk-import'

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

function handlerFor(
  route: { options: { server?: unknown } },
  method: string,
): RouteHandler {
  const handlers = (
    route.options.server as { handlers: Record<string, RouteHandler> }
  ).handlers
  return handlers[method]
}

function fileRequest(cookie: string, file: File, format?: string): Request {
  const formData = new FormData()
  formData.set('file', file)
  if (format) formData.set('format', format)
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: { cookie },
    body: formData,
  })
}

/**
 * F022: "CSV/JSON import with row-level validation report; partial import allowed; rejected rows
 * downloadable with reasons." Each CSV/JSON fixture below deliberately mixes one valid row with
 * one invalid row, so "partial import" is proven, not assumed.
 */
describe('bulk question import (F022)', () => {
  let db: Db
  let admin: TestSession
  let parent: TestSession
  let conceptId: string

  beforeAll(async () => {
    db = createDb()
    admin = await createParentSession('bulk-admin')
    await promoteToAdmin(admin.userId)
    parent = await createParentSession('bulk-parent')

    const subject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('code', '=', 'MATH-SEED')
      .executeTakeFirstOrThrow()
    const chapter = await db
      .selectFrom('chapters')
      .selectAll()
      .where('subject_id', '=', subject.id)
      .where('chapter_no', '=', 1)
      .executeTakeFirstOrThrow()

    const concept = await conceptsRepository.insert(db, {
      chapter_id: chapter.id,
      board: 'CBSE',
      class: 7,
      code: `C7M-1.BULK-${Date.now()}`,
      name: 'Bulk import fixture concept',
      difficulty_base: 'Easy',
    })
    conceptId = concept.id
  })

  afterAll(async () => {
    await db
      .deleteFrom('questions')
      .where('concept_id', '=', conceptId)
      .execute()
    await db.deleteFrom('concepts').where('id', '=', conceptId).execute()
    await db
      .deleteFrom('households')
      .where('id', 'in', [admin.householdId, parent.householdId])
      .execute()
    await db.destroy()
  })

  it('requires admin -- a parent session is rejected', async () => {
    const file = new File(['concept_id,board\n'], 'q.csv', { type: 'text/csv' })
    const response = await handlerFor(
      BulkImportRoute,
      'POST',
    )({
      request: fileRequest(parent.cookie, file),
    })
    expect(response.status).toBe(403)
  })

  it('imports the valid CSV row and reports the invalid one with reasons', async () => {
    const csv = [
      'concept_id,board,class,bloom,difficulty,marks,type,text,answer,option_a_text,option_a_correct,option_b_text,option_b_correct',
      `${conceptId},CBSE,7,Remember,Easy,1,mcq,"What is 1+1?",2,2,true,3,false`,
      `${conceptId},CBSE,7,Remember,Easy,1,mcq,"Missing an answer",,2,true,3,false`,
    ].join('\n')
    const file = new File([csv], 'questions.csv', { type: 'text/csv' })

    const response = await handlerFor(
      BulkImportRoute,
      'POST',
    )({
      request: fileRequest(admin.cookie, file),
    })
    expect(response.status).toBe(201)
    const result = await response.json()

    expect(result.imported_count).toBe(1)
    expect(result.rejected_count).toBe(1)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({ row: 1, status: 'imported' })
    expect(result.rows[1].status).toBe('rejected')
    expect(result.rows[1].errors[0]).toContain('answer')

    const imported = await db
      .selectFrom('questions')
      .selectAll()
      .where('id', '=', result.rows[0].question_id)
      .executeTakeFirstOrThrow()
    expect(imported.text).toBe('What is 1+1?')
    expect(imported.status).toBe('approved') // Tier A: mcq, 1 mark, English, no diagram
  })

  it('imports from JSON with the same row-level reporting', async () => {
    const payload = [
      {
        concept_id: conceptId,
        board: 'CBSE',
        class: 7,
        bloom: 'Understand',
        difficulty: 'Easy',
        marks: 1,
        type: 'fill_blank',
        text: 'The capital of India is ____.',
        answer: 'New Delhi',
      },
      {
        concept_id: 'not-a-uuid',
        board: 'CBSE',
        class: 7,
        bloom: 'Understand',
        difficulty: 'Easy',
        marks: 1,
        type: 'fill_blank',
        text: 'Bad concept id',
        answer: 'x',
      },
    ]
    const file = new File([JSON.stringify(payload)], 'questions.json', {
      type: 'application/json',
    })

    const response = await handlerFor(
      BulkImportRoute,
      'POST',
    )({
      request: fileRequest(admin.cookie, file),
    })
    expect(response.status).toBe(201)
    const result = await response.json()
    expect(result.imported_count).toBe(1)
    expect(result.rejected_count).toBe(1)
  })
})

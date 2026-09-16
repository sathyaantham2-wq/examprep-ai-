import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../db/connection'
import type { Db } from '../db/connection'
import { describeError, withErrorCapture, wrapRouteHandlers } from './error-log'

describe('describeError (F004)', () => {
  it('extracts message and stack from a real Error', () => {
    const err = new Error('boom')
    const described = describeError(err)
    expect(described.message).toBe('boom')
    expect(described.stack).toContain('boom')
  })

  it('stringifies a non-Error throw with no stack', () => {
    const described = describeError('a plain string throw')
    expect(described.message).toBe('a plain string throw')
    expect(described.stack).toBeNull()
  })
})

/**
 * F004: "capturing ... server errors ... request-scoped log IDs." Real DB, a handler that
 * deliberately throws -- proves withErrorCapture never lets the exception escape, always writes
 * one error_log row, and always echoes the same request id back in both the response header and
 * body so a report ("I got an error") is actually traceable to a row.
 */
describe('withErrorCapture (F004)', () => {
  let db: Db

  beforeAll(() => {
    db = createDb()
  })

  afterAll(async () => {
    await db.deleteFrom('error_log').where('route', '=', 'GET /test/throwing-route').execute()
    await db.destroy()
  })

  it('catches a thrown error, logs it, and returns a 500 with a request id', async () => {
    const throwingHandler = async () => {
      throw new Error('deliberate test failure')
    }
    const wrapped = withErrorCapture('GET /test/throwing-route', throwingHandler)

    const response = await wrapped({ request: new Request('http://localhost/test') })
    expect(response.status).toBe(500)
    const requestIdHeader = response.headers.get('x-request-id')
    expect(requestIdHeader).toBeTruthy()

    const body = await response.json()
    expect(body.request_id).toBe(requestIdHeader)

    const row = await db
      .selectFrom('error_log')
      .selectAll()
      .where('request_id', '=', requestIdHeader!)
      .executeTakeFirstOrThrow()
    expect(row.message).toBe('deliberate test failure')
    expect(row.source).toBe('server')
    expect(row.route).toBe('GET /test/throwing-route')
  })

  it('passes a successful response through unchanged, still stamped with a request id', async () => {
    const okHandler = async () => Response.json({ ok: true })
    const wrapped = withErrorCapture('GET /test/throwing-route', okHandler)

    const response = await wrapped({ request: new Request('http://localhost/test') })
    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(await response.json()).toEqual({ ok: true })
  })
})

describe('wrapRouteHandlers (F004)', () => {
  it('replaces only the named methods, leaving others (and a route with no server block) alone', () => {
    const original = async () => new Response(null)
    const route = {
      options: {
        server: { handlers: { GET: original, POST: original } },
      },
    }
    wrapRouteHandlers(route, '/test/route', ['GET'])
    expect(route.options.server.handlers.GET).not.toBe(original)
    expect(route.options.server.handlers.POST).toBe(original)

    // A route with no server block (e.g. a pure UI route) must not throw.
    expect(() => wrapRouteHandlers({ options: {} }, '/test/ui-route', ['GET'])).not.toThrow()
  })
})

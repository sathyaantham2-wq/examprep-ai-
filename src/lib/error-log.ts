import { randomUUID } from 'node:crypto'
import { getSharedDb } from '../db/connection'
import { getCurrentUser } from './session'
import { env } from './env'

/**
 * F004: "Sentry (or equivalent) capturing ... errors with release tagging." No error-tracking
 * account exists for this app -- this is the self-hosted equivalent, the same "own the data,
 * skip the external account" choice F091/F093 already made for AI cost and product-events
 * tracking. Never throws: capturing an error must never itself become an unhandled error.
 */
export async function captureError(input: {
  requestId: string
  source: 'server' | 'client'
  route: string
  method?: string | null
  statusCode?: number | null
  message: string
  stack?: string | null
  userId?: string | null
  householdId?: string | null
}): Promise<void> {
  try {
    const db = getSharedDb()
    await db
      .insertInto('error_log')
      .values({
        request_id: input.requestId,
        source: input.source,
        route: input.route,
        method: input.method ?? null,
        status_code: input.statusCode ?? null,
        message: input.message,
        stack: input.stack ?? null,
        release: env.VERCEL_GIT_COMMIT_SHA ?? null,
        user_id: input.userId ?? null,
        household_id: input.householdId ?? null,
      })
      .execute()
  } catch (err) {
    console.error('captureError: failed to write error_log row', err)
  }
}

// Shared by withErrorCapture (server) and /api/errors (client) so both extract message/stack
// from an `unknown` the exact same way.
export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? null }
  return { message: String(error), stack: null }
}

type RouteHandler = (opts: {
  request: Request
  params?: Record<string, string>
}) => Promise<Response>

/**
 * F004: "request-scoped log IDs." Wraps a route handler so every unhandled exception is captured
 * with a fresh request id (also echoed back as the `x-request-id` response header and in the 500
 * body, so a parent reporting "I got an error" can hand over an id that's actually findable in
 * error_log) instead of surfacing as a bare, unlogged 500. Deliberately does NOT wrap the
 * try/catch/business logic already inside each handler -- those already return their own typed
 * 4xx responses for expected failures; this only catches what nothing else does.
 */
export function withErrorCapture(routeLabel: string, handler: RouteHandler): RouteHandler {
  return async (opts) => {
    const requestId = randomUUID()
    try {
      const response = await handler(opts)
      response.headers.set('x-request-id', requestId)
      return response
    } catch (err) {
      const user = await getCurrentUser(opts.request).catch(() => null)
      const { message, stack } = describeError(err)
      await captureError({
        requestId,
        source: 'server',
        route: routeLabel,
        method: opts.request.method,
        statusCode: 500,
        message,
        stack,
        userId: user?.id,
        householdId: user?.householdId,
      })
      return Response.json(
        { error: 'Internal server error', request_id: requestId },
        { status: 500, headers: { 'x-request-id': requestId } },
      )
    }
  }
}

// TanStack Start's own generated type for `Route.options.server.handlers` is a deep conditional
// (`Constrain<...>`) that TypeScript can't narrow to a plain method->handler record without a
// cast -- the exact same problem every *.integration.test.ts file in this repo already solves by
// casting `route.options.server` to this same narrow shape to look up a handler by method name.
// Centralised here as one helper (one cast, one place to fix if that generated type ever changes)
// instead of repeating the cast at the bottom of all ~65 route files.
interface HandlerBearingRoute {
  options: { server?: unknown }
}

/**
 * F004: called once at the bottom of every route file: `wrapRouteHandlers(Route, '/api/x',
 * ['GET', 'POST'])`. Mutates the already-built Route object in place -- TanStack Start reads
 * `Route.options.server.handlers` lazily per-request, not at module-definition time, so replacing
 * an entry here before the server ever starts handling requests is equivalent to having wrapped
 * it inline in the first place.
 */
export function wrapRouteHandlers(
  route: HandlerBearingRoute,
  routePath: string,
  methods: Array<string>,
): void {
  const server = route.options.server as
    | { handlers: Partial<Record<string, RouteHandler>> }
    | undefined
  if (!server) return
  for (const method of methods) {
    const original = server.handlers[method]
    if (!original) continue
    server.handlers[method] = withErrorCapture(`${method} ${routePath}`, original)
  }
}

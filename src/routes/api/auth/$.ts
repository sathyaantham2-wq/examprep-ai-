import { createFileRoute } from '@tanstack/react-router'
import { auth } from '../../../lib/auth'

// Catches every better-auth route: sign-up, sign-in, sign-out, session, Google OAuth callback,
// email verification, etc. better-auth's own internal router dispatches on the request path, so
// nothing else needs to be wired up here.
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => auth.handler(request),
      POST: async ({ request }: { request: Request }) => auth.handler(request),
    },
  },
})

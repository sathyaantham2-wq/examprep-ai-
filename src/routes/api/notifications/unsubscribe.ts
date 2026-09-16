import { createFileRoute } from '@tanstack/react-router'
import { getSharedDb } from '../../../db/connection'
import { verifyUnsubscribeToken } from '../../../lib/email'
import { wrapRouteHandlers } from '../../../lib/error-log'

// F080: "unsubscribe honoured." Deliberately a plain GET with no auth check beyond the signed
// token -- this link is meant to work from inside an email client with no active session, and
// the HMAC signature is what proves the request actually came from a link this app sent to this
// exact user (see unsubscribeToken in src/lib/email.ts).
export const Route = createFileRoute('/api/notifications/unsubscribe')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const userId = url.searchParams.get('user_id')
        const token = url.searchParams.get('token')
        if (!userId || !token || !verifyUnsubscribeToken(userId, token)) {
          return new Response('Invalid or expired unsubscribe link.', { status: 400 })
        }

        const db = getSharedDb()
        const updated = await db
          .updateTable('users')
          .set({ email_notifications_enabled: false })
          .where('id', '=', userId)
          .returning('id')
          .executeTakeFirst()
        if (!updated) return new Response(null, { status: 404 })

        return new Response(
          "You've been unsubscribed from ExamPrep AI email notifications.",
          { headers: { 'content-type': 'text/plain' } },
        )
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/notifications/unsubscribe', ['GET'])

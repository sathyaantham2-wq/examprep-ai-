import { createFileRoute } from '@tanstack/react-router'
import { buildAssetLinks } from '../../lib/android'
import { env } from '../../lib/env'
import { wrapRouteHandlers } from '../../lib/error-log'

// F131: GET /.well-known/assetlinks.json -- Digital Asset Links for the Android app (see
// src/lib/android.ts). Public by design: Android fetches it with no session, and it only states
// which app package this domain trusts.
export const Route = createFileRoute('/.well-known/assetlinks.json')({
  server: {
    handlers: {
      GET: () => {
        const body = buildAssetLinks(env.ANDROID_PACKAGE_NAME, env.ANDROID_CERT_SHA256)
        if (!body) {
          return Response.json({ error: 'android_app_not_configured' }, { status: 404 })
        }
        return Response.json(body, {
          headers: { 'Cache-Control': 'public, max-age=3600' },
        })
      },
    },
  },
})

wrapRouteHandlers(Route, '/.well-known/assetlinks.json', ['GET'])

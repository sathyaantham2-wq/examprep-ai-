// F131: service worker for the installed app (Android TWA and PWA install alike).
//
// Deliberately tiny. Its only job is a friendly "you're offline" page instead of the browser's
// dinosaur when a page is opened with no network. It never caches API responses, pages or
// anything a student wrote: every screen shows live, household-scoped data (and answer keys
// after a confirmed attempt), and a stale or shared cache of that is a privacy bug, not a
// feature. Bump VERSION whenever offline.html or its assets change.
const VERSION = 'v1'
const CACHE = `examprep-offline-${VERSION}`
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Only page navigations get the fallback. Everything else (API calls, scripts, images, PDFs)
  // goes straight to the network untouched, so a failed request fails exactly as it would
  // without a service worker and the app's own error handling applies.
  if (request.mode !== 'navigate') return

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then((cached) => cached ?? Response.error()),
    ),
  )
})

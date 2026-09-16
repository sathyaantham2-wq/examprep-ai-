// F004: "capturing client ... errors." Runs in the browser only -- reports uncaught exceptions
// and unhandled promise rejections to POST /api/errors, which writes them to the same error_log
// table server errors use (src/lib/error-log.ts). React render errors are a separate case,
// caught instead by __root.tsx's `errorComponent` (window.onerror/unhandledrejection don't
// reliably fire for those, since React's own reconciler intercepts them first).
const PAGE_LOAD_ID = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'unknown'

function report(message: string, stack?: string): void {
  fetch('/api/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      request_id: PAGE_LOAD_ID,
      route: window.location.pathname,
      message,
      stack,
    }),
    keepalive: true,
  }).catch(() => {
    // Reporting the error failed -- nothing further to do; this must never itself throw
    // somewhere that could loop back into another error report.
  })
}

let installed = false

export function installClientErrorReporting(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  window.addEventListener('error', (event) => {
    report(event.message, event.error instanceof Error ? event.error.stack : undefined)
  })

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason
    report(
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    )
  })
}

export function reportReactError(error: unknown): void {
  report(error instanceof Error ? error.message : String(error), error instanceof Error ? error.stack : undefined)
}

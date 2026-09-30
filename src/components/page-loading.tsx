/**
 * Loading placeholders (2026-09-30 UX rework). Every screen used to show a bare "Loading…" line
 * in the top-left corner while its session/data loaded; these show the rough shape of the page
 * instead, so it is obvious something is on its way and the layout does not jump when it lands.
 */

function Block({ className }: { className: string }) {
  return <div className={`bg-muted animate-pulse rounded-lg ${className}`} />
}

/** Card-shaped placeholders, for use inside a page that is already rendered. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="bg-card border-border space-y-3 rounded-xl border p-5"
          aria-hidden="true"
        >
          <Block className="h-5 w-1/3" />
          <Block className="h-4 w-2/3" />
          <Block className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  )
}

/** A whole-screen placeholder, for the moment before the session (and so the shell) is known. */
export function PageLoading() {
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6 space-y-2" aria-hidden="true">
        <Block className="h-8 w-48" />
        <Block className="h-4 w-72 max-w-full" />
      </div>
      <PageSkeleton />
    </div>
  )
}

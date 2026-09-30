import { Link } from '@tanstack/react-router'
import { ThemeToggle } from './theme-toggle'

// F131: shared layout for public, signed-out text pages (privacy policy, delete-account). One
// readable column, since these are read more on phones than anywhere else.
export function PublicPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-8 flex items-center justify-between gap-4">
        <Link to="/" className="text-h3 font-semibold no-underline">
          PrepPlan
        </Link>
        <ThemeToggle />
      </div>
      <article className="bg-card rounded-xl border p-5 shadow-sm sm:p-8">
        <h1 className="text-h1 mb-1">{title}</h1>
        <p className="text-muted-foreground mb-6 text-sm">Last updated {updated}</p>
        <div className="prose prose-slate dark:prose-invert max-w-none prose-h2:mt-8 prose-h2:text-xl prose-a:text-primary">
          {children}
        </div>
      </article>
    </div>
  )
}

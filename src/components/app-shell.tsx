import type { ReactNode } from 'react'
import { ThemeToggle } from './theme-toggle'

// A persistent sidebar shell, in two variants -- 'parent' (the original: Home/Generate
// Paper/Progress/Settings) and 'student' (Home/Generate Paper/Leaderboard, added at the user's
// explicit request 2026-09-22 so a student landing here after sign-up gets the same sidebar+hero
// treatment, not just her parent). Each variant is built from that role's own real, reachable
// routes only -- a student's "Generate Paper" goes to /my-paper (her adaptive practice paper,
// AI-graded, no parent needed per CLAUDE.md's 2026-09-20 exception), never /generate, which
// redirects a student role away; a student has no /settings or /tracker/:id access at all, so
// neither appears in her nav. "Practice Tests" and "Question Bank" from the original reference
// mockup still have no real page for either role and stay left out. tab06's /papers "Paper
// library" is also still unbuilt (F123's own commit notes) -- 'papers' stays in the type below,
// ready the day that screen ships, but its nav item stays commented out until then.
export type AppShellActive =
  'home' | 'generate' | 'papers' | 'progress' | 'settings' | 'leaderboard'
export type AppShellVariant = 'parent' | 'student'

interface AppShellProps {
  /** Defaults to 'parent' -- every call site before the student variant existed already means
   * that. */
  variant?: AppShellVariant
  /** null for a real screen that just has no nav item of its own (e.g. /onboarding, reached via
   * a link on /home rather than the sidebar itself) -- no item highlights, rather than picking a
   * misleading nearest match. */
  active: AppShellActive | null
  /** Parent variant only: the parent's currently-relevant student, for the Progress link
   * (/tracker/:studentId). Progress is left out of the nav entirely when this is not known yet,
   * rather than linking somewhere broken. Unused by the student variant. */
  studentId?: string | null
  children: ReactNode
}

function HomeIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9" />
    </svg>
  )
}
function GenerateIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
// PapersIcon intentionally removed -- see the note above AppShellActive. Re-add it (a document
// icon: path d="M14 3v4a1 1 0 0 0 1 1h4" / "M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0
// 0 1-2 2Z") when /papers actually exists.
function ProgressIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M7 15v3M12 10v8M17 6v12" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}
function LeaderboardIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 21h8M12 17v4" />
      <path d="M7 4h10v6a5 5 0 0 1-10 0Z" />
      <path d="M7 6H4a1 1 0 0 0-1 1v1a3 3 0 0 0 3 3M17 6h3a1 1 0 0 1 1 1v1a3 3 0 0 1-3 3" />
    </svg>
  )
}

export function AppShell({
  variant = 'parent',
  active,
  studentId,
  children,
}: AppShellProps) {
  const items: Array<{
    key: AppShellActive
    label: string
    href: string
    icon: ReactNode
  }> =
    variant === 'student'
      ? [
          { key: 'home', label: 'Home', href: '/student', icon: <HomeIcon /> },
          {
            key: 'generate',
            label: 'Generate Paper',
            href: '/my-paper',
            icon: <GenerateIcon />,
          },
          {
            key: 'leaderboard',
            label: 'Leaderboard',
            href: '/leaderboard',
            icon: <LeaderboardIcon />,
          },
        ]
      : [
          { key: 'home', label: 'Home', href: '/home', icon: <HomeIcon /> },
          {
            key: 'generate',
            label: 'Generate Paper',
            href: '/generate',
            icon: <GenerateIcon />,
          },
          // 'My Papers' intentionally omitted -- /papers does not exist yet (see the note above
          // AppShellActive). PapersIcon stays imported/used once it does.
          ...(studentId
            ? [
                {
                  key: 'progress' as const,
                  label: 'Progress',
                  href: `/tracker/${studentId}`,
                  icon: <ProgressIcon />,
                },
              ]
            : []),
          {
            key: 'settings',
            label: 'Settings',
            href: '/settings',
            icon: <SettingsIcon />,
          },
        ]

  return (
    <div className="flex min-h-screen">
      <div className="no-print bg-card border-border flex w-[232px] shrink-0 flex-col border-r p-[18px] pt-7">
        <div className="mb-7 flex items-center gap-2.5 px-2">
          <div className="bg-primary flex size-[34px] shrink-0 items-center justify-center rounded-[9px]">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--primary-foreground)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <div className="display-title text-h3 leading-tight">ExamPrep AI</div>
        </div>

        <nav className="flex flex-col gap-0.5">
          {items.map((item) => (
            <a
              key={item.key}
              href={item.href}
              aria-current={item.key === active ? 'page' : undefined}
              className={
                item.key === active
                  ? 'bg-primary/10 text-primary flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-md px-3 py-2.5 text-sm'
              }
            >
              {item.icon}
              {item.label}
            </a>
          ))}
        </nav>

        <div className="mt-auto pt-4">
          <ThemeToggle />
        </div>
      </div>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

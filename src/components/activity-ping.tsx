import { useEffect } from 'react'
import { useSession } from '../lib/auth-client'

const PING_EVERY_MS = 30_000
// She counts as here only if she touched the screen this recently.
const IDLE_AFTER_MS = 60_000

/**
 * Tells the server a signed-in student is actively using the app, so the admin can see how many
 * students use it and for how long. Sends nothing but the ping itself: no page, no answer, no
 * content. Only while the tab is visible and she has just tapped, typed or scrolled, so a tab left
 * open in the background adds nothing. Students only; a parent, admin or signed-out visitor never
 * pings. Stops for good if the server refuses (for example no student profile yet).
 */
export function ActivityPing() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role

  useEffect(() => {
    if (role !== 'student') return

    let lastInteraction = Date.now()
    let stopped = false
    const touch = () => {
      lastInteraction = Date.now()
    }
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
    for (const name of events) {
      window.addEventListener(name, touch, { passive: true })
    }

    const ping = async () => {
      if (stopped) return
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastInteraction > IDLE_AFTER_MS) return
      try {
        const response = await fetch('/api/activity/ping', {
          method: 'POST',
          keepalive: true,
        })
        if (response.status === 401 || response.status === 403) stopped = true
      } catch {
        // Offline or a blip: the next ping simply credits less. Nothing to report.
      }
    }

    void ping()
    const timer = window.setInterval(() => void ping(), PING_EVERY_MS)
    return () => {
      window.clearInterval(timer)
      for (const name of events) window.removeEventListener(name, touch)
    }
  }, [role])

  return null
}

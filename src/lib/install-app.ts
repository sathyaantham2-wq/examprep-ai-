import { useEffect, useState } from 'react'

// Chrome/Edge/Android fire this before showing their own install UI; capturing it lets us offer
// our own button instead of waiting for the browser's mini-infobar. Not in the DOM lib yet, so
// typed by hand -- this is the standard shape every browser that supports it uses.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/**
 * How this browser can install the app right now:
 *  - 'prompt': a real one-click install (Chrome/Edge/Android);
 *  - 'ios': no install API, only "Share, then Add to Home Screen" instructions;
 *  - null: nothing to offer -- already installed (including the Android app, which runs
 *    standalone), or a browser with no install support.
 */
export type InstallMode = 'prompt' | 'ios' | null

// The browser fires beforeinstallprompt once per page load, usually before the screen that wants
// to offer the install has mounted, so it is caught here and kept for whoever asks later.
let deferredPrompt: BeforeInstallPromptEvent | null = null
let watching = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari's own flag -- it never sets display-mode via matchMedia.
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true
    )
  } catch {
    return false
  }
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

/** Start listening for the browser's install offer. Called once from the root document. */
export function watchInstallPrompt(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notify()
  })
}

export function getInstallMode(): InstallMode {
  if (typeof window === 'undefined' || isStandalone()) return null
  if (deferredPrompt) return 'prompt'
  return isIos() ? 'ios' : null
}

/** Shows the browser's own install dialog. Resolves true if she accepted. */
export async function promptInstall(): Promise<boolean> {
  const prompt = deferredPrompt
  if (!prompt) return false
  // The event can only be used once, whichever way she answers.
  deferredPrompt = null
  try {
    await prompt.prompt()
    const choice = await prompt.userChoice
    return choice.outcome === 'accepted'
  } finally {
    notify()
  }
}

/** null until mounted in the browser, so server and first client render agree. */
export function useInstallMode(): InstallMode {
  const [mode, setMode] = useState<InstallMode>(null)
  useEffect(() => {
    watchInstallPrompt()
    const update = () => setMode(getInstallMode())
    update()
    listeners.add(update)
    return () => {
      listeners.delete(update)
    }
  }, [])
  return mode
}

// One flag per place the install is offered, so declining the sign-in banner does not silence
// the popup on a shared link, and the other way round.
export function wasInstallOfferAnswered(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function markInstallOfferAnswered(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // Private browsing / storage disabled -- the offer just reappears next visit, harmless.
  }
}

import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'

// Chrome/Edge/Android fire this before showing their own install UI; capturing it lets us offer
// our own button instead of waiting for the browser's mini-infobar. Not in the DOM lib yet, so
// typed by hand -- this is the standard shape every browser that supports it uses.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISSED_KEY = 'examprep-install-dismissed'

function isStandalone(): boolean {
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari's own flag -- it never sets display-mode via matchMedia.
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Private browsing / storage disabled -- the banner just reappears next visit, harmless.
  }
}

// Offered on the sign-in screen (2026-09-27 request): a real one-click install where the browser
// supports it (Chrome/Edge/Android via beforeinstallprompt), or plain "how to" instructions on
// iOS, which never fires that event and only offers install through its own Share sheet. Renders
// nothing once actually installed, or after she's dismissed it once.
export function InstallAppBanner({ className }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHelp, setShowIosHelp] = useState(false)
  const [visible, setVisible] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (isStandalone() || wasDismissed()) return

    if (isIos()) {
      setShowIosHelp(true)
      setVisible(true)
      return
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    // Already installed and this fires again anyway (some browsers do on re-visit before
    // navigating away) -- isStandalone() above already filtered that common case out.
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  if (!visible) return null

  async function handleInstall() {
    if (!deferredPrompt) return
    setInstalling(true)
    try {
      await deferredPrompt.prompt()
      // Either outcome ('accepted' or 'dismissed') means she made a real choice on the browser's
      // own install dialog -- don't ask again this browser either way.
      await deferredPrompt.userChoice
      dismiss()
      setVisible(false)
    } finally {
      setInstalling(false)
      setDeferredPrompt(null)
    }
  }

  function handleDismiss() {
    dismiss()
    setVisible(false)
  }

  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm',
        className,
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Download className="size-4.5" strokeWidth={2} />
      </div>
      {showIosHelp ? (
        <p className="text-small flex-1 text-foreground">
          Install ExamPrep AI: tap <Share className="inline size-3.5 align-text-bottom" /> Share,
          then <SquarePlus className="inline size-3.5 align-text-bottom" /> "Add to Home Screen".
        </p>
      ) : (
        <div className="flex-1">
          <p className="text-small font-medium text-foreground">Install ExamPrep AI</p>
          <p className="text-small text-muted-foreground">
            Add it to your home screen for one-tap access, no browser bar.
          </p>
        </div>
      )}
      {!showIosHelp && (
        <Button type="button" size="sm" onClick={() => void handleInstall()} disabled={installing}>
          {installing ? 'Installing…' : 'Install'}
        </Button>
      )}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

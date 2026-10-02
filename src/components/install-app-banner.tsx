import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import {
  markInstallOfferAnswered,
  promptInstall,
  useInstallMode,
  wasInstallOfferAnswered,
} from '../lib/install-app'

const DISMISSED_KEY = 'examprep-install-dismissed'

// Offered on the sign-in screen (2026-09-27 request): a real one-click install where the browser
// supports it (Chrome/Edge/Android via beforeinstallprompt), or plain "how to" instructions on
// iOS, which never fires that event and only offers install through its own Share sheet. Renders
// nothing once actually installed, or after she's dismissed it once.
export function InstallAppBanner({ className }: { className?: string }) {
  const mode = useInstallMode()
  const [dismissed, setDismissed] = useState(true)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    setDismissed(wasInstallOfferAnswered(DISMISSED_KEY))
  }, [])

  if (!mode || dismissed) return null

  function handleDismiss() {
    markInstallOfferAnswered(DISMISSED_KEY)
    setDismissed(true)
  }

  async function handleInstall() {
    setInstalling(true)
    try {
      // Either outcome means she made a real choice on the browser's own install dialog --
      // don't ask again this browser either way.
      await promptInstall()
      handleDismiss()
    } finally {
      setInstalling(false)
    }
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
      {mode === 'ios' ? (
        <p className="text-small flex-1 text-foreground">
          Install PrepPlan: tap{' '}
          <Share className="inline size-3.5 align-text-bottom" /> Share, then{' '}
          <SquarePlus className="inline size-3.5 align-text-bottom" /> "Add to
          Home Screen".
        </p>
      ) : (
        <div className="flex-1">
          <p className="text-small font-medium text-foreground">
            Install PrepPlan
          </p>
          <p className="text-small text-muted-foreground">
            Add it to your home screen for one-tap access, no browser bar.
          </p>
        </div>
      )}
      {mode === 'prompt' && (
        <Button
          type="button"
          size="sm"
          onClick={() => void handleInstall()}
          disabled={installing}
        >
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

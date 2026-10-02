import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus } from 'lucide-react'
import { Button } from './ui/button'
import {
  markInstallOfferAnswered,
  promptInstall,
  useInstallMode,
  wasInstallOfferAnswered,
} from '../lib/install-app'

/**
 * Whether the install popup has anything to offer here: the browser can install the app, it is
 * not installed already, and she has not answered this particular offer before.
 */
export function useInstallOffer(storageKey: string): boolean {
  const mode = useInstallMode()
  const [answered, setAnswered] = useState(true)
  useEffect(() => {
    setAnswered(wasInstallOfferAnswered(storageKey))
  }, [storageKey])
  return mode !== null && !answered
}

interface InstallAppDialogProps {
  /** localStorage flag for this offer; once she answers, it is not shown again. */
  storageKey: string
  /** Called after she answers either way, so the page can carry on with what she was doing. */
  onClose: () => void
}

// The popup form of the install offer (2026-10-02 request): shown when a shared link is opened
// and when a paper is generated. Asked once per place; the caller decides when to open it.
export function InstallAppDialog({
  storageKey,
  onClose,
}: InstallAppDialogProps) {
  const mode = useInstallMode()
  const [installing, setInstalling] = useState(false)

  function close() {
    markInstallOfferAnswered(storageKey)
    onClose()
  }

  async function handleInstall() {
    setInstalling(true)
    try {
      await promptInstall()
    } finally {
      setInstalling(false)
      close()
    }
  }

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-app-title"
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full max-w-sm rounded-2xl border p-6 shadow-xl"
      >
        <div className="bg-primary text-primary-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
          <Download className="size-6" strokeWidth={2} />
        </div>
        <h2 id="install-app-title" className="text-h3 mb-1">
          Install PrepPlan
        </h2>
        {mode === 'ios' ? (
          <p className="text-body text-muted-foreground mb-5">
            Tap <Share className="inline size-4 align-text-bottom" /> Share in
            your browser, then{' '}
            <SquarePlus className="inline size-4 align-text-bottom" /> "Add to
            Home Screen". PrepPlan then opens like any other app.
          </p>
        ) : (
          <p className="text-body text-muted-foreground mb-5">
            Add PrepPlan to your home screen. It opens in one tap, full screen,
            with no browser bar.
          </p>
        )}
        <div className="flex justify-end gap-2">
          {mode === 'prompt' ? (
            <>
              <Button type="button" variant="outline" onClick={close}>
                Not now
              </Button>
              <Button
                type="button"
                onClick={() => void handleInstall()}
                disabled={installing}
              >
                {installing ? 'Installing…' : 'Install'}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={close}>
              OK
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

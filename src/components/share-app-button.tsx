import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { Button } from './ui/button'

const SHARE_TEXT =
  'PrepPlan makes syllabus-exact practice papers and shows which marks were lost and why.'

// The link carries source=share so the page it opens can offer the install straight away.
function shareUrl(): string {
  return `${window.location.origin}/?source=share`
}

// Shares the app itself, never a paper or a result: those belong to one student. Uses the
// device's own share sheet where there is one (phones, the Android app) and copies the link
// everywhere else. Rendered next to the sound and theme toggles.
export function ShareAppButton() {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    const url = shareUrl()
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'PrepPlan', text: SHARE_TEXT, url })
        return
      } catch (error) {
        // She closed the share sheet -- that is an answer, not a failure.
        if ((error as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // No share sheet and no clipboard access: show the link so it can be copied by hand.
      window.prompt('Copy this link to share PrepPlan:', url)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={copied ? 'Link copied' : 'Share PrepPlan'}
      title={copied ? 'Link copied' : 'Share PrepPlan'}
      onClick={() => void handleShare()}
    >
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
    </Button>
  )
}

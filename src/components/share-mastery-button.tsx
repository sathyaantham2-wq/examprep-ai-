import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { Button } from './ui/button'
import type { SubjectView } from './adaptive-overview'
import { masteryShareText, whatsAppUrl } from '../lib/mastery-share'

// Sends the student's own chapter mastery as text. Uses the device share sheet where there is
// one (phones, the Android app) so WhatsApp -- or any app -- can be picked; otherwise opens
// WhatsApp directly. Nothing is stored and there is no public link: she decides what is sent.
export function ShareMasteryButton({
  studentName,
  subjects,
}: {
  studentName: string
  subjects: Array<SubjectView>
}) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    const text = masteryShareText(studentName, subjects)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'My PrepPlan progress', text })
        return
      } catch (error) {
        // She closed the share sheet -- that is an answer, not a failure.
        if ((error as Error).name === 'AbortError') return
      }
    }
    const opened = window.open(whatsAppUrl(text), '_blank', 'noopener')
    if (opened) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this and send it:', text)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={() => void handleShare()}>
      {copied ? (
        <Check className="mr-1.5 size-4" />
      ) : (
        <Share2 className="mr-1.5 size-4" />
      )}
      {copied ? 'Copied' : 'Share my progress'}
    </Button>
  )
}

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from './ui/button'
import { pdfFileName } from '../lib/pdf/file-name'

/**
 * F130: "Download this paper as PDF" (2026-09-30, owner request): lets a student save or print her own
 * question paper. Questions only -- GET /api/papers/:id/pdf refuses include_key for a student and
 * only serves a paper generated for her. The server renders the PDF, which takes a few seconds,
 * so this fetches it with a visible "Preparing…" state instead of a link that looks dead.
 */
export function DownloadPaperButton({
  paperId,
  title,
}: {
  paperId: string
  title: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/papers/${paperId}/pdf?download=1`)
      if (!response.ok) {
        setError('Could not prepare the PDF. Please try again.')
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${pdfFileName(title)}.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch {
      setError('Could not prepare the PDF. Please check your connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void download()}
      >
        <Download />
        {busy ? 'Preparing your PDF…' : 'Download this paper as PDF'}
      </Button>
      {error && (
        <span className="text-small text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { ThemeToggle } from '../components/theme-toggle'
import { useSession, signOut } from '../lib/auth-client'

export const Route = createFileRoute('/settings')({ component: Settings })

interface Household {
  id: string
  name: string
}

/**
 * F098 (tab06 /settings): "privacy: export and delete." Export downloads the full JSON directly
 * (no email/job queue exists -- see the route's own note); delete requires typing the household's
 * real name back, since it is genuinely irreversible.
 */
function Settings() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role

  const [household, setHousehold] = useState<Household | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (isPending) return
    if (!session || (role !== 'parent' && role !== 'admin')) {
      navigate({ to: '/' })
      return
    }
    fetch('/api/households/me')
      .then((r) => r.json())
      .then(setHousehold)
  }, [isPending, session, role, navigate])

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      const response = await fetch('/api/privacy/export', { method: 'POST' })
      if (!response.ok) {
        setExportError('Could not generate the export.')
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `examprep-export-${household?.id ?? 'household'}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    if (!household || confirmName !== household.name) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const response = await fetch('/api/privacy/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_household_name: confirmName }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setDeleteError(body.error ?? 'Could not delete this household.')
        return
      }
      await signOut()
      navigate({ to: '/' })
    } finally {
      setDeleting(false)
    }
  }

  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Settings</h1>
          <p className="text-body text-muted-foreground">{household?.name}</p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-h3">Export your data</CardTitle>
          <CardDescription>
            Downloads every record for your household as a JSON file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exportError && (
            <p className="text-small text-destructive mb-2" role="alert">
              {exportError}
            </p>
          )}
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Export my data'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-h3">Delete your account</CardTitle>
          <CardDescription>
            Permanently deletes your household and everything in it — students, papers,
            evaluations, and history. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="confirm-name">
              Type "{household?.name}" to confirm
            </Label>
            <input
              id="confirm-name"
              className="border-input flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
            />
          </div>
          {deleteError && (
            <p className="text-small text-destructive" role="alert">
              {deleteError}
            </p>
          )}
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || !household || confirmName !== household.name}
          >
            {deleting ? 'Deleting…' : 'Permanently delete my household'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

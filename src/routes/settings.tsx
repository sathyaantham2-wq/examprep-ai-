import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Label } from '../components/ui/label'
import { AppShell } from '../components/app-shell'
import { useSession, signOut } from '../lib/auth-client'
import { PageLoading } from '../components/page-loading'

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
    if (!session || (role !== 'parent' && role !== 'admin' && role !== 'student')) {
      navigate({ to: '/' })
      return
    }
    if (role === 'student') return
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

  if (session && role === 'student') return <StudentSettings />
  if (isPending || !session || (role !== 'parent' && role !== 'admin')) {
    return <PageLoading />
  }

  return (
    <AppShell active="settings">
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <div className="mb-6">
          <h1 className="text-h1">Settings</h1>
          <p className="text-body text-muted-foreground">{household?.name}</p>
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
              Permanently deletes your household and everything in it —
              students, papers, evaluations, and history. This cannot be undone.
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
              disabled={
                deleting || !household || confirmName !== household.name
              }
            >
              {deleting ? 'Deleting…' : 'Permanently delete my household'}
            </Button>
          </CardContent>
        </Card>
        {/* F131: Google Play wants the privacy policy reachable from inside the app. */}
        <p className="text-small text-muted-foreground">
          Read our{' '}
          <Link to="/privacy" className="text-primary hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </AppShell>
  )
}

type SelfDeleteState =
  | { allowed: true }
  | { allowed: false; reason: 'no_student_profile' | 'parent_managed' | 'parent_linked' | 'shared_household' }

/**
 * F098 for a student (Google Play: whoever can create an account must be able to delete it).
 * Only a student who signed up on her own, with no parent following her, can delete herself; the
 * server decides (GET/POST /api/privacy/delete-self) and this screen only reflects it.
 */
function StudentSettings() {
  const navigate = useNavigate()
  const [state, setState] = useState<SelfDeleteState | null>(null)
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/privacy/delete-self')
      .then((r) => r.json())
      .then((body: SelfDeleteState) => setState(body))
      .catch(() => setError('Could not load your account settings.'))
  }, [])

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const response = await fetch('/api/privacy/delete-self', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        setError(body.message ?? 'Could not delete your account.')
        return
      }
      await signOut().catch(() => undefined)
      navigate({ to: '/' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppShell variant="student" active="settings">
      <div className="mx-auto max-w-2xl p-4 sm:p-8">
        <h1 className="text-h1 mb-6">Settings</h1>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-h3">Delete your account</CardTitle>
            <CardDescription>
              Permanently deletes your account and everything in it: your papers, answers,
              marks, points and progress. This cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!state && !error && <p className="text-small text-muted-foreground">Loading…</p>}
            {state?.allowed === false && (
              <p className="text-body">
                A parent looks after your account, so only they can delete it. Ask them to open
                Settings on their account.
              </p>
            )}
            {state?.allowed && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-delete">Type DELETE to confirm</Label>
                  <input
                    id="confirm-delete"
                    autoComplete="off"
                    className="border-input flex h-10 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={deleting || confirm !== 'DELETE'}
                >
                  {deleting ? 'Deleting…' : 'Permanently delete my account'}
                </Button>
              </>
            )}
            {error && (
              <p className="text-small text-destructive" role="alert">
                {error}
              </p>
            )}
          </CardContent>
        </Card>

        <p className="text-small text-muted-foreground">
          Read our{' '}
          <Link to="/privacy" className="text-primary hover:underline">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </AppShell>
  )
}

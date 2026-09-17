import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ThemeToggle } from '../../components/theme-toggle'
import { useSession } from '../../lib/auth-client'

export const Route = createFileRoute('/admin/users')({ component: AdminUsers })

interface UserRow {
  id: string
  name: string
  email: string
  role: 'parent' | 'student' | 'admin'
  is_active: boolean
  email_verified: boolean
  created_at: string
}

/**
 * F083 (tab06 /admin/users): the last piece of the admin console's literal AC list ("Manage
 * ... users"). 'admin' here is a household member with an elevated role, not a cross-tenant
 * superadmin (promoteToAdmin only ever flips role, never household_id) -- so "users" means the
 * accounts within the admin's own household: the parent/admin account(s) and any student login
 * accounts. Deactivating one is enforced server-side in session.ts's getCurrentUser, not just a
 * hidden button, and every toggle is written to the audit log (F099).
 */
function AdminUsers() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const role = (session?.user as { role?: string } | undefined)?.role
  const currentUserId = (session?.user as { id?: string } | undefined)?.id

  const [users, setUsers] = useState<Array<UserRow> | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  function refresh() {
    fetch('/api/households/users')
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load users.')
        return r.json() as Promise<Array<UserRow>>
      })
      .then(setUsers)
      .catch((err: Error) => setLoadError(err.message))
  }

  useEffect(() => {
    if (isPending) return
    if (!session || role !== 'admin') {
      navigate({ to: '/' })
      return
    }
    refresh()
  }, [isPending, session, role, navigate])

  async function toggleActive(user: UserRow) {
    setActionError(null)
    setPendingId(user.id)
    try {
      const response = await fetch(`/api/households/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: !user.is_active }),
      })
      const body = await response.json()
      if (!response.ok) {
        setActionError(body.error ?? 'Could not update that account.')
        return
      }
      refresh()
    } finally {
      setPendingId(null)
    }
  }

  if (isPending || !session || role !== 'admin') {
    return <div className="p-8 text-body text-muted-foreground">Loading…</div>
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-h1">Users</h1>
          <p className="text-body text-muted-foreground">
            Accounts in this household. Deactivating an account blocks it from
            signing in immediately, even from an existing session.
          </p>
        </div>
        <div className="no-print">
          <ThemeToggle />
        </div>
      </div>

      {loadError && (
        <p className="text-small text-destructive mb-4" role="alert">
          {loadError}
        </p>
      )}
      {actionError && (
        <p className="text-small text-destructive mb-4" role="alert">
          {actionError}
        </p>
      )}

      <div className="space-y-3">
        {users?.map((user) => (
          <Card key={user.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-h3">
                    {user.name}
                    {user.id === currentUserId && (
                      <span className="text-small text-muted-foreground ml-2 font-normal">
                        (you)
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {user.email} — {user.role}
                    {!user.email_verified && ' — unverified'}
                    {!user.is_active && ' — deactivated'}
                  </CardDescription>
                </div>
                <Button
                  variant={user.is_active ? 'outline' : 'default'}
                  disabled={pendingId === user.id}
                  onClick={() => void toggleActive(user)}
                >
                  {user.is_active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            </CardHeader>
          </Card>
        ))}

        {users?.length === 0 && (
          <p className="text-body text-muted-foreground">No users found.</p>
        )}
      </div>
    </div>
  )
}

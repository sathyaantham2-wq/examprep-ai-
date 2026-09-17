import { auth } from './auth'
import type { UserRole } from '../db/enums'

export interface AuthedUser {
  id: string
  householdId: string
  role: UserRole
}

interface SessionUser {
  household_id: string
  role: UserRole
  is_active: boolean
}

/**
 * Server-side session/role guards (F007). These enforce auth on the request itself — never rely
 * on a client-side redirect or a hidden button to keep the student role out of parent/admin
 * routes (T01/T09): every handler that reads or writes private data must call one of these.
 */
export async function getCurrentUser(
  request: Request,
): Promise<AuthedUser | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null

  const user = session.user as typeof session.user & SessionUser

  // F083 (admin users management): a deactivated account's existing session must stop working
  // on its very next request, not just at next sign-in — deactivation is enforced right here,
  // the one place every authenticated route already funnels through, rather than trusting every
  // call site to remember a separate check.
  if (!user.is_active) return null

  return { id: user.id, householdId: user.household_id, role: user.role }
}

export async function requireUser(
  request: Request,
): Promise<AuthedUser | Response> {
  const user = await getCurrentUser(request)
  if (!user) return new Response(null, { status: 401 })
  return user
}

export async function requireRole(
  request: Request,
  ...roles: Array<UserRole>
): Promise<AuthedUser | Response> {
  const result = await requireUser(request)
  if (result instanceof Response) return result
  if (!roles.includes(result.role)) return new Response(null, { status: 403 })
  return result
}

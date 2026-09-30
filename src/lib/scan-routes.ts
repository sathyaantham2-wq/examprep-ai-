import { getSharedDb } from '../db/connection'
import type { Db } from '../db/connection'
import { requireRole } from './session'
import { ScanError, resolveScanAccess } from './scans'
import type { ScanAccess } from './scans'

/**
 * Shared front half of every /api/attempts/:id/scan* route: signed in as the student or a parent
 * or admin of her household, the attempt found through that scope (else 404), and ScanErrors
 * turned into their JSON responses.
 */
export async function withScanAccess(
  request: Request,
  attemptId: string,
  fn: (db: Db, access: ScanAccess) => Promise<Response>,
): Promise<Response> {
  const user = await requireRole(request, 'student', 'parent', 'admin')
  if (user instanceof Response) return user
  const db = getSharedDb()
  const access = await resolveScanAccess(db, user, attemptId)
  if (access instanceof Response) return access
  try {
    return await fn(db, access)
  } catch (error) {
    if (error instanceof ScanError) return error.toResponse()
    throw error
  }
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null)
}

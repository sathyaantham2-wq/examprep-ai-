import type { Db } from '../../db/connection'
import { studentsRepository } from '../../db/repositories'
import { requireRole } from '../session'
import { resolveEnabledStudent } from '../access'

/**
 * Who the adaptive routes are about. A student always sees her own data (F010's access gate
 * applies); a parent, teacher or admin must name `student_id`, and it is checked against their own
 * household, the same rule every other household-scoped route uses. Never trusts an id from a
 * student caller.
 */
export async function resolveAdaptiveStudent(request: Request, db: Db) {
  const auth = await requireRole(request, 'student', 'parent', 'teacher', 'admin')
  if (auth instanceof Response) return auth

  if (auth.role === 'student') {
    const student = await resolveEnabledStudent(db, auth.id)
    if (student instanceof Response) return student
    return { auth, student }
  }

  const studentId = new URL(request.url).searchParams.get('student_id')
  if (!studentId) {
    return Response.json({ error: 'student_id is required' }, { status: 400 })
  }
  const student = await studentsRepository.findById(db, auth.householdId, studentId)
  if (!student) return new Response(null, { status: 404 })
  return { auth, student }
}

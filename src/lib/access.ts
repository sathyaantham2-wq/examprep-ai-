import type { Db } from '../db/connection'
import { studentsRepository } from '../db/repositories'

/**
 * F010: "Toggle per student; disabled student sees a friendly locked screen; parent always
 * retains access." The single enforcement point every student-facing route (attempts,
 * remediation, habit-drills, student dashboard) calls instead of raw
 * studentsRepository.findByUserId -- centralised so access_enabled can't be missed on some future
 * route, the same reasoning T09 already applies to household scoping. 423 (Locked) is
 * deliberately distinct from the existing 403 "not linked to a student profile" case, so the
 * client can render a locked screen rather than a generic error.
 */
export async function resolveEnabledStudent(db: Db, userId: string) {
  const student = await studentsRepository.findByUserId(db, userId)
  if (!student) {
    return Response.json(
      { error: 'This login is not linked to a student profile' },
      { status: 403 },
    )
  }
  if (!student.access_enabled) {
    return Response.json(
      {
        error: 'locked',
        message: 'A parent has paused access for this profile.',
      },
      { status: 423 },
    )
  }
  return student
}

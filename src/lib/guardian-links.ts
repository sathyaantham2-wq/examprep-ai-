import type { Db } from '../db/connection'
import { CURRENT_CONSENT_VERSION } from './consent'

/**
 * One student, one login. A parent or teacher (a "guardian" here) asks to follow a student by
 * her email address; the student approves while signed in as herself. Approval moves her
 * students row and her login into the guardian's household, which is the scope every existing
 * parent-side check already reads, so no access rule elsewhere had to change. Unlinking puts her
 * back in her own household. Nothing is deleted: invites keep their history through status.
 *
 * A student can be followed through one household at a time. A second invite is refused at
 * approval time with a clear message until the first link is ended.
 */

export type InviteError =
  | 'self_invite'
  | 'already_linked'
  | 'not_found'
  | 'not_pending'
  | 'wrong_account'
  | 'no_student_profile'
  | 'student_already_linked'
  | 'not_approved'

export type Result<T> = { ok: true; value: T } | { ok: false; error: InviteError }

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

export interface Guardian {
  userId: string
  householdId: string
}

/**
 * Creates (or returns the existing) pending invite. The caller responds the same way whether or
 * not an account exists for the address, so this can never be used to discover who has one.
 */
export async function createInvite(
  db: Db,
  guardian: Guardian,
  rawEmail: string,
  consentGiven: boolean,
): Promise<Result<{ id: string; created: boolean }>> {
  const email = normaliseEmail(rawEmail)

  const self = await db
    .selectFrom('users')
    .select('email')
    .where('id', '=', guardian.userId)
    .executeTakeFirst()
  if (self && normaliseEmail(self.email) === email) {
    return { ok: false, error: 'self_invite' }
  }

  const existing = await db
    .selectFrom('guardian_invites')
    .select(['id', 'status'])
    .where('guardian_household_id', '=', guardian.householdId)
    .where('student_email', '=', email)
    .where('status', 'in', ['pending', 'approved'])
    .executeTakeFirst()
  if (existing?.status === 'approved') {
    return { ok: false, error: 'already_linked' }
  }
  if (existing) return { ok: true, value: { id: existing.id, created: false } }

  const row = await db
    .insertInto('guardian_invites')
    .values({
      guardian_user_id: guardian.userId,
      guardian_household_id: guardian.householdId,
      student_email: email,
      consent_given: consentGiven,
    })
    .returning('id')
    .executeTakeFirstOrThrow()
  return { ok: true, value: { id: row.id, created: true } }
}

/** What a guardian sees: their invites, with the student's name only once she has approved. */
export async function listForGuardian(db: Db, householdId: string) {
  return db
    .selectFrom('guardian_invites')
    .leftJoin('students', 'students.id', 'guardian_invites.student_id')
    .select([
      'guardian_invites.id',
      'guardian_invites.student_email',
      'guardian_invites.status',
      'guardian_invites.created_at',
      'guardian_invites.responded_at',
      'students.name as student_name',
    ])
    .where('guardian_invites.guardian_household_id', '=', householdId)
    .orderBy('guardian_invites.created_at', 'desc')
    .execute()
}

async function studentFor(db: Db, userId: string) {
  const user = await db
    .selectFrom('users')
    .select(['email'])
    .where('id', '=', userId)
    .executeTakeFirst()
  const student = await db
    .selectFrom('students')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst()
  return { user, student }
}

/** What a student sees: pending invites addressed to her email, and who she is linked to now. */
export async function incomingForStudent(db: Db, userId: string) {
  const { user, student } = await studentFor(db, userId)
  if (!user || !student) return { invites: [], linkedTo: null }

  const invites = await db
    .selectFrom('guardian_invites')
    .innerJoin('users', 'users.id', 'guardian_invites.guardian_user_id')
    .select([
      'guardian_invites.id',
      'guardian_invites.created_at',
      'users.name as guardian_name',
      'users.role as guardian_role',
    ])
    .where('guardian_invites.student_email', '=', normaliseEmail(user.email))
    .where('guardian_invites.status', '=', 'pending')
    .orderBy('guardian_invites.created_at', 'desc')
    .execute()

  const linkedTo =
    student.own_household_id && student.household_id !== student.own_household_id
      ? await db
          .selectFrom('guardian_invites')
          .innerJoin('users', 'users.id', 'guardian_invites.guardian_user_id')
          .select(['users.name as guardian_name', 'users.role as guardian_role'])
          .where('guardian_invites.student_id', '=', student.id)
          .where('guardian_invites.status', '=', 'approved')
          .orderBy('guardian_invites.responded_at', 'desc')
          .executeTakeFirst()
      : null

  return { invites, linkedTo: linkedTo ?? null }
}

/** The student answers an invite. Approving moves her (and her login) into the guardian's household. */
export async function respondToInvite(
  db: Db,
  studentUserId: string,
  inviteId: string,
  approve: boolean,
): Promise<Result<{ status: 'approved' | 'declined' }>> {
  const invite = await db
    .selectFrom('guardian_invites')
    .selectAll()
    .where('id', '=', inviteId)
    .executeTakeFirst()
  if (!invite) return { ok: false, error: 'not_found' }

  const { user, student } = await studentFor(db, studentUserId)
  if (!user || !student) return { ok: false, error: 'no_student_profile' }
  // An invite is addressed to an email; only the account that owns that email can answer it.
  if (normaliseEmail(user.email) !== invite.student_email) {
    return { ok: false, error: 'not_found' }
  }
  if (invite.status !== 'pending') return { ok: false, error: 'not_pending' }

  if (!approve) {
    await db
      .updateTable('guardian_invites')
      .set({ status: 'declined', responded_at: new Date() })
      .where('id', '=', invite.id)
      .execute()
    return { ok: true, value: { status: 'declined' } }
  }

  if (
    !student.own_household_id ||
    student.household_id !== student.own_household_id
  ) {
    return { ok: false, error: 'student_already_linked' }
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('students')
      .set({ household_id: invite.guardian_household_id })
      .where('id', '=', student.id)
      .execute()
    await trx
      .updateTable('users')
      .set({ household_id: invite.guardian_household_id })
      .where('id', '=', studentUserId)
      .execute()
    await trx
      .updateTable('guardian_invites')
      .set({ status: 'approved', student_id: student.id, responded_at: new Date() })
      .where('id', '=', invite.id)
      .execute()
    if (invite.consent_given) {
      await trx
        .insertInto('consents')
        .values({
          household_id: invite.guardian_household_id,
          student_id: student.id,
          given_by_user_id: invite.guardian_user_id,
          purpose_version: CURRENT_CONSENT_VERSION,
        })
        .execute()
    }
  })
  return { ok: true, value: { status: 'approved' } }
}

async function unlinkStudent(db: Db, studentId: string, inviteId: string) {
  const student = await db
    .selectFrom('students')
    .select(['id', 'user_id', 'own_household_id'])
    .where('id', '=', studentId)
    .executeTakeFirstOrThrow()
  if (!student.own_household_id) return
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('students')
      .set({ household_id: student.own_household_id! })
      .where('id', '=', student.id)
      .execute()
    if (student.user_id) {
      await trx
        .updateTable('users')
        .set({ household_id: student.own_household_id! })
        .where('id', '=', student.user_id)
        .execute()
    }
    await trx
      .updateTable('guardian_invites')
      .set({ status: 'revoked', responded_at: new Date() })
      .where('id', '=', inviteId)
      .execute()
  })
}

/** A guardian stops following a student. Pending invites are simply cancelled. */
export async function revokeByGuardian(
  db: Db,
  householdId: string,
  inviteId: string,
): Promise<Result<{ status: 'revoked' }>> {
  const invite = await db
    .selectFrom('guardian_invites')
    .selectAll()
    .where('id', '=', inviteId)
    .where('guardian_household_id', '=', householdId)
    .executeTakeFirst()
  if (!invite) return { ok: false, error: 'not_found' }
  if (invite.status === 'pending') {
    await db
      .updateTable('guardian_invites')
      .set({ status: 'revoked', responded_at: new Date() })
      .where('id', '=', invite.id)
      .execute()
    return { ok: true, value: { status: 'revoked' } }
  }
  if (invite.status !== 'approved' || !invite.student_id) {
    return { ok: false, error: 'not_approved' }
  }
  await unlinkStudent(db, invite.student_id, invite.id)
  return { ok: true, value: { status: 'revoked' } }
}

/** The student ends her own link at any time. */
export async function leaveGuardian(
  db: Db,
  studentUserId: string,
): Promise<Result<{ status: 'revoked' }>> {
  const { student } = await studentFor(db, studentUserId)
  if (!student) return { ok: false, error: 'no_student_profile' }
  const invite = await db
    .selectFrom('guardian_invites')
    .select('id')
    .where('student_id', '=', student.id)
    .where('status', '=', 'approved')
    .orderBy('responded_at', 'desc')
    .executeTakeFirst()
  if (!invite) return { ok: false, error: 'not_approved' }
  await unlinkStudent(db, student.id, invite.id)
  return { ok: true, value: { status: 'revoked' } }
}

import { z } from 'zod'
import type { Db } from '../db/connection'

export interface ProfileSubject {
  id: string
  name: string
  code: string
  has_content: boolean
}

export interface ProfileOption {
  board: string
  class: number
  subjects: Array<ProfileSubject>
}

// Test fixtures leave "... (seed)" subjects (code ending -SEED) in the shared database; they are
// never something a real student should be offered.
const FIXTURE_CODE = '%-SEED'

/** Every board and class the admin has switched on, with the subjects a student can choose. */
export async function listProfileOptions(db: Db): Promise<Array<ProfileOption>> {
  const rows = await db
    .selectFrom('subjects as s')
    .select([
      's.id',
      's.name',
      's.code',
      's.board',
      's.class',
      (eb) =>
        eb
          .exists(
            eb
              .selectFrom('chapters as ch')
              .select('ch.id')
              .whereRef('ch.subject_id', '=', 's.id'),
          )
          .as('has_content'),
    ])
    .where('s.is_active', '=', true)
    .where('s.code', 'not like', FIXTURE_CODE)
    .orderBy('s.board')
    .orderBy('s.class')
    .orderBy('s.name')
    .execute()

  const grouped = new Map<string, ProfileOption>()
  for (const r of rows) {
    const key = `${r.board}|${r.class}`
    const option = grouped.get(key) ?? { board: r.board, class: r.class, subjects: [] }
    option.subjects.push({ id: r.id, name: r.name, code: r.code, has_content: Boolean(r.has_content) })
    grouped.set(key, option)
  }
  return [...grouped.values()]
}

export interface StudentProfile {
  id: string
  name: string
  class: number
  board: string
  profile_complete: boolean
  subject_ids: Array<string>
}

export async function getStudentProfile(db: Db, studentId: string): Promise<StudentProfile | null> {
  const student = await db
    .selectFrom('students')
    .select(['id', 'name', 'class', 'board', 'profile_completed_at'])
    .where('id', '=', studentId)
    .executeTakeFirst()
  if (!student) return null
  const subjects = await db
    .selectFrom('student_subjects')
    .select('subject_id')
    .where('student_id', '=', studentId)
    .where('is_active', '=', true)
    .execute()
  return {
    id: student.id,
    name: student.name,
    class: student.class,
    board: student.board,
    profile_complete: student.profile_completed_at !== null && subjects.length > 0,
    subject_ids: subjects.map((s) => s.subject_id),
  }
}

export const profileInputSchema = z.object({
  name: z.string().trim().min(1, 'Enter the student name').max(100),
  class: z.number().int().min(1).max(12),
  board: z.string().trim().min(1),
  subject_ids: z.array(z.string().uuid()).min(1, 'Choose at least one subject'),
})

export type ProfileInput = z.infer<typeof profileInputSchema>

export type SaveProfileResult =
  | { ok: true; profile: StudentProfile }
  | { ok: false; error: string }

/**
 * Saves the setup form. Subjects must be active and belong to the chosen board and class. A
 * subject that is deselected is switched off, never deleted, so its history stays intact.
 */
export async function saveStudentProfile(
  db: Db,
  studentId: string,
  input: ProfileInput,
): Promise<SaveProfileResult> {
  const options = await listProfileOptions(db)
  const offered = options.find((o) => o.board === input.board && o.class === input.class)
  if (!offered) return { ok: false, error: 'That class and syllabus is not available yet' }
  const allowed = new Set(offered.subjects.map((s) => s.id))
  const chosen = [...new Set(input.subject_ids)]
  if (chosen.some((id) => !allowed.has(id))) {
    return { ok: false, error: 'One of the subjects does not belong to that class and syllabus' }
  }

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('students')
      .set({ name: input.name, class: input.class, board: input.board })
      .where('id', '=', studentId)
      .execute()
    await trx
      .updateTable('students')
      .set({ profile_completed_at: new Date() })
      .where('id', '=', studentId)
      .where('profile_completed_at', 'is', null)
      .execute()

    await trx
      .updateTable('student_subjects')
      .set({ is_active: false, updated_at: new Date() })
      .where('student_id', '=', studentId)
      .where('subject_id', 'not in', chosen)
      .execute()
    for (const subjectId of chosen) {
      await trx
        .insertInto('student_subjects')
        .values({ student_id: studentId, subject_id: subjectId })
        .onConflict((oc) =>
          oc.columns(['student_id', 'subject_id']).doUpdateSet({ is_active: true, updated_at: new Date() }),
        )
        .execute()
    }
  })

  const profile = await getStudentProfile(db, studentId)
  return { ok: true, profile: profile! }
}

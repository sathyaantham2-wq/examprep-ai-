import type { Db } from '../db/connection'

/**
 * F098: "Self-serve full export (JSON + PDFs) ... including scans and AI job logs." Gathers
 * every row this household or its students own, across every table that cascades from
 * households/students. Actual PDF bytes aren't bundled -- papers/reports are rendered on demand
 * by the existing Playwright pipeline (F033) rather than stored as retrievable blobs, and scans
 * have no real file storage yet (M10 wasn't built this pass) -- both are stated gaps, called out
 * in the export's own `notes` field rather than silently omitted.
 */
export async function exportHouseholdData(db: Db, householdId: string) {
  const household = await db
    .selectFrom('households')
    .selectAll()
    .where('id', '=', householdId)
    .executeTakeFirstOrThrow()

  const users = await db
    .selectFrom('users')
    .select(['id', 'email', 'name', 'role', 'created_at'])
    .where('household_id', '=', householdId)
    .execute()

  const students = await db
    .selectFrom('students')
    .selectAll()
    .where('household_id', '=', householdId)
    .execute()
  const studentIds = students.map((s) => s.id)

  const papers =
    studentIds.length > 0
      ? await db.selectFrom('papers').selectAll().where('student_id', 'in', studentIds).execute()
      : []
  const paperIds = papers.map((p) => p.id)

  const paperQuestions =
    paperIds.length > 0
      ? await db
          .selectFrom('paper_questions')
          .selectAll()
          .where('paper_id', 'in', paperIds)
          .execute()
      : []

  const attempts =
    studentIds.length > 0
      ? await db.selectFrom('attempts').selectAll().where('student_id', 'in', studentIds).execute()
      : []
  const attemptIds = attempts.map((a) => a.id)

  const attemptAnswers =
    attemptIds.length > 0
      ? await db
          .selectFrom('attempt_answers')
          .selectAll()
          .where('attempt_id', 'in', attemptIds)
          .execute()
      : []

  const evaluations =
    attemptIds.length > 0
      ? await db
          .selectFrom('evaluations')
          .selectAll()
          .where('attempt_id', 'in', attemptIds)
          .execute()
      : []
  const evaluationIds = evaluations.map((e) => e.id)

  const evaluationItems =
    evaluationIds.length > 0
      ? await db
          .selectFrom('evaluation_items')
          .selectAll()
          .where('evaluation_id', 'in', evaluationIds)
          .execute()
      : []

  const habitObservations =
    evaluationIds.length > 0
      ? await db
          .selectFrom('habit_observations')
          .selectAll()
          .where('evaluation_id', 'in', evaluationIds)
          .execute()
      : []

  const conceptMastery =
    studentIds.length > 0
      ? await db
          .selectFrom('concept_mastery')
          .selectAll()
          .where('student_id', 'in', studentIds)
          .execute()
      : []

  const conceptStatus =
    studentIds.length > 0
      ? await db
          .selectFrom('concept_status')
          .selectAll()
          .where('student_id', 'in', studentIds)
          .execute()
      : []

  const remediationTasks =
    studentIds.length > 0
      ? await db
          .selectFrom('remediation_tasks')
          .selectAll()
          .where('student_id', 'in', studentIds)
          .execute()
      : []

  const studyPlans =
    studentIds.length > 0
      ? await db
          .selectFrom('study_plans')
          .selectAll()
          .where('student_id', 'in', studentIds)
          .execute()
      : []

  const uploads =
    studentIds.length > 0
      ? await db.selectFrom('uploads').selectAll().where('student_id', 'in', studentIds).execute()
      : []

  const consents = await db
    .selectFrom('consents')
    .selectAll()
    .where('household_id', '=', householdId)
    .execute()

  const auditLog = await db
    .selectFrom('audit_log')
    .selectAll()
    .where('household_id', '=', householdId)
    .execute()

  const aiJobs = await db
    .selectFrom('ai_jobs')
    .selectAll()
    .where('household_id', '=', householdId)
    .execute()

  return {
    exported_at: new Date().toISOString(),
    notes:
      'PDF bytes and uploaded scan files are not bundled -- papers/reports are rendered on ' +
      'demand rather than stored as retrievable files, and there is no real scan storage yet.',
    household,
    users,
    students,
    papers,
    paper_questions: paperQuestions,
    attempts,
    attempt_answers: attemptAnswers,
    evaluations,
    evaluation_items: evaluationItems,
    habit_observations: habitObservations,
    concept_mastery: conceptMastery,
    concept_status: conceptStatus,
    remediation_tasks: remediationTasks,
    study_plans: studyPlans,
    uploads,
    consents,
    audit_log: auditLog,
    ai_jobs: aiJobs,
  }
}

/**
 * F098's "hard delete" half -- a deliberate, DPDP-driven exception to CLAUDE.md invariant 4
 * ("nothing is deleted"). Every table that matters here already cascades from households.id (or
 * transitively from students.id, which itself cascades from households.id), so one DELETE
 * genuinely erases the whole household -- verified against the actual migrations, not assumed.
 * Logs to deletion_log FIRST, in a table that does not reference households.id, so the erasure
 * audit trail survives the very delete it's recording.
 */
export async function deleteHouseholdData(
  db: Db,
  input: { householdId: string; householdName: string; requestedByUserId: string },
) {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('deletion_log')
      .values({
        household_id: input.householdId,
        household_name: input.householdName,
        requested_by_user_id: input.requestedByUserId,
      })
      .execute()

    await trx.deleteFrom('households').where('id', '=', input.householdId).execute()
  })
}

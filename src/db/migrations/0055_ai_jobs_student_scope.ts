import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F091: "dashboard by day, feature and student" needs a student_id column ai_jobs never had.
// household_id also has to become nullable -- AI-01 (bank question generation, F025/F116) is
// admin/global content authoring with no household or student attached at all, unlike AI-05
// (grading) and AI-09 (remediation) which always run inside one household's evaluation of one
// student. Reporting that AI-01 spend as null/"system" rather than forcing a fake household is
// the same "shortfalls are reported, never hidden" spirit CLAUDE.md already applies elsewhere.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('ai_jobs')
    .alterColumn('household_id', (col) => col.dropNotNull())
    .execute()

  await db.schema
    .alterTable('ai_jobs')
    .addColumn('student_id', 'uuid', (col) =>
      col.references('students.id').onDelete('cascade'),
    )
    .execute()

  await db.schema
    .createIndex('ai_jobs_student_created_idx')
    .on('ai_jobs')
    .columns(['student_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('ai_jobs_feature_created_idx')
    .on('ai_jobs')
    .columns(['feature', 'created_at'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('ai_jobs_feature_created_idx').execute()
  await db.schema.dropIndex('ai_jobs_student_created_idx').execute()
  await db.schema.alterTable('ai_jobs').dropColumn('student_id').execute()
  await sql`delete from ai_jobs where household_id is null`.execute(db)
  await db.schema
    .alterTable('ai_jobs')
    .alterColumn('household_id', (col) => col.setNotNull())
    .execute()
}

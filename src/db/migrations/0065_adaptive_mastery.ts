import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// Student profile setup plus the concept-level adaptive layer.
//
// concept_answer_log is the append-only source of truth: one row per question per confirmed
// evaluation. student_concept_performance is derived from it and can always be rebuilt, and
// mastery_history keeps every score the student ever had so "why is she at this level?" can be
// answered later (CLAUDE.md invariant 4: nothing is deleted, evaluations and the ledger append-only).
// The app never deletes any of it. The foreign keys cascade only so that the integration tests,
// which hard-delete their own fixtures, can still clean up after themselves.
export async function up(db: Kysely<any>): Promise<void> {
  // A student must finish profile setup once. Everyone who already exists is treated as done.
  await db.schema.alterTable('students').addColumn('profile_completed_at', 'timestamptz').execute()
  await sql`update students set profile_completed_at = created_at`.execute(db)

  await db.schema
    .createTable('student_subjects')
    .addColumn('student_id', 'uuid', (col) => col.notNull().references('students.id').onDelete('cascade'))
    .addColumn('subject_id', 'uuid', (col) => col.notNull().references('subjects.id').onDelete('cascade'))
    // Deselecting a subject switches it off; the row is never deleted.
    .addColumn('is_active', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('student_subjects_pkey', ['student_id', 'subject_id'])
    .execute()

  // Existing students already work on Mathematics of their class and board.
  await sql`
    insert into student_subjects (student_id, subject_id)
    select st.id, su.id from students st
    join subjects su on su.board = st.board and su.class = st."class"
    where su.code = 'MATH'
  `.execute(db)

  // Subjects a student can pick, besides Mathematics. They have no chapters yet, so the profile
  // screen marks them "content coming soon". Admin can edit or switch them off.
  for (const [code, name] of [
    ['SCI', 'Science'],
    ['ENG', 'English'],
    ['SST', 'Social Science'],
  ]) {
    await sql`
      insert into subjects (board, "class", name, code, language, is_active)
      select 'CBSE', 7, ${name}::text, ${code}::text, 'English', true
      where not exists (
        select 1 from subjects where board = 'CBSE' and "class" = 7 and code = ${code}::text
      )
    `.execute(db)
  }

  await db.schema
    .createTable('mastery_settings')
    .addColumn('key', 'text', (col) => col.primaryKey())
    .addColumn('value', 'jsonb', (col) => col.notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_by', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .execute()

  await db.schema
    .createTable('concept_answer_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('student_id', 'uuid', (col) => col.notNull().references('students.id').onDelete('cascade'))
    .addColumn('concept_id', 'uuid', (col) => col.notNull().references('concepts.id').onDelete('cascade'))
    .addColumn('question_id', 'uuid', (col) => col.notNull().references('questions.id').onDelete('cascade'))
    .addColumn('evaluation_id', 'uuid', (col) => col.notNull().references('evaluations.id').onDelete('cascade'))
    .addColumn('paper_question_id', 'uuid', (col) =>
      col.notNull().references('paper_questions.id').onDelete('cascade'),
    )
    // 1 Easy, 2 Medium, 3 Hard, 4 Master (derived from bloom and difficulty, see adaptive/levels.ts).
    .addColumn('level', 'smallint', (col) => col.notNull().check(sql`level between 1 and 4`))
    .addColumn('marks_awarded', 'numeric', (col) => col.notNull())
    .addColumn('marks_max', 'numeric', (col) => col.notNull())
    .addColumn('credit', 'numeric', (col) => col.notNull().check(sql`credit between 0 and 1`))
    .addColumn('time_spent_sec', 'integer')
    .addColumn('answered_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('concept_answer_log_eval_pq_key', ['evaluation_id', 'paper_question_id'])
    .execute()
  await db.schema
    .createIndex('concept_answer_log_student_concept_idx')
    .on('concept_answer_log')
    .columns(['student_id', 'concept_id', 'answered_at'])
    .execute()

  await db.schema
    .createTable('student_concept_performance')
    .addColumn('student_id', 'uuid', (col) => col.notNull().references('students.id').onDelete('cascade'))
    .addColumn('concept_id', 'uuid', (col) => col.notNull().references('concepts.id').onDelete('cascade'))
    .addColumn('subject_id', 'uuid', (col) => col.notNull().references('subjects.id').onDelete('cascade'))
    .addColumn('chapter_id', 'uuid', (col) => col.notNull().references('chapters.id').onDelete('cascade'))
    .addColumn('mastery_score', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('mastery_level', 'text', (col) =>
      col
        .notNull()
        .defaultTo('Beginner')
        .check(sql`mastery_level in ('Beginner', 'Developing', 'Proficient', 'Advanced', 'Mastered')`),
    )
    .addColumn('questions_attempted', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('correct_answers', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('wrong_answers', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('accuracy', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('recent_accuracy', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('difficulty_score', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('consistency_score', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('current_difficulty', 'smallint', (col) =>
      col.notNull().defaultTo(1).check(sql`current_difficulty between 1 and 4`),
    )
    .addColumn('hard_questions_correct', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('master_questions_correct', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('consecutive_correct', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('consecutive_wrong', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('assessment_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('avg_response_sec', 'integer')
    .addColumn('last_assessed_at', 'timestamptz')
    .addColumn('retention_status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('not_applicable')
        .check(sql`retention_status in ('not_applicable', 'scheduled', 'lapsed')`),
    )
    .addColumn('retention_stage', 'smallint', (col) => col.notNull().defaultTo(0))
    .addColumn('next_retention_at', 'timestamptz')
    .addColumn('evidence_met', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('evidence_blockers', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('components', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('student_concept_performance_pkey', ['student_id', 'concept_id'])
    .execute()
  await db.schema
    .createIndex('student_concept_performance_subject_idx')
    .on('student_concept_performance')
    .columns(['student_id', 'subject_id'])
    .execute()
  await db.schema
    .createIndex('student_concept_performance_chapter_idx')
    .on('student_concept_performance')
    .columns(['student_id', 'chapter_id'])
    .execute()

  await db.schema
    .createTable('mastery_history')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('student_id', 'uuid', (col) => col.notNull().references('students.id').onDelete('cascade'))
    .addColumn('concept_id', 'uuid', (col) => col.notNull().references('concepts.id').onDelete('cascade'))
    .addColumn('evaluation_id', 'uuid', (col) => col.notNull().references('evaluations.id').onDelete('cascade'))
    .addColumn('mastery_score', 'numeric', (col) => col.notNull())
    .addColumn('mastery_level', 'text', (col) => col.notNull())
    .addColumn('current_difficulty', 'smallint', (col) => col.notNull())
    .addColumn('questions_attempted', 'integer', (col) => col.notNull())
    .addColumn('accuracy', 'numeric', (col) => col.notNull())
    .addColumn('recent_accuracy', 'numeric', (col) => col.notNull())
    .addColumn('difficulty_score', 'numeric', (col) => col.notNull())
    .addColumn('consistency_score', 'numeric', (col) => col.notNull())
    .addColumn('evidence_met', 'boolean', (col) => col.notNull())
    .addColumn('components', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('mastery_history_eval_concept_key', ['evaluation_id', 'concept_id'])
    .execute()
  await db.schema
    .createIndex('mastery_history_student_concept_idx')
    .on('mastery_history')
    .columns(['student_id', 'concept_id', 'created_at'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mastery_history').execute()
  await db.schema.dropTable('student_concept_performance').execute()
  await db.schema.dropTable('concept_answer_log').execute()
  await db.schema.dropTable('mastery_settings').execute()
  await db.schema.dropTable('student_subjects').execute()
  await sql`delete from subjects where board = 'CBSE' and "class" = 7 and code in ('SCI', 'ENG', 'SST')
    and not exists (select 1 from chapters where chapters.subject_id = subjects.id)`.execute(db)
  await db.schema.alterTable('students').dropColumn('profile_completed_at').execute()
}

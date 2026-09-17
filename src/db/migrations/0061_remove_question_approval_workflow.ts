import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// User decision 2026-09-17: remove the question approval workflow entirely (F117, and the
// review-queue half of F084/F025/F022). Every question is now usable the moment it is created --
// createQuestion() (src/lib/questions.ts) no longer computes a review tier or ever produces
// 'draft'. A retired/bad question is still pulled from the pool via the existing Retire button
// (F118), which is unrelated to this workflow and is untouched.
//
// CLAUDE.md invariant 4 ("nothing is deleted") is about rows, not columns -- no question row is
// deleted here. Every existing 'draft' question is promoted to 'approved' rather than discarded,
// since "draft" no longer has a meaning distinct from "approved" once nothing gates on it.
export async function up(db: Kysely<any>): Promise<void> {
  await db
    .updateTable('questions')
    .set({ status: 'approved' })
    .where('status', '=', 'draft')
    .execute()

  await db.schema
    .alterTable('questions')
    .alterColumn('status', (col) => col.setDefault('approved'))
    .execute()

  await db.schema
    .alterTable('questions')
    .dropColumn('review_tier')
    .dropColumn('review_note')
    .dropColumn('reviewed_by')
    .dropColumn('reviewed_at')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('questions')
    .alterColumn('status', (col) => col.setDefault('draft'))
    .execute()

  await db.schema
    .alterTable('questions')
    .addColumn('review_tier', 'text', (col) =>
      col
        .notNull()
        .defaultTo('B')
        .check(sql`review_tier in ('A', 'B')`),
    )
    .addColumn('review_note', 'text')
    .addColumn('reviewed_by', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('reviewed_at', 'timestamptz')
    .execute()
  // Note: the up() backfill (draft -> approved) is not reversed -- there is no way to know which
  // approved rows were originally draft.
}

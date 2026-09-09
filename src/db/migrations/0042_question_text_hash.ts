import type { Kysely } from 'kysely'
import { createHash } from 'node:crypto'

// F023: "exact-hash ... check on save." A normalized-text hash (kept in sync with
// src/lib/duplicate-detection.ts's computeTextHash -- duplicated inline here, not imported,
// since a migration must stay runnable even if that module's implementation changes later)
// stored per question, indexed per concept, so createQuestion() can cheaply look up "does this
// concept already have a question whose text hashes the same" without scanning full text.
function computeTextHash(text: string): string {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ')
  return createHash('sha256').update(normalized).digest('hex')
}

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('questions')
    .addColumn('text_hash', 'text')
    .execute()

  const questions = await db
    .selectFrom('questions')
    .select(['id', 'text'])
    .execute()
  for (const question of questions) {
    await db
      .updateTable('questions')
      .set({ text_hash: computeTextHash(question.text) })
      .where('id', '=', question.id)
      .execute()
  }

  await db.schema
    .alterTable('questions')
    .alterColumn('text_hash', (col) => col.setNotNull())
    .execute()

  await db.schema
    .createIndex('questions_concept_text_hash_idx')
    .on('questions')
    .columns(['concept_id', 'text_hash'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('questions_concept_text_hash_idx').execute()
  await db.schema.alterTable('questions').dropColumn('text_hash').execute()
}

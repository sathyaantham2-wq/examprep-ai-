import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const ERROR_TYPES = sql`('Conceptual Gap', 'Calculation Error', 'Presentation Issue', 'Formula/Definition Error', 'Incomplete', 'Not Attempted')`

// F047: "any mark or error type editable with the original AI value retained." ai_marks already
// preserves the AI-proposed mark separately from marks_awarded; error_type had no equivalent —
// once a human overrides it, the AI's original classification would be lost with no column to
// hold it. Also adds the fixed 6-category CHECK that error_type never had (F046).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('evaluation_items')
    .addColumn('ai_error_type', 'text')
    .execute()

  await db.schema
    .alterTable('evaluation_items')
    .addCheckConstraint(
      'evaluation_items_error_type_check',
      sql`error_type in ${ERROR_TYPES}`,
    )
    .execute()
  await db.schema
    .alterTable('evaluation_items')
    .addCheckConstraint(
      'evaluation_items_ai_error_type_check',
      sql`ai_error_type in ${ERROR_TYPES}`,
    )
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('evaluation_items')
    .dropConstraint('evaluation_items_error_type_check')
    .execute()
  await db.schema
    .alterTable('evaluation_items')
    .dropConstraint('evaluation_items_ai_error_type_check')
    .execute()
  await db.schema
    .alterTable('evaluation_items')
    .dropColumn('ai_error_type')
    .execute()
}

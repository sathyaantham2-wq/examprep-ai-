import type { Kysely } from 'kysely'
import { sql } from 'kysely'

const OLD_ERROR_TYPES = sql`('Conceptual Gap', 'Calculation Error', 'Presentation Issue', 'Formula/Definition Error', 'Incomplete', 'Not Attempted')`
const NEW_ERROR_TYPES = sql`('Conceptual Gap', 'Calculation Error', 'Presentation Issue', 'Formula/Definition Error', 'Incomplete', 'Not Attempted', 'Reading Discipline')`

// F060: "Reversal-word questions (NOT/least/false) tagged; wrong answers on them classified as
// reading discipline." A wrong answer caused by missing a NOT/least/false is a genuinely
// different disposition from the existing six error_type categories (all of which are about
// calculation/conceptual/presentation issues, not a reading-comprehension slip) -- this is a new
// category, not a reuse of an existing one, since conflating it with 'Conceptual Gap' would be
// exactly the "the fix is wrong" failure this feature exists to prevent (a reading slip doesn't
// need re-teaching the concept).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('questions')
    .addColumn('is_reversal_word', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .execute()

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
    .addCheckConstraint(
      'evaluation_items_error_type_check',
      sql`error_type in ${NEW_ERROR_TYPES}`,
    )
    .execute()
  await db.schema
    .alterTable('evaluation_items')
    .addCheckConstraint(
      'evaluation_items_ai_error_type_check',
      sql`ai_error_type in ${NEW_ERROR_TYPES}`,
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
    .addCheckConstraint(
      'evaluation_items_error_type_check',
      sql`error_type in ${OLD_ERROR_TYPES}`,
    )
    .execute()
  await db.schema
    .alterTable('evaluation_items')
    .addCheckConstraint(
      'evaluation_items_ai_error_type_check',
      sql`ai_error_type in ${OLD_ERROR_TYPES}`,
    )
    .execute()

  await db.schema
    .alterTable('questions')
    .dropColumn('is_reversal_word')
    .execute()
}

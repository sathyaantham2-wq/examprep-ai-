import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F121: "Daily and monthly caps per student on paper generation and evaluation ... parent can
// raise the cap." Both null by default -- enforceStudentSpendBudget (src/lib/ai-metering.ts)
// falls back to a documented default cap when null, and a parent overriding it is just a normal
// PATCH /api/students/:id write, not a separate "raised" flag.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('students')
    .addColumn('generation_daily_cap_inr', sql`numeric(10, 2)`)
    .addColumn('generation_monthly_cap_inr', sql`numeric(10, 2)`)
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('students')
    .dropColumn('generation_daily_cap_inr')
    .dropColumn('generation_monthly_cap_inr')
    .execute()
}

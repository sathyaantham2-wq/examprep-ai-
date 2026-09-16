import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F080: "unsubscribe honoured." A per-user opt-out flag (not per-household) since notifications
// table is already scoped by user_id, and a future multi-parent household should let each parent
// opt out independently. Defaults true so existing/new users keep getting notified until they
// explicitly opt out.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('email_notifications_enabled', 'boolean', (col) =>
      col.notNull().defaultTo(sql`true`),
    )
    .execute()

  // 'skipped' is distinct from 'failed': a skip (unsubscribed, or email not configured) is
  // expected, routine behaviour, not something worth alerting on the way a real send failure is.
  await sql`alter table notifications drop constraint notifications_status_check`.execute(db)
  await sql`alter table notifications add constraint notifications_status_check check (status in ('queued', 'sent', 'failed', 'read', 'skipped'))`.execute(
    db,
  )
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`alter table notifications drop constraint notifications_status_check`.execute(db)
  await sql`alter table notifications add constraint notifications_status_check check (status in ('queued', 'sent', 'failed', 'read'))`.execute(
    db,
  )
  await db.schema.alterTable('users').dropColumn('email_notifications_enabled').execute()
}

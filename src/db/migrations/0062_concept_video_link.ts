import type { Kysely } from 'kysely'

// F124: a curated remediation video link per concept, surfaced on the remediation hub (/remediation,
// F066-F070) next to the existing text refresher. Nullable and title-optional -- not every concept
// will have one curated yet, and buildRemediationPack/loadTaskView must degrade gracefully to no
// link rather than require it.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concepts')
    .addColumn('video_url', 'text')
    .addColumn('video_title', 'text')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('concepts')
    .dropColumn('video_url')
    .dropColumn('video_title')
    .execute()
}

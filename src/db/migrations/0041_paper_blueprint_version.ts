import type { Kysely } from 'kysely'

// F038: "every generated paper persisted with its question IDs and blueprint version." A paper
// already pins its exact questions (paper_questions rows never change once written), but its
// blueprint_id is a live FK -- if a blueprint is ever edited in place, an old paper's "blueprint"
// would silently mean whatever the blueprint looks like today, not what it looked like when the
// paper was generated. Snapshotting the version number the blueprint had at generation time
// closes that gap (no blueprint edit route exists yet, so this is forward-looking, not fixing an
// active bug).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('papers')
    .addColumn('blueprint_version', 'integer')
    .execute()

  const papers = await db
    .selectFrom('papers')
    .select(['id', 'blueprint_id'])
    .execute()
  for (const paper of papers) {
    const blueprint = await db
      .selectFrom('blueprints')
      .select('version')
      .where('id', '=', paper.blueprint_id)
      .executeTakeFirst()
    await db
      .updateTable('papers')
      .set({ blueprint_version: blueprint?.version ?? 1 })
      .where('id', '=', paper.id)
      .execute()
  }

  await db.schema
    .alterTable('papers')
    .alterColumn('blueprint_version', (col) => col.setNotNull())
    .execute()
  // Matches blueprints.version's own default (F013) -- a direct-insert caller that doesn't name
  // a blueprint explicitly (test fixtures, mainly) gets the same "version 1" a real blueprint
  // starts at, rather than an insert failure over a column most call sites don't care about.
  await db.schema
    .alterTable('papers')
    .alterColumn('blueprint_version', (col) => col.setDefault(1))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('papers').dropColumn('blueprint_version').execute()
}

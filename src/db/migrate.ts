import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promises as fs } from 'node:fs'
import { Migrator } from 'kysely/migration'
import type { Migration, MigrationProvider } from 'kysely/migration'
import 'dotenv/config'
import { createDb } from './connection'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationFolder = path.join(__dirname, 'migrations')

// Kysely's FileMigrationProvider passes raw OS paths to a dynamic import(), which Node's ESM
// loader rejects on Windows (absolute paths must be file:// URLs there). This provider does the
// same folder scan but resolves each path through pathToFileURL first.
class WindowsSafeFileMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    const migrations: Record<string, Migration> = {}
    const files = await fs.readdir(migrationFolder)

    for (const fileName of files) {
      if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) continue
      const fileUrl = pathToFileURL(path.join(migrationFolder, fileName)).href
      const migration = await import(fileUrl)
      const migrationKey = fileName.substring(0, fileName.lastIndexOf('.'))
      migrations[migrationKey] = migration
    }

    return migrations
  }
}

const direction = process.argv[2]
if (direction !== 'up' && direction !== 'down' && direction !== 'latest') {
  console.error('Usage: tsx src/db/migrate.ts <up|down|latest>')
  process.exit(1)
}

async function main() {
  const db = createDb()
  const migrator = new Migrator({
    db,
    provider: new WindowsSafeFileMigrationProvider(),
  })

  const { error, results } =
    direction === 'latest'
      ? await migrator.migrateToLatest()
      : direction === 'up'
        ? await migrator.migrateUp()
        : await migrator.migrateDown()

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`${direction}: ${result.migrationName} — ok`)
    } else if (result.status === 'Error') {
      console.error(`${direction}: ${result.migrationName} — failed`)
    }
  }

  await db.destroy()

  if (error) {
    console.error(error)
    process.exit(1)
  }
}

main()

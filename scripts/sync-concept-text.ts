/**
 * Brings the descriptive text of concepts that are already loaded (idea, rule, example) into line
 * with their authored file.
 *
 * load-authored-chapter.ts writes those fields only when it first creates a concept and never
 * touches them again, so a correction made to an authored file after loading (for example a worked
 * example that turned out to reuse a question's data set) would otherwise never reach the database.
 * Questions are not touched here. Safe to re-run: a concept whose text already matches is skipped.
 *
 *   npx tsx scripts/sync-concept-text.ts content/authoring/class12p/ch03.json [more files...]
 *   add --check to report what would change without writing.
 */
import { readFileSync } from 'node:fs'
import { createDb } from '../src/db/connection'

interface AuthoredFile {
  subject: { code: string }
  chapter: { part: string; chapter_no: number }
  concepts: Array<{ code: string; idea: string; rule: string; example: string }>
}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0) {
  console.error('usage: sync-concept-text.ts <authored chapter file>... [--check]')
  process.exit(1)
}

const db = createDb()
try {
  for (const path of files) {
    const file = JSON.parse(readFileSync(path, 'utf8')) as AuthoredFile
    const chapter = await db
      .selectFrom('chapters')
      .innerJoin('subjects', 'subjects.id', 'chapters.subject_id')
      .select('chapters.id')
      .where('subjects.code', '=', file.subject.code)
      .where('chapters.part', '=', file.chapter.part)
      .where('chapters.chapter_no', '=', file.chapter.chapter_no)
      .executeTakeFirst()
    if (!chapter) {
      console.log(`${path}: chapter not loaded yet, nothing to sync`)
      continue
    }
    let changed = 0
    for (const c of file.concepts) {
      const row = await db
        .selectFrom('concepts')
        .select(['id', 'idea', 'rule', 'example'])
        .where('chapter_id', '=', chapter.id)
        .where('code', '=', c.code)
        .executeTakeFirst()
      if (!row) continue
      if (row.idea === c.idea && row.rule === c.rule && row.example === c.example) continue
      changed += 1
      if (!checkOnly) {
        await db
          .updateTable('concepts')
          .set({ idea: c.idea, rule: c.rule, example: c.example })
          .where('id', '=', row.id)
          .execute()
      }
    }
    console.log(
      `${path}: ${changed} concept${changed === 1 ? '' : 's'} ${checkOnly ? 'would be updated' : 'updated'}`,
    )
  }
} finally {
  await db.destroy()
}

import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// F050-F053 + F097: a written paper, photographed page by page, read by a vision model.
//
// scan_pages holds each page image, encrypted by the app with AES-256-GCM (src/lib/scan-crypto.ts)
// before it reaches the database, so a database dump alone never contains a readable photo.
// Images are never served from a public path, only through a signed, short-lived, signed-in
// route. `image` is set to NULL once the page is purged (src/lib/scans.ts purgeExpiredScans, 30
// days after upload). The row stays so the answers keep saying which page they came from.
//
// scan_detections is one answer the model found on a page: the question label it read, the text
// (or MCQ option), its confidence and where on the page it is (for the side-by-side crop). Until
// the scan is applied these are working data, re-derived whenever a page is read again. Applying
// writes normal attempt_answers rows (source 'ocr') and the scan becomes read-only.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('scan_pages')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('attempt_id', 'uuid', (col) =>
      col.notNull().references('attempts.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('upload_id', 'uuid', (col) =>
      col.notNull().references('uploads.id').onDelete('cascade'),
    )
    .addColumn('page_number', 'integer', (col) => col.notNull())
    .addColumn('mime', 'text', (col) => col.notNull())
    .addColumn('size_bytes', 'integer', (col) => col.notNull())
    // iv (12 bytes) + auth tag (16 bytes) + ciphertext. NULL once purged.
    .addColumn('image', 'bytea')
    .addColumn('extracted_at', 'timestamptz')
    .addColumn('extraction_error', 'text')
    .addColumn('uploaded_by_user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('purged_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('scan_pages_attempt_idx')
    .on('scan_pages')
    .columns(['attempt_id', 'page_number'])
    .execute()
  await db.schema
    .createIndex('scan_pages_purge_idx')
    .on('scan_pages')
    .column('created_at')
    .where(sql.ref('purged_at'), 'is', null)
    .execute()

  await db.schema
    .createTable('scan_detections')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn('attempt_id', 'uuid', (col) =>
      col.notNull().references('attempts.id').onDelete('cascade'),
    )
    .addColumn('student_id', 'uuid', (col) =>
      col.notNull().references('students.id').onDelete('cascade'),
    )
    .addColumn('scan_page_id', 'uuid', (col) =>
      col.notNull().references('scan_pages.id').onDelete('cascade'),
    )
    // What the model read as the question number, e.g. "7" or "7 OR", kept as written.
    .addColumn('detected_label', 'text', (col) => col.notNull())
    .addColumn('paper_question_id', 'uuid', (col) =>
      col.references('paper_questions.id').onDelete('cascade'),
    )
    .addColumn('response_text', 'text')
    .addColumn('selected_option', 'text')
    .addColumn('confidence', sql`numeric(4, 3)`, (col) => col.notNull())
    // {x, y, w, h} as fractions of the page, 0..1. NULL when the model gave no usable box.
    .addColumn('bbox', 'jsonb')
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .check(
          sql`status in ('mapped', 'unmapped', 'duplicate', 'confirmed', 'discarded')`,
        ),
    )
    .addColumn('confirmed_by_user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('scan_detections_attempt_idx')
    .on('scan_detections')
    .column('attempt_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('scan_detections').execute()
  await db.schema.dropTable('scan_pages').execute()
}

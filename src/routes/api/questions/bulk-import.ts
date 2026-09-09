import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { bulkImportQuestions } from '../../../lib/bulk-import'

// tab05: POST /api/questions/bulk-import, Admin, request "file (csv/json)" -> "imported count +
// rejected rows with reasons". multipart/form-data with a `file` field, same shape as
// POST /api/uploads; format is inferred from the filename extension unless a `format` field
// overrides it.
export const Route = createFileRoute('/api/questions/bulk-import')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireRole(request, 'admin')
        if (auth instanceof Response) return auth

        let formData: FormData
        try {
          formData = await request.formData()
        } catch {
          return Response.json(
            { error: 'Expected multipart/form-data with a file field' },
            { status: 400 },
          )
        }

        const file = formData.get('file')
        if (!(file instanceof File)) {
          return Response.json(
            { error: 'A file field is required' },
            { status: 400 },
          )
        }

        const formatField = formData.get('format')
        const format =
          typeof formatField === 'string' &&
          (formatField === 'csv' || formatField === 'json')
            ? formatField
            : file.name.toLowerCase().endsWith('.json')
              ? 'json'
              : 'csv'

        const content = await file.text()

        const db = createDb()
        try {
          const result = await bulkImportQuestions(db, content, format, auth.id)
          return Response.json(result, { status: 201 })
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : 'Import failed' },
            { status: 400 },
          )
        } finally {
          await db.destroy()
        }
      },
    },
  },
})

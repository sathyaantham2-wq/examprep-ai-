import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { getSharedDb } from '../../../../db/connection'
import { studentsRepository } from '../../../../db/repositories'
import {
  getStudentProfile,
  listProfileOptions,
  profileInputSchema,
  saveStudentProfile,
} from '../../../../lib/student-profile'
import { wrapRouteHandlers } from '../../../../lib/error-log'

// The signed-in student's own profile and the class / syllabus / subject choices offered to her.
// Deliberately does not use resolveEnabledStudent: a student whose access is paused must still be
// told so by the other screens, but reading her own profile is harmless.
export const Route = createFileRoute('/api/students/me/profile')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const db = getSharedDb()
        const student = await studentsRepository.findByUserId(db, auth.id)
        if (!student) return new Response(null, { status: 403 })
        const [profile, options] = await Promise.all([
          getStudentProfile(db, student.id),
          listProfileOptions(db),
        ])
        return Response.json({ profile, options })
      },
      PUT: async ({ request }) => {
        const auth = await requireRole(request, 'student')
        if (auth instanceof Response) return auth
        const parsed = profileInputSchema.safeParse(await request.json())
        if (!parsed.success) {
          return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        }
        const db = getSharedDb()
        const student = await studentsRepository.findByUserId(db, auth.id)
        if (!student) return new Response(null, { status: 403 })
        const result = await saveStudentProfile(db, student.id, parsed.data)
        if (!result.ok) return Response.json({ error: result.error }, { status: 400 })
        return Response.json(result.profile)
      },
    },
  },
})

wrapRouteHandlers(Route, '/api/students/me/profile', ['GET', 'PUT'])

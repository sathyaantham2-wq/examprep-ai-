import { createFileRoute } from '@tanstack/react-router'
import { requireUser } from '../../../lib/session'
import { createDb } from '../../../db/connection'
import { subjectsRepository } from '../../../db/repositories'

export const Route = createFileRoute('/api/syllabus/subjects')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await requireUser(request)
        if (auth instanceof Response) return auth

        const url = new URL(request.url)
        const board = url.searchParams.get('board')
        const classParam = url.searchParams.get('class')
        if (!board || !classParam) {
          return Response.json(
            { error: 'board and class query params are required' },
            {
              status: 400,
            },
          )
        }
        const classNum = Number(classParam)
        if (!Number.isInteger(classNum)) {
          return Response.json(
            { error: 'class must be an integer' },
            { status: 400 },
          )
        }

        const db = createDb()
        try {
          const subjects = await subjectsRepository.listByBoardClass(
            db,
            board,
            classNum,
          )
          return Response.json(subjects)
        } finally {
          await db.destroy()
        }
      },
    },
  },
})

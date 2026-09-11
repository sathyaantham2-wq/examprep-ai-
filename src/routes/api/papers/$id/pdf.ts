import { createFileRoute } from '@tanstack/react-router'
import { requireRole } from '../../../../lib/session'
import { createDb } from '../../../../db/connection'
import {
  papersRepository,
  paperQuestionsRepository,
  studentsRepository,
  chaptersRepository,
  questionOptionsRepository,
  questionStepMarksRepository,
} from '../../../../db/repositories'
import { renderHtmlToPdf } from '../../../../lib/pdf/render'
import { buildPaperHtml } from '../../../../lib/pdf/paper-template'
import { buildAnswerKeyHtml } from '../../../../lib/pdf/key-template'
import { computeCoverageTable } from '../../../../lib/pdf/coverage'
import { extractStyleAndBody } from '../../../../lib/pdf/html-utils'

// tab05: GET /api/papers/:id/pdf, Parent, query (theme, include_key) -> application/pdf stream.
// Parent-only (same as GET /api/papers/:id) is what actually enforces "a student can never see or
// download an answer key" here -- include_key=true is only ever reachable by a parent/admin
// session, never a student one, so there is no path from this route to a student-visible key.
export const Route = createFileRoute('/api/papers/$id/pdf')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await requireRole(request, 'parent', 'admin')
        if (auth instanceof Response) return auth

        const url = new URL(request.url)
        const includeKey = url.searchParams.get('include_key') === 'true'
        // F034/F120 (theme packs) aren't built -- every theme renders as the one "Plain" layout
        // that exists today. The query param is accepted per tab05's contract, not yet acted on.

        const db = createDb()
        try {
          const paper = await papersRepository.findByIdForHousehold(
            db,
            auth.householdId,
            params.id,
          )
          if (!paper) return new Response(null, { status: 404 })

          const [student, slots, chapters] = await Promise.all([
            studentsRepository.findById(db, auth.householdId, paper.student_id),
            paperQuestionsRepository.listForPaperWithQuestions(db, paper.id),
            chaptersRepository.listByIds(db, paper.chapter_ids),
          ])
          if (!student) return new Response(null, { status: 404 })

          const optionsByQuestion = new Map(
            await Promise.all(
              slots.map(
                async (s) =>
                  [
                    s.question_id,
                    await questionOptionsRepository.listByQuestion(
                      db,
                      s.question_id,
                    ),
                  ] as const,
              ),
            ),
          )

          const shortfalls = paper.shortfalls
            ? (paper.shortfalls as Array<{ section: string; reason: string }>)
            : []

          const paperHtml = buildPaperHtml({
            title: paper.title,
            studentName: student.name,
            board: student.board,
            class: student.class,
            durationMin: paper.duration_min,
            totalMarks: paper.total_marks,
            chapters: chapters.map((c) => ({
              part: c.part,
              chapter_no: c.chapter_no,
              name: c.name,
            })),
            questions: slots.map((s) => ({
              id: s.id,
              section: s.section,
              position: s.position,
              marks: s.marks,
              bloom: s.bloom,
              difficulty: s.difficulty,
              type: s.type,
              text: s.text,
              diagram_kind: s.diagram_kind,
              diagram_params: s.diagram_params,
              options: (optionsByQuestion.get(s.question_id) ?? []).map(
                (o) => ({
                  label: o.label,
                  text: o.text,
                  order_index: o.order_index,
                }),
              ),
            })),
            shortfalls,
          })

          let finalHtml = paperHtml

          if (includeKey) {
            const stepMarksByQuestion = new Map(
              await Promise.all(
                slots.map(
                  async (s) =>
                    [
                      s.question_id,
                      await questionStepMarksRepository.listByQuestion(
                        db,
                        s.question_id,
                      ),
                    ] as const,
                ),
              ),
            )
            const coverage = await computeCoverageTable(db, paper.id)

            const keyHtml = buildAnswerKeyHtml({
              title: paper.title,
              questions: slots.map((s) => {
                const options = optionsByQuestion.get(s.question_id) ?? []
                const correctOption = options.find((o) => o.is_correct)
                return {
                  position: s.position,
                  section: s.section,
                  marks: s.marks,
                  type: s.type,
                  text: s.text,
                  answer: s.answer,
                  diagram_kind: s.diagram_kind,
                  diagram_params: s.diagram_params,
                  correctOptionLabel: correctOption?.label ?? null,
                  stepMarks: (stepMarksByQuestion.get(s.question_id) ?? []).map(
                    (sm) => ({
                      step_no: sm.step_no,
                      description: sm.description,
                      marks: sm.marks,
                    }),
                  ),
                }
              }),
              coverage,
            })

            // Combined into one document (this route only ever returns one PDF stream, per
            // tab05's contract) but the key content is appended as a distinct trailing section
            // behind its own page break, never interleaved with the paper's own questions -- and
            // this whole branch is unreachable without a parent/admin session, so a student-facing
            // request (the only kind that matters for "never see an answer key") never sees it.
            const paperParts = extractStyleAndBody(paperHtml)
            const keyParts = extractStyleAndBody(keyHtml)
            finalHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${paperParts.style}\n${keyParts.style}</style>
</head>
<body>
${paperParts.body}
<div style="page-break-before: always;"></div>
${keyParts.body}
</body>
</html>`
          }

          const pdf = await renderHtmlToPdf(finalHtml)
          return new Response(new Uint8Array(pdf), {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': `inline; filename="${paper.id}.pdf"`,
            },
          })
        } finally {
          await db.destroy()
        }
      },
    },
  },
})

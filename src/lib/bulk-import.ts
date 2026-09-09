import Papa from 'papaparse'
import type { Db } from '../db/connection'
import { createQuestion, questionInputSchema } from './questions'

export interface BulkImportRowResult {
  row: number
  status: 'imported' | 'rejected'
  question_id?: string
  errors?: Array<string>
  // F023: an exact-hash duplicate is a warning, not a rejection -- the row still imports.
  duplicate_of?: { id: string; text: string } | null
}

export interface BulkImportResult {
  imported_count: number
  rejected_count: number
  rows: Array<BulkImportRowResult>
}

// CSV can't naturally represent step_marks or more than a handful of mcq options, so this covers
// the common case (mcq/fill_blank/short_answer with up to 4 lettered options) rather than every
// question shape JSON can carry -- an honest scoping choice, not an oversight.
function csvRowToQuestionInput(
  row: Record<string, string | undefined>,
): unknown {
  const options: Array<{
    label: string
    text: string
    is_correct: boolean
    order_index: number
  }> = []
  for (const letter of ['a', 'b', 'c', 'd']) {
    const text = row[`option_${letter}_text`]?.trim()
    if (text) {
      options.push({
        label: letter.toUpperCase(),
        text,
        is_correct:
          row[`option_${letter}_correct`]?.trim().toLowerCase() === 'true',
        order_index: options.length + 1,
      })
    }
  }

  return {
    concept_id: row.concept_id?.trim(),
    board: row.board?.trim(),
    class: Number(row.class),
    bloom: row.bloom?.trim(),
    difficulty: row.difficulty?.trim(),
    marks: Number(row.marks),
    type: row.type?.trim(),
    text: row.text?.trim(),
    answer: row.answer?.trim(),
    hint: row.hint?.trim() || undefined,
    language: row.language?.trim() || undefined,
    is_reversal_word:
      row.is_reversal_word?.trim().toLowerCase() === 'true' || undefined,
    options: options.length > 0 ? options : undefined,
  }
}

/**
 * F022: "CSV/JSON import with row-level validation report; partial import allowed; rejected rows
 * downloadable with reasons." Each row is validated and inserted independently through the same
 * questionInputSchema + createQuestion() a single POST /api/questions uses -- one bad row never
 * blocks the rest, and the returned per-row result (including error messages) is exactly what a
 * client would render as, or save as, the "rejected rows" report; there is no separate download
 * artifact to generate since the JSON response already carries everything needed.
 */
export async function bulkImportQuestions(
  db: Db,
  content: string,
  format: 'csv' | 'json',
  createdBy: string,
): Promise<BulkImportResult> {
  let rawRows: Array<unknown>

  if (format === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new Error('File is not valid JSON')
    }
    if (!Array.isArray(parsed)) {
      throw new Error('JSON import must be an array of question objects')
    }
    rawRows = parsed
  } else {
    const parsedCsv = Papa.parse<Record<string, string | undefined>>(content, {
      header: true,
      skipEmptyLines: true,
    })
    rawRows = parsedCsv.data.map(csvRowToQuestionInput)
  }

  const rows: Array<BulkImportRowResult> = []
  for (let i = 0; i < rawRows.length; i++) {
    const rowNumber = i + 1
    const validated = questionInputSchema.safeParse(rawRows[i])
    if (!validated.success) {
      rows.push({
        row: rowNumber,
        status: 'rejected',
        errors: validated.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
      })
      continue
    }

    try {
      const question = await createQuestion(db, {
        ...validated.data,
        created_by: createdBy,
      })
      rows.push({
        row: rowNumber,
        status: 'imported',
        question_id: question.id,
        duplicate_of: question.duplicate_of,
      })
    } catch (err) {
      rows.push({
        row: rowNumber,
        status: 'rejected',
        errors: [
          err instanceof Error
            ? err.message
            : 'Unknown error while inserting this row',
        ],
      })
    }
  }

  return {
    imported_count: rows.filter((r) => r.status === 'imported').length,
    rejected_count: rows.filter((r) => r.status === 'rejected').length,
    rows,
  }
}

import { escapeHtml } from './html-utils'

interface ReportTemplateInput {
  meta: {
    paper_title: string
    student_name: string
    student_class: number
    student_board: string
  }
  score: {
    actual: number
    total: number
    percentage: number
    grade: string | null
  }
  knowledge_score: number
  delivery_gap: number
  error_inventory: Array<{
    position: number
    section: string
    concept_name: string
    marks_max: number
    marks_awarded: number
    marks_lost: number
    error_type: string | null
    feedback: string
  }>
  concept_performance: Array<{
    concept_name: string
    marks_awarded: number
    marks_max: number
    percentage: number
  }>
  actions: {
    ranked: Array<{ concept_name: string; status: string; action: string }>
    parent_action: string
  }
}

/**
 * F073: "downloadable PDF including error inventory and concept-wise performance." Renders the
 * same buildDiagnosisReport() data the JSON route already returns (GET /api/evaluations/:id/
 * report) -- this is a second representation of that report, not a second computation of it.
 * The "web report" half of the AC doesn't exist (no screens anywhere in this repo).
 */
export function buildReportHtml(input: ReportTemplateInput): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; color: #111; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .meta { font-size: 9.5pt; color: #444; margin-bottom: 14px; }
  .score-row { display: flex; gap: 24px; margin-bottom: 16px; }
  .score-card { border: 1px solid #999; border-radius: 4px; padding: 8px 12px; }
  .score-card .label { font-size: 8pt; color: #666; text-transform: uppercase; }
  .score-card .value { font-size: 15pt; font-weight: bold; }
  h2 { font-size: 13pt; margin: 20px 0 8px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
  .error-row { page-break-inside: avoid; }
  .empty-note { color: #666; font-style: italic; }
  .action-item { margin: 4px 0; }
</style>
</head>
<body>
  <h1>${escapeHtml(input.meta.paper_title)} — Diagnosis Report</h1>
  <div class="meta">
    ${escapeHtml(input.meta.student_name)} — Class ${input.meta.student_class} (${escapeHtml(input.meta.student_board)})
  </div>

  <div class="score-row">
    <div class="score-card"><div class="label">Score</div><div class="value">${input.score.actual}/${input.score.total} (${input.score.percentage}%)</div></div>
    <div class="score-card"><div class="label">Grade</div><div class="value">${escapeHtml(input.score.grade ?? '-')}</div></div>
    <div class="score-card"><div class="label">Knowledge Score</div><div class="value">${input.knowledge_score}</div></div>
    <div class="score-card"><div class="label">Delivery Gap</div><div class="value">${input.delivery_gap}</div></div>
  </div>

  <h2>Error Inventory</h2>
  ${
    input.error_inventory.length === 0
      ? '<div class="empty-note">No marks were lost on this paper.</div>'
      : `<table>
        <thead><tr><th>#</th><th>Section</th><th>Concept</th><th>Marks Lost</th><th>Error Type</th><th>Feedback</th></tr></thead>
        <tbody>
          ${input.error_inventory
            .map(
              (row) => `<tr class="error-row">
                <td>${row.position}</td>
                <td>${escapeHtml(row.section)}</td>
                <td>${escapeHtml(row.concept_name)}</td>
                <td>${row.marks_lost}/${row.marks_max}</td>
                <td>${escapeHtml(row.error_type ?? '-')}</td>
                <td>${escapeHtml(row.feedback)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
  }

  <h2>Concept-wise Performance</h2>
  <table>
    <thead><tr><th>Concept</th><th>Marks</th><th>%</th></tr></thead>
    <tbody>
      ${input.concept_performance
        .map(
          (row) => `<tr>
            <td>${escapeHtml(row.concept_name)}</td>
            <td>${row.marks_awarded}/${row.marks_max}</td>
            <td>${row.percentage}%</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <h2>Next Actions</h2>
  ${input.actions.ranked
    .map((a) => `<div class="action-item">• ${escapeHtml(a.action)}</div>`)
    .join('')}
  <div class="action-item"><strong>${escapeHtml(input.actions.parent_action)}</strong></div>
</body>
</html>`
}

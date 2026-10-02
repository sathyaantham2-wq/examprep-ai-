import type { SubjectView } from '../components/adaptive-overview'

/**
 * The text a student sends a parent from her mastery view (2026-10-02 request). A snapshot of
 * chapter mastery only: no paper, no marks, no answers, no email -- the student chooses to send
 * it, and what she sends is just this text. Chapters she has not been assessed in yet are left
 * out rather than shown as 0%, which would read as failure.
 */
export function masteryShareText(
  studentName: string,
  subjects: Array<SubjectView>,
): string {
  const lines: Array<string> = [`${studentName}'s chapter mastery on PrepPlan`]
  for (const subject of subjects) {
    const chapters = subject.chapters.filter((c) => c.average_mastery !== null)
    if (chapters.length === 0) continue
    lines.push('', subject.subject_name)
    for (const c of chapters) {
      const part = c.part === 'I' ? '' : `${c.part} `
      lines.push(
        `- ${part}Ch ${c.chapter_no} ${c.chapter_name}: ${Math.round(c.average_mastery ?? 0)}%`,
      )
    }
  }
  if (lines.length === 1) lines.push('', 'No chapters assessed yet.')
  return lines.join('\n')
}

export function whatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

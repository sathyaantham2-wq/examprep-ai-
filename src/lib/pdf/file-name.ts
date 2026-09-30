// A paper title turned into a safe download file name (no extension). ASCII letters and digits
// only: it goes into a Content-Disposition header, where non-ASCII characters are not allowed, so
// a title with none (e.g. an all-Telugu one) falls back to a generic name.
export function pdfFileName(title: string): string {
  const slug = title
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'question-paper'
}

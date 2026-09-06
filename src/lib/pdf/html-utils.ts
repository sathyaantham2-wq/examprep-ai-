// Question text/answers come from the question bank, not end-user input at request time, but
// escaping on the way into an HTML document that Chromium prints is still correct practice (and
// cheap insurance against a stray '<' or '&' in a maths expression breaking the layout).
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Pulls the <style> contents and body-inner content out of a full standalone document produced
 * by buildPaperHtml/buildAnswerKeyHtml, so two such documents can be combined into one PDF
 * (include_key=true) without nesting a second <html>/<head>/<body> inside the first.
 */
export function extractStyleAndBody(html: string): {
  style: string
  body: string
} {
  const styleMatch = /<style>([\s\S]*?)<\/style>/.exec(html)
  const bodyMatch = /<body>([\s\S]*?)<\/body>/.exec(html)
  if (!styleMatch || !bodyMatch) {
    throw new Error(
      'Expected a <style> and <body> block in the generated document',
    )
  }
  return { style: styleMatch[1], body: bodyMatch[1] }
}

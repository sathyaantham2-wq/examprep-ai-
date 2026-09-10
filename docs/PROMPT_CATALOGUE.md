# Prompt catalogue (F111)

Tab 07 of the plan spreadsheet specs 12 AI functions at design time. This catalogue documents the
3 that are actually implemented and wired into the app; the rest are unbuilt (mostly gated behind
modules explicitly skipped this session — M10 upload/OCR, M16 notifications — or not yet reached).
Every entry below traces to a real file; if the code and this doc ever disagree, the code is right
and this doc is stale — update it in the same PR that changes the prompt.

**Hard rule that applies to every entry here:** none of these calls ever writes a final, authoritative
value. Each one proposes into an `ai_*`-prefixed field or a cache table; a human confirmation step
(or, for remediation content, a deterministic cache-then-serve path) is what makes a value load-bearing.
See `CLAUDE.md` → "AI never finalises a mark."

## AI-01 — Question generation

- **File:** `src/lib/ai-question-generation.ts` (`generateQuestions()`)
- **Model:** `claude-sonnet-5`
- **Trigger:** `POST /api/questions/generate` (single concept/cell) and the bulk top-up job,
  F116 (`src/lib/generation-batches.ts`, one call per (concept × bloom × difficulty) cell).
- **Input contract:** concept name/description/rule/example, target Bloom level, difficulty tier,
  board/class, count needed.
- **Output contract:** JSON array of candidate questions (text, type, marks, answer, step marks for
  subjective items, MCQ options where applicable) — validated by the pure, unit-tested
  `validateCandidates()` before anything touches the DB.
- **Guardrails:** every candidate lands as `questions.status = 'draft'`, `origin = 'ai_generated'` —
  never `approved`. `text_hash` de-duplicates near-identical output across repeated calls.
  `isAiQuestionGenerationConfigured()` gates the call on `ANTHROPIC_API_KEY` being set.
- **Fallback (tab07):** "admin writes the question manually; queue stays draft" — i.e. nothing
  auto-approves, and a missing key is a visible unavailable-feature state, not a silent no-op.

## AI-05 — Subjective answer grading

- **File:** `src/lib/ai-grading.ts` (`gradeSubjectiveAnswer()`)
- **Model:** `claude-sonnet-5` ("strong model" tier per tab07 — same tier as question generation)
- **Trigger:** evaluation creation (`src/lib/evaluation.ts`'s `createEvaluation()`), one call per
  subjective paper question in an attempt.
- **Input contract:** question text, expected answer, marking scheme (per-step description +
  marks), the student's actual response text, optional concept context.
- **Output contract:** strict JSON — per-step marks awarded with a justification citing the marking
  scheme, one of 6 fixed `error_type` values (or null on full marks), one actionable feedback
  sentence (≤25 words, names the concept and the fix, no praise/scolding), a 0–1 confidence score.
  An `"unreadable": true` escape hatch is explicit in the contract — the model is told to use it
  rather than guess on a blank or illegible response.
- **Guardrails:** writes only to `evaluation_items.ai_marks` / `ai_error_type` — never to
  `marks_awarded` / `error_type`, which only `POST /api/evaluations/:id/confirm` can set, and only
  a `parent`/`admin`-role request can call that route. A malformed or unparseable model response
  degrades to `NEEDS_MANUAL_MARKING` (0 marks, `needsManualMarking: true`) rather than throwing or
  guessing.
- **Fallback:** `isAiGradingConfigured()` returns false when `ANTHROPIC_API_KEY` is unset; the
  caller marks the item as needing manual marking, same as the unparseable-response path.

## AI-XX — Remediation content generation

- **File:** `src/lib/ai-remediation.ts` (`generateRemediationContent()`)
- **Model:** `claude-sonnet-5`
- **Trigger:** F066/F068 remediation pack build (`src/lib/remediation.ts`), lazily — only the first
  time a given concept needs a refresher; cached forever after in `concept_remediation_content`.
- **Input contract:** concept name/idea/rule/example, board/class.
- **Output contract:** a short refresher explanation plus a small set of worked examples (JSON).
- **Guardrails:** this is explanatory content, not a mark or a tutor conversation — the product
  rule "never build a chat tutor that solves the problem" applies to how this content is *used*
  (a refresher on the concept, not a worked solution to the specific question the student got
  wrong) more than to this function itself.
- **Fallback:** documented in tab07 as "serve existing bank content" if generation is unavailable —
  i.e. a concept without cached remediation content and no API key simply has no refresher yet,
  rather than a broken page.

## Not built

Every other tab-07 AI function (OCR extraction/M10, WhatsApp digest copy/M16, adaptive study-plan
generation, Telugu translation, etc.) has no implementation yet — each is blocked on either a
skipped module (M10 needs Supabase storage + service-role credentials; M16 needs a transactional
email/WhatsApp provider) or hasn't been reached in the backlog. Do not assume any AI-numbered
function not listed above exists — check this file or the module status before referencing one.

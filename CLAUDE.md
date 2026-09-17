# ExamPrep AI — project memory

Read this before doing anything in this repo.

## What this product is

A web app that generates syllabus-exact question papers for one school student, evaluates her
attempt question by question, and diagnoses whether each lost mark was a **knowledge gap** or a
**delivery habit**. The parent is the primary user; the student is secondary.

The one-line test for any feature: *does it help answer "which marks did she lose because she
didn't know it, and which because she stopped writing too early?"* If not, it is out of scope.

**Launch scope:** CBSE Class 7 Mathematics, NCERT *Ganita Prakash* (Part I ch 1–8, Part II ch 1–7).
Classes 6–12 and other subjects follow later — see `docs/` tab 17.

## The plan lives in a spreadsheet

`docs/ExamPrep_AI_Module_Development_Plan.xlsx` is the source of truth for scope. 17 tabs:

| Tab | Use it for |
|---|---|
| 02 Module Master | The 22 modules, effort, % complete |
| 03 Feature Backlog | **122 features (F001–F122)** with user story + acceptance criteria. Work is picked from here. |
| 04 Data Model | 26 tables — build before UI |
| 05 API Endpoints | 38 routes with auth level |
| 06 Screens & Routes | 24 screens |
| 07 AI Layer | 12 AI functions: model tier, output contract, guardrails, fallback |
| 12 QA & Test Plan | 22 test scenarios (T01–T22) |
| 16 / 17 | Question bank depth and rollout sequence |

Never invent a feature ID. If work doesn't map to an existing F-number, say so and ask.

## Architecture invariants — violating these is expensive to undo

1. **Chapter identity is `(book, part, chapter_number)` — never the number alone.**
   Ganita Prakash Class 7 has two Chapter 3s and two Chapter 6s. Part I ch 3 is
   "A Peek Beyond the Point"; Part II ch 4 is "Another Peek Beyond the Point". A schema keyed on a
   bare number corrupts the moment Part II loads.

2. **`board` and `class` are first-class columns everywhere** — concepts, questions, blueprints.
   Adding Class 8 must be a data load, not a migration. Never hardcode "Class 7" in a route,
   a prompt, a PDF header or a seed file.

3. **Question depth is configuration, not a constant.** `target_question_count` lives per concept
   with subject/class defaults. Generation is a *top-up* job (target minus current approved count
   per Bloom×difficulty cell), idempotent and safe to re-run. Launch target is 20/concept.

4. **Nothing is deleted.** A question is either Approved (usable immediately on creation — there is
   no draft/review gate, removed 2026-09-17 at the user's explicit request) or Retired (pulled from
   the pool, never hard-deleted). Evaluations and the concept ledger are append-only so history
   stays auditable years later.

5. **Every question traces to an in-scope concept.** A question cannot exist without a concept, and
   a concept cannot exist without a chapter scope record citing the textbook and page range.

## Hard rules

- **AI never finalises a mark.** It proposes marks with per-step justification; a human confirms.
  The concept tracker only ever consumes confirmed values. (Tab 07 AI-05, tab 03 F047.)
- **The student role can never see or download an answer key**, override a mark, or read another
  student's data. Enforced server-side, not by hiding a button. (T09.)
- **Never build a chat tutor that solves the problem.** Withholding the answer is the product.
- **Paper themes use original artwork only.** "Manga" is a genre and is fine to evoke; named
  franchises, their characters, logos and typefaces are not. The doodle theme is called
  **Doodle Journal** — never reference *Diary of a Wimpy Kid* in code, comments, assets or prompts.
- **Difficulty is a ceiling, not a filter on weakness.** Whatever tier the student picks, the 40%
  weak/priority concept weighting still applies. (F119.)
- **Shortfalls are reported, never hidden.** If the bank can't fill a blueprint slot, generate the
  paper anyway with a printed note naming the concept and cell that came up short. (F032.)

## Stack

TanStack Start (React 19) · TypeScript strict · Tailwind v4 + shadcn/ui · Postgres (Neon or
Supabase) · Kysely · better-auth · Vercel. Server-side HTML→PDF for papers. See tab 09 for
rationale and rejected alternatives; do not swap a layer without updating that tab.

## Conventions

- Concept codes: `C7M-3.2` = Class 7, Maths, chapter 3, concept 2. Namespaced by class + subject.
- Question IDs: `Q7M-3.2-001`.
- Source file codes are the real NCERT codes (`gegp101`…`gegp207`). Store them on the chapter row.
- Commits reference the feature: `feat(F033): server-side A4 PDF renderer`.
- Every PR that completes a feature updates column J in tab 03 to `Done`.

## Definition of done for a feature

1. Acceptance criteria in tab 03 are met literally.
2. The matching test in tab 12 passes, if one exists.
3. No cross-household data access is possible (T02 sweep still green).
4. Tab 03 column J updated.

## Available skills

Run `/examprep-ingest-source`, `/examprep-scope-authoring`, `/examprep-question-generation` or
`/examprep-build-feature`, or just describe the task — they trigger on their own.

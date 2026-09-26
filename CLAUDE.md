# ExamPrep AI — project memory

Read this before doing anything in this repo.

## What this product is

A web app that generates syllabus-exact question papers for one school student, evaluates her
attempt question by question, and diagnoses whether each lost mark was a **knowledge gap** or a
**delivery habit**. The parent is the primary user; the student is secondary.

The one-line test for any feature: *does it help answer "which marks did she lose because she
didn't know it, and which because she stopped writing too early?"* If not, it is out of scope.

**Launch scope:** CBSE Class 7 Mathematics, NCERT *Ganita Prakash* (Part I ch 1–8, Part II ch 1–7).
**Added 2026-09-20 at the user's request:** CBSE Class 9 Mathematics, NCERT *Ganita Manjari* Part I ch 1–8 (subject code `MATH9`, sources `iemh101`–`iemh108`, 6 concepts per chapter, 20 questions per concept, authored files in `content/authoring/class9/`). Part II of Class 9 is not loaded. **Also added 2026-09-20:** CBSE Class 9 Social Science, NCERT *Understanding Society: India and Beyond* Part 1 ch 1–9 (subject code `SST9`, sources `iest101`–`iest109`, concept codes `C9S-n.m`, authored files in `content/authoring/class9s/`). No F-number covers this yet. **Also added 2026-09-20/21:** CBSE Class 7 Science, NCERT *Curiosity: Textbook of Science* Grade 7 (subject code `SCI`, sources `gecu101`–`gecu112`, concept codes `C7SC-n.m`, authored files in `content/authoring/class7sc/`, variable concepts/chapter, 1420 questions total) — and CBSE Class 7 Social Science, NCERT *Exploring Society: India and Beyond* Parts 1–2 (subject code `SST`, sources `gees101`–`gees112` Part I and `gees201`–`gees208` Part II, concept codes `C7S-n.m`, authored files in `content/authoring/class7s/`, `p1chNN.json`/`p2chNN.json`, 2740 questions total). Both fully loaded to production; this paragraph was missing until 2026-09-25, when the gap was found during a scope check.
**Added 2026-09-23 at the user's request:** CBSE Class 8 Mathematics, NCERT *Ganita Prakash* Grade 8 (subject code `MATH8`, sources `hegp101`–`hegp107` for Part I and `hegp201`–`hegp207` for Part II, concept codes `C8M-n.m`, authored files in `content/authoring/class8/`, `chNN.json` for Part I and `p2chNN.json` for Part II). **Fully loaded as of 2026-09-24**: both parts, 14 chapters, 1680 questions. `hegp1ps.pdf`/`hegp2ps.pdf` are each part's front matter/prelims, not a problem-set appendix — correct that assumption if it resurfaces. **Added 2026-09-25:** CBSE Class 8 Science, NCERT *Curiosity: Textbook of Science* Grade 8 (subject code `SCI8`, sources `hecu101`–`hecu113`, concept codes `C8SC-n.m`, authored files in `content/authoring/class8sc/`). No Part I/II split — a single 13-chapter book, confirmed complete against the book's own Contents page. **Fully loaded as of 2026-09-25**: all 13 chapters, 1560 questions. No F-number covers this yet. **Also added 2026-09-25 at the user's request:** CBSE Class 9 Science, NCERT *Exploration: Textbook of Science* Grade 9 (subject code `SCI9`, sources `iesc101`–`iesc113`, concept codes `C9SC-n.m`, authored files in `content/authoring/class9sc/`). No Part I/II split — a single 13-chapter book, confirmed complete against the book's own Contents page. Note this book's title is *Exploration*, distinct from the Class 7/8 *Curiosity* books — don't assume the name carries across grades. **Fully loaded as of 2026-09-25**: all 13 chapters, 1720 questions. No F-number covers this yet. **Added 2026-09-26 at the user's request:** CBSE Class 6 Mathematics, NCERT *Ganita Prakash* Grade 6 (subject code `MATH6`, sources `fegp101`–`fegp110`, concept codes `C6M-n.m`, authored files in `content/authoring/class6/`). Single 10-chapter book, no Part I/II split. **Fully loaded as of 2026-09-26**: all 10 chapters, 1280 questions. **Also added 2026-09-26:** CBSE Class 6 Science, NCERT *Curiosity: Textbook of Science* Grade 6 (subject code `SCI6`, sources `fecu101`–`fecu112`, concept codes `C6SC-n.m`, authored files in `content/authoring/class6sc/`). Single 12-chapter book, no Part I/II split — confirmed via the book's own closing note. **Fully loaded as of 2026-09-26**: all 12 chapters, 1440 questions. **Also added 2026-09-26:** CBSE Class 6 Social Science, NCERT *Exploring Society: India and Beyond* Grade 6 (subject code `SST6`, sources `fees101`–`fees114`, concept codes `C6S-n.m`, authored files in `content/authoring/class6s/`, flat `chNN.json` naming). Single 14-chapter book across five Themes A–E, no Part I/II split — confirmed against the front matter's own Contents page (`fees1ps.pdf` p.19: 14 numbered chapters, then Glossary at p.209). Note chapters 10–12 are each subtitled "Grassroots Democracy — Part 1/2/3"; that is the *chapter's* own mini-series subtitle, not a book-level part, and `part` stays `"I"` for all 14. **Fully loaded as of 2026-09-26**: all 14 chapters, 85 concepts, 1700 questions (ch 4 carries 7 concepts, the rest 6 each). **Also added 2026-09-26 at the user's request:** CBSE Class 8 Social Science, NCERT *Exploring Society: India and Beyond* Grade 8 (subject code `SST8`, sources `hees101`–`hees107` Part I and `hees201`–`hees207` + `hees209` Part II, concept codes `C8S-n.m`, authored files in `content/authoring/class8s/`, `p1chNN.json`/`p2chNN.json` naming). Two-part book, 15 chapters total (Part I 7, Part II 8). Note `hees208` does not exist — Part II's chapter 8 file is genuinely named `hees209`, an NCERT file-naming quirk confirmed against the book's own Contents page, not a missing chapter. Part I and Part II each restart chapter numbering from 1 and deliberately reuse the same concept codes per chapter number (e.g. `C8S-1.m` exists in both parts, as distinct concept rows scoped by `chapter_id` per migration `0064_concept_code_unique_per_chapter.ts`) — this is the same pattern Class 7 Social already established, not a defect. **Fully loaded as of 2026-09-26**: all 15 chapters, 127 concepts, 2540 questions. No F-number covers any of this. The owner also supplied NCERT books for Class 10 under `New folder/` — Class 10 Maths (`jemh101`–`jemh114`, 14 chapters, standard "Mathematics" series not *Ganita Prakash*) and Class 10 Social (`jess101`–`jess107`, 7 chapters) remain unauthored. Note Class 10 Social as supplied is **Geography only** (*Contemporary India II*) — the other three books that normally make up a full Class 10 Social Science course (History, Political Science, Economics) were not supplied and are not in `New folder/`. No F-number covers any of this.
Other classes and subjects follow later — see `docs/` tab 17.

## The plan lives in a spreadsheet

`docs/ExamPrep_AI_Module_Development_Plan.xlsx` is the source of truth for scope. 17 tabs:

| Tab | Use it for |
|---|---|
| 02 Module Master | The 22 modules, effort, % complete |
| 03 Feature Backlog | **126 features (F001–F126)** with user story + acceptance criteria. Work is picked from here. |
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

- **AI never finalises a mark on a normal paper.** It proposes marks with per-step justification;
  a human confirms. The concept tracker only ever consumes confirmed values. (Tab 07 AI-05, tab 03
  F047.) **Exception, user decision 2026-09-20:** on *adaptive practice papers* no parent is needed.
  Multiple-choice marks come from the answer key and are confirmed on submit. Written answers are
  marked (generously) by the AI and shown to the *student*, who may question up to 5 marks (the AI
  re-reads once per answer and may only keep or raise a mark), remove a question she still disputes
  (it is flagged, never deleted, and left out of her grade and mastery), and then accepts; accepting
  is what confirms the marks. If the AI cannot grade a written answer confidently, the paper waits
  for a parent as before. Confirmations are written to the audit log (`evaluation.auto_confirmed`,
  `evaluation.student_finalized`).
- **The student role can never see or download an answer key** before or during an attempt,
  override a mark, or read another student's data. Enforced server-side, not by hiding a button.
  (T09.) **Exception, user decision 2026-09-22:** once her own attempt is submitted and its marks
  are confirmed, she may see the correct answer next to her own for every question -- reviewing
  what she got wrong (and why) is itself how she learns from it. If the same question is served to
  her again later and she simply remembers the answer, that is fine too; the purpose is learning,
  not testing recall of one specific item. This does not extend to a downloadable/printable key, to
  marks not yet confirmed, or to another student's data -- all still forbidden.
- **Never build a chat tutor that solves the problem.** Withholding the answer is the product
  *during* an attempt; the T09 exception above is about *after* it's over, and is not a contradiction.
- **Paper themes use original artwork only.** "Manga" is a genre and is fine to evoke; named
  franchises, their characters, logos and typefaces are not. The doodle theme is called
  **Doodle Journal** — never reference *Diary of a Wimpy Kid* in code, comments, assets or prompts.
- **Difficulty is a ceiling, not a filter on weakness.** Whatever tier the student picks, the 40%
  weak/priority concept weighting still applies. (F119.)
- **Shortfalls are reported, never hidden.** If the bank can't fill a blueprint slot, generate the
  paper anyway with a printed note naming the concept and cell that came up short. (F032.)
- **A student may generate as many papers a day as she wants.** F112's original acceptance
  criteria said "within a daily quota"; this app enforced a default of 3 ("You've reached today's
  limit of 3 papers -- try again tomorrow"). **Removed 2026-09-24 at the user's explicit request**
  ("dont put any limits"). The independent INR spend ceiling (F121, `enforceStudentSpendBudget`)
  is unaffected and still applies -- this is only the raw daily paper-count check.

## Stack

TanStack Start (React 19) · TypeScript strict · Tailwind v4 + shadcn/ui · Postgres (Neon or
Supabase) · Kysely · better-auth · Vercel. Server-side HTML→PDF for papers. See tab 09 for
rationale and rejected alternatives; do not swap a layer without updating that tab.

## Databases — tests never share one with real users

Three separate databases, and this separation is load-bearing:

| Which | Where | Used by |
|---|---|---|
| Production | Supabase `examprep-ai-dev` (name is historical) | the deployed app, real students |
| Local dev | whatever `.env` points at | `npm run dev` |
| **Test** | **local Postgres only**, via `.env.test` | `npm test`, `npm run test:e2e`, CI |

`vitest.setup.ts` loads `.env.test` and **refuses to start** if `DATABASE_URL` resolves to a
non-local host. There is no override flag. The suite creates and deletes fixture rows, and until
2026-09-23 it ran against the same Supabase project that serves real users — a crashed run left an
"Adaptive fixture subject" row active and a real student saw it in her own subject list, twice.
CI is unaffected: it already runs against an ephemeral `postgres:17` service on localhost.

First-time setup: install Postgres 17 locally, `createdb examprep_test`, copy `.env.test.example`
to `.env.test`, then `npm run db:setup:test` (migrate + seed).

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

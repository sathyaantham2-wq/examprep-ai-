# ExamPrep AI

Syllabus-exact question papers, handwritten-attempt evaluation, and delivery-gap diagnostics for
one school student at a time.

## Quick start

```bash
git clone <repo-url>
cd examprep-ai
npm install          # once the app scaffold lands (F001)
code .               # open in VS Code
claude               # start Claude Code in the repo root
```

Claude Code reads `CLAUDE.md` automatically and picks up the four project skills in
`.claude/skills/`. Confirm with: **"what skills do I have?"**

## Repo layout

```
examprep-ai/
├─ CLAUDE.md                     project memory — read every session
├─ docs/
│  ├─ ExamPrep_AI_Module_Development_Plan.xlsx    17 tabs, 122 features
│  └─ decisions/                 ADRs, one per irreversible choice
├─ .claude/skills/
│  ├─ examprep-ingest-source/    raw textbook file → clean per-page text
│  ├─ examprep-scope-authoring/  extracted text → concepts + IN/OUT scope
│  ├─ examprep-question-generation/  concepts → questions on the Bloom×difficulty grid
│  └─ examprep-build-feature/    pick an F-number and implement it properly
├─ content/
│  ├─ sources/                   raw NCERT files (gegp101.pdf …) — gitignored, they're large
│  └─ extracted/                 normalised per-page text — committed
└─ src/                          the app (from F001 onward)
```

## Where to start

Phase 0 in tab 10: **F001 → F002 → F003** (repo, env, deploy pipeline), then **F011** (schema).
Do not start on the paper generator before the schema exists.

## Note on the source files

The twelve `gegp*.pdf` files are **ZIP archives of page JPEGs with a per-page text sidecar**, not
real PDFs — which is why PDF readers reject them. `/examprep-ingest-source` handles both that
format and true PDFs. Don't "repair" them.

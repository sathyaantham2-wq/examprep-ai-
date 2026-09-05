# ExamPrep AI

Syllabus-exact question papers, handwritten-attempt evaluation, and delivery-gap diagnostics for
one school student at a time.

## Quick start

```bash
git clone <repo-url>
cd examprep-ai
npm install
npm run dev          # http://localhost:3000
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
└─ src/                          the app — TanStack Start (React 19), file-based routes
```

## Where to start

Phase 0 in tab 10: **F001 → F002 → F003** (repo, env, deploy pipeline), then **F011** (schema).
Do not start on the paper generator before the schema exists.

## Note on the source files

The twelve `gegp*.pdf` files are **ZIP archives of page JPEGs with a per-page text sidecar**, not
real PDFs — which is why PDF readers reject them. `/examprep-ingest-source` handles both that
format and true PDFs. Don't "repair" them.

## Local development

```bash
npm run dev       # dev server on :3000
npm run build     # production build
npm run lint      # eslint
npm run format    # prettier + eslint --fix
npm run check     # prettier --check
```

Routes are files under `src/routes` (TanStack Router file-based routing); server functions and
API routes live alongside them per the [TanStack Start docs](https://tanstack.com/start). Add
shadcn/ui components with:

```bash
npx shadcn@latest add button
```

## Deploy

Hosting is locked to Vercel (tab 09). `vercel.json` makes framework detection explicit; import the
repo in Vercel and add production env vars under Settings > Environment Variables. Variables
prefixed `VITE_` ship to the browser bundle — keep secrets unprefixed so they stay server-only.

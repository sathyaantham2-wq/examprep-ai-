# Runbooks (F111)

Operational procedures for this app. Written from what's actually in the repo today (migrations,
CI workflows, scripts) — not aspirational. Where a step needs something this session doesn't have
(a Vercel/GitHub token, a production DB URL), that's called out explicitly rather than glossed over.

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY (optional)
npm run db:migrate          # applies every migration in src/db/migrations/ in order
npm run db:seed             # loads the MATH-SEED CBSE Class 7 fixture (subjects/chapters/concepts)
npm run dev                 # http://localhost:3000
```

`ANTHROPIC_API_KEY` is optional for local dev — every AI-calling function (`src/lib/ai-*.ts`)
checks an `isXConfigured()` guard first and degrades to its documented fallback (see
`docs/PROMPT_CATALOGUE.md`) rather than crashing when it's unset.

## Running the test suites

```bash
npm test           # vitest: unit + integration, ~3 min, needs a real Postgres at DATABASE_URL
npm run test:unit  # vitest, excludes *.integration.test.ts -- fast, no DB needed
npm run test:e2e   # Playwright: real browser + real dev server + real dev DB, ~30s, separate/slower
```

The integration and E2E suites both run against **the real dev database** (no separate test DB is
provisioned locally) — they clean up their own fixtures in `afterAll`/`afterEach`, but a crashed
test run can leave orphaned rows behind. If integration tests start failing in a way that looks
like stale data (a query returning an unexpected extra row, an FK-violation on cleanup), suspect
this first — see "Orphaned fixture cleanup" below before assuming a real regression.

`vitest.config.ts` sets `fileParallelism: false` deliberately — these tests share one live DB, so
they were never safe to run as separate files concurrently (see F103's tracker note for the actual
contamination bug this was fixed in response to).

## Database migrations

```bash
npm run db:migrate       # latest — apply everything pending
npm run db:migrate:up    # one step forward
npm run db:migrate:down  # one step back
```

Every migration in `src/db/migrations/` implements both `up` and `down` — a rollback is always a
real, tested code path, not a manual SQL exercise. Regenerate `src/db/types.ts` after any schema
change with `npm run db:codegen` (never hand-edit that file — it's marked generated and will be
silently overwritten).

`.github/workflows/migrations.yml` exists to verify `up` then `down` then `up` again cleanly
against a scratch DB on every PR that touches `src/db/migrations/**` — see that file for specifics.

## Deploying (Vercel)

**Not yet exercised end-to-end this session** — the repo has no GitHub remote configured (F003 is
tracked as blocked in the plan spreadsheet, pending a GitHub token). Once a remote exists:

1. Connect the repo to a Vercel project (framework preset: Vite / TanStack Start).
2. Set env vars in the Vercel project: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
   (the production origin), `ANTHROPIC_API_KEY`.
3. Every PR gets a preview deployment; merging to `main` deploys to production.
4. Run `npm run db:migrate` against the production `DATABASE_URL` **before** the deploy that
   depends on the new schema goes live — migrations are not run automatically as part of the
   Vercel build.

## Rollback

- **Bad deploy, schema unchanged:** revert the Vercel deployment to the previous one from the
  Vercel dashboard (or `vercel rollback` via the CLI) — instant, no DB involvement.
- **Bad deploy, schema changed:** roll the app back first (above), then run
  `npm run db:migrate:down` against production for each migration the bad deploy added, in reverse
  order. Never roll back a migration that a still-live older app version depends on having *run* —
  check which app version is live before reversing schema.
- **Bad data from a bug, not a deploy:** nothing in this schema is hard-deleted except the one
  deliberate F098 DPDP path (`deletion_log`), so most bad-write incidents are recoverable by
  writing a corrective row, not restoring a snapshot — that's what the append-only ledger design
  (`concept_mastery`, `audit_log`) is for. Reach for a full DB restore only when the bug corrupted
  data outside those ledgers (e.g. a bad migration).

## Common incidents

| Symptom | Likely cause | Fix |
|---|---|---|
| A generation batch (F116) is stuck `in_progress` | The process crashed mid-batch; `generation_batch_items` for that batch have some `pending`/`in_progress` items with no active job. | `POST /api/questions/generate-batch/:id/resume` — it's built to be idempotent, re-running only unfinished cells. |
| A parent reports a score never updated after confirming an evaluation | Check `evaluations.confirmed_at` for that attempt — if null, the confirm step never completed (client error, or the confirm route 4xx'd). Dashboards only read confirmed evaluations by design. | Re-run the confirm flow from `/evaluate/:id`; check `audit_log` for an `evaluation.confirmed` row to see if it silently double-fired or never fired. |
| Cross-household data appears to leak | This should be structurally impossible (repository-layer scoping) — treat as P0. | Re-run `household-isolation.integration.test.ts` and `cross-household-access.integration.test.ts` against production-shaped data first to localize whether it's a repository bug or a route that bypassed the repository layer. |
| Integration tests fail with FK-violation on cleanup, or a test unexpectedly sees another test's fixture | Orphaned fixture rows from a previous crashed run (see above). | One-off cleanup: delete rows where the relevant name/text field matches `%fixture%` / `%E2E%` across `concepts`, `blueprints`, `households` (cascades handle the rest) — inspect before deleting in case it's real data with a coincidental name. |
| `POST` to an API route from a script/Playwright returns an unparseable/empty body | Missing `origin` and/or `content-type: application/json` headers, or the request fired before the session cookie was actually set (a UI-driven sign-in is async — wait for the resulting redirect/URL change before firing a dependent request). `requireRole`'s 401 has a `null` body, which is what turns into `SyntaxError: Unexpected end of JSON input` on `.json()`. | Add the headers a real browser `fetch()` would send automatically; wait for the auth state to actually land before the next request. See `e2e/happy-path.spec.ts`'s `signOutApi()`/`signInUi()` for the working pattern. |
| Occasional server-side 500 from `PATCH /api/attempts/:id/answer` (`attempt_answers` upsert), "no result" from `executeTakeFirstOrThrow` on an `INSERT ... ON CONFLICT ... RETURNING` | Observed intermittently (not on every run) during local E2E runs against the Supabase dev project — looks like a transaction-pooler visibility edge case on `onConflict().doUpdateSet()`, not a logic bug (the same call sequence run in isolation always succeeds). Not yet reproduced against a direct, unpooled connection. | Not fixed — noted here rather than silently ignored. If it starts showing up in production, the first thing to check is whether the app is on a pooled (pgbouncer transaction-mode) connection string vs. a direct one for write-heavy paths. |

## First-week-after-launch monitoring

No hosted logging/metrics/status-page provider is wired up yet (M22's F108 load/cost testing and
any APM integration are both unbuilt). Until one exists, the manual check during the first week is:

1. `ai_jobs` table: sum `cost_inr` daily, watch for a household running away with unexpectedly
   heavy AI usage (question generation or grading looping unexpectedly).
2. `evaluations` where `confirmed_at is null` and `created_at` is more than a day old — a parent
   who generated an attempt but the evaluation never got confirmed (stuck UI, or a bug).
3. `generation_batches` where `status = 'failed'` or stuck `in_progress` — see the incident row above.
4. Vercel's own deployment/function-error dashboard for 5xx rates — this is the nearest thing to a
   status page available today; a real status page is out of scope until traffic justifies it.

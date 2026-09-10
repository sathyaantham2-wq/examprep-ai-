# Launch checklist & runbook (F110)

This is a structure to fill in and check off, not a finished launch record — some rows below need
a real decision or a real credential this session doesn't have (marked **[owner to fill]**). See
`docs/RUNBOOKS.md` for the operational how-to behind the checklist items; this doc is the
go/no-go gate and the recovery plan, not the procedure detail.

## Go-live checklist

**Infrastructure**
- [ ] Production Postgres provisioned (Neon or Supabase), `DATABASE_URL` set in Vercel
- [ ] `npm run db:migrate` run against production DB, confirmed at the expected migration version
- [ ] `npm run db:seed` run once against production for the launch subject/chapter/concept scope
      (CBSE Class 7 Maths) — **not** the test fixtures used by the integration/E2E suites
- [ ] `BETTER_AUTH_SECRET` set to a real, unique production secret (not the dev/CI value)
- [ ] `BETTER_AUTH_URL` set to the real production origin
- [ ] `ANTHROPIC_API_KEY` set — confirm question generation, grading, and remediation content all
      work against production (not just `isXConfigured()` returning true)
- [ ] GitHub remote connected, Vercel project linked, `.github/workflows/tests.yml` and
      `migrations.yml` both green on `main` — **blocked in this session on F003** (no GitHub token
      provided yet)
- [ ] Custom domain + TLS configured (Vercel handles TLS automatically once a domain is attached)

**Data & content**
- [ ] Question bank depth check: every launch-scope concept has enough `approved` questions to
      fill a blueprint without hitting F032 shortfalls on a typical paper
- [ ] `syllabus-fidelity` audit (F106, `GET /api/admin/syllabus-fidelity`) run clean, or every
      remaining violation explicitly accepted as a known gap (see that feature's tracker note —
      real seed-data citation gaps currently exist and were deliberately not fabricated)
- [ ] Consent copy (`src/lib/consent.ts`) replaced with real, legally-reviewed purpose/retention
      wording — **[owner to fill: legal review]**. What's in the repo now is explicitly placeholder
      text (see F095's tracker note)

**Security & privacy**
- [ ] T02 cross-household isolation sweep green (`household-isolation.integration.test.ts`,
      `cross-household-access.integration.test.ts`)
- [ ] F098 export/delete flow smoke-tested against production once, end to end, before any real
      household relies on it
- [ ] Confirm no secrets committed (`.env` is gitignored; double-check before the first push if a
      GitHub remote is being connected for the first time)

**Rollback readiness**
- [ ] Previous known-good Vercel deployment identified and its URL/ID recorded before the launch
      deploy, so rollback is a lookup, not a search
- [ ] Rollback plan below reviewed by whoever is on call for launch day

**People**
- [ ] On-call contact for launch week: **[owner to fill]**
- [ ] Status page (if any) provisioned and its URL shared with early users: **[owner to fill —
      none exists yet; see `docs/RUNBOOKS.md`'s monitoring section for the manual interim check]**

## Rollback plan

See `docs/RUNBOOKS.md` → "Rollback" for the detailed procedure. Summary:

1. App-only bad deploy → revert the Vercel deployment (instant).
2. Bad deploy with a schema change → revert the app first, then run the added migrations' `down`
   in reverse order against production — never reverse a migration a still-live app version needs.
3. Bad data, not a bad deploy → prefer a corrective write over a restore; almost nothing in this
   schema is hard-deleted, so most incidents don't need a snapshot restore at all.

## On-call contact

**[owner to fill]** — name, phone/Slack handle, and escalation path for launch week. This can't be
filled in from the repo; it's a real person's contact information.

## Status page

No status page exists. Until one is provisioned, `docs/RUNBOOKS.md`'s "First-week-after-launch
monitoring" section is the manual substitute — run those checks daily during week one.

## First-week monitoring plan

See `docs/RUNBOOKS.md` → "First-week-after-launch monitoring" for the actual checks (AI cost
tracking via `ai_jobs`, stuck-evaluation detection, stuck generation batches, Vercel's 5xx rate).
Run that list daily for the first 7 days after launch; after that, weekly is likely sufficient
unless traffic or incident volume says otherwise.

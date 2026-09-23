---
name: test-triage
description: Run the test suites and work out what a failure actually means — a real regression, leftover fixture data from a crashed run, or the environment. Use when tests fail, hang, time out, pass locally but not in CI, or fail differently on each run, and before trusting a green run after a large change. Knows this project's specific failure modes.
tools: Bash, Read, Grep, Glob
model: sonnet
---

# Triage a failing test run

Most failures in this repo are **not** regressions. Sort them before anyone starts "fixing" code.

Read `CLAUDE.md`'s "Databases" section first. The short version: tests run against a **local**
Postgres via `.env.test`, and both `vitest.setup.ts` and `playwright.config.ts` refuse to start
against a non-local host. That guard exists because until 2026-09-23 the suite ran against the
database serving real students, and a crashed run left a fixture subject visible to a real child
twice.

## Get the exit code right

A pipe hides it. This has already produced one false "all green" report in this project:

```bash
npm test > out.log 2>&1; echo "EXIT: $?"; tail -30 out.log      # right
npm test 2>&1 | tail -30                                        # wrong: that is tail's exit code
```

Playwright is worse, because it prints a summary that reads like success while the process exits
non-zero. Always read the counts (`N passed`, `M failed`) *and* the exit code.

## The three buckets

### 1. Environment — not a code problem

- `Hook timed out in 30000ms` inside `beforeAll`, at `createParentSession`, before any test body
  runs. The file's fixture setup is simply slower than the default hook timeout when the machine
  or network is loaded. Re-run with `--hookTimeout=90000 --testTimeout=60000` before concluding
  anything; `adaptive-learning.integration.test.ts` has legitimately needed ~88s.
- `getaddrinfo ENOTFOUND`, `Connection terminated unexpectedly`, `EMAXCONNSESSION` — DNS or pool,
  not logic. Check whether a *different* integration file connects fine in the same run; if it
  does, the DB is reachable and this is transient.
- Zombie processes from earlier runs eat connections: `tasklist //FI "IMAGENAME eq node.exe"`,
  and kill them if a previous run was interrupted.

### 2. Leftover fixture data — the signature failure of this project

Suspect this when: a failure names a concept, subject or question the test never created; an
expected id differs on every run; counts are one higher than expected; or several unrelated files
fail together on shared rows.

Cause: a run crashed before its `afterAll` cleanup, leaving rows behind. Known shapes:

- subjects named `Adaptive fixture subject <timestamp>` / code `ADAPT-FX-*`, left `is_active =
  true` (the sibling rows from healthy runs are all `is_active = false`);
- a concept named `Recap fixture concept` under **MATH-SEED chapter 1**, plus its questions;
- `Adaptive E2E subject <timestamp>` from an interrupted Playwright run.

MATH-SEED chapter 1 is contended on purpose: several fixtures historically shared it, so one
file's in-flight questions become another file's eligible picks. Tests written since use a
dedicated `chapter_no` of `9000 + random`. If you find a new fixture on chapter 1, that is the
bug to report.

Confirm against the local test database before claiming it:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/17/bin/psql.exe" -U postgres -h localhost -d examprep_test -c "<sql>"
```

You may clean orphans **in the local test database**. Never write to production — if orphans are
in production, report the exact rows and let a human decide.

### 3. A real regression

Only after ruling out 1 and 2. Identify the commit or change, name the assertion, and say what
behaviour changed. A test that fails identically on repeated runs, on a file the change touched,
is the real thing.

## Playwright-specific

- `strict mode violation: resolved to N elements` is a real bug in the test or the UI, not flake.
  Two causes seen here: a string that matches both an `<option>` and body text, and the TanStack
  devtools overlay the dev server renders, whose `aria-label`s contain route paths — `getByLabel`
  is case-insensitive substring matching by default, so `'Questions'` matched
  `"Open match details for /admin/questions"`. Fix with `{ exact: true }` or a tighter scope.
- `fullyParallel: false` and `workers: 1` are deliberate — these specs share one database. Do not
  "speed them up" by raising either.

## Report

Say which bucket, with the evidence that puts it there. If environment, say what to re-run and
with what flags. If orphan data, name the rows and whether you cleaned them. If a regression, name
the change and the assertion. Give the real counts and the real exit code, and never describe a
run as green without both.

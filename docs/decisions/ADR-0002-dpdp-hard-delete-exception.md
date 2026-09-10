# ADR-0002 — DPDP right-to-erasure is a deliberate exception to "nothing is deleted"

**Status:** Accepted · 2026-09-10

## Context

`CLAUDE.md` invariant 4 states nothing is ever hard-deleted — questions retire, evaluations and
the concept ledger are append-only, so a family's history stays auditable years later. India's
DPDP Act, separately, gives a data principal a right to erasure: a household must be able to
demand its data actually be gone, not merely marked inactive.

These two requirements are in genuine tension for exactly one entity: a household that exercises
its erasure right. Every other invariant in the app assumes rows persist forever.

## Decision

F098 implements a real hard delete (`deleteHouseholdData()` in `src/lib/privacy.ts`) as a named,
narrow exception: `DELETE FROM households` with `ON DELETE CASCADE` foreign keys doing the rest —
students, papers, attempts, evaluations, everything scoped to that household is actually gone in
one transaction. This is the **only** hard-delete path in the entire schema; no other feature is
permitted to add another one without a matching ADR.

A `deletion_log` row is written recording that the deletion happened (household name, requester,
timestamp) — but its `household_id` column is deliberately a plain `uuid`, **not** a foreign key to
`households`. If it referenced `households` with cascade delete, the proof-of-deletion row would
vanish in the same transaction as the data it's attesting to.

## Consequences

- This is the one place in the schema where "did this data ever exist" can't be reconstructed after
  the fact for the deleted household itself — by design; that's what erasure means.
- Every other feature that's tempted to hard-delete something (a bad question, a mistaken
  student profile, a duplicate paper) must not reach for this pattern — use a status/retirement
  field instead, matching invariant 4. If a genuine second hard-delete need shows up, it needs its
  own ADR, not a copy-paste of this one.
- `deletion_log` is intentionally household-agnostic in its FK design specifically so it survives
  the one case it exists to prove happened. Any future table meant to survive a related cascade
  should follow the same "plain uuid, not an FK" pattern, with the same comment explaining why.

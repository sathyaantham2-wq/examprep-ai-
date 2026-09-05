---
name: examprep-build-feature
description: Implement a feature from the ExamPrep AI backlog end to end — schema, API, UI, tests, status update. Use this skill whenever the user names a feature ID like F033, asks to build or implement any part of the product (paper generator, evaluation workspace, concept tracker, PDF export, upload flow), asks "what should I work on next", or starts a coding session in this repo. It keeps work anchored to the agreed acceptance criteria in docs/ExamPrep_AI_Module_Development_Plan.xlsx instead of drifting into a rewrite.
---

# Build a backlog feature

## Start by reading the row

Open `docs/ExamPrep_AI_Module_Development_Plan.xlsx`, tab **03 Feature Backlog**, and find the
F-number. The **acceptance criteria column is the spec** — implement it literally. If it is
ambiguous, ask rather than interpret; these criteria were argued over.

```python
import pandas as pd
df = pd.read_excel("docs/ExamPrep_AI_Module_Development_Plan.xlsx", sheet_name="03 Feature Backlog", header=2)
print(df[df["Feature ID"] == "F033"].to_dict("records")[0])
```

Then check the neighbouring tabs for that module: **04** for tables, **05** for the route contract,
**06** for the screen, **07** if the feature calls a model, **12** for the test that must pass.

## Picking work when the user hasn't

Filter tab 03 for `Status = Not Started` and `Priority = P0`, then respect dependencies from tab 02
(Depends On). Order within a phase follows the Sprint column. Do not start a Phase 1 feature while
a Phase 0 dependency is open — schema before UI, always.

## Build order within a feature

1. Migration (if the feature touches data) — schema first, both directions tested.
2. Repository / query layer with generated types.
3. API route with the auth level from tab 05, enforced **server-side**.
4. UI from tab 06.
5. Tests — the tab 12 scenario plus unit coverage of the logic.
6. Update tab 03 column J to `Done`.

## Invariants to re-check on every feature

These come from `CLAUDE.md`; they are worth re-reading because they are the ones quietly violated
during a fast implementation:

- Chapter identity is `(book, part, number)`; `board` and `class` are columns, never constants.
- Query scoping by household is enforced in the repository layer, not the route handler, so a new
  endpoint cannot forget it.
- AI output never writes a final mark. It proposes; a human confirms; the tracker reads only
  confirmed values.
- Student role: no answer key, no mark override, no other student's data.
- Nothing is hard-deleted.

## When the criteria are wrong

Sometimes implementation reveals that an acceptance criterion is unbuildable or mis-specified.
Say so plainly, propose the corrected wording, and update the spreadsheet cell once the user
agrees. Silently building something different is worse than either option — the spreadsheet is
what the user plans against.

## Definition of done

Acceptance criteria met literally · matching tab 12 test green · cross-household access test (T02)
still green · tab 03 status updated · commit message references the F-number.

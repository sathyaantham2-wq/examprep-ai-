---
name: examprep-question-generation
description: Generate exam questions for a concept, targeting empty cells of the Bloom×difficulty coverage grid and staying strictly inside the chapter's IN-scope record. Use this skill whenever the user asks to generate questions, fill the question bank, top up a concept, add practice items, create MCQs or short-answer questions, or asks why a concept has too few questions. Also use it before generating any paper for a chapter whose bank is thin, since a paper drawn from an under-filled grid produces shortfalls the student will notice.
---

# Generate questions into the bank

Generation is a **top-up** operation: bring a concept to its `target_question_count` by filling the
emptiest cells of its grid. It is never "produce N questions and see what we get".

## Before generating

1. Confirm the chapter has a scope record. No scope, no generation — run
   `/examprep-scope-authoring` first.
2. Read the concept's current grid: counts of Approved questions per Bloom level × difficulty tier.
3. Compute the deficit per cell. Generate only the difference. Running this twice must not double
   the bank.

## The coverage grid (target at 20 questions per concept)

| Bloom | Easy | Hard | Hardest |
|---|---|---|---|
| Remember | 3 | 1 | — |
| Understand | 3 | 2 | — |
| Apply | 2 | 3 | 1 |
| Analyse | — | 2 | 1 |
| Evaluate | — | 1 | — |
| Create | — | — | 1 |

Seven cells are deliberately empty. "Remember + Hardest" is not a real question type; forcing one
produces a trick question rather than a hard one. Leave them empty and let the generator report a
shortfall if a blueprint asks for them.

Depth targets are configuration (`target_question_count`), so this table scales — at 40 per concept
the same proportions apply.

## Rules that make a question usable

- **Traceable.** Every question names the IN-scope item it tests. If it cannot, discard it — that
  is the drift the scope record exists to catch.
- **Step marks sum to the question's marks.** A 3-mark question carries named steps, e.g.
  Formula 1 / Substitution 1 / Answer with unit 1. This is what evaluation grades against (F021).
- **Distractors are plausible and wrong for a reason.** Each MCQ distractor should correspond to a
  specific misconception — a dropped sign, a flipped label, a rule applied out of scope. Random
  wrong numbers teach nothing and make the diagnosis meaningless.
- **Exactly one correct option.** Check it; near-correct second options are the commonest defect.
- **Reversal words are underlined in the text** when used (NOT, least, false, cannot), because the
  product tracks reading-discipline errors separately from concept gaps.
- **Telugu stays in Telugu script.** Never romanise.

## Multi-component objectives

Over-weight Assertion–Reason, multi-statement and match-the-following items. They are the only
question types that expose First-Plausible Commit — the student checking one element and
committing. A bank with none of these cannot diagnose it.

## Status on creation

There is no draft/review gate and no `review_tier` column — both were removed 2026-09-17 at the
user's explicit request (CLAUDE.md invariant 4). A question is Approved and usable immediately on
creation; there is nothing to mark or tier as you write it.

For your own report, use the objective/subjective split instead (this is what
`OBJECTIVE_TYPES` in `src/lib/scoring.ts` and `src/lib/questions.ts` actually check at evaluation
time): `mcq`, `fill_blank`, `assertion_reason` and `multi_statement` are objective, deterministic
items; `short_answer` and `long_answer` are subjective, step-marked items a human should skim even
though they are already Approved.

## Output

Write to the question bank as `status: approved` (the loader/generator does this automatically —
do not set `status: draft`, that field no longer exists). Report: questions generated per cell,
cells still short, and the objective/subjective split so the user knows how much of the new batch
is worth a closer read.

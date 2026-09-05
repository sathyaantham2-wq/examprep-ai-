---
name: examprep-scope-authoring
description: Turn an ingested textbook chapter into a concept list plus explicit IN-scope and OUT-of-scope records with page citations. Use this skill whenever the user mentions chapter scope, syllabus boundary, "what's in scope", concepts for a chapter, setting up a new chapter, or asks why a generated question was out of syllabus — and always before any question is generated for a chapter that has no scope record yet, because the generator refuses concepts it cannot trace. This is the step that stops the product wasting the student's time on material her exam will never test.
---

# Author chapter scope

Scope records are the product's moat and its safety rail. Every question must trace to an IN-scope
concept; the generator refuses anything else (F016, F032).

## Prerequisite

The chapter must already be ingested — `content/extracted/<code>/` with `meta.json` and per-page
text. If it isn't, run `/examprep-ingest-source` first. Never author scope from memory of what a
Class 7 syllabus "usually" contains; different publishers draw the line in different places, and
the whole point of the record is to capture *this* book's boundary.

## Workflow

1. **Read the chapter section by section.** Work from the numbered headings (`3.1`, `3.2`, …).
   Each numbered section usually maps to one or two concepts.
2. **Draft the concept list.** For each concept capture:
   - `code` — `C<class><SUBJ>-<chapter>.<n>`, e.g. `C7M-3.2`
   - `name`, one-line `description`
   - `idea` / `rule` / `example` — the three fields the remediation refresher is built from
   - `difficulty_base`
3. **Write the IN scope list.** One bullet per teachable item, each with a page reference.
   Phrase it as what the student is expected to *do*, not as a topic label:
   good — "add and subtract decimals in columns, including regrouping across zeros (pp. 68–71)";
   weak — "addition and subtraction".
4. **Write the OUT scope list. This matters more than the IN list.** State explicitly what this
   chapter does *not* cover, especially things a general model would assume belong:
   e.g. for *A Peek Beyond the Point* — multiplication and division of decimals, recurring
   decimals, rounding to a given decimal place, percentages. Without this the generator drifts to
   the CBSE syllabus it half-remembers.
5. **Show the draft to the user for approval before writing anything.** Scope is a judgement call
   about their child's exam; never commit it unreviewed.

## Output format

```yaml
chapter:
  source_code: gegp103
  part: I
  chapter_no: 3
  title: A Peek Beyond the Point
  source: NCERT Ganita Prakash Class 7, Reprint 2026-27, pp. 46-80
concepts:
  - code: C7M-3.2
    name: Tenths
    description: Reading and writing tenths; addition and subtraction by regrouping.
    idea: A tenth is one whole split into ten equal parts.
    rule: Ten tenths make one whole, so 10/10 regroups to 1.
    example: 2 and 7 tenths = 2.7 = 27 tenths
    difficulty_base: Easy
scope_in:
  - item: Read a length as "2 and 7 tenths" or "27 tenths"
    pages: "50-52"
scope_out:
  - item: Multiplication and division of decimals
    reason: Introduced in Part II Ch 4, not here
```

## Quality bar

- Every IN and OUT bullet carries a page reference or an explicit reason.
- The OUT list is never empty. If you cannot think of anything out of scope, you have not read the
  chapter closely enough — there is always a neighbouring topic a model would wrongly pull in.
- Concept count per chapter is typically 4–9. More than 12 means you are listing exercises, not
  concepts; fewer than 3 means you are listing section titles.

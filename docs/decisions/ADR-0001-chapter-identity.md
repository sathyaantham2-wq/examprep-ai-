# ADR-0001 — Chapter identity is (book, part, number)

**Status:** Accepted · 2026-09-05

## Context

NCERT *Ganita Prakash* Class 7 ships as two parts, each numbering its chapters from 1. The book
therefore contains two Chapter 3s, two Chapter 6s, and two chapters with near-identical names:
Part I ch 3 "A Peek Beyond the Point" and Part II ch 4 "Another Peek Beyond the Point".

An earlier prototype keyed chapters on a bare string number and had to introduce ad-hoc `P2-`
prefixes to disambiguate — a workaround that leaks into concept codes, URLs and question IDs.

## Decision

Chapters are identified by `(source_id, part, chapter_number)` with a surrogate primary key.
`part` is a required column on `chapters`, not optional. Display strings are derived, never stored
as the identity.

## Consequences

- Concept codes carry the part implicitly through the chapter FK, not through a prefix hack.
- Any subject shipping in parts or volumes works without further change.
- Migrating later would require rewriting every concept code and question ID, which is why this is
  settled before the first migration.

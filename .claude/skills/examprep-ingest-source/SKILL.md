---
name: examprep-ingest-source
description: Convert a raw NCERT textbook chapter file into clean, per-page text under content/extracted/. Use this skill whenever the user mentions a gegp file, an NCERT chapter, a textbook PDF, ingesting a book, "the source file", "extract the chapter", "the PDF won't open", or a corrupt-looking textbook file — and always before authoring chapter scope or generating any question, because scope records must cite real page numbers from real extracted text. Handles both true PDFs and the ZIP-of-page-JPEGs format that NCERT chapter files in this project actually use.
---

# Ingest an NCERT source chapter

Turns one raw chapter file into a normalised folder of per-page text plus a manifest, so that
scope authoring and question generation can cite real pages instead of guessing.

## Critical: these files are not what they claim to be

Most `gegp*.pdf` files in `content/sources/` are **ZIP archives** containing `1.jpeg`, `1.txt`,
`2.jpeg`, `2.txt`, … and `manifest.json`, saved with a `.pdf` extension. Every PDF library rejects
them with "Data format error". They are not corrupt and must not be "repaired" — the text layer
inside is clean.

A few chapters (103, 104, 105) are genuine PDFs. Detect, don't assume.

## Workflow

1. **Detect the format** by reading the first two bytes:
   - `PK` → ZIP bundle. Extract it.
   - `%P` → real PDF. Extract text with `pypdfium2`.
2. **Run the script** — it handles both and is idempotent:
   ```bash
   python .claude/skills/examprep-ingest-source/scripts/ingest_source.py \
       content/sources/gegp101.pdf --part I --chapter 1 --class 7 --subject maths
   ```
3. **Verify before moving on.** Print page 1 and one mid-chapter page. If a page is empty or
   mojibake, that page is image-only and needs vision extraction — flag it in the manifest as
   `"needs_ocr": true` rather than silently producing an incomplete chapter.
4. **Report** the page count, the chapter title read from page 1, and any pages needing OCR.

## Output shape

```
content/extracted/<code>/
├─ meta.json          code, part, chapter_no, title, class, subject, page_count, source_sha256
└─ pages/001.txt …    one file per page, page number zero-padded to 3
```

`meta.json` is what the chapter row in the database is built from, so get `part` and `chapter_no`
right — see ADR-0001 on why the part matters.

## What not to do

- Don't concatenate pages into one blob. Scope records cite page numbers; losing page boundaries
  destroys traceability and there is no cheap way to recover it.
- Don't commit the raw source file. `content/sources/` is gitignored; `content/extracted/` is not.
- Don't infer the chapter number from the filename alone. `gegp204` is Part **II** chapter **4**,
  not chapter 204 and not chapter 4 of a single sequence.

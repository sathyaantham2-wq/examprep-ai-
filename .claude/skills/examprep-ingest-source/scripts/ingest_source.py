#!/usr/bin/env python3
"""Ingest one NCERT chapter file into content/extracted/<code>/.

Handles two formats:
  * ZIP archive of page JPEGs + per-page .txt + manifest.json, saved as .pdf  (most gegp files)
  * a genuine PDF                                                             (gegp103/104/105)

Idempotent: re-running overwrites the extracted folder for that code only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

OUT_ROOT = Path("content/extracted")
MIN_CHARS = 40  # a page with less real text than this is probably image-only


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def detect(path: Path) -> str:
    with path.open("rb") as fh:
        magic = fh.read(2)
    if magic == b"PK":
        return "zip-bundle"
    if magic == b"%P":
        return "pdf"
    raise SystemExit(f"{path.name}: unrecognised format (first bytes {magic!r})")


def from_zip_bundle(path: Path) -> list[str]:
    """Return page texts in page order from a ZIP of N.txt sidecars."""
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        txt = sorted(
            (n for n in names if re.fullmatch(r"\d+\.txt", n)),
            key=lambda n: int(n.split(".")[0]),
        )
        if not txt:
            raise SystemExit(f"{path.name}: ZIP bundle has no per-page .txt sidecars")
        return [zf.read(n).decode("utf-8", errors="replace") for n in txt]


def from_pdf(path: Path) -> list[str]:
    try:
        import pypdfium2 as pdfium
    except ImportError:
        raise SystemExit("pypdfium2 not installed: pip install pypdfium2")
    doc = pdfium.PdfDocument(str(path))
    return [doc[i].get_textpage().get_text_range() for i in range(len(doc))]


def normalise(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n").strip() + "\n"


def guess_title(first_page: str) -> str:
    """Chapter titles sit on page 1, usually in caps or as a 'N.1 Heading' line."""
    lines = [ln.strip() for ln in first_page.splitlines() if ln.strip()]
    caps = [ln for ln in lines[:6] if ln.isupper() and len(ln) > 3]
    if caps:
        return " ".join(caps[:2]).title()
    for ln in lines[:6]:
        if re.match(r"^\d+\.\d+\s+\S", ln):
            return re.sub(r"^\d+\.\d+\s+", "", ln)
    return lines[0] if lines else "UNKNOWN — set manually"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("source", type=Path)
    ap.add_argument("--part", required=True, help="Book part, e.g. I or II")
    ap.add_argument("--chapter", required=True, type=int, help="Chapter number WITHIN the part")
    ap.add_argument("--class", dest="klass", required=True, type=int)
    ap.add_argument("--subject", required=True)
    ap.add_argument("--title", default=None, help="Override the auto-detected title")
    args = ap.parse_args()

    src = args.source
    if not src.exists():
        raise SystemExit(f"not found: {src}")

    kind = detect(src)
    pages = from_zip_bundle(src) if kind == "zip-bundle" else from_pdf(src)
    pages = [normalise(p) for p in pages]

    code = src.stem
    out = OUT_ROOT / code
    if out.exists():
        shutil.rmtree(out)
    (out / "pages").mkdir(parents=True)

    needs_ocr = []
    for i, text in enumerate(pages, 1):
        (out / "pages" / f"{i:03d}.txt").write_text(text, encoding="utf-8")
        if len(text.strip()) < MIN_CHARS:
            needs_ocr.append(i)

    meta = {
        "code": code,
        "class": args.klass,
        "subject": args.subject,
        "part": args.part,
        "chapter_no": args.chapter,
        "title": args.title or guess_title(pages[0]),
        "page_count": len(pages),
        "source_format": kind,
        "source_sha256": sha256(src),
        "needs_ocr_pages": needs_ocr,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(json.dumps(meta, indent=2, ensure_ascii=False))
    if needs_ocr:
        print(f"\nWARNING: {len(needs_ocr)} page(s) have little or no text layer: {needs_ocr}")
        print("These are image-only and need vision extraction before scope authoring.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

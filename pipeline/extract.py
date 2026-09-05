#!/usr/bin/env python3
"""
pipeline/extract.py — ดึงข้อความดิบจาก PDF ต้นฉบับ

ตาม docs/handoff-spec.md §8 ขั้น 1: ใช้ pdftotext (poppler) แบบไม่ใช้ -layout
(ไม่ใช้ -layout เพราะ layout mode พยายามรักษาตำแหน่งคอลัมน์/ย่อหน้าด้วยช่องว่าง
ซึ่งกับ PDF เล่มนี้ที่ font ฝังมีปัญหาอยู่แล้ว จะยิ่งทำให้ข้อความกระจัดกระจายกว่าเดิม)

ชื่อไฟล์ PDF: อ่านจาก book.json.sourcePdf.file เป็นแหล่งความจริงเดียว (ตามสัญญาระหว่างโมดูล §A.1
และ risk #15 — ไม่ใช้รูปแบบ bookNN-*.pdf ตายตัวแบบใน §8 ของ spec หลัก เพราะ A-01/สัญญาระบุชัดว่า
sourcePdf.file คือ source of truth)

fallback: ถ้าเครื่องไม่มี binary `pdftotext` (เช่นเครื่อง dev ที่ยังไม่ได้ลง poppler-utils)
ใช้ pymupdf (fitz) แทนโดยอัตโนมัติ — spec §8 อนุญาตทั้งสองทาง ("pdftotext (poppler) แบบไม่ใช้ -layout"
เป็นทางหลักตามที่ผู้ว่าจ้างระบุ, pymupdf เป็นทางเลือกที่ระบุไว้ในสัญญาระหว่างโมดูล §G)

pipeline ห้ามเขียนอะไรใต้ web/** (ดู §G) — สคริปต์นี้เขียนลง content/books/{slug}/raw/book.txt เท่านั้น
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from pipeline import common


def extract_with_pdftotext(pdf_path: Path, out_path: Path) -> None:
    # -enc UTF-8 กันกรณี locale ของเครื่องไม่ใช่ UTF-8 (ปกติ poppler สมัยใหม่ default เป็น UTF-8 อยู่แล้ว
    # แต่ระบุชัดไว้กันปัญหาข้ามเครื่อง); ไม่ใส่ -layout ตาม spec
    cmd = ["pdftotext", "-enc", "UTF-8", str(pdf_path), str(out_path)]
    common.eprint("รัน:", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        common.die(
            f"pdftotext ล้มเหลว (exit {result.returncode}): {result.stderr.strip()}"
        )


def extract_with_pymupdf(pdf_path: Path, out_path: Path) -> None:
    try:
        import fitz  # type: ignore  # pymupdf
    except ImportError:
        common.die(
            "ไม่มีทั้ง pdftotext (poppler) และ pymupdf — ติดตั้งอย่างใดอย่างหนึ่ง:\n"
            "  macOS:  brew install poppler\n"
            "  Ubuntu: apt-get install poppler-utils\n"
            "  หรือ:   pip install -r pipeline/requirements.txt (ได้ pymupdf มาด้วย)"
        )
        return  # unreachable, เพื่อ type checker
    doc = fitz.open(pdf_path)
    parts = []
    for page in doc:
        # get_text() แบบ default (ไม่ใช่ "layout") ให้ผลใกล้เคียง pdftotext แบบไม่ใช้ -layout ที่สุด
        parts.append(page.get_text())
    doc.close()
    out_path.write_text("\n\f\n".join(parts), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ดึงข้อความดิบจาก PDF ต้นฉบับ")
    parser.add_argument("--book", required=True, help="bookSlug เช่น trilaksana-quantum")
    parser.add_argument(
        "--pdf",
        dest="pdf_path",
        default=None,
        help="path ไฟล์ PDF override (default: content/source/{book.json.sourcePdf.file})",
    )
    parser.add_argument(
        "--out",
        dest="out_path",
        default=None,
        help="path output override (default: content/books/{slug}/raw/book.txt)",
    )
    args = parser.parse_args(argv)

    book_slug = args.book
    book = common.load_book(book_slug)

    if args.pdf_path:
        pdf_path = Path(args.pdf_path)
    else:
        source_pdf = book.get("sourcePdf")
        if not source_pdf or not source_pdf.get("file"):
            common.die(
                f"book.json ของ '{book_slug}' ยังไม่มี sourcePdf.file — ตั้งค่าก่อน "
                f"(ดู docs/spec-addendum.md A-01) หรือใช้ --pdf ระบุ path ตรงๆ"
            )
        pdf_path = common.SOURCE_DIR / source_pdf["file"]

    if not pdf_path.exists():
        common.die(
            f"ไม่พบไฟล์ PDF ที่ {pdf_path}\n"
            f"  วางไฟล์ต้นฉบับไว้ที่ content/source/ (ห้าม commit — ดูกฎเหล็ก #2)\n"
            f"  และตรวจว่า book.json.sourcePdf.file สะกดตรงกับชื่อไฟล์จริง"
        )

    out_path = Path(args.out_path) if args.out_path else common.raw_book_txt_path(book_slug)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if shutil.which("pdftotext"):
        extract_with_pdftotext(pdf_path, out_path)
    else:
        common.eprint("ไม่พบ binary 'pdftotext' ในเครื่อง — fallback ไป pymupdf")
        extract_with_pymupdf(pdf_path, out_path)

    size = out_path.stat().st_size
    text_preview_chars = len(out_path.read_text(encoding="utf-8", errors="replace"))
    common.eprint(f"เขียน {out_path} ({size:,} bytes, {text_preview_chars:,} ตัวอักษร)")
    common.eprint("ขั้นถัดไป: python3 -m pipeline.clean --book " + book_slug)
    return 0


if __name__ == "__main__":
    sys.exit(main())

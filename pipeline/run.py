#!/usr/bin/env python3
"""
pipeline/run.py — รันทั้งสาย extract -> clean -> split -> author (ทุกบทที่ยังไม่ ready) -> terms

ใช้ตอนอยากรันทั้งเล่มรวดเดียว (เช่นตอน setup ครั้งแรก หรือมี PDF ใหม่) ปกติแนะนำรันทีละขั้นด้วยมือ
ผ่าน Makefile (`make pipeline STEP=... BOOK=...`) เพื่อตรวจผลลัพธ์ระหว่างทาง (โดยเฉพาะหลัง clean/split
ตามที่ §8 ย้ำว่า "ผลลัพธ์ต้องตรวจด้วยตาก่อนใช้") — สคริปต์นี้มีไว้เพื่อความสะดวกเมื่อมั่นใจแล้วเท่านั้น

พฤติกรรม:
  - extract/clean/split รันเสมอ (idempotent — เขียนทับไฟล์ raw/ ของตัวเอง)
  - author รันเฉพาะบทที่ยังไม่มี chNN.json หรือมีแต่ status ไม่ใช่ "ready" (เคารพ §11 ข้อห้าม #3 —
    ไม่มีทางเขียนทับบทที่ผ่านคนตรวจแล้วโดยไม่ใส่ --force-authored เอง)
  - terms รันท้ายสุดครั้งเดียวหลัง author ครบทุกบท (ต้องมีอย่างน้อย 1 บทที่มี terms[] ให้ merge)
  - หยุดทันทีถ้าขั้นไหนล้มเหลว (exit code != 0) ไม่รันขั้นถัดไปทับข้อมูลที่อาจไม่สมบูรณ์
"""
from __future__ import annotations

import argparse
import sys

from pipeline import author, clean, common, extract, split, terms


def run_step(name: str, func, argv: list[str]) -> None:
    common.eprint(f"=== ขั้น: {name} ({' '.join(argv)}) ===")
    rc = func(argv)
    if rc != 0:
        common.die(f"ขั้น '{name}' ล้มเหลว (exit {rc}) — หยุด pipeline ที่นี่")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="รัน pipeline ทั้งสายสำหรับเล่มเดียว")
    parser.add_argument("--book", required=True)
    parser.add_argument("--skip-extract", action="store_true")
    parser.add_argument("--skip-clean", action="store_true")
    parser.add_argument("--skip-split", action="store_true")
    parser.add_argument("--skip-author", action="store_true")
    parser.add_argument("--skip-terms", action="store_true")
    parser.add_argument(
        "--force-authored",
        action="store_true",
        help="ให้ author.py เขียนทับบทที่ status เป็น ready ด้วย (อันตราย — ปกติไม่ควรใช้)",
    )
    args = parser.parse_args(argv)

    book_slug = args.book
    book = common.load_book(book_slug)  # fail เร็วถ้า book.json ยังไม่มี

    if not args.skip_extract:
        run_step("extract", extract.main, ["--book", book_slug])
    if not args.skip_clean:
        run_step("clean", clean.main, ["--book", book_slug])
    if not args.skip_split:
        run_step("split", split.main, ["--book", book_slug])

    if not args.skip_author:
        for ch in sorted(book.get("chapters", []), key=lambda c: c["order"]):
            slug = ch["slug"]
            existing = common.load_json(common.chapter_json_path(book_slug, slug))
            if existing and existing.get("status") == "ready" and not args.force_authored:
                common.eprint(f"ข้าม author สำหรับ {slug} (status: ready อยู่แล้ว)")
                continue
            author_argv = ["--book", book_slug, "--chapter", slug]
            if args.force_authored:
                author_argv.append("--force")
            run_step(f"author {slug}", author.main, author_argv)

    if not args.skip_terms:
        run_step("terms", terms.main, ["--book", book_slug, "--report"])

    common.eprint(f"เสร็จสิ้น pipeline สำหรับ '{book_slug}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())

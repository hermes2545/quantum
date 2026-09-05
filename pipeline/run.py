#!/usr/bin/env python3
"""
pipeline/run.py — รันทั้งสาย extract -> clean -> split -> author (ทุกบทที่ยังไม่ ready) -> terms

ใช้ตอนอยากรันทั้งเล่มรวดเดียว (เช่นตอน setup ครั้งแรก หรือมี PDF ใหม่) ปกติแนะนำรันทีละขั้นด้วยมือ
ผ่าน Makefile (`make pipeline STEP=... BOOK=...`) เพื่อตรวจผลลัพธ์ระหว่างทาง (โดยเฉพาะหลัง clean/split
ตามที่ §8 ย้ำว่า "ผลลัพธ์ต้องตรวจด้วยตาก่อนใช้") — สคริปต์นี้มีไว้เพื่อความสะดวกเมื่อมั่นใจแล้วเท่านั้น

พฤติกรรม:
  - extract/clean/split รันเสมอ (idempotent — เขียนทับไฟล์ raw/ ของตัวเอง)
  - author รันเฉพาะบทที่ (ก) book.json.chapters[i].status ไม่ใช่ "building" (บทที่ยังไม่มีเนื้อหาให้
    เรียบเรียง — §A.1 กำหนดว่า chapters ว่างได้เฉพาะเมื่อสถานะเล่มเป็น building แต่ระดับบทเองก็ใช้กฎเดียวกัน:
    "building" แปลว่ายังไม่ถึงคิวสร้าง ข้ามไปก่อน ไม่ใช่ default ที่ควร author ให้อัตโนมัติ) และ (ข) chNN.json
    ที่มีอยู่แล้ว (ถ้ามี) status ไม่ใช่ "ready" (เคารพ §11 ข้อห้าม #3 — ไม่มีทางเขียนทับบทที่ผ่านคนตรวจแล้ว
    โดยไม่ใส่ --force-authored เอง) ใช้ --include-building ถ้าต้องการ author บทที่ book.json ยังบอกว่า
    building ด้วย (ต้องไปแก้ book.json.chapters[i].status เป็น "draft" เองหลังจากนั้น —ดูคำเตือนท้าย
    author.py — มิฉะนั้น build.js จะ fail เพราะสถานะสองที่ไม่ตรงกันตามสัญญาระหว่างโมดูล §A.1)
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
    parser.add_argument(
        "--include-building",
        action="store_true",
        help=(
            "author บทที่ book.json.chapters[i].status เป็น building ด้วย (ปกติข้าม — บทเหล่านี้ยังไม่ถึง"
            "คิวสร้างตามลำดับงาน) ต้องไปแก้ book.json.chapters[i].status เป็น draft เองหลังรันเสร็จ"
            " มิฉะนั้น build.js จะ fail เพราะสถานะสองที่ไม่ตรงกัน (สัญญาระหว่างโมดูล §A.1)"
        ),
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
            # เช็ค book.json.chapters[i].status ก่อน (ไม่ใช่แค่ chNN.json ที่มีอยู่) — "building" แปลว่า
            # เล่มยังไม่มีเนื้อหาให้เรียบเรียงถึงบทนี้ ไม่ใช่แค่ "ยังไม่ ready" (ดูสัญญาระหว่างโมดูล §A.1:
            # book.json.chapters[i].status ต้องเท่ากับ chNN.json.status เสมอ — author เขียน draft เสมอ
            # ถ้า book.json ยังบอกว่า building จะได้ draft/building ไม่ตรงกัน ทำให้ build.js fail ทั้งเล่ม)
            if ch.get("status") == "building" and not args.include_building:
                common.eprint(f"ข้าม author สำหรับ {slug} (book.json ระบุ status: building)")
                continue
            existing = common.load_json(common.chapter_json_path(book_slug, slug))
            if existing and existing.get("status") == "ready" and not args.force_authored:
                common.eprint(f"ข้าม author สำหรับ {slug} (status: ready อยู่แล้ว)")
                continue
            author_argv = ["--book", book_slug, "--chapter", slug]
            if args.force_authored:
                author_argv.append("--force")
            run_step(f"author {slug}", author.main, author_argv)
            if ch.get("status") == "building":
                common.eprint(
                    f"คำเตือน: {slug} เขียนด้วย status: draft แล้ว แต่ book.json.chapters[i].status "
                    f'ของ "{slug}" ยังเป็น "building" — ต้องแก้ book.json เป็น "draft" เองก่อน build.js/'
                    "validate.mjs จะ fail (สัญญาระหว่างโมดูล §A.1 บังคับให้สองที่นี้ตรงกันเสมอ)"
                )

    if not args.skip_terms:
        run_step("terms", terms.main, ["--book", book_slug, "--report"])

    common.eprint(f"เสร็จสิ้น pipeline สำหรับ '{book_slug}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())

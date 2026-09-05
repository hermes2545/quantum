#!/usr/bin/env python3
"""
pipeline/split.py — แยกข้อความเต็มเล่ม (หลัง clean) ออกเป็นไฟล์ต่อบทตามสารบัญ

ใช้ book.json.chapters (thaiNum + title ต่อบท) เป็นแหล่งความจริงว่าแต่ละบทชื่ออะไร/ลำดับไหน
(ไม่ได้ parse "สารบัญ" ของ PDF เองมาเดาชื่อบท เพราะ book.json ของ P6 เชื่อถือได้กว่าและสัญญาระหว่าง
โมดูล §A.1 กำหนดให้ book.json เป็นแหล่งความจริงของโครงเล่มอยู่แล้ว)

วิธีหาจุดเริ่มเนื้อหาแต่ละบท:
  ข้อความที่ผ่าน clean.py แล้วยังมีโอกาสเหลือช่องว่าง/ตัวอักษรผิดกระจายอยู่ (ดู clean.py docstring
  เรื่องข้อจำกัด) การค้นหาหัวข้อบทแบบ regex ตรงตัวจึงพลาดง่าย — เราจึงค้นหาแบบ "normalize ช่องว่างทิ้ง
  ก่อนค้น" คือสร้างสำเนาข้อความที่ตัดช่องว่างทุกชนิดออกหมด พร้อม index map กลับไปตำแหน่งจริง แล้วค้นหา
  "{thaiNum}.{title}" (ตัดช่องว่างในคำค้นด้วยเช่นกัน) ในสำเนานั้น วิธีนี้ทนต่อช่องว่างงอกที่หลงเหลือจาก
  ขั้น clean ได้โดยไม่ต้องเดา encoding เพิ่ม

  เนื้อหาจริงของ PDF ปกติจะมีชื่อบทปรากฏอย่างน้อย 2 ครั้ง (ครั้งในสารบัญ + ครั้งที่เป็นหัวบทจริงก่อนเนื้อหา)
  เราจึงเลือก "ตำแหน่งสุดท้าย" ที่พบของแต่ละบท เป็นจุดเริ่มเนื้อหาจริง (สารบัญมักกระจุกอยู่ต้นไฟล์)

  ถ้าหาหัวบทไหนไม่เจอเลย -> exit 1 พร้อมบอกรายชื่อบทที่หาไม่เจอ (ตามที่สัญญาระหว่างโมดูล §G กำหนด)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from pipeline import common


def strip_ws_with_map(text: str) -> tuple[str, list[int]]:
    """คืนข้อความที่ตัด whitespace ทุกชนิดออก พร้อม list ที่แปลง index ในข้อความใหม่ -> index เดิม"""
    norm_chars: list[str] = []
    idx_map: list[int] = []
    for i, ch in enumerate(text):
        if ch.isspace():
            continue
        norm_chars.append(ch)
        idx_map.append(i)
    return "".join(norm_chars), idx_map


def strip_ws(s: str) -> str:
    return "".join(ch for ch in s if not ch.isspace())


def find_heading_start(norm: str, idx_map: list[int], thai_num: str, title: str) -> int | None:
    """หาตำแหน่งเริ่มต้น (ในข้อความเดิม) ของหัวข้อบท — คืนตำแหน่งที่พบ 'ล่าสุด' (ท้ายสุด) ถ้าพบหลายครั้ง"""
    candidates = [
        strip_ws(thai_num) + "." + strip_ws(title),
        strip_ws(thai_num) + strip_ws(title),  # เผื่อ '.' หายไปเพราะ font bug
    ]
    for key in candidates:
        if not key:
            continue
        positions = [m.start() for m in re.finditer(re.escape(key), norm)]
        if positions:
            return idx_map[positions[-1]]
    return None


def split_book(
    text: str, chapters: list[dict], overrides: dict[str, str] | None = None
) -> dict[str, str]:
    """คืน dict {chapterSlug: เนื้อหาบทนั้น} — โยน SplitError ถ้าหาบทใดไม่เจอ หรือลำดับสลับกัน

    `overrides` (ถ้ามี — มาจาก --manual-offsets): {chapterSlug: ข้อความค้นหาหัวข้อบทแบบกำหนดเอง}
    ใช้แทน "{thaiNum}.{title}" ของ book.json สำหรับบทนั้นๆ เมื่อ PDF จริงสะกดหัวข้อบทต่างจาก book.json
    (เช่น "วิฒันาการ" ในเนื้อหาจริง vs. "วิวัฒนาการ" ที่ถูกต้องใน book.json) โดยไม่ต้องแก้ book.json
    ที่ P6 เป็นเจ้าของให้สะกดผิดตาม PDF"""
    norm, idx_map = strip_ws_with_map(text)
    overrides = overrides or {}

    starts: dict[str, int] = {}
    not_found: list[str] = []
    for ch in chapters:
        override = overrides.get(ch["slug"])
        if override is not None:
            key = strip_ws(override)
            positions_found = [m.start() for m in re.finditer(re.escape(key), norm)] if key else []
            pos = idx_map[positions_found[-1]] if positions_found else None
        else:
            pos = find_heading_start(norm, idx_map, ch["thaiNum"], ch["title"])
        if pos is None:
            not_found.append(f"{ch['slug']} ({ch['thaiNum']}. {ch['title']})")
        else:
            starts[ch["slug"]] = pos

    if not_found:
        raise SplitError(
            "จับสารบัญไม่ได้ — หาหัวข้อบทต่อไปนี้ในข้อความไม่เจอ:\n  "
            + "\n  ".join(not_found)
            + "\n(ตรวจว่า clean.py ทำงานถูกต้อง หรือชื่อบทใน book.json สะกดตรงกับ PDF จริงหรือไม่ — ถ้า PDF "
            "สะกดต่างจาก book.json จริงๆ ใช้ --manual-offsets FILE.json โดย FILE.json เป็น "
            '{"chNN": "ข้อความที่ปรากฏจริงใน PDF สำหรับหาบทนั้น"} เฉพาะบทที่มีปัญหา)'
        )

    ordered = sorted(chapters, key=lambda c: c["order"])
    positions = [starts[c["slug"]] for c in ordered]
    if positions != sorted(positions):
        raise SplitError(
            "ตำแหน่งหัวข้อบทที่พบไม่เรียงตามลำดับ order ใน book.json — อาจ match ผิดจุด "
            "(เช่นชื่อบทสั้นไปจนไปชนข้อความอื่น) ต้องตรวจด้วยตาแล้วอาจต้องปรับชื่อบทใน book.json "
            'หรือใช้ --manual-offsets FILE.json โดย FILE.json เป็น {"chNN": "ข้อความที่ปรากฏจริงใน PDF"} '
            "เฉพาะบทที่มีปัญหา"
        )

    result: dict[str, str] = {}
    for i, ch in enumerate(ordered):
        start = starts[ch["slug"]]
        end = positions[i + 1] if i + 1 < len(positions) else len(text)
        result[ch["slug"]] = text[start:end].strip() + "\n"
    return result


class SplitError(RuntimeError):
    pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="แยกข้อความเต็มเล่มเป็นไฟล์ต่อบท")
    parser.add_argument("--book", required=True, help="bookSlug เช่น trilaksana-quantum")
    parser.add_argument(
        "--in", dest="in_path", default=None, help="ไฟล์ input (default: raw/book-cleaned.txt)"
    )
    parser.add_argument(
        "--manual-offsets",
        dest="manual_offsets_path",
        default=None,
        help=(
            "ไฟล์ JSON {chapterSlug: ข้อความที่ปรากฏจริงใน PDF} ใช้แทนการค้นด้วย book.json "
            'เฉพาะบทที่ระบุ (เช่น {"ch08": "วิฒันาการ"}) สำหรับกรณี PDF สะกดหัวข้อบทต่างจาก book.json'
        ),
    )
    args = parser.parse_args(argv)

    book_slug = args.book
    book = common.load_book(book_slug)
    chapters = book.get("chapters", [])
    if not chapters:
        common.die(f"book.json ของ '{book_slug}' ยังไม่มี chapters[] — ให้ P6 เติมก่อน")

    for ch in chapters:
        if not common.CHAPTER_SLUG_RE.match(ch.get("slug", "")):
            common.die(f"chapterSlug ผิดรูปแบบใน book.json: '{ch.get('slug')}' (ต้องเป็น ch01, ch02, ...)")

    overrides: dict[str, str] = {}
    if args.manual_offsets_path:
        overrides_path = Path(args.manual_offsets_path)
        loaded = common.load_json(overrides_path)
        if loaded is None:
            common.die(f"ไม่พบไฟล์ --manual-offsets: {overrides_path}")
        overrides = loaded

    in_path = Path(args.in_path) if args.in_path else common.raw_book_cleaned_txt_path(book_slug)
    if not in_path.exists():
        common.die(f"ไม่พบไฟล์ input: {in_path} (รัน clean.py --book {book_slug} ก่อน)")

    text = in_path.read_text(encoding="utf-8")

    try:
        chapter_texts = split_book(text, chapters, overrides)
    except SplitError as e:
        common.die(str(e))
        return 1  # unreachable

    raw_dir = common.raw_dir(book_slug)
    raw_dir.mkdir(parents=True, exist_ok=True)
    for slug, content in chapter_texts.items():
        out_path = common.raw_chapter_txt_path(book_slug, slug)
        out_path.write_text(content, encoding="utf-8")
        common.eprint(f"เขียน {out_path} ({len(content):,} ตัวอักษร)")

    common.eprint(f"แยกสำเร็จ {len(chapter_texts)} บท — ตรวจเนื้อหาด้วยตาก่อนรัน author.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

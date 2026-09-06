"""pipeline/toc_init.py — สร้าง book.json.chapters[] + stub chNN.json (status building) + raw/_toc.json
จาก "สเปกสารบัญ" ที่คนเขียนหลังอ่านสารบัญของ PDF (เล่ม 2–9)

input (JSON):
{ "preface": {"startPage": 4}, "endPage": 238,
  "chapters": [ {"title": "ฟิสิกส์ควอนตัม อภิปรัชญา พุทธศาสน์", "startPage": 8, "source": "1"}, ... ] }

- slug/order/thaiNum ตั้งให้อัตโนมัติ (ch01.., ๑..) — `source` = เลขบทในสารบัญต้นฉบับที่รวมอยู่ในบทเรียนนี้
- sub ของบทตั้งเป็น placeholder — workflow เขียนบทจะเขียน sub จริงใน chNN.json แล้ว normalize.mjs sync กลับ
- ไม่แตะบทที่มี chNN.json อยู่แล้วและ status ไม่ใช่ building (กันเขียนทับงานที่ author แล้ว)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import common

PLACEHOLDER_SUB = "กำลังเรียบเรียง"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="เติม chapters[] ของ book.json จากสเปกสารบัญ")
    parser.add_argument("--book", required=True)
    parser.add_argument("--toc", required=True, help="ไฟล์สเปกสารบัญ (JSON)")
    args = parser.parse_args(argv)

    slug = args.book
    book = common.load_book(slug)
    spec = common.load_json(Path(args.toc))
    if not spec or not spec.get("chapters"):
        common.die("สเปกสารบัญว่าง")

    chapters_meta = []
    toc_chapters = []
    for i, ch in enumerate(spec["chapters"], start=1):
        cslug = common.chapter_slug_for_order(i)
        meta = {"slug": cslug, "order": i, "thaiNum": common.to_thai_num(i), "title": ch["title"].strip(),
                "sub": PLACEHOLDER_SUB, "status": "building"}
        path = common.chapter_json_path(slug, cslug)
        existing = common.load_json(path) if path.exists() else None
        if existing and existing.get("status") != "building":
            # เก็บของเดิมไว้ทั้งหมด (บทที่ author แล้ว)
            meta = {k: existing[k] for k in ("slug", "order", "thaiNum", "title", "sub", "status")}
        else:
            stub = {"book": slug, **meta, "summary": PLACEHOLDER_SUB, "keyPoints": [], "keywords": [],
                    "suggestions": []}
            common.save_json(path, stub)
        chapters_meta.append(meta)
        toc_chapters.append({"slug": cslug, "startPage": int(ch["startPage"]), "source": ch.get("source", str(i)),
                             "title": meta["title"]})

    book["chapters"] = chapters_meta
    book["status"] = "ready" if any(c["status"] == "ready" for c in chapters_meta) else "building"
    common.save_json(common.book_json_path(slug), book)

    toc_out = {"pageOffset": int(spec.get("pageOffset", 1)), "endPage": int(spec["endPage"]), "chapters": toc_chapters}
    if spec.get("preface"):
        toc_out["preface"] = spec["preface"]
    raw = common.raw_dir(slug)
    raw.mkdir(parents=True, exist_ok=True)
    (raw / "_toc.json").write_text(json.dumps(toc_out, ensure_ascii=False, indent=2), encoding="utf-8")
    common.eprint(f"[toc_init] {slug}: {len(chapters_meta)} บท → book.json, chNN.json (stub), raw/_toc.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())

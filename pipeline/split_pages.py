"""pipeline/split_pages.py — แยกบทด้วย "เลขหน้าจากสารบัญ" (ใช้กับเล่ม 2–9)

ทำไมไม่ใช้ split.py: เล่ม 2–9 ใช้เลขอารบิก/คำว่า Part ในหัวข้อบท ชื่อบทสั้นและมักถูกอ้างซ้ำในเนื้อหา
การค้นหาหัวข้อด้วยข้อความจึงพลาดง่าย ขณะที่สารบัญของทุกเล่มบอกเลขหน้าเริ่มต้นของแต่ละบทชัดเจน
และเลขหน้าที่พิมพ์ = ดัชนีหน้า PDF + 1 (ตรวจกับเล่ม 1.2/1.3/1.8 แล้ว) จึงตัดบทจากหน้า PDF ตรงๆ

input : content/books/{slug}/raw/_toc.json
        { "pageOffset": 1,                     # printedPage = pdfIndex + pageOffset (default 1)
          "preface":  { "startPage": 4 },      # ไม่บังคับ → raw/ch00-preface.txt
          "endPage": 238,                      # หน้าพิมพ์สุดท้ายของเนื้อหา (ไม่รวม)
          "chapters": [ { "slug": "ch01", "startPage": 8, "source": "1" }, ... ] }
output: raw/chNN.txt (ผ่าน clean.clean_text แล้ว), raw/ch00-preface.txt, raw/_split-report.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from . import clean, common

PAGE_NUM_RE = re.compile(r"^\s*(\d{1,3})\s*$", re.M)


def page_text(doc, idx: int) -> str:
    return doc[idx].get_text()


def printed_number_on(doc, idx: int) -> int | None:
    m = PAGE_NUM_RE.findall(page_text(doc, idx))
    return int(m[0]) if m else None


def extract_range(doc, start_printed: int, end_printed: int, offset: int) -> str:
    """ข้อความของหน้าพิมพ์ [start, end) — end เป็น exclusive"""
    parts = []
    for printed in range(start_printed, end_printed):
        idx = printed - offset
        if 0 <= idx < len(doc):
            parts.append(page_text(doc, idx))
    return "\n".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="แยกบทด้วยเลขหน้าจาก raw/_toc.json")
    parser.add_argument("--book", required=True)
    args = parser.parse_args(argv)

    try:
        import fitz  # type: ignore
    except ImportError:
        common.die("ต้องมี pymupdf: pip install -r pipeline/requirements.txt")

    slug = args.book
    book = common.load_book(slug)
    toc_path = common.raw_dir(slug) / "_toc.json"
    toc = common.load_json(toc_path)
    if not toc:
        common.die(f"ไม่พบ {toc_path}")
    pdf = common.SOURCE_DIR / book["sourcePdf"]["file"]
    if not pdf.exists():
        common.die(f"ไม่พบ PDF {pdf}")

    doc = fitz.open(pdf)
    offset = int(toc.get("pageOffset", 1))
    chapters = toc["chapters"]
    end_page = int(toc.get("endPage", len(doc) + offset - 1))
    words = clean.load_fixture_words()

    # ตรวจ offset: หน้าเริ่มบทแรกควรมีเลขหน้าพิมพ์ตรงกับ startPage (ถ้าหน้านั้นพิมพ์เลข)
    first = chapters[0]["startPage"]
    got = printed_number_on(doc, first - offset)
    if got is not None and got != first:
        common.eprint(f"[split_pages] คำเตือน: หน้า PDF index {first - offset} พิมพ์เลข {got} ไม่ใช่ {first} — ตรวจ pageOffset")

    report: dict = {"pdfPages": len(doc), "pageOffset": offset, "endPage": end_page, "chapters": {}}
    raw_dir = common.raw_dir(slug)
    raw_dir.mkdir(parents=True, exist_ok=True)

    def write(name: str, start: int, end: int, extra: dict | None = None):
        raw = extract_range(doc, start, end, offset)
        cleaned, rep = clean.clean_text(raw, words)
        (raw_dir / f"{name}.txt").write_text(cleaned, encoding="utf-8")
        entry = {"startPage": start, "endPage": end, "pages": end - start, "chars": len(cleaned),
                 "preview": cleaned.strip().split("\n")[0][:60]}
        if extra:
            entry.update(extra)
        if len(cleaned) < 3000:
            entry["warning"] = "สั้นกว่า 3,000 ตัวอักษร — ตรวจว่าตัดถูกช่วง"
        report["chapters"][name] = entry
        return entry

    preface = toc.get("preface")
    if preface:
        write("ch00-preface", int(preface["startPage"]), int(chapters[0]["startPage"]))

    for i, ch in enumerate(chapters):
        if not common.CHAPTER_SLUG_RE.match(ch["slug"]):
            common.die(f"slug ผิดรูปแบบ: {ch['slug']}")
        start = int(ch["startPage"])
        end = int(chapters[i + 1]["startPage"]) if i + 1 < len(chapters) else end_page
        if end <= start:
            common.die(f"{ch['slug']}: ช่วงหน้าไม่ถูกต้อง {start}→{end}")
        e = write(ch["slug"], start, end, {"source": ch.get("source")})
        common.eprint(f"[split_pages] {ch['slug']} หน้า {start}-{end - 1} ({e['pages']} หน้า, {e['chars']:,} ตัวอักษร){' ⚠ ' + e['warning'] if 'warning' in e else ''}")

    (raw_dir / "_split-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    common.eprint(f"[split_pages] เขียน {len(chapters)} บท → {raw_dir}/chNN.txt และ _split-report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())

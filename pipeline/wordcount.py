#!/usr/bin/env python3
"""pipeline/wordcount.py — วิธีนับคำ "มาตรฐานเดียว" สำหรับกฎ §9.1 ข้อ 9 (900–1,400 คำต่อบท)

ทำไมต้องมี: reviewer แต่ละรอบนับด้วยวิธีต่างกัน (newmm / longest / mm, รวม-ไม่รวม h2 หรือ bullets)
ทำให้บทเดียวกันได้ 1,255 บ้าง 1,417 บ้าง — ตกลงใช้วิธีนี้วิธีเดียว:

  • tokenizer: pythainlp word_tokenize(engine="newmm")
  • นับเฉพาะ sections[]: paragraphs + callout.text + bullets  (ไม่รวม h2, interactive, exercise, questions)
  • ตัด HTML tag ออกก่อน, ไม่นับ token ที่ไม่มีตัวอักษร/ตัวเลขเลย (เว้นวรรค, เครื่องหมาย)

ใช้:  .venv/bin/python -m pipeline.wordcount content/books/trilaksana-quantum/ch03.json [...]
      .venv/bin/python -m pipeline.wordcount content/books/trilaksana-quantum      (ทุกบทในเล่ม)
exit 1 ถ้ามีบท status=ready ที่อยู่นอกช่วง 900–1,400 (บท 1–2 ที่คัดจาก prototype ตรงๆ ยกเว้น — ระบุด้วย --allow ch01,ch02)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

LIMIT = (900, 1400)
TAG_RE = re.compile(r"<[^>]+>")
HAS_TEXT_RE = re.compile(r"[0-9A-Za-z฀-๿]")


def _tokenize(text: str) -> list[str]:
    try:
        from pythainlp.tokenize import word_tokenize  # type: ignore
    except ImportError:  # pragma: no cover
        sys.exit("ต้องมี pythainlp: .venv/bin/pip install -r pipeline/requirements.txt")
    return [t for t in word_tokenize(text, engine="newmm") if HAS_TEXT_RE.search(t)]


def count_chapter(ch: dict) -> dict:
    parts: list[str] = []
    for sec in ch.get("sections", []):
        parts.extend(sec.get("paragraphs", []))
        if sec.get("callout") and sec["callout"].get("text"):
            parts.append(sec["callout"]["text"])
        parts.extend(sec.get("bullets", []) or [])
    text = TAG_RE.sub(" ", " ".join(parts))
    words = len(_tokenize(text))
    return {"words": words, "sections": len(ch.get("sections", [])), "inRange": LIMIT[0] <= words <= LIMIT[1]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("paths", nargs="+", help="chNN.json หรือโฟลเดอร์เล่ม")
    ap.add_argument("--allow", default="ch01,ch02", help="slug ที่ยกเว้นกฎความยาว (คั่นด้วย ,)")
    args = ap.parse_args()
    allow = {s.strip() for s in args.allow.split(",") if s.strip()}

    files: list[Path] = []
    for p in map(Path, args.paths):
        files.extend(sorted(p.glob("ch[0-9][0-9].json")) if p.is_dir() else [p])

    bad = 0
    print(f"{'บท':6} {'status':7} {'คำ':>6}  ช่วง {LIMIT[0]}–{LIMIT[1]}")
    for f in files:
        ch = json.loads(f.read_text(encoding="utf-8"))
        r = count_chapter(ch)
        slug = ch.get("slug", f.stem)
        flag = "✓" if r["inRange"] else ("(ยกเว้น)" if slug in allow else "✗")
        if flag == "✗" and ch.get("status") == "ready":
            bad += 1
        print(f"{slug:6} {ch.get('status',''):7} {r['words']:6}  {flag}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

# -*- coding: utf-8 -*-
"""pipeline/copyscan.py — หาช่วงข้อความที่คัดลอกจากต้นฉบับมาตรงๆ

กฎ §9.1 ข้อ 1 ห้ามลอกต่อเนื่องเกิน ~12 คำ วิธีตรวจเชิงกลที่ใช้กับเล่ม 7 คือ
ตัดทุกอย่างที่ไม่ใช่อักษรไทยทิ้ง (ช่องว่าง แท็ก เครื่องหมาย) แล้วหา substring
ร่วมที่ยาวเกินเกณฑ์ระหว่างบทกับ raw/chNN.txt — 60 ตัวอักษรไทย ≈ 10-12 คำ

ข้อยกเว้นตามสเปก: พุทธพจน์/คำพูดที่ใส่เครื่องหมายคำพูดและระบุผู้พูด (ฟิลด์ quote
และข้อความในเครื่องหมายคำพูด) — สคริปต์ทำเครื่องหมาย [ยกเว้นได้] ให้ แต่ไม่ตัดออกเอง

    python -m pipeline.copyscan --book quantum-brain-success [--chapter ch01] [--min 60]
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
THAI_ONLY = re.compile(r"[^ก-๛]")
TAG = re.compile(r"<[^>]+>")
QUOTED = re.compile(r"[\"“”][^\"“”]{20,}[\"“”]")


def norm(s: str) -> str:
    return THAI_ONLY.sub("", TAG.sub("", s))


def walk(node, path=""):
    """คืน (path, string) ของทุก string ในบท"""
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from walk(v, f"{path}[{i}]")
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, f"{path}.{k}" if path else k)


def spans(text: str, grams: set, n: int):
    """ช่วงที่ substring ยาว n ตัวอักษรตรงกับ raw — รวมช่วงที่ทับกันเป็นช่วงเดียว"""
    hits = [i for i in range(len(text) - n + 1) if text[i : i + n] in grams]
    out = []
    for i in hits:
        if out and i <= out[-1][1]:
            out[-1][1] = i + n
        else:
            out.append([i, i + n])
    return [(a, b) for a, b in out]


def scan_chapter(ch_path: Path, raw_path: Path, n: int):
    ch = json.loads(ch_path.read_text(encoding="utf-8"))
    raw = norm(raw_path.read_text(encoding="utf-8"))
    grams = {raw[i : i + n] for i in range(len(raw) - n + 1)}
    found = []
    for path, s in walk(ch):
        if path.startswith(("book", "slug", "status", "reviewedBy")):
            continue
        # คำพูดที่ใส่เครื่องหมายคำพูดเข้าข้อยกเว้น (ข) — ตัดออกเป็นชิ้นต่างหาก
        # เพื่อไม่ให้ข้อความเล่าเรื่องรอบๆ ต่อกับตัวคำพูดจนนับเป็นช่วงเดียว
        parts, last = [], 0
        for m in QUOTED.finditer(s):
            parts.append((s[last : m.start()], False))
            parts.append((m.group(0), True))
            last = m.end()
        parts.append((s[last:], path.startswith("quote")))
        for seg, exempt in parts:
            t = norm(seg)
            if len(t) < n:
                continue
            for a, b in spans(t, grams, n):
                piece = t[a:b]
                found.append((path, len(piece), piece, exempt or path.startswith("quote")))
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter", help="เช่น ch01 (ไม่ใส่ = ทุกบทที่มี raw)")
    ap.add_argument("--min", type=int, default=60, help="ความยาวขั้นต่ำเป็นอักษรไทย (ดีฟอลต์ 60 ≈ 10-12 คำ)")
    a = ap.parse_args()

    book = ROOT / "content" / "books" / a.book
    chapters = sorted(book.glob(f"{a.chapter or 'ch'}*.json"))
    worst = 0
    for ch_path in chapters:
        raw_path = book / "raw" / f"{ch_path.stem}.txt"
        if not raw_path.exists():
            continue
        found = scan_chapter(ch_path, raw_path, a.min)
        flagged = [f for f in found if not f[3]]
        worst = max(worst, max((f[1] for f in flagged), default=0))
        mark = "✗" if flagged else "✓"
        print(f"{mark} {ch_path.stem}: {len(flagged)} ช่วงที่ต้องแก้" + (f" (ยกเว้นได้ {len(found)-len(flagged)})" if len(found) != len(flagged) else ""))
        for path, ln, piece, ok in found:
            print(f"    {'[ยกเว้นได้] ' if ok else ''}{path} — {ln} ตัวอักษร: {piece[:120]}")
    print(f"\nช่วงยาวสุดที่ต้องแก้: {worst} ตัวอักษร (เกณฑ์ {a.min})")
    return 1 if worst else 0


if __name__ == "__main__":
    raise SystemExit(main())

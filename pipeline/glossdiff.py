# -*- coding: utf-8 -*-
"""pipeline/glossdiff.py — หาศัพท์ที่ใช้ร่วมหลายเล่ม แต่นิยามไม่ตรงกัน

ทำไมต้องมีประตูนี้: web/build.js mergeGlobalGlossary เผยแพร่ def ของเล่มที่ order
น้อยที่สุดขึ้นหน้าอภิธานศัพท์รวม ส่วน terms[] ในแต่ละบทใช้ def ของเล่มตัวเอง
ผู้อ่านคนเดียวกันจึงอาจเห็นคำอธิบายสองแบบของศัพท์เดียวกัน ขึ้นกับว่ากดจากตรงไหน
และการแก้นิยามระดับชุดที่ลืมไปเล่มหนึ่ง จะไม่มีอะไรจับได้เลย — เกิดมาแล้วสองครั้ง
คือ 'เอนโทรปี' และ 'การซ้อนทับทางควอนตัม' ที่ตกหล่นเล่ม 8 ไว้

นิยามที่ต่างกันไม่ใช่ข้อผิดพลาดเสมอไป แต่ละเล่มเน้นด้านที่บทของตัวเองใช้ได้ (เช่น
'กรดอะมิโน' เล่ม 1 เน้นการทดลองมิลเลอร์ เล่ม 5 เน้นอุกกาบาต) ประตูนี้จึงรายงาน
เป็นรายการให้ตรวจ ไม่ใช่คำเตือน และ exit 0 เสมอ เว้นแต่สั่ง --strict
สิ่งที่ต้องมองหาเวลาอ่านผลคือ (1) นิยามที่ขัดกันเอง (2) นิยามที่ขาดตัวระบุสถานะ
ว่าข้อเสนอนั้นยังถกเถียง ทั้งที่อีกเล่มระบุไว้ (3) ตัวชี้ 'บทถัดไป/บทที่ N' ที่ผิดเมื่อข้ามเล่ม

    python -m pipeline.glossdiff [--term ศัพท์] [--strict]
"""
import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "content" / "books"
# ตัวชี้ที่ผิดทันทีเมื่อศัพท์ถูกใช้ข้ามเล่ม เพราะ "บทถัดไป" ของเล่มหนึ่งไม่ใช่ของอีกเล่ม
RELREF = re.compile(r"บทถัดไป|บทก่อนหน้า|บทที่แล้ว")
# "บทที่ N" ผิดเฉพาะตอนที่ไม่ได้บอกว่าเล่มไหน — ถ้านิยามระบุเล่มไว้ ตัวชี้ก็ชี้ถูกข้ามเล่ม
# (แก้ไปแล้วรอบหนึ่งเมื่อ 22 ก.ย. กฎนี้จึงต้องไม่ยิงใส่ของที่แก้แล้ว)
ABSREF = re.compile(r"บทที่\s*[๐-๙0-9]")


def badref(d: str):
    m = RELREF.search(d)
    if m:
        return m.group()
    m = ABSREF.search(d)
    if m and "เล่ม" not in d:
        return m.group() + " (ไม่ได้ระบุเล่ม)"
    return None


def load():
    order, defs, kinds = {}, defaultdict(dict), defaultdict(dict)
    for bj in sorted(BOOKS.glob("*/book.json")):
        slug = bj.parent.name
        order[slug] = json.loads(bj.read_text("utf-8"))["order"]
        gj = bj.parent / "glossary.json"
        if not gj.exists():
            continue
        for t in json.loads(gj.read_text("utf-8"))["terms"]:
            defs[t["term"]][slug] = t["def"]
            kinds[t["term"]][slug] = t["kind"]
    return order, defs, kinds


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", help="ดูเฉพาะศัพท์นี้")
    ap.add_argument("--strict", action="store_true", help="exit 1 เมื่อพบข้อที่ผิดแน่ๆ")
    args = ap.parse_args()

    order, defs, kinds = load()
    shared = {t: m for t, m in defs.items() if len(m) > 1}
    hard = 0
    divergent = 0

    for term in sorted(shared, key=lambda t: -len(set(shared[t].values()))):
        m = shared[term]
        if args.term and term != args.term:
            continue
        variants = defaultdict(list)
        for slug, d in sorted(m.items(), key=lambda kv: order[kv[0]]):
            variants[d].append(slug)
        if len(variants) < 2 and not args.term:
            continue
        if len(variants) > 1:
            divergent += 1
        print(f"\n### {term}  — {len(m)} เล่ม / {len(variants)} นิยาม")
        for i, (d, slugs) in enumerate(variants.items()):
            tag = "เผยแพร่ในอภิธานศัพท์รวม" if i == 0 else "เห็นเฉพาะตอนกด dfn ในเล่มนี้"
            print(f"  [{tag}] {', '.join(f'{order[s]}:{s}' for s in slugs)}")
            print(f"    {d}")
            bad = badref(d)
            if bad:
                print(f"    ‼ ตัวชี้ข้ามบทในนิยามที่ใช้ร่วมหลายเล่ม — {bad}")
                hard += 1
        ks = set(kinds[term].values())
        if len(ks) > 1:
            print(f"    ‼ kind ไม่ตรงกัน: {ks}")
            hard += 1

    # นิยามพูดว่า "บทนี้" แต่ถูกใช้หลายบทในเล่มเดียวกัน — ผิดในทุกบทยกเว้นบทเดียว
    use = defaultdict(set)
    for ch in BOOKS.glob("*/ch*.json"):
        for t in json.loads(ch.read_text("utf-8")).get("terms", []):
            use[(ch.parent.name, t["term"])].add(ch.stem)
    for gj in sorted(BOOKS.glob("*/glossary.json")):
        for t in json.loads(gj.read_text("utf-8"))["terms"]:
            chs = use[(gj.parent.name, t["term"])]
            if "บทนี้" in t["def"] and len(chs) > 1 and (not args.term or args.term == t["term"]):
                print(f"‼ {gj.parent.name} · {t['term']}: นิยามพูดว่า 'บทนี้' แต่ใช้ใน {sorted(chs)}")
                hard += 1

    if not args.term:
        print(
            f"\nศัพท์ที่ใช้ร่วมหลายเล่ม {len(shared)} · นิยามไม่ตรงกัน {divergent} · "
            f"ข้อที่ผิดแน่ๆ {hard}"
        )
    return 1 if (args.strict and hard) else 0


if __name__ == "__main__":
    raise SystemExit(main())

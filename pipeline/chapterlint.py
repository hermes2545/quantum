# -*- coding: utf-8 -*-
"""pipeline/chapterlint.py — เช็คลิสต์เชิงกลก่อนตรวจบทด้วยสายตา

รวมข้อผิดพลาดที่ซ้ำๆ จากรอบตรวจเล่ม 2 บท 1-6 ไว้เป็นรายงานเดียว ไม่ตัดสินแทนคน
แต่ชี้จุดที่ต้องเปิดดู: ศัพท์ที่ห่อ <dfn> ครั้งแรกโดยรอบข้างไม่มีคำขยาย, เลนส์ที่
ไม่ได้พูดในนามป้ายของตัวเอง, object ที่ซ้ำสถานการณ์กับ exercise, วลีที่ยัดคำใส่ปาก
หนังสือ, ตัวเลขในบทที่ไม่มีใน raw และ shape ที่ซ้ำกัน

    python -m pipeline.chapterlint --book <slug> [--chapter chNN]
"""
import argparse
import difflib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAG = re.compile(r"<[^>]+>")
DFN = re.compile(r'<dfn data-term="([^"]+)"[^>]*>(.*?)</dfn>', re.S)
THAI = re.compile(r"[^ก-๛]")

# วลีที่มักยัดคำใส่ปากหนังสือ หรือเขียนข้อเสนอเป็นข้อสรุป
SUSPECT = ["หนังสือเตือน", "ย้ำมาตั้งแต่ต้น", "ชี้ชัด", "พิสูจน์แล้วว่า", "ได้จริง", "แน่นอนว่า", "ทุกคนรู้ดีว่า"]
HEDGE = ["ในกรอบที่หนังสือเสนอ", "สมมติฐาน", "ยังไม่ใช่ข้อสรุป", "ยังไม่ยุติ", "หนังสือเสนอ"]
# คำที่เลนส์แต่ละอันควรพูดถึง (ป้าย a/d/n ของเล่มนี้)
LENS_HINTS = {"a": ["เกิด", "ดับ", "ต่อเนื่อง", "ไม่หยุด"], "d": ["แผ่", "ส่ง", "รังสี", "ถึงคนอื่น", "รอบตัว"],
              "n": ["บุญ", "สติ", "พอเพียง", "ธรรม"]}


def plain(s):
    return TAG.sub("", s)


def strings(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from strings(v, f"{path}[{i}]")
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from strings(v, f"{path}.{k}" if path else k)


def lint(ch_path: Path, raw_path: Path):
    ch = json.loads(ch_path.read_text(encoding="utf-8"))
    raw = raw_path.read_text(encoding="utf-8") if raw_path.exists() else ""
    out = []

    # 1. ศัพท์ที่ห่อครั้งแรก — พิมพ์บริบทให้ตรวจว่ามีคำขยายไหม (§9.1 ข้อ 3)
    body = "\n".join(v for p, v in strings(ch) if p.startswith("sections"))
    seen = []
    for m in DFN.finditer(body):
        term = m.group(1)
        if term in seen:
            continue
        seen.append(term)
        after = plain(body[m.end(): m.end() + 90]).replace("\n", " ")
        out.append(f"  dfn ครั้งแรก · {term} → …{after}")

    # 2. เลนส์พูดในนามป้ายของตัวเองไหม + shape ซ้ำ (กับดักข้อ 4)
    ix = ch.get("interactive") or {}
    cfg = ix.get("config") or {}
    objs = cfg.get("objects") or []
    shapes = [o.get("shape") for o in objs]
    dup = {s for s in shapes if shapes.count(s) > 1}
    if dup:
        out.append(f"  ⚠ shape ซ้ำ {sorted(dup)} จาก {shapes}")
    for o in objs:
        for k, hints in LENS_HINTS.items():
            text = (o.get("lenses") or {}).get(k, "")
            if text and not any(h in text for h in hints):
                out.append(f"  ⚠ เลนส์ {o.get('key')}.{k} ไม่มีคำของป้ายเลย ({'/'.join(hints[:3])}) → {text[:70]}")

    # 3. object ซ้ำสถานการณ์กับ exercise.options (กับดักข้อ 4)
    opts = [o.get("name", "") for o in (ch.get("exercise") or {}).get("options", [])]
    for o in objs:
        for opt in opts:
            r = difflib.SequenceMatcher(None, THAI.sub("", o.get("name", "")), THAI.sub("", opt)).ratio()
            if r > 0.45:
                out.append(f"  ⚠ object '{o.get('name')}' ใกล้ exercise option '{opt}' (ratio {r:.2f})")

    # 4. วลีที่ยัดคำใส่ปากหนังสือ / เขียนข้อเสนอเป็นข้อสรุป
    for path, s in strings(ch):
        for w in SUSPECT:
            if w in s:
                i = s.index(w)
                out.append(f"  ⚠ '{w}' ที่ {path} → …{plain(s[max(0,i-40):i+60])}…")

    # 5. ตัวบ่งสถานะสมมติฐาน มีกี่จุด และอยู่ใน interactive/exercise ด้วยไหม (§9.1 ข้อ 7)
    where = {"sections": 0, "interactive": 0, "exercise": 0, "อื่นๆ": 0}
    for path, s in strings(ch):
        if any(h in s for h in HEDGE):
            key = path.split(".")[0].split("[")[0]
            where[key if key in where else "อื่นๆ"] += 1
    out.append(f"  ตัวบ่งสถานะ: {where}")

    # 6. ตัวเลขในบทที่หาไม่เจอใน raw (§9.1 ข้อ 6)
    if raw:
        NUM = re.compile(r"\d[\d,\.]*|ล้านล้าน|แสนล้าน|พันล้าน|ร้อยล้าน|แสนโกฏิ|โกฏิ")
        rawnums = set(NUM.findall(raw.replace(",", "")))
        chnums = {}
        for path, s in strings(ch):
            if path.startswith(("book", "slug", "reviewed")):
                continue
            for n in NUM.findall(s.replace(",", "")):
                chnums.setdefault(n, path)
        missing = {n: p for n, p in chnums.items() if n not in rawnums}
        if missing:
            out.append(f"  ⚠ ตัวเลขที่ไม่มีใน raw: " + ", ".join(f"{n} ({p})" for n, p in missing.items()))

    # 7. quote box
    q = ch.get("quote")
    out.append(f"  quote: {'—' if not q else q.get('source')}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter")
    a = ap.parse_args()
    book = ROOT / "content" / "books" / a.book
    for ch_path in sorted(book.glob(f"{a.chapter or 'ch'}*.json")):
        print(f"\n=== {ch_path.stem} ===")
        for line in lint(ch_path, book / "raw" / f"{ch_path.stem}.txt"):
            print(line)


if __name__ == "__main__":
    main()

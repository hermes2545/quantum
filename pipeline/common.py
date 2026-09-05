"""
pipeline/common.py — path helper และ utility ที่ทุกสคริปต์ใน pipeline/ ใช้ร่วมกัน

อ้างอิง: docs/handoff-spec.md §8, §10, §11 และสัญญาระหว่างโมดูล §A, §G
ไม่ import อะไรจาก web/** หรือ proxy/** (pipeline ห้ามยุ่งกับ 2 package นั้น ตาม §G)
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Path resolution — ยึด root ของ repo จากตำแหน่งไฟล์นี้ (pipeline/common.py)
# เพื่อให้รันได้ทั้งจาก `python3 -m pipeline.xxx` (cwd=root) และรันตรงจาก path ใดก็ได้
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
CONTENT_DIR = ROOT / "content"
BOOKS_DIR = CONTENT_DIR / "books"
SOURCE_DIR = CONTENT_DIR / "source"
SCHEMA_DIR = CONTENT_DIR / "schema"
WEB_SRC_DIR = ROOT / "web" / "src"

# ---------------------------------------------------------------------------
# ตัวระบุ (identifier) ตามสัญญาระหว่างโมดูล §0 — ห้ามเพี้ยน
# ---------------------------------------------------------------------------
BOOK_SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
CHAPTER_SLUG_RE = re.compile(r"^ch[0-9]{2}$")

THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙"


def to_thai_num(n: int) -> str:
    """แปลงเลขอารบิก -> เลขไทย เช่น 1 -> '๑', 10 -> '๑๐' (ตาม A-01/§0 thaiNum)"""
    if n < 0:
        raise ValueError(f"to_thai_num: ต้องเป็นจำนวนไม่ติดลบ ได้ {n}")
    return "".join(THAI_DIGITS[int(d)] for d in str(n))


def chapter_slug_for_order(order: int) -> str:
    """เลขลำดับบท -> chapterSlug เช่น 1 -> 'ch01' (regex ^ch[0-9]{2}$ ตาม §0)"""
    return f"ch{order:02d}"


def eprint(*args: Any) -> None:
    print("[pipeline]", *args, file=sys.stderr)


def die(message: str, code: int = 1) -> None:
    eprint("ผิดพลาด:", message)
    sys.exit(code)


# ---------------------------------------------------------------------------
# Path helpers ต่อเล่ม/บท (ตาม §0 และ §A ของสัญญาระหว่างโมดูล)
# ---------------------------------------------------------------------------
def book_dir(book_slug: str) -> Path:
    return BOOKS_DIR / book_slug


def raw_dir(book_slug: str) -> Path:
    return book_dir(book_slug) / "raw"


def book_json_path(book_slug: str) -> Path:
    return book_dir(book_slug) / "book.json"


def chapter_json_path(book_slug: str, chapter_slug: str) -> Path:
    return book_dir(book_slug) / f"{chapter_slug}.json"


def glossary_json_path(book_slug: str) -> Path:
    return book_dir(book_slug) / "glossary.json"


def raw_book_txt_path(book_slug: str) -> Path:
    return raw_dir(book_slug) / "book.txt"


def raw_book_cleaned_txt_path(book_slug: str) -> Path:
    return raw_dir(book_slug) / "book-cleaned.txt"


def raw_chapter_txt_path(book_slug: str, chapter_slug: str) -> Path:
    return raw_dir(book_slug) / f"{chapter_slug}.txt"


def clean_report_path(book_slug: str) -> Path:
    return raw_dir(book_slug) / "clean-report.txt"


def interactive_module_path(book_slug: str, chapter_slug: str) -> Path:
    """path ของโมดูล interactive เฉพาะบท (เขียนมือโดย P5) ตาม §E.4/§8"""
    return WEB_SRC_DIR / "js" / "interactives" / book_slug / f"{chapter_slug}.js"


# ---------------------------------------------------------------------------
# JSON I/O — UTF-8 ไม่มี BOM, indent 2, ไม่มี trailing comma (json.dump ทำให้อยู่แล้ว),
# ห้าม sort_keys เพราะสัญญาระหว่างโมดูล §A ต้องการ key เรียงตามที่ระบุในเอกสาร
# ไม่ใช่เรียงตามตัวอักษร — ผู้เรียกต้องสร้าง dict ตามลำดับ key ที่ถูกต้องเอง
# ---------------------------------------------------------------------------
def load_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_book(book_slug: str) -> dict:
    """โหลด content/books/{slug}/book.json — เจ้าของไฟล์นี้คือ P6 (ดูสัญญาระหว่างโมดูล §A.1)
    pipeline อ่านอย่างเดียว ไม่เขียนทับ book.json เด็ดขาด"""
    if not BOOK_SLUG_RE.match(book_slug):
        die(
            f"'{book_slug}' ไม่ใช่ bookSlug ที่ถูกต้อง (ต้องเป็น kebab-case ASCII เช่น trilaksana-quantum)"
        )
    path = book_json_path(book_slug)
    data = load_json(path)
    if data is None:
        die(
            f"ไม่พบ {path}\n"
            f"  book.json เป็นไฟล์ที่ทีม content (P6) เป็นเจ้าของ — pipeline อ่านอย่างเดียว\n"
            f"  ต้องมี book.json อย่างน้อยที่มี slug/order/title/author/chapters[] ก่อนจะรัน pipeline ได้"
        )
    return data


def find_chapter_meta(book: dict, chapter_slug: str) -> Optional[dict]:
    for ch in book.get("chapters", []):
        if ch.get("slug") == chapter_slug:
            return ch
    return None


# ---------------------------------------------------------------------------
# jsonschema validation (best-effort) — content/schema/*.schema.json เป็นของ P6
# ถ้ายังไม่มีไฟล์ schema (เช่นระหว่างพัฒนา P3 ขนานกับ P6) ให้ข้ามแบบมีคำเตือน
# ไม่ทำให้ pipeline ใช้งานไม่ได้เพราะรอไฟล์ของทีมอื่น
# ---------------------------------------------------------------------------
def validate_against_schema(instance: dict, schema_filename: str) -> list[str]:
    """คืน list ของข้อความ error (ว่าง = ผ่าน หรือไม่มี schema ให้ตรวจ)"""
    schema_path = SCHEMA_DIR / schema_filename
    if not schema_path.exists():
        eprint(f"หมายเหตุ: ไม่พบ {schema_path} — ข้ามการตรวจ jsonschema (P6 ยังไม่ได้สร้าง)")
        return []
    try:
        import jsonschema  # type: ignore
    except ImportError:
        eprint("หมายเหตุ: ไม่ได้ติดตั้ง jsonschema (pip install -r pipeline/requirements.txt) — ข้ามการตรวจ")
        return []
    schema = load_json(schema_path)
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    return [f"{'.'.join(str(p) for p in e.path) or '(root)'}: {e.message}" for e in errors]


# ---------------------------------------------------------------------------
# ตรวจ allowlist แท็ก HTML inline ที่อนุญาตใน paragraphs/bullets/callout.text
# (สัญญาระหว่างโมดูล §A.2 หมายเหตุ dfn + ความเสี่ยง #11 — ป้องกัน XSS)
# author.py ห้ามส่ง <dfn> เอง (terms.py เป็นผู้ห่อ) จึงอนุญาตแค่ <b> <i> ตอน author
# ส่วน terms.py ตรวจแบบอนุญาต <b> <i> <dfn> เพิ่ม
# ---------------------------------------------------------------------------
_TAG_RE = re.compile(r"<\s*/?\s*([a-zA-Z][a-zA-Z0-9]*)\b")


def find_disallowed_tags(html_fragment: str, allowed: set[str]) -> list[str]:
    """คืนรายชื่อแท็กที่พบแต่ไม่อยู่ใน allowed (lowercase ชื่อแท็ก)"""
    found = {m.group(1).lower() for m in _TAG_RE.finditer(html_fragment)}
    return sorted(found - allowed)

"""pipeline/covers.py — ตัดภาพปกจากหน้าแรกของ PDF ต้นฉบับ ไว้ใช้บนหน้าชั้นหนังสือ

    .venv/bin/python -m pipeline.covers

เขียน web/src/static/covers/<slug>.jpg (กว้าง 480px = 2 เท่าของการ์ดที่กว้างที่สุด) แล้ว commit ไว้เลย
build.js และ CI จึงไม่ต้องมี pymupdf · รันใหม่เมื่อ PDF ต้นฉบับเปลี่ยนเท่านั้น
"""

import json
from pathlib import Path

import fitz  # pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "src" / "static" / "covers"
WIDTH = 480


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for book_json in sorted((ROOT / "content" / "books").glob("*/book.json")):
        book = json.loads(book_json.read_text(encoding="utf-8"))
        pdf = ROOT / "content" / "source" / book["sourcePdf"]["file"]
        with fitz.open(pdf) as doc:
            page = doc[0]
            zoom = WIDTH / page.rect.width
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
            dest = OUT / f"{book['slug']}.jpg"
            pix.save(dest, jpg_quality=82)
            print(f"{book['order']} {book['slug']}: {pix.width}x{pix.height} {dest.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
pipeline/terms.py — รวม glossary ทุกบทของเล่ม + auto-link <dfn> ในเนื้อหา

อ้างอิง: docs/handoff-spec.md §9.2, สัญญาระหว่างโมดูล §A.2 (หมายเหตุ dfn), §A.3 (Term/glossary.json), §G

ความเป็นเจ้าของ (ตามสัญญาระหว่างโมดูล §A.3): glossary.json ถูกเขียนโดย terms.py เท่านั้น
  glossary.json ใหม่ = union(ค่าเดิมใน glossary.json, terms ที่ author.py เสนอในทุก chNN.json)
  dedupe ตาม term โดย "ค่าที่มีอยู่ก่อนชนะ" (คนแก้มือใน glossary.json แล้วรัน terms.py ซ้ำได้ไม่หาย)
  หลังห่อ dfn เสร็จ terms.py เขียน chNN.json.terms ทับให้เท่ากับ subset ที่ปรากฏจริงในบท

กฎ auto-link (§9.2):
  - ห่อเฉพาะการปรากฏ "ครั้งแรกของศัพท์ในแต่ละ section" ด้วย <dfn data-term="…" data-kind="…">
  - จับคู่แบบ longest-match ก่อน (ขันธ์ ๕ ก่อน ขันธ์) — แก้ด้วยลำดับ pattern เอง (ดู build_master_pattern)
  - ห้ามห่อคำที่อยู่ในคำอื่น (สติ ใน สติปัญญา) — หมายเหตุสำคัญ: สัญญาระหว่างโมดูลเขียนว่า "เช็คตัวอักษรไทย
    หน้า/หลังต้องไม่ใช่ตัวอักษรไทย" แต่กฎนี้ใช้ไม่ได้จริงกับภาษาไทยที่ไม่มีช่องว่างระหว่างคำ (ตัวอักษรก่อน/
    หลังคำเกือบทุกคำในเนื้อหาจริงเป็นภาษาไทยอยู่แล้ว เช็คแบบนี้ตรงๆ จะบล็อกการจับคู่แทบทั้งหมด) — ที่นี่จึง
    ตีความและทำ 2 ชั้นแทน: (1) กันตัดกลาง "กลุ่มอักขระเดียวกัน" ด้วยการเช็คสระ/วรรณยุกต์ลอยที่ขอบ (ถูกต้อง
    และทดสอบได้จริง) (2) กันคำสั้นไปแอบในคำยาวที่ไม่ได้เป็นศัพท์เอง ด้วยรายการ exclusions ที่แก้ไขมือได้
    (pipeline/fixtures/term_exclusions.json) เพราะขอบเขตคำไทยทั่วไปต้องใช้ตัวตัดคำ/พจนานุกรมซึ่งไม่ได้อยู่
    ใน dependency ของ pipeline นี้ — ดูรายละเอียดที่ wrap_first_occurrence()
  - ไม่ห่อภายใน quote (quote.text/source — ไม่แตะพุทธพจน์เอง), หัวข้อ (h2, callout.label, ฯลฯ),
    และ readout ของ interactive (interactive.title/intro/config)
  - idempotent: รันซ้ำได้โดยไม่ห่อคำที่มี <dfn> อยู่แล้วซ้ำอีก

หมายเหตุเรื่อง scope "section": สัญญาระหว่างโมดูลไม่ได้พูดชัดว่า quote.after (ย่อหน้าที่ตามหลังพุทธพจน์)
นับเป็น "section" ของตัวเองหรือไม่ — ในนี้เลือกให้ quote.after เป็น scope อิสระของตัวเอง (นับหนึ่งใหม่)
เพราะมันเป็น block ที่แยกจาก sections[] array ในโครงสร้างข้อมูล ส่วน callout.text ถือเป็นส่วนหนึ่งของ
section เดียวกับ paragraphs/bullets ที่มันแนบอยู่ (ใช้ "used-set" เดียวกัน) เพราะ callout วางอยู่ในบล็อก
เดียวกันกับ section นั้นๆ ตามสายตาผู้อ่าน ตรงตามเหตุผลกฎข้อนี้ ("รกและกดพลาดบนมือถือ" ถ้าห่อซ้ำถี่ๆ)
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from pipeline import common

THAI_BLOCK_RE = re.compile(r"[฀-๿]")

# สระ/วรรณยุกต์ที่ "ลอยไม่ได้" ต้องเกาะพยัญชนะก่อนหน้าเสมอ (เหมือนใน clean.py) — ใช้เช็คว่า match ไม่ได้
# ตัดกลางกลุ่มอักขระเดียวกัน (เช่น จับ "ขันธ" แล้วทิ้ง "์" ไว้นอกช่วงที่ห่อ) ไม่ใช่การหาขอบเขต "คำ" เต็มรูป
# (การหาขอบเขตคำไทยจริงต้องใช้ตัวตัดคำ/พจนานุกรม ซึ่งไม่ได้อยู่ใน dependency ของ pipeline นี้ —
# ภาษาไทยไม่มีช่องว่างระหว่างคำ จึง "ตัวอักษรก่อน/หลังต้องไม่ใช่ภาษาไทย" ตามตัวอักษรของสัญญาระหว่างโมดูล
# ใช้ไม่ได้จริงในทางปฏิบัติ เพราะจะบล็อกการจับคู่แทบทุกคำในเนื้อหาจริง — ดูรายละเอียดที่ wrap_first_occurrence)
COMBINING_MARKS = set("ั" "ิีึืฺุู" "็่้๊๋์ํ๎")


def is_thai_char(ch: str) -> bool:
    return bool(ch) and bool(THAI_BLOCK_RE.match(ch))


def load_term_exclusions() -> dict[str, list[str]]:
    """โหลด pipeline/fixtures/term_exclusions.json — ตาข่ายนิรภัยที่แก้ไขมือได้สำหรับกรณี
    "คำสั้นไปแอบอยู่ในคำยาวกว่าที่ไม่ได้เป็นศัพท์เอง" (เช่น สติ ใน สติปัญญา) ดู docstring ของไฟล์นี้"""
    path = Path(__file__).resolve().parent / "fixtures" / "term_exclusions.json"
    data = common.load_json(path) or {}
    return {k: v for k, v in data.items() if not k.startswith("_")}


# ---------------------------------------------------------------------------
# glossary.json I/O — ทนรูปแบบเก่า (array เปล่าๆ ที่พบในไฟล์ seed ปัจจุบัน) เพื่อ migrate เข้ารูปแบบ
# {book, terms} ตามสัญญาระหว่างโมดูล §A.3 โดยไม่ทำให้ของเดิมหาย
# ---------------------------------------------------------------------------
def load_glossary(book_slug: str) -> list[dict]:
    path = common.glossary_json_path(book_slug)
    data = common.load_json(path)
    if data is None:
        return []
    if isinstance(data, list):
        common.eprint(
            f"หมายเหตุ: {path} เป็นรูปแบบเก่า (array เปล่าๆ) — จะเขียนกลับเป็นรูปแบบ "
            f'{{"book": ..., "terms": [...]}} ตามสัญญาระหว่างโมดูล §A.3 ในการรันครั้งนี้'
        )
        return data
    return data.get("terms", [])


def save_glossary(book_slug: str, terms: list[dict]) -> None:
    common.save_json(common.glossary_json_path(book_slug), {"book": book_slug, "terms": terms})


def merge_terms(existing: list[dict], proposed: list[dict], book_slug: str) -> list[dict]:
    """union(existing, proposed) dedupe ตาม term — ค่าที่มีอยู่ก่อน (existing) ชนะเสมอ"""
    merged: dict[str, dict] = {}
    order: list[str] = []
    for t in existing:
        merged[t["term"]] = t
        order.append(t["term"])
    for t in proposed:
        if t["term"] in merged:
            continue  # ของเดิมชนะ — ไม่ทับแม้ author.py จะเสนอนิยามใหม่มา
        t = dict(t)
        t.setdefault("books", [book_slug])
        merged[t["term"]] = t
        order.append(t["term"])
    return [merged[k] for k in order]


# ---------------------------------------------------------------------------
# auto-link
# ---------------------------------------------------------------------------
_EXISTING_DFN_SPAN_RE = re.compile(r"<dfn\b[^>]*>.*?</dfn>", re.DOTALL)
_EXISTING_DFN_TERM_RE = re.compile(r'<dfn\b[^>]*\bdata-term="([^"]*)"')


def find_existing_dfn_spans(html: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in _EXISTING_DFN_SPAN_RE.finditer(html)]


def find_existing_dfn_terms(html: str) -> set[str]:
    return {m.group(1) for m in _EXISTING_DFN_TERM_RE.finditer(html)}


def build_master_pattern(terms_sorted_desc: list[str]) -> re.Pattern:
    """alternation เรียงยาวไปสั้น — ที่ตำแหน่งเริ่มเดียวกัน regex จะลองตัวเลือกตามลำดับที่ให้ไว้
    (ยาวก่อน) จึงได้ longest-match โดยอัตโนมัติโดยไม่ต้องเขียน backtracking logic เอง"""
    escaped = [re.escape(t) for t in terms_sorted_desc if t]
    return re.compile("(?:" + "|".join(escaped) + ")")


def wrap_first_occurrence(
    html: str,
    pattern: re.Pattern,
    term_lookup: dict[str, dict],
    used: set[str],
    exclusions: dict[str, list[str]] | None = None,
) -> tuple[str, set[str]]:
    """ห่อ <dfn> รอบการปรากฏครั้งแรกของแต่ละคำใน `html` เดียวนี้ โดยนับรวมกับ `used`
    ที่ส่งเข้ามา (ให้ผู้เรียกคุม scope ว่าอะไรนับเป็น section เดียวกัน) คืน (html ใหม่, newly_used)

    เรื่อง "ห้ามห่อคำที่อยู่ในคำอื่น": ระหว่างคำที่ทั้งคู่อยู่ในรายการศัพท์ (เช่น "ขันธ์ ๕" กับ "ขันธ์")
    การเรียง pattern ยาวไปสั้นใน build_master_pattern() แก้ปัญหานี้ได้เองอัตโนมัติแล้ว (regex ลองตัวยาว
    ก่อนที่ตำแหน่งเดียวกันเสมอ) กรณีที่เหลือคือคำสั้นที่เป็นศัพท์ไปแอบอยู่ในคำยาวกว่าที่ "ไม่ได้" เป็นศัพท์
    เอง (เช่น "สติ" ใน "สติปัญญา") — กรณีนี้แก้ด้วยรายการ exclusions ที่แก้ไขมือได้ (ดู load_term_exclusions)
    เพราะการหาขอบเขตคำไทยทั่วไปแบบอัตโนมัติต้องใช้ตัวตัดคำ/พจนานุกรมที่ไม่ได้อยู่ใน dependency ของ pipeline นี้"""
    existing_spans = find_existing_dfn_spans(html)
    exclusions = exclusions or {}

    excluded_spans_for_term: dict[str, list[tuple[int, int]]] = {}
    for term_key, longer_words in exclusions.items():
        spans = [
            (m.start(), m.end())
            for longer in longer_words
            for m in re.finditer(re.escape(longer), html)
        ]
        if spans:
            excluded_spans_for_term[term_key] = spans

    newly_used: set[str] = set()

    def overlaps_existing(start: int, end: int) -> bool:
        return any(s < end and start < e for s, e in existing_spans)

    def inside_excluded_word(term: str, start: int, end: int) -> bool:
        spans = excluded_spans_for_term.get(term)
        if not spans:
            return False
        return any(s <= start and end <= e for s, e in spans)

    def repl(m: re.Match) -> str:
        term = m.group(0)
        start, end = m.start(), m.end()
        if overlaps_existing(start, end):
            return term  # อยู่ใน <dfn> เดิมแล้ว (idempotent) — ไม่แตะ
        if term in used:
            return term  # ห่อไปแล้วในบล็อกนี้ (จาก dfn เดิม หรือจากการห่อรอบนี้เอง)
        # เช็คเฉพาะ "หลัง" match เท่านั้น: สระ/วรรณยุกต์เกาะพยัญชนะ "ก่อนหน้า" มันเสมอ (ไม่เกาะไปข้างหน้า)
        # ดังนั้นเครื่องหมายก่อนจุดเริ่ม match เป็นของคำ/พยางค์ก่อนหน้า ไม่เกี่ยวกับความถูกต้องของ match นี้
        # แต่ถ้าตัวถัดจาก match ทันทีเป็นเครื่องหมายลอย แปลว่า match ตัดกลางกลุ่มอักขระเดียวกัน (ผิดขอบเขต)
        after = html[end] if end < len(html) else ""
        if after in COMBINING_MARKS:
            return term  # ตัดกลางกลุ่มอักขระเดียวกัน (สระ/วรรณยุกต์ตกขอบ) — ไม่ใช่ขอบเขตคำที่ถูกต้อง
        if inside_excluded_word(term, start, end):
            return term  # อยู่ในคำที่ยาวกว่าตามรายการ exclusions (เช่น "สติ" ใน "สติปัญญา") — ข้าม
        info = term_lookup.get(term)
        if info is None:
            return term
        used.add(term)
        newly_used.add(term)
        return f'<dfn data-term="{term}" data-kind="{info["kind"]}">{term}</dfn>'

    new_html = pattern.sub(repl, html)
    return new_html, newly_used


def autolink_chapter(
    chapter: dict,
    pattern: re.Pattern,
    term_lookup: dict[str, dict],
    exclusions: dict[str, list[str]],
) -> set[str]:
    """ห่อ dfn ทั่วทั้งบท คืน set ของ term ทั้งหมดที่ปรากฏเป็น dfn ในบทนี้ (รวมของเดิมที่มีอยู่แล้ว)"""
    all_terms_in_chapter: set[str] = set()

    for section in chapter.get("sections", []):
        # เริ่ม used-set ของ section นี้จากคำที่ถูกห่อ <dfn> อยู่แล้ว (รอบก่อนหน้า) กันไม่ให้ห่อซ้ำ
        used: set[str] = set()
        for p in section.get("paragraphs", []):
            used |= find_existing_dfn_terms(p)
        for b in section.get("bullets", []):
            used |= find_existing_dfn_terms(b)
        if "callout" in section:
            used |= find_existing_dfn_terms(section["callout"]["text"])

        new_paragraphs = []
        for p in section.get("paragraphs", []):
            new_p, newly = wrap_first_occurrence(p, pattern, term_lookup, used, exclusions)
            new_paragraphs.append(new_p)
            all_terms_in_chapter |= newly | find_existing_dfn_terms(new_p)
        section["paragraphs"] = new_paragraphs

        if "bullets" in section:
            new_bullets = []
            for b in section["bullets"]:
                new_b, newly = wrap_first_occurrence(b, pattern, term_lookup, used, exclusions)
                new_bullets.append(new_b)
                all_terms_in_chapter |= newly | find_existing_dfn_terms(new_b)
            section["bullets"] = new_bullets

        if "callout" in section:
            new_text, newly = wrap_first_occurrence(
                section["callout"]["text"], pattern, term_lookup, used, exclusions
            )
            section["callout"]["text"] = new_text
            all_terms_in_chapter |= newly | find_existing_dfn_terms(new_text)

    quote = chapter.get("quote")
    if quote and quote.get("after"):
        used_quote: set[str] = set().union(*[find_existing_dfn_terms(a) for a in quote["after"]])
        new_after = []
        for a in quote["after"]:
            new_a, newly = wrap_first_occurrence(a, pattern, term_lookup, used_quote, exclusions)
            new_after.append(new_a)
            all_terms_in_chapter |= newly | find_existing_dfn_terms(new_a)
        quote["after"] = new_after

    return all_terms_in_chapter


def count_dfn(chapter: dict) -> int:
    n = 0
    for section in chapter.get("sections", []):
        for p in section.get("paragraphs", []):
            n += len(find_existing_dfn_terms(p))
        for b in section.get("bullets", []):
            n += len(find_existing_dfn_terms(b))
        if "callout" in section:
            n += len(find_existing_dfn_terms(section["callout"]["text"]))
    quote = chapter.get("quote")
    if quote:
        for a in quote.get("after", []):
            n += len(find_existing_dfn_terms(a))
    return n


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="รวม glossary + auto-link <dfn> ในเนื้อหาทุกบทของเล่ม")
    parser.add_argument("--book", required=True)
    parser.add_argument("--report", action="store_true", help="แสดง diff จำนวน dfn ก่อน/หลังต่อบท")
    args = parser.parse_args(argv)

    book_slug = args.book
    book = common.load_book(book_slug)
    chapters_meta = book.get("chapters", [])
    if not chapters_meta:
        common.die(f"book.json ของ '{book_slug}' ยังไม่มี chapters[]")

    # โหลดทุก chNN.json ที่มีอยู่จริง (draft หรือ ready — building ไม่มีไฟล์เนื้อหาให้ประมวลผล)
    chapter_data: dict[str, dict] = {}
    for meta in sorted(chapters_meta, key=lambda c: c["order"]):
        slug = meta["slug"]
        data = common.load_json(common.chapter_json_path(book_slug, slug))
        if data is None:
            common.eprint(f"ข้าม {slug} — ยังไม่มี {slug}.json (สถานะ building)")
            continue
        if data.get("status") not in ("draft", "ready"):
            continue
        chapter_data[slug] = data

    if not chapter_data:
        common.die(f"ไม่มี chNN.json สถานะ draft/ready ให้ประมวลผลเลยใน '{book_slug}'")

    existing_glossary = load_glossary(book_slug)
    proposed: list[dict] = []
    for data in chapter_data.values():
        proposed.extend(data.get("terms", []))

    merged_terms = merge_terms(existing_glossary, proposed, book_slug)
    if not merged_terms:
        common.die(
            f"ไม่มีคำศัพท์เลยหลัง merge — ตรวจว่า chNN.json มี terms[] ที่ author.py เสนอไว้หรือไม่"
        )

    term_lookup = {t["term"]: t for t in merged_terms}
    terms_sorted_desc = sorted(term_lookup.keys(), key=len, reverse=True)
    pattern = build_master_pattern(terms_sorted_desc)
    exclusions = load_term_exclusions()

    before_counts = {slug: count_dfn(data) for slug, data in chapter_data.items()}

    chapter_terms_used: dict[str, set[str]] = {}
    for slug, data in chapter_data.items():
        chapter_terms_used[slug] = autolink_chapter(data, pattern, term_lookup, exclusions)

    # terms.py เป็นผู้เขียนค่าสุดท้ายของ chNN.json.terms = subset ของ glossary ที่ปรากฏจริงในบทนั้น
    for slug, data in chapter_data.items():
        used_terms = chapter_terms_used[slug]
        data["terms"] = [term_lookup[t] for t in terms_sorted_desc if t in used_terms]
        common.save_json(common.chapter_json_path(book_slug, slug), data)

    save_glossary(book_slug, merged_terms)

    common.eprint(f"เขียน {common.glossary_json_path(book_slug)} ({len(merged_terms)} คำ)")
    common.eprint(f"อัปเดต {len(chapter_data)} chNN.json (terms[] + <dfn> auto-link)")

    if args.report:
        print("รายงาน terms.py — จำนวน <dfn> ก่อน/หลังต่อบท:")
        for slug in sorted(chapter_data.keys()):
            after = count_dfn(chapter_data[slug])
            print(f"  {slug}: {before_counts[slug]} -> {after}")
        print(f"รวมคำศัพท์ใน glossary.json: {len(merged_terms)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())

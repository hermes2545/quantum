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
  - ห้ามห่อคำที่อยู่ในคำอื่น (สติ ใน สติปัญญา) — สัญญาระหว่างโมดูลเขียนว่า "เช็คตัวอักษรไทยหน้า/หลังต้องไม่ใช่
    ตัวอักษรไทย" แต่กฎนี้ใช้ไม่ได้จริงกับภาษาไทยที่ไม่มีช่องว่างระหว่างคำ (ตัวอักษรก่อน/หลังคำเกือบทุกคำใน
    เนื้อหาจริงเป็นภาษาไทยอยู่แล้ว เช็คแบบนี้ตรงๆ จะบล็อกการจับคู่แทบทั้งหมด) — ที่นี่จึงทำ 3 ชั้นแทน:
    (1) กันตัดกลาง "กลุ่มอักขระเดียวกัน" ด้วยการเช็คสระ/วรรณยุกต์ลอยที่ขอบ (ถูกต้องและทดสอบได้จริง)
    (2) เช็คขอบเขตคำจริงด้วยตัวตัดคำ pythainlp (word_tokenize, engine=newmm — ดู thai_token_boundaries())
    ถ้า match ไม่ตรงกับขอบเขต token ทั้งสองด้าน (ตัดกลาง token เดียวกันทั้งสองฝั่ง เช่น "สติ" ใน "พลาสติก")
    ปฏิเสธอัตโนมัติโดยไม่เสี่ยง false positive — แต่ถ้าตรงขอบแค่ด้านเดียว (เช่น "สติปัญญา" เต็มคำใน
    "มีสติปัญญา" ที่ตัวตัดคำรวม "มี" เข้ากับคำถัดไปแบบไม่ตรงไปตรงมา) ปล่อยผ่านแล้วให้ --report แจ้งเตือน
    แทนการฟันธงเอง เพราะกรณีขอบเดียวแยกไม่ออกอัตโนมัติว่าเป็นคำประสมที่ถูกต้อง (ปล่อยผ่าน) หรือคำที่ไป
    แอบอยู่ในคำอื่นแบบผิด (เช่น "กรรม" ท้าย "พันธุกรรม" ซึ่งก็ตรงขอบท้ายด้านเดียวเหมือนกัน) — ดูรายละเอียด
    ที่ thai_token_boundaries()/wrap_first_occurrence() (3) รายการ exclusions ที่แก้ไขมือได้
    (pipeline/fixtures/term_exclusions.json) เป็นตาข่ายสุดท้ายสำหรับกรณีขอบเดียวที่คนตรวจยืนยันแล้วว่าผิด
    (ทั้ง pythainlp และ exclusions ทำงานร่วมกัน — ไม่ใช่อย่างใดอย่างหนึ่งอย่างเดียว)
  - ไม่ห่อภายใน quote (ทั้ง object รวม quote.text/source/after — ไม่แตะพุทธพจน์และย่อหน้าปิดท้ายที่ตามเลย
    ตามตัวอักษรของสัญญาระหว่างโมดูล §G: "ไม่ห่อใน quote/h2/callout.label/interactive/exercise" ไม่ได้
    ยกเว้น after — ถ้าจะห่อ quote.after จริงต้องแก้เอกสารสัญญาก่อน ไม่ใช่ตีความเองใน pipeline นี้),
    หัวข้อ (h2, callout.label, ฯลฯ), และ readout ของ interactive (interactive.title/intro/config)
  - idempotent: รันซ้ำได้โดยไม่ห่อคำที่มี <dfn> อยู่แล้วซ้ำอีก
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
# (ขอบเขต "คำ" เต็มรูปใช้ thai_token_boundaries() ด้านล่าง ซึ่งพึ่งตัวตัดคำ pythainlp)
COMBINING_MARKS = set("ั" "ิีึืฺุู" "็่้๊๋์ํ๎")


def is_thai_char(ch: str) -> bool:
    return bool(ch) and bool(THAI_BLOCK_RE.match(ch))


def load_term_exclusions() -> dict[str, list[str]]:
    """โหลด pipeline/fixtures/term_exclusions.json — ตาข่ายนิรภัยชั้นสุดท้ายที่แก้ไขมือได้สำหรับกรณี
    "คำสั้นไปแอบอยู่ในคำยาวกว่าที่ไม่ได้เป็นศัพท์เอง" ที่ thai_token_boundaries() (ตัวตัดคำ) แยกไม่ออก
    เพราะตรงขอบแค่ด้านเดียว (เช่น กรรม ใน พันธุกรรม) ดู docstring ของไฟล์นี้"""
    path = Path(__file__).resolve().parent / "fixtures" / "term_exclusions.json"
    data = common.load_json(path) or {}
    return {k: v for k, v in data.items() if not k.startswith("_")}


# ---------------------------------------------------------------------------
# เช็คขอบเขตคำจริงด้วยตัวตัดคำ (pythainlp) — เสริมจาก exclusions list (ดู docstring ของไฟล์นี้)
# ---------------------------------------------------------------------------
_WORD_TOKENIZE: object = None  # None = ยังไม่เช็ค, False = ไม่มี pythainlp, ฟังก์ชัน = เช็คแล้วมี
_WORD_TOKENIZE_WARNED = False


def _get_word_tokenize():
    """โหลด pythainlp.tokenize.word_tokenize แบบ lazy + cache (import ครั้งเดียวพอ) คืน None ถ้า
    ไม่ได้ติดตั้ง (เตือนครั้งเดียว ไม่สแปมข้อความทุกครั้งที่เรียกซ้ำ) ผู้เรียกต้องยอมรับว่าไม่มีการเช็ค
    ขอบเขตคำอัตโนมัติแล้วพึ่ง term_exclusions.json เพียงอย่างเดียวเหมือนพฤติกรรมเดิม"""
    global _WORD_TOKENIZE, _WORD_TOKENIZE_WARNED
    if _WORD_TOKENIZE is not None:
        return _WORD_TOKENIZE or None
    try:
        from pythainlp.tokenize import word_tokenize
    except ImportError:
        if not _WORD_TOKENIZE_WARNED:
            common.eprint(
                "คำเตือน: ไม่ได้ติดตั้ง pythainlp (pip install -r pipeline/requirements.txt) — "
                "ข้ามการเช็คขอบเขตคำไทยด้วยตัวตัดคำ จะพึ่ง term_exclusions.json อย่างเดียว "
                "(เสี่ยงห่อกลางคำที่ยังไม่มีใครเพิ่มลงรายการ exclusions เช่น 'สติ' ใน 'พลาสติก')"
            )
            _WORD_TOKENIZE_WARNED = True
        _WORD_TOKENIZE = False
        return None
    _WORD_TOKENIZE = word_tokenize
    return word_tokenize


def strip_html_with_map(html: str) -> tuple[str, list[int]]:
    """ตัดแท็ก HTML (<...>) ออกจาก html คืน (plain_text, idx_map) โดย idx_map[i] = ตำแหน่งของ
    plain_text[i] ใน html เดิม — ตัวตัดคำต้องทำงานบน plain text (แท็กจะทำให้ตัดคำผิดเพี้ยน) แต่ผลลัพธ์
    (ตำแหน่งขอบเขต token) ต้องแปลงกลับเป็น offset ใน html จริงที่ wrap_first_occurrence() ใช้แก้ไข"""
    out: list[str] = []
    idx_map: list[int] = []
    i, n = 0, len(html)
    while i < n:
        if html[i] == "<":
            j = html.find(">", i)
            if j == -1:
                out.append(html[i])
                idx_map.append(i)
                i += 1
                continue
            i = j + 1
            continue
        out.append(html[i])
        idx_map.append(i)
        i += 1
    return "".join(out), idx_map


def thai_token_boundaries(html: str) -> tuple[set[int], set[int]] | None:
    """ตัดคำ (word segmentation) ข้อความ plain-text ของ html ด้วย pythainlp คืน (token_starts,
    token_ends) เป็นเซตของตำแหน่ง offset ใน html เดิม — คืน None ถ้าไม่ได้ติดตั้ง pythainlp

    วิธีใช้ผลลัพธ์ (ดู wrap_first_occurrence): match ที่ตรงขอบ token ทั้งสองด้าน (start อยู่ใน
    token_starts และ end อยู่ใน token_ends) = ปลอดภัยแน่นอน ตรงขอบด้านเดียว = น่าสงสัยแต่ไม่ฟันธง
    (แจ้งใน --report แทน) ไม่ตรงขอบเลยทั้งสองด้าน = ตัดกลาง token เดียวกันแน่ๆ ปฏิเสธได้ปลอดภัย"""
    word_tokenize = _get_word_tokenize()
    if not word_tokenize:
        return None
    plain, idx_map = strip_html_with_map(html)
    if not plain:
        return set(), set()
    tokens = word_tokenize(plain, engine="newmm", keep_whitespace=True)
    starts: set[int] = set()
    ends: set[int] = set()
    pos = 0
    for tok in tokens:
        if not tok:
            continue
        end_pos = pos + len(tok)
        starts.add(idx_map[pos] if pos < len(idx_map) else len(html))
        ends.add(idx_map[end_pos - 1] + 1 if end_pos - 1 < len(idx_map) else len(html))
        pos = end_pos
    return starts, ends


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
    context_sink: list[str] | None = None,
) -> tuple[str, set[str]]:
    """ห่อ <dfn> รอบการปรากฏครั้งแรกของแต่ละคำใน `html` เดียวนี้ โดยนับรวมกับ `used`
    ที่ส่งเข้ามา (ให้ผู้เรียกคุม scope ว่าอะไรนับเป็น section เดียวกัน) คืน (html ใหม่, newly_used)
    ถ้าส่ง `context_sink` มา (list) จะ append บริบท ±15 ตัวอักษรของทุก dfn ที่ห่อใหม่รอบนี้เข้าไป
    (ใช้โดย --report ให้คนตรวจ scan หาคำที่ห่อผิดได้ตาม checklist §11 โดยไม่ต้อง diff ไฟล์เอง)

    เรื่อง "ห้ามห่อคำที่อยู่ในคำอื่น": ระหว่างคำที่ทั้งคู่อยู่ในรายการศัพท์ (เช่น "ขันธ์ ๕" กับ "ขันธ์")
    การเรียง pattern ยาวไปสั้นใน build_master_pattern() แก้ปัญหานี้ได้เองอัตโนมัติแล้ว (regex ลองตัวยาว
    ก่อนที่ตำแหน่งเดียวกันเสมอ) กรณีที่เหลือคือคำสั้นที่เป็นศัพท์ไปแอบอยู่ในคำยาวกว่าที่ "ไม่ได้" เป็นศัพท์
    เอง (เช่น "สติ" ใน "สติปัญญา", "กรรม" ใน "พันธุกรรม") — เช็คด้วย thai_token_boundaries() (ตัวตัดคำ)
    ก่อน: ไม่ตรงขอบ token ทั้งสองด้าน = ปฏิเสธอัตโนมัติ (ปลอดภัย ไม่ต้องพึ่งใครมาเพิ่มรายการ exclusions)
    ตรงขอบด้านเดียว = ปล่อยผ่านแต่บันทึกลง context_sink เป็น "น่าสงสัย" ให้คนตรวจดู แล้วเช็ค exclusions
    list ที่แก้ไขมือได้เป็นชั้นสุดท้ายสำหรับกรณีขอบเดียวที่ยืนยันแล้วว่าผิด (ดู load_term_exclusions)"""
    existing_spans = find_existing_dfn_spans(html)
    exclusions = exclusions or {}
    boundaries = thai_token_boundaries(html)  # None ถ้าไม่มี pythainlp ติดตั้ง

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
        boundary_ok_both_sides = True
        if boundaries is not None:
            starts, ends = boundaries
            start_aligned = start in starts
            end_aligned = end in ends
            if not start_aligned and not end_aligned:
                return term  # ตัดกลาง token เดียวกันทั้งสองฝั่งตามตัวตัดคำ (เช่น "สติ" ใน "พลาสติก") — ปฏิเสธ
            boundary_ok_both_sides = start_aligned and end_aligned
        if inside_excluded_word(term, start, end):
            return term  # อยู่ในคำที่ยาวกว่าตามรายการ exclusions (เช่น "กรรม" ใน "พันธุกรรม") — ข้าม
        info = term_lookup.get(term)
        if info is None:
            return term
        used.add(term)
        newly_used.add(term)
        if context_sink is not None:
            before_ctx = html[max(0, start - 15):start]
            after_ctx = html[end:end + 15]
            flag = "" if boundary_ok_both_sides else " [⚠ ตรวจขอบเขตคำ: ตัวตัดคำติดกับคำข้างเคียงด้านหนึ่ง]"
            context_sink.append(f"{before_ctx}[{term}]{after_ctx}{flag}")
        return f'<dfn data-term="{term}" data-kind="{info["kind"]}">{term}</dfn>'

    new_html = pattern.sub(repl, html)
    return new_html, newly_used


def autolink_chapter(
    chapter: dict,
    pattern: re.Pattern,
    term_lookup: dict[str, dict],
    exclusions: dict[str, list[str]],
    context_sink: list[str] | None = None,
) -> set[str]:
    """ห่อ dfn ทั่วทั้งบท คืน set ของ term ทั้งหมดที่ปรากฏเป็น dfn ในบทนี้ (รวมของเดิมที่มีอยู่แล้ว)

    หมายเหตุ: ไม่แตะ chapter["quote"] เลย (ทั้ง text/source/after) ตามตัวอักษรของสัญญาระหว่างโมดูล §G
    ("ไม่ห่อใน quote/h2/callout.label/interactive/exercise") — ไม่ยกเว้น after เอง"""
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
            new_p, newly = wrap_first_occurrence(p, pattern, term_lookup, used, exclusions, context_sink)
            new_paragraphs.append(new_p)
            all_terms_in_chapter |= newly | find_existing_dfn_terms(new_p)
        section["paragraphs"] = new_paragraphs

        if "bullets" in section:
            new_bullets = []
            for b in section["bullets"]:
                new_b, newly = wrap_first_occurrence(b, pattern, term_lookup, used, exclusions, context_sink)
                new_bullets.append(new_b)
                all_terms_in_chapter |= newly | find_existing_dfn_terms(new_b)
            section["bullets"] = new_bullets

        if "callout" in section:
            new_text, newly = wrap_first_occurrence(
                section["callout"]["text"], pattern, term_lookup, used, exclusions, context_sink
            )
            section["callout"]["text"] = new_text
            all_terms_in_chapter |= newly | find_existing_dfn_terms(new_text)

    # quote (text/source/after) ไม่ถูกแตะเลย — นับ dfn เดิมที่อาจมีอยู่แล้วใน quote.after (จากรันครั้งก่อน
    # ที่เคยห่อ) รวมเข้า all_terms_in_chapter ด้วย เพื่อไม่ให้ chNN.json.terms หายไปจากของเดิมที่มีอยู่แล้ว
    quote = chapter.get("quote")
    if quote:
        for a in quote.get("after", []):
            all_terms_in_chapter |= find_existing_dfn_terms(a)

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
    dfn_contexts: dict[str, list[str]] = {}
    for slug, data in chapter_data.items():
        ctx_sink: list[str] = []
        chapter_terms_used[slug] = autolink_chapter(data, pattern, term_lookup, exclusions, ctx_sink)
        dfn_contexts[slug] = ctx_sink

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
        print()
        print(
            "รายการ <dfn> ที่ห่อใหม่รอบนี้ (บริบท ±15 ตัวอักษร) — ตรวจตาม checklist §11 "
            '("กดศัพท์ทุกคำในเล่มแล้วเปิด sheet ได้ ไม่มีคำที่ห่อผิด") '
            "จุดที่มี ⚠ คือตัวตัดคำ (pythainlp) เห็นว่าติดกับคำข้างเคียงด้านหนึ่ง ควรตรวจก่อนเป็นอันดับแรก:"
        )
        any_new = False
        for slug in sorted(dfn_contexts.keys()):
            for ctx in dfn_contexts[slug]:
                print(f"  {slug}: {ctx}")
                any_new = True
        if not any_new:
            print("  (ไม่มี dfn ใหม่รอบนี้)")

    return 0


if __name__ == "__main__":
    sys.exit(main())

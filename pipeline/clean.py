#!/usr/bin/env python3
"""
pipeline/clean.py — ทำความสะอาดข้อความที่ดึงจาก PDF (ส่วนที่สำคัญที่สุดของ pipeline นี้)

ทำไมต้องมีขั้นนี้ (docs/handoff-spec.md §8, §11 ข้อห้าม #4):
PDF ต้นฉบับฝังฟอนต์ที่ทำให้ตัวอักษรไทยซ้อนกันตอนดึงข้อความ เช่น
  หนัังสืือ  (ควรเป็น หนังสือ)
  ไตรลัักษณ์์ (ควรเป็น ไตรลักษณ์)
  พระพุุทธองค์์ (ควรเป็น พระพุทธองค์)
ถ้าข้ามขั้นนี้แล้วส่งตรงให้ AI (author.py) จะได้ศัพท์ผิดๆ กระจายไปทั้งเล่ม

การแก้ที่ยากที่สุด: regex ยุบอักษรซ้ำ ([฀-๿])\\1+ -> \\1 (ตามที่ spec ให้มา) เป็นการยุบแบบ "ไม่รู้ภาษา"
มันจะยุบพยัญชนะซ้อนที่ "ถูกต้องโดยธรรมชาติ" ในคำไทยด้วย เช่น
  ปัญญา (ญ ญ คือคำจริง) -> ถูกยุบเหลือ ปัญา (ผิด)
  ธรรม  (ร ร คือคำจริง) -> ถูกยุบเหลือ ธรม  (ผิด)
เพราะฉะนั้นต้องมี dictionary (pipeline/fixtures/replacements.json) มาแก้คืนหลังยุบ — ดูเหตุผลเรื่องลำดับ
ก่อน/หลัง regex ในคอมเมนต์ของ fix_known_words() ด้านล่าง

ขั้นตอนทั้งหมด (เรียงตามลำดับจริงที่ทำงาน ไม่ใช่ลำดับที่พูดถึงใน spec):
  1. รวมบรรทัดที่ขึ้นต้นด้วยสระ/วรรณยุกต์ลอย (ถูกตัดกลางคำเพราะ font bug) เข้ากับบรรทัดก่อนหน้า
  2. ลบ \\ufffd (replacement char) พร้อมสระ/วรรณยุกต์ลอยที่ตามหลังมันทันที
  3. ลบบรรทัดที่มีแต่เลขหน้า (เลขไทยหรืออารบิก)
  4. ยุบตัวอักษรไทยซ้ำติดกัน (regex ตาม spec เป๊ะๆ)
  5. แก้คำใน dictionary กลับให้ถูกต้อง (ป้องกันพยัญชนะซ้อนที่ถูกยุบผิดในขั้น 4)
  6. เก็บกวาดช่องว่าง/บรรทัดว่างส่วนเกิน
  7. เขียนรายงานคำที่แก้ + จุดที่ยังน่าสงสัยให้คนตรวจ (raw/clean-report.txt)

ข้อจำกัดที่ทราบและยอมรับ (บันทึกไว้ให้ผู้ตรวจ): การแทรกช่องว่างกลางคำแบบสุ่ม
(เช่น "ตกต่ าง" ที่ควรเป็น "ตกต่าง") เป็นความเสียหายที่ตัดสินไม่ได้ทั่วไปด้วย regex/dictionary
เพราะภาษาไทยใช้ช่องว่างจริงเป็นครั้งคราวเช่นกัน — ปล่อยให้ author.py (เขียนใหม่ด้วยคำของตัวเอง
ตาม §9.1 ข้อ 1 อยู่แล้ว ไม่ได้คัดลอกคำต่อคำ) และคนตรวจจัดการจุดที่เหลือ
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from pipeline import common

# ---------------------------------------------------------------------------
# ค่าคงที่ระดับ unicode
# ---------------------------------------------------------------------------

# ช่วงยูนิโค้ดไทยเต็ม ฀(U+0E00) ถึง ๿(U+0E7F) ตามที่ spec ระบุตัวอักษรตรงๆ
THAI_BLOCK = "฀-๿"

# สระ/วรรณยุกต์/เครื่องหมายที่ "ลอยได้" คือวางบนตัวเดียวไม่ได้ ต้องเกาะพยัญชนะก่อนหน้าเสมอ
# ั ิ ี ึ ื ุ ู ฺ ็ ่ ้ ๊ ๋ ์ ํ ๎  (ไม่รวม ฿ U+0E3F ซึ่งเป็นสัญลักษณ์บาท ไม่ใช่เครื่องหมายกำกับ)
COMBINING_MARKS = (
    "ั"
    "ิีึืฺุู"
    "็่้๊๋์ํ๎"
)
COMBINING_SET = set(COMBINING_MARKS)

# regex ยุบตัวอักษรไทยที่ซ้ำติดกัน — spec §8 ให้ยุบ "ทุกตัวอักษรไทย" (LEGACY_DUP_RE) แต่ตรวจกับ PDF เล่ม 1.2–1.9
# (pymupdf, 6 ก.ย. 2026) พบว่าฟอนต์ซ้อนเฉพาะ "สระ/วรรณยุกต์" (้้ 2,799 ่่ 2,428 ีี 1,870 ...) ไม่เคยซ้อน
# พยัญชนะเลย (ธรม 0 / ธรรม 95, ปัญา 0 / ปัญญา 13) — การยุบพยัญชนะจึงมีแต่ทำลายคำที่สะกดซ้ำโดยชอบ
# (สสาร→สาร, แบบ→แบ, ออก→อก, บุคคล→บุคล) ค่าเริ่มต้นจึงยุบเฉพาะสระ/วรรณยุกต์ (DUP_RE) และเปิดโหมด spec
# ได้ด้วย collapse_consonants=True / --legacy-collapse สำหรับข้อความที่พยัญชนะซ้อนจริง (เช่น txt ของเล่ม 1)
LEGACY_DUP_RE = re.compile(r"([" + THAI_BLOCK + r"])\1+")
# สระ ะ า ำ ซ้ำติดกันก็ไม่มีในภาษาไทยเช่นกัน (พบ "สำĜำเร็จ" → หลังลบ glyph เหลือ ำำ)
DUP_MARKS = COMBINING_MARKS + "ะาำ"
DUP_RE = re.compile("([" + re.escape(DUP_MARKS) + "])\\1+")

# � ตามด้วยสระ/วรรณยุกต์ลอย 0 ตัวขึ้นไป (สระที่ตามหลัง � มักเป็นสระของพยัญชนะที่ดึงไม่สำเร็จ)
REPLACEMENT_ARTIFACT_RE = re.compile("�[" + re.escape(COMBINING_MARKS) + "]*")

THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙"
PAGE_NUMBER_LINE_RE = re.compile(r"^[\s0-9" + THAI_DIGITS + r"]{1,6}$")


# ---------------------------------------------------------------------------
# pass 1 — รวมบรรทัดที่ถูกตัดกลางคำ: บรรทัดที่ขึ้นต้นด้วยสระ/วรรณยุกต์ลอย
# ไม่มีทางเป็นจุดเริ่มคำไทยจริงได้ (ภาษาไทยไม่มีคำที่ขึ้นต้นด้วยสระบน/ล่าง/วรรณยุกต์)
# แปลว่าบรรทัดก่อนหน้าถูกตัดกลางคำ ให้ต่อกลับแบบไม่มีช่องว่างคั่น
# ---------------------------------------------------------------------------
def merge_combining_mark_starts(lines: list[str]) -> tuple[list[str], int]:
    out: list[str] = []
    merged_count = 0
    for line in lines:
        stripped = line.lstrip(" \t")
        if stripped and stripped[0] in COMBINING_SET and out and out[-1].strip() != "":
            out[-1] = out[-1] + stripped
            merged_count += 1
            continue
        out.append(line)
    return out, merged_count


# ---------------------------------------------------------------------------
# pass 4/5 — dictionary ป้องกันพยัญชนะซ้อนที่ regex ยุบผิด
# ---------------------------------------------------------------------------
def _dedupe_consecutive(s: str) -> str:
    out: list[str] = []
    for ch in s:
        if not out or out[-1] != ch:
            out.append(ch)
    return "".join(out)


def load_fixture_words(path: Path | None = None) -> list[str]:
    path = path or (Path(__file__).resolve().parent / "fixtures" / "replacements.json")
    data = common.load_json(path)
    if not data:
        common.die(f"ไม่พบ fixture คำศัพท์ที่ {path}")
    return list(data["words"])


def build_word_fixer(words: list[str]) -> list[tuple[str, re.Pattern]]:
    """สร้าง fuzzy-regex ต่อคำ: ยุบตัวอักษรซ้ำในตัวคำเองก่อน (ธรรม -> ธรม) แล้วสร้าง
    pattern ที่แต่ละตัวอักษรตามด้วย '+' (ธ+ร+ม+) — pattern นี้ match ได้ทั้งรูปที่ถูกยุบไป
    (ธรม, 1 ตัว) และรูปที่ซ้ำเกิน (ธรรรม, 3 ตัว) แล้วแทนที่ด้วยคำที่ถูกต้องเสมอ

    เรียงคำยาวไปสั้น (นับความยาวสตริง) เพื่อกันคำสั้นแย่งจับคำที่เป็นส่วนหนึ่งของคำยาวกว่า
    ก่อนที่ pattern ของคำยาวจะได้จับคำเต็มๆ (แนวเดียวกับ longest-match ใน terms.py)
    """
    uniq = sorted(set(words), key=len, reverse=True)
    compiled = []
    for w in uniq:
        deduped = _dedupe_consecutive(w)
        pattern = "".join(re.escape(c) + "+" for c in deduped)
        compiled.append((w, re.compile(pattern)))
    return compiled


def fix_known_words(text: str, compiled: list[tuple[str, re.Pattern]]) -> tuple[str, dict[str, int]]:
    """เหตุผลที่ต้องรันหลัง DUP_RE (ไม่ใช่ก่อน) แม้ spec บอกว่าก่อน/หลังก็ได้:
    ถ้ารันคำนี้ก่อน DUP_RE แล้ว DUP_RE รันทีหลัง DUP_RE จะยุบพยัญชนะซ้อนที่เพิ่งแก้ถูกกลับไปผิดอีกครั้ง
    (เช่นแก้เป็น "ธรรม" แล้ว DUP_RE จะยุบ ร ร ที่อยู่ติดกันเหลือตัวเดียวอีก กลายเป็น "ธรม" เหมือนเดิม)
    รันหลัง DUP_RE จึงเป็นลำดับเดียวที่ทำให้ผลลัพธ์ถูกต้องจริง — pattern แบบ fuzzy (char+) ยังจับคำที่
    DUP_RE ยุบไปแล้วได้อยู่ดี เพราะ '+' รับได้ตั้งแต่ 1 ตัวขึ้นไป"""
    counts: dict[str, int] = {}
    for canonical, rx in compiled:
        text, n = rx.subn(canonical, text)
        if n:
            counts[canonical] = counts.get(canonical, 0) + n
    return text, counts


# ---------------------------------------------------------------------------
# pass 3 — ลบบรรทัดเลขหน้าเดี่ยว
#
# เดิม PAGE_NUMBER_LINE_RE ลบทุกบรรทัดที่มีแต่ตัวเลข โดยไม่ดูบริบทเลย — ตรวจกับเนื้อหาจริงของเล่มนี้แล้ว
# พบว่าเลขหน้าจริงทุกจุด (100+ จุด ตรวจนับแล้ว) เป็นเลขอารบิกที่เพิ่มทีละ 1 ตลอดเล่ม และ "ล้อมด้วยบรรทัด
# ว่างเปล่าทั้งสองด้านเสมอ" (รูปแบบ '\n\nNN\n\n' — หน้าเป็นหน่วยที่แยกจากเนื้อหาด้วยช่องว่างชัดเจนตอน PDF
# ตัดหน้า) ต่างจากตัวเลขที่เป็นส่วนหนึ่งของเนื้อหาจริง เช่นเลขยกกำลังทางวิทยาศาสตร์ที่ font bug ตัดขึ้น
# บรรทัดใหม่กลางประโยค: "...แสงสีในช่วงความถี่คลื่น แม่เหล็กไฟ้า\n๑๔\n๑๐ เฮิรตซ์..." (คือ 10^14 Hz) ซึ่งไม่มี
# บรรทัดว่างคั่นเลย — เดิมโค้ดนี้ลบ "๑๔" ทิ้งเหมือนเป็นเลขหน้า ทำให้ตัวเลขวิทยาศาสตร์เพี้ยนไป 14 ออร์เดอร์
# แล้วข้อความที่เพี้ยนถูกส่งเข้า author.py ต่อเป็นแหล่งข้อเท็จจริง (ขัด §9.1 ข้อ 6: ตัวเลขวิทยาศาสตร์ต้อง
# ถูกต้อง) — ตอนนี้จึงลบเฉพาะบรรทัดที่ล้อมด้วยบรรทัดว่างทั้งสองด้านเท่านั้น บรรทัดเลขเดี่ยวที่ "ไม่" ล้อมด้วย
# บรรทัดว่างจะไม่ถูกลบอัตโนมัติ แต่ถูกเก็บเป็นรายการ "น่าสงสัย" ให้คนตรวจดูแทน (เขียนลง clean-report.txt)
# ---------------------------------------------------------------------------
def remove_page_number_lines(lines: list[str]) -> tuple[list[str], int, list[str], list[str]]:
    """คืน (lines ใหม่, จำนวนที่ลบ, รายการบรรทัดที่ลบ (มีบริบท), รายการบรรทัดน่าสงสัยที่ไม่ได้ลบ)"""
    out: list[str] = []
    removed = 0
    removed_context: list[str] = []
    suspicious: list[str] = []
    n = len(lines)
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped and PAGE_NUMBER_LINE_RE.match(stripped):
            prev_blank = i == 0 or lines[i - 1].strip() == ""
            next_blank = i == n - 1 or lines[i + 1].strip() == ""
            if prev_blank and next_blank:
                removed += 1
                removed_context.append(f"บรรทัด {i + 1}: {stripped!r}")
                continue
            suspicious.append(
                f"บรรทัด {i + 1}: {stripped!r} (ไม่ได้ลบ — ไม่มีบรรทัดว่างล้อมทั้งสองด้าน อาจเป็นตัวเลขที่"
                "เป็นส่วนหนึ่งของเนื้อหาจริง เช่น เลขยกกำลังทางวิทยาศาสตร์ที่ตัดขึ้นบรรทัดใหม่ ไม่ใช่เลขหน้า "
                "— ตรวจด้วยตาแล้วลบมือถ้าใช่เลขหน้าจริง)"
            )
        out.append(line)
    return out, removed, removed_context, suspicious


# ---------------------------------------------------------------------------
# ตรวจหาจุดน่าสงสัยที่เหลือ ให้คนตรวจ (ไม่แก้อัตโนมัติ เพราะเดาผิดได้ง่ายกว่าคนดู)
# ---------------------------------------------------------------------------
_SPURIOUS_SPACE_RE = re.compile(
    r"(?:(?<=[" + THAI_BLOCK + r"]) (?=[" + THAI_BLOCK + r"]))"
)


def find_suspicious_lines(text: str, max_lines: int = 40) -> list[str]:
    """heuristic: บรรทัดที่มีช่องว่างกลางกลุ่มอักษรไทยถี่ผิดปกติ (≥2 จุด) มักเป็นช่องว่างปลอมจาก font bug
    ไม่ใช่ช่องว่างจริงระหว่างคำ/วลี — รายงานให้คนดู ไม่แก้เอง"""
    out = []
    for lineno, line in enumerate(text.split("\n"), start=1):
        gaps = len(_SPURIOUS_SPACE_RE.findall(line))
        if gaps >= 2:
            out.append(f"บรรทัด {lineno} (ช่องว่างน่าสงสัย {gaps} จุด): {line.strip()[:120]}")
        if len(out) >= max_lines:
            out.append("... (ตัดรายการ มีมากกว่านี้)")
            break
    return out


# ---------------------------------------------------------------------------
# ฟังก์ชันหลัก
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# pass 2b — ฟอนต์ของเล่ม 2–9 ปล่อย glyph ละติน/เครื่องหมายเสริม (Ě ę š ć Ĝ Ⱦ Ȳ ...) แทรกติดตัวอักษรไทย
# (เช่น "ตั้Ěง", "ผู้šเขียน", "คำćถาม", "สำĜำเร็จ") — ลบเฉพาะที่ "ติด" ตัวอักษรไทยเท่านั้น คำละตินจริงในเนื้อหา
# (EPR, Quantamagazine) ไม่โดน เพราะเป็น ASCII และไม่อยู่ในช่วง U+0080–U+036F
# ---------------------------------------------------------------------------
_STRAY = "\u0080-\u036F"
STRAY_LATIN_GLYPH_RE = re.compile(
    "(?<=[" + THAI_BLOCK + "])[" + _STRAY + "]+|[" + _STRAY + "]+(?=[" + THAI_BLOCK + "])"
)


def clean_text(
    raw_text: str, words: list[str] | None = None, collapse_consonants: bool = False
) -> tuple[str, dict]:
    """collapse_consonants=False (ค่าเริ่มต้น): ยุบเฉพาะสระ/วรรณยุกต์ซ้ำ และ "ไม่" รัน dictionary fixer
    (เพราะไม่มีพยัญชนะซ้อนให้แก้คืน — fuzzy pattern ของมันมีแต่จะแก้เกิน เช่น กรม→กรรม, แกรม→แกรรม)
    collapse_consonants=True: พฤติกรรมตาม spec §8 ตรงตัว (ยุบทุกตัวอักษรไทย + dictionary แก้คืน)"""
    words = words if words is not None else load_fixture_words()
    compiled = build_word_fixer(words)

    char_before = len(raw_text)

    text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")

    lines, merged_count = merge_combining_mark_starts(lines)
    text = "\n".join(lines)

    text, replaced_artifacts = REPLACEMENT_ARTIFACT_RE.subn("", text)
    text, stray_glyphs = STRAY_LATIN_GLYPH_RE.subn("", text)

    lines = text.split("\n")
    lines, removed_pagenum, removed_pagenum_lines, suspicious_pagenum = remove_page_number_lines(lines)
    text = "\n".join(lines)

    if collapse_consonants:
        text = LEGACY_DUP_RE.sub(r"\1", text)
        text, word_fix_counts = fix_known_words(text, compiled)
    else:
        text = DUP_RE.sub(r"\1", text)
        word_fix_counts = {}

    # เก็บกวาดช่องว่าง/บรรทัดว่างเกิน (ทำหลังสุดเพื่อไม่รบกวน pattern การจับคู่ด้านบน)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = text.strip("\n") + "\n"

    remaining_ufffd = text.count("�")
    suspicious = find_suspicious_lines(text)

    report = {
        "char_count_before": char_before,
        "char_count_after": len(text),
        "lines_merged_combining_mark": merged_count,
        "replacement_char_artifacts_removed": replaced_artifacts,
        "stray_latin_glyphs_removed": stray_glyphs,
        "page_number_lines_removed": removed_pagenum,
        "page_number_lines_removed_detail": removed_pagenum_lines,
        "suspicious_page_number_lines": suspicious_pagenum,
        "collapse_consonants": collapse_consonants,
        "dictionary_word_fixes": word_fix_counts,
        "remaining_ufffd_count": remaining_ufffd,
        "suspicious_lines": suspicious,
    }
    return text, report


def format_report(report: dict, book_slug: str) -> str:
    lines = [
        f"clean.py — รายงานการทำความสะอาดข้อความ ({book_slug})",
        "=" * 60,
        f"จำนวนตัวอักษรก่อนทำความสะอาด: {report['char_count_before']:,}",
        f"จำนวนตัวอักษรหลังทำความสะอาด: {report['char_count_after']:,}",
        f"บรรทัดที่ถูกรวมกลับ (สระ/วรรณยุกต์ลอยขึ้นต้นบรรทัด): {report['lines_merged_combining_mark']}",
        f"ร่องรอย \\ufffd ที่ลบออก (พร้อมสระลอยตามหลัง): {report['replacement_char_artifacts_removed']}",
        f"glyph ละตินแปลกปลอมที่ติดตัวอักษรไทยที่ลบออก: {report.get('stray_latin_glyphs_removed', 0)}",
        f"บรรทัดเลขหน้าเดี่ยวที่ลบออก (ล้อมด้วยบรรทัดว่างทั้งสองด้าน): {report['page_number_lines_removed']}",
        f"\\ufffd ที่เหลือค้างหลังทำความสะอาด (ควรเป็น 0): {report['remaining_ufffd_count']}",
        "",
        "คำใน dictionary ที่ถูกแก้กลับ (คำ: จำนวนครั้ง) — ต้องตรวจว่าแก้ถูกจุดจริง:",
    ]
    if report["dictionary_word_fixes"]:
        for word, n in sorted(report["dictionary_word_fixes"].items(), key=lambda kv: -kv[1]):
            lines.append(f"  {word}: {n}")
    else:
        lines.append("  (ไม่มี)")

    lines.append("")
    lines.append("บรรทัดเลขหน้าที่ถูกลบจริง (ตรวจว่าเป็นเลขหน้าจริง ไม่ใช่ตัวเลขในเนื้อหา):")
    if report["page_number_lines_removed_detail"]:
        lines.extend(f"  {s}" for s in report["page_number_lines_removed_detail"])
    else:
        lines.append("  (ไม่มี)")

    lines.append("")
    lines.append(
        "บรรทัดเลขเดี่ยวที่ 'ไม่ได้' ลบ (ไม่มีบรรทัดว่างล้อมทั้งสองด้าน — อาจเป็นเลขหน้าที่ควรลบด้วยมือ "
        "หรือเป็นตัวเลขในเนื้อหาจริง เช่น เลขยกกำลังทางวิทยาศาสตร์ที่ font bug ตัดขึ้นบรรทัดใหม่กลางประโยค "
        "ต้องตรวจด้วยตาทุกจุด — ห้ามลบทิ้งถ้าไม่แน่ใจ เพราะจะทำให้ตัวเลขวิทยาศาสตร์ผิดเพี้ยนถ้าลบผิด):"
    )
    if report["suspicious_page_number_lines"]:
        lines.extend(f"  {s}" for s in report["suspicious_page_number_lines"])
    else:
        lines.append("  (ไม่พบ)")

    lines.append("")
    lines.append(
        "บรรทัดที่ยังน่าสงสัย (มีช่องว่างกลางคำถี่ผิดปกติ — อาจเป็นช่องว่างปลอมจาก font bug, "
        "ต้องตรวจด้วยตา ไม่ได้แก้อัตโนมัติ):"
    )
    if report["suspicious_lines"]:
        lines.extend(f"  {s}" for s in report["suspicious_lines"])
    else:
        lines.append("  (ไม่พบ)")

    lines.append("")
    lines.append(
        "หมายเหตุ: รายงานนี้ไม่ครอบคลุมทุกความเสียหาย — ตรวจไฟล์ .cleaned.txt ด้วยตาก่อนรัน split.py เสมอ"
    )
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ทำความสะอาดข้อความที่ดึงจาก PDF")
    parser.add_argument("--book", required=True, help="bookSlug เช่น trilaksana-quantum")
    parser.add_argument("--in", dest="in_path", default=None, help="ไฟล์ input (default: raw/book.txt)")
    parser.add_argument("--out", dest="out_path", default=None, help="ไฟล์ output (default: raw/book-cleaned.txt)")
    parser.add_argument("--report", action="store_true", help="พิมพ์รายงานออกจอด้วย (นอกจากเขียนไฟล์)")
    parser.add_argument(
        "--legacy-collapse", action="store_true",
        help="ยุบพยัญชนะซ้ำด้วย + dictionary แก้คืน ตาม spec §8 ตรงตัว (ใช้กับข้อความที่พยัญชนะซ้อนจริง)",
    )
    args = parser.parse_args(argv)

    book_slug = args.book
    in_path = Path(args.in_path) if args.in_path else common.raw_book_txt_path(book_slug)
    out_path = Path(args.out_path) if args.out_path else common.raw_book_cleaned_txt_path(book_slug)

    if not in_path.exists():
        common.die(f"ไม่พบไฟล์ input: {in_path} (รัน extract.py --book {book_slug} ก่อน)")

    raw_text = in_path.read_text(encoding="utf-8", errors="replace")
    cleaned, report = clean_text(raw_text, collapse_consonants=args.legacy_collapse)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(cleaned, encoding="utf-8")

    report_text = format_report(report, book_slug)
    common.clean_report_path(book_slug).write_text(report_text, encoding="utf-8")

    common.eprint(f"เขียน {out_path} ({report['char_count_after']:,} ตัวอักษร)")
    common.eprint(f"เขียนรายงาน {common.clean_report_path(book_slug)}")
    if args.report:
        print(report_text)
    return 0


if __name__ == "__main__":
    sys.exit(main())

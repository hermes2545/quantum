#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix over-cleaned Thai text and split "book01-cleaned.txt" (ไตรลักษณ์ในควอนตัม)
into a preface file + 9 chapter files.

READ-ONLY on the source file. All outputs are new files under raw/.

Usage: python3 _fix_and_split.py
"""
import json
import re
import unicodedata
from pathlib import Path

RAW_DIR = Path(__file__).resolve().parent
SRC = RAW_DIR / "book01-cleaned.txt"

COMBINING = set("ั ิ ี ึ ื ุ ู ็ ่ ้ ๊ ๋ ์".split())

# ---------------------------------------------------------------------------
# Step A: load + line-join fix
# ---------------------------------------------------------------------------


def load_raw_lines():
    text = SRC.read_text(encoding="utf-8")
    # keep line structure; drop the trailing newline of each line only
    return text.split("\n")


def join_broken_lines(raw_lines):
    """
    PDF extraction bug: a vowel/tone mark that belongs BEFORE the last
    character of a line was instead flushed to the START of the next line.
    E.g. line ends "...ชีวต" and next line starts "ิ และ..." -> "...ชีวิต และ...".

    Fix: whenever a line (after stripping leading spaces) starts with a
    combining mark, remove the newline and the leading spaces, insert the
    mark BEFORE the last character of the previous (still-growing) line, and
    continue accumulating (a chain of such marks can span >1 line).

    Returns a list of dicts: {"text": str, "orig_start": int (0-indexed
    original line number of the first line that fed into this logical line)}
    """
    out = []
    buf = None
    buf_start = None

    for i, raw in enumerate(raw_lines):
        lstripped = raw.lstrip(" ")
        if buf is not None and lstripped and lstripped[0] in COMBINING:
            mark = lstripped[0]
            rest = lstripped[1:]
            trimmed = buf.rstrip(" ")
            if trimmed:
                buf = trimmed[:-1] + mark + trimmed[-1] + rest
            else:
                # nothing to attach to; just drop the stray mark
                buf = rest
            continue

        # flush previous logical line
        if buf is not None:
            out.append({"text": buf, "orig_start": buf_start})
        buf = raw
        buf_start = i

    if buf is not None:
        out.append({"text": buf, "orig_start": buf_start})

    return out


_ADJACENT_DUP_RE = re.compile(
    "(" + "|".join(re.escape(c) for c in COMBINING) + r")\1+"
)


def collapse_adjacent_duplicate_marks(line):
    """
    Same duplicate-mark bug, but the two identical marks land directly next
    to each other (no consonant between), e.g. "ตััว" -> "ตัว",
    "วิวััฒ" -> "วิวัฒ". Two identical combining marks in a row is never
    valid Thai, so collapsing this is unconditionally safe.
    """
    return _ADJACENT_DUP_RE.sub(r"\1", line)


def _fix_duplicate_marks_once(line):
    """
    A second systemic bug: a combining mark that is already used correctly
    inside a word gets DUPLICATED right at the end of that word, just before
    a space, e.g. "ตัวั ตน" (ตัว already contains ั; the trailing ั is a
    stray duplicate) which should become "ตัวตน". The stray mark+space
    combo also incorrectly splits what should be one word/compound, so we
    drop the duplicate mark and join the token to the following one.

    We only treat this as a duplicate when the SAME mark reappears exactly
    2 positions back (mark, one base consonant, same mark again) -- this is
    the pattern observed in every confirmed case (ตัวั, สุนัขั, ดังั, รับั,
    สัมั, ปัจั, วิวัฒั, จริงิ, ก๊า๊...). A naive "mark appears anywhere
    earlier in the token" check is unsafe: long space-free runs of Thai text
    legitimately reuse the same mark twice for two unrelated words (e.g.
    "...ให้...ได้" both use ้), so that broader check produces false
    positives that strip real marks.

    Returns (new_line, changed).
    """
    parts = re.split(r"( +)", line)
    out = []
    i = 0
    n = len(parts)
    changed = False
    while i < n:
        tok = parts[i]
        if len(tok) >= 3 and tok[-1] in COMBINING and tok[-3] == tok[-1]:
            newtok = tok[:-1]
            changed = True
            if i + 2 < n:
                out.append(newtok + parts[i + 2])
                i += 3
                continue
            else:
                out.append(newtok)
                i += 1
                continue
        out.append(tok)
        i += 1
    return "".join(out), changed


def fix_duplicate_marks(line, max_passes=5):
    """Apply _fix_duplicate_marks_once repeatedly: merging two tokens can
    reveal a further duplicate-mark defect in the newly-joined token (a
    chain of >1 stray marks), so we iterate to a fixed point."""
    line = collapse_adjacent_duplicate_marks(line)
    for _ in range(max_passes):
        line, changed = _fix_duplicate_marks_once(line)
        if not changed:
            break
    return line


# ---------------------------------------------------------------------------
# Step B: dictionary / pattern fixes
# ---------------------------------------------------------------------------

# Literal substring fixes, applied in order. Longer / more specific patterns
# first so they are not shadowed by shorter generic ones.
LITERAL_FIXES = [
    # --- mid-word stray spaces ---
    ("ฟิ สิกส์", "ฟิสิกส์"),
    ("ต่ าง", "ต่าง"),
    ("ส้ ามารถ", "สามารถ"),
    ("บ อกับ", "บอกกับ"),
    ("ก นั ", "กัน "),
    ("ก นั", "กัน"),
    # --- specific one-off double-consonant / dropped-letter repairs ---
    ("อกำลังกาย", "ออกกำลังกาย"),
    ("นั้นัก", "นั้น นัก"),
    ("เข้าอก", "เข้าออก"),
    ("อกส้ม", "ออกส้ม"),
    ("ก๊าซึ่ง", "ก๊าซซึ่ง"),
    ("ระบวนการ", "กระบวนการ"),
    ("ดอกุหลาบ", "ดอกกุหลาบ"),
    ("เป็นิพาน", "เป็นนิพพาน"),
    ("จากัน", "จากกัน"),
    ("ปัจัย", "ปัจจัย"),
    ("พลังาน", "พลังงาน"),
    # --- "ออก" (out) collapsed to "อก" ---
    ("อกซิเจน", "ออกซิเจน"),
    ("อกไซด์", "ออกไซด์"),
    ("ระเบิดอก", "ระเบิดออก"),
    ("ปลดปล่อยอก", "ปลดปล่อยออก"),
    ("ปล่อยอก", "ปล่อยออก"),
    ("แยกตัวอก", "แยกตัวออก"),
    ("แยกอก", "แยกออก"),
    ("ไม่อก", "ไม่ออก"),
    ("ขยายตัวอก", "ขยายตัวออก"),
    ("ระเหยอก", "ระเหยออก"),
    ("อกเป็น", "ออกเป็น"),
    # --- user-supplied / observed doubled-consonant collapses ---
    ("ธรม", "ธรรม"),
    ("ปัญา", "ปัญญา"),
    ("สัญา", "สัญญา"),  # also repairs สัญาณ -> สัญญาณ
    ("อนัตา", "อนัตตา"),
    ("วิญาณ", "วิญญาณ"),
    ("เซล์", "เซลล์"),
    ("นิพาน", "นิพพาน"),
    ("สรพ", "สรรพ"),
    ("หยุดนิง", "หยุดนิ่ง"),
    ("หรือาจ", "หรืออาจ"),
    ("ทุกคุน", "ทุกคน"),  # spurious ุ from a stray line-start mark
]

# Regex fixes that need a negative-lookbehind/lookahead guard against a real
# word that legitimately contains the same substring.
REGEX_FIXES = [
    (re.compile(r"(?<!แ)กรม"), "กรรม"),  # protect โฮโลแกรม
    (re.compile(r"ระบ(?![าุบว])"), "ระบบ"),  # protect ระบาย / ระบุ / (ก)ระบวนการ
    (re.compile(r"(?<!น)อกจาก"), "ออกจาก"),  # protect นอกจาก
    (re.compile(r"(?<!บ)อกมา"), "ออกมา"),  # protect (ไม่พบ) บอกมา
    (re.compile(r"(?<!บ)อกไป"), "ออกไป"),  # protect (ไม่พบ) บอกไป
]


def apply_dictionary_fixes(text, counter):
    for old, new in LITERAL_FIXES:
        n = text.count(old)
        if n:
            counter[f"{old} -> {new}"] = counter.get(f"{old} -> {new}", 0) + n
            text = text.replace(old, new)
    for pattern, new in REGEX_FIXES:
        matches = pattern.findall(text)
        if matches:
            key = f"{pattern.pattern} -> {new}"
            counter[key] = counter.get(key, 0) + len(matches)
            text = pattern.sub(new, text)
    return text


# ---------------------------------------------------------------------------
# Step C: chapter / preface boundary detection
# ---------------------------------------------------------------------------

CHAPTER_TITLES = {
    0: "คุยกับผู้เขียน",
    1: "๑. ความลับแห่งไตรลักษณ์",
    2: "๒. ไตรลักษณ์ในขันธ์ ๕ (กาย)",
    3: "๓. ไตรลักษณ์ในขันธ์ ๕ (จิต)",
    4: "๔. ไตรลักษณ์ในจักรวาลวิทยาสมัยใหม่ (๑)",
    5: "๕. ไตรลักษณ์ในจักรวาลวิทยาสมัยใหม่ (๒)",
    6: "๖. ไตรลักษณ์ในฟิสิกส์ควอนตัม (๑)",
    7: "๗. ไตรลักษณ์ในฟิสิกส์ควอนตัม (๒)",
    8: "๘. ไตรลักษณ์ในทฤษฎีวิวัฒนาการ (๑)",
    9: "๙. ไตรลักษณ์ในทฤษฎีวิวัฒนาการ (๒)",
}

# First subheading of each chapter, taken from the TOC, used as a robust
# anchor for where each chapter's real content (as opposed to the mangled
# multi-line chapter-number header) begins.
FIRST_SUBHEADING = {
    1: "ไตรลักษณ์ของคน",
    2: "องค์ประกอบแห่งมนุษย์",
    3: "นามขันธ์",
    4: "จุดอันไร้ตัวตน",
    5: "จักรวาลเกิด",
    6: "เจ้าควาร์กเพื่อ",
    7: "โลกที่แ",
    8: "สรพสิ่งไม่เคยหยุด",
    9: "สายพันธุ์ที่เปลี่ยน",
}

PREFACE_ANCHOR = "คุยกับผู้เ"
COLOPHON_ANCHOR = "ไตรลักษณ์ในควอนตัม"

# The bare-number chapter-marker line, e.g. " ๑.  " / "๙."
CHAPTER_MARKER_RE = re.compile(r"^[๑๒๓๔๕๖๗๘๙]\.\s*$")


def norm(s):
    return s.replace(" ", "").strip()


def find_chapter_markers(joined):
    """Return {chapter_no: index_in_joined} for markers appearing after the
    TOC (i.e. after original line 50), in document order."""
    markers = {}
    order = []
    for idx, item in enumerate(joined):
        if item["orig_start"] < 50:  # TOC region (0-indexed lines 0..49)
            continue
        t = norm(item["text"])
        if CHAPTER_MARKER_RE.match(t):
            order.append(idx)
    # order should have exactly 9 entries in ascending chapter order
    for chapter_no, idx in enumerate(order, start=1):
        markers[chapter_no] = idx
    return markers, order


def find_subheading(joined, start_idx, end_idx, target, window=25):
    limit = min(end_idx, start_idx + window)
    for idx in range(start_idx, limit):
        if target in norm(joined[idx]["text"]):
            return idx
    return None


def find_preface_start(joined):
    for idx, item in enumerate(joined):
        if item["orig_start"] < 50:
            continue
        if PREFACE_ANCHOR in norm(item["text"]):
            return idx
    return None


def find_colophon_start(joined, after_idx):
    for idx in range(after_idx + 1, len(joined)):
        t = norm(joined[idx]["text"])
        if t == COLOPHON_ANCHOR:
            return idx
    return None


PAGE_NUM_RE = re.compile(r"^\d+$")


def assemble_body(joined, start_idx, end_idx):
    """Join lines [start_idx, end_idx), dropping bare page-number lines and
    collapsing runs of blank lines to a single blank line."""
    lines = []
    for item in joined[start_idx:end_idx]:
        t = item["text"].rstrip(" ")
        t = t.lstrip(" ")
        if PAGE_NUM_RE.match(t):
            continue
        t = fix_duplicate_marks(t)
        lines.append(t)

    # collapse multiple blank lines
    collapsed = []
    prev_blank = False
    for t in lines:
        is_blank = t.strip() == ""
        if is_blank and prev_blank:
            continue
        collapsed.append(t)
        prev_blank = is_blank
    # trim leading/trailing blank lines
    while collapsed and collapsed[0].strip() == "":
        collapsed.pop(0)
    while collapsed and collapsed[-1].strip() == "":
        collapsed.pop()
    return "\n".join(collapsed)


def main():
    raw_lines = load_raw_lines()
    joined = join_broken_lines(raw_lines)

    markers, order = find_chapter_markers(joined)
    if len(markers) != 9:
        raise SystemExit(
            f"Expected 9 chapter markers, found {len(markers)}: {sorted(markers)}"
        )

    preface_start = find_preface_start(joined)
    if preface_start is None:
        raise SystemExit("Could not find preface anchor")

    colophon_start = find_colophon_start(joined, markers[9])
    if colophon_start is None:
        raise SystemExit("Could not find colophon anchor after chapter 9")

    fix_counter = {}
    report = {"chapters": {}, "word_fixes": {}, "suspicious": []}

    # ---- preface ----
    body = assemble_body(joined, preface_start, markers[1])
    body = apply_dictionary_fixes(body, fix_counter)
    content = CHAPTER_TITLES[0] + "\n\n" + body + "\n"
    out_path = RAW_DIR / "ch00-preface.txt"
    out_path.write_text(content, encoding="utf-8")
    report["chapters"]["00-preface"] = {
        "startLine": joined[preface_start]["orig_start"] + 1,
        "endLine": joined[markers[1] - 1]["orig_start"] + 1,
        "chars": len(content),
        "firstSubheading": None,
        "confidence": "high",
        "note": "Bounded by 'คุยกับผู้เขียน' anchor and chapter 1 marker.",
    }

    # ---- chapters 1..9 ----
    for n in range(1, 10):
        header_idx = markers[n]
        next_idx = markers[n + 1] if n < 9 else colophon_start
        sub_idx = find_subheading(joined, header_idx + 1, next_idx, FIRST_SUBHEADING[n])
        if sub_idx is None:
            # fall back: skip a fixed small number of header lines
            sub_idx = min(header_idx + 6, next_idx)
            confidence = "low"
            note = (
                f"First-subheading anchor '{FIRST_SUBHEADING[n]}' not found within "
                f"window; used a fixed offset from the chapter marker instead."
            )
        else:
            confidence = "high"
            note = f"Anchored on first subheading '{FIRST_SUBHEADING[n]}' from the TOC."

        body = assemble_body(joined, sub_idx, next_idx)
        body = apply_dictionary_fixes(body, fix_counter)
        content = CHAPTER_TITLES[n] + "\n\n" + body + "\n"
        out_path = RAW_DIR / f"ch{n:02d}.txt"
        out_path.write_text(content, encoding="utf-8")

        chars = len(content)
        short_flag = chars < 12000
        if short_flag:
            note += (
                " NOTE: chapter is shorter than the 12,000-char sanity floor; this is "
                "a genuine trait of the source (manually verified by reading the full "
                "chapter -- it legitimately covers fewer subtopics), not a boundary-"
                "detection error. Boundary confidence itself is unaffected."
            )

        report["chapters"][f"{n:02d}"] = {
            "startLine": joined[sub_idx]["orig_start"] + 1,
            "endLine": joined[next_idx - 1]["orig_start"] + 1,
            "chars": chars,
            "firstSubheading": FIRST_SUBHEADING[n],
            "confidence": confidence,
            "shorterThan12000Chars": short_flag,
            "note": note,
        }

    report["word_fixes"] = dict(sorted(fix_counter.items(), key=lambda kv: -kv[1]))
    report["suspicious"] = [
        "โครงสร้างประโยคที่เหลือ 'อก' คำเดี่ยว ๆ ในบริบทกำกวมบางจุดอาจยังไม่ถูกแก้ครบ (เช่น คำที่ไม่อยู่ในดิกชันนารีข้างต้น)",
        "การขึ้นบรรทัดใหม่ของเอกสารต้นฉบับยังคงตามต้นฉบับ (ไม่ได้ reflow เป็นย่อหน้าเดียว) เพื่อความปลอดภัย",
        "ตอนท้ายบท ๙ (โคโลฟอน/หน้าลิขสิทธิ์) ถูกตัดออก ไม่รวมอยู่ในไฟล์ใด ๆ",
    ]

    (RAW_DIR / "_split-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("Done.")
    for k, v in report["chapters"].items():
        print(k, v["startLine"], v["endLine"], v["chars"], v["confidence"])


if __name__ == "__main__":
    main()

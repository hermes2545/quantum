"""
pipeline/tests/test_clean.py — unit test สำหรับ clean.py (ส่วนที่สำคัญที่สุดของ pipeline)

รัน: python3 -m unittest pipeline.tests.test_clean -v
หรือรันทั้งหมดใน pipeline/tests/: python3 -m unittest discover -s pipeline/tests -v
(รันจาก root ของ repo เสมอ ไม่ต้องตั้ง PYTHONPATH เพิ่ม เพราะ pipeline/ มี __init__.py แล้ว)
"""
from __future__ import annotations

import unittest

from pipeline import clean


class TestDupCollapseRegex(unittest.TestCase):
    """ตัวอย่างจาก docs/handoff-spec.md §8 ตรงๆ — regex ยุบอักษรไทยซ้ำติดกัน"""

    def test_examples_from_spec(self):
        cases = {
            "หนัังสืือ": "หนังสือ",
            "ไตรลัักษณ์์": "ไตรลักษณ์",
            "พระพุุทธองค์์": "พระพุทธองค์",
        }
        for src, expect in cases.items():
            with self.subTest(src=src):
                self.assertEqual(clean.DUP_RE.sub(r"\1", src), expect)

    def test_does_not_touch_single_chars(self):
        self.assertEqual(clean.DUP_RE.sub(r"\1", "ไตรลักษณ์"), "ไตรลักษณ์")


class TestDictionaryWordFix(unittest.TestCase):
    """คำที่ regex ยุบเกินไป (ตัวอย่างตรงจาก spec §8) — ต้องแก้กลับได้ถูกทุกคำ
    ทดสอบ fix_known_words() ตรงๆ (ไม่ผ่าน DUP_RE) เพื่อยืนยัน fuzzy-pattern ทำงานถูกไม่ว่า
    ต้นทางจะเป็นรูปที่ถูกยุบไปแล้ว (กรณีจริงหลัง DUP_RE) หรือรูปที่ถูกต้องอยู่แล้ว (ต้องไม่พัง)"""

    @classmethod
    def setUpClass(cls):
        cls.compiled = clean.build_word_fixer(clean.load_fixture_words())

    def fix(self, text: str) -> str:
        out, _ = clean.fix_known_words(text, self.compiled)
        return out

    def test_spec_examples_exact(self):
        # ตัวอย่างตรงจาก docs/handoff-spec.md §8: "ปัญา ควรเป็น ปัญญา, สัญา->สัญญา, ..."
        cases = {
            "ปัญา": "ปัญญา",
            "สัญา": "สัญญา",
            "อนัตา": "อนัตตา",
            "ธรม": "ธรรม",
            "กรม": "กรรม",
            "เซล์": "เซลล์",
            "นิพาน": "นิพพาน",
        }
        for src, expect in cases.items():
            with self.subTest(src=src):
                self.assertEqual(self.fix(src), expect)

    def test_required_minimum_word_list_present(self):
        required = [
            "ปัญญา", "สัญญา", "อนัตตา", "ธรรม", "กรรม", "เซลล์", "นิพพาน",
            "วิญญาณ", "สังขาร", "ขันธ์", "อัตตา", "ปัจจัย", "สัมมา", "ทุกข์", "นิโรธ", "มรรค",
        ]
        words = set(clean.load_fixture_words())
        for w in required:
            with self.subTest(word=w):
                self.assertIn(w, words)

    def test_under_doubled_words_restored(self):
        cases = {
            "วิญาณ": "วิญญาณ",
            "อัตา": "อัตตา",
            "ปัจัย": "ปัจจัย",
            "สัมา": "สัมมา",
            "มรค": "มรรค",
        }
        for src, expect in cases.items():
            with self.subTest(src=src):
                self.assertEqual(self.fix(src), expect)

    def test_words_without_natural_doubling_are_unchanged(self):
        for w in ("สังขาร", "ขันธ์", "ทุกข์", "นิโรธ"):
            with self.subTest(word=w):
                self.assertEqual(self.fix(w), w)

    def test_correctly_spelled_words_survive_full_pipeline(self):
        # ลำดับจริงใน clean_text(): DUP_RE ก่อน แล้ว fix_known_words — คำที่สะกดถูกอยู่แล้วต้องไม่พัง
        for w in ("ปัญญา", "ธรรม", "เซลล์", "นิพพาน", "สังขาร"):
            with self.subTest(word=w):
                collapsed = clean.DUP_RE.sub(r"\1", w)
                self.assertEqual(self.fix(collapsed), w)

    def test_longest_match_protects_substring_words(self):
        # อนัตตา ไม่ควรถูกคำสั้นกว่าอย่าง อัตตา แย่งจับจนพัง
        collapsed = clean.DUP_RE.sub(r"\1", "อนัตตา")  # -> อนัตา
        self.assertEqual(self.fix(collapsed), "อนัตตา")


class TestCombiningMarkMerge(unittest.TestCase):
    """สระ/วรรณยุกต์ลอยที่ขึ้นบรรทัดใหม่เพราะ font bug ต้องถูกต่อกลับบรรทัดก่อนหน้า"""

    def test_merges_leading_tone_mark(self):
        lines = ["โลกทีแ", "่ตกต่าง"]
        merged, count = clean.merge_combining_mark_starts(lines)
        self.assertEqual(merged, ["โลกทีแ่ตกต่าง"])
        self.assertEqual(count, 1)

    def test_does_not_merge_normal_lines(self):
        lines = ["โลกคนละใบ", "ควอนตัม สมอง จิต"]
        merged, count = clean.merge_combining_mark_starts(lines)
        self.assertEqual(merged, lines)
        self.assertEqual(count, 0)

    def test_leaves_blank_line_boundary_alone(self):
        # ถ้าบรรทัดก่อนหน้าว่างเปล่า ไม่มีที่ให้ต่อ — ปล่อยไว้เฉยๆ (ไม่ crash)
        lines = ["", "่ผิดที่"]
        merged, count = clean.merge_combining_mark_starts(lines)
        self.assertEqual(merged, ["", "่ผิดที่"])
        self.assertEqual(count, 0)


class TestReplacementCharCleanup(unittest.TestCase):
    def test_removes_ufffd_and_following_floating_marks(self):
        # � ตามด้วยวรรณยุกต์ลอย (เช่นสระของพยัญชนะที่ดึงไม่สำเร็จ) ต้องหายไปทั้งคู่
        text = "คำ�้ที่เหลือ"
        cleaned = clean.REPLACEMENT_ARTIFACT_RE.sub("", text)
        self.assertNotIn("�", cleaned)
        self.assertEqual(cleaned, "คำที่เหลือ")

    def test_bare_ufffd_removed(self):
        cleaned = clean.REPLACEMENT_ARTIFACT_RE.sub("", "ก่อน�หลัง")
        self.assertEqual(cleaned, "ก่อนหลัง")


class TestPageNumberRemoval(unittest.TestCase):
    def test_removes_lone_arabic_and_thai_digit_lines(self):
        lines = ["เนื้อหาบรรทัดแรก", "42", "เนื้อหาต่อ", "๘๘", "จบ"]
        out, removed = clean.remove_page_number_lines(lines)
        self.assertEqual(out, ["เนื้อหาบรรทัดแรก", "เนื้อหาต่อ", "จบ"])
        self.assertEqual(removed, 2)

    def test_does_not_remove_content_lines_with_numbers_inside(self):
        lines = ["ตัวเลข 42 อยู่กลางประโยค"]
        out, removed = clean.remove_page_number_lines(lines)
        self.assertEqual(out, lines)
        self.assertEqual(removed, 0)


class TestCleanTextEndToEnd(unittest.TestCase):
    def test_full_pipeline_on_synthetic_corrupted_text(self):
        raw = (
            "๑. ควาามลัับ\n"
            "๑\n"  # บรรทัดเลขหน้าเดี่ยว ต้องถูกลบ
            "เนื้อหาเรื่องปัญาและธรมในบทนี้ พูดถึงกรมและเซล์ด้วย\n"
            "สังขารกับขันธ์ไม่ได้ถูกแตะต้องเพราะไม่มีตัวซ้อน\n"
        )
        cleaned, report = clean.clean_text(raw)
        self.assertIn("ปัญญา", cleaned)
        self.assertIn("ธรรม", cleaned)
        self.assertIn("กรรม", cleaned)
        self.assertIn("เซลล์", cleaned)
        self.assertIn("สังขาร", cleaned)
        self.assertIn("ขันธ์", cleaned)
        self.assertNotIn("๑\n", cleaned.split("เนื้อหา")[0][-3:])
        self.assertEqual(report["page_number_lines_removed"], 1)
        self.assertGreaterEqual(report["dictionary_word_fixes"].get("ปัญญา", 0), 1)


if __name__ == "__main__":
    unittest.main()

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
    """กรณีจริงที่ reviewer เจอ: content/books/trilaksana-quantum/raw/book01-cleaned.txt มีบรรทัด
    '๑๔' เดี่ยวๆ กลางประโยค (ไม่มีบรรทัดว่างล้อม) ที่จริงคือเลขยกกำลัง 10^14 Hz ("...แสง\n๑๔\n๑๐ เฮิรตซ์...")
    ไม่ใช่เลขหน้า — ตรวจนับเลขหน้าจริงทั้งเล่ม (100+ จุด) พบว่าล้อมด้วยบรรทัดว่างทั้งสองด้านเสมอ
    ('\\n\\nNN\\n\\n') จึงใช้เป็นเกณฑ์แยกแทนการลบทุกบรรทัดที่มีแต่ตัวเลข"""

    def test_removes_lone_digit_lines_padded_by_blank_lines(self):
        # รูปแบบเลขหน้าจริงตามที่ตรวจสอบกับเนื้อหาจริง: บรรทัดว่างคั่นทั้งก่อนและหลัง
        lines = ["เนื้อหาบรรทัดแรก", "", "42", "", "เนื้อหาต่อ", "", "๘๘", "", "จบ"]
        out, removed, removed_detail, suspicious = clean.remove_page_number_lines(lines)
        self.assertEqual(out, ["เนื้อหาบรรทัดแรก", "", "", "เนื้อหาต่อ", "", "", "จบ"])
        self.assertEqual(removed, 2)
        self.assertEqual(len(removed_detail), 2)
        self.assertEqual(suspicious, [])

    def test_does_not_remove_content_lines_with_numbers_inside(self):
        lines = ["ตัวเลข 42 อยู่กลางประโยค"]
        out, removed, removed_detail, suspicious = clean.remove_page_number_lines(lines)
        self.assertEqual(out, lines)
        self.assertEqual(removed, 0)
        self.assertEqual(removed_detail, [])
        self.assertEqual(suspicious, [])

    def test_does_not_remove_lone_digit_line_without_blank_padding(self):
        # เคสจริงที่พบ: "๑๔" (เลขยกกำลังของ 10^14 Hz) อยู่กลางประโยค ไม่มีบรรทัดว่างล้อมเลย — ต้องไม่ถูกลบ
        # (ต่างจากพฤติกรรมเดิมที่ลบทุกบรรทัดตัวเลขเดี่ยวไม่ว่าบริบทใด ทำให้ตัวเลขวิทยาศาสตร์เพี้ยน)
        lines = [
            "เรามองเห็นแสงสีในช่วงความถี่คลื่นแม่เหล็กไฟ้า",
            "๑๔",
            "๑๐ เฮิรตซ์ ความยาวคลื่นแม่เหล็กไฟ้าที่ต่าง",
        ]
        out, removed, removed_detail, suspicious = clean.remove_page_number_lines(lines)
        self.assertEqual(out, lines)  # ไม่แตะเลย
        self.assertEqual(removed, 0)
        self.assertEqual(removed_detail, [])
        self.assertEqual(len(suspicious), 1)
        self.assertIn("๑๔", suspicious[0])

    def test_line_at_start_or_end_of_file_treated_as_blank_boundary(self):
        # บรรทัดแรก/สุดท้ายของไฟล์ไม่มี "บรรทัดก่อนหน้า/ถัดไป" จริง — นับเป็นขอบว่างได้ (ไม่ควร crash
        # และควรลบได้ถ้าอีกด้านเป็นบรรทัดว่างจริง)
        lines = ["7", "", "เนื้อหา"]
        out, removed, removed_detail, suspicious = clean.remove_page_number_lines(lines)
        self.assertEqual(out, ["", "เนื้อหา"])
        self.assertEqual(removed, 1)


class TestCleanTextEndToEnd(unittest.TestCase):
    def test_full_pipeline_on_synthetic_corrupted_text(self):
        raw = (
            "๑. ควาามลัับ\n"
            "\n"
            "๑\n"  # บรรทัดเลขหน้าเดี่ยว ล้อมด้วยบรรทัดว่างทั้งสองด้าน — ต้องถูกลบ
            "\n"
            "เนื้อหาเรื่องปัญาและธรมในบทนี้ พูดถึงกรมและเซล์ด้วย\n"
            "สังขารกับขันธ์ไม่ได้ถูกแตะต้องเพราะไม่มีตัวซ้อน\n"
        )
        # ข้อความสังเคราะห์นี้จำลอง "พยัญชนะซ้อน" ตาม spec §8 → ต้องใช้โหมด legacy (ค่าเริ่มต้นยุบเฉพาะสระ/วรรณยุกต์)
        cleaned, report = clean.clean_text(raw, collapse_consonants=True)
        self.assertIn("ปัญญา", cleaned)
        self.assertIn("ธรรม", cleaned)
        self.assertIn("กรรม", cleaned)
        self.assertIn("เซลล์", cleaned)
        self.assertIn("สังขาร", cleaned)
        self.assertIn("ขันธ์", cleaned)
        self.assertNotIn("๑\n\n", cleaned)
        self.assertEqual(report["page_number_lines_removed"], 1)
        self.assertGreaterEqual(report["dictionary_word_fixes"].get("ปัญญา", 0), 1)

    def test_preserves_scientific_exponent_split_mid_sentence(self):
        # เคสจริงจาก content/books/trilaksana-quantum/raw/book01-cleaned.txt: "๑๔" (เลขยกกำลังของ
        # 10^14 Hz) อยู่กลางประโยค ไม่มีบรรทัดว่างล้อม ต้อง "ไม่" ถูกลบเหมือนเลขหน้า (ต่างจากพฤติกรรมเดิม)
        raw = (
            "เรามองเห็นแสงสีในช่วงความถี่คลื่นแม่เหล็กไฟ้า\n"
            "๑๔\n"
            "๑๐ เฮิรตซ์ ความยาวคลื่นแม่เหล็กไฟ้าที่ต่างกันทำให้เกิดสีสัน\n"
        )
        cleaned, report = clean.clean_text(raw)
        self.assertIn("๑๔", cleaned)
        self.assertEqual(report["page_number_lines_removed"], 0)
        self.assertEqual(len(report["suspicious_page_number_lines"]), 1)


if __name__ == "__main__":
    unittest.main()

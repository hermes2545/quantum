"""
pipeline/tests/test_terms.py — unit test สำหรับ terms.py (auto-link <dfn> ตาม §9.2)

รัน: python3 -m unittest pipeline.tests.test_terms -v
"""
from __future__ import annotations

import unittest

from pipeline import terms


def lookup(*names: str) -> dict[str, dict]:
    return {n: {"term": n, "kind": "ธรรมะ", "alt": "", "def": "d"} for n in names}


class TestLongestMatch(unittest.TestCase):
    def test_prefers_longer_term_at_same_position(self):
        tl = lookup("ขันธ์ ๕", "ขันธ์")
        pattern = terms.build_master_pattern(sorted(tl, key=len, reverse=True))
        out, newly = terms.wrap_first_occurrence("ดูขันธ์ ๕ กัน", pattern, tl, set(), {})
        self.assertIn('data-term="ขันธ์ ๕"', out)
        self.assertNotIn('data-term="ขันธ์"', out)
        self.assertEqual(newly, {"ขันธ์ ๕"})


class TestFirstOccurrenceOnly(unittest.TestCase):
    def test_second_occurrence_in_same_scope_not_wrapped(self):
        tl = lookup("ทุกขัง")
        pattern = terms.build_master_pattern(list(tl))
        used: set[str] = set()
        out1, newly1 = terms.wrap_first_occurrence("ทุกขังคืออะไร", pattern, tl, used, {})
        out2, newly2 = terms.wrap_first_occurrence("ทุกขังอีกครั้ง", pattern, tl, used, {})
        self.assertIn("<dfn", out1)
        self.assertNotIn("<dfn", out2)
        self.assertEqual(newly2, set())


class TestExclusionList(unittest.TestCase):
    """กรณีจริงที่พบใน ch03: 'สติ' เป็นศัพท์ แต่ 'สติปัญญา' ที่ปรากฏในเนื้อหาไม่ได้เป็นศัพท์เอง"""

    def test_short_term_not_wrapped_inside_excluded_longer_word(self):
        tl = lookup("สติ")
        pattern = terms.build_master_pattern(list(tl))
        exclusions = {"สติ": ["สติปัญญา"]}
        out, newly = terms.wrap_first_occurrence(
            "การมีสติปัญญาเป็นเรื่องดี", pattern, tl, set(), exclusions
        )
        self.assertNotIn("<dfn", out)
        self.assertEqual(newly, set())

    def test_standalone_occurrence_elsewhere_still_wrapped(self):
        tl = lookup("สติ")
        pattern = terms.build_master_pattern(list(tl))
        exclusions = {"สติ": ["สติปัญญา"]}
        out, newly = terms.wrap_first_occurrence(
            "สติปัญญาสำคัญ แต่การมีสติเฉยๆ ก็สำคัญ", pattern, tl, set(), exclusions
        )
        self.assertNotIn("<dfn", out.split("แต่")[0])
        self.assertIn('<dfn data-term="สติ"', out)
        self.assertEqual(newly, {"สติ"})


class TestIdempotency(unittest.TestCase):
    def test_rerun_does_not_double_wrap(self):
        tl = lookup("อนิจจัง")
        pattern = terms.build_master_pattern(list(tl))
        out1, _ = terms.wrap_first_occurrence("อนิจจังคือความไม่เที่ยง", pattern, tl, set(), {})
        used2 = terms.find_existing_dfn_terms(out1)
        out2, newly2 = terms.wrap_first_occurrence(out1, pattern, tl, used2, {})
        self.assertEqual(out1, out2)
        self.assertEqual(newly2, set())


class TestCombiningMarkBoundary(unittest.TestCase):
    def test_does_not_split_mid_grapheme(self):
        # 'ขันธ' ไม่ควรถูกห่อโดยทิ้ง '์' ไว้นอก dfn — ถ้าศัพท์ที่ลงทะเบียนคือ 'ขันธ' (ขาด ์ โดยไม่ตั้งใจ)
        # แต่เนื้อหาจริงเขียน 'ขันธ์' ให้ปฏิเสธ ไม่ห่อครึ่งคำ
        tl = lookup("ขันธ")  # เผลอไม่มี ์ ต่อท้าย (จำลองข้อมูลผิดพลาด)
        pattern = terms.build_master_pattern(list(tl))
        out, newly = terms.wrap_first_occurrence("ขันธ์ ๕ ประการ", pattern, tl, set(), {})
        self.assertNotIn("<dfn", out)
        self.assertEqual(newly, set())

    def test_preceding_combining_mark_does_not_block_match(self):
        # เครื่องหมายก่อนจุดเริ่ม match เป็นของคำก่อนหน้า ไม่ควรบล็อกการจับคู่ (บั๊กที่เคยพบระหว่างพัฒนา)
        tl = lookup("สติปัญญา")
        pattern = terms.build_master_pattern(list(tl))
        out, newly = terms.wrap_first_occurrence("การมีสติปัญญาช่วยได้มาก", pattern, tl, set(), {})
        self.assertIn('<dfn data-term="สติปัญญา"', out)
        self.assertEqual(newly, {"สติปัญญา"})


class TestMergeTerms(unittest.TestCase):
    def test_existing_wins_on_conflict(self):
        existing = [{"term": "ทุกขัง", "kind": "ธรรมะ", "alt": "old", "def": "def เดิม", "books": ["b"]}]
        proposed = [{"term": "ทุกขัง", "kind": "ธรรมะ", "alt": "new", "def": "def ใหม่จาก author.py"}]
        merged = terms.merge_terms(existing, proposed, "b")
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["def"], "def เดิม")

    def test_new_terms_appended_in_order(self):
        existing = [{"term": "A", "kind": "ธรรมะ", "alt": "", "def": "d", "books": ["b"]}]
        proposed = [
            {"term": "B", "kind": "ธรรมะ", "alt": "", "def": "d"},
            {"term": "A", "kind": "ธรรมะ", "alt": "", "def": "ignored"},
            {"term": "C", "kind": "วิทยาศาสตร์", "alt": "", "def": "d"},
        ]
        merged = terms.merge_terms(existing, proposed, "b")
        self.assertEqual([t["term"] for t in merged], ["A", "B", "C"])
        self.assertEqual(merged[1]["books"], ["b"])


if __name__ == "__main__":
    unittest.main()

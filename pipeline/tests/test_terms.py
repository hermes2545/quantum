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


try:
    import pythainlp  # noqa: F401

    HAS_PYTHAINLP = True
except ImportError:
    HAS_PYTHAINLP = False


@unittest.skipUnless(HAS_PYTHAINLP, "ต้องติดตั้ง pythainlp (pip install -r pipeline/requirements.txt)")
class TestWordBoundaryCheck(unittest.TestCase):
    """เคสจริงที่ reviewer เจอ: exclusions-list เพียงอย่างเดียวพลาดคำที่ไม่มีใครเพิ่มลงรายการมาก่อน —
    thai_token_boundaries() (ตัวตัดคำ pythainlp) ต้องปฏิเสธได้เองโดยไม่ต้องพึ่ง exclusions เลย"""

    def test_rejects_short_term_inside_unlisted_longer_word(self):
        tl = lookup("สติ")
        pattern = terms.build_master_pattern(list(tl))
        # ไม่ใส่ "พลาสติก" ลง exclusions เลย (exclusions={}) — ต้องถูกปฏิเสธด้วยตัวตัดคำเอง
        out, newly = terms.wrap_first_occurrence(
            "อณูโลหะและพลาสติกที่กำลังเสื่อมไปตามกาลเวลา", pattern, tl, set(), {}
        )
        self.assertNotIn("<dfn", out)
        self.assertEqual(newly, set())

    def test_still_wraps_full_term_even_when_tokenizer_groups_prefix(self):
        # "สติปัญญา" ที่ตัวตัดคำมองว่า "มี" ต่อเนื่องกับคำถัดไปเป็นก้อนเดียว ("มีสติปัญญา") ต้องยังห่อได้
        # เพราะ match ตรงขอบ token อย่างน้อยด้านหนึ่ง (ไม่ใช่ "ตัดกลาง token ทั้งสองฝั่ง" แบบเคสข้างบน)
        tl = lookup("สติปัญญา")
        pattern = terms.build_master_pattern(list(tl))
        out, newly = terms.wrap_first_occurrence(
            "การมีสติปัญญาช่วยได้มาก", pattern, tl, set(), {}
        )
        self.assertIn('<dfn data-term="สติปัญญา"', out)
        self.assertEqual(newly, {"สติปัญญา"})


class TestReportContextSink(unittest.TestCase):
    def test_context_sink_records_new_wraps_with_surrounding_text(self):
        tl = lookup("อนิจจัง")
        pattern = terms.build_master_pattern(list(tl))
        sink: list[str] = []
        terms.wrap_first_occurrence("ทุกอย่างเป็นอนิจจังเสมอ", pattern, tl, set(), {}, sink)
        self.assertEqual(len(sink), 1)
        self.assertIn("อนิจจัง", sink[0])

    def test_context_sink_empty_when_nothing_new_wrapped(self):
        tl = lookup("อนิจจัง")
        pattern = terms.build_master_pattern(list(tl))
        sink: list[str] = []
        terms.wrap_first_occurrence("ไม่มีศัพท์นั้นเลย", pattern, tl, set(), {}, sink)
        self.assertEqual(sink, [])


class TestKnownBugsCoveredByExclusionFixture(unittest.TestCase):
    """ล็อกไว้กันบั๊กจริง 2 จุดที่ reviewer เจอ (ch01: พลาสติก/สติ, ch08: พันธุกรรม/กรรม) ไม่ให้กลับมา
    แม้ในเครื่องที่ไม่ได้ติดตั้ง pythainlp (ซึ่งพึ่ง exclusions list เป็นตาข่ายเดียวที่เหลือ)"""

    def test_plastic_and_genetics_are_listed(self):
        exclusions = terms.load_term_exclusions()
        self.assertIn("พลาสติก", exclusions.get("สติ", []))
        self.assertIn("พันธุกรรม", exclusions.get("กรรม", []))


class TestQuoteScopeUntouched(unittest.TestCase):
    """สัญญาระหว่างโมดูล §G: "ไม่ห่อใน quote/h2/callout.label/interactive/exercise" — ไม่ยกเว้น
    quote.after เป็นกรณีพิเศษ (ตรงตามตัวอักษรของสัญญา ไม่ใช่ตีความขยายเอง)"""

    def test_autolink_chapter_does_not_touch_quote_after(self):
        chapter = {
            "sections": [],
            "quote": {
                "text": "…",
                "source": "…",
                "after": ["ทุกขังคือทุกขัง ไม่ใช่ทุกข์ใจ"],
            },
        }
        tl = lookup("ทุกขัง")
        pattern = terms.build_master_pattern(list(tl))
        terms.autolink_chapter(chapter, pattern, tl, {})
        self.assertNotIn("<dfn", chapter["quote"]["after"][0])


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

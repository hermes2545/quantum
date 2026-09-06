"""ทดสอบการทำความสะอาดข้อความสำหรับ PDF เล่ม 2–9 (pymupdf): glyph ละตินแปลกปลอม + ยุบเฉพาะสระ/วรรณยุกต์"""
from pipeline import clean


def _c(s: str, **kw) -> str:
    return clean.clean_text(s, **kw)[0].strip()


def test_stray_latin_glyphs_between_thai_are_removed():
    assert _c("นับตั้Ěงแต่ที่ęผู้šเขียนจำćความได้") == "นับตั้งแต่ที่ผู้เขียนจำความได้"
    assert _c("ความสำĜำเร็จ") == "ความสำเร็จ"


def test_real_latin_words_survive():
    assert _c("ข้อโต้แย้ง EPR paradox และ Quantamagazine") == "ข้อโต้แย้ง EPR paradox และ Quantamagazine"


def test_default_mode_collapses_marks_but_keeps_doubled_consonants():
    assert _c("มีีอะไรในจัักรวาล สสารคืออะไร รูปแบบใหม่ ปล่อยออกมา โฮโลแกรม กรมสุขภาพ") == (
        "มีอะไรในจักรวาล สสารคืออะไร รูปแบบใหม่ ปล่อยออกมา โฮโลแกรม กรมสุขภาพ"
    )


def test_legacy_mode_matches_spec_behaviour():
    assert _c("หนัังสืือ ธรรรม", collapse_consonants=True) == "หนังสือ ธรรม"
    assert _c("สสาร", collapse_consonants=True) == "สาร"  # ข้อจำกัดของโหมด spec ที่บันทึกไว้

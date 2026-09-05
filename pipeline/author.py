#!/usr/bin/env python3
"""
pipeline/author.py — ส่งข้อความบท (หลัง split) เข้า Claude API เพื่อเรียบเรียงเป็น chNN.json

อ้างอิง: docs/handoff-spec.md §9.1 (กฎการเรียบเรียง 11 ข้อ — ใช้ตรงๆ), §10 (data model),
§11 ข้อห้าม #3 (ห้าม mark ready อัตโนมัติ — สคริปต์นี้เขียน status:"draft" เสมอ ไม่มีทางเลือกอื่น)
และสัญญาระหว่างโมดูล §A.2 (รูปแบบ JSON), §E.4 (รูปแบบ config ของ interactive กลาง "particles"),
§G (CLI contract, โมเดล, thinking/output_config)

จุดสำคัญเรื่องโมเดล (อ่านจาก skill claude-api ก่อนเขียนไฟล์นี้):
  - Claude Fable 5.1 (โมเดล default ของ AUTHOR_MODEL) ห้ามส่ง thinking ที่ไม่ใช่ {"type":"adaptive"}
    (ส่ง disabled หรือ budget_tokens จะได้ 400) และห้ามบังคับ tool_choice any/tool (400 เช่นกัน)
    เราจึงไม่ใช้ tool เลย ใช้ output_config.format (structured outputs) แทนเพื่อบังคับรูปแบบ JSON
  - ไม่มี assistant prefill บนโมเดลตระกูลนี้ — ห้ามลองส่ง prefill มาช่วยคุม format
  - เพิ่ม server-side fallback (betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    ตามคำแนะนำ default ของ skill สำหรับโค้ดที่เรียก claude-fable-5-1/claude-opus-5 — มี try/except
    เผื่อ SDK ที่ติดตั้งยังไม่รองรับ beta นี้ (จะ fallback ไปเรียกแบบปกติแทนโดยไม่ทำให้สคริปต์พัง)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from pipeline import common

# ---------------------------------------------------------------------------
# §9.1 — กฎการเรียบเรียงเนื้อหาบท (คัดลอกจาก docs/handoff-spec.md ตรงตัว ห้ามเดา ห้ามลดทอน)
# ---------------------------------------------------------------------------
RULES_9_1 = """กฎการเรียบเรียงเนื้อหาบท (ต้องทำตามทุกข้อ):
เป้าหมาย: ผู้อ่านไม่มีพื้นทั้งธรรมะและวิทยาศาสตร์ อ่านจบบทแล้ว "เห็น" ไม่ใช่แค่ "รู้"

1. ห้ามคัดลอกข้อความจากหนังสือ ยกเว้น (ก) พุทธพจน์ที่หนังสือยกมา — ยกได้เต็มพร้อมบรรทัดที่มา
   (ข) วลีสั้น ≤ 12 คำเพื่ออ้างอิงจุดยืนผู้เขียน ใส่เครื่องหมายคำพูด — เหตุผล: หนังสือมีลิขสิทธิ์
   คู่มือนี้คือ "คู่มือประกอบการอ่าน" ที่อธิบายด้วยคำของเราเอง
2. โครงบทตายตัว: goal (1 ประโยค "จบบทนี้คุณจะ…") -> 2-4 sections (แต่ละ section มี h2 + 2-5 ย่อหน้า)
   -> interactive 1 ชิ้น วางหลัง section ที่อธิบายกลไก -> quote (ถ้าหนังสือมี) -> exercise -> questions 4 ข้อ
3. ทุกศัพท์เทคนิค (ทั้งสองสาย) ต้องถูกอธิบายในประโยคเดียวกันหรือประโยคถัดไป ครั้งแรกที่ปรากฏในบท
   แม้จะอยู่ใน glossary แล้วก็ตาม
4. ทุก section ต้องปิดด้วยการโยงกลับไตรลักษณ์ (หรือแนวคิดหลักของเล่มนั้น) เหมือนที่หนังสือทำ
   ห้ามจบที่ข้อเท็จจริงวิทยาศาสตร์ลอยๆ
5. ต้องมี "ข้อผิดพลาดที่คนมักเข้าใจผิด" อย่างน้อย 1 จุดต่อบท (เช่น ทุกขัง ≠ ทุกข์ใจ) และมีกล่อง callout
   ที่ตอบคำถาม "ทำไม" อย่างน้อย 1 กล่องเมื่อหนังสือมีเหตุผลนั้น
6. ตัวเลขวิทยาศาสตร์ใช้ค่าปัจจุบันที่ยอมรับ และเมื่อหนังสือใช้ค่าเก่า ให้ใส่ทั้งสองแบบ
   "(หนังสือเขียน 15,000 ล้านปี ค่าปัจจุบัน ~13,800 ล้านปี)" — เหตุผล: ผู้อ่านจะเปิดหนังสือเทียบ
   ถ้าตัวเลขไม่ตรงจะสับสนว่าใครผิด
7. เรื่องที่วิทยาศาสตร์ยังถกเถียง (เช่น จิตควอนตัม/ไมโครทิวบูล) ต้องระบุว่า "เป็นสมมติฐาน"
   ห้ามเขียนเหมือนข้อสรุป — แต่ต้องเคารพจุดยืนหนังสือ ไม่ต้องหักล้าง
8. น้ำเสียง: เพื่อนที่รู้เรื่องเล่าให้ฟัง ประโยคสั้น ไม่มี bullet ในเนื้อหา (bullet ใช้ได้เฉพาะรายการ
   ธาตุ/ชนิด) ไม่ใช้ "ท่าน/ผู้อ่านพึง" ใช้ "คุณ/เรา"
9. ความยาวต่อบท 900-1,400 คำ (ไม่รวม interactive/exercise) — สั้นกว่านี้ตื้น ยาวกว่านี้คนทั่วไปไม่จบ
10. exercise ต้องมี 4 ตัวเลือก x 3 ขั้น ตัวอย่างต้องเป็นของใกล้ตัวคนไทยปัจจุบัน
    (รถ บ้าน โทรศัพท์ ชื่อเสียง ความสัมพันธ์ ใบหน้า) ไม่ใช่ตัวอย่างในคัมภีร์
11. questions 4 ข้อ ต้องเป็นคำถามที่คนอ่านบทนี้แล้วสงสัยจริง ไม่ใช่คำถามท่องจำ
    ("ถ้าทุกอย่างไม่เที่ยงแล้วจะตั้งใจทำอะไรไปทำไม" ถูก / "ไตรลักษณ์มีกี่ข้อ" ผิด)
"""

# แท็ก HTML inline ที่อนุญาตในย่อหน้า/bullets/callout ที่ author.py เขียน (ยังไม่ห่อ <dfn> — เป็นหน้าที่
# ของ terms.py เท่านั้น ตามสัญญาระหว่างโมดูล §A.2: "author.py ห้ามห่อเอง ให้ส่ง plain <b>/<i> เท่านั้น")
ALLOWED_TAGS = {"b", "i"}

PALETTE_COLORS = ["gold", "teal", "pink", "star", "mint"]
PALETTE_SHAPES = ["phone", "flower", "body", "star", "anger", "blob"]


# ---------------------------------------------------------------------------
# schema builder
# ---------------------------------------------------------------------------
def _plain_str(min_len: int = 1) -> dict:
    return {"type": "string", "minLength": min_len}


def _particles_config_schema() -> dict:
    """รูปแบบ config ของ interactive กลาง "particles" ตามสัญญาระหว่างโมดูล §E.4

    หมายเหตุการออกแบบ: เดิมตั้งใจใช้ "const" บังคับ lensLabels/phases/timeLabel/emptyReadout ให้ตรงกับ
    book.coreIdeas เป๊ะๆ แต่ตัวอย่าง structured-outputs ทั้งหมดที่มี (ดู skill claude-api) มีแต่
    type/properties/items/enum/required/additionalProperties ไม่มีตัวอย่างยืนยันว่า "const" ใช้ได้กับ
    output_config.format จริง — เพื่อไม่เสี่ยง request พังทั้งก้อน จึงใช้ type constraint ธรรมดาที่นี่
    แล้วบังคับค่าที่ถูกต้องทับอีกทีหลังได้ผลลัพธ์กลับมา (ดู main(): "บังคับ field ที่ต้องตรงกับ book.json")
    ผลลัพธ์เหมือนกันทุกกรณี แค่ไม่พึ่งฟีเจอร์ schema ที่ไม่ยืนยันว่ารองรับ"""
    return {
        "type": "object",
        "properties": {
            "objects": {
                "type": "array",
                "minItems": 1,
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "minLength": 1},
                        "name": {"type": "string", "minLength": 1},
                        "color": {"type": "string", "enum": PALETTE_COLORS},
                        "shape": {"type": "string", "enum": PALETTE_SHAPES},
                        "lenses": {
                            "type": "object",
                            "properties": {
                                "a": _plain_str(),
                                "d": _plain_str(),
                                "n": _plain_str(),
                            },
                            "required": ["a", "d", "n"],
                            "additionalProperties": False,
                        },
                    },
                    "required": ["key", "name", "color", "shape", "lenses"],
                    "additionalProperties": False,
                },
            },
            "lensLabels": {
                "type": "array",
                "minItems": 3,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": ["a", "d", "n"]},
                        "pali": {"type": "string"},
                        "th": {"type": "string"},
                    },
                    "required": ["key", "pali", "th"],
                    "additionalProperties": False,
                },
            },
            "phases": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "string"}},
            "initialT": {"type": "number", "minimum": 0, "maximum": 1},
            "timeLabel": {"type": "string"},
            "emptyReadout": {"type": "string"},
        },
        "required": ["objects", "lensLabels", "phases", "initialT", "timeLabel", "emptyReadout"],
        "additionalProperties": False,
    }


def build_schema(book: dict, has_custom_module: bool) -> dict:
    if has_custom_module:
        # มีไฟล์ interactive เฉพาะบทอยู่แล้ว (เขียนมือโดย P5) — config เป็น shape เฉพาะที่ author.py
        # ไม่รู้จักล่วงหน้า (ดู §E.4: "P6/P3 ใส่ค่าใน chNN.json ตามนั้น") ปล่อยเป็น object อิสระ
        config_schema: dict = {"type": "object"}
    else:
        config_schema = _particles_config_schema()

    interactive_schema = {
        "type": "object",
        "properties": {
            "module": {"type": "string"},  # บังคับค่าจริงทับใน main() เสมอ ไม่พึ่งความแม่นของโมเดล
            "position": {"type": "integer", "minimum": 1},
            "title": _plain_str(),
            "intro": _plain_str(),
            "config": config_schema,
        },
        "required": ["module", "position", "title", "intro", "config"],
        "additionalProperties": False,
    }

    section_schema = {
        "type": "object",
        "properties": {
            "h2": _plain_str(),
            "paragraphs": {"type": "array", "minItems": 2, "maxItems": 5, "items": _plain_str()},
            "bullets": {"type": "array", "minItems": 2, "maxItems": 10, "items": _plain_str()},
            "bulletsAfter": {"type": "integer", "minimum": 0},
            "callout": {
                "type": "object",
                "properties": {"label": _plain_str(), "text": _plain_str()},
                "required": ["label", "text"],
                "additionalProperties": False,
            },
        },
        "required": ["h2", "paragraphs"],
        "additionalProperties": False,
    }

    exercise_schema = {
        "type": "object",
        "properties": {
            "title": _plain_str(),
            "intro": _plain_str(),
            "columns": {
                "type": "array",
                "minItems": 3,
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {"label": {"type": "string"}, "sub": {"type": "string"}},
                    "required": ["label", "sub"],
                    "additionalProperties": False,
                },
            },
            "options": {
                "type": "array",
                "minItems": 4,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "name": _plain_str(),
                        "steps": {"type": "array", "minItems": 3, "maxItems": 3, "items": _plain_str()},
                    },
                    "required": ["name", "steps"],
                    "additionalProperties": False,
                },
            },
            "prompt": _plain_str(),
            "placeholder": _plain_str(),
            "hint": _plain_str(),
        },
        "required": ["title", "intro", "columns", "options", "prompt", "placeholder"],
        "additionalProperties": False,
    }

    term_schema = {
        "type": "object",
        "properties": {
            "term": _plain_str(),
            "kind": {"type": "string", "enum": ["ธรรมะ", "วิทยาศาสตร์"]},
            "alt": {"type": "string"},
            "def": _plain_str(),
        },
        "required": ["term", "kind", "alt", "def"],
        "additionalProperties": False,
    }

    quote_schema = {
        "type": "object",
        "properties": {
            "text": _plain_str(),
            "source": _plain_str(),
            "after": {"type": "array", "items": _plain_str()},
        },
        "required": ["text", "source"],
        "additionalProperties": False,
    }

    # หมายเหตุ: book/slug/order/thaiNum/title/sub/status ไม่ได้อยู่ในสคีมานี้โดยตั้งใจ — เป็นข้อมูล
    # ที่เรารู้แน่นอนอยู่แล้วจาก book.json (ไม่ต้องให้โมเดลเดา/พิมพ์ซ้ำ) main() เติมให้ทุกครั้งหลังได้
    # ผลลัพธ์กลับมา (ดู "บังคับ field ที่ต้องตรงกับ book.json เป๊ะๆ") — ลดโอกาสสะกดผิด/ไม่ตรงลงเหลือศูนย์
    return {
        "type": "object",
        "properties": {
            "goal": _plain_str(),
            "summary": _plain_str(),
            "keyPoints": {"type": "array", "minItems": 5, "maxItems": 8, "items": _plain_str()},
            "keywords": {"type": "array", "minItems": 8, "maxItems": 15, "items": _plain_str()},
            "sections": {"type": "array", "minItems": 2, "maxItems": 4, "items": section_schema},
            "interactive": interactive_schema,
            "quote": quote_schema,
            "exercise": exercise_schema,
            "questions": {"type": "array", "minItems": 4, "maxItems": 4, "items": _plain_str()},
            "suggestions": {"type": "array", "minItems": 3, "maxItems": 3, "items": _plain_str()},
            "terms": {"type": "array", "items": term_schema},
        },
        "required": [
            "goal", "summary", "keyPoints", "keywords", "sections", "interactive",
            "exercise", "questions", "suggestions", "terms",
        ],
        "additionalProperties": False,
    }


# ---------------------------------------------------------------------------
# few-shot: ch01.json / ch02.json (ตามสัญญาระหว่างโมดูล §G — "ch01/ch02 เป็น few-shot")
# ---------------------------------------------------------------------------
def load_few_shot(book_slug: str) -> str:
    parts = []
    for slug in ("ch01", "ch02"):
        path = common.chapter_json_path(book_slug, slug)
        data = common.load_json(path)
        if data is None:
            common.eprint(f"หมายเหตุ: ไม่พบ {path} — ข้าม few-shot บทนี้ (ควรมีก่อนรัน author.py จริงจัง)")
            continue
        parts.append(f"### ตัวอย่างบท {slug}.json (คุณภาพมาตรฐานที่ต้องเทียบเท่า)\n" + json.dumps(data, ensure_ascii=False, indent=2))
    if not parts:
        return ""
    return (
        "หมายเหตุสำคัญเกี่ยวกับตัวอย่างด้านล่าง: ใช้เป็นตัวอย่าง 'สำเนียงการเขียน' และ 'โครงสร้างเนื้อหา'"
        " เท่านั้น ห้ามลอกเนื้อหา — ฟิลด์ interactive.config ในตัวอย่างเหล่านี้เป็นรูปแบบเก่าที่ยังไม่ตรง"
        " กับ schema ปัจจุบัน (ใช้สี hex ตรงๆ และชื่อ key ย่อ k/a/d/n/col) ห้ามเลียนแบบรูปแบบ config นั้น"
        " — ให้ทำตาม schema ที่กำหนดไว้ในคำสั่งนี้เท่านั้น (color เป็นชื่อจากพาเลตที่กำหนด ไม่ใช่ hex)\n\n"
        + "\n\n".join(parts)
    )


# ---------------------------------------------------------------------------
# ตรวจ HTML/plain-text หลังได้ผลลัพธ์กลับมา (ป้องกันกันเอง — build.js/validate.mjs จะตรวจซ้ำอีกชั้น
# แต่ author.py ควรจับข้อผิดพลาดชัดเจนให้เร็วที่สุด ไม่ปล่อยให้หลุดไปถึงขั้นตอนหลัง)
# ---------------------------------------------------------------------------
def assert_no_tags(label: str, text: str, errors: list[str]) -> None:
    if "<" in text or ">" in text:
        errors.append(f"{label}: ต้องเป็น plain text ห้ามมีแท็ก HTML — พบ: {text[:80]!r}")


def assert_allowed_html(label: str, html: str, errors: list[str]) -> None:
    bad = common.find_disallowed_tags(html, ALLOWED_TAGS)
    if bad:
        errors.append(f"{label}: พบแท็กที่ไม่อนุญาต {bad} (อนุญาตเฉพาะ <b> <i> — <dfn> เป็นหน้าที่ terms.py เท่านั้น)")


def validate_output(data: dict) -> list[str]:
    errors: list[str] = []
    assert_no_tags("goal", data["goal"], errors)
    assert_no_tags("summary", data["summary"], errors)
    for i, kp in enumerate(data["keyPoints"]):
        assert_no_tags(f"keyPoints[{i}]", kp, errors)
    for i, kw in enumerate(data["keywords"]):
        assert_no_tags(f"keywords[{i}]", kw, errors)
    for i, q in enumerate(data["questions"]):
        assert_no_tags(f"questions[{i}]", q, errors)
    for i, s in enumerate(data["suggestions"]):
        assert_no_tags(f"suggestions[{i}]", s, errors)

    for si, sec in enumerate(data["sections"]):
        assert_no_tags(f"sections[{si}].h2", sec["h2"], errors)
        for pi, p in enumerate(sec["paragraphs"]):
            assert_allowed_html(f"sections[{si}].paragraphs[{pi}]", p, errors)
        for bi, b in enumerate(sec.get("bullets", [])):
            assert_allowed_html(f"sections[{si}].bullets[{bi}]", b, errors)
        if "callout" in sec:
            assert_no_tags(f"sections[{si}].callout.label", sec["callout"]["label"], errors)
            assert_allowed_html(f"sections[{si}].callout.text", sec["callout"]["text"], errors)

    ix = data["interactive"]
    assert_no_tags("interactive.title", ix["title"], errors)
    assert_no_tags("interactive.intro", ix["intro"], errors)
    if ix.get("module") == "particles":
        for oi, obj in enumerate(ix.get("config", {}).get("objects", [])):
            for k in ("a", "d", "n"):
                assert_allowed_html(f"interactive.config.objects[{oi}].lenses.{k}", obj["lenses"][k], errors)

    if "quote" in data:
        assert_no_tags("quote.text", data["quote"]["text"], errors)
        assert_no_tags("quote.source", data["quote"]["source"], errors)
        for i, a in enumerate(data["quote"].get("after", [])):
            assert_allowed_html(f"quote.after[{i}]", a, errors)

    ex = data["exercise"]
    for field in ("title", "intro", "prompt", "placeholder", "hint"):
        if field in ex:
            assert_no_tags(f"exercise.{field}", ex[field], errors)
    for oi, opt in enumerate(ex["options"]):
        assert_no_tags(f"exercise.options[{oi}].name", opt["name"], errors)
        for si, step in enumerate(opt["steps"]):
            assert_no_tags(f"exercise.options[{oi}].steps[{si}]", step, errors)

    # เช็คความยาวคร่าวๆ (§9.1 ข้อ 9: 900-1,400 คำ) — หมายเหตุ: ภาษาไทยไม่มีช่องว่างคั่นคำ การนับ "คำ"
    # จริงต้องใช้ตัวตัดคำ (เช่น pythainlp) ซึ่งไม่ได้อยู่ใน requirements.txt ของ pipeline นี้
    # ใช้ heuristic ประมาณจากจำนวนตัวอักษร (เฉลี่ยคำไทย ~4-5 ตัวอักษร/คำ) เป็น "คำเตือน" ไม่ใช่ error แข็ง
    # เพราะไม่แม่นพอจะ fail ทั้งบท — คนตรวจต้องยืนยันความยาวจริงตอนอ่านทวนอยู่ดี
    body_text = "".join(
        re.sub(r"<[^>]+>", "", p) for sec in data["sections"] for p in sec["paragraphs"]
    )
    approx_words = len(body_text) / 4.5
    if not (700 <= approx_words <= 1700):
        common.eprint(
            f"คำเตือน: ความยาวเนื้อหาประมาณ {approx_words:.0f} คำ (ประมาณจากตัวอักษร) "
            f"อยู่นอกช่วง 900-1,400 คำตาม §9.1 ข้อ 9 มาก — ควรตรวจด้วยตา (ไม่ fail อัตโนมัติเพราะเป็นค่าประมาณ)"
        )

    return errors


# ---------------------------------------------------------------------------
# เรียก API
# ---------------------------------------------------------------------------
def call_model(client: Any, *, model: str, system: str, user: str, schema: dict):
    kwargs = dict(
        model=model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    use_fallback = "fable" in model.lower() or model == "claude-opus-5"
    if use_fallback:
        try:
            with client.beta.messages.stream(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs
            ) as stream:
                return stream.get_final_message()
        except (TypeError, AttributeError) as e:
            common.eprint(f"หมายเหตุ: SDK ไม่รองรับ server-side fallback ({e}) — เรียกแบบปกติแทน")
    with client.messages.stream(**kwargs) as stream:
        return stream.get_final_message()


CANONICAL_KEY_ORDER = [
    "book", "slug", "order", "thaiNum", "title", "sub", "status",
    "goal", "summary", "keyPoints", "keywords", "sections", "interactive",
    "quote", "exercise", "questions", "suggestions", "terms",
]


def reorder_keys(data: dict) -> dict:
    ordered = {k: data[k] for k in CANONICAL_KEY_ORDER if k in data}
    # เผื่อ key แปลกที่หลุดมา (ไม่ควรเกิดเพราะ additionalProperties:false) ใส่ต่อท้ายกันข้อมูลหาย
    for k, v in data.items():
        if k not in ordered:
            ordered[k] = v
    return ordered


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="เรียบเรียงบทด้วย Claude API ตาม §9.1")
    parser.add_argument("--book", required=True)
    parser.add_argument("--chapter", required=True, help="chapterSlug เช่น ch03")
    parser.add_argument("--dry-run", action="store_true", help="สร้าง prompt แล้วพิมพ์ดู ไม่เรียก API จริง")
    parser.add_argument("--force", action="store_true", help="เขียนทับได้แม้ไฟล์เดิม status เป็น ready")
    args = parser.parse_args(argv)

    book_slug = args.book
    chapter_slug = args.chapter
    if not common.CHAPTER_SLUG_RE.match(chapter_slug):
        common.die(f"'{chapter_slug}' ไม่ใช่ chapterSlug ที่ถูกต้อง (ต้องเป็นรูปแบบ ch01, ch02, ...)")

    book = common.load_book(book_slug)
    meta = common.find_chapter_meta(book, chapter_slug)
    if meta is None:
        common.die(f"ไม่พบบท '{chapter_slug}' ใน book.json ของ '{book_slug}'")

    out_path = common.chapter_json_path(book_slug, chapter_slug)
    existing = common.load_json(out_path)
    if existing and existing.get("status") == "ready" and not args.force:
        common.die(
            f"{out_path} มี status: \"ready\" อยู่แล้ว (ผ่านคนตรวจแล้ว) — ต้องใช้ --force ถึงจะเขียนทับ "
            f"(กันคนตรวจงานหายโดยไม่ตั้งใจ)"
        )

    raw_path = common.raw_chapter_txt_path(book_slug, chapter_slug)
    if not raw_path.exists():
        common.die(f"ไม่พบ {raw_path} — รัน split.py --book {book_slug} ก่อน")
    raw_text = raw_path.read_text(encoding="utf-8")

    has_custom_module = common.interactive_module_path(book_slug, chapter_slug).exists()
    schema = build_schema(book, has_custom_module)

    few_shot = load_few_shot(book_slug)

    core_ideas_desc = "\n".join(
        f"  - {idea['label']}" + (f" ({idea['pali']})" if idea.get("pali") else "") + f": {idea['text']}"
        for idea in book.get("coreIdeas", [])
    )

    system_parts = [
        f'คุณคือผู้เรียบเรียงเนื้อหาสำหรับคู่มือเรียนหนังสือชุด "{book.get("title", book_slug)}" '
        f'โดย {book.get("author", "")}',
        RULES_9_1,
        "บริบทเล่ม (coreIdeas 3 ข้อของทั้งเล่ม — ทุกบทต้องโยงกลับมาที่ 3 ข้อนี้เสมอตามกฎข้อ 4):\n"
        + core_ideas_desc,
        f'บทที่กำลังเรียบเรียง: เล่ม {book.get("order")} บทที่ {meta["thaiNum"]} "{meta["title"]}" ({meta["sub"]})',
    ]
    if has_custom_module:
        module_str = f"{book_slug}/{chapter_slug}"
        system_parts.append(
            f'บทนี้มีไฟล์ interactive เฉพาะเขียนมือแล้วที่ web/src/js/interactives/{module_str}.js '
            f'ให้ตั้ง interactive.module = "{module_str}" และเดา config ที่เหมาะสมที่สุดจากเนื้อหาบทนี้ '
            f'(คนจะตรวจและปรับ config ให้ตรงกับโมดูลจริงภายหลัง)'
        )
    else:
        system_parts.append(
            'บทนี้ยังไม่มีไฟล์ interactive เฉพาะ ให้ใช้ interactive.module = "particles" เสมอ '
            "(โมดูลกลาง) พร้อมสร้าง config.objects ที่เป็นตัวอย่างของจริงใกล้ตัวที่เกี่ยวกับเนื้อหาบทนี้ "
            "1-6 ชิ้น แต่ละชิ้นมี lenses.a/d/n อธิบายผ่านแว่นอนิจจัง/ทุกขัง/อนัตตาตามลำดับ "
            "(อนุญาตเฉพาะแท็ก <b> ในข้อความ lenses) เลือก color จาก [gold, teal, pink, star, mint] "
            "และ shape จาก [phone, flower, body, star, anger, blob] ให้เหมาะกับของแต่ละชิ้น "
            "ห้ามใช้ค่าสี hex เด็ดขาด"
        )
    system_parts.append(
        "รูปแบบผลลัพธ์ต้องตรงตาม JSON schema ที่กำหนดทุกประการ (ระบบบังคับรูปแบบไว้แล้ว) "
        "ห้ามใส่ bullet ในข้อความ paragraphs/callout (bullet ใช้ได้เฉพาะ field 'bullets' สำหรับ "
        "รายการธาตุ/ชนิดเท่านั้น) ห้ามใส่แท็ก HTML อื่นนอกจาก <b> <i> ห้ามห่อ <dfn> เอง (มีคนอื่นทำขั้นถัดไป) "
        'status ต้องเป็น "draft" เสมอ (ห้ามเขียน "ready" — ต้องผ่านคนตรวจก่อน)'
    )
    if few_shot:
        system_parts.append(few_shot)

    system = "\n\n".join(system_parts)
    user = (
        f"นี่คือข้อความดิบของบทนี้ที่ดึงจาก PDF แล้วทำความสะอาดแล้ว (อาจยังมีช่องว่าง/ตัวสะกดคลาดเคลื่อน "
        f"หลงเหลืออยู่บ้างจากการดึงข้อความ ใช้เป็นแหล่งไอเดีย/ข้อเท็จจริง ห้ามคัดลอกคำต่อคำ):\n\n"
        f"---\n{raw_text}\n---\n\n"
        f"เรียบเรียงเป็นบทเรียนตามกฎและ schema ที่กำหนด"
    )

    if args.dry_run:
        print(f"=== SYSTEM ({len(system):,} chars) ===\n{system[:3000]}\n... (ตัด)\n")
        print(f"=== USER ({len(user):,} chars) ===\n{user[:2000]}\n... (ตัด)\n")
        print(f"=== SCHEMA ===\n{json.dumps(schema, ensure_ascii=False, indent=2)[:3000]}\n... (ตัด)")
        return 0

    try:
        import anthropic
    except ImportError:
        common.die("ไม่ได้ติดตั้ง anthropic SDK — pip install -r pipeline/requirements.txt")
        return 1

    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        common.eprint("หมายเหตุ: ไม่พบ ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN ใน env — จะพึ่ง credential อื่นที่ SDK หาเจอ (ถ้ามี)")

    model = os.environ.get("AUTHOR_MODEL", "claude-fable-5-1")
    client = anthropic.Anthropic()

    common.eprint(f"เรียก {model} สำหรับ {book_slug}/{chapter_slug} ...")
    message = call_model(client, model=model, system=system, user=user, schema=schema)

    if message.stop_reason == "refusal":
        detail = getattr(message, "stop_details", None)
        common.die(f"โมเดลปฏิเสธการตอบ (refusal){f': {detail}' if detail else ''} — ลองปรับ prompt หรือ raw text แล้วรันใหม่")
        return 1
    if message.stop_reason not in ("end_turn", "max_tokens"):
        common.eprint(f"คำเตือน: stop_reason ผิดปกติ = {message.stop_reason}")

    text_block = next((b for b in message.content if b.type == "text"), None)
    if text_block is None:
        common.die("ไม่พบ text block ในผลลัพธ์จากโมเดล (คาดว่า structured output ต้องมี)")
        return 1

    try:
        data = json.loads(text_block.text)
    except json.JSONDecodeError as e:
        common.die(f"parse JSON จากโมเดลไม่สำเร็จ: {e}\n--- raw ---\n{text_block.text[:2000]}")
        return 1

    # เติม field ที่เรารู้ค่าที่ถูกต้องแน่นอนอยู่แล้วจาก book.json — ไม่ปล่อยให้โมเดลพิมพ์ค่าพวกนี้เอง
    # (ดูเหตุผลในคอมเมนต์ท้าย build_schema()) ทำเสมอไม่มีเงื่อนไข จึงถูกต้อง 100% ไม่ว่าโมเดลจะตอบมาว่าไร
    data["book"] = book_slug
    data["slug"] = chapter_slug
    data["order"] = meta["order"]
    data["thaiNum"] = meta["thaiNum"]
    data["title"] = meta["title"]
    data["sub"] = meta["sub"]
    data["status"] = "draft"  # §11 ข้อห้าม #3 — ห้าม mark ready อัตโนมัติ ไม่มีทางเลือกอื่นในโค้ดนี้

    core_ideas = book.get("coreIdeas", [])
    columns_const = [
        {"label": idea.get("pali") or idea["label"], "sub": idea["label"]} for idea in core_ideas[:3]
    ]
    data.setdefault("exercise", {})["columns"] = columns_const

    ix = data.setdefault("interactive", {})
    if has_custom_module:
        ix["module"] = f"{book_slug}/{chapter_slug}"
    else:
        ix["module"] = "particles"
        cfg = ix.setdefault("config", {})
        cfg["lensLabels"] = [
            {"key": k, "pali": idea.get("pali") or idea["label"], "th": idea["label"]}
            for k, idea in zip(("a", "d", "n"), core_ideas[:3])
        ]
        cfg["phases"] = ["เกิดขึ้น", "ตั้งอยู่", "ดับไป"]
        cfg["timeLabel"] = "เวลา"
        cfg["emptyReadout"] = "เลือกแว่นสักอันด้านบน"

    for term in data.get("terms", []):
        term.setdefault("books", [book_slug])

    errors = validate_output(data)
    if errors:
        common.eprint("ผลลัพธ์จากโมเดลไม่ผ่านการตรวจสอบ (ไม่เขียนไฟล์):")
        for e in errors:
            common.eprint("  -", e)
        return 1

    schema_errors = common.validate_against_schema(data, "chapter.schema.json")
    if schema_errors:
        common.eprint("ไม่ผ่าน content/schema/chapter.schema.json (เขียนไฟล์ต่อไปเพื่อให้คนตรวจ แต่ต้องแก้):")
        for e in schema_errors:
            common.eprint("  -", e)

    data = reorder_keys(data)
    common.save_json(out_path, data)
    common.eprint(f"เขียน {out_path} (status: draft — ต้องมีคนตรวจก่อนเปลี่ยนเป็น ready)")
    common.eprint(f"usage: input={message.usage.input_tokens} output={message.usage.output_tokens}")
    common.eprint(f"ขั้นถัดไป: python3 -m pipeline.terms --book {book_slug}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

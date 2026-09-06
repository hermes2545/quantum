# pipeline/ — PDF ต้นฉบับ -> บทเรียน JSON

Python 3.11. อ้างอิง: `docs/handoff-spec.md` §8-§11, `docs/spec-addendum.md` A-01, และสัญญาระหว่างโมดูล
`§G Pipeline CLI contract` (แหล่งความจริงเรื่องรูปแบบ CLI/ไฟล์ output ที่แน่นอนที่สุด)

## ติดตั้ง

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r pipeline/requirements.txt

# extract.py ใช้ pdftotext (poppler) เป็นทางหลัก — ถ้าไม่มีจะ fallback ไป pymupdf อัตโนมัติ
brew install poppler        # macOS
apt-get install poppler-utils  # Ubuntu
```

## ขั้นตอน (รันจาก root ของ repo เสมอ)

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # สำหรับ author.py เท่านั้น (ขั้นอื่นไม่เรียก API)

python3 -m pipeline.extract --book trilaksana-quantum
python3 -m pipeline.clean   --book trilaksana-quantum --report
#   >>> ตรวจ content/books/{slug}/raw/book-cleaned.txt และ raw/clean-report.txt ด้วยตาก่อนไปต่อเสมอ <<<
python3 -m pipeline.split   --book trilaksana-quantum
python3 -m pipeline.author  --book trilaksana-quantum --chapter ch03
#   >>> อ่านทวน content/books/{slug}/ch03.json แล้วแก้ไขด้วยมือถ้าจำเป็น ก่อนเปลี่ยน status เป็น "ready" <<<
python3 -m pipeline.terms   --book trilaksana-quantum --report

# หรือรันรวดเดียว (หลังมั่นใจแล้วว่า clean/split ให้ผลถูกต้อง):
python3 -m pipeline.run --book trilaksana-quantum
```

หรือผ่าน Makefile ที่ root: `make pipeline STEP=extract BOOK=trilaksana-quantum`,
`make pipeline STEP=author BOOK=trilaksana-quantum CH=ch03`

## ทำอะไรบ้าง

| script | input | output |
|---|---|---|
| `extract.py` | `content/source/{book.json.sourcePdf.file}` | `content/books/{slug}/raw/book.txt` |
| `clean.py` | `raw/book.txt` | `raw/book-cleaned.txt` + `raw/clean-report.txt` |
| `split.py` | `raw/book-cleaned.txt` + `book.json.chapters` | `raw/chNN.txt` ต่อบท |
| `author.py` | `raw/chNN.txt` + กฎ §9.1 + ch01/ch02.json เป็น few-shot | `chNN.json` (`status: "draft"` เสมอ) |
| `terms.py` | ทุก `chNN.json` + `glossary.json` เดิม (ถ้ามี) | `glossary.json` + `<dfn>` auto-link ใน `chNN.json` |
| `run.py` | — | รันทั้งสายตามลำดับข้างบน |
| `toc_init.py` (เล่ม 2–9) | สเปกสารบัญ JSON `{preface:{startPage}, endPage, chapters:[{title,startPage,source?}]}` ที่คนเขียนจาก TOC ของ PDF | `book.json.chapters[]` + stub `chNN.json` (status building) + `raw/_toc.json` |
| `split_pages.py` (เล่ม 2–9) | `raw/_toc.json` + PDF | `raw/chNN.txt`, `raw/ch00-preface.txt`, `raw/_split-report.json` — ตัดตาม "เลขหน้าพิมพ์" (= ดัชนีหน้า PDF + 1) แทนการค้นหัวข้อ เพราะเล่ม 2–9 ใช้เลขอารบิก/Part และชื่อบทซ้ำในเนื้อหา; clean ต่อบทให้เสร็จในตัว |

## กฎเหล็กที่ pipeline นี้เคารพ

- **ห้าม mark `ready` อัตโนมัติ** (§11 ข้อห้าม #3) — `author.py` เขียน `status: "draft"` เสมอ ไม่มี flag
  ให้เปลี่ยนเป็น `ready` เลย ต้องมีคนเปิดไฟล์แก้ด้วยมือ (และแก้ `book.json.chapters[i].status` คู่กันด้วย
  เพราะสัญญาระหว่างโมดูล §A.1 บังคับให้สองที่นี้ตรงกันเสมอ)
- **ห้าม commit PDF** — `content/source/` เป็นโฟลเดอร์ gitignored ที่ P1 ตั้งไว้ อย่าย้าย PDF ไปไว้ที่อื่น
- **pipeline ไม่แตะ `web/**` และไม่เรียก proxy** — ยกเว้นการ "อ่าน" (ไม่เขียน) ว่ามีไฟล์
  `web/src/js/interactives/{book}/{chNN}.js` เขียนมือไว้แล้วหรือยัง (`common.interactive_module_path`)
  เพื่อตัดสินว่า `interactive.module` ควรเป็น `"particles"` หรือชื่อโมดูลเฉพาะบท
- **`author.py` ห้ามห่อ `<dfn>` เอง** — ส่งแค่ `<b>`/`<i>` เท่านั้น การห่อ `<dfn>` เป็นหน้าที่ `terms.py`
  ผู้เดียว (ป้องกันสองระบบห่อขัดแย้งกัน)
- **โมเดล**: `AUTHOR_MODEL` (default `claude-fable-5-1`) — ใช้ `thinking: {"type": "adaptive"}` เท่านั้น
  (ห้าม `budget_tokens`/`disabled` กับโมเดลตระกูลนี้ — 400) และใช้ `output_config.format`
  (structured outputs) แทนการบังคับ `tool_choice` (ก็ 400 เช่นกันบน Fable 5.1) ถ้าองค์กรใช้ Fable
  ไม่ได้ (เช่นไม่ผ่านเงื่อนไข data retention 30 วัน) ตั้ง `export AUTHOR_MODEL=claude-opus-5` แทนได้

## หมายเหตุ clean.py สำหรับ PDF เล่ม 2–9 (6 ก.ย. 2026)

ตรวจสถิติจาก pymupdf ของเล่ม 1.2–1.9 แล้ว ฟอนต์ซ้อนเฉพาะ **สระ/วรรณยุกต์** (้้ 2,799 จุด, ่่ 2,428, ีี 1,870 …)
ไม่เคยซ้อนพยัญชนะ (ธรม 0 / ธรรม 95) — regex ตาม spec §8 ที่ยุบ "ทุกตัวอักษรไทย" จึงทำลายคำสะกดซ้ำโดยชอบ
(สสาร→สาร, แบบ→แบ, ออก→อก, บุคคล→บุคล) ค่าเริ่มต้นตอนนี้ยุบเฉพาะสระ/วรรณยุกต์ (`DUP_RE`) และไม่รัน dictionary
fixer (ไม่มีอะไรให้แก้คืน และ fuzzy pattern ของมันแก้เกิน เช่น แกรม→แกรรม) ต้องการพฤติกรรม spec ตรงตัวใช้
`--legacy-collapse` (`LEGACY_DUP_RE` + fixture) นอกจากนี้ลบ glyph ละตินแปลกปลอมที่ฟอนต์ปล่อยติดตัวอักษรไทย
(Ě ę š ć Ĝ Ⱦ … ช่วง U+0080–U+036F) เฉพาะที่ติดตัวอักษรไทย คำละตินจริง (EPR, Quantamagazine) ไม่โดน

## ข้อจำกัดที่ทราบแล้ว (บันทึกไว้ให้คนตรวจ ไม่ใช่บั๊กที่ไม่รู้ตัว)

1. **`clean.py`** แก้ตัวอักษรไทยซ้อน/ซ้ำได้ดี (มี unit test เทียบคำตรงตัวจาก spec ครบ) แต่ **ไม่แก้ช่องว่าง
   ปลอมที่แทรกกลางคำแบบสุ่ม** (เช่น "ตกต่ าง" ที่ควรเป็น "ตกต่าง") เพราะภาษาไทยใช้ช่องว่างจริงเป็นครั้งคราว
   เช่นกัน แยกแยะสองอย่างนี้ด้วย regex ไม่ได้ — `--report` จะรายงานบรรทัดที่น่าสงสัยให้ตรวจด้วยตา
2. **`split.py`** หาหัวข้อบทด้วยการ normalize ช่องว่างทิ้งแล้วค้นหา ทนต่อความเสียหายจาก clean.py ได้ระดับหนึ่ง
   แต่ถ้าชื่อบทใน PDF เพี้ยนไปจากที่ตั้งไว้ใน `book.json` มากเกินไป (ตัวอักษรเปลี่ยน ไม่ใช่แค่ช่องว่าง)
   จะหาไม่เจอและ exit 1 — แก้โดยปรับข้อความใน `book.json` ให้ตรงกับที่ PDF สะกดจริง แล้วรันใหม่
3. **`terms.py`** ตัดคำแบบ "ห้ามห่อคำที่อยู่ในคำอื่น" (เช่น `สติ` ใน `สติปัญญา`) โดยไม่ใช้ตัวตัดคำภาษาไทย
   จริง (ไม่ได้อยู่ใน dependency) ใช้ 2 กลไกแทน: (ก) longest-match ในรายการศัพท์เอง แก้กรณีที่คำประกอบ
   ก็เป็นศัพท์อยู่แล้ว (ข) รายการ `pipeline/fixtures/term_exclusions.json` ที่แก้ไขมือได้ สำหรับกรณีคำสั้น
   ไปแอบในคำยาวที่ไม่ได้เป็นศัพท์เอง — เมื่อ QA เจอคำห่อผิดจุด (checklist §11/A-01) ให้เพิ่มรายการในไฟล์นี้
   แล้วรัน `terms.py` ใหม่ (ไม่ต้องแก้โค้ด)
4. **ความยาวบท** (§9.1 ข้อ 9: 900-1,400 คำ) — ภาษาไทยไม่มีตัวคั่นคำ การนับ "คำ" แม่นยำต้องใช้ตัวตัดคำ
   `author.py` จึงประมาณจากจำนวนตัวอักษรแทน (แจ้งเตือนเป็นคำเตือน ไม่ fail อัตโนมัติ) — คนตรวจต้องยืนยัน
   ความยาวจริงตอนอ่านทวน
5. **`interactive.config` ของ "particles"** ใช้ชื่อสีจากพาเลต (`gold|teal|pink|star|mint`) และชื่อ shape
   ตามสัญญาระหว่างโมดูล §E.4 เท่านั้น (ห้าม hex) — ไฟล์ seed `ch01.json`/`ch02.json` ปัจจุบันบนดิสก์ยังใช้
   รูปแบบเก่า (`k/a/d/n/col` + hex) ที่ **ไม่ตรง** กับสัญญานี้ (ดูความเสี่ยง #2 ที่ orchestrator ระบุไว้แล้ว)
   `author.py` ไม่เลียนแบบรูปแบบเก่านั้น (มีคำเตือนใน prompt เอง) แต่ **ไฟล์ ch01.json/ch02.json เดิมเอง
   ยังต้องมีคนแก้ให้ตรง schema ก่อน build.js/particles.js ใช้งานได้จริง** — pipeline นี้ไม่แก้ไฟล์นั้นให้
   เพราะไม่ได้เป็นคนเขียน seed (อยู่ในขอบเขตของ P6/ทีม content)

## Unit test

```bash
python3 -m unittest discover -s pipeline/tests -v
```

ครอบคลุม: ตัวอย่างยุบอักษรซ้ำจาก spec ตรงๆ, การแก้คำ dictionary ทั้งสองทิศทาง (ยุบเกิน/ไม่ยุบคำที่ไม่มี
ตัวซ้อน), การรวมบรรทัดที่ถูกตัดกลางคำ, การลบ `�`/เลขหน้า, auto-link แบบ longest-match/first-occurrence/
idempotent/exclusion-list ของ `terms.py`

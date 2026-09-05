# content/ — ข้อมูลหนังสือชุด "ไตรลักษณ์ในควอนตัม"

โฟลเดอร์นี้ไม่มีฐานข้อมูล ทุกอย่างเป็นไฟล์ JSON ธรรมดา อ่านจริงตอน build (`web/build.js`)
และตอนตอบคำถาม (`proxy/`) โครงสร้างและกฎทั้งหมดยึดตาม `docs/handoff-spec.md` §10
และสัญญาระหว่างโมดูล §A ที่ orchestrator กำหนด — เอกสารนี้สรุปเฉพาะส่วนที่เกี่ยวกับ `content/`

## ใครเขียนไฟล์ไหน

| ไฟล์ | ใครเขียน | เมื่อไหร่ |
|---|---|---|
| `content/source/*.pdf` | คนวางเอง (ไม่ commit ตาม A-01 เว้นแต่ A-02 อนุมัติแยกเล่ม) | ก่อนรัน pipeline |
| `content/schema/*.schema.json`, `validate.mjs` | ทีม content (เจ้าของสัญญา §A.5) | ครั้งเดียว แก้เมื่อ data model เปลี่ยน |
| `content/books/{slug}/book.json` | ทีม content เขียน/แก้มือ | ตอนเพิ่มเล่มใหม่ หรือเมื่อ `chapters[].status` ต้องอัปเดตให้ตรงกับ `chNN.json` |
| `content/books/{slug}/raw/chNN.txt` | `pipeline/extract.py` → `clean.py` → `split.py` | อัตโนมัติ จาก PDF |
| `content/books/{slug}/chNN.json` | `pipeline/author.py` เขียนตอนแรก (status เริ่มต้นเป็น `"draft"` เสมอ) แล้วคนตรวจแก้มือ + เปลี่ยนเป็น `"ready"` | หลัง split, ก่อน build |
| `content/books/{slug}/glossary.json` | `pipeline/terms.py` **เท่านั้น** | ทุกครั้งที่รัน terms.py (idempotent, merge กับของเดิม) |
| `content/index.json` | `web/build.js` generate | ทุกครั้งที่ build — **ห้ามแก้มือ ห้าม commit** |
| `content/index.example.json` | ทีม content เขียนมือ | ตัวอย่างรูปร่างของ `index.json` ให้ P2/P4 ใช้ทดสอบ ก่อนที่ build.js จะ generate ไฟล์จริงได้ |

กฎที่ตามมา: ห้ามแก้ `content/index.json` ด้วยมือ (จะถูกทับทุก build) และห้ามให้ `author.py`
เขียน status เป็น `"ready"` เอง — ต้องมีคนตรวจก่อนเสมอ (ยกเว้นทีมนี้ใช้ Opus เป็นผู้ตรวจแทนคนตามที่
ผู้ใช้สั่งไว้ ดู `docs/PROGRESS.md`)

## สถานะบท: `draft` / `ready` / `building`

แต่ละบทมีสถานะเดียวที่ต้องตรงกันใน **สองที่พร้อมกันเสมอ**:

- `content/books/{slug}/book.json` → `chapters[i].status`
- `content/books/{slug}/chNN.json` → `status`

`content/schema/validate.mjs` fail ทันทีถ้าสองค่านี้ไม่ตรงกัน — เวลาคนตรวจแก้ `chNN.json`
เป็น `ready` ด้วยมือ **ต้องแก้ `book.json` ที่ ChapterMeta ของบทเดียวกันด้วย** ไม่งั้น build จะพัง

ความหมายของแต่ละสถานะ:

- **`building`** — ยังไม่มีเนื้อหาเต็ม (ยังไม่ผ่าน author.py หรือยังไม่มีไฟล์ `chNN.json` เลยก็ได้
  ถ้าเป็นเช่นนั้นต้องยังไม่ปรากฏชื่อบทใน `book.json.chapters`) หน้าเว็บแสดง "กำลังสร้าง"
  แต่ผู้ช่วย AI ยังตอบคำถามเกี่ยวกับบทนี้ได้จาก `summary`/`keyPoints` ถ้ามีไฟล์แล้ว
- **`draft`** — `author.py` เขียนเนื้อหาเต็มแล้ว แต่ยังไม่มีคนตรวจ ยังแสดงเป็น "กำลังสร้าง"
  เหมือน `building` ทุกประการฝั่งหน้าเว็บ (ผู้อ่านแยกไม่ออก) ต่างกันแค่ proxy มีเนื้อหาเต็มให้ใช้ตอบคำถาม
- **`ready`** — ผ่านการตรวจแล้ว หน้าเว็บแสดง "อ่านได้" เต็มรูปแบบ

**ข้อบังคับ:** ทุกบทของทุกเล่ม (แม้ยัง `building`) ต้องมีไฟล์ `chNN.json` ถ้าปรากฏอยู่ใน
`book.json.chapters[]` — field ที่บังคับเสมอคือ `summary`/`keyPoints`/`keywords`/`suggestions`
(ใช้โดย retrieval ของผู้ช่วย AI แม้บทยังไม่เปิดให้อ่าน) ส่วน `sections`/`interactive`/`exercise`/`questions`/`terms`
บังคับเฉพาะเมื่อ status เป็น `draft` หรือ `ready` เท่านั้น (ดู `content/schema/chapter.schema.json`)

## ตรวจไฟล์ก่อน build เสมอ

```
node content/schema/validate.mjs        # ตรวจ content/ ทั้งหมด (เท่ากับ default arg)
node content/schema/validate.mjs path/  # ตรวจโฟลเดอร์ content อื่น เช่น fixture ทดสอบ
```

`web/build.js` ต้องเรียกคำสั่งนี้เป็นขั้นแรกและหยุด build ทันทีถ้า exit code ไม่ใช่ 0 — ดู `Makefile` target `build`

`validate.mjs` ตรวจทั้งรูปร่าง JSON (ตาม `.schema.json` ทั้ง 5 ไฟล์) และกฎข้ามไฟล์ที่ JSON Schema
เดี่ยวๆ ตรวจเองไม่ได้ 3 ข้อ: (1) `book.json.chapters[].status` ต้องเท่ากับ `chNN.json.status`
(2) ทุก `<dfn data-term="…">` ต้องอ้างถึงคำที่มีอยู่จริงใน `glossary.json` ของเล่มนั้น
(3) `glossary.json` ห้ามมี term ซ้ำ — สคีมาการอนุญาตแท็ก HTML ภายในย่อหน้า (`<b>` `<i>` `<dfn>` เท่านั้น)
ถูกฝังเป็น `pattern` ไว้ใน `chapter.schema.json` โดยตรงแล้ว ไม่ต้องเขียนเช็คแยก

## เพิ่มเล่มใหม่ (เล่ม 2–9)

1. สร้าง `content/books/{slug}/book.json` ขั้นต่ำ: `slug, order, title, author, blurb, coreIdeas,
   status:"building", chapters:[]` (ใส่ `sourcePdf` ถ้ามีไฟล์ PDF ใน `content/source/` แล้ว)
2. `chapters` ปล่อยว่างได้ **เฉพาะ** ตอนที่ `status` ของเล่มเป็น `"building"` ทั้งเล่ม
3. เมื่อรัน pipeline จนมี `chNN.json` แล้ว ค่อยเติม `ChapterMeta` เข้า `chapters[]` ให้ตรงสถานะ

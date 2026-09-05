# content/ — ข้อมูลหนังสือชุด "ไตรลักษณ์ในควอนตัม"

โฟลเดอร์นี้ไม่มีฐานข้อมูล ทุกอย่างเป็นไฟล์ JSON ธรรมดา อ่านจริงตอน build (`web/build.js`)
และตอนตอบคำถาม (`proxy/`) โครงสร้างและกฎทั้งหมดยึดตาม `docs/handoff-spec.md` §10
และสัญญาระหว่างโมดูล §A ที่ orchestrator กำหนด — เอกสารนี้สรุปเฉพาะส่วนที่เกี่ยวกับ `content/`

## ใครเขียนไฟล์ไหน

| ไฟล์ | ใครเขียน | เมื่อไหร่ |
|---|---|---|
| `content/source/*.pdf` | คนวางเอง — **commit ได้** ตาม A-02 (5 ก.ย. 2026 เจ้าของลิขสิทธิ์อนุมัติแจกจ่ายเนื้อหาเต็มเล่มบน public repo แล้ว ยกเลิก §11 ข้อห้าม #2 ทั้งข้อ ดู `docs/spec-addendum.md`) — เครดิตผู้เขียนยังบังคับครบทุกจุดเหมือนเดิม | ก่อนรัน pipeline |
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

- **`building`** — ยังไม่มีเนื้อหาเต็ม (ยังไม่ผ่าน author.py) หน้าเว็บแสดง "กำลังสร้าง"
  แต่ผู้ช่วย AI ยังตอบคำถามเกี่ยวกับบทนี้ได้จาก `summary`/`keyPoints` ถ้ามีไฟล์แล้ว
- **`draft`** — `author.py` เขียนเนื้อหาเต็มแล้ว แต่ยังไม่มีคนตรวจ ยังแสดงเป็น "กำลังสร้าง"
  เหมือน `building` ทุกประการฝั่งหน้าเว็บ (ผู้อ่านแยกไม่ออก) ต่างกันแค่ proxy มีเนื้อหาเต็มให้ใช้ตอบคำถาม
- **`ready`** — ผ่านการตรวจแล้ว หน้าเว็บแสดง "อ่านได้" เต็มรูปแบบ

**ข้อบังคับ (§A.1/§A.2 — สำคัญ อย่าสับสนกับ "เล่มที่ยังไม่เริ่ม" ด้านล่าง):**
เมื่อเล่มเริ่มเขียนแล้ว `book.json.chapters[]` **ต้องมีครบทุกบทของเล่มเสมอ** เรียงตาม `order`
ไม่ใช่ใส่เฉพาะบทที่มีไฟล์พร้อมแล้ว — และ **ทุกบทที่อยู่ใน `chapters[]` ต้องมีไฟล์ `chNN.json` คู่กันเสมอ**
แม้ status จะเป็น `building` ก็ตาม (field ที่บังคับเสมอคือ `summary`/`keyPoints`/`keywords`/`suggestions`
ใช้โดย retrieval ของผู้ช่วย AI แม้บทยังไม่เปิดให้อ่าน ส่วน `sections`/`interactive`/`exercise`/`questions`/`terms`
บังคับเพิ่มเฉพาะเมื่อ status เป็น `draft` หรือ `ready` เท่านั้น ดู `content/schema/chapter.schema.json`)
`chapters[]` ปล่อยเป็น `[]` ได้กรณีเดียวคือ**เล่มทั้งเล่มยังไม่เริ่มเขียนเลย** (`book.json.status` เป็น
`"building"` และยังไม่มีบทไหนแม้แต่บทเดียว) — ดูหัวข้อ "เพิ่มเล่มใหม่" ด้านล่าง

## ตรวจไฟล์ก่อน build เสมอ

```
node content/schema/validate.mjs        # ตรวจ content/ ทั้งหมด (เท่ากับ default arg)
node content/schema/validate.mjs path/  # ตรวจโฟลเดอร์ content อื่น เช่น fixture ทดสอบ
```

`web/build.js` ต้องเรียกคำสั่งนี้เป็นขั้นแรกและหยุด build ทันทีถ้า exit code ไม่ใช่ 0 — ดู `Makefile` target `build`

`validate.mjs` ตรวจทั้งรูปร่าง JSON (ตาม `.schema.json` ทั้ง 5 ไฟล์) และกฎข้ามไฟล์ที่ JSON Schema
เดี่ยวๆ ตรวจเองไม่ได้:

1. `book.json.chapters[i]` ทุกฟิลด์ (`status`, `title`, `sub`, `thaiNum`, `order`) ต้องเท่ากับ
   `chNN.json` ของบทเดียวกันเสมอ (ไม่ใช่แค่ `status`/`slug` — เพราะ rail/mobnav/mapgrid render จาก
   `book.json` แต่หัวบทจริงบนหน้าเว็บ render จาก `chNN.json` โดยตรง ถ้าไม่ตรงจะเห็นข้อความคนละชุด)
2. ทุก `<dfn data-term="…" data-kind="…">` ต้องอ้างถึงคำที่มีอยู่จริงใน `glossary.json` ของเล่มนั้น
   และ `data-kind` ต้องตรงกับ `kind` ของคำนั้นใน glossary
3. `glossary.json` ห้ามมี term ซ้ำ
4. ไฟล์ `chNN.json` ทุกไฟล์บนดิสก์ต้องถูกอ้างถึงใน `book.json.chapters[]` (กันไฟล์กำพร้าหลุดจากการตรวจ)
5. `interactive.position` ห้ามเกินจำนวน `sections`, `bulletsAfter` ห้ามเกินจำนวน `paragraphs` ของ section นั้น
6. ทุก string ใต้ `interactive.config` ห้ามมีแท็ก HTML นอกเหนือจาก `<b>` (กัน XSS — `config` ถูกส่งตรงเข้า
   P5 แล้ว render เป็น innerHTML บางจุดตาม §E.4)
7. `sourcePdf` (ถ้ามี) — เตือนถ้าไฟล์ไม่มีจริงใน `content/source/`, error ถ้ามีไฟล์แต่ `bytes` ไม่ตรงขนาดจริง
   (ใช้ `--strict-source` เพื่อบังคับให้ไฟล์ไม่มีจริงเป็น error แทนคำเตือน)

สคีมาการอนุญาตแท็ก HTML ภายในย่อหน้า (`<b>` `<i>` `<dfn>` เท่านั้น) ถูกฝังเป็น `pattern` ไว้ใน
`chapter.schema.json` โดยตรงแล้ว ไม่ต้องเขียนเช็คแยก — ไฟล์ JSON ที่อ่านไม่ขึ้น (syntax error) จะถูก
รายงานเป็น error ของไฟล์นั้นไฟล์เดียวและตรวจไฟล์ที่เหลือต่อ ไม่ทำให้ทั้งคำสั่งพังกลางคัน

## เพิ่มเล่มใหม่ (เล่ม 2–9)

1. สร้าง `content/books/{slug}/book.json` ขั้นต่ำ: `slug, order, title, author, blurb, coreIdeas,
   status:"building", chapters:[]` (ใส่ `sourcePdf` ถ้ามีไฟล์ PDF ใน `content/source/` แล้ว)
2. `chapters` ปล่อยว่างได้ **เฉพาะ** ตอนที่ `status` ของเล่มเป็น `"building"` ทั้งเล่ม
3. เมื่อรัน pipeline จนมี `chNN.json` แล้ว ค่อยเติม `ChapterMeta` เข้า `chapters[]` ให้ตรงสถานะ

> **สถานะปัจจุบัน (5 ก.ย. 2026):** มีแค่ `content/books/trilaksana-quantum/` เท่านั้นที่มี `book.json`
> จริง เล่ม 2–9 (slug ตัวอย่างอยู่ใน `content/index.example.json`) ยังไม่มีโฟลเดอร์/`book.json`
> เลยแม้แต่ไฟล์เดียว — หน้าชั้นหนังสือตอนนี้จะ generate ได้แค่การ์ดเดียว ใครหยิบงานนี้ต่อ (ทีม content
> หรือ P7 seed) ต้องสร้างตามขั้นตอนข้างบนให้ครบ 8 เล่มก่อน `make build` จะแสดงชั้นหนังสือ 9 เล่มได้จริง

## เครดิตผู้เขียน (บังคับตาม A-01 และเพิ่มจุดที่ 6 ตาม A-02)

นอกจาก 5 จุดในหน้าเว็บที่ P4/P5 ดูแล (ดูสัญญาระหว่างโมดูล §J) ตั้งแต่ A-02 อนุมัติแจกจ่ายเนื้อหา
เต็มเล่มบน public repo แล้ว **`README.md` ของ repo (ระดับบนสุด ไม่ใช่ไฟล์นี้) ต้องมีบรรทัด**
"เนื้อหาต้นฉบับทั้ง 9 เล่มเผยแพร่ในที่เก็บนี้โดยได้รับอนุญาตจากผู้เขียน สิรวิชญ์ รัตน์จินดา" ด้วย —
เป็นหน้าที่ของทีม infra (P1) ที่ดูแลไฟล์นั้น

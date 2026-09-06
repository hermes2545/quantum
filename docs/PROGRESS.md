# PROGRESS — quantum book platform (ทั้ง 9 เล่ม)

Orchestrator: session หลัก (Fable 5.1) · Reviewer: Opus 5 · Implementer: Sonnet 5 / Haiku 4.5
โหมด: autonomous loop ไม่รอยืนยัน จนจบ (สั่ง 5 ก.ย. 2026)

## ขอบเขตที่ผู้ใช้สั่ง (เหนือ spec หลัก)
- ทำ **ครบทั้ง 9 เล่ม** ไม่ใช่แค่เฟส 1 เล่มแรก
- PDF ต้นฉบับเปิดได้ในเมนูส่วนท้าย (A-01) — ได้รับอนุญาตจากผู้เขียนแล้ว ต้องให้เครดิต สิรวิชญ์ รัตน์จินดา
- ไม่รอ human review ระหว่างทาง → ใช้ Opus reviewer แทน แล้ว mark `ready` เมื่อผ่าน
  (เบี่ยงจาก §11 ข้อห้าม #3 โดยคำสั่งผู้ใช้; เก็บ `reviewedBy` ไว้ให้คนมาตรวจย้อนหลังได้)

## เฟส
- [x] 0. เอกสาร: handoff-spec, prototype, book01 txt, addendum, agent-team
- [x] 1. โครง infra/proxy/pipeline/web/content — 6 package, Opus ตรวจ 59 findings (9 blocker) → แก้ครบ → smoke test ผ่าน
      (proxy health/traversal/maxRetries:0, Caddy SSE flush, pytest 34 passed, ไม่มี key/window.claude หลุด)
      ตกลงธรรมเนียมตามสัญญา Fable: chapter.slug = chNN, <dfn> มี data-kind, module = particles | {book}/chNN → `content/schema/normalize.mjs`
- [x] 2. PDF 9 เล่ม → content/source/ — **ครบ 9 เล่ม (6 ก.ย.)**: 7 เล่มดึงจาก Drive ผ่าน connector ได้เอง ด้วย `download_file_content` (harness เก็บผล base64 ลงไฟล์ให้ถอดรหัสได้) ส่วน 1.1 (connector "session expired" ทุกครั้ง) และ 1.5 (10.5 MB เกินลิมิต 10 MB ของ connector) ผู้ใช้วางเองแล้ว → `validate.mjs --strict-source` ผ่าน และ `/api/source/{slug}.pdf` เสิร์ฟครบทุกเล่ม (ทดสอบ 4 เล่ม 200 OK)
- [~] 3. extract + clean + split → raw/chNN.txt — เล่ม 1 เสร็จ; **7 เล่ม (2,3,4,6,7,8,9) เสร็จ 6 ก.ย.**: extract (pymupdf) → `pipeline/toc_init.py` (สเปกสารบัญที่คนเขียนจาก TOC ของ PDF → book.json.chapters + stub chNN.json status building + raw/_toc.json) → `pipeline/split_pages.py` (ตัดบทตามเลขหน้าพิมพ์ = ดัชนี PDF+1, clean ต่อบท) รวม 140 บท (เล่ม 5 = 20 บท เพิ่ม 6 ก.ย. หลังได้ PDF)
      การตัดสินใจ: 1 บทเรียน = 1 บทต้นฉบับ ยกเว้น เล่ม 2 (41 บทสั้น 2–8 หน้า → รวมเป็น 17 บทตามส่วนของหนังสือ, `source` ใน raw/_toc.json บอกว่ารวมบทไหน) และ เล่ม 9 Part 12 (74 หน้า → แยก 2 บทที่หน้า 196 = เริ่มอริยสัจ 4)
      clean.py: ฟอนต์เล่ม 2–9 ซ้อนเฉพาะสระ/วรรณยุกต์ ไม่ซ้อนพยัญชนะ (ตรวจสถิติแล้ว) → ค่าเริ่มต้นยุบเฉพาะสระ/วรรณยุกต์ + ลบ glyph ละตินแปลกปลอม (Ě ę š ć Ĝ …); โหมด spec เดิม = `--legacy-collapse`
- [~] 4. author ทุกบท — **เล่ม 1 ครบ 9/9 ready**; เล่มนำร่อง quantum-merit-power เขียนครบ 10/10 (draft) รอบตรวจแรกชน session limit (reset 18:30) → resume workflow ต่อ
      **ค่าใช้จ่ายจริง: ~2.3M token ต่อ 10 บท (เขียน+ตรวจบางส่วน)** — 140 บทที่เหลือจะชน session limit หลายรอบ ต้องทยอยทีละเล่มและ resume
- [x] 4b. เดิม: (บท 1–2 จาก prototype; บท 3–9 Sonnet เขียน → Opus ตรวจ 2–3 รอบ → แก้ → Opus ยืนยัน post-fix; reviewedBy=opus-5-agent)
      เล่ม 2–9 รอ PDF
- [x] 6. interactives เขียนมือ — ch01 (particles config), ch02 zoom-scale 4 KB, ch03 aggregate-chain+ใส่สติ 21 KB, ch04 star-mass 22 KB, ch09 cell-turnover 30 KB; ch05–08 ใช้ particles กลาง (ch08 เก็บ requestedModule=evolution-timeline ไว้ทำภายหลัง)
- [x] 5. glossary + auto-link + index.json — เล่ม 1: glossary 71 คำ (merge โดย normalize.mjs), validate ผ่าน 13 ไฟล์, build 13 หน้า, index.json 1 เล่ม
- [ ] 6. interactives เขียนมือ (บท 1,2,3,4,9 ของเล่ม 1 อย่างน้อย)
- [x] 7. build static + รัน proxy + ทดสอบ mobile 360/390/768/1280 — QA จริงด้วย Playwright 5 หน้า × 4 ขนาด (docs/qa/mobile-report.md + 29 ภาพ): ไม่มี horizontal scroll, AskPanel เต็มจอ, TermSheet ≤75vh, console error 0; ตกกฎข้อ 8 (ฟอนต์ 15px) → แก้แล้ว
- [ ] 5b. เล่ม 2–9: blurb/coreIdeas จริงใน book.json (Sonnet จากคำนำ) → author ทีละเล่มด้วย `tools/workflow-author-book.js` (เริ่มเล่มเล็กสุด quantum-merit-power เป็นนำร่อง) → normalize/validate/build → push ต่อเล่ม
- [ ] 8. docker compose ทดสอบบนเครื่องนี้ — `docker compose config` ผ่าน; daemon (colima) ไม่ได้รัน → ทดสอบจริงบน Ubuntu ตาม spec
- [~] 9. ตรวจรับโดย Opus ตาม §11 (12 ข้อ): ผ่าน 9 / ข้อสังเกต 3 — blocker: **B1 PDF ยังไม่มีในเครื่อง (ผู้ใช้)**, **B2 ANTHROPIC_API_KEY ว่างใน .env (ผู้ใช้)**, B3 config ของ ch05–08 ไม่ตรงโมดูล particles → **แก้แล้ว** (objects 5/5/6/5 + guard ใน normalize.mjs); ข้อควรแก้ 14 ข้อ → แก้แล้ว 11 (ask effort/max_tokens notice, XFF, root, isFile, README, bulletsAfter, hint, .msg, review-ch03, วิธีนับคำมาตรฐาน = `pipeline/wordcount.py`) เหลือที่ตั้งใจไม่ทำในเฟสนี้: บันทึกเหตุผลตัดเนื้อหา raw ch06/ch08 (จะทำตอนทำ interactive มือให้บทเหล่านั้น), server-side fallbacks (ทางเลือก ไม่อยู่ใน spec), .scroll-x (ยังไม่มีเนื้อหากว้าง)

## สิ่งที่ผู้ใช้ต้องทำก่อนเปิดใช้เฟส 1 (ระบบทำแทนไม่ได้)
1. วาง PDF **2 เล่มที่เหลือ** (1.1 ไตรลักษณ์ในควอนตัม, 1.5 ควอนตัมในสิ่งมีชีวิต) ลง `content/source/` (ชื่อไฟล์ตาม `content/books/*/book.json → sourcePdf.file`) แล้ว `node content/schema/validate.mjs --strict-source`
2. ใส่ `ANTHROPIC_API_KEY` ใน `.env` + ตั้ง spend limit ใน Anthropic Console
   วิธีที่ง่ายสุด: เปิดโฟลเดอร์ Drive `quantum book/E-Books ธรรมะ-ควอนตัม 9 เล่ม-20260905T055651Z-1-001/E-Books ธรรมะ-ควอนตัม 9 เล่ม`
   → ดาวน์โหลดทั้งโฟลเดอร์ (zip) → แตกไฟล์ลง `content/source/` (ชื่อไฟล์ใน Drive ตรงกับ `sourcePdf.file` อยู่แล้ว ไม่ต้องเปลี่ยนชื่อ)
   **ทดลองดึงอัตโนมัติแล้ว 6 ก.ย. 2026 — ทำแทนไม่ได้ทุกทาง:** (ก) ลิงก์ `drive.google.com/uc?export=download` ต้องล็อกอิน (ไฟล์แชร์เฉพาะบัญชี);
   (ข) Drive connector อ่านข้อความจาก PDF ได้แค่ ~80 หน้าแรก (ตัดที่ ~190 KB) และตัวอักษรไทยหาย 5–8% ต่อหน้า (U+FFFD + font map เพี้ยน) ใช้ author ไม่ได้;
   (ค) `download_file_content` คืน base64 ขนาด 4–14 MB เกิน context; (ง) `share_file` แชร์ได้เฉพาะอีเมล ไม่มี "anyone with link"; (จ) ไม่มี rclone/gdrive/Drive desktop ในเครื่อง; (ฉ) Chrome extension ผู้ใช้เลือกไม่ติดตั้ง
3. บน Ubuntu: `docker compose up -d` → เปิด `http://<tailscale-host>:8080` จากมือถือ

## ขั้นตอนเล่ม 2–9 (เมื่อ PDF มา)
`python -m pipeline.run --book <slug> --skip-author` → ตรวจ raw/_split → workflow เขียนบท (แบบ `author-book1-ch03-09` แต่ใช้ fix 1 รอบ + Opus verify medium) → `normalize.mjs` → `validate.mjs` → `build.js` → push

## บันทึกการตัดสินใจ
- เนื้อหาบทเขียนด้วย subagent ใน workflow (ไม่ใช่ pipeline/author.py เรียก API) เพราะไม่ต้องใช้ API key แยก
  และตรวจด้วย Opus ได้ในสายเดียว — author.py ยังมีไว้เพื่อรันซ้ำภายหลัง
- python บนเครื่อง 3.9 (spec ว่า 3.11) ใช้ pymupdf แทน pdftotext เพราะไม่มี poppler
- A-02: เจ้าของลิขสิทธิ์อนุมัติแจกจ่ายเนื้อหาเต็มเล่มบน public repo → PDF + raw text commit ได้ (§11 ข้อห้าม #2 ยกเลิก)
- GitHub: repo hermes2545/quantum (public) — push ติด 403 เพราะ keychain credential เป็น user p2544 รอผู้ใช้เพิ่มเป็น collaborator

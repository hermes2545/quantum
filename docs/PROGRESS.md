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
- [~] 4. author ทุกบท — **เล่ม 1 ครบ 9/9 ready · เล่ม 7 quantum-merit-power ครบ 10/10 ready · เล่ม 2 quantum-brain-success ครบ 17/17 ready (10 ก.ย. 2026)**
      เล่ม 2 รอบสุดท้าย: บท 1–6 มีไฟล์ตรวจของ Opus อยู่แล้ว (needs_fix ทุกบท) → session หลักแก้ตาม finding แล้วบันทึก `postFixVerify` ต่อท้ายไฟล์เดิม; บท 7–17 ไม่มีไฟล์ตรวจ → **session หลัก (Opus 5) ตรวจเองแล้วเขียน `_review-chNN.json` ใหม่** โดยบันทึกไว้ตรงๆ ว่าผู้ตรวจกับผู้แก้เป็นคนเดียวกัน (โควตาเอเจนต์หมด ใช้ทางสำรองตามแผนด้านล่าง)
      ข้อผิดพลาดที่พบซ้ำทั้งเล่ม: ศัพท์ไม่มีคำขยายครั้งแรก · เลนส์ n ไม่พูดในนามบุญ/สติ/ความพอเพียง · วลี "แนวคิดหลักข้อที่N" ที่ผู้อ่านไม่รู้ว่าคือข้อไหน · นิยาม "รังสีกาย" ที่ขัดกับ raw · dfn ห่อกลางคำ (กรรมพันธุ์ ตรวจทาน อุปาทาน ชะตากรรม ทานมื้อ) · shape ซ้ำ
      **ค่าใช้จ่ายจริง: ~2.3M token ต่อ 10 บท (เขียน+ตรวจบางส่วน)** — 140 บทที่เหลือจะชน session limit หลายรอบ ต้องทยอยทีละเล่มและ resume
- [x] 4b. เดิม: (บท 1–2 จาก prototype; บท 3–9 Sonnet เขียน → Opus ตรวจ 2–3 รอบ → แก้ → Opus ยืนยัน post-fix; reviewedBy=opus-5-agent)
      เล่ม 2–9 รอ PDF
- [x] 6. interactives เขียนมือ — ch01 (particles config), ch02 zoom-scale 4 KB, ch03 aggregate-chain+ใส่สติ 21 KB, ch04 star-mass 22 KB, ch09 cell-turnover 30 KB; ch05–08 ใช้ particles กลาง (ch08 เก็บ requestedModule=evolution-timeline ไว้ทำภายหลัง)
- [x] 5. glossary + auto-link + index.json — เล่ม 1: glossary 71 คำ (merge โดย normalize.mjs), validate ผ่าน 13 ไฟล์, build 13 หน้า, index.json 1 เล่ม
- [ ] 6. interactives เขียนมือ (บท 1,2,3,4,9 ของเล่ม 1 อย่างน้อย)
- [x] 7. build static + รัน proxy + ทดสอบ mobile 360/390/768/1280 — QA จริงด้วย Playwright 5 หน้า × 4 ขนาด (docs/qa/mobile-report.md + 29 ภาพ): ไม่มี horizontal scroll, AskPanel เต็มจอ, TermSheet ≤75vh, console error 0; ตกกฎข้อ 8 (ฟอนต์ 15px) → แก้แล้ว
- [~] 5b. เล่ม 2–9: blurb/coreIdeas จริงใน book.json (Sonnet จากคำนำ) → author ทีละเล่มด้วย `tools/workflow-author-book.js` (เริ่มเล่มเล็กสุด quantum-merit-power เป็นนำร่อง) → normalize/validate/build → push ต่อเล่ม
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

## เผยแพร่สาธารณะ (GitHub Pages) — ตั้งค่า 7 ก.ย. 2026
- workflow `.github/workflows/pages.yml` build ด้วย `BUILD_STATIC=1 BASE_PATH=/quantum` แล้ว deploy อัตโนมัติทุกครั้งที่ `content/**` หรือ `web/**` เปลี่ยนบน main
- โหมด static: `pageData.api.ask = null` -> ปุ่มถามตอบว่าเป็นเว็บอ่านอย่างเดียว, เมนู PDF ต้นฉบับชี้ไป raw.githubusercontent.com (ยังห้าม .pdf ใน web/public ตามกฎเหล็ก #2)
- เผยแพร่เฉพาะบท ready — บท draft/building render เป็นหน้า "กำลังสร้าง" ไม่มีเนื้อหา และอภิธานศัพท์รวมตัดคำที่มีแต่บทยังไม่ผ่านการตรวจใช้อยู่ออก
- ค้างอยู่ที่ผู้ใช้ 1 คลิก: Settings -> Pages -> Source = "GitHub Actions" (ถ้ายังไม่ผ่าน: Settings -> Actions -> General -> Workflow permissions = Read and write) เพราะ configure-pages enablement:true ถูก 403 เมื่อ repo ยังไม่เคยเปิด Pages
- URL หลังเปิด: https://hermes2545.github.io/quantum/

## อ่านบนเครื่องนี้ / ผ่าน Tailscale
`make dev-mac` (proxy + tools/dev-server.js แทน Caddy) -> http://localhost:8080 · LAN http://192.168.0.220:8080 · Tailscale http://paperclip-mac.tail54c3.ts.net:8080 (เครื่องนี้ = paperclip-mac 100.74.177.75) — หยุดด้วย `make dev-mac-stop`

## วิธีทำงานช่วงเขียนเล่ม 2–9 (ตกลง 7 ก.ย. 2026)
- **push ทีละเล่ม ไม่รอให้ครบ 9 เล่ม** (ผู้ใช้ให้ตัดสินใจเอง) — แต่ละเล่มอ่านจบได้ในตัวเอง, build เผยแพร่เฉพาะบท ready อยู่แล้ว, เล่มที่ยังไม่เสร็จขึ้น "กำลังสร้าง" และ diff ต่อเล่มเล็กพอให้ย้อนได้
- ลำดับ: order 2 → 3 → 4 → 5 → 6 → 8 → 9 (เล่ม 1 และ 7 เสร็จแล้ว) รวมที่เหลือ 130 บท
- args พร้อมยิงของทุกเล่มอยู่ที่ scratchpad/args/{slug}.json (สร้างจาก book.json.chapters ใหม่ได้เสมอ)
- workflow ชนโควตาเป็นระยะ — resume ด้วย `Workflow({scriptPath, resumeFromRunId})` args เดิม เอเจนต์ที่สำเร็จแล้วจะ replay จาก cache
  ⚠ ถ้าแก้ prompt ในสคริปต์ cache จะ miss ทั้งหมด ให้แก้เฉพาะตอนไม่มี run ค้าง
- **เครื่องมือตรวจเชิงกลที่เพิ่มรอบนี้ (10 ก.ย. 2026)** ใช้ได้กับทุกเล่ม:
  - `python -m pipeline.copyscan --book <slug> [--chapter chNN]` — หาช่วงที่ลอก raw ตรงๆ ยาว >= 60 อักษรไทย (คำพูดในเครื่องหมายคำพูดถูกแยกออกมานับต่างหาก จึงไม่ลากข้อความเล่าเรื่องรอบๆ ติดไปด้วย)
  - `python -m pipeline.chapterlint --book <slug> [--chapter chNN]` — เช็คลิสต์ก่อนตรวจด้วยสายตา: dfn ครั้งแรกพร้อมบริบท, เลนส์ที่ไม่พูดในนามป้ายตัวเอง, object ที่ซ้ำกับ exercise, วลีที่ยัดคำใส่ปากหนังสือ, ตัวเลขที่ไม่มีใน raw, shape ซ้ำ
  - สแกนขอบเขตคำของ dfn ที่มีอยู่แล้ว (ไม่ใช่แค่ที่ห่อใหม่) ด้วย pythainlp — รอบนี้เจอ 4 จุดใน 2 เล่มที่ห่อกลางคำ แก้แล้วและเพิ่ม exclusion ครบ
- ถ้าโควตาเอเจนต์หมดยาว: session หลัก (Opus 5) ทำขั้น fix/verify เองได้ ตามที่ทำกับ ch09/ch10 ของเล่ม 7 — ใช้ _review-chNN.json เป็นรายการงาน แล้วตรวจเชิงกลด้วย pipeline/terms.py + wordcount + สคริปต์หาช่วงคัดลอก (SequenceMatcher ≥60 ตัวอักษรเทียบ raw ยกเว้นพุทธพจน์ใน quote)

## เล่ม 3 จักรวาลควอนตัม เสร็จ (12 ก.ย. 2026)
- ครบ 19 บท `ready` + `_review-chNN.json` ครบทุกบท, push แล้วที่ `5169c50` (ก่อนหน้านั้นค้างที่ `2fae3fb` = ch09)
- เขียนโดย session หลัก (Opus 5) ทั้งหมด เพราะโควตา subagent หมด — reviewer = author ทุกบท ระบุไว้ตรงๆ ในทุก `_review` และมี `openItems` ขอ Opus ตัวที่สองอ่านทวน
- วงจรต่อบทที่ใช้จริง: เขียนสคริปต์ `write_u_chNN.py` ใน scratchpad → `pipeline.terms` → `wordcount --allow ""` → `copyscan` → `chapterlint` → **`validate.mjs` ก่อน commit เสมอ** → `build.js` → `_review` → `set_ready3.py` → commit
- ข้อที่คู่มือเล่ม 3 **ปฏิเสธ** ไว้ตรงๆ (บันทึกไว้กันลืมเวลาทำเล่มอื่นของผู้เขียนคนเดียวกัน):
  - ch17 — "สิ่งที่มีคุณสมบัติคล้ายกันพัวพันกันทางควอนตัมได้ตามนิยามของฟิสิกส์" (entanglement ต้องมีปฏิสัมพันธ์โดยตรง, สลายเร็ว, ส่งข้อมูลไม่ได้)
  - ch18 — "ความพิการแต่กำเนิดมาจากกรรมหนักแทรกแซงสนามรูปพรรณสัณฐาน" (ไม่มีหลักฐาน + วางความผิดบนคนที่ไม่ได้เลือก)
  - ch18 — "ไวรัสโควิด 19 เรียนรู้ร่วมกันผ่านสนามสัณฐาน" (กลายพันธุ์สุ่ม + คัดเลือกอธิบายได้ครบ; เป็นข้อที่ผิดแล้วมีคนป่วยจริง)
  - ch13 — ประโยคใน raw ที่ว่าเพนโรสบอกว่า AI เทียบเท่าสมองมนุษย์ได้ (ขัดจุดยืนที่เขาเป็นที่รู้จัก น่าจะเพี้ยนตอนแปล/OCR)
- ข้อที่ทักแต่ยังเล่าไว้: สถานะ Orch OR (ยังไม่ได้รับการยอมรับ), Panpsychism (ปรัชญา ไม่ใช่ผลการทดลอง), morphic resonance (โรสผู้ร่วมทดลองสรุปตรงข้ามกับเชลเดรก), สมองทำงานคู่ขนานไม่ใช่เรียงทีละอย่าง (ch16), การอ่านโคเปนเฮเกนแบบที่หนังสือเสนอ (ch14)
- ch19 ให้ "แผนที่สี่ชั้น" ปิดเล่ม (ยืนได้เอง / ยังเปิดอยู่ / เทียบเคียงของผู้เขียน / ที่คู่มือปฏิเสธ) — ใช้เป็นแม่แบบบทสรุปของเล่มอื่นได้
- ข้อควรระวังเชิงกลที่เจอรอบนี้: `pipeline.terms` re-sync นิยามศัพท์จาก `glossary.json` ทุกครั้ง → แก้ def ที่ไฟล์บทอย่างเดียวจะถูกเขียนทับ ต้องแก้ `glossary.json` ด้วย; `terms[].kind` รับเฉพาะ `ธรรมะ` / `วิทยาศาสตร์` (ไม่มี `ปรัชญา`)
- เหลือ 88 บท: เล่ม 4 quantum-therapy (20) → 5 quantum-in-living-things (19) → 6 quantum-touch (18) → 8 quantum-cell-to-nibbana-1 (14) → 9 quantum-cell-to-nibbana-2 (17)

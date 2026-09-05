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
- [ ] 1. โครง infra/proxy/pipeline/web/content  ← workflow `quantum-book-phase1` กำลังรัน
- [ ] 2. PDF 9 เล่ม → content/source/
- [ ] 3. extract + clean + split ทั้ง 9 เล่ม → raw/chNN.txt   ← เล่ม 1 เสร็จ (9 บท + คำนำ, แก้คำ 467 จุด); เล่ม 2–9 รอ PDF
- [ ] 4. author ทุกบท (agent เขียน → Opus ตรวจ → แก้) → chNN.json status ready   ← เล่ม 1 บท 1–2 จาก prototype ✓; บท 3–9 workflow `author-book1-ch03-09` กำลังรัน
- [ ] 5. glossary + auto-link + index.json
- [ ] 6. interactives เขียนมือ (บท 1,2,3,4,9 ของเล่ม 1 อย่างน้อย)
- [ ] 7. build static + รัน proxy + ทดสอบ mobile 360/390/768/1280
- [ ] 8. docker compose ทดสอบบนเครื่องนี้
- [ ] 9. รายงานสรุป + checklist ตรวจรับ

## บันทึกการตัดสินใจ
- เนื้อหาบทเขียนด้วย subagent ใน workflow (ไม่ใช่ pipeline/author.py เรียก API) เพราะไม่ต้องใช้ API key แยก
  และตรวจด้วย Opus ได้ในสายเดียว — author.py ยังมีไว้เพื่อรันซ้ำภายหลัง
- python บนเครื่อง 3.9 (spec ว่า 3.11) ใช้ pymupdf แทน pdftotext เพราะไม่มี poppler
- A-02: เจ้าของลิขสิทธิ์อนุมัติแจกจ่ายเนื้อหาเต็มเล่มบน public repo → PDF + raw text commit ได้ (§11 ข้อห้าม #2 ยกเลิก)
- GitHub: repo hermes2545/quantum (public) — push ติด 403 เพราะ keychain credential เป็น user p2544 รอผู้ใช้เพิ่มเป็น collaborator

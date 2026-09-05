# โครงสร้างทีม Agent สำหรับโปรเจกต์นี้

**สั่งโดยผู้ใช้ 5 ก.ย. 2026:** Fable 5.1 = Orchestrator, Opus = Reviewer,
งานอื่นแจกตามโมเดลรองลงมา spawn agent ตามความเหมาะสม

---

## หมายเหตุชื่อโมเดล
ผู้ใช้เขียนว่า "Faber 5.1" — ชื่อจริงคือ **Claude Fable 5.1** (`claude-fable-5-1`)
โมเดลที่เก่งที่สุดของ Anthropic ณ ปัจจุบัน context 1M, output 128K

## ข้อจำกัดที่ต้องรู้
Session หลักของ Claude Code รันบน **Opus 5** และ**สลับโมเดลของ session หลักไม่ได้**
จึงทำ Fable เป็น orchestrator ใน 2 ชั้นแทน:
- **ชั้นนอก (session หลัก, Opus 5)** — คุมทิศทาง คุยกับผู้ใช้ ตัดสินใจขอบเขต
- **ชั้นใน (Workflow, Fable 5.1)** — วางแผน แตกงาน กำหนดสัญญาระหว่างโมดูล
  แล้วส่งต่อให้ implementer

## การแจกงาน

| บทบาท | โมเดล | รับผิดชอบ |
|---|---|---|
| **Orchestrator** | `claude-fable-5-1` | อ่าน spec ทั้งฉบับ → แตกเป็น work package ระดับไฟล์ กำหนด interface ระหว่าง web/proxy/pipeline ให้ชนกันไม่ได้ |
| **Reviewer** | `claude-opus-5` | ตรวจทุก package กับ §5 (mobile 10 ข้อ), §9 (business logic), §11 (ข้อห้าม 9 ข้อ), A-01 |
| **Implementer — proxy** | `claude-sonnet-5` | Node 20 + Hono, SSE, retrieval §9.4, rate limit §9.5, `/api/source` |
| **Implementer — web** | `claude-sonnet-5` | tokens.css §4, component §3, routing §2, SourceFooter (A-01) |
| **Implementer — pipeline** | `claude-sonnet-5` | Python: extract/clean/split/author/terms — งานยากสุดคือ `clean.py` |
| **Implementer — infra/docs** | `claude-haiku-4-5` | docker-compose, Caddyfile, README, .env, gitignore |

**เหตุผลที่ implementer หลักเป็น Sonnet 5 ไม่ใช่ Haiku:** §9.1/§9.4 เป็น business logic
ที่ผิดแล้วพังทั้งระบบ Haiku รับเฉพาะงาน config/boilerplate ที่ตรวจถูก-ผิดได้ทันที

## รูปแบบการรัน
ใช้ **Workflow tool** (deterministic JS orchestration) ไม่ใช่ Agent เดี่ยวๆ เพราะ:
- กำหนดโมเดลต่อ agent ได้ตรงตามตารางข้างบน
- `pipeline()` ให้ implementer เสร็จปุ๊บ reviewer ตรวจปั๊บ ไม่ต้องรอครบทุกตัว
- รัน background ไม่ต้องให้ผู้ใช้ยืนยันทีละขั้น

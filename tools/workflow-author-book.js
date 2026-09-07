// tools/workflow-author-book.js — Claude Code Workflow script: เขียนเนื้อหาบททั้งเล่ม (รูปแบบประหยัด)
//
// ใช้กับเล่ม 2–9 หลัง `python -m pipeline.run --book <slug> --skip-author` สร้าง raw/chNN.txt แล้ว
// เรียก: Workflow({ scriptPath: "tools/workflow-author-book.js", args: { book: "quantum-universe", chapters: [1,2,3,...], titles: {...} } })
//
// รูปแบบประหยัด (บทเรียนจากเล่ม 1 — ลูป Opus high ×3 รอบกิน ~4M token):
//   Author (Sonnet)  → Review (Opus, effort medium, เขียน _review-chNN.json)
//   → Fix 1 รอบ (Sonnet, เฉพาะ blocker/major) → Verify (Opus medium, ตรวจเฉพาะรายการ + blocker ใหม่)
//   → ไม่มี rewrite escalation; บทที่ยังไม่ผ่านคง draft ให้คนตัดสิน
// ทุกขั้นรัน normalize/validate เองเพื่อไม่ต้องจ้าง agent ตรวจ schema

export const meta = {
  name: 'author-book',
  description: 'เขียนบททั้งเล่มแบบประหยัด: Sonnet เขียน → Opus ตรวจ (medium) → แก้ 1 รอบ → Opus ยืนยัน → mark ready',
  phases: [
    { title: 'Author', detail: 'Sonnet 5 เขียนจาก raw + ต้นแบบเล่ม 1' },
    { title: 'Review', detail: 'Opus 5 effort medium — §9.1 ทั้ง 11 ข้อ + ห้ามคัดลอก' },
    { title: 'Fix', detail: 'Sonnet แก้ blocker/major 1 รอบ → Opus ยืนยัน' },
    { title: 'Finalize', detail: 'mark ready + normalize/validate/build (Haiku)' },
  ],
}

const ROOT = '/Users/piriya/quantum'
const BOOK = args.book
const DIR = `${ROOT}/content/books/${BOOK}`
const CHAPTERS = args.chapters // [{ n, thai, title }]
const pad = (n) => String(n).padStart(2, '0')

const COMMON = `
โปรเจกต์: แพลตฟอร์มเรียนรู้หนังสือชุดธรรมะ-ควอนตัม โดย สิรวิชญ์ รัตน์จินดา — เล่มนี้ slug "${BOOK}" (${args.bookTitle || BOOK})
อ่านก่อน: ${ROOT}/docs/handoff-spec.md §9.1 (11 ข้อ) §9.2 §10 · ต้นแบบคุณภาพ ${ROOT}/content/books/trilaksana-quantum/ch01.json และ ch03.json
· ${DIR}/book.json (coreIdeas ของเล่มนี้ = แนวคิดหลักที่ทุก section ต้องโยงกลับ แทน "ไตรลักษณ์" ของเล่ม 1) · ${DIR}/raw/chNN.txt (ต้นฉบับ อาจมี OCR artifact)
· glossary รวมทุกเล่ม: ถ้าคำมีใน ${ROOT}/content/books/trilaksana-quantum/glossary.json แล้ว ใช้ term/def เดิม (ใส่ใน terms[] ของบทได้ แต่เพิ่ม books ให้มี "${BOOK}")
· ${DIR}/raw/ch00-preface.txt = คำนำผู้เขียน (อ่านครั้งเดียวเพื่อจับเจตนาของเล่ม) · ${DIR}/raw/_toc.json บอกว่าบทเรียนนี้รวมบทต้นฉบับไหน (field source) และช่วงหน้า PDF
· ถ้า raw ของบทสั้น (<3,000 ตัวอักษร) ให้เขียนใกล้ขั้นต่ำ 900 คำ — ห้ามเติมเนื้อหาที่หนังสือไม่ได้พูดถึงเพื่อให้ยาวขึ้น (§9.1 ข้อ 6 ห้ามแต่งข้อเท็จจริง)
· ไฟล์ ${DIR}/chNN.json ที่มีอยู่เป็น stub status "building" (มีแค่ meta) — เขียนทับทั้งไฟล์ได้เลย แต่คง book/slug/order/thaiNum/title ตามเดิม

กับดัก 4 ข้อที่ทำให้เล่มนำร่อง (quantum-merit-power) มี finding 86 จุด — ตรวจตัวเองก่อนส่งงานทุกครั้ง:
1. §9.1 ข้อ 6 ห้ามใส่คำที่หนังสือไม่ได้พูดลงในปากพุทธพจน์ — โดยเฉพาะเรื่อง "น้ำหนัก" ของกรรม ถ้า raw บอกแค่ว่า "นับรวมอยู่ในชุดเดียวกัน" ห้ามเขียนว่า "หนักเท่ากัน" · ห้ามอ้างการทดลอง/ตัวเลข/ชื่อธาตุ/บทบาท ที่ raw ไม่ได้ระบุ
2. §9.1 ข้อ 3 ศัพท์ทุกคำ (ทั้งธรรมะและวิทยาศาสตร์) ต้องมีคำขยายในประโยคเดียวกันหรือประโยคถัดไป "ครั้งแรกที่ปรากฏในบท" แม้จะมีใน glossary แล้ว — คำที่พลาดบ่อย: อบาย ทุคติ วินิบาต สุคติ คนพาล บัณฑิต วิถีจิต ภพ สถานะบริสุทธิ์/ผสม
3. §9.1 ข้อ 7 กลไกที่วิทยาศาสตร์ยังไม่ยุติ (สมองควอนตัม จิตไม่อิงระยะทาง) ต้องมีตัวบ่งสถานะอย่างน้อยหนึ่งจุดต่อบท เช่น "ในกรอบที่หนังสือเสนอไว้" — และต้องมีในข้อความของ interactive/exercise ด้วย ไม่ใช่แค่เนื้อบท
4. interactive: เลนส์แต่ละอันต้องพูดในนามแนวคิดที่ป้ายของมันบอก (เลนส์ a = แนวคิดหลักข้อ 1 ของเล่ม) ทุกชิ้น ไม่ใช่แค่บางชิ้น · และ objects ของ interactive ต้อง "ไม่ซ้ำ" สถานการณ์กับ exercise.options

ห้ามห่อ <dfn> ด้วยมือ — เขียนเนื้อความให้เสร็จก่อน แล้วรัน `cd ${ROOT} && .venv/bin/python -m pipeline.terms --book ${BOOK} --report` ซึ่งจะห่อครั้งแรกของทุกศัพท์ในทุก section ให้เอง (idempotent) แล้วค่อย normalize/validate
ถ้ารายงานมี ⚠ ว่าตัวตัดคำติดกับคำข้างเคียง ให้เปิดดูจุดนั้น ถ้าห่อผิด (ศัพท์สั้นไปแอบในคำยาว) ให้เพิ่มลง pipeline/fixtures/term_exclusions.json แล้วรันใหม่

ธรรมเนียมที่ล็อกแล้ว: slug = "chNN" · <dfn data-term="X" data-kind="ธรรมะ|วิทยาศาสตร์"> ห่อครั้งแรกต่อ section · paragraphs ใช้ได้เฉพาะ <b> <i> <dfn>
· interactive.module = "particles" พร้อม config.objects 4–5 ชิ้น {key,name,color(gold|teal|pink|star|mint),shape,lenses:{a,d,n}} + lensLabels/phases/initialT/timeLabel/emptyReadout (ดูแบบจาก trilaksana-quantum/ch05.json) — เล่มนี้ยังไม่มี interactive เขียนมือ
· status เริ่มที่ "draft" เสมอ · ความยาว 900–1,400 คำ วัดด้วย: cd ${ROOT} && .venv/bin/python -m pipeline.wordcount ${DIR}/chNN.json
เครื่องมือตรวจ (รันเองก่อนจบทุกครั้ง): cd ${ROOT} && node content/schema/normalize.mjs ${BOOK} && node content/schema/validate.mjs
`

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_fix'] },
    wordCount: { type: 'number' },
    copiedSpans: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          where: { type: 'string' }, problem: { type: 'string' }, fix: { type: 'string' },
        },
        required: ['rule', 'severity', 'where', 'problem', 'fix'],
      },
    },
  },
  required: ['verdict', 'wordCount', 'copiedSpans', 'findings'],
}
const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_fix'] },
    unresolved: { type: 'array', items: { type: 'string' } },
    newBlockers: { type: 'array', items: { type: 'string' } },
    wordCount: { type: 'number' },
  },
  required: ['verdict', 'unresolved', 'newBlockers', 'wordCount'],
}

const results = await pipeline(
  CHAPTERS,
  async (ch) => {
    const f = `ch${pad(ch.n)}`
    const a = await agent(
      `เขียนบทที่ ${ch.n} "${ch.title}" ของเล่ม ${BOOK} → ${DIR}/${f}.json (slug "${f}", order ${ch.n}, thaiNum "${ch.thai}", status "draft")
${COMMON}
ขั้นตอน: อ่าน raw/${f}.txt จนเข้าใจว่าบทนี้ต้องการให้คน "เห็น" อะไร → อ่าน ch01.json/ch03.json ของเล่ม 1 เป็นบรรทัดฐานสำเนียง/โครง → เขียนด้วยคำของคุณเอง (ห้ามลอกประโยคจาก raw ยกเว้นพุทธพจน์ที่ใส่ใน quote ให้ตรงตัวอักษร) → ทวนกับดัก 4 ข้อข้างบนทีละข้อ → รัน terms.py + wordcount + normalize + validate จนผ่าน
รายงานสั้นๆ: sections, คำ, term ใหม่, จุดที่ raw คลุมเครือ`,
      { model: 'sonnet', phase: 'Author', label: `author:${BOOK}/${f}` }
    )
    if (!a) return { ch, status: 'author_failed' }

    let review = await agent(
      `ตรวจบทที่ ${ch.n} — ${DIR}/${f}.json เทียบ raw/${f}.txt และบรรทัดฐาน trilaksana-quantum/ch01.json
${COMMON}
ตรวจ §9.1 ทั้ง 11 ข้อ (ข้อ 1 เทียบ raw หา span >12 คำ), §10 schema, §9.2 dfn, ข้อเท็จจริง (ตัวเลข/พุทธพจน์/สมมติฐาน), คุณภาพ "เห็น" ไม่ใช่ "รู้"
verdict = pass เฉพาะเมื่อไม่มี blocker และ major · เขียนผลลง ${DIR}/_review-${f}.json ด้วย`,
      { model: 'opus', effort: 'medium', phase: 'Review', label: `review:${BOOK}/${f}`, schema: REVIEW_SCHEMA }
    )
    if (!review) return { ch, status: 'review_failed' }

    if (review.verdict !== 'pass') {
      const fixed = await agent(
        `แก้บทที่ ${ch.n} — ${DIR}/${f}.json ตาม ${DIR}/_review-${f}.json แก้ทุก blocker/major (minor เฉพาะที่ไม่เพิ่มความยาว)
${COMMON}
${review.copiedSpans.length ? 'ข้อความที่ถูกชี้ว่าคัดลอก (เขียนใหม่ทั้งหมด):\n' + review.copiedSpans.map((s) => ' - ' + s).join('\n') : ''}
รัน terms.py + wordcount + normalize + validate ให้ผ่าน คง status "draft"`,
        { model: 'sonnet', phase: 'Fix', label: `fix:${BOOK}/${f}` }
      )
      if (fixed) {
        const v = await agent(
          `ตรวจซ้ำแบบเจาะจงบทที่ ${ch.n} — ${DIR}/${f}.json: ทุก blocker/major ใน _review-${f}.json ถูกแก้จริงไหม (เปิดไฟล์ดู) และมี blocker ใหม่ไหม (คัดลอก >12 คำ, ข้อเท็จจริงผิดใหม่, พุทธพจน์แต่งเอง, schema) · คำ 900–1,400
${COMMON}
อัปเดต _review-${f}.json เป็นผลรอบนี้ ("round":"post-fix")`,
          { model: 'opus', effort: 'medium', phase: 'Fix', label: `verify:${BOOK}/${f}`, schema: VERDICT }
        )
        review = v ? { verdict: v.verdict, findings: [...v.unresolved, ...v.newBlockers].map((p) => ({ problem: p })), wordCount: v.wordCount } : review
      }
    }
    return { ch, status: review.verdict === 'pass' ? 'pass' : 'needs_fix', words: review.wordCount, open: review.findings.length }
  }
)

const done = results.filter(Boolean)
const passed = done.filter((r) => r.status === 'pass').map((r) => 'ch' + pad(r.ch.n))
log(`${BOOK}: ผ่าน ${passed.length}/${CHAPTERS.length}`)

phase('Finalize')
const fin = await agent(
  `งานเชิงกลใน ${DIR}: บทที่ผ่าน = ${passed.join(', ') || '(ไม่มี)'} → ตั้ง "status":"ready","reviewedBy":"opus-5-agent","reviewedAt":"${args.date || '2026-09-06'}" ในไฟล์เหล่านั้น (ห้ามแตะ field อื่น)
แล้ว cd ${ROOT} && node content/schema/normalize.mjs ${BOOK} && node content/schema/validate.mjs && node web/build.js ต้องผ่าน · ตอบสั้นๆ`,
  { model: 'haiku', phase: 'Finalize', label: `finalize:${BOOK}` }
)

return { book: BOOK, passed, chapters: done.map((r) => ({ ch: r.ch.n, status: r.status, words: r.words, open: r.open })), finalize: fin ? fin.slice(0, 300) : null }

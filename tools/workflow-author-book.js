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
ขั้นตอน: อ่าน raw/${f}.txt จนเข้าใจว่าบทนี้ต้องการให้คน "เห็น" อะไร → อ่าน ch01.json/ch03.json ของเล่ม 1 เป็นบรรทัดฐานสำเนียง/โครง → เขียนด้วยคำของคุณเอง (ห้ามลอกประโยคจาก raw ยกเว้นพุทธพจน์ที่ใส่ใน quote ให้ตรงตัวอักษร) → รัน wordcount + normalize + validate จนผ่าน
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
รัน wordcount + normalize + validate ให้ผ่าน คง status "draft"`,
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

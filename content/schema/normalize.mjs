#!/usr/bin/env node
// content/schema/normalize.mjs — ปรับ chNN.json ให้ตรงสัญญาระหว่างโมดูลก่อน validate/build
//
// ทำไมต้องมี: เนื้อหาบทมาจากหลายทาง (prototype, agent เขียน, pipeline/author.py) ซึ่งใช้
// ธรรมเนียมต่างกัน แต่ validate.mjs/build.js/TermSheet ยึดสัญญาเดียว:
//   1. chapter.slug = ชื่อไฟล์ (chNN) — ตรงกับ book.json.chapters[].slug และโฟลเดอร์ interactives
//   2. <dfn data-term="X"> ต้องมี data-kind="ธรรมะ|วิทยาศาสตร์" (TermSheet ใช้ลงสีโดยไม่ต้อง lookup)
//   3. interactive.module เป็น "particles" หรือ "{bookSlug}/chNN" ถ้ามี web/src/js/interactives/{bookSlug}/chNN.js
//   4. terms[] ทุกตัวมี alt (ว่างได้) และ books[]
//   5. book.json.chapters[] status/title/sub ตรงกับ chNN.json (สถานะเก็บสองที่ตาม §10 ต้องตรงกัน)
//
// ใช้: node content/schema/normalize.mjs [bookSlug ...]   (ไม่ระบุ = ทุกเล่มใน content/books)
// idempotent — รันซ้ำได้ ผลเท่าเดิม; รายงานคำที่หา kind ไม่ได้ (ต้องเพิ่มใน glossary ก่อน) แล้ว exit 1

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BOOKS_DIR = join(ROOT, 'content', 'books');
const IX_DIR = join(ROOT, 'web', 'src', 'js', 'interactives');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', 'utf8');

const DFN_RE = /<dfn\s+data-term="([^"]*)"(?:\s+data-kind="[^"]*")?\s*>/g;

function normalizeBook(bookSlug) {
  const dir = join(BOOKS_DIR, bookSlug);
  const bookPath = join(dir, 'book.json');
  if (!existsSync(bookPath)) return { bookSlug, skipped: 'ไม่มี book.json' };

  const book = readJson(bookPath);
  const glossaryPath = join(dir, 'glossary.json');
  const glossary = existsSync(glossaryPath) ? readJson(glossaryPath) : [];
  const kindOf = new Map(glossary.map((t) => [t.term, t.kind]));

  const chapterFiles = readdirSync(dir).filter((f) => /^ch\d{2}\.json$/.test(f)).sort();
  const unknown = new Map(); // term -> [chNN...]
  const changes = [];

  for (const file of chapterFiles) {
    const slug = basename(file, '.json');
    const p = join(dir, file);
    const ch = readJson(p);
    const before = JSON.stringify(ch);

    // 1. slug = ชื่อไฟล์
    if (ch.slug !== slug) { changes.push(`${slug}: slug "${ch.slug}" → "${slug}"`); ch.slug = slug; }

    // 4. terms[] ครบ field และเติม kind ให้ lookup ได้ (terms ในบทมีสิทธิ์เหนือ glossary เพราะใหม่กว่า)
    for (const t of ch.terms ?? []) {
      if (t.alt === undefined) t.alt = '';
      if (!Array.isArray(t.books) || !t.books.length) t.books = [bookSlug];
      if (t.term && t.kind && !kindOf.has(t.term)) kindOf.set(t.term, t.kind);
    }

    // 2. เติม data-kind ให้ทุก <dfn> ในทุก string ที่มี markup
    const fixDfn = (s) =>
      typeof s !== 'string'
        ? s
        : s.replace(DFN_RE, (m, term) => {
            const kind = kindOf.get(term);
            if (!kind) { if (!unknown.has(term)) unknown.set(term, new Set()); unknown.get(term).add(slug); return m; }
            return `<dfn data-term="${term}" data-kind="${kind}">`;
          });
    for (const sec of ch.sections ?? []) {
      sec.paragraphs = (sec.paragraphs ?? []).map(fixDfn);
      if (sec.bullets) sec.bullets = sec.bullets.map(fixDfn);
      if (sec.callout?.text) sec.callout.text = fixDfn(sec.callout.text);
    }
    if (ch.interactive?.intro) ch.interactive.intro = fixDfn(ch.interactive.intro);
    if (ch.exercise?.intro) ch.exercise.intro = fixDfn(ch.exercise.intro);

    // 3. interactive.module ตาม convention ของ loader
    if (ch.interactive) {
      const custom = join(IX_DIR, bookSlug, `${slug}.js`);
      const want = existsSync(custom) ? `${bookSlug}/${slug}` : 'particles';
      if (ch.interactive.module !== want) {
        changes.push(`${slug}: interactive.module "${ch.interactive.module}" → "${want}"`);
        if (ch.interactive.module !== 'particles' && !/\/ch\d{2}$/.test(ch.interactive.module)) {
          // เก็บชื่อเดิมไว้ให้คนเขียน JS รู้ว่าบทนี้อยากได้ interactive แบบไหน
          ch.interactive.config = { ...(ch.interactive.config ?? {}), requestedModule: ch.interactive.module };
        }
        ch.interactive.module = want;
      }
    }

    if (JSON.stringify(ch) !== before) writeJson(p, ch);

    // 5. sync book.json
    const meta = book.chapters?.find((c) => c.slug === slug);
    if (meta) {
      for (const k of ['status', 'title', 'sub', 'thaiNum', 'order']) {
        if (ch[k] !== undefined && meta[k] !== ch[k]) { changes.push(`${slug}: book.json.${k} "${meta[k]}" → "${ch[k]}"`); meta[k] = ch[k]; }
      }
    }
  }

  // book.sourcePdf.bytes ให้ตรงไฟล์จริงถ้ามี (Content-Length ผิด → Safari โหลด PDF ไม่จบ)
  if (book.sourcePdf?.file) {
    const pdf = join(ROOT, 'content', 'source', book.sourcePdf.file);
    if (existsSync(pdf)) {
      const bytes = statSync(pdf).size;
      if (book.sourcePdf.bytes !== bytes) { changes.push(`book.json: sourcePdf.bytes ${book.sourcePdf.bytes} → ${bytes} (จากไฟล์จริง)`); book.sourcePdf.bytes = bytes; }
    }
  }
  writeJson(bookPath, book);

  return { bookSlug, chapters: chapterFiles.length, changes, unknown: [...unknown].map(([t, s]) => `${t} (${[...s].join(',')})`) };
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(BOOKS_DIR).filter((d) => statSync(join(BOOKS_DIR, d)).isDirectory());
let fail = false;
for (const slug of targets) {
  const r = normalizeBook(slug);
  console.log(`\n[normalize] ${slug}${r.skipped ? ' — ' + r.skipped : ` — ${r.chapters} บท, แก้ ${r.changes.length} จุด`}`);
  for (const c of r.changes ?? []) console.log('  •', c);
  if (r.unknown?.length) {
    fail = true;
    console.log(`  ✗ <dfn> ที่ไม่มีใน glossary/terms (${r.unknown.length}) — เพิ่มใน glossary.json ก่อน:`);
    for (const u of r.unknown) console.log('     -', u);
  }
}
process.exit(fail ? 1 : 0);

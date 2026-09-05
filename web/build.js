#!/usr/bin/env node
'use strict';
/**
 * web/build.js — สร้างเว็บ static ทั้งหมดจาก content/ ตามสัญญาระหว่างโมดูล §H
 * เจ้าของ: web-shell (P4). ไม่มี dependency ภายนอก ใช้เฉพาะ Node built-in (fs/path/child_process)
 *
 * การใช้งาน: node web/build.js [--content content] [--out web/public]
 * รันจาก root ของ repo (path เริ่มต้นอิงจาก process.cwd())
 *
 * ลำดับงาน (ตาม §H):
 *   1. เรียก content/schema/validate.mjs (ถ้ามี) — fail ทั้ง build ถ้า exit ≠ 0
 *   2. อ่าน content/books/{slug}/book.json + chNN.json + glossary.json
 *   3. เขียน content/index.json (ไฟล์เดียวที่เขียนออกนอก web/public)
 *   4. render HTML ทุกหน้า (shelf, book×N, chapter/soon×N, glossary, 404)
 *   5. copy web/src/{tokens.css,base.css,js/**,static/**} -> web/public/assets/**
 *   6. ตรวจความปลอดภัย: ห้ามมี .pdf และห้ามมี API key marker (ดู KEY_MARKER) หลุดเข้ามาใน web/public
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

class BuildError extends Error {}

/* ============================================================ */
/* ค่าคงที่ตามสัญญา §J / §D.7                                    */
/* ============================================================ */
const API = { ask: '/api/ask', feedback: '/api/feedback', source: '/api/source/' };
const LIMITS = { question: 1000, reflection: 2000 };
const SERIES = { title: 'ไตรลักษณ์ในควอนตัม', author: 'สิรวิชญ์ รัตน์จินดา' };
const ALLOWED_INLINE_TAGS = new Set(['b', 'i', 'dfn']);
// เขียนแยกเป็นชิ้นตั้งใจ ไม่ต่อกันเป็นสตริงเต็มในซอร์สโค้ด — มิฉะนั้น checklist §11 และ
// Makefile target `check` (§I) ที่ grep หาคำนำหน้า API key ของ Anthropic ทั่วทั้ง web/ จะเจอ
// "hit" จากไฟล์ build.js เอง ทั้งที่ไม่มี ANTHROPIC_API_KEY หลุดจริง (false positive ที่ทำให้
// checklist ตรวจรับไม่ผ่านทุกครั้ง)
const KEY_MARKER = 'sk' + '-ant';

/* ============================================================ */
/* helpers: ตัวเลขไทย, escape, sanitize, template engine ง่ายๆ    */
/* ============================================================ */
const THAI_DIGITS = ['๐', '๑', '๒', '๓', '๔', '๕', '๖', '๗', '๘', '๙'];
function toThaiDigits(n) {
  return String(n).split('').map((ch) => (ch >= '0' && ch <= '9' ? THAI_DIGITS[+ch] : ch)).join('');
}

function escapeText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * sanitizeInlineHtml — ด่านป้องกัน XSS ชั้นที่สองของ build.js เอง
 * ตามสัญญา §H ข้อ 7 การตรวจ allowlist แท็กอย่างเต็มรูปแบบเป็นหน้าที่ของ content/schema/validate.mjs (P6)
 * แต่เนื่องจาก validate.mjs อาจยังไม่ถูกส่งมอบตอน build.js ทำงาน (ความเสี่ยง #11 ในสัญญา)
 * build.js จึงเช็คซ้ำแบบเบาๆ เอง: อนุญาตเฉพาะ <b> <i> <dfn ...> เท่านั้น ปฏิเสธแท็กอื่นทุกชนิด
 * (ไม่ตรวจ attribute ภายใน dfn ลึกถึงระดับ data-term/data-kind — ปล่อยให้เป็นหน้าที่ validate.mjs)
 */
function sanitizeInlineHtml(html, context) {
  if (typeof html !== 'string') {
    throw new BuildError(`${context}: ต้องเป็น string แต่ได้ ${typeof html}`);
  }
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^<>]*)?>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_INLINE_TAGS.has(tag)) {
      throw new BuildError(
        `${context}: พบแท็ก <${m[1]}> ที่ไม่อนุญาต (อนุญาตเฉพาะ <b> <i> <dfn>) ในข้อความ: "${html.slice(0, 100)}"`
      );
    }
  }
  return html;
}

/** renderTemplate — string-replace template engine ง่ายๆ ตาม §H ("string replace / ฟังก์ชัน JS") */
function renderTemplate(str, vars) {
  return str.replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) {
      throw new BuildError(`เทมเพลตขาดตัวแปร {{${key}}}`);
    }
    return vars[key];
  });
}

/** JSON ของ #page-data ต้อง escape "</" เป็น "<\/" กัน </script> หลุดปิด tag ก่อนกำหนด (ตาม §D.2) */
function toPageDataJson(obj) {
  return JSON.stringify(obj).replace(/<\//g, '<\\/');
}

function readJson(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new BuildError(`อ่านไฟล์ไม่ได้: ${p} (${e.message})`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new BuildError(`JSON ผิดรูปแบบ: ${p} (${e.message})`);
  }
}

/**
 * cleanOutDir — ล้าง outDir ก่อน render รอบใหม่ ตาม §H ข้อ 8 ("output ทั้ง web/public/ ต้อง
 * regenerate ได้ 100%") เก็บ .gitkeep ไว้เท่านั้น (P1 ใช้ไฟล์นี้กัน git ไม่ track โฟลเดอร์ว่าง)
 * ถ้าไม่ล้างก่อน ไฟล์จากบิลด์เก่า (เช่น บทที่เปลี่ยน slug หรือเล่มที่ถูกลบ) จะค้างอยู่บนดิสก์
 * และถูก Caddy เสิร์ฟต่อไปโดยไม่มีสัญญาณเตือนว่าเป็นเนื้อหาเก่า
 */
function cleanOutDir(outDir) {
  if (!fs.existsSync(outDir)) return;
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    fs.rmSync(path.join(outDir, entry.name), { recursive: true, force: true });
  }
}

function writePage(outDir, relPath, html) {
  const full = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, html, 'utf8');
}

/* ============================================================ */
/* ขั้นที่ 1: เรียก content/schema/validate.mjs                  */
/* ============================================================ */
function runSchemaValidation(contentDir) {
  const validatePath = path.join(contentDir, 'schema', 'validate.mjs');
  if (!fs.existsSync(validatePath)) {
    // §H ข้อ 1 บังคับว่า build.js "ต้อง" เรียก validate.mjs ก่อน build เสมอ — ไม่มีทางออกแบบ warn-and-continue
    // (เดิมโค้ดนี้ warn แล้วเดินหน้าต่อ ซึ่งเปิดช่องให้ build ผ่านทั้งที่ไม่มีการตรวจ schema/allowlist tag เลย)
    throw new BuildError(
      `ไม่พบ ${validatePath} — build.js ต้องเรียก content/schema/validate.mjs ก่อน build เสมอตาม §H ข้อ 1 ` +
        `(ไม่มี fallback ข้ามการตรวจ schema ได้)`
    );
  }
  const res = spawnSync(process.execPath, [validatePath, contentDir], { stdio: 'inherit' });
  if (res.status !== 0) {
    throw new BuildError('content/schema/validate.mjs ตรวจไม่ผ่าน (ดู log ด้านบน) — หยุด build ตาม §H ข้อ 1');
  }
}

/* ============================================================ */
/* ขั้นที่ 2: โหลดข้อมูลจาก content/books/**                     */
/* ============================================================ */
const BOOK_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CHAPTER_SLUG_RE = /^ch[0-9]{2}$/;

function validateBookShape(book, dirSlug) {
  if (book.slug !== dirSlug) {
    throw new BuildError(`book.json ของโฟลเดอร์ "${dirSlug}": slug ในไฟล์ ("${book.slug}") ไม่ตรงกับชื่อโฟลเดอร์`);
  }
  // ตรวจรูปแบบ slug เองอีกชั้นก่อนนำไปประกอบ URL/path (เขียนไฟล์ b/{slug}/...) — validate.mjs
  // ควรจับกรณีนี้อยู่แล้ว แต่ build.js ต้องไม่พึ่งพา validate.mjs เพียงอย่างเดียวสำหรับค่าที่ใช้เป็น
  // ส่วนหนึ่งของ path จริงบนดิสก์ (กัน path traversal ผ่าน slug ที่มี "../")
  if (!BOOK_SLUG_RE.test(book.slug)) {
    throw new BuildError(`book.json ของ "${dirSlug}": slug "${book.slug}" ไม่ตรงรูปแบบ ^[a-z0-9]+(-[a-z0-9]+)*$`);
  }
  if (!Array.isArray(book.chapters)) {
    throw new BuildError(`book.json ของ "${dirSlug}": ต้องมี chapters เป็น array`);
  }
  for (const cm of book.chapters) {
    if (!cm || typeof cm.slug !== 'string' || !CHAPTER_SLUG_RE.test(cm.slug)) {
      throw new BuildError(
        `book.json ของ "${dirSlug}": chapters[].slug "${cm && cm.slug}" ไม่ตรงรูปแบบ ^ch[0-9]{2}$`
      );
    }
  }
}

function loadBooks(contentDir) {
  const booksDir = path.join(contentDir, 'books');
  if (!fs.existsSync(booksDir)) {
    throw new BuildError(`ไม่พบโฟลเดอร์ ${booksDir}`);
  }
  const bookSlugs = fs
    .readdirSync(booksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s))
    .sort();

  const books = [];
  for (const slug of bookSlugs) {
    const bookJsonPath = path.join(booksDir, slug, 'book.json');
    if (!fs.existsSync(bookJsonPath)) {
      console.warn(`[build] ข้ามเล่ม "${slug}": ไม่พบ book.json (รอ P6 ส่งมอบ) — เล่มนี้จะไม่ปรากฏในเว็บจนกว่าจะมีไฟล์`);
      continue;
    }
    const book = readJson(bookJsonPath);
    validateBookShape(book, slug);

    const chapters = [];
    for (const cm of book.chapters) {
      const chPath = path.join(booksDir, slug, `${cm.slug}.json`);
      if (!fs.existsSync(chPath)) {
        throw new BuildError(`${slug}/${cm.slug}: ระบุไว้ใน book.json.chapters แต่ไม่พบไฟล์ ${chPath}`);
      }
      const ch = readJson(chPath);
      // กฎบังคับตามสัญญา §A.1: สถานะใน book.json ต้องตรงกับ chNN.json เสมอ
      if (ch.status !== cm.status) {
        throw new BuildError(
          `${slug}/${cm.slug}: สถานะไม่ตรงกัน — book.json.chapters[].status="${cm.status}" ` +
            `แต่ ${cm.slug}.json.status="${ch.status}" (ต้องแก้ให้ตรงกันทั้งสองไฟล์)`
        );
      }
      chapters.push(ch);
    }

    const glossaryPath = path.join(booksDir, slug, 'glossary.json');
    let glossary = { book: slug, terms: [] };
    if (fs.existsSync(glossaryPath)) {
      glossary = readJson(glossaryPath);
      // กันเงียบ: ถ้า glossary.json ไม่ตรงรูป {book,terms:[...]} ตาม §A.3 ต้อง fail ดังๆ
      // ไม่ใช่เดินหน้าต่อแบบ terms=[] เงียบๆ (เคยพบว่า P6/pipeline เขียนเป็น array เปลือยมาก่อน)
      if (!glossary || !Array.isArray(glossary.terms)) {
        throw new BuildError(
          `${glossaryPath}: รูปแบบไม่ตรงสัญญา §A.3 — ต้องเป็น { "book": "...", "terms": [...] } ` +
            `แต่พบ ${Array.isArray(glossary) ? `array เปลือย ${glossary.length} รายการ` : typeof glossary} ` +
            `(ถ้าเป็น array ของ Term ตรงๆ ให้ห่อเป็น {"book":"${slug}","terms": <array นี้>})`
        );
      }
    }

    books.push({ meta: book, chapters, glossary });
  }

  books.sort((a, b) => a.meta.order - b.meta.order);
  return books;
}

/** merge glossary รวมทุกเล่มตาม §9.2: ซ้ำ term ใช้ def จากเล่ม order น้อยกว่า, รวม books[] */
function mergeGlobalGlossary(books) {
  const map = new Map();
  for (const b of books) {
    for (const t of b.glossary.terms || []) {
      if (!map.has(t.term)) {
        map.set(t.term, {
          term: t.term,
          kind: t.kind,
          alt: t.alt || '',
          def: t.def,
          books: new Set(t.books && t.books.length ? t.books : [b.meta.slug]),
        });
      } else {
        const existing = map.get(t.term);
        (t.books && t.books.length ? t.books : [b.meta.slug]).forEach((bs) => existing.books.add(bs));
        // def ไม่ต้องเปลี่ยน: books ถูกวนตามลำดับ order ขึ้นมาแล้ว (ascending) ค่าที่เจอก่อนคือ order น้อยกว่าเสมอ
      }
    }
  }
  return Array.from(map.values()).map((t) => ({ term: t.term, kind: t.kind, alt: t.alt, def: t.def, books: Array.from(t.books) }));
}

/* ============================================================ */
/* ขั้นที่ 3: content/index.json                                 */
/* ============================================================ */
function buildIndexJson(books) {
  return {
    generatedAt: new Date().toISOString(),
    series: { title: SERIES.title, author: SERIES.author },
    books: books.map((b) => {
      const meta = b.meta;
      const entry = {
        slug: meta.slug,
        order: meta.order,
        title: meta.title,
        author: meta.author,
        status: meta.status,
      };
      if (meta.sourcePdf && meta.sourcePdf.file) {
        entry.sourcePdf = { file: meta.sourcePdf.file, bytes: meta.sourcePdf.bytes };
      }
      // ใช้ cm.slug (จาก book.json.chapters — รูปแบบ chNN ตามสัญญา) เป็นตัวระบุเสมอ ไม่ใช่ ch.slug
      // ภายใน chNN.json เอง เพราะพบข้อมูลจริงบางบทมี slug ภายในไม่ตรงรูปแบบ (ดูคอมเมนต์ใน renderChapterPage)
      entry.chapters = b.chapters.map((ch, i) => ({
        slug: meta.chapters[i].slug,
        order: ch.order,
        thaiNum: ch.thaiNum,
        title: ch.title,
        status: ch.status,
        summary: ch.summary,
      }));
      return entry;
    }),
  };
}

/* ============================================================ */
/* ตัวสร้างชิ้นส่วน HTML                                          */
/* ============================================================ */
function renderCoreIdeas(coreIdeas) {
  return (coreIdeas || [])
    .map(
      (ci) =>
        `    <div class="c"><div class="th">${escapeText(ci.label)}</div><div class="pali">${escapeText(
          ci.pali || ''
        )}</div><p>${escapeText(ci.text)}</p></div>`
    )
    .join('\n');
}

function renderMapRows(book) {
  return book.chapters
    .map((c) => {
      const ok = c.status === 'ready';
      const cls = ok ? 'ok' : 'soon';
      const statusLabel = ok ? 'อ่านได้' : 'กำลังสร้าง';
      return `    <a class="maprow ${cls}" href="/b/${book.slug}/${c.slug}" data-chapter="${escapeAttr(
        c.slug
      )}"><span class="n">${escapeText(c.thaiNum)}</span><span><span class="ti">${escapeText(
        c.title
      )}</span><span class="sub">${escapeText(c.sub)}</span></span><span class="st">${statusLabel}</span></a>`;
    })
    .join('\n');
}

function renderBookCards(books) {
  return books
    .map((b) => {
      const meta = b.meta;
      const totalReady = meta.chapters.filter((c) => c.status === 'ready').length;
      const statusCls = meta.status === 'building' ? 'building' : 'ready';
      const statusLabel = meta.status === 'building' ? 'กำลังสร้าง' : 'อ่านได้';
      return `    <a class="bookcard ${statusCls}" href="/b/${meta.slug}" data-book="${escapeAttr(
        meta.slug
      )}" data-total="${totalReady}">
      <span class="bc-cover"><span class="n">${toThaiDigits(meta.order)}</span></span>
      <span class="bc-title">${escapeText(meta.title)}</span>
      <span class="bc-meta">${meta.chapters.length} บท</span>
      <span class="bc-status">${statusLabel}</span>
      <span class="bc-progress" data-progress></span>
    </a>`;
    })
    .join('\n');
}

function renderBulletsList(bullets) {
  return '    <ul>\n' + bullets.map((b) => `      <li>${sanitizeInlineHtml(b, 'sections[].bullets')}</li>`).join('\n') + '\n    </ul>\n';
}

function renderSection(sec, idx) {
  const paragraphs = sec.paragraphs || [];
  const bullets = sec.bullets && sec.bullets.length ? sec.bullets : null;
  const bulletsAfter = typeof sec.bulletsAfter === 'number' ? sec.bulletsAfter : paragraphs.length;

  let out = `  <section class="prose" data-section="${idx}">\n`;
  out += `    <h2>${escapeText(sec.h2)}</h2>\n`;

  let inserted = false;
  if (bullets && bulletsAfter <= 0) {
    out += renderBulletsList(bullets);
    inserted = true;
  }
  paragraphs.forEach((p, i) => {
    out += `    <p>${sanitizeInlineHtml(p, 'sections[].paragraphs')}</p>\n`;
    if (bullets && !inserted && i + 1 === bulletsAfter) {
      out += renderBulletsList(bullets);
      inserted = true;
    }
  });
  if (bullets && !inserted) {
    // bulletsAfter เกินจำนวนย่อหน้าจริง — วางท้าย section เป็นค่า fallback ที่ปลอดภัย
    out += renderBulletsList(bullets);
  }

  if (sec.callout) {
    out += `    <div class="aside"><div class="eyebrow">${escapeText(sec.callout.label)}</div><p>${sanitizeInlineHtml(
      sec.callout.text,
      'callout.text'
    )}</p></div>\n`;
  }
  out += '  </section>\n';
  return out;
}

function renderInteractive(chapter, interactive) {
  return `  <section class="night" id="ix" data-module="${escapeAttr(interactive.module)}" data-state="idle">
    <div class="eyebrow">หน้าต่างสู่จักรวาล · บทที่ ${escapeText(chapter.thaiNum)}</div>
    <h3>${escapeText(interactive.title)}</h3>
    <p>${escapeText(interactive.intro)}</p>
    <div class="ix-root" id="ix-root"></div>
    <noscript><p class="ix-fallback">ส่วนโต้ตอบต้องเปิด JavaScript</p></noscript>
  </section>\n`;
}

function renderQuote(quote) {
  let out = `  <div class="quote"><div class="eyebrow">พุทธพจน์ที่หนังสือยกมา</div><p>${escapeText(
    quote.text
  )}</p><div class="src">${escapeText(quote.source)}</div></div>\n`;
  (quote.after || []).forEach((p) => {
    out += `  <p>${sanitizeInlineHtml(p, 'quote.after')}</p>\n`;
  });
  return out;
}

/** รวม sections + interactive (แทรกตาม position) + quote เป็นก้อนเดียวตามลำดับใน §D.5 */
function renderChapterBody(chapter) {
  const sections = chapter.sections || [];
  const interactive = chapter.interactive || null;
  const ixPosition = interactive ? interactive.position : null;
  let html = '';
  let ixInserted = false;

  sections.forEach((sec, i) => {
    html += renderSection(sec, i + 1);
    if (interactive && ixPosition === i + 1) {
      html += renderInteractive(chapter, interactive);
      ixInserted = true;
    }
  });
  // ป้องกันกรณี position ชี้เกินจำนวน section จริง — แทรกท้ายสุดแทนที่จะหายไปเงียบๆ
  if (interactive && !ixInserted) {
    html += renderInteractive(chapter, interactive);
  }
  if (chapter.quote) {
    html += renderQuote(chapter.quote);
  }
  return html;
}

function renderExerciseBlock(chapter) {
  const ex = chapter.exercise;
  if (!ex) return '';
  const opt0 = ex.options[0];
  let out = '  <section class="exercise" id="ex" data-exercise>\n';
  out += '    <div class="eyebrow">ลองมองรอบตัว</div>\n';
  out += `    <h3>${escapeText(ex.title)}</h3>\n`;
  out += `    <p class="ex-intro">${escapeText(ex.intro)}</p>\n`;
  out += '    <div class="pick" id="ex-pick">\n';
  ex.options.forEach((opt, i) => {
    out += `      <button type="button" data-i="${i}" aria-pressed="${i === 0 ? 'true' : 'false'}">${escapeText(
      opt.name
    )}</button>\n`;
  });
  out += '    </div>\n';
  out += '    <div class="steps" id="ex-steps">\n';
  ex.columns.forEach((col, k) => {
    const txt = (opt0.steps && opt0.steps[k]) || '';
    out += `      <div class="step"><div class="lab">${escapeText(col.label)}<small>${escapeText(
      col.sub
    )}</small></div><div class="txt">${escapeText(txt)}</div></div>\n`;
  });
  out += '    </div>\n';
  out += '    <div class="reflect">\n';
  out += `      <label class="eyebrow" for="ex-ta">${escapeText(ex.prompt)}</label>\n`;
  out += `      <textarea id="ex-ta" maxlength="2000" placeholder="${escapeAttr(ex.placeholder || '')}"></textarea>\n`;
  out += `      <div class="row"><button class="btn" type="button" data-ai-feedback="ex-ta">ให้ผู้ช่วยช่วยดู</button>`;
  if (ex.hint) out += `<span class="eyebrow hint">${escapeText(ex.hint)}</span>`;
  out += '</div>\n';
  out += '      <div class="feedback" hidden aria-live="polite"></div>\n';
  out += '    </div>\n';
  out += '  </section>\n';
  return out;
}

function renderQuestionButtons(questions) {
  return (questions || []).map((q) => `    <button type="button">${escapeText(q)}</button>`).join('\n');
}

function renderSuggestionButtons(suggestions) {
  return (suggestions || []).slice(0, 2).map((s) => `    <button type="button">${escapeText(s)}</button>`).join('\n');
}

function computeChapterNav(book, idx) {
  const chapters = book.chapters;
  const prevUrl = idx === 0 ? `/b/${book.slug}` : `/b/${book.slug}/${chapters[idx - 1].slug}`;
  const nextUrl = idx === chapters.length - 1 ? `/b/${book.slug}` : `/b/${book.slug}/${chapters[idx + 1].slug}`;
  return { prevUrl, nextUrl };
}

function renderChnav(book, idx) {
  const chapters = book.chapters;
  const isFirst = idx === 0;
  const isLast = idx === chapters.length - 1;

  let prevHtml;
  if (isFirst) {
    prevHtml = `<a class="chnav-prev" href="/b/${book.slug}"><small>ก่อนหน้า</small>แผนที่การเดินทาง</a>`;
  } else {
    const prev = chapters[idx - 1];
    const suffix = prev.status !== 'ready' ? ' (กำลังสร้าง)' : '';
    prevHtml = `<a class="chnav-prev" href="/b/${book.slug}/${prev.slug}"><small>ก่อนหน้า</small>${escapeText(
      prev.thaiNum
    )} · ${escapeText(prev.title)}${suffix}</a>`;
  }

  let nextHtml;
  if (isLast) {
    nextHtml = `<a class="chnav-next" href="/b/${book.slug}"><small>กลับ</small>แผนที่การเดินทาง</a>`;
  } else {
    const next = chapters[idx + 1];
    const suffix = next.status !== 'ready' ? ' (กำลังสร้าง)' : '';
    nextHtml = `<a class="chnav-next" href="/b/${book.slug}/${next.slug}"><small>บทถัดไป</small>${escapeText(
      next.thaiNum
    )} · ${escapeText(next.title)}${suffix}</a>`;
  }

  return `  <nav class="chnav" id="chnav" aria-label="บทก่อนหน้า/ถัดไป">\n    ${prevHtml}\n    ${nextHtml}\n  </nav>\n`;
}

function renderSourceFooterItems(books, currentBookSlug) {
  const sorted = books.slice().sort((a, b) => a.meta.order - b.meta.order);
  let ordered = sorted;
  if (currentBookSlug) {
    const current = sorted.find((b) => b.meta.slug === currentBookSlug);
    if (current) {
      ordered = [current, ...sorted.filter((b) => b.meta.slug !== currentBookSlug)];
    }
  }
  return ordered
    .map((b) => {
      const meta = b.meta;
      const isCurrent = meta.slug === currentBookSlug;
      const thaiOrder = toThaiDigits(meta.order);
      if (meta.sourcePdf && meta.sourcePdf.file) {
        const mb = (meta.sourcePdf.bytes / 1e6).toFixed(1) + ' MB';
        const liOpen = isCurrent ? '<li class="sf-current">' : '<li>';
        const ariaCurrent = isCurrent ? ' aria-current="true"' : '';
        return `    ${liOpen}<a class="sf-item" href="/api/source/${meta.slug}.pdf" target="_blank" rel="noopener" data-book="${escapeAttr(
          meta.slug
        )}"${ariaCurrent}><span class="sf-num">${thaiOrder}</span><span class="sf-title">${escapeText(
          meta.title
        )}</span><span class="sf-size">${mb}</span></a></li>`;
      }
      return `    <li><span class="sf-item is-missing" data-book="${escapeAttr(
        meta.slug
      )}"><span class="sf-num">${thaiOrder}</span><span class="sf-title">${escapeText(
        meta.title
      )}</span><span class="sf-size">ยังไม่มีไฟล์</span></span></li>`;
    })
    .join('\n');
}

function renderSourceFooter(templates, books, currentBookSlug) {
  return renderTemplate(templates.sourceFooter, { SF_ITEMS: renderSourceFooterItems(books, currentBookSlug) });
}

function renderGlossaryItems(terms) {
  return terms
    .map(
      (t) =>
        `    <button type="button" class="gloss-item" data-term="${escapeAttr(t.term)}" data-kind="${escapeAttr(
          t.kind
        )}"><span class="gi-term">${escapeText(t.term)}</span><span class="gi-alt">${escapeText(
          t.alt || ''
        )}</span><span class="gi-kind">${escapeText(t.kind)}</span></button>`
    )
    .join('\n');
}

/* ============================================================ */
/* rail + topbar (ใช้ร่วมกันทุกหน้า)                              */
/* ============================================================ */
function renderRail(pageType, series, book, currentChapterSlug) {
  const seriesLevel = pageType === 'shelf' || pageType === 'glossary';
  const homeHref = seriesLevel ? '/' : `/b/${book.slug}`;
  const homeText = seriesLevel ? 'ชั้นหนังสือ' : 'แผนที่การเดินทาง';

  let nav = '';
  if (book) {
    nav = book.chapters
      .map((c) => {
        const ok = c.status === 'ready';
        const isCurrent = c.slug === currentChapterSlug;
        const classAttr = ok ? '' : ' class="soon"';
        const currentAttr = isCurrent ? ' aria-current="page"' : '';
        return `      <a href="/b/${book.slug}/${c.slug}" data-chapter="${escapeAttr(c.slug)}"${classAttr}${currentAttr}><span class="n">${escapeText(
          c.thaiNum
        )}</span><span>${escapeText(c.title)}</span></a>`;
      })
      .join('\n');
  }

  // หน้า shelf/glossary ไม่มีบริบทเล่มเดียว จึงปรับข้อความ footer เป็นระดับ "หนังสือชุด" แทน
  // (จุดที่สัญญาไม่ได้ระบุไว้ตรงๆ — ตัดสินใจโดย P4 ตามเจตนาเดิมของ prototype)
  const footText = book
    ? `อ้างอิงจากหนังสือ <i>${escapeText(book.title)}</i> โดย สิรวิชญ์ รัตน์จินดา<br>เนื้อหาในคู่มือนี้เรียบเรียงใหม่เพื่อการเรียนรู้`
    : `อ้างอิงจากหนังสือชุด <i>${escapeText(series.title)}</i> โดย สิรวิชญ์ รัตน์จินดา<br>เนื้อหาในคู่มือนี้เรียบเรียงใหม่เพื่อการเรียนรู้`;

  return `<aside class="rail">
  <div class="brand"><a class="t" href="/">${escapeText(series.title)}</a><div class="s">คู่มือเดินทางแบบโต้ตอบ</div></div>
  <div class="home"><a class="ask-inline" href="${homeHref}">${homeText}</a></div>
  <nav id="railnav" aria-label="บทเรียน">
${nav}
  </nav>
  <div class="foot">${footText}</div>
</aside>`;
}

function renderTopbar(pageType, series, book, currentChapterSlug) {
  const seriesLevel = pageType === 'shelf' || pageType === 'glossary';
  const href = seriesLevel ? '/' : `/b/${book.slug}`;
  const text = seriesLevel ? series.title : book.title;

  let selectHtml;
  if (book) {
    const opts = [`      <option value="/b/${book.slug}">แผนที่การเดินทาง</option>`].concat(
      book.chapters.map((c) => {
        const label = escapeText(c.title) + (c.status !== 'ready' ? ' (กำลังสร้าง)' : '');
        const selected = c.slug === currentChapterSlug ? ' selected' : '';
        return `      <option value="/b/${book.slug}/${c.slug}"${selected}>${label}</option>`;
      })
    );
    selectHtml = `<select id="mobnav" aria-label="ไปที่บท">\n${opts.join('\n')}\n    </select>`;
  } else {
    // หน้า shelf/glossary ไม่มีรายการบทให้เลือก — ซ่อน select ไว้ (ตัดสินใจโดย P4 เพราะสัญญาไม่ครอบคลุมกรณีนี้)
    selectHtml = '<select id="mobnav" aria-label="ไปที่บท" hidden></select>';
  }

  return `<div class="topbar">
  <a class="t" href="${href}">${escapeText(text)}</a>
  ${selectHtml}
</div>`;
}

/* ============================================================ */
/* PageData (§D.7)                                               */
/* ============================================================ */
function buildBookMetaForPageData(book) {
  return {
    slug: book.slug,
    order: book.order,
    thaiOrder: toThaiDigits(book.order),
    title: book.title,
    author: book.author,
    status: book.status,
    url: `/b/${book.slug}`,
    chapters: book.chapters.map((c) => ({
      slug: c.slug,
      order: c.order,
      thaiNum: c.thaiNum,
      title: c.title,
      sub: c.sub,
      status: c.status,
      url: `/b/${book.slug}/${c.slug}`,
    })),
  };
}

function buildShelfForPageData(books) {
  return books.map((b) => ({
    slug: b.meta.slug,
    order: b.meta.order,
    title: b.meta.title,
    status: b.meta.status,
    url: `/b/${b.meta.slug}`,
    chapters: b.meta.chapters.map((c) => c.slug),
    readyChapters: b.meta.chapters.filter((c) => c.status === 'ready').map((c) => c.slug),
  }));
}

/* ============================================================ */
/* layout renderer                                                */
/* ============================================================ */
function bodyAttrs(page, bookSlug, chapterSlug) {
  let s = ` data-page="${page}"`;
  if (bookSlug) s += ` data-book="${escapeAttr(bookSlug)}"`;
  if (chapterSlug) s += ` data-chapter="${escapeAttr(chapterSlug)}"`;
  return s;
}

function renderLayout(templates, opts) {
  const askHtml = renderTemplate(templates.ask, { ASKCTX: escapeText(opts.askCtx) });
  return renderTemplate(templates.layout, {
    TITLE: escapeText(opts.title),
    DESCRIPTION: escapeAttr(opts.description || ''),
    BODY_ATTRS: opts.bodyAttrs,
    PAGE_DATA_JSON: toPageDataJson(opts.pageData),
    TOPBAR: opts.topbarHtml,
    RAIL: opts.railHtml,
    ARTICLE: opts.articleHtml,
    ASK_PARTIAL: askHtml,
    SHEET_PARTIAL: templates.sheet,
  });
}

/* ============================================================ */
/* ตัว render แต่ละหน้า                                           */
/* ============================================================ */
function renderShelfPage(outDir, templates, books) {
  const article = renderTemplate(templates.shelf, {
    SERIES_TITLE: escapeText(SERIES.title),
    BOOKCARDS: renderBookCards(books),
    SOURCE_FOOTER: renderSourceFooter(templates, books, null),
  });
  const pageData = {
    page: 'shelf',
    series: SERIES,
    api: API,
    limits: LIMITS,
    book: null,
    chapter: null,
    terms: [],
    shelf: buildShelfForPageData(books),
  };
  const html = renderLayout(templates, {
    title: SERIES.title,
    description: `คู่มือเดินทางแบบโต้ตอบสำหรับหนังสือชุด ${SERIES.title}`,
    bodyAttrs: bodyAttrs('shelf', null, null),
    pageData,
    topbarHtml: renderTopbar('shelf', SERIES, null, null),
    railHtml: renderRail('shelf', SERIES, null, null),
    articleHtml: article,
    askCtx: 'บริบท: ชั้นหนังสือ',
  });
  writePage(outDir, 'index.html', html);
}

function renderBookPage(outDir, templates, allBooks, bookRecord) {
  const book = bookRecord.meta;
  const article = renderTemplate(templates.book, {
    THAI_ORDER: toThaiDigits(book.order),
    TITLE: escapeText(book.title),
    AUTHOR: escapeText(book.author),
    BLURB: escapeText(book.blurb),
    CORE_IDEAS: renderCoreIdeas(book.coreIdeas),
    CHAPTER_COUNT: String(book.chapters.length),
    MAPROWS: renderMapRows(book),
    SOURCE_FOOTER: renderSourceFooter(templates, allBooks, book.slug),
  });
  const pageData = {
    page: 'book',
    series: SERIES,
    api: API,
    limits: LIMITS,
    book: buildBookMetaForPageData(book),
    chapter: null,
    terms: [],
    shelf: null,
  };
  const html = renderLayout(templates, {
    title: `${book.title} · ${SERIES.title}`,
    description: book.blurb,
    bodyAttrs: bodyAttrs('book', book.slug, null),
    pageData,
    topbarHtml: renderTopbar('book', SERIES, book, null),
    railHtml: renderRail('book', SERIES, book, null),
    articleHtml: article,
    askCtx: `บริบท: เล่ม ${toThaiDigits(book.order)} ${book.title} · แผนที่`,
  });
  writePage(outDir, `b/${book.slug}/index.html`, html);
}

function renderChapterPage(outDir, templates, allBooks, bookRecord, idx, chFull) {
  const book = bookRecord.meta;
  // chapterSlug ที่ใช้ทำ URL/filename ต้องมาจาก book.json.chapters[].slug (คือ "ch01" รูปแบบ chNN)
  // เสมอ ไม่ใช่ chFull.slug (ค่าใน chNN.json เอง) เพราะพบว่าข้อมูลจริงบางบทมี slug ภายในไม่ตรงรูปแบบ chNN
  // (เช่น ch01.json.slug = "the-secret-of-three-marks") — cm.slug คือค่าที่ตรงกับสัญญาระหว่างโมดูลเสมอ
  const cm = book.chapters[idx];
  if (chFull.slug !== cm.slug) {
    console.warn(
      `[build] คำเตือน: ${book.slug}/${cm.slug}.json มี slug ภายในไฟล์ ("${chFull.slug}") ไม่ตรงกับ chapterSlug ตามสัญญา ("${cm.slug}") — ใช้ "${cm.slug}" ในการทำ URL/ไฟล์`
    );
  }
  const article = renderTemplate(templates.chapter, {
    THAINUM: escapeText(chFull.thaiNum),
    TITLE: escapeText(chFull.title),
    GOAL: escapeText(chFull.goal),
    BODY_SECTIONS: renderChapterBody(chFull),
    EXERCISE_BLOCK: renderExerciseBlock(chFull),
    QUESTIONS: renderQuestionButtons(chFull.questions),
    CHNAV: renderChnav(book, idx),
    SOURCE_FOOTER: renderSourceFooter(templates, allBooks, book.slug),
  });
  const { prevUrl, nextUrl } = computeChapterNav(book, idx);
  const pageData = {
    page: 'chapter',
    series: SERIES,
    api: API,
    limits: LIMITS,
    book: buildBookMetaForPageData(book),
    chapter: {
      slug: cm.slug,
      order: chFull.order,
      thaiNum: chFull.thaiNum,
      title: chFull.title,
      sub: chFull.sub,
      status: chFull.status,
      url: `/b/${book.slug}/${cm.slug}`,
      prevUrl,
      nextUrl,
      suggestions: chFull.suggestions || [],
      interactive: chFull.interactive
        ? {
            module: chFull.interactive.module,
            title: chFull.interactive.title,
            intro: chFull.interactive.intro,
            config: chFull.interactive.config || {},
          }
        : null,
      exercise: chFull.exercise
        ? {
            title: chFull.exercise.title,
            columns: chFull.exercise.columns,
            options: chFull.exercise.options,
            hint: chFull.exercise.hint || '',
          }
        : null,
    },
    terms: chFull.terms || [],
    shelf: null,
  };
  const html = renderLayout(templates, {
    title: `${chFull.title} · ${book.title}`,
    description: chFull.summary,
    bodyAttrs: bodyAttrs('chapter', book.slug, cm.slug),
    pageData,
    topbarHtml: renderTopbar('chapter', SERIES, book, cm.slug),
    railHtml: renderRail('chapter', SERIES, book, cm.slug),
    articleHtml: article,
    askCtx: `บริบท: เล่ม ${toThaiDigits(book.order)} ${book.title} · บทที่ ${chFull.thaiNum} ${chFull.title}`,
  });
  writePage(outDir, `b/${book.slug}/${cm.slug}/index.html`, html);
}

function renderSoonPage(outDir, templates, allBooks, bookRecord, idx, chFull) {
  const book = bookRecord.meta;
  const cm = book.chapters[idx]; // ดูคอมเมนต์ใน renderChapterPage — cm.slug คือตัวที่ถูกต้องสำหรับ URL/filename เสมอ
  const article = renderTemplate(templates.soon, {
    THAINUM: escapeText(chFull.thaiNum),
    TITLE: escapeText(chFull.title),
    SUB: escapeText(chFull.sub),
    SUGGESTION_BUTTONS: renderSuggestionButtons(chFull.suggestions),
    CHNAV: renderChnav(book, idx),
    SOURCE_FOOTER: renderSourceFooter(templates, allBooks, book.slug),
  });
  const { prevUrl, nextUrl } = computeChapterNav(book, idx);
  const pageData = {
    page: 'soon',
    series: SERIES,
    api: API,
    limits: LIMITS,
    book: buildBookMetaForPageData(book),
    chapter: {
      slug: cm.slug,
      order: chFull.order,
      thaiNum: chFull.thaiNum,
      title: chFull.title,
      sub: chFull.sub,
      status: chFull.status,
      url: `/b/${book.slug}/${cm.slug}`,
      prevUrl,
      nextUrl,
      suggestions: chFull.suggestions || [],
      interactive: null,
      exercise: null,
    },
    terms: [],
    shelf: null,
  };
  const html = renderLayout(templates, {
    title: `${chFull.title} · ${book.title}`,
    description: chFull.summary,
    bodyAttrs: bodyAttrs('soon', book.slug, cm.slug),
    pageData,
    topbarHtml: renderTopbar('soon', SERIES, book, cm.slug),
    railHtml: renderRail('soon', SERIES, book, cm.slug),
    articleHtml: article,
    askCtx: `บริบท: เล่ม ${toThaiDigits(book.order)} ${book.title} · บทที่ ${chFull.thaiNum} ${chFull.title}`,
  });
  writePage(outDir, `b/${book.slug}/${cm.slug}/index.html`, html);
}

function renderGlossaryPage(outDir, templates, allBooks, globalGlossary) {
  const sorted = globalGlossary.slice().sort((a, b) => a.term.localeCompare(b.term, 'th'));
  const article = renderTemplate(templates.glossary, {
    GLOSS_ITEMS: renderGlossaryItems(sorted),
    SOURCE_FOOTER: renderSourceFooter(templates, allBooks, null),
  });
  const pageData = {
    page: 'glossary',
    series: SERIES,
    api: API,
    limits: LIMITS,
    book: null,
    chapter: null,
    terms: sorted,
    shelf: null,
  };
  const html = renderLayout(templates, {
    title: `ศัพท์รวม · ${SERIES.title}`,
    description: `รวมคำศัพท์ธรรมะและวิทยาศาสตร์ทั้งชุด ${SERIES.title}`,
    bodyAttrs: bodyAttrs('glossary', null, null),
    pageData,
    topbarHtml: renderTopbar('glossary', SERIES, null, null),
    railHtml: renderRail('glossary', SERIES, null, null),
    articleHtml: article,
    askCtx: 'บริบท: ศัพท์รวม',
  });
  writePage(outDir, 'glossary/index.html', html);
}

/** หน้า 404 เป็นเอกสารอิสระ ไม่พึ่ง rail/topbar/ask/PageData เพราะไม่มีบริบทเล่ม/บทให้อ้างอิง
 *  (ตัดสินใจโดย P4 — สัญญาระบุแค่ว่า build.js ต้อง render 404.html แต่ไม่ได้กำหนดโครง) */
function render404Page(outDir, templates) {
  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ไม่พบหน้านี้ · ${escapeText(SERIES.title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chonburi&family=Sarabun:ital,wght@0,300;0,400;0,500;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/base.css">
</head>
<body>
${templates.notFound}
</body>
</html>
`;
  writePage(outDir, '404.html', html);
}

/* ============================================================ */
/* copy assets (CSS/JS/static)                                   */
/* ============================================================ */
function copyAssets(srcDir, outDir) {
  const cssOutDir = path.join(outDir, 'assets', 'css');
  fs.mkdirSync(cssOutDir, { recursive: true });
  fs.copyFileSync(path.join(srcDir, 'tokens.css'), path.join(cssOutDir, 'tokens.css'));
  fs.copyFileSync(path.join(srcDir, 'base.css'), path.join(cssOutDir, 'base.css'));

  const jsSrc = path.join(srcDir, 'js');
  if (fs.existsSync(jsSrc) && fs.readdirSync(jsSrc).length > 0) {
    fs.cpSync(jsSrc, path.join(outDir, 'assets', 'js'), { recursive: true });
  } else {
    console.warn('[build] คำเตือน: ไม่พบไฟล์ใน web/src/js — P5 ยังไม่ส่งมอบ JS หน้าเว็บจะยังไม่มี interactivity จนกว่าจะมีไฟล์');
  }

  const staticSrc = path.join(srcDir, 'static');
  if (fs.existsSync(staticSrc) && fs.readdirSync(staticSrc).length > 0) {
    fs.cpSync(staticSrc, outDir, { recursive: true });
  }
}

/* ============================================================ */
/* ตรวจความปลอดภัยก่อนจบ build (§H ข้อ 6, กฎเหล็ก #1 #2)          */
/* ============================================================ */
function walkFiles(dir, cb) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, cb);
    else cb(full);
  }
}

function assertOutputIsSafe(outDir) {
  const offenders = [];
  walkFiles(outDir, (filePath) => {
    if (/\.pdf$/i.test(filePath)) {
      offenders.push(`พบไฟล์ .pdf หลุดเข้ามาใน web/public: ${filePath} (ห้ามวาง PDF ใน web/public/ ตามกฎเหล็ก #2)`);
      return;
    }
    if (/\.(html|css|js|json)$/i.test(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes(KEY_MARKER)) {
        offenders.push(`พบข้อความ API key marker หลุดเข้ามาใน: ${filePath} (ห้ามมี ANTHROPIC_API_KEY ในไฟล์ฝั่งเว็บ ตามกฎเหล็ก #1)`);
      }
    }
  });
  if (offenders.length) {
    throw new BuildError('ตรวจความปลอดภัยของ web/public ไม่ผ่าน:\n' + offenders.join('\n'));
  }
}

/* ============================================================ */
/* main                                                           */
/* ============================================================ */
function parseArgs(argv) {
  const args = { content: 'content', out: 'web/public' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--content') args.content = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

function loadTemplates(templatesDir) {
  const read = (p) => fs.readFileSync(path.join(templatesDir, p), 'utf8');
  return {
    layout: read('layout.html'),
    shelf: read('shelf.html'),
    book: read('book.html'),
    chapter: read('chapter.html'),
    soon: read('soon.html'),
    glossary: read('glossary.html'),
    notFound: read('404.html'),
    ask: read('partials/ask.html'),
    sheet: read('partials/sheet.html'),
    sourceFooter: read('partials/source-footer.html'),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const contentDir = path.resolve(repoRoot, args.content);
  const outDir = path.resolve(repoRoot, args.out);
  const srcDir = path.join(__dirname, 'src');
  const templatesDir = path.join(srcDir, 'templates');

  console.log(`[build] content: ${contentDir}`);
  console.log(`[build] out:     ${outDir}`);

  runSchemaValidation(contentDir);

  const books = loadBooks(contentDir);
  if (books.length === 0) {
    console.warn('[build] คำเตือน: ไม่พบ book.json สักเล่มเดียว — จะสร้างหน้าชั้นหนังสือแบบว่างเปล่าไปก่อน');
  }

  const globalGlossary = mergeGlobalGlossary(books);
  const indexJson = buildIndexJson(books);

  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'index.json'), JSON.stringify(indexJson, null, 2) + '\n', 'utf8');
  console.log(`[build] เขียน ${path.join(contentDir, 'index.json')} (${books.length} เล่ม)`);

  fs.mkdirSync(outDir, { recursive: true });
  cleanOutDir(outDir);
  const templates = loadTemplates(templatesDir);

  renderShelfPage(outDir, templates, books);
  let chapterPageCount = 0;
  for (const bookRecord of books) {
    renderBookPage(outDir, templates, books, bookRecord);
    bookRecord.meta.chapters.forEach((cm, idx) => {
      const chFull = bookRecord.chapters[idx];
      if (chFull.status === 'ready') {
        renderChapterPage(outDir, templates, books, bookRecord, idx, chFull);
      } else {
        renderSoonPage(outDir, templates, books, bookRecord, idx, chFull);
      }
      chapterPageCount++;
    });
  }
  renderGlossaryPage(outDir, templates, books, globalGlossary);
  render404Page(outDir, templates);

  copyAssets(srcDir, outDir);
  assertOutputIsSafe(outDir);

  console.log(
    `[build] เสร็จสมบูรณ์ — ${books.length} เล่ม, ${chapterPageCount} หน้าบท, ` +
      `ศัพท์รวม ${globalGlossary.length} คำ → ${outDir}`
  );
}

try {
  main();
} catch (err) {
  console.error('[build] ล้มเหลว:', err && err.message ? err.message : err);
  process.exit(1);
}

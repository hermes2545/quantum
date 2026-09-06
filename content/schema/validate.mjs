#!/usr/bin/env node
// content/schema/validate.mjs
//
// ใช้: node content/schema/validate.mjs [content-dir]
//   content-dir default = "content" (resolve จาก cwd ที่รันคำสั่ง)
//
// ตรวจไฟล์ข้อมูลทั้งหมดใต้ content/ ตามสัญญาระหว่างโมดูล §A.1–A.5:
//   - content/books/{bookSlug}/book.json      ตาม book.schema.json
//   - content/books/{bookSlug}/glossary.json  ตาม glossary.schema.json (ถ้ามี)
//   - content/books/{bookSlug}/chNN.json      ตาม chapter.schema.json (ทุกบทที่ระบุใน book.json.chapters)
//   - content/index.json / content/index.example.json (ถ้ามี) ตาม index.schema.json
// รวมกฎ cross-file ที่ JSON Schema เดี่ยวๆ ตรวจเองไม่ได้ (§H ข้อ 1 ของ build.js):
//   1. book.json.chapters[i].status/title/sub/thaiNum/order ต้องเท่ากับ chNN.json เสมอ
//   2. dfn ทุกตัวใน chNN.json ต้องอ้างถึง term ที่มีอยู่จริงใน glossary.json ของเล่มนั้น และ data-kind ต้องตรงกับ kind ของ term นั้น
//   3. glossary.json ห้ามมี term ซ้ำภายในไฟล์เดียวกัน
//   4. ทุกไฟล์ chNN.json บนดิสก์ต้องถูกอ้างถึงใน book.json.chapters[] (กันไฟล์กำพร้าหลุดรอด)
//   5. interactive.position ห้ามเกินจำนวน sections, bulletsAfter ห้ามเกินจำนวน paragraphs
//   6. ทุก string ใต้ interactive.config ห้ามมีแท็ก HTML นอกเหนือจาก <b> (กัน XSS ผ่าน config ที่ P5 ต่อเป็น innerHTML)
//   7. sourcePdf (ถ้ามี) — เตือนถ้าไฟล์ไม่มีใน content/source/ (error ถ้าใช้ --strict-source), error ถ้ามีไฟล์แต่ bytes ไม่ตรงขนาดจริง
// exit code 1 เมื่อพบข้อผิดพลาดอย่างน้อย 1 จุด, exit 0 เมื่อผ่านหมด
// JSON ที่อ่านไม่ขึ้น (syntax error) ไม่ทำให้สคริปต์ตายกลางคัน — รายงานเป็น error ของไฟล์นั้นแล้วตรวจไฟล์อื่นต่อ
//
// หมายเหตุการออกแบบ (P6 ตัดสินใจเอง เพราะสัญญาไม่ได้ลงรายละเอียดวิธีสร้าง validator):
// ไม่ใช้ไลบรารี JSON-Schema สำเร็จรูป (เช่น ajv) เพราะ build.js/pipeline ในสัญญาระบุชัดว่า
// "ไม่มี dependency" — จึงเขียน evaluator ของ JSON Schema draft 2020-12 แบบ subset เอง
// รองรับเฉพาะ keyword ที่ *.schema.json ในโฟลเดอร์นี้ใช้จริง: type, enum, const, pattern,
// minLength/maxLength, minimum/maximum/exclusiveMinimum/exclusiveMaximum, minItems/maxItems,
// items, properties, required, additionalProperties, $ref ("#/$defs/..."), allOf, if/then/else,
// format:"date-time" — ไม่รองรับ oneOf/anyOf/not/$dynamicRef เพราะสคีมาชุดนี้ไม่ได้ใช้
// (ฝั่ง pipeline python ยังใช้ jsonschema library เต็มรูปแบบกับไฟล์ .schema.json เดียวกันได้ตรงๆ)

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// schema ย่อสำหรับ chNN.json ที่ status เป็น "building" (stub จาก pipeline/toc_init.py — §A.2 ต้องมีไฟล์เสมอ)
const BUILDING_STUB_SCHEMA = {
  type: "object",
  required: ["book", "slug", "order", "thaiNum", "title", "sub", "status"],
  properties: {
    book: { type: "string", minLength: 1 },
    slug: { type: "string", pattern: "^ch[0-9]{2}$" },
    order: { type: "integer", minimum: 1 },
    thaiNum: { type: "string", minLength: 1 },
    title: { type: "string", minLength: 1 },
    sub: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["building"] },
  },
};

const SCHEMA_DIR = dirname(fileURLToPath(import.meta.url));

// ---------- ตัวช่วยอ่านไฟล์ ----------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadSchema(name) {
  return readJson(join(SCHEMA_DIR, name));
}

// เหมือน readJson แต่ไม่โยน exception ออกไปทั้งโปรแกรม — ไฟล์ JSON พังหนึ่งไฟล์ (เช่น
// author.py เขียนค้าง) ต้องไม่ทำให้ไฟล์อื่นที่เหลือไม่ถูกตรวจในรอบเดียวกัน
function tryReadJson(path, label, errors) {
  try {
    return readJson(path);
  } catch (err) {
    errors.push(`${label}: JSON ไม่ถูกต้อง — ${err.message}`);
    return null;
  }
}

// ---------- JSON Schema evaluator (subset draft 2020-12) ----------

function resolveSchema(schema, root) {
  if (schema && typeof schema === "object" && typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (!ref.startsWith("#/")) {
      throw new Error(`validate.mjs รองรับเฉพาะ local $ref ("#/...") ไม่รองรับ: ${ref}`);
    }
    const parts = ref.slice(2).split("/");
    let node = root;
    for (const part of parts) {
      node = node && node[part];
    }
    if (!node) throw new Error(`resolve $ref ไม่ได้: ${ref}`);
    return node;
  }
  return schema;
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "string" | "number" | "boolean" | "object" | "undefined"
}

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// คืนค่า array ของข้อความ error (ว่าง = ผ่าน) — เขียนเป็นฟังก์ชันบริสุทธิ์ ไม่แก้ schema/instance
function validate(instance, schemaIn, root, path, errors) {
  const schema = resolveSchema(schemaIn, root);

  if (schema.type !== undefined) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = jsonType(instance);
    const ok = wanted.some((t) => {
      if (t === "integer") return actual === "number" && Number.isInteger(instance);
      return t === actual;
    });
    if (!ok) {
      errors.push(`${path}: ต้องเป็น type ${wanted.join("|")} แต่พบ ${actual}`);
      return errors; // ผิด type แล้วตรวจต่อไม่มีความหมาย
    }
  }

  if (schema.const !== undefined) {
    if (JSON.stringify(instance) !== JSON.stringify(schema.const)) {
      errors.push(`${path}: ต้องเท่ากับ ${JSON.stringify(schema.const)} แต่พบ ${JSON.stringify(instance)}`);
    }
  }

  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(instance))) {
      errors.push(`${path}: ต้องเป็นหนึ่งใน ${JSON.stringify(schema.enum)} แต่พบ ${JSON.stringify(instance)}`);
    }
  }

  if (typeof instance === "string") {
    if (schema.pattern !== undefined) {
      const re = new RegExp(schema.pattern, "u");
      if (!re.test(instance)) {
        const preview = instance.length > 120 ? instance.slice(0, 120) + "…" : instance;
        errors.push(`${path}: ไม่ตรงรูปแบบที่กำหนด (pattern: ${schema.pattern}) ค่า: ${JSON.stringify(preview)}`);
      }
    }
    if (schema.minLength !== undefined && instance.length < schema.minLength) {
      errors.push(`${path}: สั้นเกินไป (ยาว ${instance.length} ตัวอักษร ต้อง >= ${schema.minLength})`);
    }
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) {
      errors.push(`${path}: ยาวเกินไป (ยาว ${instance.length} ตัวอักษร ต้อง <= ${schema.maxLength})`);
    }
    if (schema.format === "date-time" && !DATE_TIME_RE.test(instance)) {
      errors.push(`${path}: ไม่ใช่ ISO date-time ที่ถูกต้อง (ค่า: ${instance})`);
    }
  }

  if (typeof instance === "number") {
    if (schema.minimum !== undefined && instance < schema.minimum) errors.push(`${path}: ต้อง >= ${schema.minimum} แต่พบ ${instance}`);
    if (schema.maximum !== undefined && instance > schema.maximum) errors.push(`${path}: ต้อง <= ${schema.maximum} แต่พบ ${instance}`);
    if (schema.exclusiveMinimum !== undefined && instance <= schema.exclusiveMinimum) errors.push(`${path}: ต้อง > ${schema.exclusiveMinimum} แต่พบ ${instance}`);
    if (schema.exclusiveMaximum !== undefined && instance >= schema.exclusiveMaximum) errors.push(`${path}: ต้อง < ${schema.exclusiveMaximum} แต่พบ ${instance}`);
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) {
      errors.push(`${path}: มี ${instance.length} รายการ ต้อง >= ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) {
      errors.push(`${path}: มี ${instance.length} รายการ ต้อง <= ${schema.maxItems}`);
    }
    if (schema.items !== undefined) {
      instance.forEach((item, i) => validate(item, schema.items, root, `${path}[${i}]`, errors));
    }
  }

  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in instance)) errors.push(`${path}: ขาด field บังคับ "${key}"`);
      }
    }
    if (schema.properties !== undefined) {
      for (const [key, subschema] of Object.entries(schema.properties)) {
        if (key in instance) validate(instance[key], subschema, root, `${path}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(instance)) {
        if (!known.has(key)) errors.push(`${path}: มี field ที่ไม่รู้จัก "${key}" (ห้าม field เกิน)`);
      }
    }
  }

  if (schema.allOf !== undefined) {
    for (const sub of schema.allOf) validate(instance, sub, root, path, errors);
  }

  if (schema.if !== undefined) {
    const probe = [];
    validate(instance, schema.if, root, path, probe);
    if (probe.length === 0) {
      if (schema.then !== undefined) validate(instance, schema.then, root, path, errors);
    } else if (schema.else !== undefined) {
      validate(instance, schema.else, root, path, errors);
    }
  }

  return errors;
}

function validateAgainst(instance, schema, label) {
  const errs = [];
  validate(instance, schema, schema, label, errs);
  return errs;
}

// ---------- กฎ cross-file ที่ JSON Schema ตรวจเองไม่ได้ ----------

// ดึงทุก {term, kind} ที่ปรากฏใน <dfn data-term="…" data-kind="…"> ทั่วทั้งบท
// (ครอบคลุมเฉพาะจุดที่สัญญาอนุญาตให้เป็น inner-HTML: paragraphs, bullets, callout.text, quote.after —
//  ตาม §A.2/§9.2 ไม่ห่อ dfn ใน quote.text/h2/callout.label/interactive/exercise อยู่แล้ว)
const DFN_RE = /<dfn\s+data-term="([^"]*)"(?:\s+data-kind="([^"]*)")?\s*>/g;

function collectDfnUsages(chapter) {
  const texts = [];
  for (const section of chapter.sections || []) {
    texts.push(...(section.paragraphs || []));
    texts.push(...(section.bullets || []));
    if (section.callout && typeof section.callout.text === "string") texts.push(section.callout.text);
  }
  if (chapter.quote && Array.isArray(chapter.quote.after)) texts.push(...chapter.quote.after);
  const usages = [];
  for (const text of texts) {
    if (typeof text !== "string") continue;
    let m;
    DFN_RE.lastIndex = 0;
    while ((m = DFN_RE.exec(text))) {
      usages.push({ term: m[1], kind: m[2] });
    }
  }
  return usages;
}

// interactive.config (§E.4) ถูกส่งตรงเข้า P5 แล้ว render บางฟิลด์ (เช่น particles.lenses,
// zoom.levels[].q) เป็น innerHTML — ต้องกันแท็กอันตราย (<img onerror>, <script>, …) ตรงนี้
// เพราะ chapter.schema.json ตรวจแค่ว่า config เป็น object เฉยๆ อนุญาตแคบกว่า InnerHtml ปกติ
// คือมีแค่ <b>/</b> (§E.4: "lenses = inner HTML ของ readout (อนุญาต <b> เท่านั้น)")
const CONFIG_INNER_HTML_RE = /^(?:[^<]|<\/?b>)*$/;

function collectConfigStrings(value, path, out) {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectConfigStrings(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) collectConfigStrings(v, `${path}.${k}`, out);
  }
}

function checkInteractiveConfig(chapter, label, errors) {
  if (!chapter.interactive || typeof chapter.interactive.config !== "object" || chapter.interactive.config === null) {
    return;
  }
  const strings = [];
  collectConfigStrings(chapter.interactive.config, "interactive.config", strings);
  for (const [path, str] of strings) {
    if (!CONFIG_INNER_HTML_RE.test(str)) {
      const preview = str.length > 120 ? str.slice(0, 120) + "…" : str;
      errors.push(`${label}: ${path} มีแท็ก HTML ที่ไม่อนุญาต (อนุญาตเฉพาะ <b>) ค่า: ${JSON.stringify(preview)}`);
    }
  }
}

// ---------- main ----------

function main() {
  const args = process.argv.slice(2);
  const strictSource = args.includes("--strict-source");
  const positional = args.find((a) => !a.startsWith("--"));
  const contentDir = resolve(positional || "content");
  const errors = [];
  let filesChecked = 0;

  const schemas = {
    book: loadSchema("book.schema.json"),
    chapter: loadSchema("chapter.schema.json"),
    term: loadSchema("term.schema.json"),
    glossary: loadSchema("glossary.schema.json"),
    index: loadSchema("index.schema.json"),
  };

  if (!existsSync(contentDir)) {
    console.error(`ไม่พบโฟลเดอร์ content ที่ ${contentDir}`);
    process.exit(1);
  }

  const booksDir = join(contentDir, "books");
  if (!existsSync(booksDir)) {
    console.warn(`คำเตือน: ไม่พบ ${booksDir} — ข้ามการตรวจ books/*`);
  } else {
    const bookSlugs = readdirSync(booksDir).filter((name) => statSync(join(booksDir, name)).isDirectory());
    for (const bookSlug of bookSlugs) {
      const bookDir = join(booksDir, bookSlug);
      const bookJsonPath = join(bookDir, "book.json");
      if (!existsSync(bookJsonPath)) {
        errors.push(`books/${bookSlug}/: ไม่พบ book.json`);
        continue;
      }
      filesChecked++;
      const bookLabel = `books/${bookSlug}/book.json`;
      const book = tryReadJson(bookJsonPath, bookLabel, errors);
      if (book === null) continue;
      for (const e of validateAgainst(book, schemas.book, bookLabel)) errors.push(e);
      if (book.slug !== bookSlug) {
        errors.push(`${bookLabel}: book.slug ("${book.slug}") ไม่ตรงกับชื่อโฟลเดอร์ "${bookSlug}"`);
      }

      // sourcePdf (optional) — ไฟล์จริงต้องมีอยู่และขนาดต้องตรง bytes ที่ประกาศไว้ (A-01, ความเสี่ยง #15)
      if (book.sourcePdf && typeof book.sourcePdf.file === "string") {
        const srcPath = join(contentDir, "source", book.sourcePdf.file);
        if (!existsSync(srcPath)) {
          const msg = `${bookLabel}: sourcePdf.file "${book.sourcePdf.file}" ไม่พบใน content/source/`;
          if (strictSource) errors.push(`${msg} (--strict-source)`);
          else console.warn(`คำเตือน: ${msg} — ข้ามการตรวจขนาดไฟล์ (ใช้ --strict-source เพื่อบังคับเป็น error)`);
        } else {
          const actualBytes = statSync(srcPath).size;
          if (actualBytes !== book.sourcePdf.bytes) {
            errors.push(
              `${bookLabel}: sourcePdf.bytes (${book.sourcePdf.bytes}) ไม่ตรงกับขนาดไฟล์จริง content/source/${book.sourcePdf.file} (${actualBytes} bytes) — proxy ต้องใช้ขนาดจริงจาก stat ไม่ใช่ค่านี้ แต่ค่านี้ก็ควรตรงเพื่อไม่ให้ SourceFooter แสดงขนาดผิด`
            );
          }
        }
      }

      // glossary.json (optional แต่ถ้ามีต้อง valid + ห้าม term ซ้ำ)
      const glossaryPath = join(bookDir, "glossary.json");
      let glossaryTerms = new Map(); // term -> kind
      if (existsSync(glossaryPath)) {
        filesChecked++;
        const glossaryLabel = `books/${bookSlug}/glossary.json`;
        const glossary = tryReadJson(glossaryPath, glossaryLabel, errors);
        if (glossary !== null) {
          for (const e of validateAgainst(glossary, schemas.glossary, glossaryLabel)) errors.push(e);
          const seen = new Set();
          for (const t of glossary.terms || []) {
            if (seen.has(t.term)) {
              errors.push(`${glossaryLabel}: term ซ้ำ "${t.term}"`);
            }
            seen.add(t.term);
            glossaryTerms.set(t.term, t.kind);
          }
        }
      }

      // chNN.json ทุกบทที่ระบุใน book.json.chapters — ต้องมีไฟล์เสมอแม้ status เป็น building (§A.2)
      const referencedSlugs = new Set();
      for (const meta of book.chapters || []) {
        referencedSlugs.add(meta.slug);
        const chPath = join(bookDir, `${meta.slug}.json`);
        if (!existsSync(chPath)) {
          errors.push(`books/${bookSlug}/${meta.slug}.json: ไม่พบไฟล์ (ทุกบทต้องมี chNN.json แม้ status เป็น building)`);
          continue;
        }
        filesChecked++;
        const label = `books/${bookSlug}/${meta.slug}.json`;
        const chapter = tryReadJson(chPath, label, errors);
        if (chapter === null) continue;
        // บท status "building" = stub ที่ยังไม่ได้เขียน (เล่ม 2–9 หลัง pipeline/toc_init.py) — ตรวจเฉพาะ meta
        // ให้ตรงกับ book.json (ด้านล่าง) ไม่บังคับ sections/keyPoints/keywords ฯลฯ; draft/ready ตรวจเต็ม schema
        if (chapter.status === "building") {
          for (const e of validateAgainst(chapter, BUILDING_STUB_SCHEMA, label)) errors.push(e);
        } else {
          for (const e of validateAgainst(chapter, schemas.chapter, label)) errors.push(e);
        }

        if (chapter.status !== meta.status) {
          errors.push(
            `${label}: status ("${chapter.status}") ไม่ตรงกับ book.json.chapters[].status ("${meta.status}") — ต้องเท่ากันเสมอ`
          );
        }
        if (chapter.slug !== meta.slug) {
          errors.push(`${label}: chapter.slug ("${chapter.slug}") ไม่ตรงกับชื่อไฟล์/ChapterMeta.slug ("${meta.slug}")`);
        }
        // title/sub/thaiNum/order ต้องตรงกันด้วย ไม่ใช่แค่ status/slug — mismatch จริงเคยหลุดผ่านตอนเป็นแค่ warn
        // (rail/mobnav/mapgrid render จาก book.json แต่หัวบทจริง render จาก chNN.json — ถ้าไม่ตรงคนละข้อความจะโผล่คู่กัน)
        for (const field of ["title", "sub", "thaiNum", "order"]) {
          if (chapter[field] !== meta[field]) {
            errors.push(
              `${label}: ${field} ("${chapter[field]}") ไม่ตรงกับ book.json.chapters[].${field} ("${meta[field]}") — ต้องเท่ากันเสมอ`
            );
          }
        }

        // interactive.position ห้ามเกินจำนวน sections ที่มีจริง มิฉะนั้น UniverseWindow หายไปเงียบๆ ตอน render
        if (chapter.interactive && Array.isArray(chapter.sections)) {
          if (chapter.interactive.position > chapter.sections.length) {
            errors.push(
              `${label}: interactive.position (${chapter.interactive.position}) เกินจำนวน sections (${chapter.sections.length})`
            );
          }
        }
        // bulletsAfter ห้ามเกินจำนวน paragraphs ของ section เดียวกัน
        if (Array.isArray(chapter.sections)) {
          chapter.sections.forEach((section, i) => {
            if (
              section.bulletsAfter !== undefined &&
              Array.isArray(section.paragraphs) &&
              section.bulletsAfter > section.paragraphs.length
            ) {
              errors.push(
                `${label}: sections[${i}].bulletsAfter (${section.bulletsAfter}) เกินจำนวน paragraphs (${section.paragraphs.length})`
              );
            }
          });
        }

        // ทุก string ใต้ interactive.config ห้ามมีแท็ก HTML นอกเหนือจาก <b> (กัน XSS — ความเสี่ยง #11/#4)
        checkInteractiveConfig(chapter, label, errors);

        // dfn ทุกตัวต้องอ้างถึง term ที่มีจริงใน glossary.json ของเล่มนี้ และ data-kind ต้องตรงกับ kind ของ term นั้น
        for (const usage of collectDfnUsages(chapter)) {
          if (!glossaryTerms.has(usage.term)) {
            errors.push(`${label}: <dfn data-term="${usage.term}"> ไม่พบคำนี้ใน books/${bookSlug}/glossary.json`);
          } else if (glossaryTerms.get(usage.term) !== usage.kind) {
            errors.push(
              `${label}: <dfn data-term="${usage.term}" data-kind="${usage.kind}"> ไม่ตรงกับ kind ("${glossaryTerms.get(usage.term)}") ของคำนี้ใน glossary.json`
            );
          }
        }
      }

      // ไฟล์ chNN.json ที่มีอยู่บนดิสก์แต่ไม่ถูกอ้างถึงใน book.json.chapters[] จะไม่ถูกตรวจ/รายงานเลย
      // ถ้าไม่สแกนหาแบบนี้ — กันไฟล์เสีย/ไฟล์เก่าหลุดรอดจน build ไปเจอทีหลัง
      for (const fileName of readdirSync(bookDir)) {
        if (!/^ch[0-9]{2}\.json$/.test(fileName)) continue;
        const slug = fileName.replace(/\.json$/, "");
        if (!referencedSlugs.has(slug)) {
          errors.push(
            `books/${bookSlug}/${fileName}: มีไฟล์อยู่บนดิสก์แต่ไม่ถูกอ้างถึงใน book.json.chapters[] (ไฟล์กำพร้าที่ไม่ถูกตรวจ)`
          );
        }
      }
    }
  }

  // index.json (generated) และ index.example.json (ตัวอย่างอ้างอิง) — ตรวจถ้ามีไฟล์
  for (const indexName of ["index.json", "index.example.json"]) {
    const indexPath = join(contentDir, indexName);
    if (existsSync(indexPath)) {
      filesChecked++;
      const index = tryReadJson(indexPath, indexName, errors);
      if (index !== null) {
        for (const e of validateAgainst(index, schemas.index, indexName)) errors.push(e);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`พบข้อผิดพลาด ${errors.length} จุด (ตรวจแล้ว ${filesChecked} ไฟล์):\n`);
    for (const e of errors) console.error(" - " + e);
    process.exit(1);
  }

  console.log(`ผ่านการตรวจทั้งหมด (${filesChecked} ไฟล์) ไม่พบข้อผิดพลาด`);
  process.exit(0);
}

main();

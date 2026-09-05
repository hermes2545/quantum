// proxy/src/storage.js
//
// จุดเดียวที่ proxy รู้จัก "การเก็บข้อมูล" จริงๆ:
//   - ContentStore adapter (อ่าน content/**) — ตาม §F.2 ของสัญญาระหว่างโมดูล
//   - ProxyError + ตารางข้อความ error ภาษาไทย (§B / §9.5)
//   - ตัวช่วย log 1 บรรทัด (§9.5 — ห้าม log ข้อความคำถาม)
//
// หมายเหตุการตัดสินใจ: รายการไฟล์ที่มอบหมายให้ proxy มีแค่ 7 ไฟล์ (ไม่มี errors.js/context.js
// แยกต่างหากแบบที่ §F.1 ร่างไว้) จึงรวม "โครงสร้างพื้นฐานที่ทุก route ใช้ร่วมกัน" (error taxonomy,
// logging) ไว้ในไฟล์นี้ เพราะทุก route (ask/feedback/source) import storage.js อยู่แล้วเพื่อคุย
// กับ ContentStore — เป็นจุดรวมที่สมเหตุสมผลที่สุดในข้อจำกัดของรายการไฟล์ที่ได้รับมอบหมาย
//
// หมายเหตุ portability (§F.2/§I.10 ความเสี่ยง): ERROR_MESSAGES/ProxyError/jsonError/mapAnthropicError/
// logLine ไม่ผูก Node เลย แต่ ask.js/feedback.js/source.js/retrieval.js ทุกไฟล์ import ตัวเหล่านี้จากไฟล์
// นี้ ถ้า node:fs/node:path/node:stream/node:url ถูก import แบบ static ที่หัวไฟล์ โมดูลกราฟทั้งหมดจะลาก
// Node built-in เข้าไปด้วยแม้ไม่ได้เรียก createFsContentStore เลยก็ตาม (Cloudflare Pages Functions/Workers
// ไม่มี node:fs) จึงย้าย Node built-in ทั้งหมดไปเป็น "import แบบ dynamic เฉพาะตอนเรียก createFsContentStore
// จริง" แทน — ฟังก์ชัน error/logging ด้านบนจึง import ได้แม้บน runtime ที่ไม่มี Node built-in

// @anthropic-ai/sdk ใช้ fetch ล้วน ไม่ผูก Node built-in (ความเสี่ยงข้อ 6 ของสัญญา) จึง import
// แบบ static ได้ตามปกติ ต่างจาก node:fs/node:path/node:stream/node:url ด้านล่าง
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from '@anthropic-ai/sdk';

// ===== ตารางข้อความ error ภาษาไทย (§B ของสัญญาระหว่างโมดูล / §9.5 ของ handoff-spec) =====
// ทุก endpoint (JSON ก่อนเริ่ม stream และ SSE "event: error" ระหว่าง stream) ใช้ตารางเดียวกันนี้
export const ERROR_MESSAGES = {
  bad_request: { status: 400, message: 'คำถามไม่ถูกต้อง ลองพิมพ์ใหม่อีกครั้ง' },
  rate_limited_minute: { status: 429, message: 'ถามถี่ไปนิด รอสักครู่แล้วลองใหม่' },
  rate_limited_day: { status: 429, message: 'วันนี้ถามครบโควตาแล้ว พรุ่งนี้ถามต่อได้' },
  no_key: { status: 503, message: 'ระบบยังไม่ได้ตั้งค่า key' },
  upstream: { status: 502, message: 'ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง' },
  timeout: { status: 504, message: 'ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง' },
  refusal: { status: null, message: 'ผู้ช่วยขอไม่ตอบคำถามนี้ ลองถามในมุมของหนังสือดูนะ' },
  not_found: { status: 404, message: 'ไม่พบไฟล์ต้นฉบับของเล่มนี้' },
  disabled: { status: 403, message: 'ยังไม่เปิดให้ดาวน์โหลดต้นฉบับ' },
};

export class ProxyError extends Error {
  constructor(code, status = ERROR_MESSAGES[code]?.status ?? 400, message = ERROR_MESSAGES[code]?.message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function badRequest(reason) {
  // reason ใช้เพื่อ debug ใน log เท่านั้น ไม่เคยส่งกลับให้ client (ข้อความ client เป็นไทยคงที่)
  const err = new ProxyError('bad_request');
  if (reason) err.reason = reason;
  return err;
}

/** ส่ง JSON error response ตามตาราง ERROR_MESSAGES (ใช้ก่อนเริ่ม SSE stream เท่านั้น) */
export function jsonError(c, code, overrideStatus) {
  const entry = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.upstream;
  const status = overrideStatus ?? entry.status ?? 500;
  return c.json({ error: { code, message: entry.message } }, status);
}

/**
 * แปลง error จากการเรียก Anthropic SDK เป็น {code, message} ตามตาราง §B
 * ลำดับการเช็ค: เฉพาะเจาะจงไปกว้าง (เหมือนที่ข้อกำหนดขอ แต่ปรับชื่อคลาสให้ตรงกับ TS SDK จริง
 * — SDK นี้ไม่มีคลาส APIStatusError แบบ Python ใช้ APIError เป็น base แทน และ
 * APIUserAbortError/APIConnectionError เป็น subclass ของ APIError จึงต้องเช็คก่อน APIError เสมอ
 * — APIConnectionTimeoutError เป็น subclass ของ APIConnectionError จึงต้องเช็คก่อนตัวนั้นด้วย
 * มิฉะนั้นการหมดเวลาจริง (client ตั้ง timeout: 60000) จะถูกจัดเป็น 'upstream' แทน 'timeout')
 */
export function mapAnthropicError(err) {
  if (err instanceof NotFoundError) return { code: 'upstream', message: ERROR_MESSAGES.upstream.message };
  if (err instanceof AuthenticationError) return { code: 'no_key', message: ERROR_MESSAGES.no_key.message };
  if (err instanceof PermissionDeniedError) return { code: 'no_key', message: ERROR_MESSAGES.no_key.message };
  if (err instanceof RateLimitError) return { code: 'upstream', message: ERROR_MESSAGES.upstream.message };
  if (err instanceof APIUserAbortError) return { code: 'timeout', message: ERROR_MESSAGES.timeout.message };
  if (err instanceof APIConnectionTimeoutError) return { code: 'timeout', message: ERROR_MESSAGES.timeout.message };
  if (err instanceof APIConnectionError) return { code: 'upstream', message: ERROR_MESSAGES.upstream.message };
  if (err instanceof APIError) return { code: 'upstream', message: ERROR_MESSAGES.upstream.message };
  return { code: 'upstream', message: ERROR_MESSAGES.upstream.message };
}

/** log บรรทัดเดียวไป stdout — ห้ามมีข้อความคำถาม/คำตอบ (§9.5) */
export function logLine(fields) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
  } catch {
    // การ log ต้องไม่ทำให้ request พัง
  }
}

// ===== ContentStore (fs adapter) — §F.2 ของสัญญาระหว่างโมดูล =====
//
// หมายเหตุการ cache: โหลดทุกไฟล์เข้าหน่วยความจำแบบ lazy (โหลดครั้งแรกที่ถูกขอ) แล้ว cache
// ถาวรตลอดอายุ process — ตรงกับสเปก "โหลด index + ทุก chapter เข้าหน่วยความจำตอน start และ
// ไม่ hot-reload (รีสตาร์ท container หลัง build ใหม่)" ส่วนการโหลดแบบ lazy (แทนที่จะโหลดทุกไฟล์
// ตอน start จริงๆ) เป็นการตัดสินใจเพื่อให้ proxy เริ่มทำงานได้แม้ content/ ยังสร้างไม่ครบ
// (เช่นตอนพัฒนาขนานกับทีมอื่น) — ผลลัพธ์สุดท้ายเหมือนกันคือไม่มีการ hot-reload หลังโหลดสำเร็จ

export function createFsContentStore({ contentDir, sourceDir } = {}) {
  // import Node built-in แบบ dynamic ที่นี่ (ไม่ใช่หัวไฟล์) — เพื่อให้ ERROR_MESSAGES/ProxyError/
  // jsonError/mapAnthropicError/logLine ที่ export จากไฟล์นี้ยัง import ได้บน runtime ที่ไม่มี
  // node:fs/node:path/node:stream/node:url (เช่น Cloudflare Workers) ตราบใดที่ไม่มีใครเรียก
  // createFsContentStore() จริง ๆ (ดูหมายเหตุ portability ด้านบนสุดของไฟล์)
  let fsModPromise;
  let fsPromisesModPromise;
  let pathModPromise;
  let streamModPromise;
  let urlModPromise;
  const nodeMods = async () => {
    fsModPromise ??= import('node:fs');
    fsPromisesModPromise ??= import('node:fs/promises');
    pathModPromise ??= import('node:path');
    streamModPromise ??= import('node:stream');
    urlModPromise ??= import('node:url');
    const [fsMod, fsPromisesMod, pathMod, streamMod, urlMod] = await Promise.all([
      fsModPromise,
      fsPromisesModPromise,
      pathModPromise,
      streamModPromise,
      urlModPromise,
    ]);
    return { fsMod, fsPromisesMod, pathMod, streamMod, urlMod };
  };

  // resolve CONTENT_DIR/SOURCE_DIR แบบ lazy ตั้งแต่เรียกครั้งแรก (ไม่ใช่ตอนสร้าง store) ด้วยเหตุผลเดียวกัน
  let dirsPromise;
  async function resolveDirs() {
    if (dirsPromise) return dirsPromise;
    dirsPromise = (async () => {
      const { pathMod, urlMod } = await nodeMods();
      const dirname = pathMod.dirname(urlMod.fileURLToPath(import.meta.url));
      const CONTENT_DIR = contentDir ? pathMod.resolve(contentDir) : pathMod.resolve(dirname, '..', '..', 'content');
      const SOURCE_DIR = sourceDir ? pathMod.resolve(sourceDir) : pathMod.join(CONTENT_DIR, 'source');
      return { CONTENT_DIR, SOURCE_DIR, pathMod };
    })();
    return dirsPromise;
  }

  const indexCache = { value: null };
  const bookCache = new Map(); // bookSlug -> Book
  const chapterCache = new Map(); // "bookSlug/chapterSlug" -> Chapter | null (null = ไม่มีไฟล์)

  async function readJsonFile(filePath) {
    const { fsPromisesMod } = await nodeMods();
    const raw = await fsPromisesMod.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  }

  async function loadIndex() {
    if (indexCache.value) return indexCache.value;
    const { CONTENT_DIR, pathMod } = await resolveDirs();
    const filePath = pathMod.join(CONTENT_DIR, 'index.json');
    const data = await readJsonFile(filePath); // โยน error ถ้าไฟล์ยังไม่มี/parse ไม่ได้ — ผู้เรียกจัดการเอง
    indexCache.value = data;
    return data;
  }

  async function loadBook(bookSlug) {
    if (bookCache.has(bookSlug)) return bookCache.get(bookSlug);
    const { CONTENT_DIR, pathMod } = await resolveDirs();
    const filePath = pathMod.join(CONTENT_DIR, 'books', bookSlug, 'book.json');
    const data = await readJsonFile(filePath);
    bookCache.set(bookSlug, data);
    return data;
  }

  async function loadChapter(bookSlug, chapterSlug) {
    const key = `${bookSlug}/${chapterSlug}`;
    if (chapterCache.has(key)) return chapterCache.get(key);
    const { CONTENT_DIR, pathMod } = await resolveDirs();
    const filePath = pathMod.join(CONTENT_DIR, 'books', bookSlug, `${chapterSlug}.json`);
    try {
      const data = await readJsonFile(filePath);
      chapterCache.set(key, data);
      return data;
    } catch {
      chapterCache.set(key, null);
      return null;
    }
  }

  async function openSource(bookSlug) {
    // ห้ามรับชื่อไฟล์จาก client — เทียบกับ allowlist ที่มาจาก index.json เท่านั้น (A-01 / §B.4)
    const index = await loadIndex();
    const bookMeta = (index.books ?? []).find((b) => b.slug === bookSlug);
    const file = bookMeta?.sourcePdf?.file;
    if (!file) return null;
    // ป้องกัน path traversal อีกชั้น แม้ข้อมูลจาก index.json ควรผ่าน schema มาแล้วก็ตาม
    if (file.includes('/') || file.includes('\\') || file.startsWith('.')) return null;

    const { SOURCE_DIR, pathMod } = await resolveDirs();
    const { fsMod, fsPromisesMod, streamMod } = await nodeMods();
    const fullPath = pathMod.join(SOURCE_DIR, file);
    let stats;
    try {
      stats = await fsPromisesMod.stat(fullPath);
    } catch {
      return null;
    }
    // ใช้ขนาดไฟล์จริงจาก fs เสมอ ไม่ใช่ book.json.sourcePdf.bytes ที่อาจพิมพ์ผิด (ความเสี่ยงข้อ 15)
    const nodeStream = fsMod.createReadStream(fullPath);
    const webStream = streamMod.Readable.toWeb(nodeStream);
    return { stream: webStream, bytes: stats.size, filename: file };
  }

  // หมายเหตุ: §F.2 ระบุ shape เดิมคืน CONTENT_DIR/SOURCE_DIR แบบ sync แต่ตอนนี้ค่าทั้งสอง resolve
  // แบบ async เท่านั้น (lazy import node:path/node:url ด้านบน) และไม่มี route ใดอ่านสองฟิลด์นี้จริง
  // (grep ยืนยันแล้ว) จึงตัดออกแทนที่จะคง property ที่คืนค่า undefined เสมอไว้ให้สับสน
  return { loadIndex, loadBook, loadChapter, openSource };
}

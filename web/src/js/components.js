/**
 * components.js — ยูทิลิตี้กลางที่ใช้ร่วมกันในไฟล์ที่แพ็กเกจนี้ (web-js) เป็นเจ้าของ
 * (term-sheet.js, ask.js, exercise.js, progress.js, source-footer.js, interactives/particles.js)
 *
 * หมายเหตุการตัดสินใจ: สัญญาระหว่างโมดูล §E.1 อธิบาย tokens.js / store.js / pagedata.js / sse.js / canvas.js
 * เป็นไฟล์แยกที่ "P5" เป็นเจ้าของ แต่รายการไฟล์ที่มอบหมายให้ในงานนี้ระบุเฉพาะ 7 ไฟล์ (ไม่รวมไฟล์ข้างต้น)
 * เพื่อไม่ให้โมดูลของฉันพังเมื่อไฟล์เหล่านั้นยังไม่มี/ถูกสร้างคนละเวลาโดยทีมคู่ขนาน จึงรวมฟังก์ชันที่จำเป็น
 * (คงชื่อ/ลายเซ็นตรงตามสัญญา §E.1 ทุกจุด) ไว้ในไฟล์นี้แทน ไฟล์อื่นนอกเจ้าของก็ import จากที่นี่ได้ตามสบาย
 * เพราะเป็นแค่การอ่าน ไม่ใช่การแก้ไฟล์ที่ไม่ใช่ของตัวเอง
 */

/* ============================================================ */
/* tokens.js equivalent                                          */
/* ============================================================ */

/** อ่านค่า CSS custom property จาก element (ดีฟอลต์ = :root) ตามสัญญา §C — ห้ามมี hex ในโค้ด JS ที่ไหนเลย */
export function cssVar(name, el) {
  try {
    return getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();
  } catch (_e) {
    return '';
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_e) {
    return false;
  }
}

/* ============================================================ */
/* pagedata.js equivalent                                         */
/* ============================================================ */

let _pageDataCache = null;

/** parse #page-data ครั้งเดียวแล้ว cache (§D.7) — โยน Error ถ้าไม่พบ (ไม่ควรเกิดเพราะ layout.html ของ P4 ใส่มาให้ทุกหน้า) */
export function getPageData() {
  if (_pageDataCache) return _pageDataCache;
  const el = document.getElementById('page-data');
  if (!el) throw new Error('ไม่พบ #page-data ในหน้านี้');
  _pageDataCache = JSON.parse(el.textContent);
  return _pageDataCache;
}

/* ============================================================ */
/* store.js equivalent                                           */
/* ============================================================ */

export const PROGRESS_KEY = 'dsl.progress';

export function turnsKey(bookSlug) {
  return `dsl.turns.${bookSlug || '_shelf'}`;
}

/** อ่าน localStorage แบบปลอดภัย — private mode / quota เต็ม / ปิด storage ต้องไม่ทำหน้าเว็บพัง (§9.6) */
export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return JSON.parse(raw);
  } catch (_e) {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_e) {
    return false;
  }
}

/* ============================================================ */
/* ตัวช่วย HTML: escape ข้อความ / กรองแท็กที่อนุญาต                 */
/* ============================================================ */

export function escapeHtml(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * sanitizeInlineHtml — อนุญาตเฉพาะแท็กใน allowedTags (ดีฟอลต์ ['b']) ตัดแท็ก/attribute อื่นทิ้งหมด
 * แต่คงเนื้อความ (text) ไว้ ใช้กับ HTML ที่มาจาก config ของ interactive (เช่น particles lenses, zoom.q)
 * ซึ่งสัญญา §E.4/ความเสี่ยงข้อ 11 บังคับว่าต้องผ่าน allowlist เดียวกับ build.js (<b> เท่านั้น) ก่อน render
 * ด้วย innerHTML — ป้องกัน XSS ถ้าเนื้อหาจาก pipeline หลุด tag แปลกมา
 */
export function sanitizeInlineHtml(html, allowedTags) {
  const allowed = new Set((allowedTags || ['b']).map((t) => String(t).toLowerCase()));
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html === null || html === undefined ? '' : html);
  stripDisallowed(tmp, allowed);
  return tmp.innerHTML;
}

function stripDisallowed(node, allowed) {
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === 1) {
      const tag = child.tagName.toLowerCase();
      if (allowed.has(tag)) {
        while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
        stripDisallowed(child, allowed);
      } else {
        // แท็กไม่อนุญาต: รีเคิร์สลูกก่อน (เผื่อมีแท็กที่อนุญาตซ้อนอยู่ข้างใน) แล้วดันลูกออกมาแทนตัวมันเอง
        stripDisallowed(child, allowed);
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
      }
    } else if (child.nodeType !== 3) {
      // ไม่ใช่ text node และไม่ใช่ element ที่อนุญาต (เช่น comment) — ตัดทิ้ง
      node.removeChild(child);
    }
  });
}

/* ============================================================ */
/* sse.js equivalent — ถอด stream ตามรูปแบบ §B.1 ที่ proxy นิยามเอง  */
/* ============================================================ */

export class AskError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'AskError';
    this.code = code;
    this.status = status;
  }
}

/**
 * streamSSE(url, body, { onEvent(name, data), signal }) — ไม่มี retry อัตโนมัติเด็ดขาด (กฎ 7)
 * โยน AskError({code,message}) เมื่อ HTTP ไม่ ok ก่อนเริ่ม stream หรือเมื่อ fetch ล้มเหลว (เช่น ออฟไลน์)
 * เมื่อ HTTP ok แล้ว จะไม่ throw อีกแม้ proxy ส่ง `event: error` มา — ปล่อยให้ผู้เรียกจัดการผ่าน onEvent เอง
 * (เพราะ error ระหว่าง stream ไม่ใช่ exception ของ fetch แต่เป็น event ปกติตามสัญญา §B.1)
 */
export async function streamSSE(url, body, handlers) {
  const opts = handlers || {};
  const onEvent = opts.onEvent;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw err; // ยกเลิกโดยตั้งใจ ไม่ใช่ error เครือข่าย
    throw new AskError('network', 'ไม่มีอินเทอร์เน็ต');
  }

  if (!res.ok) {
    let code = 'upstream';
    let message = 'ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง';
    try {
      const j = await res.json();
      if (j && j.error) {
        code = j.error.code || code;
        message = j.error.message || message;
      }
    } catch (_e) {
      // parse JSON ไม่ได้ ใช้ fallback ตามตาราง error §B ของสัญญาระหว่างโมดูล
    }
    throw new AskError(code, message, res.status);
  }

  if (!res.body || typeof res.body.getReader !== 'function') {
    // เบราว์เซอร์ที่ไม่รองรับ streaming body เลย — ไม่มีอะไรอ่านต่อได้
    throw new AskError('upstream', 'ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (_e) {
      break; // stream ถูกตัดกลางทาง (เช่นเน็ตหลุด) — จบเงียบๆ ผู้เรียกจะเห็นว่าไม่มี "done" ตามมา
    }
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let idx = buf.indexOf('\n\n');
    while (idx !== -1) {
      parseSSEFrame(buf.slice(0, idx), onEvent);
      buf = buf.slice(idx + 2);
      idx = buf.indexOf('\n\n');
    }
  }
  if (buf.trim()) parseSSEFrame(buf, onEvent); // เผื่อก้อนสุดท้ายไม่มี \n\n ปิดท้าย
}

function parseSSEFrame(raw, onEvent) {
  const lines = raw.split('\n');
  let eventName = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue; // comment / ping ตาม §B.1 ("`: ping` ทุก 15 วินาที")
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  let data;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch (_e) {
    return; // proxy การันตีรูปแบบ JSON บรรทัดเดียวตามสัญญา ถ้า parse ไม่ได้ให้ข้ามเงียบๆ
  }
  if (typeof onEvent === 'function') onEvent(eventName, data);
}

/* ============================================================ */
/* canvas.js equivalent                                           */
/* ============================================================ */

/**
 * fitCanvas(canvas, aspect) — ตั้งขนาด canvas ตามความกว้างจริงของ container (.stage) คูณ dpr (≤2)
 * aspect = สัดส่วนกว้าง:สูง (เช่น 2.5 สำหรับ 900:360 ของต้นแบบ) คืนขนาดหน่วย CSS px ให้วาดแบบสัมพัทธ์เสมอ
 * (§5 ข้อ 2 — ห้ามวาดด้วยเลขตายตัวแบบ 900×360 ต้อง re-fit ตอน resize ด้วย)
 */
export function fitCanvas(canvas, aspect) {
  const parent = canvas.parentElement || canvas;
  const cssWidth = Math.max(1, Math.round(parent.clientWidth || canvas.clientWidth || 300));
  const ratio = aspect && aspect > 0 ? aspect : 2.5;
  const cssHeight = Math.max(1, Math.round(cssWidth / ratio));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { W: cssWidth, H: cssHeight, dpr, ctx };
}

/** debounce ด้วย rAF แล้วเรียก cb เมื่อขนาดจอเปลี่ยน คืนฟังก์ชันสำหรับยกเลิกการฟัง (ไม่ใช้ ResizeObserver
 *  เพื่อความเข้ากันได้กับ Safari iOS 15 ที่รองรับแต่ยังไม่เสถียรทุกเวอร์ชันตอนเขียนสเปกนี้) */
export function onResize(cb) {
  let raf = null;
  const handler = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      cb();
    });
  };
  window.addEventListener('resize', handler);
  window.addEventListener('orientationchange', handler);
  return function unsubscribe() {
    window.removeEventListener('resize', handler);
    window.removeEventListener('orientationchange', handler);
    if (raf) cancelAnimationFrame(raf);
  };
}

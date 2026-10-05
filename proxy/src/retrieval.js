// proxy/src/retrieval.js
//
// การประกอบ context ส่งให้ AI (§9.4 ของ handoff-spec + algorithm ละเอียดใน §B.1 ของสัญญา
// ระหว่างโมดูล) และการตรวจ (validate) รูปร่าง request ของ /api/ask, /api/feedback
//
// ตัว system prompt และการประกอบ context อยู่ใน context.js (ใช้ร่วมกับหน้าเว็บโหมด static)

import { badRequest, ProxyError } from './storage.js';
import { SYSTEM_PROMPT_TEMPLATE, buildAskContext, buildFeedbackContext as buildFeedbackContextCore } from './context.js';

export { SYSTEM_PROMPT_TEMPLATE, buildAskContext };

// ===== validation (§B.1 "Validation") =====

export function validateAskBody(body, index) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('body ไม่ใช่ object');
  const bookSlug = body.bookSlug ?? null;
  const chapterSlug = body.chapterSlug ?? null;
  const turns = body.turns;

  if (bookSlug !== null && typeof bookSlug !== 'string') throw badRequest('bookSlug ผิดชนิด');
  if (chapterSlug !== null && typeof chapterSlug !== 'string') throw badRequest('chapterSlug ผิดชนิด');
  // chapterSlug มีความหมายก็ต่อเมื่อรู้ว่าอยู่เล่มไหน — ไม่มี bookSlug แต่ส่ง chapterSlug มาถือว่าผิดรูป
  // (สัญญาไม่ได้พูดถึงกรณีนี้ตรงๆ จึงเลือกทางที่ปลอดภัยและตรวจสอบได้ที่สุด)
  if (chapterSlug !== null && bookSlug === null) throw badRequest('chapterSlug ไม่มี bookSlug กำกับ');

  if (!Array.isArray(turns) || turns.length < 1 || turns.length > 40) throw badRequest('turns ผิดจำนวน');
  for (const t of turns) {
    if (!t || typeof t !== 'object') throw badRequest('turn ผิดชนิด');
    if (t.role !== 'user' && t.role !== 'assistant') throw badRequest('turn.role ผิดค่า');
    if (typeof t.content !== 'string' || t.content.length > 4000) throw badRequest('turn.content ผิดรูป');
  }
  const last = turns[turns.length - 1];
  if (last.role !== 'user') throw badRequest('turn สุดท้ายต้องเป็น user');
  const trimmedLast = last.content.trim();
  if (trimmedLast.length < 1 || trimmedLast.length > 1000) throw badRequest('ความยาวคำถามสุดท้ายผิดช่วง');

  if (bookSlug !== null) {
    const book = (index.books ?? []).find((b) => b.slug === bookSlug);
    if (!book) throw badRequest('bookSlug ไม่รู้จัก');
    if (chapterSlug !== null) {
      const ch = (book.chapters ?? []).find((c) => c.slug === chapterSlug);
      if (!ch) throw badRequest('chapterSlug ไม่รู้จัก');
    }
  }

  return { bookSlug, chapterSlug, turns };
}

export function validateFeedbackBody(body, index) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('body ไม่ใช่ object');
  const { bookSlug, chapterSlug } = body;
  const option = body.option ?? null;
  const text = body.text;

  if (typeof bookSlug !== 'string' || typeof chapterSlug !== 'string') throw badRequest('bookSlug/chapterSlug บังคับ');
  if (option !== null && (typeof option !== 'string' || option.length > 60)) throw badRequest('option ผิดรูป');
  if (typeof text !== 'string') throw badRequest('text ผิดชนิด');
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) throw badRequest('ความยาว text ผิดช่วง');

  const book = (index.books ?? []).find((b) => b.slug === bookSlug);
  if (!book) throw badRequest('bookSlug ไม่รู้จัก');
  const chMeta = (book.chapters ?? []).find((c) => c.slug === chapterSlug);
  if (!chMeta) throw badRequest('chapterSlug ไม่รู้จัก');

  return { bookSlug, chapterSlug, option, text: trimmed };
}

export async function buildFeedbackContext(store, body) {
  const ctx = await buildFeedbackContextCore(store, body);
  if (!ctx) throw new ProxyError('bad_request', 400, 'บทนี้ไม่มี exercise');
  return ctx;
}

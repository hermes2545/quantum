/**
 * ask.js — AskPanel + FAB (§6, §9.4, §9.5, §E.1/E.3 ของสัญญาระหว่างโมดูล)
 * อ่าน SSE จาก /api/ask ตามรูปแบบ §B.1 (meta/delta/done/error) — ห้าม retry อัตโนมัติ ห้ามเรียก API ตอนโหลดหน้า
 * บับเบิล "กำลังคิด…" เอียง เปลี่ยนเป็นตัวปกติเมื่อเริ่มมี delta / จบ stream, busy flag กันส่งซ้ำ
 */

import { getPageData, readJSON, writeJSON, turnsKey, streamSSE, formatThousands } from './components.js';

/* คำถามแนะนำเมื่ออยู่หน้าที่ไม่มีบทเฉพาะ (shelf/book/glossary) — คัดลอกจาก SUGG.home ของ prototype-artifact.html
   เนื่องจาก PageData (§D.7) มี suggestions ให้เฉพาะ page=chapter|soon เท่านั้น หน้าอื่นสัญญาระบุให้ใช้ชุดนี้ตรงๆ */
const HOME_SUGGESTIONS = [
  'หนังสือเล่มนี้ต่างจากหนังสือธรรมะทั่วไปยังไง',
  'ต้องเชื่อพุทธก่อนไหมถึงจะอ่านได้',
  'ควรอ่านบทไหนก่อนถ้ามีเวลาน้อย',
];

let pageData = null;
let bookSlug = null;
let chapterSlug = null;
let turns = [];
let busy = false;

let elFab = null;
let elAsk = null;
let elClose = null;
let elLog = null;
let elSugg = null;
let elForm = null;
let elInput = null;
let elSubmitBtn = null;

function addMsg(cls, text) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  d.textContent = text; // ห้าม innerHTML เด็ดขาด (ข้อความจากผู้ช่วย/ผู้ใช้ไม่ใช่ HTML ที่เชื่อถือได้)
  elLog.appendChild(d);
  scrollLog();
  return d;
}

function scrollLog() {
  elLog.scrollTop = elLog.scrollHeight;
}

function renderHistory() {
  elLog.innerHTML = '';
  turns.forEach((t) => {
    if (t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string') {
      addMsg(t.role === 'user' ? 'u' : 'a', t.content);
    }
  });
}

function renderSuggestions() {
  let list;
  const page = pageData.page;
  if ((page === 'chapter' || page === 'soon') && pageData.chapter) {
    const s = pageData.chapter.suggestions || [];
    list = page === 'soon' ? s.slice(0, 2) : s.slice(0, 3);
  } else {
    list = HOME_SUGGESTIONS;
  }
  elSugg.innerHTML = '';
  list.forEach((q) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = q;
    elSugg.appendChild(btn);
  });
}

function setBusy(v) {
  busy = v;
  if (elSubmitBtn) elSubmitBtn.disabled = v;
}

export function open(prefill) {
  if (!elAsk) return;
  elAsk.hidden = false;
  if (elFab) elFab.hidden = true;
  if (prefill) {
    send(prefill);
  } else if (elInput) {
    elInput.focus();
  }
}

export function close() {
  if (!elAsk) return;
  elAsk.hidden = true;
  if (elFab) elFab.hidden = false;
}

/** ส่งคำถามเข้า /api/ask — busy flag กันกดซ้ำระหว่างรอ, ไม่มี retry อัตโนมัติเด็ดขาด (กฎ 7) */
export async function send(question) {
  if (busy) return;
  const q = String(question || '').trim();
  if (!q) return;

  const maxLen = (pageData.limits && pageData.limits.question) || 1000;
  if (q.length > maxLen) {
    addMsg('a', `คำถามยาวเกิน ${formatThousands(maxLen)} ตัวอักษร`);
    return;
  }

  addMsg('u', q);
  const thinkEl = addMsg('a think', 'กำลังคิด…');
  setBusy(true);

  const requestTurns = turns.slice(-16).concat([{ role: 'user', content: q }]);
  let finalText = '';
  let streamOk = true;

  try {
    await streamSSE(
      pageData.api.ask,
      { bookSlug, chapterSlug, turns: requestTurns },
      {
        onEvent(name, data) {
          if (name === 'delta' && data && typeof data.text === 'string') {
            finalText += data.text;
            thinkEl.className = 'msg a'; // ตัดตัวเอียงทิ้งทันทีที่เริ่มมีเนื้อความจริง
            thinkEl.textContent = finalText;
            scrollLog();
          } else if (name === 'error') {
            streamOk = false;
            if (finalText) {
              thinkEl.className = 'msg a';
              thinkEl.textContent = finalText;
            } else {
              thinkEl.remove();
            }
            addMsg('a err', (data && data.message) || 'ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง');
          }
          // event "meta"/"done" ไม่มีผลต่อ UI โดยตรงในเฟส 1 (meta คือ context ที่ proxy ใช้, done ปิด stream ปกติ)
        },
      }
    );
  } catch (err) {
    streamOk = false;
    const message = (err && err.message) || 'ตอบไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง';
    if (finalText) {
      thinkEl.className = 'msg a';
      thinkEl.textContent = finalText;
    } else {
      thinkEl.remove();
    }
    addMsg('a err', message);
  }

  if (streamOk && finalText) {
    turns.push({ role: 'user', content: q });
    turns.push({ role: 'assistant', content: finalText });
    if (turns.length > 40) turns = turns.slice(turns.length - 40);
    writeJSON(turnsKey(bookSlug), turns);
  }

  setBusy(false);
  scrollLog();
}

export function init() {
  pageData = getPageData();
  bookSlug = pageData.book ? pageData.book.slug : null;
  chapterSlug = pageData.chapter ? pageData.chapter.slug : null;

  elFab = document.getElementById('fab');
  elAsk = document.getElementById('ask');
  if (!elFab || !elAsk) return;
  elClose = document.getElementById('askclose');
  elLog = document.getElementById('asklog');
  elSugg = document.getElementById('asksugg');
  elForm = document.getElementById('askform');
  elInput = document.getElementById('askin');
  elSubmitBtn = elForm ? elForm.querySelector('button[type="submit"]') : null;

  turns = readJSON(turnsKey(bookSlug), []);
  if (!Array.isArray(turns)) turns = [];
  renderHistory();
  renderSuggestions();

  elFab.addEventListener('click', () => open());
  if (elClose) elClose.addEventListener('click', () => close());

  if (elForm) {
    elForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!elInput) return;
      const q = elInput.value.trim();
      if (!q) return;
      elInput.value = '';
      send(q);
    });
  }

  if (elSugg) {
    elSugg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) send(b.textContent);
    });
  }

  // ".qlist button" ปรากฏได้หลายจุดในหน้า (คำถามท้ายบท, หน้ารอสร้าง) — ผูก event รวมที่ document ตาม §E.3
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.qlist button');
    if (b) open(b.textContent);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elAsk.hidden) close();
  });
}

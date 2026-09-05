/**
 * interactives/trilaksana-quantum/ch03.js — module ของบทที่ ๓ "สายพานในใจ" (§E.4 ของสัญญาระหว่างโมดูล)
 * เดินตามสัญญาเดียวกับ particles.js/ch02.js: export {mount(el,opts), unmount(el), pause(), resume()}
 *
 * แนวคิด: สายโซ่นามขันธ์ ๔ กอง (วิญญาณ → สัญญา → เวทนา → สังขาร → เจตนา) เดินหน้าทีละขั้นด้วยการกดปุ่ม
 * (ไม่ autoplay — อ้างอิง interactive.intro ของบทนี้ "กดเดินหน้าไปทีละขั้น") พร้อมปุ่ม "ใส่สติ" ที่กดได้
 * เฉพาะตอนไปถึงขั้นเวทนาเท่านั้น กดแล้วสายโซ่หยุดกึ่งกลางระหว่างเวทนา↔สังขาร (ช่องว่างที่สติแทรกเข้ามา)
 * แทนที่จะเดินต่อเข้าสังขาร (การปรุงแต่ง) — แสดง config.triggers[].break แทนข้อความขั้นสังขาร/เจตนา
 *
 * @typedef ChainTrigger  สถานการณ์หนึ่งอย่างที่เลือกได้ (ตรงกับ content/books/trilaksana-quantum/ch03.json
 *   ที่มีอยู่แล้ว ณ ตอนเขียนไฟล์นี้ — ไม่ต้องแก้ config เพิ่ม)
 * @property {string} k        คีย์ไม่ซ้ำของสถานการณ์
 * @property {string} name     ชื่อสถานการณ์ (ใช้เป็นข้อความชิปเลือก)
 * @property {string} [col]    เดิมเป็น hex สี — ใช้แค่เป็น "คำใบ้" จับคู่ชื่อ token สี ถ้าไม่ตรงตารางจะไม่ถูก
 *   นำไปวาดตรงๆ (ห้าม hex ในโค้ด JS — §C) จะ fallback ไปวนอ่านชื่อ token ตามลำดับแทน
 * @property {string} winyana  inner HTML ข้อความขั้นวิญญาณ (อนุญาตเฉพาะ <b>)
 * @property {string} sanya    inner HTML ข้อความขั้นสัญญา
 * @property {string} wedana   inner HTML ข้อความขั้นเวทนา
 * @property {string} sankhara inner HTML ข้อความขั้นสังขาร
 * @property {string} cetana   inner HTML ข้อความขั้นเจตนา
 * @property {string} break    inner HTML ข้อความที่แสดงแทน เมื่อกด "ใส่สติ" ที่ขั้นเวทนา (สายโซ่หยุดตรงนี้)
 *
 * config ที่ chNN.json.interactive.config ต้องส่งมา:
 * {
 *   steps: string[5]          ชื่อ 5 ขั้นตามลำดับ ["วิญญาณ","สัญญา","เวทนา","สังขาร","เจตนา"]
 *                             (ต้องมีครบ 5 ช่อง มิฉะนั้นใช้ค่าเริ่มต้นทั้งชุด เพราะช่องว่างสติอ้างอิงตำแหน่ง
 *                             ดัชนี 2↔3 ตรงตัว)
 *   triggers: ChainTrigger[]  สถานการณ์ให้เลือก อย่างน้อย 1 อัน
 *   forwardButtonLabel?, satiButtonLabel?, resetButtonLabel?: string  ป้ายปุ่ม (ถ้าไม่ระบุมีค่าเริ่มต้นในโค้ด)
 * }
 */
import { sanitizeInlineHtml, escapeHtml, cssVar as cssVarDefault, prefersReducedMotion as prefersReducedMotionDefault, fitCanvas as fitCanvasDefault, onResize as onResizeDefault } from '../../components.js';

const STEP_FIELDS = ['winyana', 'sanya', 'wedana', 'sankhara', 'cetana'];
const DEFAULT_STEPS = ['วิญญาณ', 'สัญญา', 'เวทนา', 'สังขาร', 'เจตนา'];
const GAP_AFTER_INDEX = 2; // ช่องว่างที่สติแทรกได้อยู่ระหว่างดัชนี 2 (เวทนา) กับ 3 (สังขาร) เท่านั้น

/* ชื่อ token สีที่ใช้วาดจุดของแต่ละสถานการณ์ — วนใช้ตามลำดับ ไม่มี hex ในไฟล์นี้เลย (§C) */
const COLOR_NAME_CYCLE = ['gold', 'teal', 'pink', 'mint', 'star'];
const COLOR_VAR = { gold: '--dot-gold', teal: '--dot-teal', pink: '--dot-pink', mint: '--night-k', star: '--star' };
/* คำใบ้จาก hex เดิมของ config (ก่อนสัญญานิ่ง) → ชื่อ token ที่ตรงกันเป๊ะเท่านั้น เหมือนแนวทางใน particles.js */
const LEGACY_HEX_HINT = { '#F0A3C8': 'pink', '#8FD3CE': 'mint', '#D9AE4D': 'gold', '#4FB8B2': 'teal', '#EAE6F5': 'star' };

const DEFAULT_TRIGGER = {
  k: 'default',
  name: 'สถานการณ์ตัวอย่าง',
  winyana: 'มีอะไรบางอย่างมากระทบทางประสาทสัมผัสหนึ่งช่องทาง',
  sanya: 'จำได้ทันทีว่าสิ่งนั้นคืออะไร',
  wedana: 'ความรู้สึกชอบ ไม่ชอบ หรือเฉยๆ ผุดขึ้นเอง',
  sankhara: 'ความรู้สึกนั้นเริ่มถูกปรุงต่อเป็นความคิด',
  cetana: 'เกิดความตั้งใจจะพูดหรือทำบางอย่าง',
  break: 'ถ้าจับความรู้สึกได้ทันตรงนี้ เรื่องราวที่จะปรุงต่อก็ไม่จำเป็นต้องเกิด',
};

function ease(u) {
  return u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u;
}

function normalizeTrigger(raw, idx) {
  const t = raw && typeof raw === 'object' ? raw : {};
  const colorName = LEGACY_HEX_HINT[String(t.col || '').toUpperCase()] || COLOR_NAME_CYCLE[idx % COLOR_NAME_CYCLE.length];
  return {
    k: t.k || t.key || `trigger-${idx}`,
    name: t.name || DEFAULT_TRIGGER.name,
    winyana: t.winyana || '',
    sanya: t.sanya || '',
    wedana: t.wedana || '',
    sankhara: t.sankhara || '',
    cetana: t.cetana || '',
    break: t.break || '',
    colorName,
  };
}

/* อ่านโทเค็นสี "ครั้งเดียว" ตอน mount เท่านั้น (§C) — ห้ามอ่านทุกเฟรม ค่าที่อ่านไม่ได้ปล่อยเป็น '' แล้วให้
   draw() ข้ามการวาดชิ้นนั้นไปแทนที่จะ fallback เป็น hex ใดๆ */
function readColors(cssVarFn, el) {
  const dots = {};
  Object.keys(COLOR_VAR).forEach((name) => {
    dots[name] = cssVarFn(COLOR_VAR[name], el) || '';
  });
  return {
    dots,
    nightBg: cssVarFn('--night-2', el) || '',
    nightLine: cssVarFn('--night-line', el) || '',
    nightHi: cssVarFn('--night-hi', el) || '',
  };
}

let current = null;

function nodeCenters(W, H) {
  const margin = W * 0.09;
  const usable = Math.max(1, W - margin * 2);
  const y = H * 0.56;
  const xs = [];
  for (let i = 0; i < 5; i += 1) xs.push(margin + (usable * i) / 4);
  return xs.map((x) => ({ x, y }));
}

function draw(s) {
  const ctx = s.ctx;
  if (!ctx) return;
  const W = s.W;
  const H = s.H;

  if (s.colors.nightBg) {
    ctx.fillStyle = s.colors.nightBg;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.clearRect(0, 0, W, H);
  }

  const centers = nodeCenters(W, H);
  const r = Math.max(5, Math.min(W, H) * 0.15);
  const activeColor = s.colors.dots[s.trigger.colorName] || '';
  const lineColor = s.colors.nightLine || '';
  const hiColor = s.colors.nightHi || '';

  // ตำแหน่งสุดท้ายที่ "ถึงแล้ว" ตอนนี้ (ไม่นับช่องว่างสติ ซึ่งค้างอยู่ระหว่างดัชนี 2↔3 เสมอ)
  const reachedIdx = s.phase;

  // ---- เส้นเชื่อมระหว่างจุด ----
  for (let i = 0; i < centers.length - 1; i += 1) {
    const a = centers[i];
    const b = centers[i + 1];
    const isGapSegment = s.gap && i === GAP_AFTER_INDEX;
    const passed = i < reachedIdx && !isGapSegment;
    ctx.lineWidth = Math.max(1.5, r * 0.16);
    if (isGapSegment) {
      // ช่องว่างที่สติแทรก: เส้นสองท่อนสั้นๆ ทางฝั่งเวทนา และเว้นว่างทางฝั่งสังขาร (ไม่ต่อถึงกัน)
      if (lineColor) {
        ctx.strokeStyle = hiColor || lineColor;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (b.x - a.x) * 0.32, a.y + (b.y - a.y) * 0.32);
        ctx.stroke();
      }
    } else if (lineColor) {
      ctx.strokeStyle = passed && activeColor ? activeColor : lineColor;
      ctx.globalAlpha = passed ? 0.85 : 0.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---- เครื่องหมายช่องว่างสติ (ค้างอยู่กลางเส้น 2↔3 เมื่อ gap=true) ----
  if (s.gap && hiColor) {
    const a = centers[GAP_AFTER_INDEX];
    const b = centers[GAP_AFTER_INDEX + 1];
    const mx = a.x + (b.x - a.x) * 0.5;
    const my = a.y + (b.y - a.y) * 0.5;
    const mr = r * 0.42;
    ctx.strokeStyle = hiColor;
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(mx - mr, my - mr);
    ctx.lineTo(mx + mr, my + mr);
    ctx.moveTo(mx + mr, my - mr);
    ctx.lineTo(mx - mr, my + mr);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- จุดแต่ละขั้น ----
  centers.forEach((c, i) => {
    const beyondGap = s.gap && i > GAP_AFTER_INDEX;
    const isActive = !s.gap && i === reachedIdx;
    const isDone = i < reachedIdx && !beyondGap;
    let radius = r;
    let fill = '';
    let alpha = 1;
    if (beyondGap) {
      radius = r * 0.7;
      fill = lineColor;
      alpha = 0.35;
    } else if (isActive) {
      radius = r * 1.3;
      fill = activeColor || hiColor;
      alpha = 1;
    } else if (isDone) {
      radius = r * 0.95;
      fill = activeColor || hiColor;
      alpha = 0.6;
    } else {
      radius = r * 0.7;
      fill = lineColor;
      alpha = 0.45;
    }
    if (!fill) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(c.x, c.y, radius, 0, 6.28);
    ctx.fill();
    if (isActive && hiColor) {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      ctx.strokeStyle = hiColor;
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius + 3, 0, 6.28);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  // ---- จุดเคลื่อนที่ระหว่างทาง (เฉพาะตอนกำลังทรานสิชัน) ----
  if (s.travel) {
    const a = centers[s.travel.fromIdx];
    const b = centers[s.travel.fromIdx + 1];
    const frac = s.travel.frac || 0;
    const tx = a.x + (b.x - a.x) * frac;
    const ty = a.y + (b.y - a.y) * frac;
    const dotColor = s.travel.kind === 'sati' ? hiColor || activeColor : activeColor || hiColor;
    if (dotColor) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(tx, ty, r * 0.55, 0, 6.28);
      ctx.fill();
    }
  }
}

function stepLabelFor(s) {
  return s.gap ? 'สติ' : s.steps[s.phase] || '';
}

function textFor(s) {
  if (s.gap) return s.trigger.break || '';
  return s.trigger[STEP_FIELDS[s.phase]] || '';
}

function updateReadout(s) {
  const name = stepLabelFor(s);
  const safe = sanitizeInlineHtml(textFor(s), ['b']);
  s.readout.innerHTML = `<span class="k">${escapeHtml(name)}</span> · ${safe}`;
}

function updateSteps(s) {
  s.stepSpans.forEach((span, i) => span.classList.toggle('on', !s.gap && i === s.phase));
}

function updateButtons(s) {
  const busy = !!s.travel;
  s.forwardBtn.hidden = s.gap || s.finished;
  s.forwardBtn.disabled = busy;
  if (!s.forwardBtn.hidden) {
    const nextName = s.steps[s.phase + 1] || '';
    s.forwardBtn.textContent = nextName ? `${s.forwardLabel} · ${nextName}` : s.forwardLabel;
  }
  const satiEligible = !s.gap && !s.finished && s.phase === GAP_AFTER_INDEX;
  s.satiBtn.hidden = !satiEligible;
  s.satiBtn.disabled = busy;
  s.resetBtn.disabled = busy;
}

function finalizeTransition(s, kind, fromIdx) {
  s.travel = null;
  s.raf = null;
  if (kind === 'sati') {
    s.gap = true;
  } else {
    s.phase = fromIdx + 1;
    if (s.phase >= s.steps.length - 1) s.finished = true;
  }
  draw(s);
  updateReadout(s);
  updateSteps(s);
  updateButtons(s);
}

function startTransition(s, kind) {
  if (s.travel) return;
  const fromIdx = s.phase;
  const target = kind === 'sati' ? 0.5 : 1;
  if (s.reducedMotion) {
    finalizeTransition(s, kind, fromIdx);
    return;
  }
  const dur = 550;
  const t0 = performance.now();
  s.travel = { fromIdx, kind, frac: 0 };
  updateButtons(s);
  const frame = (ts) => {
    const p = Math.min(1, (ts - t0) / dur);
    s.travel.frac = target * ease(p);
    draw(s);
    if (p < 1) {
      s.raf = requestAnimationFrame(frame);
    } else {
      finalizeTransition(s, kind, fromIdx);
    }
  };
  s.raf = requestAnimationFrame(frame);
}

function resetChain(s) {
  if (s.raf) {
    cancelAnimationFrame(s.raf);
    s.raf = null;
  }
  s.travel = null;
  s.phase = 0;
  s.gap = false;
  s.finished = false;
  draw(s);
  updateReadout(s);
  updateSteps(s);
  updateButtons(s);
}

export function mount(el, opts) {
  if (!el) return;
  if (current && current.el !== el) unmount(current.el);

  const o = opts || {};
  const config = o.config || {};

  const steps = Array.isArray(config.steps) && config.steps.length === 5 ? config.steps.slice(0, 5) : DEFAULT_STEPS;
  const rawTriggers = Array.isArray(config.triggers) && config.triggers.length ? config.triggers : [DEFAULT_TRIGGER];
  const triggers = rawTriggers.map(normalizeTrigger);
  const forwardLabel = config.forwardButtonLabel || 'เดินหน้า';
  const satiLabel = config.satiButtonLabel || 'ใส่สติ';
  const resetLabel = config.resetButtonLabel || 'เริ่มสถานการณ์ใหม่';

  const cssVarFn = o.cssVar || cssVarDefault;
  const reducedMotion = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotionDefault();
  const fit = o.fitCanvas || fitCanvasDefault;
  const attachResize = o.onResize || onResizeDefault;

  el.innerHTML = '';

  // ---- ชิปเลือกสถานการณ์ ----
  const pickWrap = document.createElement('div');
  pickWrap.className = 'ctl';
  const pick = document.createElement('div');
  pickWrap.appendChild(pick);
  el.appendChild(pickWrap);

  // ---- แถบชื่อ 5 ขั้น ----
  const stepsWrap = document.createElement('div');
  stepsWrap.className = 'zoomsteps';
  const stepSpans = steps.map((name) => {
    const span = document.createElement('span');
    span.textContent = name;
    stepsWrap.appendChild(span);
    return span;
  });
  el.appendChild(stepsWrap);

  // ---- stage + canvas (ภาพประกอบล้วนๆ — ข้อมูลซ้ำอยู่ในแถบขั้น/readout ที่เป็นข้อความอยู่แล้ว) ----
  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);
  el.appendChild(stage);

  // ---- readout ----
  const readout = document.createElement('div');
  readout.className = 'readout';
  readout.setAttribute('aria-live', 'polite');
  el.appendChild(readout);

  // ---- ปุ่มควบคุม ----
  const ctlWrap = document.createElement('div');
  ctlWrap.className = 'ctl';
  const forwardBtn = document.createElement('button');
  forwardBtn.type = 'button';
  forwardBtn.className = 'chip';
  const satiBtn = document.createElement('button');
  satiBtn.type = 'button';
  satiBtn.className = 'chip';
  satiBtn.textContent = satiLabel;
  satiBtn.title = 'แทรกช่องว่างก่อนสังขารจะเริ่มปรุง';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'chip';
  resetBtn.textContent = resetLabel;
  ctlWrap.appendChild(forwardBtn);
  ctlWrap.appendChild(satiBtn);
  ctlWrap.appendChild(resetBtn);
  el.appendChild(ctlWrap);

  const state = {
    el,
    canvas,
    ctx: null,
    W: 900,
    H: 280,
    triggers,
    steps,
    trigger: triggers[0],
    phase: 0,
    gap: false,
    finished: false,
    travel: null,
    raf: null,
    reducedMotion,
    colors: readColors(cssVarFn, el),
    stopResize: null,
    stepSpans,
    readout,
    forwardBtn,
    satiBtn,
    resetBtn,
    forwardLabel,
  };

  // สีของปุ่ม "ใส่สติ" อ่านจาก token ครั้งเดียวตอน mount เหมือนกัน — ไม่มี hex ในไฟล์นี้ (§C)
  if (state.colors.nightHi) {
    satiBtn.style.borderColor = state.colors.nightHi;
    satiBtn.style.color = state.colors.nightHi;
  }

  function renderChips() {
    pick.innerHTML = '';
    triggers.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.i = String(i);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.textContent = t.name;
      pick.appendChild(b);
    });
  }
  renderChips();

  pick.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b || state.travel) return;
    const idx = Number(b.dataset.i);
    state.trigger = triggers[idx] || triggers[0];
    Array.from(pick.querySelectorAll('button')).forEach((btn) => btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false'));
    resetChain(state);
  });

  forwardBtn.addEventListener('click', () => {
    if (state.travel || state.gap || state.finished) return;
    startTransition(state, 'forward');
  });
  satiBtn.addEventListener('click', () => {
    if (state.travel || state.gap || state.finished || state.phase !== GAP_AFTER_INDEX) return;
    startTransition(state, 'sati');
  });
  resetBtn.addEventListener('click', () => resetChain(state));

  function doFit() {
    const result = fit(canvas, 3.4); // แถวจุด 5 ชิ้น ไม่ต้องสูงมาก — วาดตามความกว้างจริงของ .stage เสมอ (§5 ข้อ 2)
    state.W = result.W;
    state.H = result.H;
    state.ctx = result.ctx;
    draw(state);
  }
  doFit();
  state.stopResize = attachResize(doFit);

  updateReadout(state);
  updateSteps(state);
  updateButtons(state);

  current = state;
}

export function unmount(el) {
  if (current && (!el || current.el === el)) {
    if (current.raf) cancelAnimationFrame(current.raf);
    if (current.stopResize) current.stopResize();
    current = null;
  }
  if (el) el.innerHTML = '';
}

export function pause() {
  // ไม่มีลูปต่อเนื่อง มีแค่ทรานสิชันสั้นๆ ตอนกดปุ่ม (≤550ms) — ถ้าหลุดจอกลางทาง ให้ตัดจบทันทีแทนการค้าง
  // กลางอากาศ (จะไม่มีอะไรมาสานต่อให้ เพราะไม่มี rAF loop ต่อเนื่องรอ resume())
  if (current && current.raf) {
    cancelAnimationFrame(current.raf);
    const t = current.travel;
    current.raf = null;
    if (t) finalizeTransition(current, t.kind, t.fromIdx);
  }
}

export function resume() {
  // ไม่มีลูปต่อเนื่องให้เริ่มใหม่ (การเดินหน้าขับเคลื่อนด้วยการกดปุ่มของผู้ใช้ล้วนๆ) — ต้อง export ไว้ตามสัญญา
}

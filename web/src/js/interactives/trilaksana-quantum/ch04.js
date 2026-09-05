/**
 * interactives/trilaksana-quantum/ch04.js — module ของบทที่ ๔ (สไลเดอร์มวลดาว → ชะตาปลายทาง)
 *
 * export ตามสัญญา §E.4 ครบ 4 ตัว: mount(el, opts), unmount(el), pause(), resume() — รูปแบบเดียวกับ
 * particles.js (rAF วนเฉพาะตอนอยู่ในจอ + reducedMotion ใช้ setTimeout ช้าๆ แทน ไม่ใช่หยุดสนิทแบบ ch02.js
 * ที่ไม่มี canvas ต่อเนื่อง) — ที่นี่มี canvas แสดงภาพ "พลังงาน/มวลไหลจากดาวไปเป็นซาก" ต่อเนื่อง จึงต้องมี
 * loop จริงให้ pause()/resume() หยุด/เริ่ม
 *
 * @typedef StarZone
 * @property {number} upTo        เพดานมวล (เท่าดวงอาทิตย์) ของโซนนี้ — เรียงจากน้อยไปมาก โซนสุดท้ายคือ
 *                                 เพดานบนของสไลเดอร์ (ปัจจุบันคือหลุมดำ)
 * @property {string} fate        ชื่อชะตาปลายทาง (plain text แสดงใน <b> ของ readout)
 * @property {string} color       ชื่อโทเค็นสีจุด: "gold" | "teal" | "pink" (map ไป --dot-gold/--dot-teal/
 *                                --dot-pink เท่านั้น ห้ามเป็น hex — ดู COLOR_VAR ด้านล่าง)
 * @property {string} remnantSize inner text บรรยายขนาดซากโดยประมาณ (plain text)
 * @property {string} readout     inner HTML อธิบายโซนนี้ (อนุญาตเฉพาะ <b> ตามสัญญา §E.4/build.js)
 *
 * config ที่ chNN.json.interactive.config ต้องส่งมา (ตรงตาม ch04.json ปัจจุบัน):
 * {
 *   sliderLabel?: string, unit: string, min: number, max: number, step: number, default: number,
 *   lifespanLabel?: string, remnantLabel?: string,
 *   sunLifespanYears?: number (ดีฟอลต์ 1e10 ปี — อายุขัยหลักโดยประมาณของดวงอาทิตย์),
 *   lifespanExponent?: number (ดีฟอลต์ -2.5 — เลขชี้กำลังของสูตรประมาณ อายุขัย ∝ มวล^เลขชี้กำลัง),
 *   zones: StarZone[]
 * }
 * ทุกฟิลด์มีดีฟอลต์สำรอง (ดูค่าคงที่ด้านล่าง) เพื่อให้บทนี้เปิดได้เสมอแม้ config ไม่ครบ (ความเสี่ยงข้อ 3)
 *
 * อายุขัยคำนวณสดจากมวลปัจจุบันด้วยสูตรมาตรฐาน t = sunLifespanYears × mass^lifespanExponent (ความสัมพันธ์
 * มวล-ความส่องสว่างโดยประมาณของดาวลำดับหลัก) ไม่ใช่ค่าคงที่ต่อโซน — ทำให้ตัวเลขขยับต่อเนื่องตามสไลเดอร์จริง
 * ขนาดซากคงที่ต่อโซน (มาจาก config โดยตรง) เพราะมวลซากจริงไม่ได้แปรผันตรงกับมวลตั้งต้นแบบง่ายๆ
 *
 * ห้าม hard-code สี hex ในไฟล์นี้ — อ่านผ่าน cssVar() เท่านั้น: ดาว = --star, ซาก = --dot-gold/--dot-teal/
 * --dot-pink ตามชื่อ color ของโซน, พื้นหลัง = --night-2 (เหมือน particles.js) โทเค็นอ่านครั้งเดียวตอน mount
 * แล้วอ่านซ้ำเฉพาะตอน matchMedia('(prefers-color-scheme: dark)') เปลี่ยน ถ้าอ่านไม่ได้ (ค่าว่าง) ให้ข้าม
 * การวาดชิ้นนั้นไปเลย ไม่ fallback เป็น hex
 *
 * ตัวเลขทั้งหมด (มวล, อายุขัย, ขนาดซาก) แสดงเป็น HTML ใต้แคนวาส (.readout ใช้ font-mono ผ่าน class "mono"
 * ที่มีอยู่แล้วใน base.css) ไม่วาดตัวอักษรบนแคนวาสเลย — เลี่ยงปัญหาอ่านไม่ออกที่ 320px ไปตั้งแต่ต้น (§5 ข้อ 2)
 * แคนวาสมีหน้าที่ให้ "ภาพ" เท่านั้น: วงกลมดาวซ้าย (สเกลตามมวล) → อนุภาคไหลไปทางขวา → ซาก (วงกลมทึบสำหรับ
 * ดาวแคระขาว/นิวตรอน หรือวงแหวนกลวงสำหรับโซนสุดท้ายที่แทนหลุมดำ)
 */
import {
  cssVar as cssVarDefault,
  prefersReducedMotion as prefersReducedMotionDefault,
  fitCanvas as fitCanvasDefault,
  onResize as onResizeDefault,
  sanitizeInlineHtml,
  escapeHtml,
} from '../../components.js';

const DEFAULT_ZONES = [
  { upTo: 8, fate: 'ดาวแคระขาว', color: 'gold', remnantSize: '', readout: '' },
  { upTo: 25, fate: 'ดาวนิวตรอน', color: 'teal', remnantSize: '', readout: '' },
  { upTo: Infinity, fate: 'หลุมดำ', color: 'pink', remnantSize: '', readout: '' },
];

const ENERGY_BY_ZONE_INDEX = [0.4, 0.9, 1.6]; // ความ "รุนแรง" ของการไหลของอนุภาค ตามลำดับโซน (มากกว่านี้ใช้ตัวสุดท้ายซ้ำ)

let current = null;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeZone(raw, fallback) {
  const fb = fallback || DEFAULT_ZONES[DEFAULT_ZONES.length - 1];
  if (!raw || typeof raw !== 'object') return fb;
  return {
    upTo: typeof raw.upTo === 'number' && isFinite(raw.upTo) ? raw.upTo : fb.upTo,
    fate: raw.fate || fb.fate,
    color: raw.color || fb.color,
    remnantSize: raw.remnantSize || fb.remnantSize,
    readout: raw.readout || fb.readout,
  };
}

function zoneIndexForMass(mass, zones) {
  for (let i = 0; i < zones.length; i++) {
    if (mass <= zones[i].upTo) return i;
  }
  return zones.length - 1;
}

/** อ่านโทเค็นสีทั้งหมดที่โมดูลนี้ใช้ "ครั้งเดียว" (ตอน mount และตอน matchMedia เปลี่ยนธีม) */
function readColors(cssVarFn, el) {
  return {
    nightBg: cssVarFn('--night-2', el) || '',
    star: cssVarFn('--star', el) || '',
    dotGold: cssVarFn('--dot-gold', el) || '',
    dotTeal: cssVarFn('--dot-teal', el) || '',
    dotPink: cssVarFn('--dot-pink', el) || '',
  };
}

function colorFor(name, colors) {
  if (name === 'teal') return colors.dotTeal;
  if (name === 'pink') return colors.dotPink;
  return colors.dotGold;
}

/** สูตรประมาณอายุขัยหลักของดาว (ความสัมพันธ์มวล-ความส่องสว่างแบบง่าย): t = sunYears × mass^exponent */
function computeLifespanYears(mass, sunYears, exponent) {
  if (!(mass > 0)) return sunYears;
  return sunYears * Math.pow(mass, exponent);
}

/** ปัดเหลือ ~2 หลักสำคัญ แล้วคืนเป็นสตริงสั้นๆ (ตัดศูนย์ท้ายที่ไม่จำเป็นทิ้งไปในตัว) */
function roundSig2(n) {
  if (!isFinite(n) || n === 0) return '0';
  const sign = n < 0 ? '-' : '';
  return sign + String(parseFloat(Math.abs(n).toPrecision(2)));
}

function formatLifespanText(years) {
  let value = years;
  let unit = 'ปี';
  if (years >= 1e9) {
    value = years / 1e9;
    unit = 'พันล้านปี';
  } else if (years >= 1e6) {
    value = years / 1e6;
    unit = 'ล้านปี';
  } else if (years >= 1e3) {
    value = years / 1e3;
    unit = 'พันปี';
  }
  return '~' + roundSig2(value) + ' ' + unit;
}

function buildParticles(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({ t: Math.random(), sp: 0.6 + Math.random() * 0.8, off: Math.random() * 2 - 1, ph: Math.random() * 6.283 });
  }
  return pts;
}

function stepParticles(s, dt) {
  const energy = ENERGY_BY_ZONE_INDEX[Math.min(s.zoneIndex, ENERGY_BY_ZONE_INDEX.length - 1)] || 0.4;
  for (const p of s.pts) {
    p.t += dt * p.sp * (0.1 + energy * 0.12);
    if (p.t > 1) {
      p.t -= 1;
      p.off = Math.random() * 2 - 1;
      p.ph = Math.random() * 6.283;
    }
  }
}

function draw(s) {
  const ctx = s.ctx;
  const W = s.W;
  const H = s.H;
  if (!ctx) return;

  if (s.colors.nightBg) {
    ctx.fillStyle = s.colors.nightBg;
    ctx.fillRect(0, 0, W, H);
  } else {
    // token ยังอ่านไม่ได้ — เคลียร์พื้นแทนเขียนทับด้วยสีเดา (เหมือน particles.js)
    ctx.clearRect(0, 0, W, H);
  }

  const minSide = Math.min(W, H);
  const cy = H * 0.56;
  const cx1 = W * 0.26;
  const cx2 = W * 0.76;

  const zone = s.zones[s.zoneIndex] || s.zones[0];
  const remColor = colorFor(zone.color, s.colors);
  const isVoid = s.zoneIndex === s.zones.length - 1 && s.zones.length > 1;
  const isDense = !isVoid && s.zoneIndex === 1 && s.zones.length > 2;

  const starR = clamp(minSide * 0.1 + Math.log2(s.mass + 1) * minSide * 0.022, minSide * 0.09, minSide * 0.3);

  let remR;
  if (isVoid) {
    const prevCap = s.zones.length >= 2 ? s.zones[s.zones.length - 2].upTo : 0;
    remR = clamp(minSide * 0.05 + Math.max(0, s.mass - prevCap) * minSide * 0.0015, minSide * 0.05, minSide * 0.16);
  } else if (isDense) {
    remR = clamp(minSide * 0.035, 4, 10);
  } else {
    remR = clamp(starR * 0.5, minSide * 0.06, minSide * 0.14);
  }

  // อนุภาคไหลจากดาว (ซ้าย) ไปซาก (ขวา) — ทึบ/กระจายมากขึ้นตามความรุนแรงของโซน
  if (s.colors.star && remColor) {
    const tm = performance.now() / 1000;
    for (const p of s.pts) {
      const tt = p.t;
      const spread = 0.15 + s.zoneIndex * 0.35;
      const wobble = Math.sin(tt * Math.PI) * minSide * spread * 0.14 * (0.5 + 0.5 * Math.sin(tm * p.sp + p.ph));
      const x = cx1 + (cx2 - cx1) * tt;
      const y = cy + wobble * p.off;
      const alpha = 0.12 + 0.55 * Math.sin(tt * Math.PI);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = tt < 0.5 ? s.colors.star : remColor;
      ctx.beginPath();
      ctx.arc(x, y, 1.1 + tt * 1.3, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // เส้นประจางๆ เชื่อมดาว-ซาก (rgba โปร่งใสไม่ผูกกับ token สี — ตามที่สัญญา §C อนุญาตไว้เหมือน particles.js)
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(cx1 + starR, cy);
  ctx.lineTo(cx2 - remR, cy);
  ctx.stroke();
  ctx.setLineDash([]);

  // ดาว: แกนกลาง + ฮาโลจาง
  if (s.colors.star) {
    for (let i = 3; i >= 1; i--) {
      ctx.globalAlpha = 0.05 * i;
      ctx.fillStyle = s.colors.star;
      ctx.beginPath();
      ctx.arc(cx1, cy, starR + i * minSide * 0.02, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.colors.star;
    ctx.beginPath();
    ctx.arc(cx1, cy, starR, 0, 6.283);
    ctx.fill();
  }

  // ซาก: วงกลมทึบ (ดาวแคระขาว/นิวตรอน) หรือวงแหวนกลวง (โซนสุดท้าย = หลุมดำ ไม่ fill พื้นที่ในเลย)
  if (remColor) {
    if (isVoid) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = remColor;
      ctx.lineWidth = Math.max(2, minSide * 0.012);
      ctx.beginPath();
      ctx.arc(cx2, cy, remR, 0, 6.283);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.arc(cx2, cy, remR * 1.6, 0, 6.283);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      for (let i = 2; i >= 1; i--) {
        ctx.globalAlpha = 0.08 * i;
        ctx.fillStyle = remColor;
        ctx.beginPath();
        ctx.arc(cx2, cy, remR + i * minSide * 0.025, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = remColor;
      ctx.beginPath();
      ctx.arc(cx2, cy, remR, 0, 6.283);
      ctx.fill();
    }
  }
}

function updateReadout(s) {
  const z = s.zones[s.zoneIndex] || s.zones[0];
  const massStr = String(Math.round(s.mass * 100) / 100);
  const massText = massStr + ' ' + s.unit;
  const years = computeLifespanYears(s.mass, s.sunLifespanYears, s.lifespanExponent);
  const lifespanText = formatLifespanText(years);
  // อนุญาตเฉพาะ <b> ตามสัญญา §E.4 — เนื้อหามาจาก config ของ pipeline ต้องผ่าน allowlist เดียวกับ build.js เสมอ
  const readoutSafe = sanitizeInlineHtml(z.readout || '', ['b']);
  s.readoutEl.innerHTML =
    '<b>' + escapeHtml(z.fate || '') + '</b> · <span class="mono">' + escapeHtml(massText) + '</span>' +
    '<br>' + readoutSafe +
    '<br>' + escapeHtml(s.lifespanLabel) + ': <span class="mono">' + escapeHtml(lifespanText) + '</span>' +
    '<br>' + escapeHtml(s.remnantLabel) + ': <span class="mono">' + escapeHtml(z.remnantSize || '') + '</span>';
}

function loopStep() {
  if (!current || !current.running) return;
  const now = performance.now();
  const dt = Math.min(0.25, Math.max(0, (now - current.lastTime) / 1000));
  current.lastTime = now;
  stepParticles(current, dt);
  draw(current);
  if (current.reducedMotion) {
    // prefers-reduced-motion: วาดช้าๆ ด้วย setTimeout แทน rAF ถี่ๆ (§5 ข้อ 9) — ยังขยับอยู่ แค่ช้าลงมาก
    current.raf = setTimeout(loopStep, 200);
  } else {
    current.raf = requestAnimationFrame(loopStep);
  }
}

function startLoop() {
  if (!current || current.running) return;
  current.running = true;
  current.lastTime = performance.now();
  loopStep();
}

function stopLoop() {
  if (!current) return;
  current.running = false;
  if (current.raf) {
    if (current.reducedMotion) clearTimeout(current.raf);
    else cancelAnimationFrame(current.raf);
    current.raf = null;
  }
}

export function mount(el, opts) {
  if (!el) return;
  if (current && current.el !== el) unmount(current.el); // กันมี loop ค้างหลายชุดถ้าถูกเรียก mount ซ้อน

  const o = opts || {};
  const config = o.config || {};

  const rawZones = Array.isArray(config.zones) && config.zones.length ? config.zones : DEFAULT_ZONES;
  const zones = rawZones
    .map((z, i) => normalizeZone(z, DEFAULT_ZONES[i] || DEFAULT_ZONES[DEFAULT_ZONES.length - 1]))
    .sort((a, b) => a.upTo - b.upTo);

  const min = typeof config.min === 'number' ? config.min : 0.5;
  const max = typeof config.max === 'number' && config.max > min ? config.max : 40;
  const step = typeof config.step === 'number' && config.step > 0 ? config.step : 0.5;
  const def = typeof config.default === 'number' ? clamp(config.default, min, max) : clamp(1, min, max);
  const sliderLabel = config.sliderLabel || 'มวลตั้งต้นของดาว';
  const unit = config.unit || 'เท่าของมวลดวงอาทิตย์ (M-sun)';
  const lifespanLabel = config.lifespanLabel || 'อายุขัยหลักโดยประมาณ';
  const remnantLabel = config.remnantLabel || 'ขนาดซากโดยประมาณ';
  const sunLifespanYears = typeof config.sunLifespanYears === 'number' && config.sunLifespanYears > 0 ? config.sunLifespanYears : 1e10;
  const lifespanExponent = typeof config.lifespanExponent === 'number' ? config.lifespanExponent : -2.5;

  const cssVarFn = o.cssVar || cssVarDefault;
  const reducedMotion = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotionDefault();
  const fit = o.fitCanvas || fitCanvasDefault;
  const attachResize = o.onResize || onResizeDefault;

  el.innerHTML = '';

  // ---- slider มวล ----
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'ctl';
  const sliderId = 'ix-mass-' + Math.random().toString(36).slice(2, 8);
  const label = document.createElement('label');
  label.setAttribute('for', sliderId);
  label.textContent = sliderLabel;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = sliderId;
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(def);
  sliderWrap.appendChild(label);
  sliderWrap.appendChild(slider);
  el.appendChild(sliderWrap);

  // ---- stage + canvas ----
  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true'); // ข้อมูลสำคัญซ้ำอยู่ใน readout ที่เป็นข้อความอยู่แล้ว
  stage.appendChild(canvas);
  el.appendChild(stage);

  // ---- readout ----
  const readout = document.createElement('div');
  readout.className = 'readout';
  readout.setAttribute('aria-live', 'polite');
  el.appendChild(readout);

  const state = {
    el,
    canvas,
    ctx: null,
    W: 900,
    H: 380,
    dpr: 1,
    zones,
    unit,
    lifespanLabel,
    remnantLabel,
    sunLifespanYears,
    lifespanExponent,
    mass: def,
    zoneIndex: zoneIndexForMass(def, zones),
    pts: buildParticles(46),
    raf: null,
    running: false,
    lastTime: 0,
    reducedMotion,
    cssVarFn,
    colors: readColors(cssVarFn, el),
    mql: null,
    onSchemeChange: null,
    stopResize: null,
    io: null,
    slider,
    readoutEl: readout,
  };

  slider.addEventListener('input', (e) => {
    state.mass = clamp(parseFloat(e.target.value), min, max);
    state.zoneIndex = zoneIndexForMass(state.mass, zones);
    updateReadout(state);
    if (state.reducedMotion) draw(state); // โหมดลดการเคลื่อนไหว: วาดเฉพาะตอนมีการโต้ตอบจริง ไม่ปล่อยลูปถี่ๆ
  });

  function doFit() {
    const result = fit(canvas, 2.3); // วาดตามความกว้างจริงของ .stage เสมอ (§5 ข้อ 2)
    state.W = result.W;
    state.H = result.H;
    state.dpr = result.dpr;
    state.ctx = result.ctx;
    draw(state);
  }
  doFit();
  state.stopResize = attachResize(doFit);

  // อ่านโทเค็นสีใหม่เฉพาะตอนธีมเปลี่ยนจริง (§C) — ไม่ใช่ทุกเฟรม; addEventListener มีใน iOS 15+ แต่กันพลาด
  // ด้วย addListener แบบเก่าไว้ด้วย (Safari รุ่นก่อนหน้านั้น)
  try {
    state.mql = window.matchMedia('(prefers-color-scheme: dark)');
    state.onSchemeChange = () => {
      state.colors = readColors(cssVarFn, el);
      draw(state);
    };
    if (typeof state.mql.addEventListener === 'function') state.mql.addEventListener('change', state.onSchemeChange);
    else if (typeof state.mql.addListener === 'function') state.mql.addListener(state.onSchemeChange);
  } catch (_e) {
    state.mql = null;
  }

  updateReadout(state);

  current = state;

  // เล่นเฉพาะตอนอยู่ในจอจริง (ประหยัดแบตมือถือ) — กลไกสำรองของโมดูลเองนอกเหนือจาก pause()/resume()
  // ที่ตัว loader ภายนอกอาจเรียกด้วย (ทั้งสองทางทำงานร่วมกันได้เพราะ startLoop/stopLoop idempotent)
  const nightSection = el.closest('.night') || el;
  if (typeof IntersectionObserver !== 'undefined') {
    state.io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) startLoop();
        else stopLoop();
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
    state.io.observe(nightSection);
  } else {
    startLoop(); // เบราว์เซอร์เก่ามากไม่มี IntersectionObserver — เปิดลูปตรงๆ แทนไม่วาดอะไรเลย
  }
}

export function unmount(el) {
  if (current && (!el || current.el === el)) {
    stopLoop();
    if (current.io) current.io.disconnect();
    if (current.stopResize) current.stopResize();
    if (current.mql && current.onSchemeChange) {
      if (typeof current.mql.removeEventListener === 'function') current.mql.removeEventListener('change', current.onSchemeChange);
      else if (typeof current.mql.removeListener === 'function') current.mql.removeListener(current.onSchemeChange);
    }
    current = null;
  }
  if (el) el.innerHTML = '';
}

export function pause() {
  stopLoop();
}

export function resume() {
  startLoop();
}

/**
 * interactives/particles.js — UniverseWindow กลาง "particles" (§E.4 ของสัญญาระหว่างโมดูล, มาจาก ix1 ของ
 * prototype-artifact.html) ใช้กับบทที่ยังไม่มี interactive เขียนมือเฉพาะบท
 *
 * export ตามสัญญา §E.4 ครบ 4 ตัว: mount(el, opts), unmount(el), pause(), resume()
 * รองรับการ mount ครั้งละหนึ่งชิ้นต่อหน้า (ตามการใช้งานจริง: หนึ่ง #ix-root ต่อหนึ่งบท) — pause/resume ไม่รับ
 * argument ตามสัญญา จึงอ้างอิง instance ปัจจุบันตัวเดียว (`current`) แทนการเก็บหลาย instance พร้อมกัน
 *
 * ห้าม hard-code สี hex ในไฟล์นี้ — สีทั้งหมดอ่านผ่าน cssVar() จาก tokens ตามตาราง mapping ใน §E.4:
 * gold|teal|pink|star|mint -> --dot-gold|--dot-teal|--dot-pink|--star|--night-k
 * โทเค็นทั้งหมดอ่านครั้งเดียวตอน mount แล้วอ่านซ้ำเฉพาะตอน matchMedia('(prefers-color-scheme: dark)') เปลี่ยน
 * ตามที่ §C กำหนด (ห้าม getComputedStyle ทุกเฟรม) ถ้าโทเค็นใดอ่านไม่ได้ (สตริงว่าง) ให้ "ข้าม" การวาดชิ้นนั้น
 * ไปเลย — ไม่มีข้อยกเว้นให้ fallback เป็นค่า hex ใดๆ ในโค้ด JS
 */

import {
  cssVar as cssVarDefault,
  prefersReducedMotion as prefersReducedMotionDefault,
  fitCanvas as fitCanvasDefault,
  onResize as onResizeDefault,
  sanitizeInlineHtml,
  escapeHtml,
} from '../components.js';

const COLOR_VAR = {
  gold: '--dot-gold',
  teal: '--dot-teal',
  pink: '--dot-pink',
  star: '--star',
  mint: '--night-k',
};

/* mapping เฉพาะกิจสำหรับ config รูปแบบเก่าก่อนสัญญานิ่ง {k, col:"#hex", a, d, n} (ความเสี่ยงข้อ 2/7 ของ
   สัญญาระหว่างโมดูล — seed อาจยังไม่ตรง §E.4) แปลง hex เป็น "ชื่อ" palette ที่รู้จักเท่านั้น แล้วปล่อยให้
   resolveColor อ่าน token จริงต่อ — hex ที่มาจาก config ไม่เคยถูกเขียนลง ctx.fillStyle ตรงๆ */
const LEGACY_HEX_TO_NAME = {
  '#8FD3CE': 'mint',
  '#F0A3C8': 'pink',
  '#D9AE4D': 'gold',
  '#4FB8B2': 'teal',
  '#EAE6F5': 'star',
};

const DEFAULT_LENS_LABELS = [
  { key: 'a', pali: 'อนิจจัง', th: 'ไม่เที่ยง' },
  { key: 'd', pali: 'ทุกขัง', th: 'ทนอยู่เดิมไม่ได้' },
  { key: 'n', pali: 'อนัตตา', th: 'ไม่มีตัวตนแท้จริง' },
];
const DEFAULT_PHASES = ['เกิดขึ้น', 'ตั้งอยู่', 'ดับไป'];
/* ออบเจกต์สำรอง — ใช้เมื่อ config.objects ว่างหรือหายไป กันไม่ให้ interactive พังจนบทเปิดไม่ได้เลย
   (หมายเหตุความเสี่ยงข้อ 3 ของสัญญา: "ทุกบทต้องเปิดได้เสมอ") */
const DEFAULT_OBJECT = {
  key: 'thing',
  name: 'สิ่งหนึ่ง',
  color: 'mint',
  shape: 'blob',
  lenses: {
    a: 'สิ่งนี้กำลังเปลี่ยนอยู่ทุกขณะ แม้จะดูเหมือนนิ่ง',
    d: 'สิ่งนี้ทนอยู่ในสภาพเดิมไม่ได้ ไม่ว่าจะพยายามรักษาแค่ไหน',
    n: 'แยกส่วนดูแล้วไม่มีชิ้นไหนเป็น "ตัวมันเอง" ที่แท้จริงเลยสักชิ้น',
  },
};

/**
 * normalizeObject — แปลง object ของ config.objects ให้เข้ารูปตามสัญญา §E.4 เสมอ: {key,name,color,shape,lenses}
 * รองรับทั้งรูปแบบปัจจุบัน ({color: "gold"|"teal"|...}) และรูปแบบเก่าก่อนสัญญานิ่งที่ยังมี hex ({k,col,a,d,n})
 * เพื่อไม่ให้ seed ที่ยังไม่ตรงสัญญาทำให้ทั้งบทเปิดไม่ได้ (ดูความเสี่ยงข้อ 2/7) คืน null ถ้าไม่ใช่ object เลย
 */
function normalizeObject(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.lenses || (raw.color && typeof raw.color === 'string')) {
    return {
      key: raw.key || raw.k || '',
      name: raw.name || raw.key || raw.k || '',
      color: raw.color || 'mint',
      shape: raw.shape || 'blob',
      lenses: raw.lenses || { a: raw.a || '', d: raw.d || '', n: raw.n || '' },
    };
  }
  const colorName = LEGACY_HEX_TO_NAME[String(raw.col || '').toUpperCase()] || 'mint';
  return {
    key: raw.k || raw.key || '',
    name: raw.name || raw.k || raw.key || '',
    color: colorName,
    shape: raw.shape || 'blob',
    lenses: { a: raw.a || '', d: raw.d || '', n: raw.n || '' },
  };
}

/* ---------------------------------------------------------------- */
/* ฟังก์ชันรูปทรง (พื้นที่ x,y อยู่ในช่วง -1..1) — คัดลอกตรรกะจาก ix1 ของ prototype ทุกฟังก์ชัน           */
/* ---------------------------------------------------------------- */
const SHAPES = {
  phone(x, y) {
    const body = Math.abs(x) < 0.32 && Math.abs(y) < 0.66;
    const screen = Math.abs(x) < 0.27 && y > -0.56 && y < 0.52;
    const btn = Math.hypot(x, y - 0.6) < 0.035;
    return (body && (!screen || Math.hypot(x, y) < 0.12 || Math.abs(y + 0.3) < 0.02 || Math.abs(y - 0.3) < 0.02)) || btn;
  },
  flower(x, y) {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    return r < 0.18 || (r < 0.42 + 0.18 * Math.cos(6 * a) && r > 0.2) || (Math.abs(x) < 0.03 && y > 0.2 && y < 0.75);
  },
  body(x, y) {
    const head = Math.hypot(x, y + 0.62) < 0.15;
    const torso = Math.abs(x) < 0.18 && y > -0.45 && y < 0.1;
    const arms = Math.abs(y + 0.3) < 0.06 && Math.abs(x) < 0.42;
    const legs = y > 0.1 && y < 0.7 && (Math.abs(x - 0.1) < 0.07 || Math.abs(x + 0.1) < 0.07);
    return head || torso || arms || legs;
  },
  star(x, y) {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    return r < 0.25 + 0.32 * Math.pow(Math.max(0, Math.cos(5 * a)), 3);
  },
  anger(x, y) {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    return r < 0.38 + 0.12 * Math.sin(9 * a) + 0.08 * Math.sin(3 * a + 1);
  },
  /* "blob" ไม่มีในต้นแบบ (prototype มีแค่ 5 shape) แต่สัญญา §E.4 ระบุ enum นี้ไว้ด้วย — เพิ่มก้อนกลมยับทั่วไป
     ไว้ใช้แทนวัตถุที่ยังไม่มีรูปทรงเจาะจง (รวมถึงใช้เป็นดีฟอลต์เมื่อ config ไม่สมบูรณ์) */
  blob(x, y) {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    return r < 0.4 + 0.1 * Math.sin(5 * a) + 0.06 * Math.sin(11 * a + 1.3);
  },
};

function ease(u) {
  return u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u;
}

/* instance ปัจจุบัน — ดูคอมเมนต์หัวไฟล์เรื่องเหตุผลที่ไม่ใช้ WeakMap หลาย instance */
let current = null;

function rnd(s) {
  s.seed = (s.seed * 16807) % 2147483647;
  return s.seed / 2147483647;
}

function build(s) {
  s.seed = 7;
  s.pts = [];
  const shapeFn = SHAPES[s.obj.shape] || SHAPES.blob;
  let guard = 0;
  const N = 480;
  while (s.pts.length < N && guard < 30000) {
    guard += 1;
    const x = rnd(s) * 2 - 1;
    const y = rnd(s) * 2 - 1;
    if (shapeFn(x, y)) {
      s.pts.push({ x, y, rx: rnd(s) * 2 - 1, ry: rnd(s) * 2 - 1, ph: rnd(s) * 6.28, sp: 0.5 + rnd(s) });
    }
  }
}

/**
 * readColors — อ่านโทเค็นสีทั้งหมดที่โมดูลนี้ใช้ "ครั้งเดียว" (ตอน mount และตอน matchMedia เปลี่ยนธีม)
 * ค่าที่อ่านไม่ได้ (เช่น token ยังไม่พร้อมตอนเฟรมแรกสุด) ปล่อยเป็น '' แล้วให้ draw() ข้ามการวาดชิ้นนั้นไป
 * แทนที่จะ fallback เป็น hex (§C ห้ามมี hex ใน JS โดยไม่มีข้อยกเว้น)
 */
function readColors(cssVarFn, el) {
  const dots = {};
  Object.keys(COLOR_VAR).forEach((name) => {
    dots[name] = cssVarFn(COLOR_VAR[name], el) || '';
  });
  return {
    dots,
    nightBg: cssVarFn('--night-2', el) || '',
    nightText: cssVarFn('--night-text', el) || '',
    nightMute: cssVarFn('--night-mute', el) || '',
  };
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
    // token ยังอ่านไม่ได้ — เคลียร์พื้นแทนเขียนทับด้วยสีเดา ดีกว่าปล่อย hex เข้ามาใน fillStyle
    ctx.clearRect(0, 0, W, H);
  }

  // เส้นกริดจางๆ — rgba โปร่งใสไม่ผูกกับ token สี จึงเขียนเป็นค่าคงที่ได้ตามที่สัญญา §C อนุญาตไว้ (เหมือน .lens ใน base.css)
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  const gridStep = Math.max(30, W / 15);
  for (let x = 0; x < W; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  const cx = W / 2;
  const cy = H / 2;
  const S = Math.min(W, H * 2.2) * 0.32; // สเกลตามขนาดจริงของแคนวาส แทนค่าคงที่ 150px ของต้นแบบ (§5 ข้อ 2)

  const nPhases = s.phases.length || 3;
  const t1 = 1 / nPhases;
  const t2 = (nPhases - 1) / nPhases;
  let assemble;
  let wear = 0;
  if (s.t < t1) {
    assemble = ease(s.t / t1);
  } else if (s.t < t2) {
    assemble = 1;
    wear = (s.t - t1) / Math.max(0.0001, t2 - t1);
  } else {
    assemble = 1 - ease((s.t - t2) / Math.max(0.0001, 1 - t2));
  }
  const phaseIdx = s.t < t1 ? 0 : s.t < t2 ? 1 : nPhases - 1;

  const tm = performance.now() / 1000;
  const color = s.colors.dots[s.obj.color] || s.colors.dots.mint || '';
  if (color) {
    for (const p of s.pts) {
      const jitter = (1 - assemble) * 1.2 + wear * 0.05;
      const fx = p.x * S;
      const fy = p.y * S;
      const dx = p.rx * W * 0.55;
      const dy = p.ry * H * 0.55;
      const x = cx + fx * assemble + dx * (1 - assemble) + Math.sin(tm * p.sp + p.ph) * 3 * jitter * 10;
      const y = cy + fy * assemble + dy * (1 - assemble) + Math.cos(tm * p.sp + p.ph) * 3 * jitter * 10;
      const alpha = 0.25 + 0.7 * assemble * (1 - wear * 0.5);
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, 1.6 + assemble * 1.2, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ตัวอักษรบนแคนวาส: สเกลตามความกว้างจริง ขั้นต่ำ 12px เพื่ออ่านออกที่ 320px (§5 ข้อ 2)
  const fontSize = Math.max(12, Math.round(W / 60));
  if (s.colors.nightText) {
    ctx.fillStyle = s.colors.nightText;
    ctx.font = `500 ${fontSize}px Sarabun, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(s.obj.name + ' · ' + (s.phases[phaseIdx] || ''), 14, H - 14);
  }

  if (s.colors.nightMute) {
    ctx.textAlign = 'right';
    ctx.fillStyle = s.colors.nightMute;
    // ขั้นต่ำ 12px เสมอ (เดิมมี Math.max(11, …) ซึ่งต่ำกว่าเกณฑ์ §5 ข้อ 2 ที่ W=320 พอดี)
    ctx.font = `${Math.max(12, fontSize - 2)}px 'IBM Plex Mono', monospace`;
    ctx.fillText('t = ' + ((s.t * 100) | 0) + '%', W - 14, H - 14);
  }

  s.phaseDivs.forEach((d, i) => d.classList.toggle('on', i === phaseIdx));
}

function updateReadout(s) {
  if (!s.lens) {
    s.readout.textContent = s.emptyReadout;
    return;
  }
  const labelInfo = s.lensLabels.find((l) => l.key === s.lens);
  const name = labelInfo ? labelInfo.pali : s.lens;
  const raw = s.obj.lenses ? s.obj.lenses[s.lens] : '';
  // อนุญาตเฉพาะ <b> ตามสัญญา §E.4 — เนื้อหามาจาก config ของ pipeline ต้องผ่าน allowlist เดียวกับ build.js เสมอ
  const safe = sanitizeInlineHtml(raw, ['b']);
  s.readout.innerHTML = `<span class="k">${escapeHtml(name)}</span> · ${safe}`;
}

function loopStep() {
  if (!current || !current.running) return;
  draw(current);
  if (current.reducedMotion) {
    // prefers-reduced-motion: วาดช้าๆ ด้วย setTimeout แทน rAF ถี่ๆ (§5 ข้อ 9)
    current.raf = setTimeout(loopStep, 200);
  } else {
    current.raf = requestAnimationFrame(loopStep);
  }
}

function startLoop() {
  if (!current || current.running) return;
  current.running = true;
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
  const rawObjects = Array.isArray(config.objects) && config.objects.length ? config.objects : [DEFAULT_OBJECT];
  const normalized = rawObjects.map(normalizeObject).filter(Boolean);
  const objects = normalized.length ? normalized : [DEFAULT_OBJECT];
  const lensLabels = Array.isArray(config.lensLabels) && config.lensLabels.length ? config.lensLabels : DEFAULT_LENS_LABELS;
  const phases = Array.isArray(config.phases) && config.phases.length ? config.phases : DEFAULT_PHASES;
  const initialT = typeof config.initialT === 'number' ? config.initialT : 0.38;
  const timeLabel = config.timeLabel || 'เวลา';
  const emptyReadout = config.emptyReadout || 'เลือกแว่นสักอันด้านบน';

  const cssVarFn = o.cssVar || cssVarDefault;
  const reducedMotion = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotionDefault();
  const fit = o.fitCanvas || fitCanvasDefault;
  const attachResize = o.onResize || onResizeDefault;

  el.innerHTML = '';

  // ---- controls บน: ชิปเลือกวัตถุ ----
  const pickWrap = document.createElement('div');
  pickWrap.className = 'ctl';
  const pick = document.createElement('div');
  pickWrap.appendChild(pick);
  el.appendChild(pickWrap);

  // ---- stage + canvas ----
  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true'); // ข้อมูลสำคัญซ้ำอยู่ใน readout/phase/lens ที่เป็นข้อความอยู่แล้ว
  stage.appendChild(canvas);
  el.appendChild(stage);

  // ---- slider เวลา ----
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'ctl';
  const sliderId = 'ix-t-' + Math.random().toString(36).slice(2, 8);
  const label = document.createElement('label');
  label.setAttribute('for', sliderId);
  label.textContent = timeLabel;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = sliderId;
  slider.min = '0';
  slider.max = '1000';
  slider.value = String(Math.round(initialT * 1000));
  sliderWrap.appendChild(label);
  sliderWrap.appendChild(slider);
  el.appendChild(sliderWrap);

  // ---- แถบเฟส ----
  const phaseWrap = document.createElement('div');
  phaseWrap.className = 'phase';
  const phaseDivs = phases.map((p) => {
    const d = document.createElement('div');
    d.textContent = p;
    phaseWrap.appendChild(d);
    return d;
  });
  el.appendChild(phaseWrap);

  // ---- สามแว่น ----
  const lensWrap = document.createElement('div');
  lensWrap.className = 'lens';
  lensLabels.forEach((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.l = l.key;
    b.setAttribute('aria-pressed', 'false');
    const pali = document.createElement('span');
    pali.className = 'pali';
    pali.textContent = l.pali || l.key;
    const th = document.createElement('span');
    th.className = 'th';
    th.textContent = l.th || '';
    b.appendChild(pali);
    b.appendChild(th);
    lensWrap.appendChild(b);
  });
  el.appendChild(lensWrap);

  // ---- readout ----
  const readout = document.createElement('div');
  readout.className = 'readout';
  readout.setAttribute('aria-live', 'polite');
  readout.textContent = emptyReadout;
  el.appendChild(readout);

  const state = {
    el,
    canvas,
    ctx: null,
    W: 900,
    H: 360,
    dpr: 1,
    objects,
    lensLabels,
    phases,
    emptyReadout,
    obj: objects[0],
    t: initialT,
    lens: null,
    pts: [],
    seed: 1,
    raf: null,
    running: false,
    reducedMotion,
    cssVarFn,
    colors: readColors(cssVarFn, el),
    mql: null,
    onSchemeChange: null,
    stopResize: null,
    io: null,
    slider,
    phaseDivs,
    readout,
    pickEl: pick,
    lensWrap,
  };

  function renderChips() {
    pick.innerHTML = '';
    objects.forEach((obj, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.i = String(i);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.textContent = obj.name;
      pick.appendChild(b);
    });
  }
  renderChips();

  pick.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const idx = Number(b.dataset.i);
    state.obj = objects[idx] || objects[0];
    Array.from(pick.querySelectorAll('button')).forEach((btn) => btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false'));
    build(state);
    updateReadout(state);
  });

  slider.addEventListener('input', (e) => {
    state.t = Number(e.target.value) / 1000;
    if (state.reducedMotion) draw(state); // โหมดลดการเคลื่อนไหว: วาดเฉพาะตอนมีการโต้ตอบจริง ไม่ปล่อยลูปถี่ๆ
  });

  lensWrap.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-l]');
    if (!b) return;
    state.lens = b.dataset.l;
    Array.from(lensWrap.querySelectorAll('button')).forEach((btn) => btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false'));
    updateReadout(state);
  });

  function doFit() {
    const result = fit(canvas, 2.5); // 900:360 ~ 2.5 ตามสัดส่วนต้นแบบ — วาดตามความกว้างจริงของ .stage เสมอ
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

  build(state);
  updateReadout(state);

  current = state;

  // เล่นเฉพาะตอนอยู่ในจอจริง (ประหยัดแบตมือถือ) — เป็นกลไกสำรองของโมดูลเองนอกเหนือจาก pause()/resume()
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

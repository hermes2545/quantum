/**
 * interactives/trilaksana-quantum/ch09.js — module "cell-turnover" ของบทที่ ๙ (§E.4 ของสัญญาระหว่างโมดูล)
 * เดินตามสัญญาเดียวกับ particles.js/ch03.js/ch04.js: export {mount(el,opts), unmount(el), pause(), resume()}
 *
 * แนวคิด: "เซลล์เกิด-ดับทั้งร่าง" — จุดนับร้อยประกอบเป็นภาพร่างมนุษย์ (ศีรษะ/ลำตัว/แขน/ขา) แต่ละจุดถูก
 * จัดเข้ากลุ่ม "ส่วนของร่างกาย" หนึ่งใน 8 กลุ่มตามตำแหน่งเชิงกายวิภาคโดยประมาณ (ผิวหนัง เยื่อบุลำไส้
 * ตุ่มรับรส เม็ดเลือดแดง กระดูก กล้ามเนื้อหัวใจ เลนส์ตา เซลล์สมอง) ตรงตาม config.parts[].key ของ
 * content/books/trilaksana-quantum/ch09.json ที่มีอยู่แล้ว — ไม่ต้องแก้ config เพิ่ม
 *
 * ผู้อ่านเลื่อนสไลเดอร์ "อายุ" (วัน→สัปดาห์→เดือน→ปี แปลงหน่วยอัตโนมัติตามค่า ไม่ใช่หน่วยเดียวตลอดช่วง)
 * แต่ละจุดจะ "คงเดิม" (สีทอง = เซลล์ตั้งแต่เกิด) หรือ "ถูกแทนที่แล้ว" (สีเขียวน้ำทะเล/มินต์ = เซลล์ใหม่)
 * ตามสัดส่วนที่คำนวณจากอัตราผลัดเซลล์ของส่วนนั้น (สุ่มแบบ "คงที่ต่อจุด" ครั้งเดียวตอนสร้างจุด ไม่สุ่มใหม่
 * ทุกเฟรม เพื่อให้ภาพเปลี่ยนไปทางเดียวราบรื่นเมื่อลากสไลเดอร์ ไม่ใช่กะพริบสุ่มไปมา) ส่วนที่เลือกอยู่ผ่านชิป
 * ด้านบนจะถูกไฮไลต์ด้วยวงแหวนสีชมพู แล้วอ่านค่า "% ที่เหลืออยู่" ตรงตัวใน readout ด้านล่าง
 *
 * โมเดลคำนวณ (ทำให้ตรงไปตรงมา ไม่ใช่ตัวเลขวัดจริงทีละเซลล์ — ระบุไว้ตรงๆ ใน disclaimer ของ readout):
 * ถือว่าเซลล์แต่ละเซลล์มีโอกาสถูกแทนที่คงที่ต่อวันเท่ากับ 1/cycleDays (คล้ายแบบจำลองการสลายตัวแบบ
 * exponential ที่ใช้กับคาร์บอน-14 ซึ่งเนื้อหาบทนี้เองก็อ้างถึง) ทำให้สัดส่วนเซลล์ดั้งเดิมที่เหลือที่อายุ t วัน
 * คือ 100 × e^(−t / cycleDays) ส่วนที่ renews=false (เลนส์ตา, เซลล์สมองส่วนคิดและจำ) คงที่ 100% เสมอ
 *
 * config ที่ chNN.json.interactive.config ใช้จริง (ตรงตาม ch09.json ปัจจุบัน ไม่ต้องเพิ่ม field):
 * {
 *   maxAge: number   (ปี, เพดานบนของสไลเดอร์ — ดีฟอลต์ 80),
 *   defaultAge: number (ปี, ตำแหน่งเริ่มต้นของสไลเดอร์ — ดีฟอลต์ 25),
 *   parts: Array<{ key: string, name: string, cycleDays: number|null, renews: boolean, note: string }>
 *     - renews=true  → % ที่เหลือคำนวณจาก cycleDays (สลายแบบ exponential ตามด้านบน)
 *     - renews=false → % คงที่ 100% เสมอ ไม่นับรอบ
 * }
 * ทุกฟิลด์มีดีฟอลต์สำรองในโค้ด (DEFAULT_PARTS ฯลฯ) เพื่อให้บทนี้เปิดได้เสมอแม้ config ไม่ครบ (ความเสี่ยงข้อ 3)
 * key ที่ตำแหน่งจุดบนภาพรู้จัก (GEOMETRY_KEYS) คือ skin/gut/taste/rbc/bone/heart/lens/neuron ตรงกับ
 * ch09.json เป๊ะ — key อื่นนอกเหนือจากนี้ยังเลือกผ่านชิปและอ่าน readout ได้ปกติ เพียงแต่จะไม่มีจุดบนภาพให้
 * ไฮไลต์ (ไม่ล้มทั้งอินเทอร์แอกทีฟ)
 *
 * ห้าม hard-code สี hex ในไฟล์นี้ — อ่านผ่าน cssVar() เท่านั้น: ทอง = --dot-gold (เซลล์ตั้งแต่เกิด),
 * มินต์/เขียวน้ำทะเล = --night-k (เซลล์ที่ถูกแทนที่แล้ว), ชมพู = --dot-pink (วงแหวนไฮไลต์ส่วนที่เลือกดู),
 * พื้นหลัง = --night-2 โทเค็นอ่านครั้งเดียวตอน mount แล้วอ่านซ้ำเฉพาะตอน matchMedia('(prefers-color-scheme:
 * dark)') เปลี่ยน (§C) ถ้าอ่านไม่ได้ (ค่าว่าง) ให้ข้ามการวาดจุดสีนั้นไปเลย ไม่ fallback เป็น hex
 *
 * ไม่วาดตัวอักษรใดๆ บนแคนวาสเลย (เหมือน ch04.js) — ตัวเลขอายุ/เปอร์เซ็นต์/คำอธิบายทั้งหมดอยู่ใน HTML
 * (.readout, legend, slider label) ใต้แคนวาสแทน เลี่ยงปัญหาอ่านไม่ออกที่ 320px ตั้งแต่ต้น (§5 ข้อ 2)
 * hit area ของสไลเดอร์/ชิปมาจาก .night input[type=range] และ .chip ใน base.css ที่ตั้ง min-height:44px
 * ไว้ให้แล้ว (§5 ข้อ 3) ไม่ต้องเพิ่มโค้ดจัดการเอง
 */
import {
  cssVar as cssVarDefault,
  prefersReducedMotion as prefersReducedMotionDefault,
  fitCanvas as fitCanvasDefault,
  onResize as onResizeDefault,
  escapeHtml,
  formatThousands,
} from '../../components.js';

/* ---------------------------------------------------------------- */
/* ค่าคงที่ของโมเดลอายุ/สไลเดอร์                                      */
/* ---------------------------------------------------------------- */
const YEAR_DAYS = 365;
const RAW_MAX = 1000; // ความละเอียดของ <input type=range> เหมือน particles.js
const RAW_BREAK = 500; // ครึ่งซ้ายของสไลเดอร์ = 0–1 ปีแรก (ละเอียดระดับวัน) ครึ่งขวา = 1 ปี–maxAge (ระดับปี)
                        // ทำให้สไลเดอร์เดียวไล่ตั้งแต่ "วัน" ไปถึง "ปี" ได้จริงตามที่โจทย์ต้องการ

/* key ตำแหน่งจุดที่ไฟล์นี้รู้จักบนภาพร่างกาย — ตรงกับ config.parts[].key ของ ch09.json ทั้ง 8 ชิ้น */
const GEOMETRY_KEYS = ['skin', 'gut', 'taste', 'rbc', 'bone', 'heart', 'lens', 'neuron'];

/* ออบเจกต์สำรอง — ใช้เมื่อ config.parts ว่าง/หายไปทั้งชุด กันไม่ให้บทเปิดไม่ได้ (ความเสี่ยงข้อ 3) */
const DEFAULT_PARTS = [
  { key: 'skin', name: 'ผิวหนัง', cycleDays: 21, renews: true, note: 'ผิวชั้นนอกผลัดใหม่ทุก ~3 สัปดาห์' },
  { key: 'bone', name: 'กระดูก', cycleDays: 3650, renews: true, note: 'โครงกระดูกทั้งชุดถูกแทนที่ราวทุก 10 ปี' },
  { key: 'neuron', name: 'เซลล์สมอง', cycleDays: null, renews: false, note: 'แทบไม่ถูกแทนที่ตลอดชีวิต' },
];
/* ใช้เป็นค่า % สำรองเฉพาะเมื่อจุดบนภาพมี key ที่ config ไม่ได้ให้ข้อมูลไว้เลย (กันพัง ไม่ใช่ค่าที่ตั้งใจสื่อ) */
const DEFAULT_PART_FALLBACK = { key: '', name: '', cycleDays: 180, renews: true, note: '' };

let current = null;

/* ---------------------------------------------------------------- */
/* ตัวช่วยตัวเลข/เวลา                                                 */
/* ---------------------------------------------------------------- */
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/** raw (0..1000 จากสไลเดอร์) -> อายุเป็นวัน สองช่วง: ครึ่งแรก 0–1 ปี (ละเอียด), ครึ่งหลัง 1–maxAgeYears ปี */
function ageDaysFromRaw(raw, maxAgeYears) {
  const t = clamp01(raw / RAW_MAX);
  const safeMax = maxAgeYears > 1 ? maxAgeYears : 1.01;
  if (t <= RAW_BREAK / RAW_MAX) return (t / (RAW_BREAK / RAW_MAX)) * YEAR_DAYS;
  const years = 1 + ((t - RAW_BREAK / RAW_MAX) / (1 - RAW_BREAK / RAW_MAX)) * (safeMax - 1);
  return years * YEAR_DAYS;
}

/** ผกผันของ ageDaysFromRaw — ใช้หาตำแหน่งเริ่มต้นของสไลเดอร์จาก config.defaultAge (ปี) */
function rawFromAgeYears(years, maxAgeYears) {
  const safeMax = maxAgeYears > 1 ? maxAgeYears : 1.01;
  if (years <= 1) return Math.round(clamp01(years) * RAW_BREAK);
  const t2 = clamp01((years - 1) / (safeMax - 1));
  return Math.round(RAW_BREAK + t2 * (RAW_MAX - RAW_BREAK));
}

/** แปลงอายุเป็นวัน -> ข้อความหน่วยที่อ่านง่าย ไล่จากวัน -> สัปดาห์ -> เดือน -> ปี ตามขนาดของค่า */
function formatAge(ageDays) {
  if (ageDays < 14) return Math.max(0, Math.round(ageDays)) + ' วัน';
  if (ageDays < 60) return Math.max(1, Math.round(ageDays / 7)) + ' สัปดาห์';
  if (ageDays < 730) return Math.max(1, Math.round(ageDays / 30)) + ' เดือน';
  const years = ageDays / YEAR_DAYS;
  return (years < 10 ? years.toFixed(1) : String(Math.round(years))) + ' ปี';
}

function formatPercent(pct) {
  if (pct >= 99.95) return '100%';
  if (pct < 0.05) return 'น้อยกว่า 0.1%';
  if (pct < 1) return '~' + pct.toFixed(1) + '%';
  return '~' + Math.round(pct) + '%';
}

/** สัดส่วนเซลล์ดั้งเดิม (ตั้งแต่เกิด) ที่ยังเหลืออยู่ ณ อายุ ageDays วัน — ดูสูตรในคอมเมนต์หัวไฟล์ */
function percentRemaining(part, ageDays) {
  if (!part || !part.renews || !(part.cycleDays > 0)) return 100;
  const pct = 100 * Math.exp(-ageDays / part.cycleDays);
  return Math.max(0, Math.min(100, pct));
}

function normalizePart(raw, idx) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const key = typeof p.key === 'string' && p.key ? p.key : 'part-' + idx;
  const renews = typeof p.renews === 'boolean' ? p.renews : true;
  const cycleDays = typeof p.cycleDays === 'number' && p.cycleDays > 0 ? p.cycleDays : renews ? 365 : null;
  return {
    key,
    name: typeof p.name === 'string' && p.name ? p.name : key,
    cycleDays,
    renews,
    note: typeof p.note === 'string' ? p.note : '',
  };
}

/* ---------------------------------------------------------------- */
/* รูปทรงร่างกาย (พื้นที่ x,y อยู่ในช่วง -1..1 เหมือน particles.js) + การจัดกลุ่มเป็น "ส่วนของร่างกาย"  */
/* ---------------------------------------------------------------- */
function bodyShape(x, y) {
  const head = Math.hypot(x, y + 0.62) < 0.15;
  const torso = Math.abs(x) < 0.18 && y > -0.45 && y < 0.1;
  const arms = Math.abs(y + 0.3) < 0.06 && Math.abs(x) < 0.42;
  const legs = y > 0.1 && y < 0.7 && (Math.abs(x - 0.1) < 0.07 || Math.abs(x + 0.1) < 0.07);
  return head || torso || arms || legs;
}

const HEAD_C = { x: 0, y: -0.62 };
const EYE_L = { x: -0.055, y: -0.65 };
const EYE_R = { x: 0.055, y: -0.65 };
const MOUTH_C = { x: 0, y: -0.505 };
const HEART_C = { x: -0.08, y: -0.27 };

/** จัดจุด (x,y) ที่รู้แล้วว่าอยู่ในภาพร่างกาย ให้เข้ากลุ่ม "ส่วนของร่างกาย" หนึ่งใน GEOMETRY_KEYS
 *  ลำดับการเช็คตั้งใจให้พื้นที่เล็ก/เจาะจง (ตา ปาก หัวใจ ลำไส้ กระดูก) ชนะพื้นที่กว้างที่ทับซ้อนกัน
 *  (ผิว = เปลือกนอกสุด, เลือด = พื้นที่ว่างที่เหลือทั่วร่าง) */
function classifyPart(x, y) {
  const dHead = Math.hypot(x - HEAD_C.x, y - HEAD_C.y);
  if (dHead < 0.15) {
    if (Math.hypot(x - EYE_L.x, y - EYE_L.y) < 0.026) return 'lens';
    if (Math.hypot(x - EYE_R.x, y - EYE_R.y) < 0.026) return 'lens';
    if (Math.hypot(x - MOUTH_C.x, y - MOUTH_C.y) < 0.032) return 'taste';
    if (dHead > 0.135) return 'skin'; // เปลือกศีรษะชั้นนอกสุด
    if (dHead > 0.115) return 'bone'; // กะโหลก (ชั้นถัดจากผิวเข้ามา)
    return 'neuron'; // เนื้อสมองด้านใน
  }
  if (Math.hypot(x - HEART_C.x, y - HEART_C.y) < 0.05) return 'heart';
  if (Math.abs(x) < 0.16 && y > -0.06 && y < 0.12) {
    const gx = x / 0.15;
    const gy = (y - 0.02) / 0.1;
    if (gx * gx + gy * gy < 1) return 'gut';
  }
  if (Math.abs(x) < 0.028 && y > -0.55 && y < 0.08) return 'bone'; // กระดูกสันหลัง
  if (Math.abs(y + 0.3) < 0.025 && Math.abs(x) > 0.19 && Math.abs(x) < 0.42) return 'bone'; // แขน (นอกเขตอก)
  if (y > 0.11 && y < 0.68 && (Math.abs(x - 0.1) < 0.024 || Math.abs(x + 0.1) < 0.024)) return 'bone'; // ขา
  if (!bodyShape(x * 0.9, y * 0.9)) return 'skin'; // เปลือกนอกของลำตัว/แขน/ขา
  return 'rbc'; // พื้นที่ว่างที่เหลือ = เลือด/เนื้อเยื่อทั่วไปที่กระจายอยู่ทั้งตัว
}

function rnd(s) {
  s.seed = (s.seed * 16807) % 2147483647;
  return s.seed / 2147483647;
}

/** สร้างจุดครั้งเดียวตอน mount ด้วย seed คงที่ (ผลลัพธ์เดิมทุกครั้งที่โหลดหน้า) — thresh ของแต่ละจุด
 *  สุ่มครั้งเดียวตรงนี้ และใช้ตัดสิน "ทอง/มินต์" ตลอดอายุการใช้งานของจุดนั้น ไม่สุ่มซ้ำทุกเฟรม (เห็นภาพ
 *  เปลี่ยนไปทางเดียวราบรื่นตามสไลเดอร์ ไม่กะพริบสุ่ม) */
function build(s) {
  s.seed = 9;
  s.pts = [];
  let guard = 0;
  const N = 900;
  while (s.pts.length < N && guard < 60000) {
    guard += 1;
    const x = rnd(s) * 2 - 1;
    const y = rnd(s) * 2 - 1;
    if (!bodyShape(x, y)) continue;
    s.pts.push({
      x,
      y,
      part: classifyPart(x, y),
      thresh: rnd(s),
      ph: rnd(s) * 6.28,
      sp: 0.4 + rnd(s) * 0.6,
    });
  }
}

/* ---------------------------------------------------------------- */
/* สี — อ่านจาก token "ครั้งเดียว" (ดูกติกา §C ในคอมเมนต์หัวไฟล์)                                    */
/* ---------------------------------------------------------------- */
function readColors(cssVarFn, el) {
  return {
    nightBg: cssVarFn('--night-2', el) || '',
    gold: cssVarFn('--dot-gold', el) || '',
    mint: cssVarFn('--night-k', el) || '',
    pink: cssVarFn('--dot-pink', el) || '',
  };
}

function applyLegendColors(s) {
  if (s.legendDots.gold) s.legendDots.gold.style.color = s.colors.gold || '';
  if (s.legendDots.mint) s.legendDots.mint.style.color = s.colors.mint || '';
  if (s.legendDots.pink) s.legendDots.pink.style.color = s.colors.pink || '';
}

/** คำนวณ % เซลล์ดั้งเดิมที่เหลือของทุก "ตำแหน่งบนภาพ" ใหม่ — เรียกเฉพาะตอนอายุเปลี่ยน (ไม่ใช่ทุกเฟรม) */
function computePercentByPart(s) {
  const map = {};
  GEOMETRY_KEYS.forEach((k) => {
    const part = s.partsByKey[k] || DEFAULT_PART_FALLBACK;
    map[k] = percentRemaining(part, s.ageDays);
  });
  s.percentByPart = map;
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
    ctx.clearRect(0, 0, W, H); // token ยังอ่านไม่ได้ — เคลียร์พื้นแทนเดาสี (เหมือน particles.js)
  }

  if (!s.colors.gold && !s.colors.mint) return; // ทั้งสองสีอ่านไม่ได้ — ไม่มีอะไรวาดได้เลย ข้ามทั้งเฟรม

  const cx = W / 2;
  const cy = H / 2;
  // สเกลตามความกว้าง/สูงจริงของแคนวาส (§5 ข้อ 2) — คูณ 1.8 ชดเชยที่ภาพร่างกายสูงกว่ากว้างมากในพื้นที่ -1..1
  const S = Math.min(W, H * 1.8) * 0.34;
  const tm = performance.now() / 1000;

  for (const p of s.pts) {
    const percent = s.percentByPart[p.part];
    const isOriginal = percent === undefined ? true : p.thresh < percent / 100;
    const baseColor = isOriginal ? s.colors.gold : s.colors.mint;
    if (!baseColor) continue; // token สีนี้อ่านไม่ได้ — ข้ามจุดนี้ไปเลย ไม่ fallback เป็น hex
    const isSelected = p.part === s.selectedKey;
    const wob = Math.sin(tm * p.sp + p.ph);
    const x = cx + p.x * S + wob * 0.6;
    const y = cy + p.y * S + Math.cos(tm * p.sp + p.ph) * 0.6;
    const r = isSelected ? 2.6 : 1.6;
    ctx.globalAlpha = isSelected ? 1 : 0.55;
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283);
    ctx.fill();
    if (isSelected && s.colors.pink) {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 1;
      ctx.strokeStyle = s.colors.pink;
      ctx.beginPath();
      ctx.arc(x, y, r + 1.8, 0, 6.283);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function updateReadout(s) {
  const part = s.parts[s.selectedIndex] || s.parts[0];
  const pct = percentRemaining(part, s.ageDays);
  const ageText = formatAge(s.ageDays);
  const pctText = formatPercent(pct);
  let extraLine;
  if (part.renews) {
    const rounds = Math.max(0, Math.floor(s.ageDays / part.cycleDays));
    extraLine = 'สร้างทดแทนไปแล้วราว <span class="mono">' + formatThousands(rounds) + '</span> รอบ';
  } else {
    extraLine = 'ยังไม่เคยถูกแทนที่เลยตั้งแต่เกิด';
  }
  const noteLine = part.note ? '<br>' + escapeHtml(part.note) : '';
  s.readout.innerHTML =
    '<span class="k">' + escapeHtml(part.name) + '</span> · อายุ <span class="mono">' + escapeHtml(ageText) + '</span>' +
    '<br>เซลล์ที่คุณเกิดมาด้วย เหลืออยู่ <b class="mono">' + escapeHtml(pctText) + '</b>' +
    '<br>' + extraLine +
    noteLine;
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

  const maxAgeYears = typeof config.maxAge === 'number' && config.maxAge > 0 ? config.maxAge : 80;
  const defaultAgeYears =
    typeof config.defaultAge === 'number' && config.defaultAge >= 0 ? Math.min(config.defaultAge, maxAgeYears) : Math.min(25, maxAgeYears);

  const rawParts = Array.isArray(config.parts) && config.parts.length ? config.parts : DEFAULT_PARTS;
  const parts = rawParts.map(normalizePart);
  const partsByKey = {};
  parts.forEach((p) => {
    partsByKey[p.key] = p;
  });

  const cssVarFn = o.cssVar || cssVarDefault;
  const reducedMotion = typeof o.reducedMotion === 'boolean' ? o.reducedMotion : prefersReducedMotionDefault();
  const fit = o.fitCanvas || fitCanvasDefault;
  const attachResize = o.onResize || onResizeDefault;

  el.innerHTML = '';

  // ---- ชิปเลือกส่วนของร่างกาย ----
  const pickWrap = document.createElement('div');
  pickWrap.className = 'ctl';
  const pick = document.createElement('div');
  pickWrap.appendChild(pick);
  el.appendChild(pickWrap);

  // ---- stage + canvas ----
  const stage = document.createElement('div');
  stage.className = 'stage';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true'); // ข้อมูลสำคัญซ้ำอยู่ใน readout ที่เป็นข้อความอยู่แล้ว
  stage.appendChild(canvas);
  el.appendChild(stage);

  // ---- สไลเดอร์อายุ ----
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'ctl';
  const sliderId = 'ix-age-' + Math.random().toString(36).slice(2, 8);
  const label = document.createElement('label');
  label.setAttribute('for', sliderId);
  label.textContent = 'อายุ (นับตั้งแต่เกิด)';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = sliderId;
  slider.min = '0';
  slider.max = String(RAW_MAX);
  slider.value = String(rawFromAgeYears(defaultAgeYears, maxAgeYears));
  sliderWrap.appendChild(label);
  sliderWrap.appendChild(slider);
  el.appendChild(sliderWrap);

  // ---- คำอธิบายสี (HTML ใต้แคนวาส แทนตัวอักษรบนแคนวาส — §5 ข้อ 2) ----
  const legend = document.createElement('p');
  const dotGold = document.createElement('span');
  dotGold.textContent = '● ';
  const dotMint = document.createElement('span');
  dotMint.textContent = '● ';
  const dotPink = document.createElement('span');
  dotPink.textContent = '○ ';
  legend.appendChild(dotGold);
  legend.appendChild(document.createTextNode('เซลล์ตั้งแต่เกิด '));
  legend.appendChild(dotMint);
  legend.appendChild(document.createTextNode('เซลล์ที่ถูกแทนที่แล้ว '));
  legend.appendChild(dotPink);
  legend.appendChild(document.createTextNode('ส่วนที่กำลังดูอยู่'));
  el.appendChild(legend);

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
    H: 600,
    parts,
    partsByKey,
    maxAgeYears,
    ageDays: ageDaysFromRaw(Number(slider.value), maxAgeYears),
    percentByPart: {},
    selectedIndex: 0,
    selectedKey: parts[0] ? parts[0].key : '',
    pts: [],
    seed: 1,
    raf: null,
    running: false,
    reducedMotion,
    colors: readColors(cssVarFn, el),
    legendDots: { gold: dotGold, mint: dotMint, pink: dotPink },
    mql: null,
    onSchemeChange: null,
    stopResize: null,
    io: null,
    slider,
    readout,
    pickEl: pick,
  };

  applyLegendColors(state);

  function renderChips() {
    pick.innerHTML = '';
    parts.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.i = String(i);
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.textContent = p.name;
      pick.appendChild(b);
    });
  }
  renderChips();

  pick.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const idx = Number(b.dataset.i);
    state.selectedIndex = idx;
    state.selectedKey = parts[idx] ? parts[idx].key : '';
    Array.from(pick.querySelectorAll('button')).forEach((btn) => btn.setAttribute('aria-pressed', btn === b ? 'true' : 'false'));
    updateReadout(state);
    if (state.reducedMotion) draw(state);
  });

  slider.addEventListener('input', (e) => {
    state.ageDays = ageDaysFromRaw(Number(e.target.value), maxAgeYears);
    computePercentByPart(state);
    updateReadout(state);
    if (state.reducedMotion) draw(state); // โหมดลดการเคลื่อนไหว: วาดเฉพาะตอนมีการโต้ตอบจริง ไม่ปล่อยลูปถี่ๆ
  });

  function doFit() {
    const result = fit(canvas, 1.5); // ภาพร่างกายค่อนไปทางแนวตั้ง — ชดเชยด้วย S ในฟังก์ชัน draw() แทน
    state.W = result.W;
    state.H = result.H;
    state.ctx = result.ctx;
    draw(state);
  }

  build(state);
  computePercentByPart(state);
  doFit();
  state.stopResize = attachResize(doFit);

  // อ่านโทเค็นสีใหม่เฉพาะตอนธีมเปลี่ยนจริง (§C) — ไม่ใช่ทุกเฟรม; addEventListener มีใน iOS 15+ แต่กันพลาด
  // ด้วย addListener แบบเก่าไว้ด้วย (Safari รุ่นก่อนหน้านั้น)
  try {
    state.mql = window.matchMedia('(prefers-color-scheme: dark)');
    state.onSchemeChange = () => {
      state.colors = readColors(cssVarFn, el);
      applyLegendColors(state);
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

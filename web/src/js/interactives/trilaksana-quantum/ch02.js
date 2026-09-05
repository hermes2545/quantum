/**
 * interactives/trilaksana-quantum/ch02.js — module "zoom" ของบทที่ ๒ (§E.4 ของสัญญาระหว่างโมดูล)
 *
 * @typedef ZoomLevel
 * @property {string} name  ชื่อระดับการซูม เช่น "ร่างกาย", "เซลล์", "โมเลกุล" (จาก IX2_LV ของ prototype)
 * @property {string} q     inner HTML ของคำถามนำที่ระดับนี้ — อนุญาตเฉพาะ <b> (ผ่าน sanitizeInlineHtml เสมอ)
 * @property {string} ans   inner HTML ของคำตอบ/ข้อสังเกตที่ระดับนี้ — อนุญาตเฉพาะ <b> เช่นกัน
 *
 * config ที่ chNN.json.interactive.config ต้องส่งมา (ตรงตาม §E.4):
 * { "levels": ZoomLevel[] (6 ระดับตาม IX2_LV ของ prototype), "sliderLabel": "ระดับการซูม" }
 *
 * ไม่มี canvas/แอนิเมชันต่อเนื่อง (การซูมเปลี่ยนตามการลากสไลเดอร์เท่านั้น) — pause()/resume() จึงไม่มี
 * rAF loop ให้หยุด/เริ่ม เป็นฟังก์ชันว่างตามสัญญา (ต้อง export ครบ 4 ตัวเสมอ)
 * ใช้ class ตามที่สัญญา §E.4 ระบุไว้: .ctl .zoomsteps span.on .readout .readout .k
 */
import { sanitizeInlineHtml, escapeHtml } from '../../components.js';

let current = null;

export function mount(el, opts) {
  if (!el) return;
  if (current && current.el !== el) unmount(current.el);

  const o = opts || {};
  const config = o.config || {};
  const levels = Array.isArray(config.levels) && config.levels.length ? config.levels : [{ name: 'ระดับ 1', q: '', ans: '' }];
  const sliderLabel = config.sliderLabel || 'ระดับการซูม';

  el.innerHTML = '';

  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'ctl';
  const sliderId = 'ix-zoom-' + Math.random().toString(36).slice(2, 8);
  const label = document.createElement('label');
  label.setAttribute('for', sliderId);
  label.textContent = sliderLabel;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = sliderId;
  slider.min = '0';
  slider.max = String(levels.length - 1);
  slider.step = '1';
  slider.value = '0';
  sliderWrap.appendChild(label);
  sliderWrap.appendChild(slider);
  el.appendChild(sliderWrap);

  const stepsWrap = document.createElement('div');
  stepsWrap.className = 'zoomsteps';
  const stepSpans = levels.map((lv, i) => {
    const span = document.createElement('span');
    span.textContent = lv.name || String(i + 1);
    stepsWrap.appendChild(span);
    return span;
  });
  el.appendChild(stepsWrap);

  const readout = document.createElement('div');
  readout.className = 'readout';
  readout.setAttribute('aria-live', 'polite');
  el.appendChild(readout);

  function render(idx) {
    const lv = levels[idx] || levels[0];
    stepSpans.forEach((s, i) => s.classList.toggle('on', i === idx));
    // อนุญาตเฉพาะ <b> ตามสัญญา §E.4/ความเสี่ยงข้อ 11 — เนื้อหามาจาก config ของ pipeline
    const q = sanitizeInlineHtml(lv.q || '', ['b']);
    const ans = sanitizeInlineHtml(lv.ans || '', ['b']);
    readout.innerHTML = `<span class="k">${escapeHtml(lv.name || '')}</span>${q ? '<br>' + q : ''}${ans ? '<br>' + ans : ''}`;
  }

  function onInput() {
    render(Number(slider.value));
  }
  slider.addEventListener('input', onInput);
  render(0);

  current = { el, slider, onInput };
}

export function unmount(el) {
  if (current && (!el || current.el === el)) {
    current.slider.removeEventListener('input', current.onInput);
    current = null;
  }
  if (el) el.innerHTML = '';
}

// ไม่มีลูปแอนิเมชันให้หยุด/เริ่ม (การซูมขับเคลื่อนด้วย input ของผู้ใช้ล้วนๆ) — ต้อง export ไว้ตามสัญญา §E.4
export function pause() {}
export function resume() {}

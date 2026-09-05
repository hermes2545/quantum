/**
 * canvas.js — ชื่อไฟล์ตายตัวตามสัญญาระหว่างโมดูล §E.1 (export: fitCanvas, onResize)
 * เนื้อจริง implement ไว้ใน components.js — ดูหมายเหตุใน tokens.js
 * interactive.js (loader ของ UniverseWindow) ส่ง fitCanvas/onResize เข้า opts ของทุก interactive module
 * ตาม §E.4 โดย import จากไฟล์ชื่อนี้ตรงตามสัญญา
 */
export { fitCanvas, onResize } from './components.js';

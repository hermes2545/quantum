/**
 * interactives/trilaksana-quantum/ch04.js — บทที่ ๔ (สไลเดอร์มวลดาว)
 *
 * เหตุผลเดียวกับ ch03.js: สัญญา §E.4 ให้ P5 กำหนด shape เอง แต่ content ปัจจุบันอ้าง module
 * "star-mass-slider" ที่ไม่ตรงรูปแบบสัญญา และไฟล์นี้แก้ content/books/** ไม่ได้ — ต้องประสานกับเจ้าของ
 * content ก่อนว่า chNN.json.interactive.module ควรเปลี่ยนเป็นอะไร (ตัวเลือก: "particles" หรือ
 * "trilaksana-quantum/ch04" ตามที่ไฟล์นี้ชื่ออยู่แล้ว)
 *
 * ระหว่างรอ ให้ re-export "particles" ไว้ก่อนตามกฎสำรองของสัญญา เพื่อให้บทนี้เปิดได้เสมอ (ความเสี่ยงข้อ 3)
 *
 * แนวทาง config ในอนาคต (ยังไม่ implement):
 * @typedef StarPoint
 * @property {number} mass   มวลดาวเทียบดวงอาทิตย์ (M☉) ที่จุดนี้บนสไลเดอร์
 * @property {string} label  ชื่อผลลัพธ์ปลายทาง (เช่น "ดาวแคระขาว", "ดาวนิวตรอน", "หลุมดำ")
 * @property {string} text   inner HTML อธิบาย (อนุญาตเฉพาะ <b>)
 * // config ที่คาดไว้: { points: StarPoint[], sliderLabel: string }
 */
export * from '../particles.js';

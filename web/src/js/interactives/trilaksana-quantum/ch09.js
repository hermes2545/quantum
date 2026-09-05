/**
 * interactives/trilaksana-quantum/ch09.js — บทที่ ๙ (เซลล์เกิดดับ)
 *
 * เหตุผลเดียวกับ ch03.js/ch04.js: สัญญา §E.4 ให้ P5 กำหนด shape เอง และไฟล์นี้แก้ content/books/** ไม่ได้
 * ระหว่างรอ P6/P3 ตกลง shape config เฉพาะบท ให้ re-export "particles" ไว้ก่อนตามกฎสำรองของสัญญา
 * เพื่อให้บทนี้เปิดได้เสมอ (ความเสี่ยงข้อ 3: "ทุกบทต้องเปิดได้เสมอ")
 *
 * แนวทาง config ในอนาคต (ยังไม่ implement):
 * @typedef CellCyclePhase
 * @property {string} name  ชื่อระยะ (เช่น "เกิด", "แบ่งตัว", "ตาย", "สลาย")
 * @property {string} text  inner HTML อธิบายระยะนั้น (อนุญาตเฉพาะ <b>)
 * // config ที่คาดไว้: { phases: CellCyclePhase[], cycleSeconds: number }
 */
export * from '../particles.js';

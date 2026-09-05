/**
 * interactives/trilaksana-quantum/ch03.js — บทที่ ๓ (สายโซ่ ๕ ข้อ)
 *
 * สัญญาระหว่างโมดูล §E.4 ทิ้ง shape ของ config บทนี้ไว้ให้ P5 กำหนดเอง ("config ของ ch03/ch04/ch09 กำหนด
 * โดย P5 เอง แต่ต้องเขียน shape ไว้เป็น JSDoc บนหัวไฟล์ และ P6/P3 ใส่ค่าใน chNN.json ตามนั้น") แต่ package
 * นี้ไม่มีสิทธิ์แก้ content/books/**; content ที่มีอยู่ตอนนี้อ้าง module "aggregate-chain" ซึ่งไม่ตรงรูปแบบ
 * ที่สัญญาบังคับ ("particles" หรือ "{bookSlug}/chNN") — ยังต้องประสานกับเจ้าของ content ให้แก้ก่อน
 *
 * ระหว่างที่ยังไม่มี config เฉพาะบทที่ตกลงกันแล้ว ไฟล์นี้ทำตามกฎสำรองของสัญญาตรงๆ: re-export "particles"
 * ไว้ก่อนเพื่อให้บทนี้เปิดได้เสมอ (ความเสี่ยงข้อ 3: "ทุกบทต้องเปิดได้เสมอ") แทนที่จะเป็น dynamic import 404
 *
 * แนวทาง config ในอนาคตของบทนี้ (ยังไม่ implement — รอ P6/P3 ตกลง shape แล้วเปลี่ยนไฟล์นี้ทีเดียว):
 * @typedef ChainLink
 * @property {string} label ชื่อขั้นในสายโซ่ (เช่น "ผัสสะ", "เวทนา", "ตัณหา", "อุปาทาน", "กรรม")
 * @property {string} text  inner HTML อธิบายขั้นนั้น (อนุญาตเฉพาะ <b>)
 * // config ที่คาดไว้: { links: ChainLink[] (5 ขั้นพอดี) }
 */
export * from '../particles.js';

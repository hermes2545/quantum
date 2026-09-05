/**
 * interactives/trilaksana-quantum/ch01.js — บทที่ ๑ ใช้โมดูลกลาง "particles" ตรงๆ (§E.4 ของสัญญา
 * ระหว่างโมดูล อนุญาตให้ re-export ได้: "ch01 อาจ export * from '../particles.js'")
 * config ที่ chNN.json.interactive.config ต้องส่งมาต้องตรง shape ของ particles ตาม §E.4 (objects/lensLabels/
 * phases/initialT/timeLabel/emptyReadout) — particles.js เองมี adapter รองรับ config รูปแบบเก่าก่อนสัญญานิ่ง
 * ({k,col:"#hex",a,d,n}) ด้วยแล้ว เผื่อ seed ของบทนี้ยังไม่ตรงสัญญาเป๊ะ
 */
export * from '../particles.js';

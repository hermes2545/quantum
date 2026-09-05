/**
 * tokens.js — ชื่อไฟล์ตายตัวตามสัญญาระหว่างโมดูล §E.1 (export: cssVar, prefersReducedMotion)
 * งานนี้ implement ฟังก์ชันจริงไว้ใน components.js (ดูหมายเหตุที่หัวไฟล์นั้น) ไฟล์นี้จึงเป็นแค่ทางเข้าที่ชื่อ
 * ตรงสัญญา เพื่อให้โค้ดของแพ็กเกจอื่น (P4 template ที่อาจ import ตรงชื่อสัญญา, หรือ interactive module
 * ของบทอื่นในอนาคต) `import { cssVar } from '/assets/js/tokens.js'` ได้โดยไม่ต้องรู้ว่าเนื้อจริงอยู่ที่ไหน
 */
export { cssVar, prefersReducedMotion } from './components.js';

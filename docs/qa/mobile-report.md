# รายงานทดสอบ Mobile Responsive — ตาม docs/handoff-spec.md §5

วันที่ทดสอบ: 2026-09-06
เครื่องมือ: Playwright (Chromium 120, ผ่าน playwright@1.40 — เวอร์ชันล่าสุดไม่รองรับ macOS 13 ของเครื่องนี้) วัดด้วย `page.evaluate` จริง ไม่ใช่ดูภาพอย่างเดียว
เซิร์ฟเวอร์: static `python3 -m http.server 8088` ที่ `web/public`, proxy `node proxy/src/index.js` ที่พอร์ต 8787 (หน้าเว็บเรียก `/api/*` แบบ relative ผ่าน 8088 จึงไม่เจอ proxy จริง — เป็นพฤติกรรมที่ยอมรับได้ตามที่ระบุไว้)

## สรุปผลรวม

**ทุกหน้า ทุก viewport ผ่านกฎสำคัญเกือบทั้งหมด** พบปัญหาจริงเพียง 1 กลุ่ม (กฎข้อ 8 — ขนาดฟอนต์เนื้อหาย่อยบางจุดเล็กกว่าเกณฑ์) ซึ่งเป็นปัญหา CSS เดียวกันที่เกิดซ้ำในหลายหน้า ไม่ใช่หลายปัญหาที่แยกกัน

| หน้า | จำนวนกฎที่ไม่ผ่าน (นับ CSS root cause) |
|---|---|
| shelf (`/`) | 1 (rule 8 — source-footer text) |
| book (`/b/trilaksana-quantum/`) | 1 (rule 8 — source-footer + `.three .c p`) |
| ch03 (`/b/trilaksana-quantum/ch03/`) | 1 (rule 8 — source-footer + `.aside p` + `.ex-intro`) |
| ch09 (`/b/trilaksana-quantum/ch09/`) | 1 (rule 8 — source-footer + `.aside p` หรือคล้ายกัน + `.ex-intro`) |
| glossary (`/glossary/`) | 1 (rule 8 — source-footer text) |

กฎที่ **ผ่านครบทุกหน้า ทุก viewport**: 1 (no horizontal scroll), 2 (canvas labels เป็น HTML), 3 (hit target ≥44px บนมือถือ), 4 (`.lens/.three/.phase/.step` 1 คอลัมน์ที่ ≤860), 5 (AskPanel เต็มจอ), 6 (TermSheet ≤75vh), 7 (FAB ไม่ทับเนื้อหา), 9 (CSS reduced-motion + dark mode ใช้งานได้จริง), rail/topbar toggle ตาม breakpoint, source-footer ปรากฏทุกหน้าและเป็น 1 คอลัมน์ที่ ≤860, ไม่มี console error (นอกจาก /api/* ที่ยกเว้น — และจริงๆ ไม่มีแม้แต่ /api/* error เพราะหน้าไม่เรียก API ตอนโหลดตามสเปก).

---

## รายละเอียดปัญหาที่ไม่ผ่าน (กฎข้อ 8 — font-size ≥16px, line-height ≥1.7)

ปัญหาเดียว เกิดจาก CSS ใน `web/public/assets/css/base.css` ที่กำหนดขนาดตัวอักษรเล็กกว่าเกณฑ์ในหลาย component โดย**ไม่มี media query แยกมือถือ** จึงเกิดทั้งที่ 360/390/768 (มือถือ/แท็บเล็ตตามสเปก) และ 1280 (desktop) เหมือนกันหมด ตรวจพบว่ากระทบ `<p>` ต่อไปนี้ (ค่าที่วัดจริงจาก `getComputedStyle`):

| Selector (จาก base.css) | font-size จริง | line-height จริง | อัตราส่วน | เกณฑ์ | หน้าที่พบ |
|---|---|---|---|---|---|
| `.source-footer .sf-author` (บรรทัด 205) | 15.2px (`.95rem`) | 28.12px | 1.85 (ผ่าน) | fs ≥16px — **ไม่ผ่าน** | ทุกหน้า (มี source-footer ทุกหน้า) |
| `.source-footer .sf-note, .sf-credit` (บรรทัด 215) | 15px | 24px | 1.6 — **ไม่ผ่านทั้งคู่** | fs ≥16, lh/fs ≥1.7 | ทุกหน้า |
| `.three .c p` (บรรทัด 90) | 14.88px (`.93rem`) | 23.81px | 1.6 — **ไม่ผ่านทั้งคู่** | fs ≥16, lh/fs ≥1.7 | book (แผนที่เล่ม — การ์ด "ไม่เที่ยง/ทุกข์/ไม่มีตัวตนแท้จริง") |
| `.aside p` (บรรทัด 122, `.aside{font-size:.95rem;line-height:1.7}`) | 15.2px | 25.84px | 1.7 (ผ่านพอดี) | fs ≥16px — **ไม่ผ่าน** | ch03 (กล่องแทรกความรู้ 2 จุด), ch09 (1 จุด) |
| `.exercise .ex-intro` (บรรทัด 169, `.95rem`) | 15.2px | 28.12px | 1.85 (ผ่าน) | fs ≥16px — **ไม่ผ่าน** | ch03, ch09 (บรรทัดนำแบบฝึกหัด) |

ตัวอย่างข้อความที่กระทบจริง (ช่วย QA เจ้าของ content ตรวจ): "ภาษาไทยทั่วไปมักใช้คำว่า 'สังขาร'…" (ch03 aside), "เลือกสถานการณ์ใกล้ตัวหนึ่งอย่าง…" (ch03 ex-intro), "ทุกสิ่งเปลี่ยนแปลงอยู่ตลอดเวลา…" (book `.three`), "หนังสือชุดโดย สิรวิชญ์ รัตน์จินดา" / "เปิดเพื่ออ่านต้นฉบับ…" (source-footer ทุกหน้า)

**ข้อเสนอแนะแก้ไข**: เพิ่ม `font-size` เป็นอย่างน้อย `1rem` (16px) และ `line-height` ≥1.7 ให้ selector ทั้ง 4 กลุ่มข้างต้น หรือถ้าตั้งใจให้เป็น "ข้อความรอง" (fine print) ที่ไม่ใช่ "เนื้อหาบท" ตามเจตนาของกฎข้อ 8 ควรทำ media query เฉพาะ ≤860 ให้ขยับเป็น ≥16px อย่างน้อยที่มือถือ

หมายเหตุ: เนื้อหาหลัก (`<p>` ทั่วไปในบท ที่ไม่อยู่ใน component พิเศษ) ใช้ font-size 17px / line-height 1.85 จาก `body` ผ่านครบทุกที่ — ปัญหานี้จำกัดอยู่แค่ 4 component ย่อยข้างต้น

---

## รายละเอียดกฎอื่นๆ ที่ตรวจ (ผ่านทั้งหมด พร้อมค่าที่วัดได้)

**กฎ 1 — ไม่มี horizontal scroll**: `document.documentElement.scrollWidth <= window.innerWidth` เป็นจริงทุกหน้า ทุก viewport (360/390/768/1280) ไม่พบ element ที่ล้นขอบจอเลย

**กฎ 3 — hit target ≥44×44px**: พบ 1 จุดที่ต่ำกว่าเกณฑ์คือ `a.t` (ลิงก์ชื่อหนังสือใน `.rail .brand`, index.html บรรทัด 20) สูง 34.03px — **แต่เกิดเฉพาะที่ 1280px (desktop, rail แสดงผลปกติ)** ไม่เกิดที่ 360/390/768 เพราะ `.rail` ถูกซ่อนตามกฎข้อ ≤860px อยู่แล้ว จึงไม่ใช่ปัญหาตามเจตนาของกฎข้อ 3 ซึ่งพูดถึง "พื้นที่แตะ" บนมือถือ — บันทึกไว้เป็นข้อสังเกตเสริมเท่านั้น (ถ้าต้องการความสม่ำเสมอ อาจเพิ่ม min-height:44px ให้ `.brand .t` ด้วย)

**กฎ 4 — `.lens/.three/.phase/.step` เป็น 1 คอลัมน์ที่ ≤860px**: ตรวจทุกกลุ่มลูกของแต่ละ selector ในทุกหน้าที่มี component นี้ (`.three` ที่ book, `.lens/.phase/.step` ที่ ch03/ch09) ด้วยการเทียบ `top` ของลูกถัดไปกับ `bottom` ของลูกก่อนหน้า — เรียงแนวตั้งครบทุกกลุ่มที่ 360/390/768 ยืนยันด้วยภาพ `docs/qa/book-360x740.png` (การ์ด 3 แว่นเรียงตั้ง) และ `docs/qa/ch03-360x740-fab-overlap-check.png` (แถบ 5 ขั้นขันธ์เรียงแนวนอนแบบ scroll ภายในกล่องของตัวเอง ไม่ทำให้หน้าล้น)

**กฎ 2 — canvas labels อ่านออกที่ 320px**: ตรวจ `#ix` (UniverseWindow ของ ch03/ch09) พบว่า label ทั้งหมด (ชื่อขั้นขันธ์ "วิญญาณ สัญญา เวทนา สังขาร เจตนา", readout ข้อความอธิบาย) ถูก render เป็น **HTML จริง** (`div/span` ภายใน `.night`) ไม่ใช่วาดลง canvas เลย — จึงอ่านออกชัดเจนที่ 360px แน่นอน ยืนยันด้วยภาพ `ch03-360x740-ix-crop.png` และ `ch03-360x740-fab-overlap-check.png`

**กฎ 5 — AskPanel เต็มจอที่มือถือ**: กด `.fab` แล้ว `.ask` เปิดด้วย `getBoundingClientRect()` = `{top:0, left:0, width:360, height:740}` ตรงกับ viewport เป๊ะทุกหน้า (shelf/book/ch03/ch09/glossary ที่ 360×740) ช่องพิมพ์เป็น `<input id="askin">` (ไม่ใช่ `<textarea>` แต่ทำหน้าที่เดียวกัน) อยู่ในจอครบ (`textareaInView:true`) — ยืนยันด้วยภาพ `*-360x740-askpanel.png` ทุกหน้า context แสดงถูกต้อง เช่น ch03 ขึ้น "บริบท: เล่ม ๑ ไตรลักษณ์ในควอนตัม · บทที่ ๓ ไตรลักษณ์ในขันธ์ ๕ (จิต)"

**กฎ 6 — TermSheet ≤75vh**: กด `<dfn>` แรกที่ ch03/ch09 (มี dfn จริง ส่วน shelf/book/glossary ไม่มี dfn ในเนื้อหาจึงข้ามเป็นปกติ) `.sheet` เปิดสูง 296.39px (ch03) และ 323.83px (ch09) เทียบ 75vh ของ 740px = 555px → ผ่านสบายๆ ยืนยันด้วยภาพ `ch03-360x740-termsheet.png`

**กฎ 7 — FAB ไม่ทับเนื้อหา**: ตรวจซ้ำเฉพาะจุดด้วย bounding-rect ระหว่าง `.fab` กับ `.night .readout` ที่ ch03 หลัง scroll ปกติ → `overlap:false` (ภาพ element-screenshot ตอนแรกที่ดูเหมือนทับกันเป็น artifact ของการ stitch screenshot ของ element ที่สูงกว่า viewport ขณะมี fixed element ไม่ใช่ปัญหาจริง — ตรวจซ้ำด้วย `page.screenshot` ที่ scroll position จริงแล้วไม่ทับ)

**Rail/Topbar toggle**: ที่ ≤860 → `.rail{display:none}`, `.topbar{display:flex}` เห็นชัด; ที่ 1280 → กลับกัน ผ่านทุกหน้า

**Source-footer**: มี element `.source-footer` ปรากฏครบทุกหน้า (5/5) มีคำว่า "ต้นฉบับอ้างอิง" ในทุกหน้า รายการ 9 เล่ม (`<li>`) เรียงเป็น 1 คอลัมน์ที่ทุก viewport รวมถึง ≤860 — ผ่าน

**Console errors**: ไม่พบ error เลยแม้แต่รายการเดียวในทุกหน้า/ทุก viewport (ตรวจทั้ง `console` type=error และ `pageerror`) — ไม่มี `/api/*` 404 ให้ต้องยกเว้นด้วยซ้ำ เพราะหน้าเว็บไม่เรียก API ตอนโหลดหน้าตามที่สเปกกำหนด (§6: "ห้ามเรียก API ตอนโหลดหน้า")

**กฎ 9 (prefers-reduced-motion / prefers-color-scheme)**: ตรวจ CSS พบ media query `@media (prefers-reduced-motion:reduce)` ปิด animation/transition ทั้งหมดจริง (`web/public/assets/css/base.css` ท้ายไฟล์); ทดสอบ dark mode จริงด้วย `colorScheme:'dark'` ที่ ch03 360×740 → หน้าเปลี่ยนธีมมืดถูกต้องทั้งหน้า (ภาพ `ch03-360x740-dark.png`)

---

## รายชื่อไฟล์ภาพ (`docs/qa/`)

**ภาพหลักตามที่ระบุ (20 ภาพ + dark 1 ภาพ = 21 ภาพ)**
- `shelf-360x740.png`, `shelf-390x844.png`, `shelf-768x1024.png`, `shelf-1280x800.png`
- `book-360x740.png`, `book-390x844.png`, `book-768x1024.png`, `book-1280x800.png`
- `ch03-360x740.png`, `ch03-390x844.png`, `ch03-768x1024.png`, `ch03-1280x800.png`, `ch03-360x740-dark.png`
- `ch09-360x740.png`, `ch09-390x844.png`, `ch09-768x1024.png`, `ch09-1280x800.png`
- `glossary-360x740.png`, `glossary-390x844.png`, `glossary-768x1024.png`, `glossary-1280x800.png`

**ภาพเสริมสำหรับยืนยันการวัดโค้ด (interaction states)**
- `*-360x740-askpanel.png` (5 ไฟล์ — shelf/book/ch03/ch09/glossary): สภาพ `.ask` หลังกด `.fab`
- `ch03-360x740-termsheet.png`, `ch09-360x740-termsheet.png`: สภาพ `.sheet` หลังกด `<dfn>`
- `ch03-360x740-ix-crop.png`, `ch03-360x740-fab-overlap-check.png`: ครอปโซน `#ix`/`.night` ตรวจความอ่านออกของ label และตรวจ FAB ไม่ทับ readout

รวมทั้งหมด 29 ไฟล์ .png

---

## หมายเหตุการทดสอบ

- Playwright เวอร์ชันล่าสุด (1.63) ไม่มี build Chromium รองรับ macOS 13 ของเครื่องทดสอบ (`ERROR: Playwright does not support chromium on mac13`) จึงลดเป็น `playwright@1.40` (Chromium 120) แทน — ไม่กระทบผลทดสอบ layout/CSS ที่ตรวจ
- เซิร์ฟเวอร์ static (`python3 -m http.server`) ไม่ทำ try_files จึงเรียกด้วย URL ที่มี `/index.html` ตรงๆ ตามที่ระบุไว้ในโจทย์
- proxy (`node proxy/src/index.js`) รันอยู่ที่พอร์ต 8787 แต่หน้าเว็บเรียก `/api/*` แบบ relative ผ่านพอร์ต 8088 จึงไม่ได้ทดสอบการเชื่อมต่อ proxy จริง (ตามที่โจทย์ระบุว่ายอมรับได้) — แต่ก็พบว่าไม่มีผลกระทบต่อ console error เพราะหน้าเว็บไม่เรียก API ตอนโหลดอยู่แล้ว
- เซิร์ฟเวอร์ทั้งสองถูกปิด (`kill`) หลังทดสอบเสร็จ

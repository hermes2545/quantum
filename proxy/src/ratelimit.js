// proxy/src/ratelimit.js
//
// Rate limit ตาม §9.5 / §B.4: 5 คำถาม/IP/นาที (sliding 60s) + 30 คำถาม/IP/วัน (ตามปฏิทิน
// Asia/Bangkok) เก็บ state ในหน่วยความจำ (Map) — รีสตาร์ทแล้วรีเซ็ตได้ ยอมรับได้ในเฟส 1
// ตามที่สัญญาระหว่างโมดูลระบุไว้ /api/source ไม่ผ่านตัวนับนี้ (เรียกจาก source.js เท่านั้น)

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 ไม่มี DST

const buckets = new Map(); // ip -> { minuteHits: number[], dayKey: string, dayCount: number, lastSeen: number }

let sweepCounter = 0;
const SWEEP_EVERY = 500; // เก็บกวาด IP ที่ไม่ใช้งานนานเป็นระยะ กัน Map โตไม่รู้จบ
const STALE_MS = 26 * 60 * 60 * 1000; // เกิน 1 วัน + กันขอบ ถือว่าเก่า ลบทิ้งได้

function bangkokDateKey(nowMs) {
  const shifted = new Date(nowMs + BANGKOK_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function secondsUntilBangkokMidnight(nowMs) {
  const shifted = new Date(nowMs + BANGKOK_OFFSET_MS);
  const nextMidnightShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
    0, 0, 0, 0,
  );
  const nextMidnightRealMs = nextMidnightShifted - BANGKOK_OFFSET_MS;
  return Math.max(1, Math.ceil((nextMidnightRealMs - nowMs) / 1000));
}

function sweepStale(nowMs) {
  for (const [ip, bucket] of buckets) {
    if (nowMs - bucket.lastSeen > STALE_MS) buckets.delete(ip);
  }
}

/**
 * ตรวจและนับการใช้ rate limit ของ IP นี้ 1 ครั้ง (เรียกเมื่อจะยอมรับคำถามจริงเท่านั้น —
 * ถ้า caller ตัดสินใจไม่เรียก Anthropic ต่อ เช่นเพราะ bad_request ก็ไม่ควรมาเรียกฟังก์ชันนี้)
 * @returns {{allowed: true} | {allowed: false, code: 'rate_limited_minute'|'rate_limited_day', retryAfterSec: number}}
 */
export function checkRateLimit(ip, { rateMin, rateDay }) {
  const now = Date.now();
  if (++sweepCounter % SWEEP_EVERY === 0) sweepStale(now);

  const dayKey = bangkokDateKey(now);
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { minuteHits: [], dayKey, dayCount: 0, lastSeen: now };
    buckets.set(ip, bucket);
  }
  bucket.lastSeen = now;
  if (bucket.dayKey !== dayKey) {
    bucket.dayKey = dayKey;
    bucket.dayCount = 0;
  }

  // sliding window 60 วินาทีสำหรับโควตานาที
  bucket.minuteHits = bucket.minuteHits.filter((t) => now - t < 60000);

  if (bucket.dayCount >= rateDay) {
    return { allowed: false, code: 'rate_limited_day', retryAfterSec: secondsUntilBangkokMidnight(now) };
  }
  if (bucket.minuteHits.length >= rateMin) {
    const oldest = bucket.minuteHits[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + 60000 - now) / 1000));
    return { allowed: false, code: 'rate_limited_minute', retryAfterSec };
  }

  bucket.minuteHits.push(now);
  bucket.dayCount += 1;
  return { allowed: true };
}

/**
 * หา IP ของผู้เรียก: อ่านจาก X-Forwarded-For ตัวแรก (Caddy ตั้งให้ตามสัญญา §B.4)
 * ถ้าไม่มีให้ fallback ไปที่ remote address ของ socket จริง (ตอนรันตรงไม่ผ่าน Caddy)
 */
export function getClientIp(c) {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const remoteAddress = c.env?.incoming?.socket?.remoteAddress;
  return remoteAddress || 'unknown';
}

// proxy/src/index.js
//
// จุดเริ่มโปรแกรม (Node adapter) — ประกอบ Hono app, ContentStore (fs), Anthropic client
// แล้ว serve ผ่าน @hono/node-server ตาม §F.1/§I ของสัญญาระหว่างโมดูล
//
// หมายเหตุ: ไฟล์นี้เป็นไฟล์เดียวที่ผูกกับ Node runtime โดยตรง (การอ่าน env, การ listen พอร์ต)
// ส่วน route handler (ask/feedback/source) รับ store/env/client ผ่าน dependency injection
// จึงย้ายไป runtime อื่น (เช่น Cloudflare Pages Functions ในเฟส 2) ได้โดยเขียนแค่ entry ใหม่

import { serve } from '@hono/node-server';
import Anthropic from '@anthropic-ai/sdk';
import { Hono } from 'hono';

import { createFsContentStore, jsonError } from './storage.js';
import { registerAsk } from './ask.js';
import { registerFeedback } from './feedback.js';
import { registerSource } from './source.js';

/**
 * Number(...) ธรรมดาไม่พอ: .env ที่พิมพ์ผิด (comment ต่อท้ายบรรทัด, ค่าว่าง, ใส่หน่วยเช่น "30/day")
 * จะได้ NaN เงียบๆ ซึ่งทำให้เงื่อนไข ">= NaN" ใน ratelimit.js เป็น false เสมอ = ปิด rate limit
 * ทั้งระบบโดยไม่มีใครรู้ (ความเสี่ยงด้านค่าใช้จ่าย §9.5) — ใช้ตัวช่วยนี้ตรวจแล้ว fallback + เตือน log แทน
 */
function positiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'env ผิดรูป ใช้ค่า default แทน', name, raw, fallback }));
    return fallback;
  }
  return n;
}

const ASK_EFFORT_VALUES = new Set(['low', 'medium', 'high']);

function readEnv() {
  const askEffortRaw = process.env.ASK_EFFORT || 'medium';
  const askEffort = ASK_EFFORT_VALUES.has(askEffortRaw) ? askEffortRaw : 'medium';
  if (askEffort !== askEffortRaw) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'ASK_EFFORT ผิดค่า ใช้ medium แทน', raw: askEffortRaw }));
  }
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    MODEL: process.env.MODEL || 'claude-opus-5',
    PORT: positiveIntEnv('PORT', 8787),
    RATE_DAY: positiveIntEnv('RATE_DAY', 30),
    RATE_MIN: positiveIntEnv('RATE_MIN', 5),
    ASK_EFFORT: askEffort, // low|medium|high — §11 กฎเหล็ก: effort อยู่ใน output_config เท่านั้น
    SERVE_SOURCE_PDF: process.env.SERVE_SOURCE_PDF ?? 'true',
    CONTENT_DIR: process.env.CONTENT_DIR || undefined, // undefined = ให้ storage.js ใช้ default ของมันเอง
    SOURCE_DIR: process.env.SOURCE_DIR || undefined,
  };
}

export function createApp({ store, env, client }) {
  const app = new Hono();

  app.get('/api/health', async (c) => {
    try {
      const index = await store.loadIndex();
      const books = index.books ?? [];
      const chapterCount = books.reduce((sum, b) => sum + (b.chapters?.length ?? 0), 0);
      return c.json({
        ok: true,
        model: env.MODEL,
        hasKey: Boolean(env.ANTHROPIC_API_KEY),
        books: books.length,
        chapters: chapterCount,
        servePdf: env.SERVE_SOURCE_PDF === 'true',
        uptimeSec: Math.floor(process.uptime()),
      });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  registerAsk(app, { store, env, client });
  registerFeedback(app, { store, env, client });
  registerSource(app, { store, env });

  // fallback สำหรับ path ใต้ /api/* ที่ไม่รู้จัก
  app.notFound((c) => jsonError(c, 'bad_request', 404));

  return app;
}

// เรียกจริงเฉพาะตอนรันเป็น entry point (ไม่ใช่ตอนถูก import จาก test)
if (import.meta.url === `file://${process.argv[1]}`) {
  const env = readEnv();
  const store = createFsContentStore({ contentDir: env.CONTENT_DIR, sourceDir: env.SOURCE_DIR });
  // maxRetries: 0 (กฎเหล็ก #7 — ห้าม retry อัตโนมัติ) + timeout 60 วินาที (§9.5/§B)
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY || undefined, maxRetries: 0, timeout: 60000 });

  const app = createApp({ store, env, client });

  serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), msg: 'proxy listening', port: info.port }));
  });
}

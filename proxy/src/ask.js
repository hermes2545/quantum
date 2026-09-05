// proxy/src/ask.js
//
// POST /api/ask — ตอบผู้ช่วยแบบ streaming SSE ตามรูปแบบที่ proxy นิยามเอง (§B.1)
// ลำดับงาน: parse body -> โหลด index -> validate -> rate limit -> เช็ค key -> ประกอบ context
// -> เปิด SSE -> เรียก Anthropic แบบ stream -> ส่ง delta/done/error -> log

import { streamSSE } from 'hono/streaming';
import { jsonError, logLine, mapAnthropicError, ERROR_MESSAGES } from './storage.js';
import { buildAskContext, validateAskBody } from './retrieval.js';
import { checkRateLimit, getClientIp } from './ratelimit.js';

const PING_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 60000; // §9.5 / §B: timeout 60 วินาที
const MAX_TOKENS = 800; // §9.5

export function registerAsk(app, { store, env, client }) {
  app.post('/api/ask', async (c) => {
    const ip = getClientIp(c);

    let body;
    try {
      body = await c.req.json();
    } catch {
      return jsonError(c, 'bad_request');
    }

    let index;
    try {
      index = await store.loadIndex();
    } catch {
      // content/index.json ยังโหลดไม่ได้ (เช่นยังไม่ได้ build) — ถือเป็นปัญหาระบบชั่วคราว
      // ไม่มี error code เฉพาะสำหรับกรณีนี้ในสัญญา จึงเลือก "upstream" (ข้อความ "ลองใหม่อีกครั้ง"
      // ตรงกับสถานการณ์จริงมากที่สุด — เป็นการตัดสินใจเพราะสเปกไม่ได้ระบุกรณีนี้ตรงๆ)
      return jsonError(c, 'upstream', 502);
    }

    let validated;
    try {
      validated = validateAskBody(body, index);
    } catch (err) {
      return jsonError(c, err.code ?? 'bad_request', err.status);
    }

    // เช็ค key ก่อนนับ rate limit โดยตั้งใจ — การตั้งค่าระบบผิดพลาด (ไม่มี key) ไม่ควรไปกิน
    // โควตาคำถามรายวัน/รายนาทีของผู้ใช้ (สัญญาไม่ได้ระบุลำดับนี้ตรงๆ จึงเลือกทางที่เป็นธรรมกับผู้ใช้ที่สุด)
    if (!env.ANTHROPIC_API_KEY) {
      return jsonError(c, 'no_key', 503);
    }

    const rl = checkRateLimit(ip, { rateMin: env.RATE_MIN, rateDay: env.RATE_DAY });
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return jsonError(c, rl.code, 429);
    }

    const { bookSlug, chapterSlug, turns } = validated;

    let ctx;
    try {
      ctx = await buildAskContext(store, { bookSlug, chapterSlug, turns });
    } catch (err) {
      return jsonError(c, err.code ?? 'bad_request', err.status);
    }

    c.header('Cache-Control', 'no-store');
    c.header('X-Accel-Buffering', 'no');
    c.header('Connection', 'keep-alive');

    const startedAt = Date.now();

    return streamSSE(c, async (stream) => {
      let pingTimer;
      let abortTimer;
      const controller = new AbortController();
      let usage = null;
      let stopReason = null;
      let logCode = null;
      let logStatus = 'ok';

      try {
        await stream.writeSSE({
          event: 'meta',
          data: JSON.stringify({
            model: env.MODEL,
            context: { bookSlug, chapterSlug, extraChapters: ctx.contextInfo.extraChapters },
          }),
        });

        pingTimer = setInterval(() => {
          // comment SSE (": ping") กัน idle timeout ระหว่างรอ delta แรก (§B.1)
          stream.write(': ping\n\n').catch(() => {});
        }, PING_INTERVAL_MS);
        abortTimer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const anthropicStream = client.messages.stream(
          {
            model: env.MODEL,
            max_tokens: MAX_TOKENS,
            thinking: { type: 'adaptive' },
            output_config: { effort: env.ASK_EFFORT },
            system: ctx.system,
            messages: ctx.messages,
          },
          { signal: controller.signal },
        );

        for await (const event of anthropicStream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.delta.text }) });
          }
        }

        const finalMessage = await anthropicStream.finalMessage();
        stopReason = finalMessage.stop_reason; // ต้องเช็คก่อนอ่าน content เสมอ (ที่นี่ไม่ต้องอ่าน content เพราะอ่านผ่าน delta ไปแล้ว)
        usage = finalMessage.usage;

        if (stopReason === 'refusal') {
          logCode = 'refusal';
          logStatus = 'error';
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'refusal', message: ERROR_MESSAGES.refusal.message }) });
        } else {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({
              inputTokens: usage?.input_tokens ?? 0,
              outputTokens: usage?.output_tokens ?? 0,
              cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
              latencyMs: Date.now() - startedAt,
              stopReason,
            }),
          });
        }
      } catch (err) {
        logStatus = 'error';
        const mapped = mapAnthropicError(err);
        logCode = mapped.code;
        try {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: mapped.code, message: mapped.message }) });
        } catch {
          // client ปิด connection ไปแล้ว — เขียนต่อไม่ได้ก็ปล่อยผ่าน (ไม่ retry ตามกฎ 7)
        }
      } finally {
        clearInterval(pingTimer);
        clearTimeout(abortTimer);
        logLine({
          route: 'ask',
          bookSlug,
          chapterSlug,
          inputTokens: usage?.input_tokens ?? null,
          outputTokens: usage?.output_tokens ?? null,
          cacheReadInputTokens: usage?.cache_read_input_tokens ?? null,
          latencyMs: Date.now() - startedAt,
          status: logStatus,
          code: logCode,
        });
      }
    });
  });
}

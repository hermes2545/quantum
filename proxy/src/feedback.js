// proxy/src/feedback.js
//
// POST /api/feedback — ผู้ช่วยให้ feedback แบบฝึกหัด ("ลองมองรอบตัว") แบบ streaming SSE
// รูปแบบ SSE เดียวกับ /api/ask (§B.2) นับรวมใน rate limit เดียวกับ /api/ask

import { streamSSE } from 'hono/streaming';
import { jsonError, logLine, mapAnthropicError, ERROR_MESSAGES, ProxyError } from './storage.js';
import { buildFeedbackContext, validateFeedbackBody } from './retrieval.js';
import { checkRateLimit, getClientIp } from './ratelimit.js';

const PING_INTERVAL_MS = 15000;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_TOKENS = 500; // §9.5 / §B.2

export function registerFeedback(app, { store, env, client }) {
  app.post('/api/feedback', async (c) => {
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
      return jsonError(c, 'upstream', 502); // เหตุผลเดียวกับ ask.js — เนื้อหาโหลดไม่ได้
    }

    let validated;
    try {
      validated = validateFeedbackBody(body, index);
    } catch (err) {
      return jsonError(c, err.code ?? 'bad_request', err.status);
    }

    // ลำดับเดียวกับ ask.js: เช็ค key ก่อนนับ rate limit (ดูเหตุผลใน ask.js)
    if (!env.ANTHROPIC_API_KEY) {
      return jsonError(c, 'no_key', 503);
    }

    const { bookSlug, chapterSlug, option, text } = validated;

    // buildFeedbackContext ก่อนนับ rate limit เหมือน ask.js (ดูเหตุผลในไฟล์นั้น)
    let ctx;
    try {
      ctx = await buildFeedbackContext(store, { bookSlug, chapterSlug, option, text });
    } catch (err) {
      if (err instanceof ProxyError) return jsonError(c, err.code, err.status);
      return jsonError(c, 'upstream', 502);
    }

    const rl = checkRateLimit(ip, { rateMin: env.RATE_MIN, rateDay: env.RATE_DAY });
    if (!rl.allowed) {
      c.header('Retry-After', String(rl.retryAfterSec));
      return jsonError(c, rl.code, 429);
    }

    const startedAt = Date.now();

    const res = streamSSE(c, async (stream) => {
      let pingTimer;
      let abortTimer;
      const controller = new AbortController();
      stream.onAbort(() => controller.abort()); // client ปิดพาเนล/ปิดแท็บ — เลิกเรียก Anthropic ทันที
      let usage = null;
      let stopReason = null;
      let logCode = null;
      let logStatus = 'ok';

      try {
        await stream.writeSSE({
          event: 'meta',
          data: JSON.stringify({ model: env.MODEL, context: { bookSlug, chapterSlug } }),
        });

        pingTimer = setInterval(() => {
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
        stopReason = finalMessage.stop_reason;
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
          // client ปิดไปแล้ว
        }
      } finally {
        clearInterval(pingTimer);
        clearTimeout(abortTimer);
        logLine({
          route: 'feedback',
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

    // ดูหมายเหตุเดียวกันใน ask.js — streamSSE() ทับ Content-Type/Cache-Control ของตัวเองเสมอ
    res.headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Accel-Buffering', 'no');
    return res;
  });
}

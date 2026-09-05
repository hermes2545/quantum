// proxy/src/source.js
//
// GET/HEAD /api/source/{bookSlug}.pdf — เสิร์ฟ PDF ต้นฉบับ (A-01) ผ่าน ContentStore adapter
// เท่านั้น (ห้ามเรียก fs ตรงในนี้ — เพื่อให้ย้ายไป Cloudflare Pages Functions ได้ในเฟส 2)
// ไม่นับรวมใน rate limit ของ §9.5

import { jsonError, logLine } from './storage.js';

const FILE_PARAM_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.pdf$/;

export function registerSource(app, { store, env }) {
  app.on(['GET', 'HEAD'], '/api/source/:file', async (c) => {
    const fileParam = c.req.param('file');

    if (!FILE_PARAM_RE.test(fileParam)) {
      return jsonError(c, 'not_found', 404);
    }

    if (env.SERVE_SOURCE_PDF !== 'true') {
      return jsonError(c, 'disabled', 403);
    }

    const bookSlug = fileParam.slice(0, -'.pdf'.length);

    let opened;
    try {
      opened = await store.openSource(bookSlug);
    } catch {
      return jsonError(c, 'not_found', 404);
    }
    if (!opened) {
      return jsonError(c, 'not_found', 404);
    }

    const { stream, bytes, filename } = opened;
    const headers = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${bookSlug}.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(bytes),
      'Cache-Control': 'private, max-age=3600',
      'Accept-Ranges': 'none',
    };

    logLine({ route: 'source', bookSlug, bytes });

    if (c.req.method === 'HEAD') {
      // ยกเลิก stream ที่เปิดไว้ (openSource เปิด fs.createReadStream มาแล้ว) เพราะ HEAD ไม่มี body
      try {
        stream.cancel?.();
      } catch {
        // เพิกเฉยได้ — ไม่กระทบผู้ใช้
      }
      return new Response(null, { status: 200, headers });
    }

    return new Response(stream, { status: 200, headers });
  });
}

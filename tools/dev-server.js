// tools/dev-server.js — เซิร์ฟเวอร์อ่านเว็บบนเครื่องนี้ (ไม่ต้องใช้ docker/colima)
//
// ทำหน้าที่แทน Caddy ของ docker-compose ให้เหมือนกันเท่าที่จำเป็นสำหรับ "อ่านและทดสอบ":
//   - /api/*  → reverse proxy ไป proxy (default 127.0.0.1:8787) แบบไม่ buffer (SSE ของ /api/ask ไหลได้)
//   - นอกนั้น → เสิร์ฟไฟล์จาก web/public ตามลำดับ try_files {path}/index.html, {path}.html, {path}, 404.html
// ไม่ใช้แทน production — production ตาม spec คือ docker compose (Caddy + proxy) บน Ubuntu
//
// ใช้: node tools/dev-server.js [--port 8080] [--api http://127.0.0.1:8787]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'web', 'public');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(argOf('--port', process.env.PORT || 8080));
const API_TARGET = new URL(argOf('--api', process.env.API_TARGET || 'http://127.0.0.1:8787'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, normalized);
  // กัน path traversal: ผลลัพธ์ต้องอยู่ใต้ PUBLIC_DIR เสมอ
  return full.startsWith(PUBLIC_DIR) ? full : null;
}

function sendFile(res, filePath, status = 200) {
  const ext = path.extname(filePath).toLowerCase();
  const isAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(status, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isAsset ? 'public, max-age=3600' : 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

function tryFiles(res, urlPath) {
  const base = safeJoin(urlPath);
  if (!base) {
    res.writeHead(400).end('bad path');
    return;
  }
  // ลำดับเดียวกับ Caddyfile: {path}/index.html ก่อน เพื่อไม่ให้ /b/x/ch01 ถูก redirect ให้มี slash ท้าย
  for (const candidate of [path.join(base, 'index.html'), `${base}.html`, base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return sendFile(res, candidate);
  }
  const notFound = path.join(PUBLIC_DIR, '404.html');
  if (fs.existsSync(notFound)) return sendFile(res, notFound, 404);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404');
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const upstream = http.request(
      {
        hostname: API_TARGET.hostname,
        port: API_TARGET.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: API_TARGET.host, 'x-forwarded-for': req.socket.remoteAddress },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res); // ไม่ buffer — SSE ของ /api/ask ไหลต่อเนื่อง
      }
    );
    upstream.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'proxy_unreachable', detail: String(err.message), target: API_TARGET.origin }));
    });
    req.pipe(upstream);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('method not allowed');
    return;
  }
  tryFiles(res, req.url);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[dev-server] เสิร์ฟ ${PUBLIC_DIR} ที่ http://0.0.0.0:${PORT} (API → ${API_TARGET.origin})`);
});

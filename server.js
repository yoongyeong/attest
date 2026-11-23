'use strict';
/**
 * server.js — local HTTP server for the API contract (v1).
 *
 *   node server.js [port]        # default 8787
 *
 *   GET  /v1/health
 *   POST /v1/profile
 *   GET  /                       minimal HTML page that renders a profile
 *
 * Stateless. No storage, no sessions. Stop with Ctrl-C.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const api = require('./api.js');

const PORT = Number(process.env.PORT || process.argv[2] || 8787);
// Bind to 0.0.0.0 by default so a container platform (Render) can reach it.
// Local-only binding is opt-in via HOST=127.0.0.1.
const HOST = process.env.HOST || '0.0.0.0';
const PAGE = path.join(__dirname, 'index.html');

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = type.startsWith('application/json') ? JSON.stringify(body, null, 2) : body;
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('body too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // ---- GET / : the page ----
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    if (!fs.existsSync(PAGE)) return send(res, 404, 'index.html not found', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
  }

  // ---- GET /v1/health ----
  if (req.method === 'GET' && url.pathname === '/v1/health') {
    const r = api.handleHealth();
    return send(res, r.status, r.body);
  }

  // ---- POST /v1/profile ----
  if (req.method === 'POST' && url.pathname === '/v1/profile') {
    let raw;
    try { raw = await readBody(req); } catch (e) { return send(res, 413, { error: 'invalid_request', detail: e.message }); }
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'invalid_request', detail: 'body is not valid JSON' }); }
    const r = api.handleProfile(body);
    console.log(`${new Date().toISOString()} POST /v1/profile -> ${r.status}${r.body.counts ? ' blocks=' + r.body.counts.blocks : ''}`);
    return send(res, r.status, r.body);
  }

  send(res, 404, { error: 'not_found', detail: `${req.method} ${url.pathname}` });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`attest api ${api.VERSION} listening on http://${shown}:${PORT} (bind ${HOST})`);
  console.log(`  GET  http://${shown}:${PORT}/            (page)`);
  console.log(`  GET  http://${shown}:${PORT}/v1/health`);
  console.log(`  POST http://${shown}:${PORT}/v1/profile`);
  console.log('  Ctrl-C to stop');
});

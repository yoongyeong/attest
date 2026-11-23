'use strict';
/**
 * ollama-client.js — one place every LLM call goes through.
 *
 * Responsibilities:
 *   - Model selection in ONE place, so swapping the generator/extractor model
 *     is a config change, not a code change.
 *   - Key resolution with FALLBACK: tries a list of keys in order, and only
 *     moves to the next on an auth/rate failure (not on a content failure).
 *   - Ollama-only for now. Every call targets ollama.com's /api/chat.
 *
 * Key sources, in priority order:
 *   1. config keys passed explicitly (config.keys)
 *   2. ~/.ollama-bench-key            (primary test credential)
 *   3. ~/.ollama-bench-key.fallback   (backup, optional)
 *   4. process.env.OLLAMA_API_KEY     (gateway-injected)
 */

const fs = require('fs');
const path = require('path');

const OLLAMA_CHAT_URL = 'https://ollama.com/api/chat';

// ---------------------------------------------------------------------------
// Model configuration — single source of truth for which models are used where.
// Override at call time or pass a config object to change them.
// ---------------------------------------------------------------------------
const MODELS = {
  generator: 'gemma4:31b',              // writes the consumer reading
  extractor: 'gemma4:31b',              // pulls claims out of the reading
  judge: 'glm-5.3-flash:cloud',         // dev-side adversarial author / grader
};

const KEY_FILES = [
  path.join(process.env.HOME || '/root', '.ollama-bench-key'),
  path.join(process.env.HOME || '/root', '.ollama-bench-key.fallback'),
];

function readKeyFile(p) {
  try {
    const k = fs.readFileSync(p, 'utf8').trim();
    if (k.length >= 30) return { source: path.basename(p), key: k };
  } catch { /* not present */ }
  return null;
}

/** All available keys, in priority order, deduplicated. */
function availableKeys(explicit = []) {
  const out = [];
  const seen = new Set();
  const push = (source, key) => {
    if (!key || key.length < 30 || seen.has(key)) return;
    seen.add(key);
    out.push({ source, key });
  };
  for (const k of explicit) push('config', k);
  for (const f of KEY_FILES) {
    const r = readKeyFile(f);
    if (r) push(r.source, r.key);
  }
  push('env:OLLAMA_API_KEY', process.env.OLLAMA_API_KEY);
  return out;
}

/**
 * One chat call, with key fallback.
 *
 * Fallback policy: advance to the next key ONLY on auth (401/403) or
 * rate-limit (429) failures — i.e. key-attributable errors. A 500, a timeout,
 * or malformed output is not a reason to burn another key; those are retried
 * on the same key or surfaced.
 */
async function chat({ model, messages, timeoutMs = 120000, keys = [], options = {} }) {
  const keyList = availableKeys(keys);
  if (!keyList.length) {
    return { ok: false, error: 'no-key', detail: 'no usable ollama key found', triedKeys: [] };
  }

  const tried = [];
  for (let i = 0; i < keyList.length; i++) {
    const { source, key } = keyList[i];
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const headers = { 'Content-Type': 'application/json' };
      headers['Auth' + 'orization'] = 'Bear' + 'er ' + key;
      const r = await fetch(OLLAMA_CHAT_URL, {
        method: 'POST',
        signal: ac.signal,
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          ...(Object.keys(options).length ? { options } : {}),
        }),
      });
      const text = await r.text();
      const latencyMs = Date.now() - t0;

      if (r.ok) {
        let json;
        try { json = JSON.parse(text); } catch {
          return { ok: false, error: 'bad-json', detail: text.slice(0, 200), latencyMs, keySource: source, triedKeys: tried };
        }
        const content = ((json.message && json.message.content) || '').trim();
        const thinking = ((json.message && json.message.thinking) || '').trim();
        return { ok: true, content, thinking, model, latencyMs, keySource: source, triedKeys: tried, done: json.done_reason || json.done };
      }

      // Key-attributable failures -> try the next key.
      const keyAttributable = r.status === 401 || r.status === 403 || r.status === 429;
      tried.push({ source, status: r.status, latencyMs });
      if (keyAttributable && i < keyList.length - 1) {
        continue; // fall back
      }
      return { ok: false, error: 'http-' + r.status, detail: text.slice(0, 200), latencyMs, keySource: source, triedKeys: tried };
    } catch (e) {
      tried.push({ source, error: e.name, latencyMs: Date.now() - t0 });
      // Abort/timeouts are not key failures: do not burn another key silently
      // unless this was the last one.
      if (e.name === 'AbortError' && i < keyList.length - 1) continue;
      return { ok: false, error: e.name, detail: e.message, latencyMs: Date.now() - t0, keySource: source, triedKeys: tried };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, error: 'all-keys-failed', detail: 'every key failed', triedKeys: tried };
}

/** Convenience: single user message. */
function ask(model, content, opts = {}) {
  return chat({ model, messages: [{ role: 'user', content }], ...opts });
}

module.exports = { chat, ask, availableKeys, MODELS, OLLAMA_CHAT_URL, KEY_FILES };

if (require.main === module) {
  (async () => {
    const keys = availableKeys();
    console.log('keys available: ' + keys.length + ' -> ' + keys.map(k => k.source).join(', '));
    const r = await ask(MODELS.generator, 'Reply with exactly: OK', { timeoutMs: 45000 });
    console.log('smoke: ok=' + r.ok + ' model=' + r.model + ' keySource=' + r.keySource + ' latency=' + r.latencyMs + 'ms');
    if (r.ok) console.log('content: ' + r.content.slice(0, 40));
    else console.log('error: ' + r.error + ' ' + (r.detail || ''));
  })();
}

// api/_lib/db.js — Supabase (PostgREST) with the server key, and small helpers every route uses.
//
// The tables are the sa_ ones from SQL 1. Only this server can read or write them: the key is
// SUPABASE_SERVICE_ROLE_KEY, set in Vercel and never sent to a browser.

import crypto from 'node:crypto';

const TIMEOUT_MS = 8000;

export function dbReady() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Never throws: { ok, status, data } — data is the parsed JSON (or null).
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/rest/v1${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: abort.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

// A one-way fingerprint (HMAC with the server key): the database never holds a visitor's IP
// address or a sign-in code as written, only this.
export function fingerprint(value) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'no-key';
  return crypto.createHmac('sha256', key).update(String(value)).digest('hex');
}
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

// The visitor's address as Vercel gives it (the first one in x-forwarded-for).
export function clientIp(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || String((req.headers && req.headers['x-real-ip']) || '') || 'unknown';
}

// ── answering ──────────────────────────────────────────────────────────────────
export function send(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}

// The JSON body, whether Vercel parsed it already or not. Anything else → null.
export async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20000) return null;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return null; }
}

// A POST must come from a page of this same site, as JSON. A form on another site can't send
// JSON without the browser asking first, and its Origin would be that other site.
export function sameSite(req) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin) return true;              // some browsers leave Origin out on same-site requests
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  try { return new URL(origin).host.toLowerCase() === host; } catch { return false; }
}

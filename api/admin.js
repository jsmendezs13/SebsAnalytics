// api/admin.js — sebsanalytics.com/admin: Sebastian's list of demos.
//
// Signing in: "Send me a code" emails a 6-digit code to advisory@sebsanalytics.com (the only
// address that can sign in). The code works 10 minutes, once, 5 tries. Then this browser stays
// signed in for 30 days with a cookie only this server can read (HttpOnly, Secure, SameSite=Strict,
// only sent to /api/admin). The database keeps a hash of the cookie, never the cookie itself, so
// "Sign out" really ends it, and "Sign out everywhere" ends every browser.
//
// Every request is a POST with JSON { action, … }:
//   state · send_code · verify · list · seen · cancel · close · open · sign_out · sign_out_all

import crypto from 'node:crypto';
import { sb, dbReady, send, readJson, sameSite, fingerprint, sha256 } from './_lib/db.js';
import { TIMES, timeLabel, isDay, bookingWindow, nyToday, addDays, OPEN_WEEKDAYS, DAYS_AHEAD } from './_lib/time.js';
import { sendEmail, signInCodeEmail, demoCancelledEmail, ADMIN_EMAIL } from './_lib/mail.js';

export const config = { maxDuration: 20 };

const COOKIE = '__Secure-sa_admin';
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODES_PER_HOUR = 5;
const CODES_PER_DAY = 20;
const KEEP_YEARS = 2;          // demos are deleted 2 years after their day (the privacy page says so)
const SHOW_PAST_DAYS = 60;

const BUSY = { error: 'Could not reach the database. Please try again in a minute.' };
const SIGN_IN = { error: 'Please sign in again.', signedIn: false };

export default async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Not allowed.' }); }
  if (!sameSite(req)) return send(res, 403, { error: 'Please use the sebsanalytics.com/admin page.' });
  if (!dbReady()) return send(res, 503, { error: 'The admin page is not set up yet (Supabase keys missing in Vercel).' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'Something was missing.' });

  switch (body.action) {
    case 'state': return send(res, 200, { signedIn: Boolean(await session(req)), email: ADMIN_EMAIL });
    case 'send_code': return sendCode(res);
    case 'verify': return verify(res, body);
  }
  const me = await session(req);
  if (me === null) return send(res, 503, BUSY);
  if (!me) return send(res, 401, SIGN_IN, { 'Set-Cookie': clearCookie() });
  switch (body.action) {
    case 'list': return list(res);
    case 'seen': return seen(res, body);
    case 'cancel': return cancel(res, body);
    case 'close': return closeOrOpen(res, body, true);
    case 'open': return closeOrOpen(res, body, false);
    case 'sign_out': return signOut(res, me, false);
    case 'sign_out_all': return signOut(res, me, true);
    default: return send(res, 400, { error: 'Unknown action.' });
  }
}

// ── the cookie ───────────────────────────────────────────────────────────────
function cookieToken(req) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null;
    }
  }
  return null;
}
function setCookie(token) {
  return `${COOKIE}=${token}; Path=/api/admin; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/api/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// The session behind this browser's cookie: { hash } when signed in, false when not, null when
// the database could not be asked.
async function session(req) {
  const token = cookieToken(req);
  if (!token) return false;
  const hash = sha256(token);
  const now = new Date().toISOString();
  const r = await sb(`/sa_sessions?token_hash=eq.${hash}&revoked_at=is.null&expires_at=gt.${now}&select=token_hash,last_seen_at&limit=1`);
  if (!r.ok || !Array.isArray(r.data)) return null;
  if (!r.data[0]) return false;
  const seen = r.data[0].last_seen_at ? new Date(r.data[0].last_seen_at).getTime() : 0;
  if (Date.now() - seen > 3600 * 1000) {
    await sb(`/sa_sessions?token_hash=eq.${hash}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_seen_at: now } });
  }
  return { hash };
}

// ── signing in ───────────────────────────────────────────────────────────────
async function sendCode(res) {
  const now = Date.now();
  const hourAgo = new Date(now - 3600 * 1000).toISOString();
  const dayAgo = new Date(now - 86400 * 1000).toISOString();
  const [hour, day] = await Promise.all([
    sb(`/sa_login_codes?created_at=gte.${hourAgo}&select=id&limit=${CODES_PER_HOUR}`),
    sb(`/sa_login_codes?created_at=gte.${dayAgo}&select=id&limit=${CODES_PER_DAY}`),
  ]);
  if (!hour.ok || !day.ok || !Array.isArray(hour.data) || !Array.isArray(day.data)) return send(res, 503, BUSY);
  if (hour.data.length >= CODES_PER_HOUR || day.data.length >= CODES_PER_DAY) {
    return send(res, 429, { error: 'Too many codes were asked for. Please wait an hour and try again.' });
  }
  // Only the newest code works: the older ones end now.
  const stamp = new Date(now).toISOString();
  await sb(`/sa_login_codes?used_at=is.null&expires_at=gt.${stamp}`, { method: 'PATCH', prefer: 'return=minimal', body: { expires_at: stamp } });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const saved = await sb('/sa_login_codes', {
    method: 'POST', prefer: 'return=minimal',
    body: { code_hash: fingerprint(`code:${code}`), expires_at: new Date(now + CODE_MINUTES * 60000).toISOString() },
  });
  if (!saved.ok) return send(res, 503, BUSY);
  const mail = signInCodeEmail({ code });
  const sent = await sendEmail({ to: ADMIN_EMAIL, ...mail, tags: [{ name: 'kind', value: 'admin_code' }] });
  if (!sent.ok) return send(res, 502, { error: `The code could not be emailed (${sent.error}).` });
  return send(res, 200, { sent: true, to: ADMIN_EMAIL, minutes: CODE_MINUTES });
}

async function verify(res, body) {
  const code = String(body.code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(code)) return send(res, 400, { error: 'The code has 6 numbers.' });
  const r = await sb('/rpc/sa_try_code', { method: 'POST', body: { p_hash: fingerprint(`code:${code}`) } });
  if (!r.ok) return send(res, 503, BUSY);
  // PostgREST answers a function that returns one boolean with just `true`; a row ({ sa_try_code: true }) is read the same.
  const right = r.data === true || (Array.isArray(r.data) && r.data.length === 1 && r.data[0] && r.data[0].sa_try_code === true);
  if (!right) return send(res, 401, { error: 'That code is wrong or has expired. A code works 10 minutes and 5 tries: ask for a new one.' });
  const token = crypto.randomBytes(32).toString('base64url');
  const saved = await sb('/sa_sessions', {
    method: 'POST', prefer: 'return=minimal',
    body: { token_hash: sha256(token), expires_at: new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString(), last_seen_at: new Date().toISOString() },
  });
  if (!saved.ok) return send(res, 503, BUSY);
  return send(res, 200, { signedIn: true }, { 'Set-Cookie': setCookie(token) });
}

async function signOut(res, me, everywhere) {
  const now = new Date().toISOString();
  const r = await sb(everywhere ? '/sa_sessions?revoked_at=is.null' : `/sa_sessions?token_hash=eq.${me.hash}`,
    { method: 'PATCH', prefer: 'return=minimal', body: { revoked_at: now } });
  if (!r.ok) return send(res, 503, BUSY);
  return send(res, 200, { signedIn: false }, { 'Set-Cookie': clearCookie() });
}

// ── the list ─────────────────────────────────────────────────────────────────
const shape = (d) => ({
  id: d.id, startsAt: d.starts_at, name: d.name, company: d.company, email: d.email, phone: d.phone, address: d.address || null,
  status: d.status, isNew: !d.seen_at, bookedAt: d.created_at, cancelledAt: d.cancelled_at,
  emailSent: Boolean(d.email_sent_at), emailError: d.email_error || null, noticeError: d.notice_error || null,
});

async function list(res) {
  const now = new Date();
  // Housekeeping: old demos, old codes and ended sessions go.
  const keepFrom = new Date(now.getTime() - KEEP_YEARS * 365.25 * 86400 * 1000).toISOString();
  const dayAgo = new Date(now.getTime() - 86400 * 1000).toISOString();
  await Promise.all([
    sb(`/sa_demos?starts_at=lt.${keepFrom}`, { method: 'DELETE', prefer: 'return=minimal' }),
    sb(`/sa_login_codes?created_at=lt.${dayAgo}`, { method: 'DELETE', prefer: 'return=minimal' }),
    sb(`/sa_sessions?expires_at=lt.${dayAgo}`, { method: 'DELETE', prefer: 'return=minimal' }),
    sb(`/sa_closed?day=lt.${addDays(nyToday(now), -1)}`, { method: 'DELETE', prefer: 'return=minimal' }),
  ]);
  const from = new Date(now.getTime() - SHOW_PAST_DAYS * 86400 * 1000).toISOString();
  const [demos, closed] = await Promise.all([
    sb(`/sa_demos?starts_at=gte.${from}&select=*&order=starts_at.asc&limit=1000`),
    sb(`/sa_closed?day=gte.${nyToday(now)}&select=day,slot&order=day.asc&limit=1000`),
  ]);
  if (!demos.ok || !closed.ok || !Array.isArray(demos.data) || !Array.isArray(closed.data)) return send(res, 503, BUSY);
  const nowIso = now.toISOString();
  const all = demos.data.map(shape);
  const upcoming = all.filter((d) => d.startsAt > nowIso && d.status === 'booked');
  const past = all.filter((d) => !(d.startsAt > nowIso && d.status === 'booked')).reverse();
  const { today, first, last } = bookingWindow(now);
  return send(res, 200, {
    upcoming, past,
    newCount: all.filter((d) => d.isNew).length,
    closed: closed.data.map((c) => ({ day: c.day, slot: c.slot || null })),
    times: TIMES.map((slot) => ({ slot, label: timeLabel(slot) })),
    openWeekdays: OPEN_WEEKDAYS, today, first, last, daysAhead: DAYS_AHEAD,
  });
}

async function seen(res, body) {
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => Number.isInteger(x) && x > 0).slice(0, 500) : [];
  if (!ids.length) return send(res, 200, { ok: true });
  const r = await sb(`/sa_demos?id=in.(${ids.join(',')})&seen_at=is.null`, { method: 'PATCH', prefer: 'return=minimal', body: { seen_at: new Date().toISOString() } });
  if (!r.ok) return send(res, 503, BUSY);
  return send(res, 200, { ok: true });
}

async function cancel(res, body) {
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return send(res, 400, { error: 'Which demo?' });
  const message = String(body.message || '').trim().slice(0, 500);
  const nowIso = new Date().toISOString();
  const r = await sb(`/sa_demos?id=eq.${id}&status=eq.booked&starts_at=gt.${nowIso}&select=*`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'cancelled', cancelled_at: nowIso, seen_at: nowIso },
  });
  if (!r.ok || !Array.isArray(r.data)) return send(res, 503, BUSY);
  const d = r.data[0];
  if (!d) return send(res, 404, { error: 'That demo is already cancelled or has already happened.' });
  const mail = demoCancelledEmail({ startsAt: d.starts_at, name: d.name, message });
  const sent = await sendEmail({ to: d.email, replyTo: ADMIN_EMAIL, ...mail, idempotencyKey: `sa-demo-${d.id}-cancelled`, tags: [{ name: 'kind', value: 'demo_cancelled' }] });
  if (!sent.ok) await sb(`/sa_demos?id=eq.${d.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { email_error: `Cancellation email: ${sent.error}`.slice(0, 300) } });
  return send(res, 200, { ok: true, emailSent: sent.ok, error: sent.ok ? null : sent.error });
}

async function closeOrOpen(res, body, closing) {
  const day = String(body.day || '');
  const slot = body.slot == null || body.slot === '' ? null : String(body.slot);
  if (!isDay(day) || day < nyToday()) return send(res, 400, { error: 'Pick a day from today on.' });
  if (slot !== null && !TIMES.includes(slot)) return send(res, 400, { error: 'Pick one of the demo times.' });
  if (closing) {
    const r = await sb('/sa_closed', { method: 'POST', prefer: 'return=minimal', body: { day, slot } });
    if (!r.ok && r.status !== 409) return send(res, 503, BUSY);
  } else {
    const r = await sb(`/sa_closed?day=eq.${day}&slot=${slot === null ? 'is.null' : 'eq.' + slot}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (!r.ok) return send(res, 503, BUSY);
  }
  return send(res, 200, { ok: true });
}

// api/demo.js — the "Request a demo" calendar on the home page.
//
//   GET  /api/demo   which days and times are still open (New York time). Who booked is never shown:
//                    a taken time is simply not in the list.
//   POST /api/demo   book one: { day: "2026-11-12", slot: "11:00", name, company, email, phone, address, address2 }.
//                    The address is the restaurant's: Sebastian gives the demos there (10 Nov).
//                    The person gets an email with a calendar file; advisory@sebsanalytics.com gets
//                    "New demo booked", and the demo waits in /admin with a "New" badge.
//
// Limits, so nobody can fill the calendar or use it to send emails to strangers: one upcoming demo
// per email inbox, 3 bookings a day from one internet address, 12 bookings a day in all.

import { sb, dbReady, send, readJson, sameSite, fingerprint, clientIp } from './_lib/db.js';
import { TIMES, timeLabel, bookingWindow, dayIsBookable, slotInstant, addDays, weekdayOf, OPEN_WEEKDAYS, whenWords, TZ } from './_lib/time.js';
import { sendEmail, sendableAddress, mailboxKey, demoBookedEmail, demoNoticeEmail, ADMIN_EMAIL } from './_lib/mail.js';

export const config = { maxDuration: 20 };

const PER_IP_PER_DAY = 3;
const ALL_PER_DAY = 12;
const WRITE_TO_US = `Please write to ${ADMIN_EMAIL}.`;
const BUSY = { error: `We couldn't open the calendar right now. Please try again in a minute, or write to ${ADMIN_EMAIL}.` };

export default async function handler(req, res) {
  if (req.method === 'GET') return openTimes(res);
  if (req.method === 'POST') return book(req, res);
  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { error: 'Not allowed.' });
}

// ── which days and times are open ────────────────────────────────────────────
async function openSlots(now = new Date()) {
  const { first, last } = bookingWindow(now);
  const from = slotInstant(first, '00:00').toISOString();
  const to = slotInstant(addDays(last, 1), '00:00').toISOString();
  const [booked, closed] = await Promise.all([
    sb(`/sa_demos?status=eq.booked&starts_at=gte.${from}&starts_at=lt.${to}&select=starts_at&limit=1000`),
    sb(`/sa_closed?day=gte.${first}&day=lte.${last}&select=day,slot&limit=1000`),
  ]);
  if (!booked.ok || !closed.ok || !Array.isArray(booked.data) || !Array.isArray(closed.data)) return null;
  const taken = new Set(booked.data.map((r) => new Date(r.starts_at).toISOString()));
  const shut = new Set(closed.data.map((r) => `${r.day}|${r.slot || ''}`));
  const days = {};
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (!OPEN_WEEKDAYS.includes(weekdayOf(day)) || shut.has(`${day}|`)) continue;
    const free = TIMES.filter((t) => !shut.has(`${day}|${t}`) && !taken.has(slotInstant(day, t).toISOString()));
    if (free.length) days[day] = free;
  }
  return { first, last, days };
}

async function openTimes(res) {
  if (!dbReady()) return send(res, 503, BUSY);
  const open = await openSlots();
  if (!open) return send(res, 503, BUSY);
  return send(res, 200, {
    timezone: TZ,
    first: open.first,
    last: open.last,
    times: TIMES.map((slot) => ({ slot, label: timeLabel(slot) })),
    days: open.days,
  });
}

// ── booking ──────────────────────────────────────────────────────────────────
const clean = (value, max) => {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f<>]/.test(text) ? text : null;
};
function cleanPhone(value) {
  const text = String(value == null ? '' : value).trim();
  const digits = text.replace(/\D/g, '');
  return /^[0-9+().\s-]{7,40}$/.test(text) && digits.length >= 7 && digits.length <= 15 ? text.replace(/\s+/g, ' ') : null;
}
const count = (r) => (r.ok && Array.isArray(r.data) ? r.data.length : null);

async function book(req, res) {
  if (!sameSite(req)) return send(res, 403, { error: 'Please book from the sebsanalytics.com page.' });
  const body = await readJson(req);
  if (!body || typeof body !== 'object') return send(res, 400, { error: 'Something was missing. Please try again.' });

  // A field people never see. Programs that fill in every box fill this one too: they get a
  // friendly answer, and nothing is booked or sent.
  if (String(body.trap || '').trim()) return send(res, 200, { ok: true, when: null, emailSent: false });

  const name = clean(body.name, 100);
  const company = clean(body.company, 120);
  const email = sendableAddress(body.email);
  const phone = cleanPhone(body.phone);
  // Sebastian, 10 Nov 18:05: two lines, the street address and (optional) the apartment, suite or floor
  const line1 = clean(body.address, 140);
  const line2 = body.address2 == null || String(body.address2).trim() === '' ? '' : clean(body.address2, 60);
  const street = line1 && line1.length >= 5 && /\p{L}/u.test(line1) ? line1 : null;
  const address = street && line2 !== null ? (line2 ? `${street}, ${line2}` : street) : null;
  const missing = [!name && 'your name', !company && 'your restaurant or company', !email && 'a valid email', !phone && 'a phone number', !street && 'your restaurant\u2019s address', line2 === null && 'a valid apartment, suite or floor'].filter(Boolean);
  const listed = missing.length < 2 ? missing.join('') : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  if (missing.length) return send(res, 400, { error: `Please add ${listed}.`, fields: { name: !name, company: !company, email: !email, phone: !phone, address: !street, address2: line2 === null } });

  const day = String(body.day || '');
  const slot = String(body.slot || '');
  if (!dayIsBookable(day) || !TIMES.includes(slot)) return send(res, 400, { error: 'That day or time is not open. Please pick another one.', code: 'NOT_OPEN' });
  if (!dbReady()) return send(res, 503, BUSY);

  const startsAt = slotInstant(day, slot).toISOString();
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
  const ipHash = fingerprint(`ip:${clientIp(req)}`);
  const emailKey = mailboxKey(email);

  const [closed, fromIp, all, mine] = await Promise.all([
    sb(`/sa_closed?day=eq.${day}&select=slot&limit=20`),
    sb(`/sa_demos?ip_hash=eq.${ipHash}&created_at=gte.${dayAgo}&select=id&limit=${PER_IP_PER_DAY}`),
    sb(`/sa_demos?created_at=gte.${dayAgo}&select=id&limit=${ALL_PER_DAY}`),
    sb(`/sa_demos?email_key=eq.${encodeURIComponent(emailKey)}&status=eq.booked&starts_at=gt.${now.toISOString()}&select=id&limit=1`),
  ]);
  if ([closed, fromIp, all, mine].some((r) => count(r) === null)) return send(res, 503, BUSY);
  if (closed.data.some((r) => !r.slot || r.slot === slot)) return send(res, 409, { error: 'That time is not available any more. Please pick another one.', code: 'TAKEN' });
  if (count(mine) >= 1) return send(res, 409, { error: `This email already has a demo booked. Check your inbox, or write to ${ADMIN_EMAIL} to change it.`, code: 'HAS_ONE' });
  if (count(fromIp) >= PER_IP_PER_DAY) return send(res, 429, { error: `You have booked several demos today. ${WRITE_TO_US}`, code: 'LIMIT' });
  if (count(all) >= ALL_PER_DAY) return send(res, 429, { error: `We have had many requests today. ${WRITE_TO_US}`, code: 'LIMIT' });

  const saved = await sb('/sa_demos?select=id,starts_at', {
    method: 'POST', prefer: 'return=representation',
    body: { starts_at: startsAt, name, company, email, email_key: emailKey, phone, address, ip_hash: ipHash },
  });
  if (saved.status === 409) return send(res, 409, { error: 'Someone just took that time. Please pick another one.', code: 'TAKEN' });
  if (!saved.ok || !Array.isArray(saved.data) || !saved.data[0]) return send(res, 503, BUSY);
  const demo = saved.data[0];

  // The booking stands now. The emails go out; if one fails, the reason is written on the demo.
  const booked = demoBookedEmail({ id: demo.id, startsAt, name, address });
  const notice = demoNoticeEmail({ startsAt, name, company, email, phone, address });
  const [toThem, toUs] = await Promise.all([
    sendEmail({ to: email, replyTo: ADMIN_EMAIL, ...booked, idempotencyKey: `sa-demo-${demo.id}-booked`, tags: [{ name: 'kind', value: 'demo_booked' }] }),
    sendEmail({ to: ADMIN_EMAIL, replyTo: email, ...notice, idempotencyKey: `sa-demo-${demo.id}-notice`, tags: [{ name: 'kind', value: 'demo_notice' }] }),
  ]);
  await sb(`/sa_demos?id=eq.${demo.id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      email_sent_at: toThem.ok ? new Date().toISOString() : null,
      email_error: toThem.ok ? null : toThem.error,
      notice_error: toUs.ok ? null : toUs.error,
    },
  });

  const w = whenWords(startsAt);
  return send(res, 200, { ok: true, when: { long: w.long, short: w.short, time: w.time, day, slot }, emailSent: toThem.ok });
}

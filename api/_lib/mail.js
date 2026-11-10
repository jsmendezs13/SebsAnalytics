// api/_lib/mail.js — the emails of sebsanalytics.com, sent with Resend.
//
//   · demoBookedEmail     to the person who booked: the day, the time and a calendar file
//   · demoNoticeEmail     to advisory@sebsanalytics.com: "New demo booked", with a button to /admin
//   · demoCancelledEmail  to the person, when Sebastian cancels a demo in /admin
//   · signInCodeEmail     to advisory@sebsanalytics.com: the 6-digit code for /admin
//
// The same rules as The Hungry Fork's emails: an email never decides whether a booking happened
// (if Resend fails, the booking stands and the reason is written on it), and nothing a visitor
// types is trusted as HTML. Resend is called with fetch, so there is nothing to install.

import { whenWords, TZ, DEMO_MINUTES } from './time.js';

export const SITE = 'https://www.sebsanalytics.com';
export const ADMIN_EMAIL = 'advisory@sebsanalytics.com';
export const FROM = '"Seb\'s Analytics" <demos@send.sebsanalytics.com>';
// Sebastian, 10 Nov: how the demo happens is still to be decided (a call, a video call or a visit).
export const HOW_LINE = 'Before the demo we will contact you to confirm how we meet.';

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 6000;

// Never throws. { ok, id } or { ok: false, status, error } in words.
export async function sendEmail({ to, replyTo, subject, html, text, attachments, idempotencyKey, tags }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, status: 0, error: 'RESEND_API_KEY is not set in Vercel' };
  const payload = { from: FROM, to: [to], subject, html, text };
  if (replyTo) payload.reply_to = replyTo;
  if (attachments && attachments.length) payload.attachments = attachments;
  if (tags && tags.length) payload.tags = tags;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: abort.signal });
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.ok && data && data.id) return { ok: true, id: data.id };
    return { ok: false, status: res.status, error: describeFailure(res.status, data) };
  } catch (err) {
    if (err && err.name === 'AbortError') return { ok: false, status: 0, error: 'Resend did not answer in 6 seconds — it may have been sent' };
    return { ok: false, status: 0, error: 'Could not reach Resend' };
  } finally {
    clearTimeout(timer);
  }
}

function describeFailure(status, data) {
  const said = data && (data.message || data.error || data.name);
  const hint =
    status === 401 ? 'the API key is wrong' :
    status === 403 ? 'send.sebsanalytics.com is not verified in Resend yet, or the key may not send from it' :
    status === 422 ? 'Resend refused the email' :
    status === 429 ? 'too many emails — the free plan allows 100 a day' :
    status >= 500 ? 'Resend is having trouble' : 'unexpected answer';
  return (`Resend ${status}: ${hint}` + (said ? ` (${String(said).slice(0, 160)})` : '')).slice(0, 300);
}

// ── words a visitor typed ─────────────────────────────────────────────────────
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Only a plain address is ever sent to.
export function sendableAddress(value) {
  const text = String(value || '').trim().toLowerCase();
  return text.length <= 120 && /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(text) ? text : null;
}
// The inbox behind an address: v+1@gmail.com and v.ictim@gmail.com land in one inbox.
export function mailboxKey(address) {
  const [local = '', domain = ''] = String(address || '').toLowerCase().split('@');
  let user = local.split('+')[0];
  let host = domain;
  if (host === 'googlemail.com') host = 'gmail.com';
  if (host === 'gmail.com') user = user.replace(/\./g, '');
  return `${user}@${host}`;
}
// The greeting uses the first name only when it looks like a name: a stranger could type
// "https://evil.example" as a name and have us send it to someone else's inbox.
export function greetingName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return /^\p{L}[\p{L}'’-]{0,29}$/u.test(first) ? first : '';
}
// For a subject line: one line, short.
function oneLine(value, max) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// ── the calendar file ─────────────────────────────────────────────────────────
export function demoIcs({ id, startIso }) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + DEMO_MINUTES * 60000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
  const fold = (line) => {
    const out = []; let cur = '';
    for (const ch of line) {
      if (Buffer.byteLength(cur + ch, 'utf8') > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
      cur += ch;
    }
    out.push(cur);
    return out.join('\r\n ');
  };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Seb\'s Analytics//Demos//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:demo-${id}@sebsanalytics.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc('Demo with Seb\'s Analytics')}`,
    `DESCRIPTION:${esc(`${HOW_LINE} To change the time or cancel, reply to the confirmation email or write to ${ADMIN_EMAIL}.`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

// ── the look ──────────────────────────────────────────────────────────────────
// Light, tables and inline styles: what every inbox draws the same way.
const ROYAL = '#001E97', BRIGHT = '#0052FF', INK = '#1E2025', MUTED = '#5A6170', LINE = '#E3E8F2', PAPER = '#F5F8FF';

function layout({ title, preheader, heading, intro, big, bigTime, rows, notice, button, footer }) {
  const e = escapeHtml;
  const rowHtml = (rows || []).map(([label, value]) =>
    `<tr><td style="padding:9px 0;border-top:1px solid ${LINE};font:13px/1.4 Arial,Helvetica,sans-serif;color:${MUTED};width:110px;vertical-align:top;">${e(label)}</td>` +
    `<td style="padding:9px 0;border-top:1px solid ${LINE};font:15px/1.4 Arial,Helvetica,sans-serif;color:${INK};">${value}</td></tr>`).join('');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER};">${e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
  <tr><td style="background:${ROYAL};padding:20px 24px;text-align:center;font:700 22px/1.2 Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.01em;">Seb&#8217;s Analytics</td></tr>
  <tr><td style="padding:26px 24px 8px;">
    <p style="margin:0 0 6px;font:bold 11px/1.4 Arial,Helvetica,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:${BRIGHT};">${e(heading)}</p>
    <p style="margin:0 0 18px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK};">${intro}</p>
    ${big ? `<p style="margin:0;font:700 26px/1.25 Georgia,'Times New Roman',serif;color:${INK};">${e(big)}</p>` : ''}
    ${bigTime ? `<p style="margin:2px 0 16px;font:700 26px/1.25 Georgia,'Times New Roman',serif;color:${ROYAL};">${e(bigTime)}</p>` : ''}
    ${rowHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table>` : ''}
  </td></tr>
  ${notice ? `<tr><td style="padding:10px 24px 4px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${MUTED};">${notice}</td></tr>` : ''}
  ${button ? `<tr><td style="padding:18px 24px 26px;">
    <a href="${e(button.href)}" style="display:inline-block;padding:13px 22px;background:${ROYAL};border-radius:10px;font:bold 14px/1 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;">${e(button.label)}</a>
  </td></tr>` : '<tr><td style="padding:0 0 18px;"></td></tr>'}
</table>
<p style="max-width:520px;margin:14px auto 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED};text-align:center;">${footer}</p>
</td></tr></table>
</body></html>`;
}

const FOOT = `Seb&#8217;s Analytics LLC &middot; New York, NY &middot; sebsanalytics.com`;

// ── 1. to the person who booked ───────────────────────────────────────────────
export function demoBookedEmail({ id, startsAt, name }) {
  const w = whenWords(startsAt);
  const first = greetingName(name);
  const subject = `Your demo with Seb's Analytics: ${w.short} at ${w.time}`;
  const html = layout({
    title: subject,
    preheader: `${w.long} at ${w.time} (New York time)`,
    heading: 'Your demo is booked',
    intro: `${first ? escapeHtml(first) + ', thank' : 'Thank'} you for booking a demo with Seb&#8217;s Analytics. We will show you the whole system and answer your questions.`,
    big: w.long,
    bigTime: `${w.time} (New York time)`,
    notice: `${escapeHtml(HOW_LINE)}<br>Need another time, or can&#8217;t make it? Just reply to this email.<br>The calendar file is attached: open it to add the demo to your calendar.`,
    footer: `${FOOT}<br>Someone used this address to book a demo on sebsanalytics.com. If it wasn&#8217;t you, you can ignore this email.`,
  });
  const text = [
    `${first ? first + ', thank' : 'Thank'} you for booking a demo with Seb's Analytics.`, '',
    `${w.long}, ${w.year} at ${w.time} (New York time)`, '',
    HOW_LINE,
    'Need another time, or can\'t make it? Just reply to this email.', '',
    `Seb's Analytics LLC · New York, NY · ${SITE}`,
  ].join('\n');
  return {
    subject, html, text,
    attachments: [{ filename: 'demo-seb-s-analytics.ics', content: Buffer.from(demoIcs({ id, startIso: startsAt }), 'utf8').toString('base64') }],
  };
}

// ── 2. to Sebastian: someone booked ───────────────────────────────────────────
export function demoNoticeEmail({ startsAt, name, company, email, phone }) {
  const e = escapeHtml;
  const w = whenWords(startsAt);
  const subject = `New demo: ${w.short}, ${w.time} · ${oneLine(company, 60)}`;
  const html = layout({
    title: subject,
    preheader: `${oneLine(name, 60)} · ${oneLine(company, 60)}`,
    heading: 'New demo booked',
    intro: 'Someone booked a demo on sebsanalytics.com.',
    big: w.long,
    bigTime: `${w.time} (New York time)`,
    rows: [['Name', e(name)], ['Company', e(company)], ['Email', e(email)], ['Phone', e(phone)]],
    button: { label: 'Open the admin page', href: `${SITE}/admin` },
    footer: 'Sent by sebsanalytics.com to advisory@sebsanalytics.com.',
  });
  const text = [`New demo booked: ${w.long}, ${w.time} (New York time)`, '',
    `Name: ${oneLine(name, 100)}`, `Company: ${oneLine(company, 120)}`, `Email: ${email}`, `Phone: ${oneLine(phone, 40)}`, '',
    `Admin page: ${SITE}/admin`].join('\n');
  return { subject, html, text };
}

// ── 3. to the person: Sebastian cancelled ─────────────────────────────────────
export function demoCancelledEmail({ startsAt, name, message }) {
  const w = whenWords(startsAt);
  const first = greetingName(name);
  const note = oneLine(message, 500);
  const subject = `Your demo on ${w.short} was cancelled`;
  const html = layout({
    title: subject,
    preheader: `${w.long} at ${w.time}`,
    heading: 'Demo cancelled',
    intro: `${first ? escapeHtml(first) + ', we' : 'We'} are sorry: we had to cancel your demo with Seb&#8217;s Analytics on ${escapeHtml(w.long)} at ${escapeHtml(w.time)} (New York time).`
      + (note ? `<br><br>${escapeHtml(note)}` : ''),
    notice: 'You can pick another time on our website, or reply to this email.',
    button: { label: 'Pick another time', href: `${SITE}/#demo` },
    footer: FOOT,
  });
  const text = [`${first ? first + ', we' : 'We'} are sorry: we had to cancel your demo with Seb's Analytics on ${w.long} at ${w.time} (New York time).`,
    ...(note ? ['', note] : []), '', `Pick another time: ${SITE}/#demo — or reply to this email.`].join('\n');
  return { subject, html, text };
}

// ── 4. the sign-in code ───────────────────────────────────────────────────────
export function signInCodeEmail({ code }) {
  const subject = 'Your sign-in code for sebsanalytics.com/admin';
  const html = layout({
    title: subject,
    preheader: 'It works for 10 minutes.',
    heading: 'Sign-in code',
    intro: 'Type this code on the admin page to sign in:',
    big: code,
    notice: 'It works for 10 minutes, once. If you didn&#8217;t ask for it, someone tried to sign in: without this code they can&#8217;t.',
    footer: 'Sent by sebsanalytics.com to advisory@sebsanalytics.com.',
  });
  const text = `Your sign-in code for sebsanalytics.com/admin: ${code}\n\nIt works for 10 minutes, once. If you didn't ask for it, someone tried to sign in: without this code they can't.`;
  return { subject, html, text };
}

export { TZ };

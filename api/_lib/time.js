// api/_lib/time.js — the demo calendar's rules, always in New York time.
//
// Sebastian, 10 Nov: demos at 9:00 AM, 11:00 AM, 2:00 PM and 4:00 PM. Monday to Friday, from
// the next day up to 4 weeks ahead (his defaults until he says otherwise). Change them here only:
// the page asks the server which days and times are open, so it follows by itself.

export const TZ = 'America/New_York';
export const TIMES = ['09:00', '11:00', '14:00', '16:00'];
export const OPEN_WEEKDAYS = [1, 2, 3, 4, 5];   // 0 = Sunday … 6 = Saturday
export const DAYS_AHEAD = 28;
export const DEMO_MINUTES = 60;                 // only for the calendar file in the email

const pad = (n) => String(n).padStart(2, '0');

// Year, month, day, hour, minute of an instant, as a clock in New York shows it.
function nyParts(date) {
  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)) parts[p.type] = p.value;
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute };
}

export function nyToday(now = new Date()) {
  const p = nyParts(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function isDay(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(text || ''))) return false;
  const [y, m, d] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function weekdayOf(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// New York's distance from UTC at an instant, in minutes (-300 in winter, -240 in summer).
function offsetMinutes(date) {
  const p = nyParts(date);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

// The instant a New York day + time happens ("2026-11-11", "11:00" → 2026-11-11T16:00:00Z).
export function slotInstant(day, hhmm) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  let t = asUtc - offsetMinutes(new Date(asUtc)) * 60000;
  const again = asUtc - offsetMinutes(new Date(t)) * 60000;   // the day the clocks change
  if (again !== t) t = again;
  return new Date(t);
}

export function timeLabel(hhmm) {
  const [h, mi] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`;
}

// The first and last day a demo can be booked today.
export function bookingWindow(now = new Date()) {
  const today = nyToday(now);
  return { today, first: addDays(today, 1), last: addDays(today, DAYS_AHEAD) };
}

export function dayIsBookable(day, now = new Date()) {
  if (!isDay(day)) return false;
  const { first, last } = bookingWindow(now);
  return day >= first && day <= last && OPEN_WEEKDAYS.includes(weekdayOf(day));
}

// Words for an instant, in New York time.
export function whenWords(iso) {
  const d = new Date(iso);
  const f = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts }).format(d);
  const p = nyParts(d);
  return {
    long: f({ weekday: 'long', month: 'long', day: 'numeric' }),     // Wednesday, November 11
    short: f({ weekday: 'short', month: 'short', day: 'numeric' }),   // Wed, Nov 11
    year: String(p.y),
    time: f({ hour: 'numeric', minute: '2-digit', hour12: true }),    // 11:00 AM
    day: `${p.y}-${pad(p.m)}-${pad(p.d)}`,
    slot: `${pad(p.h)}:${pad(p.mi)}`,
  };
}

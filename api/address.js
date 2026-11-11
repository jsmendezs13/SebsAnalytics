// api/address.js — address suggestions while someone types the restaurant's address (Sebastian, 10 Nov 18:48:
// "There are websites that suggest addresses while you fill in the box, can we have the same?").
//
//   GET /api/address?q=77 exam   →   { suggestions: [{ label, value }] }   (up to 5, New York City and around)
//
// The search is Photon (komoot), a free search over OpenStreetMap data: no key and no account. The visitor's browser
// only talks to this website; Photon sees our server, not the visitor. If Photon is slow or down, the answer is an
// empty list and the box simply works as a normal box.

import { send } from './_lib/db.js';

const PHOTON = 'https://photon.komoot.io/api/';
const BBOX = '-74.30,40.45,-73.65,40.95';          // the five boroughs and a little around them
const TIMEOUT_MS = 3000;
const BOROUGHS = { Brooklyn: 'Brooklyn', Queens: 'Queens', Bronx: 'Bronx', 'The Bronx': 'Bronx', 'Staten Island': 'Staten Island' };
const STATES = { 'New York': 'NY', 'New Jersey': 'NJ', Connecticut: 'CT' };

// "77 Example Ave, Brooklyn, NY 11201" — only places with a number and a street, in the United States
export function formatAddress(p) {
  if (!p || !p.housenumber || !p.street) return null;
  if (p.countrycode && String(p.countrycode).toUpperCase() !== 'US') return null;
  const place = BOROUGHS[p.district] || BOROUGHS[p.locality] || BOROUGHS[p.city] || p.city || p.locality || p.district || '';
  const state = STATES[p.state] || p.state || '';
  const line = [`${p.housenumber} ${p.street}`, place, [state, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return /[<>]/.test(line) ? null : line.slice(0, 140);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Not allowed.' }); }
  let q = '';
  try { q = new URL(req.url, 'http://local').searchParams.get('q') || ''; } catch { q = ''; }
  q = q.replace(/\s+/g, ' ').trim();
  if (q.length < 3 || q.length > 100 || /[<>]/.test(q)) return send(res, 200, { suggestions: [] });

  const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=10&lang=en&bbox=${BBOX}&lat=40.70&lon=-73.95`;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let features = null;
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'sebsanalytics.com (advisory@sebsanalytics.com)' }, signal: abort.signal });
    if (r.ok) { const data = await r.json(); features = Array.isArray(data && data.features) ? data.features : null; }
  } catch { features = null; } finally { clearTimeout(timer); }
  if (!features) return send(res, 200, { suggestions: [], unavailable: true });

  const seen = new Set(); const suggestions = [];
  for (const f of features) {
    const p = (f && f.properties) || {};
    const value = formatAddress(p);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    // a restaurant or shop found by its name shows its name first ("Bistro Uno — 77 Example Ave, …")
    const named = p.name && p.osm_key && p.osm_key !== 'place' && p.osm_key !== 'building' && p.name !== p.street ? String(p.name).replace(/[<>]/g, '').slice(0, 60) : '';
    suggestions.push({ label: named ? `${named} — ${value}` : value, value });
    if (suggestions.length >= 5) break;
  }
  // the same typing gives the same list: Vercel may keep it for a day, the browser for 5 minutes
  return send(res, 200, { suggestions }, { 'Cache-Control': 'public, max-age=300, s-maxage=86400' });
}

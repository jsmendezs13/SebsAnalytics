// sebsanalytics.com/admin — Sebastian's demos: sign in with an emailed code, see who booked (with a
// "New" badge), cancel a demo (the person gets an email), close a day or a time.
// Everything goes through POST /api/admin; the sign-in cookie can't be read from here.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var TZ = 'America/New_York';
  var data = null, timer = null;

  function api(action, extra) {
    var body = Object.assign({ action: action }, extra || {});
    return fetch('/api/admin', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && j.signedIn === false) { showSignIn(); }
        return { status: r.status, body: j };
      });
    }, function () { return { status: 0, body: { error: 'No connection. Check your internet and try again.' } }; });
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function nyParts(iso) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
    var p = {}; f.formatToParts(new Date(iso)).forEach(function (x) { p[x.type] = x.value; });
    return { day: p.weekday + ', ' + MONTHS[+p.month - 1] + ' ' + p.day, time: p.hour + ':' + p.minute + ' ' + p.dayPeriod, key: p.year + '-' + p.month + '-' + p.day };
  }
  function dayWords(day) {
    var x = day.split('-').map(Number);
    var wd = new Date(Date.UTC(x[0], x[1] - 1, x[2])).getUTCDay();
    return WEEKDAYS[wd] + ', ' + MONTHS[x[1] - 1] + ' ' + x[2];
  }
  function msg(id, text, good) { var m = $(id); m.textContent = text || ''; m.className = 'msg ' + (good ? 'good' : 'bad'); }

  // ── signing in ──
  function showSignIn() {
    stopPolling();
    $('loading').hidden = true; $('board').hidden = true; $('signin').hidden = false;
    document.title = 'Sign in · Seb’s Analytics admin';
  }
  function sendCode() {
    $('send-code').disabled = true; $('resend').disabled = true;
    msg('signin-msg', '');
    api('send_code').then(function (r) {
      $('send-code').disabled = false; $('resend').disabled = false;
      if (r.status === 200 && r.body.sent) {
        $('step-send').hidden = true; $('step-code').hidden = false;
        $('code').value = ''; $('code').focus();
        msg('signin-msg', 'Code sent. Check your inbox.', true);
      } else msg('signin-msg', r.body.error || 'The code could not be sent.');
    });
  }
  function verify(ev) {
    ev.preventDefault();
    var code = $('code').value.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) { msg('signin-msg', 'The code has 6 numbers.'); $('code').focus(); return; }
    $('verify').disabled = true;
    api('verify', { code: code }).then(function (r) {
      $('verify').disabled = false;
      if (r.status === 200 && r.body.signedIn) { msg('signin-msg', ''); load(); }
      else { msg('signin-msg', r.body.error || 'That didn’t work.'); $('code').select(); }
    });
  }

  // ── the board ──
  function load() {
    return api('list').then(function (r) {
      if (r.status === 401) return;
      $('loading').hidden = true;
      if (r.status !== 200) { $('board').hidden = false; $('signin').hidden = true; msg('board-msg', r.body.error || 'Could not load the demos.'); return; }
      data = r.body;
      $('signin').hidden = true; $('board').hidden = false;
      draw();
      var unseen = data.upcoming.concat(data.past).filter(function (d) { return d.isNew; }).map(function (d) { return d.id; });
      if (unseen.length) api('seen', { ids: unseen });
      startPolling();
    });
  }

  function demoCard(d, past) {
    var w = nyParts(d.startsAt);
    var who = el('div', { class: 'who' }, [
      el('div', null, [el('b', { text: d.name }), ' · ', d.company, ' ', d.isNew ? el('span', { class: 'pill new', text: 'New' }) : null,
        d.status === 'cancelled' ? el('span', { class: 'pill gray', text: 'Cancelled' }) : null]),
      el('div', null, [el('a', { href: 'mailto:' + d.email, text: d.email })]),
      el('div', null, [el('a', { href: 'tel:' + d.phone.replace(/[^0-9+]/g, ''), text: d.phone })]),
    ]);
    if (d.emailError) who.appendChild(el('p', { class: 'warn', text: 'Email to them not sent: ' + d.emailError }));
    else if (!d.emailSent && !past) who.appendChild(el('p', { class: 'warn', text: 'Email to them not sent yet.' }));
    var card = el('div', { class: 'card demo' + (d.isNew ? ' is-new' : ''), 'data-id': String(d.id) }, [
      el('div', { class: 'time', text: past ? w.day.replace(/^\w+, /, '') + ' · ' + w.time : w.time }), who,
    ]);
    if (!past) {
      var cancel = el('button', { type: 'button', class: 'btn red-light', text: 'Cancel demo' });
      card.appendChild(el('div', { class: 'acts' }, [cancel]));
      cancel.addEventListener('click', function () { askCancel(card, d, cancel); });
    }
    return card;
  }

  function askCancel(card, d, button) {
    if (card.querySelector('.confirm')) return;
    button.disabled = true;
    var w = nyParts(d.startsAt);
    var note = el('textarea', { maxlength: '500', 'aria-label': 'A note for them (optional)', placeholder: 'A note for them (optional), for example: "Could we do Thursday instead?"' });
    var yes = el('button', { type: 'button', class: 'btn red', text: 'Cancel it and email ' + d.name.split(' ')[0] });
    var no = el('button', { type: 'button', class: 'btn light', text: 'Keep it' });
    var out = el('p', { class: 'msg', role: 'alert' });
    var box = el('div', { class: 'confirm' }, [
      el('p', { style: 'margin: 0 0 8px; font-weight: 700', text: 'Cancel the demo on ' + w.day + ' at ' + w.time + '? ' + d.name + ' gets an email saying so.' }),
      note, el('div', { class: 'acts', style: 'margin-top: 10px' }, [yes, no]), out,
    ]);
    card.appendChild(box);
    note.focus();
    no.addEventListener('click', function () { box.remove(); button.disabled = false; button.focus(); });
    yes.addEventListener('click', function () {
      yes.disabled = no.disabled = true;
      api('cancel', { id: d.id, message: note.value }).then(function (r) {
        if (r.status === 200) {
          msg('board-msg', r.body.emailSent ? 'Cancelled. ' + d.name + ' got an email.' : 'Cancelled, but the email could not be sent: ' + (r.body.error || '') + ' Please write to them.', r.body.emailSent);
          load();
        } else { yes.disabled = no.disabled = false; out.className = 'msg bad'; out.textContent = r.body.error || 'Could not cancel.'; }
      });
    });
  }

  function draw() {
    var n = data.newCount;
    $('new-count').hidden = !n;
    $('new-count').textContent = n + ' new';
    document.title = (n ? '(' + n + ') ' : '') + 'Demos · Seb’s Analytics admin';

    var up = $('upcoming'); up.textContent = '';
    if (!data.upcoming.length) up.appendChild(el('p', { class: 'empty', text: 'No demos booked yet.' }));
    var lastDay = '';
    data.upcoming.forEach(function (d) {
      var w = nyParts(d.startsAt);
      if (w.key !== lastDay) { up.appendChild(el('p', { class: 'day', text: w.day })); lastDay = w.key; }
      up.appendChild(demoCard(d, false));
    });

    var past = $('past'); past.textContent = '';
    if (!data.past.length) past.appendChild(el('p', { class: 'empty', text: 'Nothing in the last 60 days.' }));
    data.past.forEach(function (d) { past.appendChild(demoCard(d, true)); });

    var sel = $('close-slot');
    if (sel.options.length === 1) data.times.forEach(function (t) { sel.appendChild(el('option', { value: t.slot, text: t.label })); });
    $('close-day').min = data.today;
    var label = {}; data.times.forEach(function (t) { label[t.slot] = t.label; });
    var list = $('closed-list'); list.textContent = '';
    if (!data.closed.length) list.appendChild(el('p', { class: 'empty', text: 'Nothing is closed.' }));
    data.closed.forEach(function (c) {
      var open = el('button', { type: 'button', class: 'btn light', text: 'Open again' });
      open.addEventListener('click', function () {
        open.disabled = true;
        api('open', { day: c.day, slot: c.slot }).then(function (r) { if (r.status === 200) load(); else { open.disabled = false; msg('close-msg', r.body.error || 'Could not open it.'); } });
      });
      list.appendChild(el('div', { class: 'closed-item' }, [
        el('span', null, [el('b', { text: dayWords(c.day) }), ' · ' + (c.slot ? label[c.slot] || c.slot : 'the whole day')]), open,
      ]));
    });
  }

  function closeSomething(ev) {
    ev.preventDefault();
    var day = $('close-day').value;
    if (!day) { msg('close-msg', 'Pick a day.'); $('close-day').focus(); return; }
    api('close', { day: day, slot: $('close-slot').value || null }).then(function (r) {
      if (r.status === 200) { msg('close-msg', 'Closed.', true); load(); } else msg('close-msg', r.body.error || 'Could not close it.');
    });
  }

  // While the page is open and visible, look for new demos every minute.
  function startPolling() { stopPolling(); timer = setInterval(function () { if (!document.hidden) load(); }, 60000); }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }

  function signOut(all) {
    api(all ? 'sign_out_all' : 'sign_out').then(function () { showSignIn(); $('step-send').hidden = false; $('step-code').hidden = true; msg('signin-msg', 'Signed out.', true); });
  }

  function start() {
    $('send-code').addEventListener('click', sendCode);
    $('resend').addEventListener('click', sendCode);
    $('step-code').addEventListener('submit', verify);
    $('refresh').addEventListener('click', function () { msg('board-msg', ''); load(); });
    $('close-form').addEventListener('submit', closeSomething);
    $('sign-out').addEventListener('click', function () { signOut(false); });
    $('sign-out-all').addEventListener('click', function () { signOut(true); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden && data && !$('board').hidden) load(); });
    api('state').then(function (r) {
      if (r.status === 200 && r.body.signedIn) load();
      else if (r.status === 200) showSignIn();
      else { $('loading').textContent = r.body.error || 'Could not reach the server.'; }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

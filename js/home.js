// sebsanalytics.com — the "Request a demo" calendar.
// It asks /api/demo which days and times are still open (New York time), lets the person pick one,
// and books it. A taken time is never shown as open; if two people pick the same time at once,
// the second one is told and the calendar refreshes.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MAIL = 'advisory@sebsanalytics.com';
  var state = { data: null, month: null, day: null, slot: null, busy: false };

  function parts(day) { var p = day.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function weekday(day) { var p = parts(day); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
  function dayWords(day) { var p = parts(day); return WEEKDAYS[weekday(day)] + ', ' + MONTHS[p.m - 1] + ' ' + p.d; }
  function monthOf(day) { return day.slice(0, 7); }
  function addMonths(month, n) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + String(m + 1).padStart(2, '0');
  }
  function label(slot) {
    var t = (state.data.times || []).filter(function (x) { return x.slot === slot; })[0];
    return t ? t.label : slot;
  }
  function openDays() { return Object.keys(state.data.days).sort(); }

  function status(text) { $('cal-status').textContent = text || ''; $('cal-status').hidden = !text; }

  function load(keepChoice) {
    status('Loading the open days…');
    return fetch('/api/demo', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'error'); return j; }); })
      .then(function (data) {
        state.data = data;
        var days = openDays();
        if (!days.length) {
          status('There are no open times in the next 4 weeks. Please write to ' + MAIL + '.');
          state.day = state.slot = null;
          state.month = monthOf(data.first);
          return draw();
        }
        status('');
        if (!keepChoice || !state.day || !data.days[state.day]) { state.day = days[0]; state.slot = null; }
        if (state.slot && data.days[state.day].indexOf(state.slot) < 0) state.slot = null;
        if (!state.slot) state.slot = data.days[state.day][0];
        state.month = monthOf(state.day);
        draw();
      })
      .catch(function () {
        status('The calendar could not load. Please try again in a minute, or write to ' + MAIL + '.');
      });
  }

  function draw() {
    var data = state.data, month = state.month;
    var y = +month.slice(0, 4), m = +month.slice(5, 7);
    $('cal-month').textContent = MONTHS[m - 1] + ' ' + y;
    $('cal-prev').disabled = month <= monthOf(data.first);
    $('cal-next').disabled = month >= monthOf(data.last);

    var grid = $('cal-days');
    grid.textContent = '';
    var first = month + '-01';
    for (var i = 0; i < weekday(first); i++) grid.appendChild(document.createElement('span'));
    var daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (var d = 1; d <= daysInMonth; d++) {
      var day = month + '-' + String(d).padStart(2, '0');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cal-day'; b.textContent = d; b.dataset.day = day;
      var open = Boolean(data.days[day]);
      b.disabled = !open;
      b.setAttribute('aria-pressed', String(open && day === state.day));
      b.setAttribute('aria-label', dayWords(day) + (open ? '' : ', no open times'));
      grid.appendChild(b);
    }

    $('cal-day-words').textContent = state.day ? dayWords(state.day) : 'Pick a day';
    var times = $('cal-times');
    times.textContent = '';
    (data.times || []).forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'cal-time'; b.textContent = t.label; b.dataset.slot = t.slot;
      var free = Boolean(state.day && data.days[state.day] && data.days[state.day].indexOf(t.slot) >= 0);
      b.disabled = !free;
      b.setAttribute('aria-pressed', String(free && t.slot === state.slot));
      if (!free) b.setAttribute('aria-label', t.label + ', not available');
      times.appendChild(b);
    });
    var go = $('demo-go');
    go.disabled = !(state.day && state.slot) || state.busy;
    go.textContent = state.busy ? 'Booking…' : (state.day && state.slot ? 'Request a demo · ' + dayWords(state.day) + ', ' + label(state.slot) : 'Request a demo');
  }

  function pickDay(day) {
    state.day = day;
    var free = state.data.days[day] || [];
    if (free.indexOf(state.slot) < 0) state.slot = free[0] || null;
    draw();
    var pressed = document.querySelector('.cal-day[data-day="' + day + '"]');
    if (pressed) pressed.focus();
  }

  var FIELDS = { name: 'b-name', company: 'b-rest', email: 'b-mail', phone: 'b-phone', address: 'b-addr', address2: 'b-addr2' };
  function mark(bad) {
    Object.keys(FIELDS).forEach(function (k) { $(FIELDS[k]).setAttribute('aria-invalid', String(Boolean(bad && bad[k]))); });
  }
  function checkHere() {
    var v = function (id) { return $(id).value.trim(); };
    var bad = {
      name: !v('b-name'), company: !v('b-rest'),
      email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('b-mail')),
      phone: v('b-phone').replace(/\D/g, '').length < 7,
      address: v('b-addr').length < 5,
      address2: v('b-addr2').length > 60,
    };
    var list = [bad.name && 'your name', bad.company && 'your restaurant or company', bad.email && 'a valid email', bad.phone && 'a phone number', bad.address && 'your restaurant\u2019s address', bad.address2 && 'a valid apartment, suite or floor'].filter(Boolean);
    var listed = list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
    return { bad: bad, words: list.length ? 'Please add ' + listed + '.' : '' };
  }

  function book(ev) {
    ev.preventDefault();
    if (state.busy || !state.day || !state.slot) return;
    var check = checkHere();
    mark(check.bad);
    $('demo-error').textContent = check.words;
    if (check.words) {
      var firstBad = Object.keys(FIELDS).filter(function (k) { return check.bad[k]; })[0];
      $(FIELDS[firstBad]).focus();
      return;
    }
    state.busy = true; draw();
    var email = $('b-mail').value.trim();
    fetch('/api/demo', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        day: state.day, slot: state.slot,
        name: $('b-name').value, company: $('b-rest').value, email: email, phone: $('b-phone').value, address: $('b-addr').value, address2: $('b-addr2').value,
        trap: $('b-trap').value,
      }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (r) {
        state.busy = false;
        if (r.status === 200 && r.body.ok) return done(r.body, email);
        $('demo-error').textContent = r.body.error || 'Something went wrong. Please try again, or write to ' + MAIL + '.';
        if (r.body.fields) mark(r.body.fields);
        if (r.body.code === 'TAKEN' || r.body.code === 'NOT_OPEN') return load(true);
        draw();
      })
      .catch(function () {
        state.busy = false; draw();
        $('demo-error').textContent = 'No connection. Please check your internet and try again.';
      });
  }

  function done(body, email) {
    var when = body.when;
    $('demo-pick').hidden = true;
    $('demo-done').hidden = false;
    $('demo-done-when').textContent = when ? when.long + ' at ' + when.time + ' (New York time)' : '';
    $('demo-done-mail').textContent = body.emailSent
      ? 'We sent the details to ' + email + '. To change the time, just reply to that email.'
      : 'Your demo is booked. If the email doesn’t arrive, write to ' + MAIL + '.';
    // the box got shorter: bring the answer into view, then put the focus on it for screen readers
    $('demo-done').scrollIntoView({ block: 'center' });
    $('demo-done-title').focus({ preventScroll: true });
  }

  function start() {
    if (!$('demo-pick')) return;
    $('cal-days').addEventListener('click', function (e) {
      var b = e.target.closest('.cal-day');
      if (b && !b.disabled) pickDay(b.dataset.day);
    });
    $('cal-times').addEventListener('click', function (e) {
      var b = e.target.closest('.cal-time');
      if (b && !b.disabled) { state.slot = b.dataset.slot; draw(); var again = document.querySelector('.cal-time[data-slot="' + state.slot + '"]'); if (again) again.focus(); }
    });
    $('cal-prev').addEventListener('click', function () { state.month = addMonths(state.month, -1); draw(); });
    $('cal-next').addEventListener('click', function () { state.month = addMonths(state.month, 1); draw(); });
    $('demo-form').addEventListener('submit', book);
    Object.keys(FIELDS).forEach(function (k) {
      $(FIELDS[k]).addEventListener('input', function () { this.setAttribute('aria-invalid', 'false'); });
    });
    load(false);
  }
  // The tap-menu video: plays by itself, muted, in a loop; a button pauses it; with "reduce motion" on it stays still.
  var PAUSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>';
  var PLAY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
  function video() {
    var v = $('tap-video'), b = $('tap-toggle');
    if (!v || !b) return;
    v.muted = true;
    function show(playing) {
      b.innerHTML = playing ? PAUSE : PLAY;
      b.setAttribute('aria-label', playing ? 'Pause the video' : 'Play the video');
      b.setAttribute('aria-pressed', String(!playing));
    }
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduce) { v.removeAttribute('autoplay'); v.pause(); show(false); }
    v.addEventListener('play', function () { show(true); });
    v.addEventListener('pause', function () { show(false); });
    b.addEventListener('click', function () {
      if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () { show(false); }); } else v.pause();
    });
  }
  function startAll() { video(); start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startAll); else startAll();
})();

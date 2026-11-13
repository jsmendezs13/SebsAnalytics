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
  // The address box suggests real addresses while you type (api/address.js, OpenStreetMap data). Arrow keys and Enter
  // pick one, Escape closes the list, and if the service doesn't answer it is simply a normal box.
  function addressSuggestions() {
    var box = $('b-addr'), list = $('addr-list'), note = $('addr-note');
    if (!box || !list) return;
    var items = [], active = -1, timer = 0, ctrl = null, lastQ = '';
    function close() {
      list.hidden = true; list.textContent = ''; items = []; active = -1;
      box.setAttribute('aria-expanded', 'false'); box.removeAttribute('aria-activedescendant');
    }
    function highlight(i) {
      active = i;
      [].forEach.call(list.querySelectorAll('[role="option"]'), function (li, k) { li.setAttribute('aria-selected', String(k === i)); });
      if (i >= 0) { box.setAttribute('aria-activedescendant', 'addr-opt-' + i); var el = $('addr-opt-' + i); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
      else box.removeAttribute('aria-activedescendant');
    }
    function choose(i) {
      var s = items[i]; if (!s) return;
      box.value = s.value; lastQ = s.value; close();
      box.setAttribute('aria-invalid', 'false');
      if (note) note.textContent = '✓ Address found';
      var next = $('b-addr2'); if (next) next.focus();
    }
    function show(list2) {
      items = list2; list.textContent = '';
      if (!items.length) { close(); return; }
      items.forEach(function (s, i) {
        var li = document.createElement('li');
        li.id = 'addr-opt-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false'); li.textContent = s.label;
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
        list.appendChild(li);
      });
      var credit = document.createElement('li');
      credit.className = 'addr-credit'; credit.setAttribute('role', 'presentation'); credit.setAttribute('aria-hidden', 'true');
      credit.textContent = 'Suggestions: © OpenStreetMap contributors';
      list.appendChild(credit);
      list.hidden = false; box.setAttribute('aria-expanded', 'true'); active = -1;
    }
    function ask() {
      var q = box.value.replace(/\s+/g, ' ').trim();
      if (q === lastQ) return;
      lastQ = q;
      if (q.length < 4) { close(); return; }
      if (ctrl) ctrl.abort();
      ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      fetch('/api/address?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.ok ? r.json() : { suggestions: [] }; })
        .then(function (j) { if (box.value.replace(/\s+/g, ' ').trim() === q && document.activeElement === box) show(j.suggestions || []); })
        .catch(function () {});
    }
    box.addEventListener('input', function () {
      if (note) note.textContent = '';
      clearTimeout(timer); timer = setTimeout(ask, 250);
    });
    box.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(items.length - 1, active + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(-1, active - 1)); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    box.addEventListener('blur', function () { setTimeout(close, 150); });
  }
  // The carousel at the top (13 Nov): one phone screen for each thing the system does, on a 3D ring like the food caves
  // (13 Nov 10:42–10:43: "make it continue … infinity", "different sizes like in 3D, no plain"). The screen in front is big;
  // the others get smaller, turn and go further back on each side, and it goes round without end in both directions.
  // Swipe or drag, tap a side screen, the arrows, the dots or the keyboard. It moves on by itself every 4.5 s while it is on
  // screen, waits 5 s after someone uses it, and stops for the Stop button, while the pointer or the keyboard is on it,
  // and always with "reduce motion".
  function carousel() {
    var root = document.getElementById('car'), stage = document.getElementById('car-stage');
    if (!root || !stage) return;
    var items = [].slice.call(stage.querySelectorAll('.car-slide')), dots = [].slice.call(root.querySelectorAll('.car-dot'));
    var N = items.length, cap = document.getElementById('car-cap'), pauseBtn = document.getElementById('car-pause');
    var capT = cap.querySelector('.car-title'), capL = cap.querySelector('.car-line');
    var reduce = false, stopped = false, hovering = false, seen = true, lastUse = 0;
    var pos = 0, target = 0, from = 0, t0 = 0, raf = 0, cur = -1, drag = null;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (!N) return;
    function small() { try { return window.matchMedia('(max-width: 599px)').matches; } catch (e) { return false; } }
    function gap() { return small() ? 112 : 192; }                      // px from the front screen to the next one (they overlap)
    function ring(d) { d = ((d % N) + N) % N; return d > N / 2 ? d - N : d; }   // the shortest way round, signed
    function layout() {
      var S = gap();
      items.forEach(function (el, i) {
        var d = ring(i - pos), a = Math.abs(d), sg = d < 0 ? -1 : 1;
        var x = sg * S * (1 - Math.pow(0.76, a)) / 0.24;                // each next screen a little closer than the last
        // 13 Nov 11:01: one over the other, a little see-through (the front one solid), like the caves
        var op = a <= 2 ? 1 - 0.23 * a : Math.max(0, 0.54 - (a - 2) * 0.75);
        // each screen turned with its own perspective, stacked by z-index (front on top): no screen can cut through another
        // 13 Nov 10:59: turned like the food caves — the outer edge comes forward, so each side screen opens toward the middle;
        // 11:03: "demasiado cerradas … reducir un poco el grado de inclinación" → 16° (was 26°)
        el.style.transform = 'translateX(' + x.toFixed(1) + 'px) perspective(1100px) rotateY(' + (-sg * 16 * Math.min(a, 1)).toFixed(2) + 'deg) scale(' + Math.pow(0.8, a).toFixed(4) + ')';
        el.style.opacity = op.toFixed(3);
        el.style.zIndex = String(200 - Math.round(a * 20));
        el.style.visibility = op < 0.02 ? 'hidden' : 'visible';
      });
      var i = ((Math.round(pos) % N) + N) % N;
      if (i !== cur) mark(i);
    }
    function mark(i) {
      cur = i;
      items.forEach(function (el, k) { el.classList.toggle('on', k === i); });
      dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      capT.textContent = items[i].querySelector('.car-title').textContent;
      capL.textContent = items[i].querySelector('.car-line').textContent;
    }
    function frame(now) {
      var k = Math.min(1, (now - t0) / 650), e = 1 - Math.pow(1 - k, 3);
      pos = from + (target - from) * e; layout();
      if (k < 1) raf = requestAnimationFrame(frame);
      else { raf = 0; pos = target = ((Math.round(target) % N) + N) % N; layout(); }   // keep the numbers small; same picture
    }
    function moveTo(t) {
      target = t;
      if (reduce) { pos = target = ((Math.round(t) % N) + N) % N; layout(); return; }
      from = pos; t0 = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function step(d) { moveTo(Math.round(target) + d); }
    function goTo(i) { moveTo(Math.round(target) + ring(i - Math.round(target))); }
    function used() { lastUse = Date.now(); cap.setAttribute('aria-live', 'polite'); }
    function setStopped(v) {
      stopped = v;
      pauseBtn.setAttribute('aria-label', v ? 'Play the slides' : 'Stop the slides');
      pauseBtn.innerHTML = v
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
    }
    function tick() { if (!stopped && !hovering && seen && !document.hidden && !drag && Date.now() - lastUse > 5000) step(1); }
    root.querySelector('.car-prev').addEventListener('click', function () { used(); step(-1); });
    root.querySelector('.car-next').addEventListener('click', function () { used(); step(1); });
    dots.forEach(function (d, i) { d.addEventListener('click', function () { used(); goTo(i); }); });
    pauseBtn.addEventListener('click', function () { setStopped(!stopped); });
    // swipe or drag the ring; a tap on a side screen brings it to the front
    stage.addEventListener('pointerdown', function (e) {
      if (e.button || e.target.closest('.car-arrow')) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      var hit = e.target.closest('.car-slide');
      drag = { x: e.clientX, p: pos, last: e.clientX, lt: performance.now(), v: 0, moved: false, slide: hit ? items.indexOf(hit) : -1, id: e.pointerId };
      used();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 6) { drag.moved = true; try { stage.setPointerCapture(e.pointerId); } catch (er) {} }
      if (!drag.moved) return;
      var now = performance.now(), dt = Math.max(1, now - drag.lt);
      drag.v = 0.8 * drag.v + 0.2 * (-(e.clientX - drag.last) / gap()) / (dt / 1000);
      drag.last = e.clientX; drag.lt = now;
      pos = target = drag.p - dx / gap(); layout();
    });
    function release(e) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      var d = drag; drag = null; used();
      if (d.moved) moveTo(Math.round(pos + Math.max(-0.6, Math.min(0.6, d.v * 0.15))));   // a quick flick carries on to the next screen
      else if (d.slide >= 0 && d.slide !== cur) goTo(d.slide);
      else moveTo(Math.round(pos));
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); used(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); used(); step(-1); }
    });
    root.addEventListener('mouseenter', function () { hovering = true; });
    root.addEventListener('mouseleave', function () { hovering = false; });
    root.addEventListener('focusin', function () { hovering = true; });
    root.addEventListener('focusout', function () { hovering = false; });
    try { new IntersectionObserver(function (es) { seen = es[0].isIntersecting; }).observe(root); } catch (e) {}
    window.addEventListener('resize', layout);
    setStopped(reduce);
    layout();
    if (!reduce) setInterval(tick, 4500);
  }

  function startAll() { video(); carousel(); addressSuggestions(); start(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startAll); else startAll();
})();

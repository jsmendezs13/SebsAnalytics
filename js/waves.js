/* Research: flowing waves with a heartbeat (Sebastian, 10 Nov 23:18: "que se vea como que fluye, casi con un efecto de
   latidos de corazón sin que uses un corazón … las ondas … con los colores azul oscuro como el que estamos usando").
   Two smooth lines (the site's dark blue and a lighter blue) flow across a row of bars that rise above and below a
   middle line, like prices moving over time. About once a second a double beat ("lub-dub") runs through them from left
   to right: the bars jump and the lines swell, then settle. The pointer lifts the waves under it. The ends fade and
   blur (in site.css). With "reduce motion" on, one still picture is drawn. It starts when it comes into view. */
(function () {
  'use strict';
  var BEAT = 1.15;          // seconds between heartbeats (about 52 a minute: calm)
  var SWEEP = 0.9;          // seconds the beat takes to cross from left to right

  function beatAt(t) {
    // one "lub" and a softer "dub" right after it, every BEAT seconds
    var p = ((t % BEAT) + BEAT) % BEAT;
    function g(d, w) { return Math.exp(-(d * d) / (w * w)); }
    return g(p, 0.07) + 0.6 * g(p - 0.25, 0.08) + g(p - BEAT, 0.07);
  }

  function makeWaves(canvas) {
    var ctx = canvas.getContext('2d');
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    var W = 1, H = 1, dpr = 1, raf = 0, running = true, visible = true, started = false, start = 0;
    var px = -1, pAmt = 0, pTarget = 0;
    var seed = [], N = 0;

    function bars() {
      // about one bar every 11 px of width; each gets its own small, slow wobble
      N = Math.max(22, Math.round(W / dpr / 11));
      seed = [];
      for (var i = 0; i < N; i++) seed.push([Math.sin(i * 12.9898) * 43758.5453 % 1, (i * 2.399) % 6.283]);
    }
    function wave(u, t, a, b, c) {
      // a smooth line: two slow waves added together, drifting sideways at their own speeds
      return a * Math.sin(6.283 * (b * u) - c * t) + (1 - a) * Math.sin(6.283 * (b * 1.73 * u) + 0.55 * c * t + 1.3);
    }
    function lift(u) {
      // the pointer raises the waves under it (and it eases in and out)
      if (pAmt < 0.01) return 0;
      var d = (u - px) / 0.12;
      return pAmt * Math.exp(-d * d);
    }

    function frame(now) {
      var t = reduce ? 2.1 : (now - start) / 1000;
      pAmt += (pTarget - pAmt) * 0.08;
      ctx.clearRect(0, 0, W, H);
      var mid = H * 0.5, step = W / N, bw = Math.max(2, step * 0.52);

      // the bars, above and below the middle line
      for (var i = 0; i < N; i++) {
        var u = (i + 0.5) / N;
        var s = seed[i];
        var v = 0.6 * Math.sin(6.283 * 1.6 * u - 0.8 * t + 0.6)
              + 0.4 * Math.sin(6.283 * 3.7 * u + 1.0 * t)
              + 0.45 * Math.abs(s[0]) * Math.sin(1.4 * t + s[1]);
        var beat = beatAt(t - u * SWEEP);
        var h = v * H * 0.21 * (0.55 + 0.75 * beat) * (1 + 0.8 * lift(u));
        if (Math.abs(h) < 2 * dpr) h = h < 0 ? -2 * dpr : 2 * dpr;
        var a = 0.5 + 0.4 * Math.min(1, Math.abs(v)) + 0.1 * beat;
        ctx.fillStyle = 'rgba(28,92,236,' + Math.min(0.95, a).toFixed(3) + ')';
        var x = i * step + (step - bw) / 2;
        if (h > 0) ctx.fillRect(x, mid - h, bw, h); else ctx.fillRect(x, mid, bw, -h);
      }

      // the two lines: the light one behind, the site's dark blue in front
      function line(color, width, a, b, c, size, shift) {
        ctx.beginPath();
        var steps = Math.max(80, Math.round(W / (3 * dpr)));
        for (var k = 0; k <= steps; k++) {
          var u = k / steps;
          var beat = beatAt(t - u * SWEEP - shift);
          var amp = H * size * (0.55 + 0.45 * Math.sin(Math.PI * u)) * (0.8 + 0.32 * beat) * (1 + 0.5 * lift(u));
          var y = mid + amp * wave(u, t, a, b, c);
          if (k === 0) ctx.moveTo(u * W, y); else ctx.lineTo(u * W, y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.stroke();
      }
      line('#6E96FF', 2.6, 0.66, 2.05, 1.15, 0.37, 0.08);
      line('#001E97', 3.2, 0.6, 1.7, 0.85, 0.34, 0);
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(rect.width * dpr)); H = Math.max(1, Math.round(rect.height * dpr));
      canvas.width = W; canvas.height = H; bars();
      if (reduce) frame(performance.now());
    }
    function loop(now) {
      if (!running) return;
      if (visible) {
        if (!started) { started = true; start = now; }    // it starts when it comes into view
        frame(now);
      }
      raf = requestAnimationFrame(loop);
    }
    var ro = null, io = null;
    try { ro = new ResizeObserver(resize); ro.observe(canvas); } catch (e) { window.addEventListener('resize', resize); }
    try { visible = false; io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; }); io.observe(canvas); } catch (e) { visible = true; }
    function move(e) { var rect = canvas.getBoundingClientRect(); px = (e.clientX - rect.left) / Math.max(1, rect.width); pTarget = 1; }
    function leave() { pTarget = 0; }
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
    resize();
    if (reduce) frame(performance.now()); else raf = requestAnimationFrame(loop);
    return {
      stop: function () {
        running = false; cancelAnimationFrame(raf);
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        if (io) io.disconnect();
        canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave);
      }
    };
  }

  function start() { var c = document.getElementById('waves'); if (c && c.getContext) makeWaves(c); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();

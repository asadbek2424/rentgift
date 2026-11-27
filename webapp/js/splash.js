// RentaGift intro (from rentagift_splash): the shield halves fly in and slam, the crown drops on top,
// then the logo rises and shrinks, the name fades in and the chest rises from the bottom.
// When it finishes it sets window.__splashDone and fires `splash:done`; app.js then fades the splash out.
// Sound: splash_sfx.mp3 is one track timed to the same timeline. Browsers/WebViews may block sound until the
// user taps — then the animation simply plays silently (it never waits for sound).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('sp2-screen'), stage = $('sp2-stage'), logo = $('sp2-logo'), glow = $('sp2-glow'), ring = $('sp2-ring');
  var pL = $('sp2-L'), pR = $('sp2-R'), pC = $('sp2-C'), name = $('sp2-name'), chest = $('sp2-chest');
  if (!screen || !logo.animate) { finish(); return; }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var SIDE_IN = 350, SIDE_HIT = 800;       // halves slam
  var CROWN_IN = 1000, CROWN_HIT = 1420;   // crown drops
  var MOVE = 1850, MOVE_DUR = 650;         // logo goes up + shrinks
  var FINAL_W = 56;                        // px: final logo width
  var EASE_IN = 'cubic-bezier(.55,0,1,.45)', EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';

  // ---- sound
  var SFX = '/static/img/splash/splash_sfx.mp3?v=1';
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = null, sfx = null, src = null;
  try { actx = AC ? new AC() : null; } catch (e) { actx = null; }
  var loadSfx = actx && window.fetch ? fetch(SFX).then(function (r) { return r.arrayBuffer(); })
    .then(function (b) { return new Promise(function (ok, no) { actx.decodeAudioData(b, ok, no); }); })
    .then(function (buf) { sfx = buf; }).catch(function () {}) : Promise.resolve();
  var unlock = function () { if (actx && actx.state !== 'running') actx.resume().catch(function () {}); };
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (e) { addEventListener(e, unlock, { once: true, passive: true }); });

  function playSound() {
    if (reduce) return;
    if (actx && sfx && actx.state === 'running') {
      try { src = actx.createBufferSource(); src.buffer = sfx; src.connect(actx.destination); src.start(actx.currentTime + 0.02); return; }
      catch (e) { /* fall back to <audio> */ }
    }
    try {   // some WebViews allow <audio> autoplay while the AudioContext is still suspended
      var el = new Audio(SFX); el.volume = 1;
      var p = el.play(); if (p && p.catch) p.catch(function () {});
    } catch (e) { /* no sound */ }
  }
  function stopSound() { try { if (src) src.stop(); } catch (e) {} }

  function A(el, kf, opt) { var o = { fill: 'both' }; for (var k in opt) o[k] = opt[k]; return el.animate(kf, o); }

  function impact(at, power) {
    A(stage, [
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(' + (-7 * power) + 'px,' + (4 * power) + 'px) scale(' + (1 + .02 * power) + ')', offset: .12 },
      { transform: 'translate(' + (6 * power) + 'px,' + (-5 * power) + 'px) scale(1)', offset: .3 },
      { transform: 'translate(' + (-3 * power) + 'px,' + (2 * power) + 'px)', offset: .55 },
      { transform: 'translate(0,0)' }
    ], { duration: 380, delay: at, fill: 'none' });
    A(glow, [{ opacity: 0 }, { opacity: .9 * power }, { opacity: 0 }], { duration: 650, delay: at, easing: 'ease-out', fill: 'none' });
    A(ring, [{ opacity: .9, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.6)' }],
      { duration: 600, delay: at, easing: 'ease-out', fill: 'none' });
    A(logo, [{ filter: 'brightness(1.7) drop-shadow(0 0 18px #38d6ff)' }, { filter: 'brightness(1) drop-shadow(0 0 0 transparent)' }],
      { duration: 500, delay: at, easing: 'ease-out', fill: 'none' });
  }

  function play() {
    playSound();
    var sr = screen.getBoundingClientRect(), lr = logo.getBoundingClientRect();
    var top = 44 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tg-top')) || 0);
    var scale = FINAL_W / lr.width;
    var dy = top + (lr.height * scale) / 2 - (lr.top - sr.top + lr.height / 2);
    name.style.top = (top + lr.height * scale + 12) + 'px';

    if (reduce) {
      [pL, pR, pC, name, chest].forEach(function (p) { A(p, [{ opacity: 1 }], { duration: 1 }); });
      A(logo, [{ transform: 'translate(-50%,calc(-50% + ' + dy + 'px)) scale(' + scale + ')' }], { duration: 1 });
      setTimeout(finish, 300); return;
    }
    var W = sr.width;
    A(pL, [{ opacity: 1, transform: 'translateX(' + (-W) + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: SIDE_HIT - SIDE_IN, delay: SIDE_IN, easing: EASE_IN });
    A(pR, [{ opacity: 1, transform: 'translateX(' + W + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: SIDE_HIT - SIDE_IN, delay: SIDE_IN, easing: EASE_IN });
    try {   // tiny recoil after the hit (composite: 'add' is missing in some old WebViews)
      A(pL, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 220, delay: SIDE_HIT, easing: 'ease-out', composite: 'add', fill: 'none' });
      A(pR, [{ transform: 'translateX(0)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220, delay: SIDE_HIT, easing: 'ease-out', composite: 'add', fill: 'none' });
    } catch (e) { /* skip recoil */ }
    impact(SIDE_HIT, 1);

    var fall = lr.top - sr.top + lr.height;
    pC.style.transformOrigin = '50% 100%';
    A(pC, [
      { opacity: 1, transform: 'translateY(' + (-fall) + 'px) scaleY(1.08)', easing: EASE_IN },
      { opacity: 1, transform: 'translateY(0) scaleY(1)', offset: .78, easing: 'ease-out' },
      { opacity: 1, transform: 'translateY(0) scaleY(.9)', offset: .84, easing: 'ease-out' },
      { opacity: 1, transform: 'translateY(-10px) scaleY(1.02)', offset: .92, easing: 'ease-in' },
      { opacity: 1, transform: 'translateY(0) scaleY(1)' }
    ], { duration: (CROWN_HIT - CROWN_IN) / .78, delay: CROWN_IN });
    impact(CROWN_HIT, 1.3);

    A(logo, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,calc(-50% + ' + dy + 'px)) scale(' + scale + ')' }],
      { duration: MOVE_DUR, delay: MOVE, easing: EASE_OUT });
    A(name, [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }],
      { duration: 520, delay: MOVE + MOVE_DUR - 220, easing: EASE_OUT });
    var c = A(chest, [{ opacity: 0, transform: 'translate(-50%,60px) scale(.94)' }, { opacity: 1, transform: 'translate(-50%,0) scale(1)' }],
      { duration: 700, delay: MOVE + MOVE_DUR, easing: EASE_OUT });
    c.finished.then(function () { setTimeout(finish, 450); }, finish);   // let the chest sit for a moment
  }

  function finish() {
    if (window.__splashDone) return;
    window.__splashDone = true;
    window.dispatchEvent(new Event('splash:done'));
  }

  var started = false;
  var start = function () { if (started) return; started = true; requestAnimationFrame(play); };
  // resume() may stay pending without a tap, so it gets only a short moment
  var resumed = actx && actx.state !== 'running'
    ? Promise.race([actx.resume().catch(function () {}), new Promise(function (r) { setTimeout(r, 150); })]) : null;
  var images = Promise.all([pL, pR, pC].map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; }));
  // wait for the sound at most 900 ms — the intro must never be held back by it
  Promise.all([images, resumed, Promise.race([loadSfx, new Promise(function (r) { setTimeout(r, 900); })])])
    .then(function () { return document.fonts ? document.fonts.ready : null; }).then(start, start);
  window.addEventListener('splash:done', function () { setTimeout(stopSound, 1500); });
  setTimeout(finish, 6000);   // safety: never hold the app longer than this
})();

// RentaGift intro (from rentagift_splash, v3): the shield halves slam, the crown drops, the logo rises and the
// name appears; then a rock with a loot chest rises, the chest bursts open with light, gifts fly out one by one
// and a cat leaps in. splash_sfx.mp3 follows the same timeline.
// When it finishes it sets window.__splashDone and fires `splash:done`; app.js then fades the splash out.
// Sound may be blocked by the browser until the user taps — then the intro simply plays silently.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var screen = $('sp2-screen'), stage = $('sp2-stage'), logo = $('sp2-logo'), glow = $('sp2-glow'), ring = $('sp2-ring');
  var pL = $('sp2-L'), pR = $('sp2-R'), pC = $('sp2-C'), name = $('sp2-name'), scene = $('sp2-scene'), rays = $('sp2-rays');
  if (!screen || !scene || !logo.animate) { finish(); return; }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var IMG = '/static/img/splash/';

  // ---------- timeline (ms) ----------
  var SIDE_IN = 350, SIDE_HIT = 800;
  var CROWN_IN = 1000, CROWN_HIT = 1420;
  var MOVE = 1850, MOVE_DUR = 650;
  var FINAL_W = 56;
  var SCENE_IN = 2400, SCENE_LAND = 2950;
  var BURST = 3050;
  var GIFT_START = 3150, GIFT_GAP = 130, GIFT_FLIGHT = 800, GIFT_LAND_AT = .82;
  var CAT_IN = 4700, CAT_FLIGHT = 620;
  var GIFT_ORDER = ['bag', 'perfume', 'cap', 'heart', 'toy', 'crystals', 'gem'];

  // scene layout in units (1000 x 1100): centre x, bottom y, width, rotation, aspect h/w
  var ITEMS = [
    { n: 'rock', cx: 500, b: 1100, w: 860, r: 0, ar: 0.5727 },
    { n: 'chest', cx: 405, b: 775, w: 600, r: 0, ar: 0.9709 },
    { n: 'bag', cx: 442, b: 482, w: 262, r: 3, ar: 0.9827 },
    { n: 'perfume', cx: 325, b: 489, w: 131, r: -7, ar: 1.4313 },
    { n: 'heart', cx: 475, b: 528, w: 141, r: 6, ar: 1.0167 },
    { n: 'chest_front', cx: 405, b: 775, w: 600, r: 0, ar: 0.9709 },
    { n: 'cap', cx: 269, b: 562, w: 295, r: -8, ar: 0.6064 },
    { n: 'toy', cx: 663, b: 543, w: 211, r: 6, ar: 1.1365 },
    { n: 'crystals', cx: 235, b: 838, w: 250, r: 0, ar: 0.4577 },
    { n: 'gem', cx: 110, b: 800, w: 125, r: -14, ar: 1.0784 },
    { n: 'cat', cx: 800, b: 712, w: 225, r: 0, ar: 1.2152 }
  ];
  var MOUTH = { x: 424, y: 475 };
  var SW = 1000, SH = 1100;
  var byName = function (n) { for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].n === n) return ITEMS[i]; };

  var el = {}, sceneImgs = [];
  ITEMS.forEach(function (it) {
    var d = document.createElement('div');
    d.className = 'sp2-it';
    d.style.left = ((it.cx - it.w / 2) / SW * 100) + '%';
    d.style.width = (it.w / SW * 100) + '%';
    d.style.bottom = ((SH - it.b) / SH * 100) + '%';
    var img = document.createElement('img');
    img.src = IMG + it.n + '.webp?v=3'; img.alt = '';
    if (it.r) img.style.transform = 'rotate(' + it.r + 'deg)';
    d.appendChild(img); scene.appendChild(d);
    el[it.n] = d; it.el = d; sceneImgs.push(img);
  });
  var burst = document.createElement('div'); burst.className = 'sp2-burst';
  scene.insertBefore(burst, el.bag);
  var inner = document.createElement('div'); inner.className = 'sp2-inner';
  scene.insertBefore(inner, burst);
  var sparks = [];
  for (var i = 0; i < 14; i++) { var sp = document.createElement('div'); sp.className = 'sp2-spark'; scene.appendChild(sp); sparks.push(sp); }

  // ---------- sound ----------
  var SFX = IMG + 'splash_sfx.mp3?v=3';
  var AC = window.AudioContext || window.webkitAudioContext;
  var actx = null, sfx = null, src = null, audioEl = null;
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
      audioEl = new Audio(SFX);
      var p = audioEl.play(); if (p && p.catch) p.catch(function () {});
    } catch (e) { /* no sound */ }
  }
  function stopSound() {
    try { if (src) src.stop(); } catch (e) {}
    try { if (audioEl) audioEl.pause(); } catch (e) {}
  }

  // ---------- helpers ----------
  var EASE_IN = 'cubic-bezier(.55,0,1,.45)', EASE_OUT = 'cubic-bezier(.2,.8,.2,1)';
  function A(node, kf, opt) { var o = { fill: 'both' }; for (var k in opt) o[k] = opt[k]; return node.animate(kf, o); }
  function shake(at, power, dur) {
    A(stage, [
      { transform: 'translate(0,0)' },
      { transform: 'translate(' + (-7 * power) + 'px,' + (4 * power) + 'px)', offset: .12 },
      { transform: 'translate(' + (6 * power) + 'px,' + (-5 * power) + 'px)', offset: .3 },
      { transform: 'translate(' + (-3 * power) + 'px,' + (2 * power) + 'px)', offset: .55 },
      { transform: 'translate(0,0)' }
    ], { duration: dur || 380, delay: at, fill: 'none' });
  }
  function impact(at, power) {
    shake(at, power);
    A(glow, [{ opacity: 0 }, { opacity: .9 * power }, { opacity: 0 }], { duration: 650, delay: at, easing: 'ease-out', fill: 'none' });
    A(ring, [{ opacity: .9, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.6)' }],
      { duration: 600, delay: at, easing: 'ease-out', fill: 'none' });
    A(logo, [{ filter: 'brightness(1.7) drop-shadow(0 0 18px #38d6ff)' }, { filter: 'brightness(1) drop-shadow(0 0 0 transparent)' }],
      { duration: 500, delay: at, easing: 'ease-out', fill: 'none' });
  }
  // one gift: out of the chest mouth, up to an apex, down into place with a squash
  function flyGift(it, at, k, idx) {
    var h = it.w * it.ar;
    var fx = it.cx, fy = it.b - h / 2;
    var sx = (MOUTH.x - fx) * k, sy = (MOUTH.y + 40 - fy) * k;
    var ax = (MOUTH.x + (fx - MOUTH.x) * .55 - fx) * k;
    var apexY = Math.min(MOUTH.y - 260 - (idx % 3) * 55, fy - 170);
    var ay = (apexY - fy) * k;
    var spin = (fx < MOUTH.x ? -1 : 1) * 360;
    A(it.el, [
      { opacity: 0, transform: 'translate(' + sx + 'px,' + sy + 'px) scale(.25) rotate(0deg)', easing: 'cubic-bezier(.15,.7,.35,1)' },
      { opacity: 1, transform: 'translate(' + (sx + ax) / 2 + 'px,' + ((sy + ay) / 2 - 20 * k) + 'px) scale(.8) rotate(' + spin * .45 + 'deg)', offset: .2, easing: 'cubic-bezier(.2,.6,.4,1)' },
      { opacity: 1, transform: 'translate(' + ax + 'px,' + ay + 'px) scale(1.12) rotate(' + spin * .8 + 'deg)', offset: .45, easing: EASE_IN },
      { opacity: 1, transform: 'translate(0,0) scale(1) rotate(' + spin + 'deg)', offset: GIFT_LAND_AT, easing: 'ease-out' },
      { opacity: 1, transform: 'translate(0,0) scale(1.1,.88) rotate(' + spin + 'deg)', offset: .9, easing: 'ease-in-out' },
      { opacity: 1, transform: 'translate(0,0) scale(1,1) rotate(' + spin + 'deg)' }
    ], { duration: GIFT_FLIGHT, delay: at });
  }

  function play() {
    playSound();
    var sr = screen.getBoundingClientRect(), lr = logo.getBoundingClientRect();
    var top = 44 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tg-top')) || 0);
    var scale = FINAL_W / lr.width;
    var dy = top + (lr.height * scale) / 2 - (lr.top - sr.top + lr.height / 2);
    name.style.top = (top + lr.height * scale + 12) + 'px';
    var k = scene.clientWidth / SW;

    if (reduce) {
      [pL, pR, pC, name].concat(ITEMS.map(function (x) { return x.el; })).forEach(function (n) { A(n, [{ opacity: 1 }], { duration: 1 }); });
      A(logo, [{ transform: 'translate(-50%,calc(-50% + ' + dy + 'px)) scale(' + scale + ')' }], { duration: 1 });
      setTimeout(finish, 600); return;
    }

    // 1. halves slam
    var W = sr.width;
    A(pL, [{ opacity: 1, transform: 'translateX(' + (-W) + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: SIDE_HIT - SIDE_IN, delay: SIDE_IN, easing: EASE_IN });
    A(pR, [{ opacity: 1, transform: 'translateX(' + W + 'px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: SIDE_HIT - SIDE_IN, delay: SIDE_IN, easing: EASE_IN });
    try {   // tiny recoil (composite: 'add' is missing in some old WebViews)
      A(pL, [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 220, delay: SIDE_HIT, easing: 'ease-out', composite: 'add', fill: 'none' });
      A(pR, [{ transform: 'translateX(0)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220, delay: SIDE_HIT, easing: 'ease-out', composite: 'add', fill: 'none' });
    } catch (e) { /* skip recoil */ }
    impact(SIDE_HIT, 1);

    // 2. crown drops
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

    // 3. logo up + name
    A(logo, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,calc(-50% + ' + dy + 'px)) scale(' + scale + ')' }],
      { duration: MOVE_DUR, delay: MOVE, easing: EASE_OUT });
    A(name, [{ opacity: 0, transform: 'translateY(14px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }],
      { duration: 520, delay: MOVE + MOVE_DUR - 220, easing: EASE_OUT });

    // 4. rock + chest rise and land
    var rise = (SH * .55) * k;
    ['rock', 'chest', 'chest_front'].forEach(function (n) {
      A(el[n], [
        { opacity: 0, transform: 'translateY(' + rise + 'px)' },
        { opacity: 1, transform: 'translateY(0)', offset: .85, easing: 'ease-out' },
        { opacity: 1, transform: 'translateY(' + (-8 * k) + 'px)', offset: .93 },
        { opacity: 1, transform: 'translateY(0)' }
      ], { duration: SCENE_LAND - SCENE_IN + 150, delay: SCENE_IN, easing: EASE_OUT });
    });
    shake(SCENE_LAND, .6, 300);
    A(el.chest, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.35) drop-shadow(0 0 22px rgba(190,140,255,.8))', offset: .25 }, { filter: 'brightness(1)' }],
      { duration: 900, delay: BURST, fill: 'none' });
    A(burst, [{ opacity: 0, transform: 'translate(-50%,-50%) scale(.3)' }, { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: .25 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.4)' }],
      { duration: 1100, delay: BURST, easing: 'ease-out' });
    A(rays, [{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg)' }, { opacity: .9, transform: 'translate(-50%,-50%) rotate(40deg)', offset: .3 }, { opacity: .55, transform: 'translate(-50%,-50%) rotate(140deg)' }],
      { duration: 3200, delay: BURST, easing: 'linear' });
    sparks.forEach(function (s, i) {
      var ang = (i / sparks.length) * Math.PI * 2 + i, dist = (180 + (i * 53) % 220) * k;
      s.style.left = (MOUTH.x / SW * 100) + '%'; s.style.top = ((MOUTH.y - 20) / SH * 100) + '%';
      A(s, [
        { opacity: 1, transform: 'translate(0,0) scale(1)' },
        { opacity: 0, transform: 'translate(' + Math.cos(ang) * dist + 'px,' + (Math.sin(ang) * dist * .8 - 60 * k) + 'px) scale(.3)' }
      ], { duration: 700 + (i % 4) * 120, delay: BURST + (i % 5) * 40, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' });
    });
    A(inner, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.05)', offset: .5 }, { opacity: .9, transform: 'scale(1)' }],
      { duration: 700, delay: BURST - 60, easing: EASE_OUT });

    // 5. gifts pop out one by one
    GIFT_ORDER.forEach(function (n, i) { flyGift(byName(n), GIFT_START + i * GIFT_GAP, k, i); });

    // 6. cat leaps in from the right and lands next to the chest
    var cat = byName('cat');
    cat.el.style.transformOrigin = '50% 100%';
    var cx0 = (SW + 220 - cat.cx) * k;
    var last = A(cat.el, [
      { opacity: 1, transform: 'translate(' + cx0 + 'px,' + (-40 * k) + 'px) rotate(12deg) scale(1)', easing: 'cubic-bezier(.2,.7,.4,1)' },
      { opacity: 1, transform: 'translate(' + cx0 * .45 + 'px,' + (-230 * k) + 'px) rotate(-6deg) scale(1.04)', offset: .45, easing: EASE_IN },
      { opacity: 1, transform: 'translate(0,0) rotate(0deg) scale(1.08,.86)', offset: .8, easing: 'ease-out' },
      { opacity: 1, transform: 'translate(0,' + (-12 * k) + 'px) scale(.97,1.05)', offset: .9, easing: 'ease-in' },
      { opacity: 1, transform: 'translate(0,0) scale(1)' }
    ], { duration: CAT_FLIGHT, delay: CAT_IN });
    last.finished.then(function () { setTimeout(finish, 600); }, finish);   // let the scene sit for a moment
  }

  function finish() {
    if (window.__splashDone) return;
    window.__splashDone = true;
    window.dispatchEvent(new Event('splash:done'));
  }
  window.addEventListener('splash:done', function () { setTimeout(stopSound, 1200); });

  var started = false;
  var start = function () { if (started) return; started = true; requestAnimationFrame(play); };
  var resumed = actx && actx.state !== 'running'
    ? Promise.race([actx.resume().catch(function () {}), new Promise(function (r) { setTimeout(r, 150); })]) : null;
  var decode = function (i) { return i.decode ? i.decode().catch(function () {}) : null; };
  var images = Promise.race([Promise.all([pL, pR, pC].concat(sceneImgs).map(decode)), new Promise(function (r) { setTimeout(r, 1500); })]);
  // the intro must never be held back by sound or slow images for long
  Promise.all([images, resumed, Promise.race([loadSfx, new Promise(function (r) { setTimeout(r, 900); })])])
    .then(function () { return document.fonts ? document.fonts.ready : null; }).then(start, start);
  setTimeout(finish, 9000);   // safety: never hold the app longer than this
})();

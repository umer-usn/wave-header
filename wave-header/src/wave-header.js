/*!
 * wave-header — an interactive dotted-wave WebGL header.
 *
 *   WaveHeader.init(element, options?)  ->  { destroy() }
 *
 * Contains 3D simplex noise from webgl-noise:
 *   Copyright (C) 2011 Ashima Arts. All rights reserved.
 *   Author: Ian McEwan, Ashima Arts. Distributed under the MIT License.
 *   https://github.com/ashima/webgl-noise
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
     Defaults — every key can be overridden via WaveHeader.init(el, {...})
  ------------------------------------------------------------------ */
  var DEFAULTS = {
    spacing: 6.5,         // CSS px between dots (screen space)
    stagger: 0.5,         // shift every other row sideways by this fraction of a dot spacing (0 = straight columns)
    staggerY: 0.5,        // shift every other column up/down by this fraction of a row spacing (0 = straight rows)
    jitter: 0.25,         // random sideways offset per dot, as a fraction of the spacing (0 = perfect lattice)
    jitterY: 0.15,        // random up/down offset per dot, as a fraction of the row spacing
    scatter: 1.0,         // how much dots break up / jitter toward the wave's edges
    zFar: 95,             // far end of the surface
    cameraHeight: 8,
    horizon: 0.18,        // horizon line as a fraction of the canvas height
    nearEdge: 0.95,       // where the nearest row sits (fraction of canvas height)
    focal: 0.62,          // focal length as a fraction of the canvas width

    // terrain
    speed: 0.375,         // how fast the surface morphs
    drift: 1.0,           // world units / second the terrain rolls toward the viewer
    swell: 0.55,          // travelling rolling-wave motion on top (0 = off)
    swellSpeed: 0.55,     // how fast those swells travel
    height: 7.0,          // overall wave height
    scale: 0.032,         // base noise frequency (smaller = broader hills)

    // cursor interaction (3D: sized in world space, so distant dots react smaller)
    radius: 70,           // CSS px reach of the cursor at mid-depth
    lift: 0.036,          // peak rise at mid-depth, as a fraction of canvas width
    trailLife: 0.42,      // seconds a cursor sample keeps influencing dots
    trailStep: 0.025,     // seconds between trail samples

    // colour ramp (RGB 0–1), dark/far -> bright/near
    ramp: [
      [0.50, 0.10, 0.00],
      [0.90, 0.22, 0.00],
      [1.00, 0.36, 0.00],
      [1.00, 0.47, 0.05],
    ],
  };

  var TRAIL = 20;         // cursor trail samples (baked into the shader)

  /* ------------------------------------------------------------------
     Shaders
  ------------------------------------------------------------------ */
  var VERT = `
    precision highp float;
    #define TRAIL ${TRAIL}
    attribute vec2 aGrid;                 // world x, z
    uniform float uTime, uNow, uDpr, uFocal, uHorizon, uCamH, uZNear, uZFar, uZRef;
    uniform float uRadius, uLift, uLife, uHeight, uScale, uDrift, uSwell, uSwellSpeed, uSpacing, uScatter;
    uniform vec2  uRes, uSeed;            // device px / random per-load offset
    uniform vec3  uTrail[TRAIL];          // x, y (device px), timestamp
    uniform vec3  uRamp[4];
    varying float vAlpha;
    varying vec3  vColor;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // --- 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) ---
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i  = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
              + i.y + vec4(0.0, i1.y, i2.y, 1.0))
              + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy;
      vec4 y = y_ * ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0) * 2.0 + 1.0;
      vec4 s1 = floor(b1) * 2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }

    // Irregular terrain: domain-warped fractal noise, with a slow "mood" mask so
    // some regions get tall, sharp crests and others stay calm. It rolls toward
    // the viewer (drift) while it slowly morphs (time axis of the noise).
    float height(vec2 p, float t) {
      vec2 q = p + uSeed;
      q.y += uNow * uDrift;
      vec2 w = vec2(snoise(vec3(q * 0.04, t * 0.10)),
                    snoise(vec3(q * 0.04 + 17.0, t * 0.10)));
      q += w * 5.0;

      float n = 0.0, a = 1.0, f = uScale;
      for (int i = 0; i < 4; i++) {
        n += a * snoise(vec3(q * f, t * 0.16 + float(i) * 3.1));
        a *= 0.42;
        f *= 2.1;
      }
      n *= 0.85;

      float mood = 0.5 + 0.5 * snoise(vec3(q * 0.016 + 40.0, t * 0.05));
      float amp = 0.30 + 1.6 * mood * mood;

      // asymmetric: pointier crests, broader troughs
      float c = n > 0.0 ? n * (1.0 + 0.9 * n) : n * 0.75;
      // broad swells rolling toward the viewer keep the whole surface visibly alive
      float swell = uSwell * sin(p.y * 0.13 - uNow * uSwellSpeed + p.x * 0.035 + 2.0 * w.x) * (0.4 + 0.6 * mood);
      return (c * amp + swell) * uHeight * (0.30 + 0.020 * p.y);
    }

    vec2 project(vec3 w) {
      float s = uFocal / w.z;
      return vec2(uRes.x * 0.5 + w.x * s,
                  uRes.y * uHorizon + (uCamH - w.y) * s);
    }

    vec3 ramp(float t) {
      t = clamp(t, 0.0, 1.0);
      if (t < 0.40) return mix(uRamp[0], uRamp[1], t / 0.40);
      if (t < 0.75) return mix(uRamp[1], uRamp[2], (t - 0.40) / 0.35);
      return mix(uRamp[2], uRamp[3], (t - 0.75) / 0.25);
    }

    void main() {
      float x = aGrid.x, z = aGrid.y;
      float h = height(aGrid, uTime);

      // slope (forward difference) -> highlights on faces that catch the light
      float e = 0.4;
      float dx = height(aGrid + vec2(e, 0.0), uTime) - h;
      float dz = height(aGrid + vec2(0.0, e), uTime) - h;
      float localAmp = 0.30 + 0.020 * z;
      float slope = length(vec2(dx, dz)) / e / localAmp;

      // where this dot appears on screen *before* the cursor touches it
      vec2 base = project(vec3(x, h, z));

      // --- cursor, treated as a point in 3D --------------------------------
      // A bump has a fixed size in the world, so its footprint on screen
      // shrinks with distance (cursor near the top = far away = small & subtle,
      // cursor near the bottom = close to the viewer = wide & tall).
      float nearK = uZRef / z;
      float radius = max(uRadius * pow(nearK, 0.85), uDpr * 38.0);
      float liftPx = uLift * uRes.x * pow(nearK, 0.6);

      float jitter = hash(aGrid);                      // staggers fade-out per dot
      float life = uLife * (0.7 + 0.6 * jitter);
      float lift = 0.0;
      for (int i = 0; i < TRAIL; i++) {
        vec3 tr = uTrail[i];
        float age = uNow - tr.z;
        if (age < 0.0 || age > life) continue;
        vec2 d = (base - tr.xy) / radius;
        float g = exp(-dot(d, d) * 0.5);
        float fade = 1.0 - smoothstep(0.0, life, age);
        lift = max(lift, g * fade * fade);
      }
      lift = lift * lift * (3.0 - 2.0 * lift);

      vec2 sp = project(vec3(x, h + lift * liftPx * z / uFocal, z));

      // --- ragged edges ---------------------------------------------------
      // Toward the far and near ends the surface dissolves into scattered dots
      // rather than a clean fade: each dot survives with a probability that
      // falls off, along a noise-wobbled boundary, and survivors drift off-grid.
      float depth = clamp((z - uZNear) / (uZFar - uZNear), 0.0, 1.0);
      float wob = snoise(vec3(aGrid * 0.07, uTime * 0.15));
      float wob2 = snoise(vec3(aGrid * 0.21 + 9.0, uTime * 0.2));
      float far = 1.0 - smoothstep(0.62 + 0.12 * wob, 1.00, depth + 0.06 * wob2);
      float bot = 1.0 - smoothstep(0.66 + 0.07 * wob, 1.00, base.y / uRes.y + 0.03 * wob2);
      float keep = far * bot;
      float r1 = hash(aGrid * 1.7 + 3.1);
      float r2 = hash(aGrid * 2.3 + 7.7);
      float r3 = hash(aGrid * 0.9 + 1.3);
      if (r1 > pow(keep, 0.7)) {                       // dissolved dot
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vAlpha = 0.0; vColor = vec3(0.0);
        return;
      }
      float loose = (1.0 - keep) * uScatter;
      sp += (vec2(r2, r3) - 0.5) * uSpacing * 2.2 * loose;

      gl_Position = vec4(sp.x / uRes.x * 2.0 - 1.0, 1.0 - sp.y / uRes.y * 2.0, 0.0, 1.0);
      gl_PointSize = uDpr * mix(3.0, 1.7, depth) * (1.0 + 0.5 * lift) * mix(1.0, 0.55 + 0.6 * r2, loose);

      // --- colour gradient: far = deep, near = hot; crests glow, troughs sink
      float nearness = 1.0 - pow(depth, 0.55);
      float hNorm = clamp(0.5 + h / (7.0 * localAmp), 0.0, 1.0);
      float heat = smoothstep(0.05, 0.7, slope);
      float t = 0.22 + 0.48 * nearness + 0.30 * hNorm + 0.25 * heat + 0.40 * lift;
      vColor = ramp(t);

      float a = mix(0.70, 1.0, clamp(t, 0.0, 1.0));
      a *= mix(0.45, 1.0, keep);
      vAlpha = a;
    }
  `;

  var FRAG = `
    precision mediump float;
    varying float vAlpha;
    varying vec3  vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c);
      float a = (1.0 - smoothstep(0.30, 0.5, r)) * vAlpha;
      gl_FragColor = vec4(vColor * a, a);   // premultiplied
    }
  `;

  // small seeded PRNG so the dot pattern is stable across resizes
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------
     init
  ------------------------------------------------------------------ */
  function init(container, options) {
    var CONFIG = Object.assign({}, DEFAULTS, options || {});

    var canvas = document.createElement('canvas');
    canvas.className = 'wave-header__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    container.classList.add('wave-header');
    container.insertBefore(canvas, container.firstChild);

    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) { canvas.remove(); return { destroy: function () {} }; }   // no WebGL: leave the plain background

    var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var speed = reduceMotion ? CONFIG.speed * 0.2 : CONFIG.speed;
    var drift = reduceMotion ? CONFIG.drift * 0.2 : CONFIG.drift;

    function compile(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    // dot grid — rebuilt on resize so dots keep a constant on-screen spacing
    var buf = gl.createBuffer();
    var aGrid = gl.getAttribLocation(prog, 'aGrid');
    var count = 0;
    function buildGrid(cssW, cssH, zNear) {
      var cols = Math.round((cssW * 1.2) / CONFIG.spacing);
      var rows = Math.round(((CONFIG.nearEdge - CONFIG.horizon) * cssH * 0.8) / CONFIG.spacing);
      cols = Math.max(cols, 2); rows = Math.max(rows, 2);
      var grid = new Float32Array(cols * rows * 2);
      var half = (0.5 / CONFIG.focal) * 1.2;            // world half-width per unit depth
      var iN = 1 / zNear, iF = 1 / CONFIG.zFar;
      var rowStep = (iF - iN) / (rows - 1);             // row spacing, in 1/z
      var rand = mulberry32(1337);                      // fixed seed: the pattern doesn't reshuffle on resize
      var k = 0;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          // even steps in 1/z -> evenly spaced rows on screen; stagger + jitter break the rows up
          var z = 1 / (iN + rowStep * (r + (c % 2) * CONFIG.staggerY + (rand() - 0.5) * CONFIG.jitterY));
          // x is proportional to depth, so dots keep a constant on-screen spacing
          var u = c + (r % 2) * CONFIG.stagger + (rand() - 0.5) * CONFIG.jitter;
          grid[k++] = (u / (cols - 1) * 2 - 1) * half * z;
          grid[k++] = z;
        }
      }
      count = cols * rows;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aGrid);
      gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);
    }

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var U = {};
    ['uTime','uNow','uDpr','uFocal','uHorizon','uCamH','uZNear','uZFar','uZRef','uRadius','uLift','uLife',
     'uHeight','uScale','uDrift','uSwell','uSwellSpeed','uSpacing','uScatter','uRes','uSeed','uTrail','uRamp']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });

    gl.uniform1f(U.uHorizon, CONFIG.horizon);
    gl.uniform1f(U.uCamH, CONFIG.cameraHeight);
    gl.uniform1f(U.uZFar, CONFIG.zFar);
    gl.uniform1f(U.uLift, CONFIG.lift);
    gl.uniform1f(U.uLife, CONFIG.trailLife);
    gl.uniform1f(U.uHeight, CONFIG.height);
    gl.uniform1f(U.uScale, CONFIG.scale);
    gl.uniform1f(U.uDrift, drift);
    gl.uniform1f(U.uSwell, reduceMotion ? 0.0 : CONFIG.swell);
    gl.uniform1f(U.uSwellSpeed, CONFIG.swellSpeed);
    gl.uniform1f(U.uScatter, CONFIG.scatter);
    gl.uniform3fv(U.uRamp, [].concat.apply([], CONFIG.ramp));
    gl.uniform2f(U.uSeed, Math.random() * 500, Math.random() * 500);   // new terrain every load

    // --- sizing ---
    var dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var r = container.getBoundingClientRect();
      var W = Math.max(1, Math.round(r.width * dpr));
      var H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.uniform2f(U.uRes, W, H);
      gl.uniform1f(U.uDpr, dpr);
      gl.uniform1f(U.uSpacing, CONFIG.spacing * dpr);
      var focalPx = W * CONFIG.focal;
      gl.uniform1f(U.uFocal, focalPx);
      // put the nearest row at `nearEdge` of the canvas height
      var zNear = (CONFIG.cameraHeight * focalPx) / ((CONFIG.nearEdge - CONFIG.horizon) * H);
      gl.uniform1f(U.uZNear, zNear);
      gl.uniform1f(U.uZRef, zNear * 2.6);               // depth at which radius / lift are "nominal"
      gl.uniform1f(U.uRadius, CONFIG.radius * dpr * Math.min(1, Math.max(0.6, r.width / 1100)));
      buildGrid(r.width, r.height, zNear);
    }
    var resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    // --- cursor trail ---
    var trail = new Float32Array(TRAIL * 3);
    for (var i = 0; i < TRAIL; i++) trail[i * 3 + 2] = -1e4;
    var head = 0, lastPush = -1, hovering = false;
    var target = { x: 0, y: 0 }, smooth = { x: 0, y: 0 };

    function onMove(e) {
      var r = canvas.getBoundingClientRect();
      target.x = (e.clientX - r.left) * dpr;
      target.y = (e.clientY - r.top) * dpr;
      if (!hovering) { smooth.x = target.x; smooth.y = target.y; }
      hovering = true;
    }
    function onLeave() { hovering = false; }
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerdown', onMove);
    container.addEventListener('pointerleave', onLeave);
    container.addEventListener('pointercancel', onLeave);

    // --- loop (paused when off-screen / tab hidden) ---
    var visible = true, raf = 0, destroyed = false;
    var io = new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; kick(); });
    io.observe(container);
    document.addEventListener('visibilitychange', kick);

    var t0 = performance.now();
    function frame(nowMs) {
      raf = 0;
      if (destroyed || !visible || document.hidden) return;
      var now = (nowMs - t0) / 1000;

      if (hovering) {
        smooth.x += (target.x - smooth.x) * 0.35;
        smooth.y += (target.y - smooth.y) * 0.35;
        // keep dropping samples (even when still) so the spot under the cursor stays raised
        if (now - lastPush >= CONFIG.trailStep) {
          trail[head * 3] = smooth.x;
          trail[head * 3 + 1] = smooth.y;
          trail[head * 3 + 2] = now;
          head = (head + 1) % TRAIL;
          lastPush = now;
        }
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(U.uTime, now * speed);
      gl.uniform1f(U.uNow, now);
      gl.uniform3fv(U.uTrail, trail);
      gl.drawArrays(gl.POINTS, 0, count);

      raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
    kick();

    return {
      destroy: function () {
        destroyed = true;
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        io.disconnect();
        document.removeEventListener('visibilitychange', kick);
        container.removeEventListener('pointermove', onMove);
        container.removeEventListener('pointerdown', onMove);
        container.removeEventListener('pointerleave', onLeave);
        container.removeEventListener('pointercancel', onLeave);
        var lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        canvas.remove();
      },
    };
  }

  /* ------------------------------------------------------------------
     Auto-init:  <header data-wave-header data-wave-options='{"speed":0.2}'>
  ------------------------------------------------------------------ */
  function autoInit() {
    document.querySelectorAll('[data-wave-header]').forEach(function (el) {
      var opts = {};
      try { opts = JSON.parse(el.getAttribute('data-wave-options') || '{}'); } catch (e) { /* ignore bad JSON */ }
      init(el, opts);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
  else autoInit();

  global.WaveHeader = { init: init, defaults: DEFAULTS };
})(typeof window !== 'undefined' ? window : this);

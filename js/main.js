/* Wiring: state, toolbars, transitions, text alternatives, theme and presentation mode. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var root = document.documentElement;
  var canvas = $('view'), wrap = canvas.parentNode;
  var MAX_GAP = 0.8;           // explode gap at 100 %, in cell edges
  var LAYER_GAP = 1.5;         // layer split at 100 %, in layer spacings
  var state = { lattice: 'sc', n: 1, prism: false, split: false, clip: true, edges: false, cn: false, sites: false, layers: false, bonds: false, size: 100, sat: 100, explode: 0 };
  function buildType() { return state.lattice === 'hcp' && state.prism ? 'hcpx' : state.lattice; }
  var build = Model.build(buildType(), state.n);
  var cam = new Camera();
  var anim = { cells: {}, atoms: {}, bonds: {}, cn: {}, fitReady: false };
  var colors = {}, lineW = 2, dpr = 1;
  var reduceMotion = mq('(prefers-reduced-motion: reduce)');

  var renderer = null;
  try { renderer = new Renderer(canvas); }
  catch (e) { $('nogl').hidden = false; canvas.removeAttribute('tabindex'); console.warn(e); }

  function mq(q) { try { return window.matchMedia(q); } catch (e) { return null; } }
  function cssVar(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function rgb(str) {
    var m = str.match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map(function (i) { return parseInt(m[1].substr(i, 2), 16) / 255; });
    m = str.match(/rgba?\(([^)]+)\)/);
    if (m) return m[1].split(',').slice(0, 3).map(function (v) { return parseFloat(v) / 255; });
    return [0.5, 0.5, 0.5];
  }

  /* ---------- Theme-dependent drawing values ---------- */
  function refreshTheme() {
    ['surface', 'atom', 'atom-corner', 'atom-body', 'atom-face', 'atom-interior', 'layer-a', 'layer-b', 'layer-c', 'bond', 'text-primary', 'cell-edge'].forEach(function (k) {
      colors[k] = rgb(cssVar('--' + k));
    });
    lineW = parseFloat(cssVar('--chart-line')) || 2;
    if (renderer) renderer.colors.bg = colors.surface;
    requestDraw();
  }

  /* ---------- Targets for the current state ---------- */
  function params() {
    var multi = state.n > 1, L = build.lattice, split = multi && state.split && !!L.stack;
    var amount = multi ? state.explode / 100 : 0;
    return {
      multi: multi,
      r: L.r * state.size / 100,
      split: split,                                  // explode pulls layers apart instead of cells
      gap: split ? 0 : amount * MAX_GAP,             // between cells, in cell edges
      layerGap: split ? amount * LAYER_GAP : 0,      // between close-packed layers, in layer spacings
      bonds: state.bonds,
      desat: multi ? 1 - state.sat / 100 : 0,   // how far the cells around the original one go grey
      clip: state.clip
    };
  }
  function layersOn() { return state.layers && !!build.lattice.layers; }

  function setTargets() {
    var p = params(), L = build.lattice, g = p.gap, open = g > 1e-4;
    Object.keys(anim.atoms).forEach(function (k) { anim.atoms[k].rt = 0; });
    Object.keys(anim.bonds).forEach(function (k) { anim.bonds[k].rt = 0; });
    Object.keys(anim.cn).forEach(function (k) { anim.cn[k].rt = 0; });

    // Coordination: one atom of the original cell and all its nearest neighbors, drawn whole and
    // in colour (even outside the block) over a greyed crystal. The cells' own copies of those
    // atoms step aside so the two never overlap.
    var orig = build.cells.filter(function (c) { return c.original; })[0];
    var cn = state.cn ? Model.neighbors(buildType(), orig.idx) : null, cnKeys = {};
    if (cn) [cn.center].concat(cn.list).forEach(function (n) { cnKeys[n.key] = true; });

    // Cells spread by the explode gap along the block's translation vectors, then the block's
    // centre (mean of the cell centroids) moves to the origin.
    var raw = build.cells.map(function (cell) { return Model.toWorld(L.M, cell.idx.map(function (v) { return v * (1 + g); })); });
    var mid = [0, 0, 0];
    raw.forEach(function (w) { for (var k = 0; k < 3; k++) mid[k] += (w[k] + L.centroid[k]) / raw.length; });
    var R = 0;
    build.cells.forEach(function (cell, i) {
      var t = [0, 1, 2].map(function (k) { return raw[i][k] - mid[k]; });
      R = Math.max(R, Math.hypot(t[0] + L.centroid[0], t[1] + L.centroid[1], t[2] + L.centroid[2]) + L.cellR);
      var c = anim.cells[cell.key];
      if (!c) c = anim.cells[cell.key] = { o: t.slice(), t: t };
      c.t = t;
    });
    // Split by layer: each atom moves along the stacking direction by its plane number times the
    // layer gap, centred on the middle plane, so the block's layers separate while cells stay put.
    var st = L.stack, planes = build.atoms.map(function (a) { return a.plane; });
    var lo = Math.min.apply(null, planes), hi = Math.max.apply(null, planes), step = st ? p.layerGap * st.spacing : 0;
    build.atoms.forEach(function (a) {
      var off = st ? st.dir.map(function (v) { return v * (a.plane - (lo + hi) / 2) * step; }) : [0, 0, 0];
      var e = anim.atoms[a.key];
      if (!e) e = anim.atoms[a.key] = { r: 0, m: 0, ref: a, off: off.slice() };
      e.ref = a; e.rt = p.r; e.mt = a.cell.original ? 0 : p.desat; e.offT = off;
      if (cn) {
        var b = a.cell.base, w = [b[0] + a.site.w[0], b[1] + a.site.w[1], b[2] + a.site.w[2]];
        if (cnKeys[Model.pointKey(w)]) e.rt = 0; else e.mt = 1;
      }
    });
    if (cn) {
      var ot = anim.cells[orig.key].t;
      [cn.center].concat(cn.list).forEach(function (n, i) {
        var rel = [n.w[0] - orig.base[0], n.w[1] - orig.base[1], n.w[2] - orig.base[2]];
        var e = anim.cn[n.key];
        if (!e) e = anim.cn[n.key] = { r: 0, m: 0 };
        e.ref = { rel: rel, site: n.site, layer: n.layer, center: i === 0 }; e.rt = p.r; e.mt = 0;
        R = Math.max(R, Math.hypot(ot[0] + rel[0], ot[1] + rel[1], ot[2] + rel[2]));
      });
      anim.cnCount = cn.list.length;
    }
    R += (hi - lo) / 2 * step;
    var layersOpen = p.layerGap > 1e-4;
    build.bonds.forEach(function (b) {
      // Bonds between two cells' atoms only make sense while the cells touch, and bonds between
      // two layers only while the layers touch.
      if (!p.bonds || (b.cross && open) || (!b.samePlane && layersOpen)) return;
      var e = anim.bonds[b.key];
      if (!e) e = anim.bonds[b.key] = { r: 0, m: 0, ref: b };
      e.ref = b; e.rt = Math.min(0.045, 0.3 * p.r); e.mt = 0;
    });
    // Frame the farthest cell corner plus room for a whole outer atom at touching size. The room
    // depends only on the lattice, so clipping and the atom size slider never re-zoom the view.
    anim.fitTarget = (R + L.r * 0.7) * 1.05;
  }

  function step(dt) {
    var k = reduceMotion && reduceMotion.matches ? 1 : 1 - Math.exp(-dt * 9), moving = false;
    function ease(cur, target) {
      var v = cur + (target - cur) * k;
      if (Math.abs(target - v) > 1e-4) moving = true; else v = target;
      return v;
    }
    Object.keys(anim.cells).forEach(function (key) {
      var c = anim.cells[key];
      for (var i = 0; i < 3; i++) c.o[i] = ease(c.o[i], c.t[i]);
    });
    [anim.atoms, anim.bonds, anim.cn].forEach(function (set) {
      Object.keys(set).forEach(function (key) {
        var e = set[key];
        e.r = ease(e.r, e.rt); e.m = ease(e.m, e.mt || 0);
        if (e.off) for (var i = 0; i < 3; i++) e.off[i] = ease(e.off[i], e.offT[i]);
        if (e.rt === 0 && e.r === 0) delete set[key];
      });
    });
    var aspect = canvas.width / Math.max(1, canvas.height);
    var fit = cam.fitDistance(anim.fitTarget, aspect);
    cam.fit = anim.fitReady ? ease(cam.fit, fit) : fit;
    anim.fitReady = true;
    return moving;
  }

  /* ---------- Instance buffers ---------- */
  var bufs = {
    sph: { buf: new Float32Array(1200 * Renderer.SPH), count: 0 },
    bond: { buf: new Float32Array(4000 * Renderer.CYL), count: 0 },
    edge: { buf: new Float32Array(600 * Renderer.CYL), count: 0 }
  };

  function atomColor(a) {
    if (layersOn()) return colors['layer-' + 'abc'.charAt(a.layer)];
    if (!state.sites) return colors.atom;
    return colors['atom-' + a.site.kind];
  }
  function atomRadius(cellKey, site) {
    var e = anim.atoms[cellKey + ':' + site.id];
    return e ? e.r : 0;
  }
  var ZERO = [0, 0, 0];
  function atomOffset(cellKey, site) {
    var e = anim.atoms[cellKey + ':' + site.id];
    return e ? e.off : ZERO;
  }
  var NO_CLIP = { o: [0, 0, 0], lo: [-1e4, -1e4, -1e4, -1e4], hi: [1e4, 1e4, 1e4, 1e4] };
  function pushCyl(set, a, b, rad, col, opacity, cut) {
    var buf = set.buf, o = set.count++ * Renderer.CYL;
    cut = cut || NO_CLIP;
    buf[o] = a[0]; buf[o + 1] = a[1]; buf[o + 2] = a[2];
    buf[o + 3] = b[0]; buf[o + 4] = b[1]; buf[o + 5] = b[2];
    buf[o + 6] = rad; buf[o + 7] = col[0]; buf[o + 8] = col[1]; buf[o + 9] = col[2]; buf[o + 10] = opacity;
    buf[o + 11] = cut.o[0]; buf[o + 12] = cut.o[1]; buf[o + 13] = cut.o[2];
    for (var i = 0; i < 4; i++) { buf[o + 14 + i] = cut.lo[i]; buf[o + 18 + i] = cut.hi[i]; }
  }
  function pushSph(set, c, r, col, opacity, o, lo, hi) {
    var buf = set.buf, j = set.count++ * Renderer.SPH;
    buf[j] = c[0]; buf[j + 1] = c[1]; buf[j + 2] = c[2]; buf[j + 3] = r;
    buf[j + 4] = col[0]; buf[j + 5] = col[1]; buf[j + 6] = col[2]; buf[j + 7] = opacity;
    buf[j + 8] = o[0]; buf[j + 9] = o[1]; buf[j + 10] = o[2];
    for (var i = 0; i < 4; i++) { buf[j + 11 + i] = lo[i]; buf[j + 15 + i] = hi[i]; }
  }
  function add(o, f) { return [o[0] + f[0], o[1] + f[1], o[2] + f[2]]; }
  // Move a colour toward the grey of the same luminance, so desaturated atoms keep their lightness.
  function desaturate(col, amount) {
    var g = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
    return [0, 1, 2].map(function (i) { return col[i] + (g - col[i]) * amount; });
  }

  function render() {
    if (!renderer || !canvas.width) return;
    var p = params(), m = cam.matrices(canvas.width / Math.max(1, canvas.height)), L = build.lattice, clip = L.clip;
    Object.keys(bufs).forEach(function (k) { bufs[k].count = 0; });
    // A cell face is on the outside of the block when no cell of the block lies across it.
    function outer(cell, nb) {
      if (!nb) return true;
      for (var k = 0; k < 3; k++) { var v = cell.idx[k] + nb[k]; if (v < 0 || v >= cell.n) return true; }
      return false;
    }
    // Each copy of an atom or bond is cut at its own cell's faces. With clipping off, faces on the
    // outside of the block are pushed away, so outer atoms stay whole while shared ones are always cut.
    function cutFor(cell, off) {
      return {
        o: add(anim.cells[cell.key].o, off || ZERO),   // a split layer carries its atoms' cuts along
        lo: clip.lo.map(function (v, k) { return !p.clip && outer(cell, clip.nbLo[k]) ? -Model.BIG : v; }),
        hi: clip.hi.map(function (v, k) { return !p.clip && outer(cell, clip.nbHi[k]) ? Model.BIG : v; })
      };
    }

    Object.keys(anim.atoms).forEach(function (key) {
      var e = anim.atoms[key], a = e.ref, cell = a.cell, cut = cutFor(cell, e.off), c = add(cut.o, a.site.w);
      pushSph(bufs.sph, c, e.r, desaturate(atomColor(a), e.m), 1, cut.o, cut.lo, cut.hi);
    });
    Object.keys(anim.bonds).forEach(function (key) {
      var e = anim.bonds[key], b = e.ref;
      var offA = atomOffset(b.cellA.key, b.a), offB = atomOffset(b.cellB.key, b.b);
      var A = add(add(anim.cells[b.cellA.key].o, offA), b.a.w), B = add(add(anim.cells[b.cellB.key].o, offB), b.b.w);
      var d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      var len = Math.hypot(d[0], d[1], d[2]);
      // End each bond where its rim meets the sphere surface, so it starts at the sphere's edge.
      function inset(r) { return r > e.r ? Math.sqrt(r * r - e.r * e.r) / len : 0; }
      var ta = inset(atomRadius(b.cellA.key, b.a)), tb = 1 - inset(atomRadius(b.cellB.key, b.b));
      if (tb <= ta) return;
      var P = [A[0] + d[0] * ta, A[1] + d[1] * ta, A[2] + d[2] * ta], Q = [A[0] + d[0] * tb, A[1] + d[1] * tb, A[2] + d[2] * tb];
      // Bonds between two cells' atoms belong to neither cell, so they are not cut.
      pushCyl(bufs.bond, P, Q, e.r, colors.bond, 1, b.cross ? null : cutFor(b.cellA, offA));
    });

    // Coordination cluster: whole spheres around the chosen atom, joined to it by spokes.
    var cnCenter = null, cnAtoms = [], oo = anim.cells['0,0,0'] ? anim.cells['0,0,0'].o : ZERO;
    Object.keys(anim.cn).forEach(function (key) {
      var e = anim.cn[key], c = add(oo, e.ref.rel);
      pushSph(bufs.sph, c, e.r, atomColor(e.ref), 1, ZERO, NO_CLIP.lo, NO_CLIP.hi);
      if (e.ref.center) cnCenter = { c: c, e: e }; else cnAtoms.push({ c: c, e: e });
    });
    if (cnCenter) cnAtoms.forEach(function (n) {
      var A = cnCenter.c, B = n.c, d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], len = Math.hypot(d[0], d[1], d[2]);
      var rb = Math.min(0.05, 0.35 * Math.min(cnCenter.e.r, n.e.r));
      function inset(r) { return r > rb ? Math.sqrt(r * r - rb * rb) / len : 0; }
      var ta = inset(cnCenter.e.r), tb = 1 - inset(n.e.r);
      if (tb <= ta || rb <= 0) return;
      pushCyl(bufs.bond, [A[0] + d[0] * ta, A[1] + d[1] * ta, A[2] + d[2] * ta],
        [A[0] + d[0] * tb, A[1] + d[1] * tb, A[2] + d[2] * tb], rb, colors['text-primary'], 1);
    });

    // Cell edges are optional (off by default) and mean nothing once the layers are pulled apart through them.
    if (state.edges && p.layerGap <= 1e-4) build.cells.forEach(function (cell) {
      var o = anim.cells[cell.key].o;
      L.edges.forEach(function (ed) {
        pushCyl(bufs.edge, add(o, ed[0]), add(o, ed[1]), lineW / 2 * dpr, colors['cell-edge'], 1);
      });
    });
    renderer.upload(bufs);

    var light = [0, 1, 2].map(function (i) { return -0.45 * m.right[i] + 0.6 * m.up[i] + 0.65 * m.back[i]; });
    var len = Math.hypot(light[0], light[1], light[2]);
    renderer.draw(m, cam.fov, { light: light.map(function (v) { return v / len; }), rimPx: 1.3 * dpr, clipG: clip.G });
  }

  var raf = 0, last = 0;
  function requestDraw() { if (!raf) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    var moving = step(dt);
    render();
    if (moving) { last = t; requestDraw(); } else last = 0;
  }
  cam.onChange = requestDraw;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.round(wrap.clientWidth * dpr), h = Math.round(wrap.clientHeight * dpr);
    if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    requestDraw();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);
  window.addEventListener('resize', resize);   // also catches devicePixelRatio changes (zoom, moving screens)

  /* ---------- Text alternatives ---------- */
  function describe() {
    var L = build.lattice, n = state.n, p = params(), bits = [];
    var s = '3D view of ' + (n === 1 ? 'one ' + L.name + ' ' + L.cellName : 'a ' + n + ' by ' + n + ' by ' + n + ' block of ' + L.name + ' ' + L.cellName + 's');
    if (state.clip) bits.push('spheres cut off at the cell faces');
    else bits.push(n === 1 ? 'whole spheres' : 'outer spheres whole, shared spheres cut at the faces between cells');
    if (layersOn()) bits.push(L.family === 'fcc' ? 'close-packed layers colored A, B and C, stacked along the body diagonal'
                                                  : 'close-packed layers colored A and B, stacked along the c axis');
    else if (state.sites && L.family !== 'sc') {
      bits.push({ bcc: 'corner and body-center', fcc: 'corner and face-center', hcp: 'corner and interior', hcpx: 'corner, face-center and interior' }[L.id] + ' atoms in different colors');
    }
    if (state.size !== L.size) bits.push('atoms at ' + state.size + ' percent of touching size');
    else if (L.size < 100) bits.push('atoms at ' + L.size + ' percent of touching size so the interior atom is not cut');
    if (p.desat > 0) bits.push('cells around the original cell at ' + state.sat + ' percent color saturation');
    if (p.bonds) bits.push('bonds between nearest neighbors');
    if (state.edges) bits.push('cell edges outlined');
    if (state.cn && anim.cnCount) bits.push('one atom shown with its ' + anim.cnCount + ' nearest neighbors, coordination number ' + anim.cnCount + ', the rest greyed');
    if (p.gap > 0) bits.push('cells pulled apart');
    if (p.layerGap > 0) bits.push('close-packed layers pulled apart along the ' + (L.family === 'fcc' ? 'body diagonal' : 'c axis'));
    else if (p.split) bits.push('explode set to split by layer');
    return s + ', ' + bits.join(', ') + '. Drag or use the arrow keys to rotate.';
  }

  var sceneStatus = $('scene-status');
  function announce(text) { if (sceneStatus.textContent !== text) sceneStatus.textContent = text; }

  function updateUI() {
    var multi = state.n > 1, L = build.lattice;
    document.querySelectorAll('[data-lattice]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lattice === state.lattice)); });
    document.querySelectorAll('[data-n]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.dataset.n === state.n)); });
    ['clip', 'edges', 'sites', 'layers', 'bonds', 'cn'].forEach(function (id) { $(id).setAttribute('aria-pressed', String(state[id])); });
    document.querySelectorAll('.multi').forEach(function (el) { el.hidden = !multi; });
    $('layers').hidden = !L.layers;
    $('prism').hidden = L.family !== 'hcp';
    $('split').hidden = !multi || !L.stack;
    $('split').setAttribute('aria-pressed', String(state.split));
    $('prism').setAttribute('aria-pressed', String(state.prism));
    $('size').value = state.size; $('explode').value = state.explode; $('sat').value = state.sat;
    $('sat').setAttribute('aria-valuetext', state.sat + ' percent saturation');
    $('size').setAttribute('aria-valuetext', state.size + ' percent of touching size');
    var pp = params();
    $('explode').setAttribute('aria-valuetext', !state.explode ? 'closed'
      : pp.split ? 'layers apart by ' + (pp.layerGap + 1).toFixed(2) + ' times their spacing'
      : 'gap of ' + (state.explode / 100 * MAX_GAP).toFixed(2) + ' cell edge');
    $('explode').setAttribute('aria-label', pp.split ? 'Split layers' : 'Explode cells');

    var sites = state.sites && !layersOn(), layers = layersOn();
    var show = {
      corner: sites && L.family !== 'sc',
      body: sites && L.family === 'bcc',
      face: sites && (L.family === 'fcc' || L.id === 'hcpx'),
      interior: sites && L.family === 'hcp',
      'layer-a': layers, 'layer-b': layers, 'layer-c': layers && L.layers === 3,
      cn: state.cn
    }, any = false;
    $('cn-text').textContent = 'Coordination number ' + (anim.cnCount || '');
    document.querySelectorAll('#key li').forEach(function (li) { li.hidden = !show[li.dataset.key]; any = any || show[li.dataset.key]; });
    $('key').hidden = !any;

    if (canvas.hasAttribute('tabindex')) canvas.setAttribute('aria-label', describe());
  }

  function change(fn, structural) {
    fn();
    if (structural) build = Model.build(buildType(), state.n);
    setTargets();
    updateUI();
    requestDraw();
    if (structural) {
      var L = build.lattice;
      announce(L.name.charAt(0).toUpperCase() + L.name.slice(1) + (L.id === 'hcpx' ? ', hexagonal prism' : '') + ', ' +
        (state.n === 1 ? 'one cell.' : state.n + ' by ' + state.n + ' by ' + state.n + ' cells.'));
    }
  }

  /* ---------- Controls ---------- */
  document.querySelectorAll('[data-lattice]').forEach(function (b) {
    b.addEventListener('click', function () {
      change(function () {
        if (state.lattice === b.dataset.lattice) return;
        // Settings carry over between lattices. Atom size only follows the new lattice's default
        // (HCP starts smaller) while it is still at the old lattice's default, never once it is set.
        var oldDefault = Model.LATTICES[buildType()].size;
        state.lattice = b.dataset.lattice;
        if (state.size === oldDefault) state.size = Model.LATTICES[buildType()].size;
      }, true);
    });
  });
  document.querySelectorAll('[data-n]').forEach(function (b) {
    b.addEventListener('click', function () {
      change(function () {
        state.n = +b.dataset.n;
      }, true);
    });
  });
  $('prism').addEventListener('click', function () { change(function () { state.prism = !state.prism; }, true); });
  $('split').addEventListener('click', function () { change(function () { state.split = !state.split; }); });
  ['clip', 'edges'].forEach(function (id) {
    $(id).addEventListener('click', function () { change(function () { state[id] = !state[id]; }); });
  });
  // Site colors and layer colors are two ways of coloring the same atoms, so one turns the other off.
  $('sites').addEventListener('click', function () {
    change(function () { state.sites = !state.sites; if (state.sites) state.layers = false; });
  });
  $('layers').addEventListener('click', function () {
    change(function () { state.layers = !state.layers; if (state.layers) state.sites = false; });
  });
  $('bonds').addEventListener('click', function () {
    change(function () {
      state.bonds = !state.bonds;
      // Touching spheres hide every bond, so turning bonds on sets the size three quarters of the way to large.
      if (state.bonds) {
        var s = $('size'), lo = +s.min, hi = +s.max;
        state.size = Math.round(lo + 0.75 * (hi - lo));
      }
    });
  });
  $('cn').addEventListener('click', function () {
    change(function () {
      state.cn = !state.cn;
      // The spokes, and the centre atom inside its shell of neighbors, need room: at most half size.
      if (state.cn && state.size > 50) state.size = 50;
    });
    if (state.cn) announce('Coordination number ' + anim.cnCount + '.');
  });
  $('size').addEventListener('input', function () { change(function () { state.size = +$('size').value; }); });
  $('sat').addEventListener('input', function () { change(function () { state.sat = +$('sat').value; }); });
  $('explode').addEventListener('input', function () { change(function () { state.explode = +$('explode').value; }); });
  $('zoom-in').addEventListener('click', function () { cam.zoomBy(1.2); });
  $('zoom-out').addEventListener('click', function () { cam.zoomBy(1 / 1.2); });
  $('reset').addEventListener('click', function () { cam.reset(); });
  if (renderer) cam.attach(canvas);

  var help = $('help');
  document.addEventListener('pointerdown', function (e) { if (help.open && !help.contains(e.target)) help.open = false; });

  /* ---------- Theme ---------- */
  var themes = ['auto', 'light', 'dark'], themeBtn = $('theme');
  function applyTheme(name, store) {
    if (name === 'auto') delete root.dataset.theme; else root.dataset.theme = name;
    themeBtn.textContent = 'Theme: ' + name;
    if (store) { try { localStorage.setItem('unit-cell-explorer-theme', name); } catch (e) { /* storage unavailable */ } }
    refreshTheme();
  }
  themeBtn.addEventListener('click', function () {
    var cur = root.dataset.theme || 'auto';
    applyTheme(themes[(themes.indexOf(cur) + 1) % themes.length], true);
  });
  var darkQuery = mq('(prefers-color-scheme: dark)');
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', refreshTheme);

  /* ---------- Presentation mode ---------- */
  var presentBtn = $('present'), presentStatus = $('present-status');
  function isPresent() { return root.hasAttribute('data-present'); }
  function setPresent(on) {
    root.toggleAttribute('data-present', on);
    presentBtn.setAttribute('aria-pressed', String(on));
    presentStatus.textContent = on ? 'Presentation mode on. Press Escape to exit.' : 'Presentation mode off.';
    refreshTheme();
    try {
      if (on && document.fullscreenEnabled && !document.fullscreenElement) {
        root.requestFullscreen().catch(function () { /* refused: the mode still applies */ });
      } else if (!on && document.fullscreenElement) {
        document.exitFullscreen();
      }
    } catch (e) { /* Fullscreen API unavailable */ }
  }
  presentBtn.addEventListener('click', function () { setPresent(!isPresent()); });
  document.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); setPresent(!isPresent()); return; }
    if (e.key === 'Escape') {
      if (help.open) {   // the open help card takes the first Escape
        var inside = help.contains(document.activeElement);
        help.open = false;
        if (inside) help.querySelector('summary').focus();
        return;
      }
      if (isPresent()) setPresent(false);
    }
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && isPresent()) setPresent(false);
  });

  /* ---------- Start ---------- */
  var saved = root.dataset.theme || 'auto';
  themeBtn.textContent = 'Theme: ' + saved;
  refreshTheme();
  updateUI();
  setTargets();
  if (new URLSearchParams(location.search).get('present') === '1') setPresent(true);
  // HCP is built but switched off in the page; ?hcp=1 shows its controls for checking it.
  if (new URLSearchParams(location.search).get('hcp') === '1') {
    document.querySelectorAll('[data-hcp]').forEach(function (el) { el.hidden = false; });
  }
  resize();

  window.app = { state: state, cam: cam, anim: anim, get build() { return build; }, Model: Model, refreshTheme: refreshTheme };
})();

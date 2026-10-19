/* Lattice geometry: cell shapes, sites, supercell blocks, nearest-neighbor bonds and close-packed
   layers. No DOM. World units: a = 1. A cell is placed at origin M · idx (M: block translation
   vectors as columns); its sites and edges are world offsets from that origin. */
(function () {
  'use strict';

  var S2 = Math.SQRT2, S3 = Math.sqrt(3), C_HCP = Math.sqrt(8 / 3), AP = S3 / 2;
  var BIG = 1e4;

  function toWorld(M, f) {
    return [0, 1, 2].map(function (k) { return M[0][k] * f[0] + M[1][k] * f[1] + M[2][k] * f[2]; });
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function len(a) { return Math.hypot(a[0], a[1], a[2]); }

  var CUBE_CORNERS = [];
  for (var i = 0; i < 8; i++) CUBE_CORNERS.push([i & 1, (i >> 1) & 1, (i >> 2) & 1]);

  // A parallelepiped cell spanned by M, with sites in fractional coordinates.
  // Clip slabs: fractional coordinate k in [0, 1], whose world gradient is row k of M⁻¹.
  function boxCell(M, sites) {
    var r0 = cross(M[1], M[2]), r1 = cross(M[2], M[0]), r2 = cross(M[0], M[1]), det = dot(M[0], r0);
    var G = [r0, r1, r2].map(function (r) { return r.map(function (v) { return v / det; }); });
    var edges = [];
    CUBE_CORNERS.forEach(function (a) {
      CUBE_CORNERS.forEach(function (b) {
        if (String(a) < String(b) && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1) {
          edges.push([toWorld(M, a), toWorld(M, b)]);
        }
      });
    });
    return {
      M: M,
      sites: sites.map(function (s) { return { id: s.id, kind: s.kind, w: toWorld(M, s.f) }; }),
      edges: edges,
      corners: CUBE_CORNERS.map(function (c) { return toWorld(M, c); }),
      clip: {
        G: G.concat([[0, 0, 0]]), lo: [0, 0, 0, -BIG], hi: [1, 1, 1, BIG],
        // neighbor cell across each slab's low and high face
        nbLo: [[-1, 0, 0], [0, -1, 0], [0, 0, -1], null], nbHi: [[1, 0, 0], [0, 1, 0], [0, 0, 1], null]
      }
    };
  }

  function cubeSites(extra) {
    return CUBE_CORNERS.map(function (f, i) { return { id: 'c' + i, kind: 'corner', f: f }; }).concat(extra || []);
  }

  // HCP primitive cell: a1, a2 horizontal at 120°, c upright along world y.
  var A1 = [1, 0, 0], A2 = [-0.5, 0, AP], CV = [0, C_HCP, 0];

  // HCP hexagonal prism: base centre at the origin, hexagon vertices at a1, a1 + a2, a2, …
  // Prisms tile with translations P1 = 2a1 + a2 (30°), P2 = a1 + 2a2 (90°) and c.
  // Clip slabs: three side directions at 30°, 90°, 150° (|·| ≤ apothem) and height y/c in [0, 1].
  function hexPrism() {
    var verts = [], sites = [], edges = [], k;
    for (k = 0; k < 6; k++) verts.push([Math.cos(k * Math.PI / 3), 0, Math.sin(k * Math.PI / 3)]);
    [0, C_HCP].forEach(function (y, top) {
      verts.forEach(function (v, k) { sites.push({ id: 'v' + top + k, kind: 'corner', w: [v[0], y, v[2]] }); });
      sites.push({ id: 'f' + top, kind: 'face', w: [0, y, 0] });
      verts.forEach(function (v, k) {
        var n = verts[(k + 1) % 6];
        edges.push([[v[0], y, v[2]], [n[0], y, n[2]]]);
      });
    });
    verts.forEach(function (v) { edges.push([[v[0], 0, v[2]], [v[0], C_HCP, v[2]]]); });
    // Interior atoms: B positions (1/3, 2/3, 1/2) and its two 120° turns, 1/√3 from the axis.
    [90, 210, 330].forEach(function (deg, k) {
      var t = deg * Math.PI / 180;
      sites.push({ id: 'i' + k, kind: 'interior', w: [Math.cos(t) / S3, C_HCP / 2, Math.sin(t) / S3] });
    });
    var side = [30, 90, 150].map(function (deg) { var t = deg * Math.PI / 180; return [Math.cos(t), 0, Math.sin(t)]; });
    var P1 = toWorld([A1, A2, CV], [2, 1, 0]), P2 = toWorld([A1, A2, CV], [1, 2, 0]);
    return {
      M: [P1, P2, CV],
      sites: sites,
      edges: edges,
      corners: sites.filter(function (s) { return s.kind === 'corner'; }).map(function (s) { return s.w; }),
      clip: {
        G: side.concat([[0, 1 / C_HCP, 0]]), lo: [-AP, -AP, -AP, 0], hi: [AP, AP, AP, 1],
        nbLo: [[-1, 0, 0], [0, -1, 0], [1, -1, 0], [0, 0, -1]], nbHi: [[1, 0, 0], [0, 1, 0], [-1, 1, 0], [0, 0, 1]]
      }
    };
  }

  // Close-packed plane number of a world position. FCC: (111) planes x + y + z = const, a/√3
  // apart; in half-cell units every FCC point has an even coordinate sum, so sum / 2 counts the
  // planes, which repeat A, B, C. HCP: basal planes every c/2, repeating A, B.
  function fccPlane(w) { return (Math.round(w[0] * 2) + Math.round(w[1] * 2) + Math.round(w[2] * 2)) / 2; }
  function hcpPlane(w) { return Math.round(w[1] * 2 / C_HCP); }
  var FCC_STACK = { planeOf: fccPlane, dir: [1 / S3, 1 / S3, 1 / S3], spacing: 1 / S3 };
  var HCP_STACK = { planeOf: hcpPlane, dir: [0, 1, 0], spacing: C_HCP / 2 };

  var CUBE = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  var BODY = [{ id: 'b', kind: 'body', f: [0.5, 0.5, 0.5] }];
  var FACES = [[0, .5, .5], [1, .5, .5], [.5, 0, .5], [.5, 1, .5], [.5, .5, 0], [.5, .5, 1]]
    .map(function (f, i) { return { id: 'f' + i, kind: 'face', f: f }; });
  var INTERIOR = [{ id: 'i', kind: 'interior', f: [1 / 3, 2 / 3, 0.5] }];

  // r: hard-sphere radius at which nearest neighbors touch; nn: nearest-neighbor distance.
  // size: default atom size (% of r). HCP's interior atom sits a/(2√3) from the nearest cell
  // face (in both cells), so 57 % of r = a/2 keeps it whole.
  function lattice(id, family, name, cellName, cell, r, nn, extra) {
    var L = { id: id, family: family, name: name, cellName: cellName, r: r, nn: nn, size: 100 };
    Object.keys(cell).forEach(function (k) { L[k] = cell[k]; });
    Object.keys(extra || {}).forEach(function (k) { L[k] = extra[k]; });
    var c = [0, 0, 0];
    L.corners.forEach(function (p) { for (var k = 0; k < 3; k++) c[k] += p[k] / L.corners.length; });
    L.centroid = c;
    L.cellR = Math.max.apply(null, L.corners.map(function (p) { return len(sub(p, c)); }));
    return L;
  }
  var LATTICES = {
    // cnSite: the atom of the original cell whose neighbors the Coordination view shows. SC: the
    // corner nearest the default camera; BCC: the body centre; FCC: the front face centre;
    // HCP: an interior atom.
    sc:   lattice('sc',   'sc',  'simple cubic',           'unit cell', boxCell(CUBE, cubeSites()), 0.5, 1,
                  { cnSite: 'c7' }),
    bcc:  lattice('bcc',  'bcc', 'body-centered cubic',    'unit cell', boxCell(CUBE, cubeSites(BODY)), S3 / 4, S3 / 2,
                  { cnSite: 'b' }),
    fcc:  lattice('fcc',  'fcc', 'face-centered cubic',    'unit cell', boxCell(CUBE, cubeSites(FACES)), S2 / 4, 1 / S2,
                  { layers: 3, stack: FCC_STACK, cnSite: 'f5' }),
    hcp:  lattice('hcp',  'hcp', 'hexagonal close-packed', 'unit cell', boxCell([A1, A2, CV], cubeSites(INTERIOR)), 0.5, 1,
                  { layers: 2, stack: HCP_STACK, size: 57, cnSite: 'i' }),
    hcpx: lattice('hcpx', 'hcp', 'hexagonal close-packed', 'hexagonal prism', hexPrism(), 0.5, 1,
                  { layers: 2, stack: HCP_STACK, size: 57, cnSite: 'i0' })
  };

  // Site pairs inside one cell at the nearest-neighbor distance.
  var bondCache = {};
  function cellBonds(type) {
    if (bondCache[type]) return bondCache[type];
    var L = LATTICES[type], out = [];
    for (var i = 0; i < L.sites.length; i++) {
      for (var j = i + 1; j < L.sites.length; j++) {
        if (Math.abs(len(sub(L.sites[i].w, L.sites[j].w)) - L.nn) < 1e-6) out.push([L.sites[i], L.sites[j]]);
      }
    }
    return (bondCache[type] = out);
  }

  // 3×3×3: the centre cell. 2×2×2 has no centre, so take the lower-front-left cell.
  function originalCell(n) { return n === 3 ? [1, 1, 1] : [0, 0, n - 1]; }

  function pointKey(w) { return w.map(function (v) { return Math.round(v * 1000); }).join(','); }

  // Every cell carries its own copy of each site and bond. "owner" marks the one copy of each
  // shared bond to draw when copies would coincide; the original cell claims first.
  // Nearest-neighbor pairs that no single cell contains (HCP's in-plane interior pairs) become
  // "cross" bonds between two cells' atoms, drawn only while the cells are closed up.
  function build(type, n) {
    var L = LATTICES[type], o = originalCell(n), cells = [];
    for (var k = 0; k < n; k++) for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
      var rel = [i - o[0], j - o[1], k - o[2]];
      cells.push({ idx: [i, j, k], n: n, key: rel.join(','), original: rel[0] === 0 && rel[1] === 0 && rel[2] === 0,
                   base: toWorld(L.M, [i, j, k]) });
    }
    cells.sort(function (a, b) { return (b.original ? 1 : 0) - (a.original ? 1 : 0); });

    var points = {}, atoms = [], seenBond = {}, bonds = [], pairs = cellBonds(type);
    function samePlane(wa, wb) { return !L.stack || L.stack.planeOf(wa) === L.stack.planeOf(wb); }
    function at(cell, site) { var b = cell.base; return [b[0] + site.w[0], b[1] + site.w[1], b[2] + site.w[2]]; }
    cells.forEach(function (cell) {
      L.sites.forEach(function (site) {
        var w = at(cell, site), pk = pointKey(w);
        if (!points[pk]) points[pk] = { w: w, cell: cell, site: site };
        var plane = L.stack ? L.stack.planeOf(w) : 0;
        atoms.push({ key: cell.key + ':' + site.id, cell: cell, site: site, plane: plane,
                     layer: L.stack ? ((plane % L.layers) + L.layers) % L.layers : -1 });
      });
      pairs.forEach(function (p) {
        var wa = at(cell, p[0]), wb = at(cell, p[1]);
        var bk = [pointKey(wa), pointKey(wb)].sort().join('|');
        bonds.push({ key: cell.key + ':' + p[0].id + '-' + p[1].id, cellA: cell, a: p[0], cellB: cell, b: p[1],
                     original: cell.original, owner: !seenBond[bk], cross: false, samePlane: samePlane(wa, wb) });
        seenBond[bk] = true;
      });
    });

    var list = Object.keys(points).map(function (k) { return points[k]; });
    for (var x = 0; x < list.length; x++) {
      for (var y = x + 1; y < list.length; y++) {
        var P = list[x], Q = list[y];
        if (Math.abs(len(sub(P.w, Q.w)) - L.nn) > 1e-6) continue;
        var bk = [pointKey(P.w), pointKey(Q.w)].sort().join('|');
        if (seenBond[bk]) continue;
        seenBond[bk] = true;
        bonds.push({ key: 'x:' + bk, cellA: P.cell, a: P.site, cellB: Q.cell, b: Q.site,
                     original: P.cell.original && Q.cell.original, owner: true, cross: true, samePlane: samePlane(P.w, Q.w) });
      }
    }
    return { type: type, n: n, lattice: L, cells: cells, atoms: atoms, bonds: bonds };
  }

  // Coordination: the lattice's cnSite in cell cellIdx and every lattice point at the
  // nearest-neighbor distance from it, found among the sites of the surrounding cells.
  // Positions are world offsets from the block's base, like cell.base + site.w.
  function neighbors(type, cellIdx) {
    var L = LATTICES[type], site = L.sites.filter(function (s) { return s.id === L.cnSite; })[0];
    function at(idx, s) { var b = toWorld(L.M, idx); return [b[0] + s.w[0], b[1] + s.w[1], b[2] + s.w[2]]; }
    function layer(w) { return L.stack ? ((L.stack.planeOf(w) % L.layers) + L.layers) % L.layers : -1; }
    var c = at(cellIdx, site), seen = {}, list = [];
    for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) for (var k = -1; k <= 1; k++) {
      L.sites.forEach(function (s) {
        var w = at([cellIdx[0] + i, cellIdx[1] + j, cellIdx[2] + k], s), key = pointKey(w);
        if (seen[key] || Math.abs(len(sub(w, c)) - L.nn) > 1e-6) return;
        seen[key] = true;
        list.push({ w: w, key: key, site: s, layer: layer(w) });
      });
    }
    return { center: { w: c, key: pointKey(c), site: site, layer: layer(c) }, list: list };
  }

  window.Model = { LATTICES: LATTICES, BIG: BIG, build: build, cellBonds: cellBonds, originalCell: originalCell,
                   toWorld: toWorld, neighbors: neighbors, pointKey: pointKey };
})();

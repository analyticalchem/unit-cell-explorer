/* WebGL 2 renderer: ray-traced spheres and bond rods, both cut to their cell, plus thin cell edges.
   A cell is up to four slabs lo ≤ G·(x − origin) ≤ hi (a parallelepiped uses three, the
   hexagonal prism four), with the gradients G shared by every cell as uniforms. */
(function () {
  'use strict';

  // Metallic look: little diffuse light, a reflection of a soft studio environment (bright above,
  // dark below, fixed to the camera) tinted by the metal's own colour, and a sharp highlight that
  // is mostly coloured with a white core.
  var LIGHTING = [
    'uniform vec3 uLight, uSky;',
    'vec3 shade(vec3 base, vec3 n, vec3 rd, float specAmt) {',
    '  float diff = max(dot(n, uLight), 0.0);',
    '  vec3 r = reflect(rd, n);',
    // Studio reflection: a mid-tone floor, a sharp horizon, a bright softbox band just above it.
    '  float up = dot(r, uSky);',
    '  float env = smoothstep(-0.08, 0.12, up);',
    '  float band = smoothstep(0.18, 0.32, up) * (1.0 - smoothstep(0.5, 0.75, up));',
    '  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);',
    '  float spec = pow(max(dot(r, uLight), 0.0), 90.0);',
    '  vec3 col = base * (0.16 + 0.3 * diff) + base * mix(0.5, 0.9, env) * 0.6;',
    '  col += mix(base, vec3(1.0), 0.55) * band * 0.45;',
    '  col += mix(base, vec3(1.0), 0.5) * spec * specAmt * 4.5 + vec3(fres * env * 0.15);',
    '  return col;',
    '}'
  ].join('\n');

  var SPHERE_VS = [
    '#version 300 es',
    'layout(location=0) in vec2 aCorner;',
    'layout(location=1) in vec4 aSphere;',   // centre xyz, radius
    'layout(location=2) in vec4 aColor;',    // rgb, opacity
    'layout(location=3) in vec3 aOrigin;',   // clip cell origin (world)
    'layout(location=4) in vec4 aLo;',       // clip slab bounds
    'layout(location=5) in vec4 aHi;',
    'uniform mat4 uViewProj; uniform vec3 uEye, uRight, uUp;',
    'out vec3 vWorld; flat out vec4 vSphere; flat out vec4 vColor; flat out vec3 vOrigin; flat out vec4 vLo; flat out vec4 vHi;',
    'void main() {',
    '  float r = aSphere.w;',
    '  float d = max(length(aSphere.xyz - uEye), r * 1.02);',
    // Square that covers the sphere's perspective silhouette, with margin for off-axis stretch and edge AA.
    '  float s = r * d / sqrt(d * d - r * r) * 1.15 + 0.004 * d;',
    '  vec3 w = aSphere.xyz + (uRight * aCorner.x + uUp * aCorner.y) * s;',
    '  vWorld = w; vSphere = aSphere; vColor = aColor; vOrigin = aOrigin; vLo = aLo; vHi = aHi;',
    '  gl_Position = uViewProj * vec4(w, 1.0);',
    '}'
  ].join('\n');

  var SPHERE_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vWorld; flat in vec4 vSphere; flat in vec4 vColor; flat in vec3 vOrigin; flat in vec4 vLo; flat in vec4 vHi;',
    'uniform mat4 uViewProj; uniform vec3 uG[4]; uniform vec3 uEye; uniform float uPxScale, uRimPx;',
    'out vec4 outColor;',
    LIGHTING,
    'void main() {',
    '  vec3 c = vSphere.xyz; float r = vSphere.w;',
    '  vec3 rd = normalize(vWorld - uEye);',
    '  vec3 oc = uEye - c;',
    '  float b = dot(oc, rd);',
    '  float q = max(dot(oc, oc) - b * b, 0.0);',
    '  float dq = sqrt(q);',
    '  float px = uPxScale * length(oc);',                 // world size of one device pixel here
    '  float cov = clamp((r - dq) / px + 0.5, 0.0, 1.0);', // silhouette coverage for alpha-to-coverage
    '  if (cov <= 0.0) discard;',
    '  float h = sqrt(max(r * r - q, 0.0));',
    '  float t0 = -b - h, t1 = -b + h;',
    // Slab tests against the cell; the visible point is where the ray first lies inside both the
    // sphere and every slab. kn remembers which slab it entered last (the cut face it shows).
    '  float tn = -1e30, tf = 1e30, sn = 0.0; int kn = 0;',
    '  for (int k = 0; k < 4; k++) {',
    '    float ro = dot(uG[k], uEye - vOrigin), rk = dot(uG[k], rd);',
    '    float dk = abs(rk) < 1e-9 ? 1e-9 : rk;',
    '    float ta = (vLo[k] - ro) / dk, tb = (vHi[k] - ro) / dk;',
    '    float a = min(ta, tb);',
    '    if (a > tn) { tn = a; kn = k; sn = rk; }',
    '    tf = min(tf, max(ta, tb));',
    '  }',
    '  float te = max(t0, tn), tx = min(t1, tf);',
    '  if (te > tx) discard;',
    '  vec3 p = uEye + rd * te;',
    '  vec3 base = vColor.rgb;',
    // Edge: a thin line of the atom's own (unshaded) theme colour, which is at least 3:1 on the
    // background, so every atom keeps a visible boundary however its shading falls.
    '  vec3 edge = base;',
    '  vec3 col;',
    '  if (tn > t0) {',
    // Cut face: polished metal like the rest, lit with the face normal tilted part way toward the
    // sphere's, so the flat face catches a gentle sweep of reflection instead of one flat tone.
    // Slightly lighter than the curved surface and outlined where it meets it, so the cut still reads.
    '    vec3 nf = normalize(-sign(sn) * uG[kn]);',
    '    vec3 n = normalize(mix(nf, (p - c) / r, 0.4));',
    '    col = shade(mix(base, vec3(1.0), 0.12), n, rd, 0.25);',
    '    if ((r - length(p - c)) / px < uRimPx * 0.8) col = edge;',
    '  } else {',
    '    vec3 n = (p - c) / r;',
    '    col = shade(base, n, rd, 0.25);',
    '    if ((r - dq) / px < uRimPx) col = edge;',
    '  }',
    '  vec4 clip = uViewProj * vec4(p, 1.0);',
    '  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;',
    '  outColor = vec4(col, cov * vColor.a);',
    '}'
  ].join('\n');

  // Cell edges: thin unlit tubes a fixed number of pixels wide.
  var EDGE_VS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',      // unit tube: xy on the unit circle, z from 0 to 1
    'layout(location=1) in vec3 aA;',
    'layout(location=2) in vec3 aB;',
    'layout(location=3) in float aRad;',     // device pixels
    'layout(location=4) in vec4 aColor;',
    'uniform mat4 uViewProj; uniform vec3 uEye; uniform float uPxScale;',
    'flat out vec4 vColor;',
    'void main() {',
    '  vec3 d = aB - aA; float len = length(d);',
    '  vec3 z = len > 1e-6 ? d / len : vec3(0.0, 0.0, 1.0);',
    '  vec3 t = abs(z.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);',
    '  vec3 x = normalize(cross(t, z)); vec3 y = cross(z, x);',
    '  vec3 axisPt = aA + d * aPos.z;',
    '  float rad = aRad * uPxScale * length(axisPt - uEye);',
    '  vColor = aColor;',
    '  gl_Position = uViewProj * vec4(axisPt + (x * aPos.x + y * aPos.y) * rad, 1.0);',
    '}'
  ].join('\n');

  var EDGE_FS = [
    '#version 300 es',
    'precision highp float;',
    'flat in vec4 vColor;',
    'out vec4 outColor;',
    'void main() { outColor = vColor; }'
  ].join('\n');

  // Bonds: ray-traced solid rods, like the atoms. Each bond is drawn as a box around the rod; the
  // fragment shader finds where the pixel's ray first lies inside the rod, its length and its cell
  // all at once, so a rod cut by a cell face shows a flat solid face at the right depth.
  var BOND_VS = [
    '#version 300 es',
    'layout(location=0) in vec3 aPos;',      // box corner: x, y in [-1, 1], z in [0, 1]
    'layout(location=1) in vec3 aA;',
    'layout(location=2) in vec3 aB;',
    'layout(location=3) in float aRad;',
    'layout(location=4) in vec4 aColor;',
    'layout(location=5) in vec3 aOrigin;',   // clip cell, as for spheres
    'layout(location=6) in vec4 aLo;',
    'layout(location=7) in vec4 aHi;',
    'uniform mat4 uViewProj; uniform vec3 uEye; uniform float uPxScale;',
    'out vec3 vW; flat out vec4 vColor; flat out vec3 vOrigin; flat out vec4 vLo; flat out vec4 vHi;',
    'flat out vec3 vA; flat out vec3 vB; flat out float vRad;',
    'void main() {',
    '  vec3 d = aB - aA; float len = length(d);',
    '  vec3 z = len > 1e-6 ? d / len : vec3(0.0, 0.0, 1.0);',
    '  vec3 t = abs(z.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);',
    '  vec3 x = normalize(cross(t, z)); vec3 y = cross(z, x);',
    // A little larger than the rod, plus two pixels, so the silhouette can be smoothed.
    '  vec3 mid = aA + d * aPos.z;',
    '  float pad = aRad * 1.15 + 2.0 * uPxScale * length(mid - uEye);',
    '  vW = mid + z * (aPos.z - 0.5) * 2.0 * pad + (x * aPos.x + y * aPos.y) * pad;',
    '  vColor = aColor; vOrigin = aOrigin; vLo = aLo; vHi = aHi; vA = aA; vB = aB; vRad = aRad;',
    '  gl_Position = uViewProj * vec4(vW, 1.0);',
    '}'
  ].join('\n');

  var BOND_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vW; flat in vec4 vColor; flat in vec3 vOrigin; flat in vec4 vLo; flat in vec4 vHi;',
    'flat in vec3 vA; flat in vec3 vB; flat in float vRad;',
    'uniform mat4 uViewProj; uniform vec3 uG[4], uEye; uniform float uPxScale;',
    'out vec4 outColor;',
    LIGHTING,
    'void main() {',
    '  vec3 rd = normalize(vW - uEye);',
    '  vec3 ax = vB - vA; float L = length(ax); vec3 u = ax / max(L, 1e-6);',
    '  vec3 oc = uEye - vA;',
    // Infinite rod: solve |(oc + t rd)⊥|² = r².
    '  vec3 dp = rd - dot(rd, u) * u, op = oc - dot(oc, u) * u;',
    '  float a = max(dot(dp, dp), 1e-12), b = dot(op, dp), c = dot(op, op) - vRad * vRad;',
    '  float dist = sqrt(max(c + vRad * vRad - b * b / a, 0.0));',   // closest approach to the axis
    '  float px = uPxScale * length(vA + ax * 0.5 - uEye);',
    '  float cov = clamp((vRad - dist) / px + 0.5, 0.0, 1.0);',
    '  if (cov <= 0.0) discard;',
    '  float h = sqrt(max(b * b - a * c, 0.0));',
    '  float t0 = (-b - h) / a, t1 = (-b + h) / a;',
    '  int hit = 0; float sn = 0.0; int kn = 0;',              // 0 rod side, 1 rod end, 2 cell face
    // Rod length: 0 ≤ (p − A)·u ≤ L.
    '  float su = dot(rd, u), so = dot(oc, u);',
    '  float du = abs(su) < 1e-9 ? 1e-9 : su;',
    '  float ta = (0.0 - so) / du, tb = (L - so) / du;',
    '  if (min(ta, tb) > t0) { t0 = min(ta, tb); hit = 1; }',
    '  t1 = min(t1, max(ta, tb));',
    // Cell slabs, as for the atoms.
    '  for (int k = 0; k < 4; k++) {',
    '    float ro = dot(uG[k], uEye - vOrigin), rk = dot(uG[k], rd);',
    '    float dk = abs(rk) < 1e-9 ? 1e-9 : rk;',
    '    float ea = (vLo[k] - ro) / dk, eb = (vHi[k] - ro) / dk;',
    '    if (min(ea, eb) > t0) { t0 = min(ea, eb); hit = 2; kn = k; sn = rk; }',
    '    t1 = min(t1, max(ea, eb));',
    '  }',
    '  if (t0 > t1) discard;',
    '  vec3 p = uEye + rd * t0;',
    '  vec3 col;',
    '  if (hit == 2) {',
    '    col = shade(mix(vColor.rgb, vec3(1.0), 0.12), normalize(-sign(sn) * uG[kn]), rd, 0.2);',
    '    cov = 1.0;',
    '  } else if (hit == 1) {',
    '    col = shade(vColor.rgb, -sign(su) * u, rd, 0.2);',
    '    cov = 1.0;',
    '  } else {',
    '    vec3 n = normalize((p - vA) - dot(p - vA, u) * u);',
    '    col = shade(vColor.rgb, n, rd, 0.2);',
    '  }',
    '  vec4 clip = uViewProj * vec4(p, 1.0);',
    '  gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;',
    '  outColor = vec4(col, cov * vColor.a);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function cylinderMesh(seg) {
    var v = [];
    for (var i = 0; i < seg; i++) {
      var a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      var x0 = Math.cos(a0), y0 = Math.sin(a0), x1 = Math.cos(a1), y1 = Math.sin(a1);
      v.push(x0, y0, 0, x1, y1, 0, x1, y1, 1, x0, y0, 0, x1, y1, 1, x0, y0, 1);
    }
    return new Float32Array(v);
  }
  // Proxy box for a bond: x, y in [-1, 1], z in [0, 1], 12 triangles.
  function boxMesh() {
    var c = function (i) { return [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : 0]; };
    var faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]], v = [];
    faces.forEach(function (f) { [f[0], f[1], f[2], f[0], f[2], f[3]].forEach(function (i) { v.push.apply(v, c(i)); }); });
    return new Float32Array(v);
  }

  // Instance layouts (floats): sphere = centre 3, radius 1, rgb 3, opacity 1, origin 3, lo 4, hi 4.
  //                            cylinder = A 3, B 3, radius 1, rgb 3, opacity 1, origin 3, lo 4, hi 4.
  var SPH = 19, CYL = 22;

  function Renderer(canvas) {
    var gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL 2 unavailable');
    this.gl = gl; this.canvas = canvas;
    this.sph = program(gl, SPHERE_VS, SPHERE_FS);
    this.edge = program(gl, EDGE_VS, EDGE_FS);
    this.bond = program(gl, BOND_VS, BOND_FS);

    var quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    var meshes = { edge: cylinderMesh(8), bond: boxMesh() }, meshBufs = {};
    Object.keys(meshes).forEach(function (k) {
      meshBufs[k] = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshBufs[k]);
      gl.bufferData(gl.ARRAY_BUFFER, meshes[k], gl.STATIC_DRAW);
    });

    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    instanceAttr(gl, 1, 4, SPH, 0); instanceAttr(gl, 2, 4, SPH, 4);
    instanceAttr(gl, 3, 3, SPH, 8); instanceAttr(gl, 4, 4, SPH, 11); instanceAttr(gl, 5, 4, SPH, 15);
    this.sphSet = { vao: vao, buf: buf, count: 0, stride: SPH };

    var self = this;
    ['bond', 'edge'].forEach(function (name) {
      var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, meshBufs[name]);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      instanceAttr(gl, 1, 3, CYL, 0); instanceAttr(gl, 2, 3, CYL, 3); instanceAttr(gl, 3, 1, CYL, 6); instanceAttr(gl, 4, 4, CYL, 7);
      instanceAttr(gl, 5, 3, CYL, 11); instanceAttr(gl, 6, 4, CYL, 14); instanceAttr(gl, 7, 4, CYL, 18);
      self[name + 'Set'] = { vao: vao, buf: buf, count: 0, stride: CYL, verts: meshes[name].length / 3 };
    });
    gl.bindVertexArray(null);
    this.colors = { bg: [1, 1, 1] };
  }

  function instanceAttr(gl, loc, size, stride, offset) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    gl.vertexAttribDivisor(loc, 1);
  }

  Renderer.SPH = SPH; Renderer.CYL = CYL;

  // data: { sph, bond, edge }, each { buf: Float32Array, count }.
  Renderer.prototype.upload = function (data) {
    var gl = this.gl, self = this;
    Object.keys(data).forEach(function (name) {
      var set = self[name + 'Set'], d = data[name];
      gl.bindBuffer(gl.ARRAY_BUFFER, set.buf);
      gl.bufferData(gl.ARRAY_BUFFER, d.buf.subarray(0, d.count * set.stride), gl.DYNAMIC_DRAW);
      set.count = d.count;
    });
  };

  // cam: output of Camera.matrices; opts: { rimPx (device px), light (world dir), clipG (four slab gradients) }.
  Renderer.prototype.draw = function (cam, fov, opts) {
    var gl = this.gl, c = this.colors, w = this.canvas.width, h = this.canvas.height;
    var pxScale = 2 * Math.tan(fov / 2) / h, G = new Float32Array([].concat.apply([], opts.clipG));
    gl.viewport(0, 0, w, h);
    gl.clearColor(c.bg[0], c.bg[1], c.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE);

    var ed = this.edge, bo = this.bond, sp = this.sph;
    if (this.edgeSet.count) {
      gl.useProgram(ed.p);
      gl.uniformMatrix4fv(ed.u.uViewProj, false, cam.viewProj);
      gl.uniform3fv(ed.u.uEye, cam.eye); gl.uniform1f(ed.u.uPxScale, pxScale);
      this.drawSet(this.edgeSet);
    }

    // Bonds and spheres are both ray-traced, with silhouettes smoothed by alpha-to-coverage.
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    if (this.bondSet.count) {
      gl.useProgram(bo.p);
      gl.uniformMatrix4fv(bo.u.uViewProj, false, cam.viewProj);
      gl.uniform3fv(bo.u.uEye, cam.eye); gl.uniform3fv(bo.u.uLight, opts.light); gl.uniform3fv(bo.u.uSky, cam.up);
      gl.uniform1f(bo.u.uPxScale, pxScale); gl.uniform3fv(bo.u.uG, G);
      this.drawSet(this.bondSet);
    }
    if (this.sphSet.count) {
      gl.useProgram(sp.p);
      gl.uniformMatrix4fv(sp.u.uViewProj, false, cam.viewProj);
      gl.uniform3fv(sp.u.uEye, cam.eye); gl.uniform3fv(sp.u.uRight, cam.right); gl.uniform3fv(sp.u.uUp, cam.up);
      gl.uniform3fv(sp.u.uLight, opts.light); gl.uniform3fv(sp.u.uSky, cam.up);
      gl.uniform1f(sp.u.uPxScale, pxScale); gl.uniform1f(sp.u.uRimPx, opts.rimPx);
      gl.uniform3fv(sp.u.uG, G);
      gl.bindVertexArray(this.sphSet.vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.sphSet.count);
    }
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.bindVertexArray(null);
  };

  Renderer.prototype.drawSet = function (set) {
    this.gl.bindVertexArray(set.vao);
    this.gl.drawArraysInstanced(this.gl.TRIANGLES, 0, set.verts, set.count);
  };

  window.Renderer = Renderer;
})();

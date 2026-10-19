/* Orbit camera: yaw/pitch around the origin, perspective projection, pointer/wheel/keyboard input. */
(function () {
  'use strict';

  var DEG = Math.PI / 180;
  var FOV = 30 * DEG;
  // Orbit frame: u is screen-up at zero pitch, the eye sits toward e2 at zero yaw, e1 = u × e2.
  var AXES = {
    y: { u: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1], yaw: 32 * DEG, pitch: 22 * DEG }
  };

  function Camera() {
    this.axis = 'y';
    this.yaw = AXES.y.yaw;
    this.pitch = AXES.y.pitch;
    this.zoom = 1;              // user zoom: > 1 is closer
    this.fit = 4;               // distance that frames the scene, eased by the caller
    this.fov = FOV;
    this.onChange = function () {};
  }

  Camera.prototype.reset = function () {
    var a = AXES[this.axis];
    this.yaw = a.yaw; this.pitch = a.pitch; this.zoom = 1;
    this.onChange();
  };
  Camera.prototype.rotate = function (dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, this.pitch + dPitch));
    this.onChange();
  };
  Camera.prototype.zoomBy = function (factor) {
    this.zoom = Math.max(0.5, Math.min(4, this.zoom * factor));
    this.onChange();
  };

  // Distance at which a sphere of radius R just fits the narrower field of view.
  Camera.prototype.fitDistance = function (R, aspect) {
    var half = Math.min(this.fov / 2, Math.atan(Math.tan(this.fov / 2) * aspect));
    return R / Math.sin(half);
  };

  Camera.prototype.matrices = function (aspect) {
    var dist = this.fit / this.zoom;
    var cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    var a = AXES[this.axis], back = [0, 1, 2].map(function (i) {   // from the target toward the eye
      return cp * (sy * a.e1[i] + cy * a.e2[i]) + sp * a.u[i];
    });
    var eye = [back[0] * dist, back[1] * dist, back[2] * dist];
    var right = norm(cross(a.u, back));
    var up = cross(back, right);

    var view = [
      right[0], up[0], back[0], 0,
      right[1], up[1], back[1], 0,
      right[2], up[2], back[2], 0,
      -dot(right, eye), -dot(up, eye), -dot(back, eye), 1
    ];
    var near = Math.max(0.05, dist * 0.1), far = dist * 4 + 10;
    var f = 1 / Math.tan(this.fov / 2);
    var proj = [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ];
    return { eye: eye, right: right, up: up, back: back, viewProj: mul(proj, view), dist: dist };
  };

  // Drag (any pointer) rotates; two pointers pinch-zoom; wheel zooms; arrows / + − / Home on focus.
  Camera.prototype.attach = function (el) {
    var cam = this, pts = {}, pinch = 0;
    function count() { return Object.keys(pts).length; }
    function spread() {
      var k = Object.keys(pts); if (k.length < 2) return 0;
      var a = pts[k[0]], b = pts[k[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button > 0) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      pinch = spread();
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', function (e) {
      var p = pts[e.pointerId]; if (!p) return;
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (count() === 1) cam.rotate(-dx * 0.45 * DEG, dy * 0.45 * DEG);
      else {
        var s = spread();
        if (pinch > 0 && s > 0) cam.zoomBy(s / pinch);
        pinch = s;
      }
    });
    function end(e) {
      delete pts[e.pointerId];
      pinch = spread();
      if (!count()) el.classList.remove('dragging');
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      cam.zoomBy(Math.exp(-dy * 0.0015));
    }, { passive: false });
    el.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var step = (e.shiftKey ? 15 : 5) * DEG, done = true;
      switch (e.key) {
        case 'ArrowLeft': cam.rotate(step, 0); break;
        case 'ArrowRight': cam.rotate(-step, 0); break;
        case 'ArrowUp': cam.rotate(0, -step); break;
        case 'ArrowDown': cam.rotate(0, step); break;
        case '+': case '=': case 'PageUp': cam.zoomBy(1.15); break;
        case '-': case '_': case 'PageDown': cam.zoomBy(1 / 1.15); break;
        case 'Home': cam.reset(); break;
        default: done = false;
      }
      if (done) e.preventDefault();
    });
  };

  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  // Column-major 4×4 multiply: a · b.
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  window.Camera = Camera;
})();

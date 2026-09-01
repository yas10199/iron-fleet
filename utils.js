/* IRON FRONT — utils.js : tiny maths helpers used everywhere. */
(function (IF) {
  'use strict';

  IF.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  IF.lerp = function (a, b, t) { return a + (b - a) * t; };
  IF.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
  IF.dist = function (ax, ay, bx, by) { return Math.sqrt(IF.dist2(ax, ay, bx, by)); };
  IF.rand = function (a, b) { return a + Math.random() * (b - a); };
  IF.randInt = function (a, b) { return Math.floor(a + Math.random() * (b - a + 1)); };
  IF.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  /* Seeded random so a map layout can be repeated exactly. */
  IF.makeRng = function (seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };

  /* Distance from a point to the edge of a building's footprint (not its
     centre) — a big building's middle is unreachable, so centre distance
     makes units grind against the wall forever. */
  IF.rectDist = function (x, y, b) {
    var dx = Math.max(0, Math.abs(x - b.x) - b.w / 2);
    var dy = Math.max(0, Math.abs(y - b.y) - b.h / 2);
    return Math.sqrt(dx * dx + dy * dy);
  };

  IF.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  /* Rotate a value towards a target angle, no more than `max` radians. */
  IF.turnTowards = function (cur, target, max) {
    var d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (d > max) d = max;
    if (d < -max) d = -max;
    return cur + d;
  };

  /* Simple uniform grid used for "what is near this point" lookups. */
  IF.SpatialHash = function (cell) {
    this.cell = cell || 96;
    this.map = new Map();
  };
  IF.SpatialHash.prototype.clear = function () { this.map.clear(); };
  IF.SpatialHash.prototype.key = function (cx, cy) { return cx * 10007 + cy; };
  IF.SpatialHash.prototype.insert = function (e) {
    var cx = Math.floor(e.x / this.cell), cy = Math.floor(e.y / this.cell);
    var k = this.key(cx, cy), a = this.map.get(k);
    if (!a) { a = []; this.map.set(k, a); }
    a.push(e);
  };
  IF.SpatialHash.prototype.query = function (x, y, r, out) {
    out = out || [];
    out.length = 0;
    var c = this.cell;
    var x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    var y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    for (var cy = y0; cy <= y1; cy++) {
      for (var cx = x0; cx <= x1; cx++) {
        var a = this.map.get(this.key(cx, cy));
        if (a) for (var i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  };

})(window.IF);

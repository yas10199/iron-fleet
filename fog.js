/* IRON FRONT — fog.js
   Shroud and line of sight, the Red Alert way:
     - black    = never scouted
     - dimmed   = scouted, but nothing of yours is looking at it now
     - clear    = a unit or building of yours can see it right now
   Buildings you have seen stay on the map as a memory. Enemy units vanish
   the moment you stop watching them. */
(function (IF) {
  'use strict';

  var T = IF.TILE;

  function Fog(game) {
    this.game = game;
    this.w = game.map.w;
    this.h = game.map.h;
    var n = this.w * this.h;
    this.explored = new Uint8Array(n);
    this.visible = new Uint8Array(n);
    this.timer = 0;
    this.reveals = [];            // temporary reveals from Recon Sweep etc.
    this.seenBuildings = {};      // building id -> remembered snapshot
    this.enabled = true;

    if (typeof document !== 'undefined') {
      this.tex = document.createElement('canvas');
      this.tex.width = this.w; this.tex.height = this.h;
      this.texCtx = this.tex.getContext('2d');
      this.img = this.texCtx.createImageData(this.w, this.h);
    }
    this.dirty = true;
  }

  Fog.prototype.stamp = function (x, y, radius) {
    var cx = x / T, cy = y / T, r = radius / T;
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    var r2 = r * r;
    for (var ty = y0; ty <= y1; ty++) {
      var dy = ty + 0.5 - cy;
      for (var tx = x0; tx <= x1; tx++) {
        var dx = tx + 0.5 - cx;
        if (dx * dx + dy * dy > r2) continue;
        var i = ty * this.w + tx;
        this.visible[i] = 1;
        this.explored[i] = 1;
      }
    }
  };

  Fog.prototype.update = function (dt, pid) {
    if (!this.enabled) return;
    var g = this.game, i;

    for (i = this.reveals.length - 1; i >= 0; i--) {
      this.reveals[i].t -= dt;
      if (this.reveals[i].t <= 0) this.reveals.splice(i, 1);
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;

    this.visible.fill(0);

    for (i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (u.dead || u.owner !== pid) continue;
      if (u.def.cat === 'air' && u.astate === 'rearm') continue;
      this.stamp(u.x, u.y, u.def.sight);
    }
    for (i = 0; i < g.buildings.length; i++) {
      var b = g.buildings[i];
      if (b.dead || b.owner !== pid) continue;
      this.stamp(b.x, b.y, b.def.sight);
    }
    for (i = 0; i < this.reveals.length; i++) {
      this.stamp(this.reveals[i].x, this.reveals[i].y, this.reveals[i].r);
    }

    // Remember enemy buildings we can currently see.
    for (i = 0; i < g.buildings.length; i++) {
      var eb = g.buildings[i];
      if (eb.dead) { delete this.seenBuildings[eb.id]; continue; }
      if (eb.owner === pid) continue;
      if (this.visibleAt(eb.x, eb.y)) {
        this.seenBuildings[eb.id] = { type: eb.type, owner: eb.owner, x: eb.x, y: eb.y, w: eb.w, h: eb.h, tx: eb.tx, ty: eb.ty };
      }
    }

    this.dirty = true;
  };

  Fog.prototype.idxAt = function (x, y) {
    var tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return -1;
    return ty * this.w + tx;
  };
  Fog.prototype.visibleAt = function (x, y) {
    if (!this.enabled) return true;
    var i = this.idxAt(x, y);
    return i < 0 ? false : this.visible[i] === 1;
  };
  Fog.prototype.exploredAt = function (x, y) {
    if (!this.enabled) return true;
    var i = this.idxAt(x, y);
    return i < 0 ? false : this.explored[i] === 1;
  };

  /* Can the player see this entity? Buildings count if any of their footprint
     is lit, so a big structure doesn't flicker at the edge of vision. */
  Fog.prototype.canSee = function (e) {
    if (!this.enabled) return true;
    if (e.kind !== 'building') return this.visibleAt(e.x, e.y);
    for (var ty = e.ty; ty < e.ty + e.def.h; ty++)
      for (var tx = e.tx; tx < e.tx + e.def.w; tx++) {
        var i = ty * this.w + tx;
        if (i >= 0 && i < this.visible.length && this.visible[i]) return true;
      }
    return false;
  };

  Fog.prototype.reveal = function (x, y, r, seconds) {
    this.reveals.push({ x: x, y: y, r: r, t: seconds });
    this.stamp(x, y, r);
    this.dirty = true;
  };

  /* Rebuilds the low-res mask the renderer scales up over the battlefield. */
  Fog.prototype.texture = function () {
    if (!this.tex) return null;
    if (this.dirty) {
      this.dirty = false;
      var d = this.img.data, n = this.w * this.h;
      for (var i = 0; i < n; i++) {
        var a = this.visible[i] ? 0 : (this.explored[i] ? 130 : 255);
        var o = i * 4;
        d[o] = 4; d[o + 1] = 6; d[o + 2] = 5; d[o + 3] = a;
      }
      this.texCtx.putImageData(this.img, 0, 0);
    }
    return this.tex;
  };

  IF.Fog = Fog;
})(window.IF);

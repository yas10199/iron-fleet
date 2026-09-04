/* IRON FRONT — render.js
   ------------------------------------------------------------------------
   Look and feel is modelled on Command & Conquer: Generals. Three ideas do
   most of the work:

   1. HEIGHT. Nothing is a flat square. Buildings are extruded boxes with a
      roof and a wall you can see, units sit slightly above their own shadow.
   2. ONE SUN. Light comes from the upper left, always. Every object gets a
      highlight on its top-left edge, a darker bottom-right edge, and casts a
      shadow down and to the right. Consistency is what sells it.
   3. REAL GROUND. Terrain is painted from noise textures baked once at
      startup, not filled with a single colour, so the ground has grain.
   ------------------------------------------------------------------------ */
(function (IF) {
  'use strict';

  var T = IF.TILE;

  /* Warm, sunlit palette — Generals leans earthy and high contrast. */
  var PAL = {
    grass: '#79814a', grassLo: '#646c3c', grassHi: '#8f9757',
    dirt: '#8a7a5c', dirtLo: '#6f6249', dirtHi: '#a3937200',
    road: '#7d7360', roadLo: '#615948', roadHi: '#93886f',
    forest: '#46592f', canopy: '#4f6b33', canopyHi: '#688444', canopyLo: '#2f4020',
    water: '#2f5468', waterDeep: '#22415a', waterHi: '#4b7c94',
    foam: 'rgba(198,222,228,0.55)',
    shore: '#9a8c66',
    rubble: '#6b6350', ruin: '#7b7361',
    bridge: '#967d54', bridgeLo: '#63512f',
    supply: '#dcb14a', fuel: '#4f9a72',
    sun: 'rgba(255,244,206,0.20)',
    shadow: 'rgba(28,26,18,0.38)'
  };

  /* How tall each structure stands, in pixels. This is the whole trick. */
  var HEIGHT = {
    hq: 48, power: 36, depot: 28, refinery: 42, barracks: 26,
    factory: 38, airfield: 14, lab: 34, radar: 30,
    bunker: 16, atgun: 13, aagun: 13
  };

  var LIGHT = { x: -0.7, y: -0.72 };      // direction the sun comes from

  /* ------------------------------------------------------------------
     Tileable noise textures, generated once. Blobs are drawn nine times
     (offset by ±size) so the edges wrap and tiles join invisibly.
     ------------------------------------------------------------------ */
  function bake(size, base, layers) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    var x = c.getContext('2d');
    x.fillStyle = base;
    x.fillRect(0, 0, size, size);

    layers.forEach(function (L) {
      for (var i = 0; i < L.count; i++) {
        var bx = Math.random() * size, by = Math.random() * size;
        var r = L.min + Math.random() * (L.max - L.min);
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var px = bx + ox * size, py = by + oy * size;
            if (px < -r || py < -r || px > size + r || py > size + r) continue;
            if (L.hard) {
              x.fillStyle = L.col;
              x.fillRect(px - r / 2, py - r / 2, r, r * (L.flat || 1));
            } else {
              var g = x.createRadialGradient(px, py, 0, px, py, r);
              g.addColorStop(0, L.col);
              g.addColorStop(1, L.col.replace(/[\d.]+\)$/, '0)'));
              x.fillStyle = g;
              x.beginPath(); x.arc(px, py, r, 0, 6.283); x.fill();
            }
          }
        }
      }
    });
    return c;
  }

  var R = {
    canvas: null, ctx: null, mini: null, mctx: null,
    miniTimer: 0, cw: 0, ch: 0,

    heightOf: function (type) { return HEIGHT[type] || 24; },

    /* ------------------------------------------------------------------
       LIGHTING
       Fires, explosions and muzzle flashes now actually throw light onto
       the ground and onto whatever is standing near them. The glow is one
       pre-baked sprite, stamped with additive blending, so a battlefield
       full of burning wrecks costs almost nothing to light.
       ------------------------------------------------------------------ */
    bakeLights: function () {
      var mk = function (inner, mid) {
        var c = document.createElement('canvas');
        c.width = c.height = 256;
        var x = c.getContext('2d');
        var g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
        g.addColorStop(0, inner);
        g.addColorStop(0.35, mid);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, 256, 256);
        return c;
      };
      this.lightFire = mk('rgba(255,196,96,0.95)', 'rgba(206,102,30,0.36)');
      this.lightFlash = mk('rgba(255,244,214,0.95)', 'rgba(255,190,110,0.30)');
    },

    /* Gathers everything currently giving off light and stamps it down. */
    lightPass: function (g, ctx) {
      if (!this.lightFire) this.bakeLights();
      var lights = [], i;

      // blasts in progress
      for (i = 0; i < g.effects.length; i++) {
        var e = g.effects[i];
        if (e.t === 'boom') {
          var k = e.age / e.life;
          lights.push({ x: e.x, y: e.y, r: e.r * (5 + k * 4), a: (1 - k) * 0.95, warm: 0 });
        } else if (e.t === 'muzzle') {
          lights.push({ x: e.x, y: e.y, r: 58, a: (1 - e.age / e.life) * 0.55, warm: 0 });
        }
      }
      // burning buildings
      for (i = 0; i < g.buildings.length; i++) {
        var b = g.buildings[i];
        if (b.dead || !b.complete || b.hp > b.maxHp * 0.5) continue;
        if (b.owner !== 0 && !g.fog.canSee(b)) continue;
        var sev = 1 - b.hp / b.maxHp;
        var fl = 0.75 + 0.25 * Math.sin(g.time * 9 + b.id);
        lights.push({ x: b.x, y: b.y - (HEIGHT[b.type] || 24) * 0.4, r: 90 + sev * 130, a: sev * fl * 0.7, warm: 1 });
      }
      // burning hulls
      for (i = 0; i < g.decals.length; i++) {
        var d = g.decals[i];
        if (d.type !== 'wreck' || d.age > 14) continue;
        var fw = 0.7 + 0.3 * Math.sin(g.time * 7 + d.x);
        lights.push({ x: d.x, y: d.y, r: 70, a: (1 - d.age / 14) * fw * 0.6, warm: 1 });
      }

      if (!lights.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < lights.length; i++) {
        var L = lights[i];
        if (!this.onScreen(g, L.x, L.y, L.r)) continue;
        ctx.globalAlpha = IF.clamp(L.a, 0, 1);
        var img = L.warm ? this.lightFire : this.lightFlash;
        ctx.drawImage(img, L.x - L.r, L.y - L.r, L.r * 2, L.r * 2);
      }
      ctx.restore();
    },

    init: function (canvas, mini) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mini = mini;
      this.mctx = mini.getContext('2d');
      this.bakeTerrain();
      this.resize();
    },

    bakeTerrain: function () {
      var S = 128, ctx = this.ctx;
      var defs = {
        grass: [PAL.grass, [
          { count: 26, min: 16, max: 40, col: 'rgba(143,151,87,0.55)' },
          { count: 22, min: 14, max: 34, col: 'rgba(88,96,52,0.50)' },
          { count: 90, min: 2, max: 4, col: 'rgba(160,168,100,0.34)', hard: true },
          { count: 70, min: 2, max: 3, col: 'rgba(70,78,44,0.32)', hard: true }
        ]],
        dirt: [PAL.dirt, [
          { count: 24, min: 16, max: 42, col: 'rgba(163,147,114,0.50)' },
          { count: 20, min: 14, max: 32, col: 'rgba(101,89,66,0.50)' },
          { count: 110, min: 2, max: 4, col: 'rgba(112,99,74,0.34)', hard: true }
        ]],
        road: [PAL.road, [
          { count: 18, min: 18, max: 44, col: 'rgba(147,136,111,0.45)' },
          { count: 18, min: 14, max: 30, col: 'rgba(80,74,60,0.45)' },
          { count: 130, min: 2, max: 5, col: 'rgba(64,59,48,0.30)', hard: true }
        ]],
        forest: [PAL.forest, [
          { count: 22, min: 14, max: 34, col: 'rgba(58,74,38,0.55)' },
          { count: 140, min: 2, max: 4, col: 'rgba(38,50,26,0.55)', hard: true }
        ]],
        water: [PAL.water, [
          { count: 20, min: 20, max: 48, col: 'rgba(34,65,90,0.55)' },
          { count: 16, min: 16, max: 34, col: 'rgba(75,124,148,0.30)' }
        ]],
        rubble: [PAL.rubble, [
          { count: 20, min: 14, max: 32, col: 'rgba(88,80,64,0.5)' },
          { count: 200, min: 3, max: 6, col: 'rgba(52,47,38,0.6)', hard: true },
          { count: 120, min: 2, max: 5, col: 'rgba(129,119,98,0.5)', hard: true }
        ]]
      };
      this.tex = {}; this.pat = {};
      for (var k in defs) {
        this.tex[k] = bake(S, defs[k][0], defs[k][1]);
        this.pat[k] = ctx.createPattern(this.tex[k], 'repeat');
      }
    },

    resize: function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dpr = dpr;
      this.cw = w; this.ch = h;
      this._vig = null;
      if (IF.game) {
        var z = IF.game.cam.zoom || 1;
        IF.game.viewW = w / z; IF.game.viewH = h / z;
      }
      this.mini.width = this.mini.clientWidth * dpr;
      this.mini.height = this.mini.clientHeight * dpr;
      this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    onScreen: function (g, x, y, pad) {
      return x > g.cam.x - pad && x < g.cam.x + g.viewW + pad &&
             y > g.cam.y - pad && y < g.cam.y + g.viewH + pad;
    },

    /* ================================================================= */
    quality: 'high',
    autoQuality: true,
    _fms: 16,

    /* Watches how long frames are actually taking and quietly drops the
       expensive extras — lighting, haze, some particles — if the machine is
       struggling. Comes back up on its own when there is headroom again. */
    gradeQuality: function () {
      if (!this.autoQuality) return;
      if (this.quality === 'high' && this._fms > 26) this.quality = 'low';
      else if (this.quality === 'low' && this._fms < 17) this.quality = 'high';
    },

    draw: function (g, dt) {
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
      var ctx = this.ctx;
      var z = g.cam.zoom || 1;
      g.viewW = this.cw / z; g.viewH = this.ch / z;

      ctx.save();
      ctx.clearRect(0, 0, this.cw, this.ch);
      ctx.scale(z, z);
      ctx.translate(-Math.round(g.cam.x) + (g.shakeX || 0), -Math.round(g.cam.y) + (g.shakeY || 0));

      this.drawGround(g, ctx);      // cached: terrain, trees and scatter
      this.waterShimmer(g, ctx);    // live, so the river still moves
      this.drawDecals(g, ctx);
      this.drawNodes(g, ctx);

      var fog = g.fog, i, b;

      // Everything with height is sorted by its ground line, so things lower
      // down the screen correctly overlap things behind them.
      var props = [];
      for (i = 0; i < g.buildings.length; i++) {
        b = g.buildings[i];
        if (b.owner !== 0 && !fog.exploredAt(b.x, b.y)) continue;
        props.push(b);
      }
      for (i = 0; i < g.units.length; i++) {
        var u = g.units[i];
        if (u.dead || u.def.domain === 'air') continue;
        if (u.owner !== 0 && !fog.visibleAt(u.x, u.y)) continue;
        if (!this.onScreen(g, u.x, u.y, 50)) continue;
        props.push(u);
      }
      props.sort(function (a, c) {
        var ay = a.y + (a.h ? a.h / 2 : (a.rad || 0));
        var cy = c.y + (c.h ? c.h / 2 : (c.rad || 0));
        return ay - cy;
      });

      // pass 1: every shadow, so nothing casts onto a neighbour's roof
      for (i = 0; i < props.length; i++) if (props[i].kind) this.shadowOf(ctx, props[i], g);
      // pass 2: the objects themselves, back to front
      for (i = 0; i < props.length; i++) {
        var p = props[i];
        if (!p.kind) { this.drawProp(ctx, p, g); }
        else if (p.kind === 'building') {
          if (p.dead) this.drawRuin(ctx, p, g);
          else if (p.owner !== 0 && !fog.canSee(p)) {
            ctx.save(); ctx.globalAlpha = 0.62; this.drawBuilding(ctx, p, g, true); ctx.restore();
          } else this.drawBuilding(ctx, p, g, false);
        } else {
          this.drawUnit(ctx, p, g);
        }
      }

      this.drawEffects(g, ctx, false);

      for (i = 0; i < g.units.length; i++) {
        var a = g.units[i];
        if (a.dead || a.def.domain !== 'air' || a.astate === 'rearm') continue;
        if (a.owner !== 0 && !fog.visibleAt(a.x, a.y)) continue;
        if (!this.onScreen(g, a.x, a.y, 80)) continue;
        this.drawPlane(ctx, a, g);
      }

      this.drawProjectiles(g, ctx);
      if (this.quality === 'high') this.lightPass(g, ctx);
      this.drawEffects(g, ctx, true);
      this.drawFog(g, ctx);
      this.drawSelection(g, ctx);
      this.drawPlacement(g, ctx);
      this.drawTargeting(g, ctx);
      this.hoverLabel(g, ctx);

      ctx.restore();
      this.postFx(g, ctx);

      if (t0) {
        var el = performance.now() - t0;
        this._fms = this._fms * 0.92 + el * 0.08;
        this.gradeQuality();
      }

      this.miniTimer -= dt;
      if (this.miniTimer <= 0) { this.miniTimer = 0.12; this.drawMinimap(g); }
    },

    /* ------------------------------------------------------- terrain */
    texFor: function (t) {
      switch (t) {
        case IF.T.ROAD: return 'road';
        case IF.T.BRIDGE: return 'road';
        case IF.T.WATER: return 'water';
        case IF.T.FOREST: return 'forest';
        case IF.T.RUBBLE: return 'rubble';
        case IF.T.RUIN: return 'rubble';
        default: return 'grass';
      }
    },

    /* ------------------------------------------------------------------
       CACHED GROUND
       The ground never changes, so painting it every frame was pure waste.
       It is now rendered once into 512px tiles which are then blitted in a
       handful of drawImage calls. This is the single biggest speed-up in
       the game: roughly a thousand fills per frame become about six.
       ------------------------------------------------------------------ */
    CHUNK: 512,
    groundCache: null,
    chunkOrder: null,

    /* ------------------------------------------------------------------
       RELIEF
       A slow two-octave noise field over the whole map, used to shade the
       ground light on the rises and dark in the hollows, with a lit edge on
       every slope facing the sun. The map stops being a flat sheet.
       ------------------------------------------------------------------ */
    buildRelief: function (g) {
      var W = g.map.w, H = g.map.h;
      var rng = IF.makeRng(31337);
      var field = new Float32Array(W * H);

      var octave = function (step, amp) {
        var gw = Math.ceil(W / step) + 2, gh = Math.ceil(H / step) + 2;
        var grid = new Float32Array(gw * gh);
        for (var i = 0; i < grid.length; i++) grid[i] = rng() * 2 - 1;
        for (var y = 0; y < H; y++) {
          var gy = y / step, y0 = Math.floor(gy), fy = gy - y0;
          fy = fy * fy * (3 - 2 * fy);
          for (var x = 0; x < W; x++) {
            var gx = x / step, x0 = Math.floor(gx), fx = gx - x0;
            fx = fx * fx * (3 - 2 * fx);
            var a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
            var c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
            var top = a + (b - a) * fx, bot = c + (d - c) * fx;
            field[y * W + x] += (top + (bot - top) * fy) * amp;
          }
        }
      };
      octave(11, 0.68);
      octave(4.5, 0.26);
      octave(2.2, 0.10);
      this.relief = field;
      this._reliefFor = g;
    },

    invalidateGround: function () {
      this.groundCache = null;
      this.chunkOrder = null;
      this._miniDirty = true;
    },

    getChunk: function (g, cx, cy) {
      if (!this.groundCache) { this.groundCache = {}; this.chunkOrder = []; }
      var key = cx + '_' + cy;
      var hit = this.groundCache[key];
      if (hit) return hit;

      var C = this.CHUNK;
      var cv = document.createElement('canvas');
      cv.width = C; cv.height = C;
      var cc = cv.getContext('2d');
      cc.translate(-cx * C, -cy * C);
      this.paintGround(g, cc, cx * C, cy * C, C, C);

      this.groundCache[key] = cv;
      this.chunkOrder.push(key);
      // Keep memory bounded — important on phones.
      while (this.chunkOrder.length > 20) {
        var old = this.chunkOrder.shift();
        delete this.groundCache[old];
      }
      return cv;
    },

    drawGround: function (g, ctx) {
      if (this._scatterFor !== g) { this.buildScatter(g); this.invalidateGround(); }
      var C = this.CHUNK;
      var x0 = Math.floor(g.cam.x / C), x1 = Math.floor((g.cam.x + g.viewW) / C);
      var y0 = Math.floor(g.cam.y / C), y1 = Math.floor((g.cam.y + g.viewH) / C);
      var maxX = Math.ceil(g.map.pxW / C) - 1, maxY = Math.ceil(g.map.pxH / C) - 1;
      for (var cy = Math.max(0, y0); cy <= Math.min(maxY, y1); cy++) {
        for (var cx = Math.max(0, x0); cx <= Math.min(maxX, x1); cx++) {
          ctx.drawImage(this.getChunk(g, cx, cy), cx * C, cy * C);
        }
      }
    },

    /* Paints one region of ground into whatever context it is handed. */
    paintGround: function (g, ctx, ox, oy, w, h) {
      var map = g.map, T2 = T;
      var x0 = Math.max(0, Math.floor(ox / T2) - 1);
      var y0 = Math.max(0, Math.floor(oy / T2) - 1);
      var x1 = Math.min(map.w - 1, Math.ceil((ox + w) / T2) + 1);
      var y1 = Math.min(map.h - 1, Math.ceil((oy + h) / T2) + 1);
      this.paintTiles(g, ctx, x0, y0, x1, y1);
      this.paintFields(g, ctx, ox, oy, w, h);
      this.paintTrees(g, ctx, x0, y0, x1, y1);

      // static battlefield clutter, baked in with the ground
      for (var i = 0; i < this.scatter.length; i++) {
        var sc = this.scatter[i];
        if (sc.x < ox - 60 || sc.x > ox + w + 60 || sc.y < oy - 70 || sc.y > oy + h + 60) continue;
        this.drawProp(ctx, sc, g);
      }
    },

    paintTiles: function (g, ctx, x0, y0, x1, y1) {
      var map = g.map;
      if (this._reliefFor !== g) this.buildRelief(g);
      // Batch tiles by texture: one fillStyle change per terrain type.
      var groups = {}, tx, ty, i, t, key;
      for (ty = y0; ty <= y1; ty++) {
        for (tx = x0; tx <= x1; tx++) {
          t = map.tiles[ty * map.w + tx];
          key = this.texFor(t);
          (groups[key] || (groups[key] = [])).push(tx, ty);
        }
      }
      for (key in groups) {
        ctx.fillStyle = this.pat[key];
        var arr = groups[key];
        for (i = 0; i < arr.length; i += 2) ctx.fillRect(arr[i] * T, arr[i + 1] * T, T, T);
      }

      // Relief shading, before the edge details so banks and roads sit on top.
      var W2 = map.w, rel = this.relief;
      for (ty = y0; ty <= y1; ty++) {
        for (tx = x0; tx <= x1; tx++) {
          i = ty * W2 + tx;
          if (map.tiles[i] === IF.T.WATER) continue;
          var hgt = rel[i];
          // slope facing the sun (up and to the left) catches the light
          var up = rel[(ty > 0 ? ty - 1 : ty) * W2 + tx];
          var lf = rel[ty * W2 + (tx > 0 ? tx - 1 : tx)];
          var slope = ((hgt - up) + (hgt - lf)) * 1.9;
          var shade = hgt * 0.13 + slope * 0.5;
          if (shade > 0.012) {
            ctx.fillStyle = 'rgba(255,244,206,' + Math.min(0.24, shade * 0.5).toFixed(3) + ')';
            ctx.fillRect(tx * T, ty * T, T, T);
          } else if (shade < -0.012) {
            ctx.fillStyle = 'rgba(22,26,16,' + Math.min(0.30, -shade * 0.6).toFixed(3) + ')';
            ctx.fillRect(tx * T, ty * T, T, T);
          }
        }
      }

      // Second pass: the details that make edges read as edges.
      for (ty = y0; ty <= y1; ty++) {
        for (tx = x0; tx <= x1; tx++) {
          i = ty * map.w + tx;
          t = map.tiles[i];
          var px = tx * T, py = ty * T, d = map.detail[i];

          if (t === IF.T.WATER) {
            if (this.isWater(map, tx - 1, ty) && this.isWater(map, tx + 1, ty)) {
              ctx.fillStyle = 'rgba(20,44,64,0.45)';
              ctx.fillRect(px, py, T, T);
            }
            ctx.fillStyle = PAL.foam;
            if (!this.isWater(map, tx, ty - 1)) ctx.fillRect(px, py, T, 3);
            if (!this.isWater(map, tx, ty + 1)) ctx.fillRect(px, py + T - 3, T, 3);
            if (!this.isWater(map, tx - 1, ty)) ctx.fillRect(px, py, 3, T);
            if (!this.isWater(map, tx + 1, ty)) ctx.fillRect(px + T - 3, py, 3, T);
          } else if (t === IF.T.BRIDGE) {
            ctx.fillStyle = PAL.bridge; ctx.fillRect(px, py, T, T);
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            for (var pk = 0; pk < T; pk += 7) ctx.fillRect(px + pk, py, 2, T);
            ctx.fillStyle = PAL.bridgeLo;
            if (!this.isWater(map, tx, ty - 1)) ctx.fillRect(px, py, T, 3);
            if (!this.isWater(map, tx, ty + 1)) ctx.fillRect(px, py + T - 3, T, 3);
          } else if (t === IF.T.ROAD) {
            ctx.fillStyle = 'rgba(60,55,44,0.40)';
            if (!this.isRoad(map, tx, ty - 1)) ctx.fillRect(px, py, T, 3.5);
            if (!this.isRoad(map, tx, ty + 1)) ctx.fillRect(px, py + T - 3.5, T, 3.5);
            if (!this.isRoad(map, tx - 1, ty)) ctx.fillRect(px, py, 3.5, T);
            if (!this.isRoad(map, tx + 1, ty)) ctx.fillRect(px + T - 3.5, py, 3.5, T);
            if (d === 0) { ctx.fillStyle = 'rgba(226,214,180,0.30)'; ctx.fillRect(px + 8, py + 14, 12, 3); }
          } else if (t === IF.T.RUIN) {
            this.drawRuinTile(ctx, px, py, d);
          } else if (t !== IF.T.FOREST && this.nearWater(map, tx, ty)) {
            ctx.fillStyle = 'rgba(154,140,102,0.6)';
            if (this.isWater(map, tx, ty - 1)) ctx.fillRect(px, py, T, 8);
            if (this.isWater(map, tx, ty + 1)) ctx.fillRect(px, py + T - 8, T, 8);
            if (this.isWater(map, tx - 1, ty)) ctx.fillRect(px, py, 8, T);
            if (this.isWater(map, tx + 1, ty)) ctx.fillRect(px + T - 8, py, 8, T);
          }
        }
      }

    },

    /* The only part of the ground that is redrawn every frame. */
    waterShimmer: function (g, ctx) {
      var map = g.map;
      var x0 = Math.max(0, Math.floor(g.cam.x / T) - 1);
      var y0 = Math.max(0, Math.floor(g.cam.y / T) - 1);
      var x1 = Math.min(map.w - 1, Math.floor((g.cam.x + g.viewW) / T) + 1);
      var y1 = Math.min(map.h - 1, Math.floor((g.cam.y + g.viewH) / T) + 1);
      ctx.save();
      ctx.lineWidth = 1.6;
      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          var i = ty * map.w + tx;
          if (map.tiles[i] !== IF.T.WATER) continue;
          var ph = Math.sin(g.time * 1.5 + tx * 0.8 + ty * 0.45);
          ctx.strokeStyle = 'rgba(158,198,215,' + (0.09 + 0.13 * (ph + 1) / 2).toFixed(3) + ')';
          var wx = tx * T, wy = ty * T;
          var ly = wy + 10 + (map.detail[i] % 3) * 7 + ph * 3;
          ctx.beginPath();
          ctx.moveTo(wx + 2, ly);
          ctx.quadraticCurveTo(wx + 16, ly - 4, wx + 30, ly);
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    drawRuinTile: function (ctx, px, py, d) {
      var h = 12;
      ctx.fillStyle = PAL.shadow;
      ctx.fillRect(px + 6, py + 8, T - 8, T - 12);
      ctx.fillStyle = '#6a6250';
      ctx.fillRect(px + 3, py + 2 - h, T - 8, T - 8);
      ctx.fillStyle = '#514a3c';
      ctx.fillRect(px + 3, py + T - 10 - h, T - 8, h);
      ctx.fillStyle = 'rgba(255,244,206,0.16)';
      ctx.fillRect(px + 3, py + 2 - h, T - 8, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(px + 8 + (d % 3) * 4, py + 6 - h, 6, 7);
    },

    /* Trees stand up off the ground with their own shadow. */
    paintTrees: function (g, ctx, x0, y0, x1, y1) {
      var map = g.map;
      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          var i = ty * map.w + tx;
          if (map.tiles[i] !== IF.T.FOREST) continue;
          var d = map.detail[i], px = tx * T, py = ty * T;
          // undergrowth first, so the trunks rise out of something
          ctx.fillStyle = 'rgba(46,60,32,0.55)';
          ctx.beginPath();
          ctx.ellipse(px + 16, py + 22, 15, 7, 0, 0, 6.283);
          ctx.fill();
          var conifer = ((tx * 7 + ty * 13) % 5) < 2;
          this.tree(ctx, px + 10 + d, py + 21, 9 + (d % 3), conifer);
          this.tree(ctx, px + 24, py + 10 + (d % 4) * 2, 7 + (d % 2), !conifer);
        }
      }
    },

    tree: function (ctx, x, y, r, conifer) {
      var lift = r * 1.6;
      ctx.fillStyle = 'rgba(20,26,14,0.42)';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.6, y + 2, r * 1.1, r * 0.5, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = '#3b3020';
      ctx.fillRect(x - 1.7, y - lift * 0.55, 3.4, lift * 0.6);
      ctx.fillStyle = '#4a3c27';
      ctx.fillRect(x - 1.7, y - lift * 0.55, 1.4, lift * 0.6);

      if (conifer) {
        // three stacked skirts of needles
        for (var k = 0; k < 3; k++) {
          var ky = y - lift * (0.45 + k * 0.32);
          var kr = r * (1.05 - k * 0.24);
          ctx.fillStyle = k === 2 ? PAL.canopyHi : (k === 1 ? PAL.canopy : PAL.canopyLo);
          ctx.beginPath();
          ctx.moveTo(x - kr, ky);
          ctx.lineTo(x, ky - kr * 1.35);
          ctx.lineTo(x + kr, ky);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        ctx.fillStyle = PAL.canopyLo;
        ctx.beginPath();
        ctx.arc(x, y - lift, r, 0, 6.283);
        ctx.arc(x - r * 0.55, y - lift + r * 0.35, r * 0.62, 0, 6.283);
        ctx.arc(x + r * 0.55, y - lift + r * 0.3, r * 0.58, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = PAL.canopy;
        ctx.beginPath(); ctx.arc(x - r * 0.14, y - lift - r * 0.14, r * 0.85, 0, 6.283); ctx.fill();
        ctx.fillStyle = PAL.canopyHi;
        ctx.beginPath(); ctx.arc(x - r * 0.36, y - lift - r * 0.4, r * 0.44, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(180,205,120,0.35)';
        ctx.beginPath(); ctx.arc(x - r * 0.46, y - lift - r * 0.5, r * 0.2, 0, 6.283); ctx.fill();
      }
    },

    isWater: function (map, tx, ty) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
      var t = map.tiles[ty * map.w + tx];
      return t === IF.T.WATER || t === IF.T.BRIDGE;
    },
    isRoad: function (map, tx, ty) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
      var t = map.tiles[ty * map.w + tx];
      return t === IF.T.ROAD || t === IF.T.BRIDGE;
    },
    nearWater: function (map, tx, ty) {
      return this.isWater(map, tx - 1, ty) || this.isWater(map, tx + 1, ty) ||
             this.isWater(map, tx, ty - 1) || this.isWater(map, tx, ty + 1);
    },

    /* ------------------------------------------------------------------
       BATTLEFIELD SCATTER
       A real WWII map is covered in stuff: sandbag nests, wire, telegraph
       poles, hedgehogs, burnt-out hulls, hay, fence lines, rocks, scrub.
       These are decoration only — nothing here blocks movement — but they
       are most of the difference between "a field" and "a battlefield".
       Generated once from a fixed seed so the map is always the same.
       ------------------------------------------------------------------ */
    buildScatter: function (g) {
      var map = g.map, rng = IF.makeRng(97531), props = [];
      var W = map.w, H = map.h;

      function at(tx, ty) { return map.tiles[ty * W + tx]; }
      function put(tx, ty, type, extra) {
        var pr = {
          x: tx * T + rng() * T, y: ty * T + rng() * T,
          type: type, rot: rng() * 6.283, v: (rng() * 4) | 0
        };
        if (extra) for (var k in extra) pr[k] = extra[k];
        props.push(pr);
      }
      function open(tx, ty) {
        if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return false;
        var t = at(tx, ty);
        return t === IF.T.FIELD || t === IF.T.RUBBLE;
      }

      // --- general ground cover -------------------------------------
      for (var ty = 1; ty < H - 1; ty++) {
        for (var tx = 1; tx < W - 1; tx++) {
          if (!open(tx, ty)) continue;
          var r = rng();
          if (r < 0.055) put(tx, ty, 'bush');
          else if (r < 0.085) put(tx, ty, 'rock');
          else if (r < 0.095) put(tx, ty, 'grasstuft');
          else if (r < 0.100) put(tx, ty, 'crater');
        }
      }

      // --- telegraph poles and fences following the roads -----------
      for (ty = 2; ty < H - 2; ty++) {
        for (tx = 2; tx < W - 2; tx++) {
          if (at(tx, ty) !== IF.T.ROAD) continue;
          var vertical = at(tx, ty - 1) === IF.T.ROAD && at(tx, ty + 1) === IF.T.ROAD;
          if (vertical) {
            if (ty % 7 === 0 && open(tx - 2, ty)) put(tx - 2, ty, 'pole');
          } else {
            if (tx % 7 === 0 && open(tx, ty - 2)) put(tx, ty - 2, 'pole');
          }
        }
      }

      // --- villages: fences, hay, carts, barrels, rubble piles -------
      for (ty = 2; ty < H - 2; ty++) {
        for (tx = 2; tx < W - 2; tx++) {
          if (at(tx, ty) !== IF.T.RUIN) continue;
          for (var d = 0; d < 4; d++) {
            var ox = tx + ((d % 2) ? 2 : -2), oy = ty + ((d > 1) ? 2 : -2);
            if (!open(ox, oy)) continue;
            var rr = rng();
            if (rr < 0.20) put(ox, oy, 'fence');
            else if (rr < 0.33) put(ox, oy, 'hay');
            else if (rr < 0.44) put(ox, oy, 'barrel');
            else if (rr < 0.54) put(ox, oy, 'crate');
            else if (rr < 0.60) put(ox, oy, 'debris');
          }
        }
      }

      // --- defended ground: a ring of works round each starting base -
      for (var b = 0; b < map.bases.length; b++) {
        var bx = map.bases[b].tx + 2, by = map.bases[b].ty + 2;
        for (var i = 0; i < 90; i++) {
          var a = rng() * 6.283, rad = 9 + rng() * 6;
          var px = Math.round(bx + Math.cos(a) * rad);
          var py = Math.round(by + Math.sin(a) * rad);
          if (!open(px, py)) continue;
          var q = rng();
          if (q < 0.34) put(px, py, 'sandbag', { rot: a + Math.PI / 2 });
          else if (q < 0.60) put(px, py, 'wire', { rot: a + Math.PI / 2 });
          else if (q < 0.76) put(px, py, 'hedgehog');
          else if (q < 0.90) put(px, py, 'crate');
          else put(px, py, 'barrel');
        }
      }

      // --- the crossings are contested: works and burnt-out hulls ----
      for (b = 0; b < map.bridges.length; b++) {
        var brx = Math.round(map.bridges[b].x), bry = map.bridges[b].y;
        for (i = 0; i < 34; i++) {
          var sx = brx + Math.round((rng() - 0.5) * 22);
          var sy = bry + Math.round((rng() - 0.5) * 10);
          if (!open(sx, sy)) continue;
          var w = rng();
          if (w < 0.30) put(sx, sy, 'sandbag');
          else if (w < 0.52) put(sx, sy, 'wire');
          else if (w < 0.70) put(sx, sy, 'hedgehog');
          else if (w < 0.82) put(sx, sy, 'hulk');
          else put(sx, sy, 'crater');
        }
      }

      // --- a handful of old wrecks left over from an earlier battle --
      for (i = 0; i < 22; i++) {
        var wx = 6 + Math.floor(rng() * (W - 12));
        var wy = 4 + Math.floor(rng() * (H - 8));
        if (!open(wx, wy)) continue;
        put(wx, wy, 'hulk');
        if (rng() < 0.6) put(wx + 1, wy, 'crater');
      }

      /* --- cultivated fields ---------------------------------------
         Ploughed strips with hedges round them. Europe in 1944 was farmland
         with a war fought across it, not open moor, and nothing else adds
         this much structure to the ground for so little cost. */
      var fields = [];
      for (var ft = 0; ft < 260 && fields.length < 18; ft++) {
        var fw = 7 + Math.floor(rng() * 7), fh = 5 + Math.floor(rng() * 5);
        var fx0 = 3 + Math.floor(rng() * (W - fw - 6));
        var fy0 = 3 + Math.floor(rng() * (H - fh - 6));
        // most of the plot has to be workable ground, but a lane or a copse
        // cutting a corner off is fine — that is what real fields look like
        var okTiles = 0, allTiles = 0;
        for (var cy = fy0; cy < fy0 + fh; cy++)
          for (var cx = fx0; cx < fx0 + fw; cx++) { allTiles++; if (open(cx, cy)) okTiles++; }
        var clear = okTiles / allTiles > 0.72;
        // keep them off the two starting positions
        for (var bi = 0; bi < map.bases.length && clear; bi++) {
          var bxx = map.bases[bi].tx, byy = map.bases[bi].ty;
          if (fx0 < bxx + 12 && fx0 + fw > bxx - 8 && fy0 < byy + 12 && fy0 + fh > byy - 8) clear = false;
        }
        if (!clear) continue;
        var overlap = false;
        for (var q = 0; q < fields.length; q++) {
          var o2 = fields[q];
          if (fx0 < o2.x1 + 2 && fx0 + fw > o2.x0 - 2 && fy0 < o2.y1 + 2 && fy0 + fh > o2.y0 - 2) overlap = true;
        }
        if (overlap) continue;

        fields.push({
          x0: fx0, y0: fy0, x1: fx0 + fw, y1: fy0 + fh,
          vert: rng() < 0.5, tone: rng()
        });

        // hedge the boundary, with a gate gap on one side
        var gap = Math.floor(rng() * fw);
        for (var hx = fx0; hx < fx0 + fw; hx++) {
          if (hx - fx0 !== gap) put(hx, fy0 - 1, 'hedge', { horiz: 1 });
          put(hx, fy0 + fh, 'hedge', { horiz: 1 });
        }
        for (var hy = fy0; hy < fy0 + fh; hy++) {
          put(fx0 - 1, hy, 'hedge', { horiz: 0 });
          put(fx0 + fw, hy, 'hedge', { horiz: 0 });
        }
        if (rng() < 0.55) put(fx0 + 1 + Math.floor(rng() * (fw - 2)), fy0 + 1 + Math.floor(rng() * (fh - 2)), 'hay');
      }
      this.fields = fields;

      props.sort(function (m, n) { return m.y - n.y; });
      this.scatter = props;
      this._scatterFor = g;
    },

    /* Ploughed soil, drawn inside each field boundary. */
    paintFields: function (g, ctx, ox, oy, w, h) {
      if (!this.fields) return;
      for (var i = 0; i < this.fields.length; i++) {
        var fd = this.fields[i];
        var px = fd.x0 * T, py = fd.y0 * T;
        var pw = (fd.x1 - fd.x0) * T, phh = (fd.y1 - fd.y0) * T;
        if (px > ox + w || px + pw < ox || py > oy + h || py + phh < oy) continue;

        var map2 = g.map;
        var soil = fd.tone < 0.4 ? 'rgba(126,102,64,0.58)'
                 : (fd.tone < 0.75 ? 'rgba(152,138,78,0.48)' : 'rgba(104,116,58,0.44)');

        for (var ty2 = fd.y0; ty2 < fd.y1; ty2++) {
          for (var tx2 = fd.x0; tx2 < fd.x1; tx2++) {
            if (tx2 < 0 || ty2 < 0 || tx2 >= map2.w || ty2 >= map2.h) continue;
            var tt = map2.tiles[ty2 * map2.w + tx2];
            if (tt !== IF.T.FIELD) continue;      // a lane or copse stays itself
            var cxp = tx2 * T, cyp = ty2 * T;

            ctx.save();
            ctx.beginPath(); ctx.rect(cxp, cyp, T, T); ctx.clip();
            ctx.fillStyle = soil;
            ctx.fillRect(cxp, cyp, T, T);

            ctx.strokeStyle = 'rgba(58,46,28,0.32)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            var st = 9, o2;
            if (fd.vert) {
              for (o2 = -T; o2 < T * 2; o2 += st) {
                var lx2 = fd.x0 * T + Math.round((cxp - fd.x0 * T + o2) / st) * st;
                ctx.moveTo(lx2, cyp); ctx.lineTo(lx2, cyp + T);
              }
            } else {
              for (o2 = -T; o2 < T * 2; o2 += st) {
                var ly2 = fd.y0 * T + Math.round((cyp - fd.y0 * T + o2) / st) * st;
                ctx.moveTo(cxp, ly2); ctx.lineTo(cxp + T, ly2);
              }
            }
            ctx.stroke();
            ctx.strokeStyle = 'rgba(214,198,150,0.22)';
            ctx.lineWidth = 1.2;
            ctx.translate(fd.vert ? 2 : 0, fd.vert ? 0 : 2);
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    },

    /* Each prop is a small drawing with its own shadow. Kept deliberately
       cheap — a handful of paths each, no gradients. */
    drawProp: function (ctx, p, g) {
      ctx.save();
      ctx.translate(p.x, p.y);
      var sh = 'rgba(26,24,16,0.34)';

      switch (p.type) {
        case 'hedge':
          var hl = 20, hh = 9;
          ctx.fillStyle = 'rgba(20,26,14,0.42)';
          if (p.horiz) ctx.beginPath(), ctx.ellipse(4, 5, hl * 0.62, 5, 0, 0, 6.283), ctx.fill();
          else ctx.beginPath(), ctx.ellipse(4, 5, 6, hl * 0.6, 0, 0, 6.283), ctx.fill();
          ctx.fillStyle = '#33471f';
          for (var hb = 0; hb < 4; hb++) {
            var bxo = p.horiz ? -hl * 0.45 + hb * (hl * 0.3) : 0;
            var byo = p.horiz ? ((hb % 2) ? 1.5 : -1.5) : -hl * 0.45 + hb * (hl * 0.3);
            ctx.beginPath(); ctx.arc(bxo, byo - hh * 0.5, 7.2, 0, 6.283); ctx.fill();
          }
          ctx.fillStyle = '#456029';
          for (var hb2 = 0; hb2 < 3; hb2++) {
            var bx2 = p.horiz ? -hl * 0.35 + hb2 * (hl * 0.34) : -1.5;
            var by2 = p.horiz ? -1.5 : -hl * 0.35 + hb2 * (hl * 0.34);
            ctx.beginPath(); ctx.arc(bx2, by2 - hh * 0.72, 5.4, 0, 6.283); ctx.fill();
          }
          ctx.fillStyle = '#5a7a36';
          ctx.beginPath();
          ctx.arc(p.horiz ? -4 : -3, (p.horiz ? -3 : -6) - hh * 0.5, 3.2, 0, 6.283);
          ctx.fill();
          break;
        case 'bush':
          var br = 6 + p.v;
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(br * 0.4, br * 0.35, br * 1.05, br * 0.5, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#3d5228';
          ctx.beginPath();
          ctx.arc(-br * 0.4, -br * 0.2, br * 0.7, 0, 6.283);
          ctx.arc(br * 0.4, 0, br * 0.62, 0, 6.283);
          ctx.arc(0, -br * 0.55, br * 0.55, 0, 6.283);
          ctx.fill();
          ctx.fillStyle = '#527033';
          ctx.beginPath(); ctx.arc(-br * 0.5, -br * 0.55, br * 0.36, 0, 6.283); ctx.fill();
          break;

        case 'rock':
          var rr = 4 + p.v * 1.6;
          ctx.rotate(p.rot);
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(rr * 0.4, rr * 0.4, rr * 1.1, rr * 0.55, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#6e6a5c';
          ctx.beginPath();
          ctx.moveTo(-rr, rr * 0.4); ctx.lineTo(-rr * 0.5, -rr * 0.7);
          ctx.lineTo(rr * 0.6, -rr * 0.5); ctx.lineTo(rr, rr * 0.45);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#8b8677';
          ctx.beginPath();
          ctx.moveTo(-rr * 0.5, -rr * 0.7); ctx.lineTo(rr * 0.6, -rr * 0.5);
          ctx.lineTo(rr * 0.1, -rr * 0.1); ctx.closePath(); ctx.fill();
          break;

        case 'grasstuft':
          ctx.strokeStyle = 'rgba(126,140,78,0.85)'; ctx.lineWidth = 1.3;
          for (var t2 = 0; t2 < 5; t2++) {
            ctx.beginPath();
            ctx.moveTo(-4 + t2 * 2, 3);
            ctx.quadraticCurveTo(-4 + t2 * 2 + (t2 - 2), -3, -3 + t2 * 2.4 + (t2 - 2) * 1.6, -8);
            ctx.stroke();
          }
          break;

        case 'crater':
          var cr = 10 + p.v * 3;
          ctx.fillStyle = 'rgba(60,52,38,0.55)';
          ctx.beginPath(); ctx.ellipse(0, 0, cr, cr * 0.7, p.rot, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(30,26,18,0.6)';
          ctx.beginPath(); ctx.ellipse(1, 1.5, cr * 0.62, cr * 0.42, p.rot, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(190,176,138,0.32)';
          ctx.beginPath(); ctx.ellipse(-1, -cr * 0.3, cr * 0.78, cr * 0.28, p.rot, 0, 6.283); ctx.fill();
          break;

        case 'pole':
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(9, 3, 12, 4, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#4a3d2b';
          ctx.fillRect(-2, -34, 4, 36);
          ctx.fillStyle = '#5d4d36';
          ctx.fillRect(-2, -34, 1.6, 36);
          ctx.fillRect(-9, -30, 18, 3);
          ctx.fillStyle = '#2c2418';
          ctx.fillRect(-9, -26, 18, 1.6);
          break;

        case 'fence':
          ctx.rotate(p.rot > 3.14 ? 0 : Math.PI / 2);
          ctx.fillStyle = sh;
          ctx.fillRect(-18, 2, 36, 3);
          ctx.fillStyle = '#6a5a3f';
          for (var fp = -18; fp <= 18; fp += 9) ctx.fillRect(fp, -12, 2.6, 14);
          ctx.fillStyle = '#7d6b4c';
          ctx.fillRect(-18, -10, 36, 2.4);
          ctx.fillRect(-18, -5, 36, 2.4);
          break;

        case 'sandbag':
          ctx.rotate(p.rot);
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(3, 4, 20, 7, 0, 0, 6.283); ctx.fill();
          for (var row = 0; row < 2; row++) {
            for (var sbi = 0; sbi < 5; sbi++) {
              var sbx = -16 + sbi * 8 + (row ? 4 : 0), sby = -row * 5;
              ctx.fillStyle = row ? '#9c8f68' : '#867a56';
              ctx.beginPath(); ctx.ellipse(sbx, sby, 5, 3.4, 0, 0, 6.283); ctx.fill();
              ctx.fillStyle = 'rgba(255,244,206,0.18)';
              ctx.beginPath(); ctx.ellipse(sbx - 1, sby - 1.2, 3.2, 1.6, 0, 0, 6.283); ctx.fill();
            }
          }
          break;

        case 'wire':
          ctx.rotate(p.rot);
          ctx.fillStyle = sh;
          ctx.fillRect(-16, 4, 32, 3);
          ctx.strokeStyle = '#6b6a5e'; ctx.lineWidth = 1.4;
          for (var ws = -1; ws <= 1; ws++) {
            ctx.beginPath();
            for (var wx2 = -16; wx2 <= 16; wx2 += 4) {
              var wy2 = -6 + ws * 4 + Math.sin(wx2 * 0.7 + ws) * 2;
              if (wx2 === -16) ctx.moveTo(wx2, wy2); else ctx.lineTo(wx2, wy2);
            }
            ctx.stroke();
          }
          ctx.fillStyle = '#4d4a40';
          ctx.fillRect(-16, -12, 2.4, 16);
          ctx.fillRect(14, -12, 2.4, 16);
          ctx.strokeStyle = '#8d8b7d'; ctx.lineWidth = 1;
          for (var bb = -14; bb < 16; bb += 6) {
            ctx.beginPath(); ctx.moveTo(bb - 2, -8); ctx.lineTo(bb + 2, -4); ctx.moveTo(bb + 2, -8); ctx.lineTo(bb - 2, -4); ctx.stroke();
          }
          break;

        case 'hedgehog':
          ctx.rotate(p.rot);
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(4, 4, 13, 5, 0, 0, 6.283); ctx.fill();
          ctx.strokeStyle = '#57544a'; ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(-11, 5); ctx.lineTo(11, -9);
          ctx.moveTo(11, 5); ctx.lineTo(-11, -9);
          ctx.moveTo(0, 7); ctx.lineTo(0, -11);
          ctx.stroke();
          ctx.strokeStyle = '#77746a'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(-11, 4); ctx.lineTo(11, -10); ctx.stroke();
          break;

        case 'crate':
          ctx.rotate(p.rot * 0.2);
          ctx.fillStyle = sh;
          ctx.fillRect(-6, -2, 18, 12);
          ctx.fillStyle = '#7a6440';
          ctx.fillRect(-9, -12, 17, 14);
          ctx.fillStyle = '#94794e';
          ctx.fillRect(-9, -12, 17, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(-9, -6, 17, 1.6);
          ctx.fillRect(-1.5, -12, 1.6, 14);
          if (p.v > 1) {
            ctx.fillStyle = '#6d5937'; ctx.fillRect(-5, -20, 13, 9);
            ctx.fillStyle = '#8a7048'; ctx.fillRect(-5, -20, 13, 3);
          }
          break;

        case 'barrel':
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(3, 3, 8, 4, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = p.v % 2 ? '#5c6b4c' : '#7a4a30';
          ctx.fillRect(-5, -14, 10, 15);
          ctx.fillStyle = 'rgba(255,244,206,0.20)';
          ctx.fillRect(-5, -14, 3, 15);
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.fillRect(-5, -10, 10, 1.6);
          ctx.fillRect(-5, -4, 10, 1.6);
          ctx.fillStyle = p.v % 2 ? '#6e7f5b' : '#8f5a3a';
          ctx.beginPath(); ctx.ellipse(0, -14, 5, 2.2, 0, 0, 6.283); ctx.fill();
          break;

        case 'hay':
          ctx.fillStyle = sh;
          ctx.beginPath(); ctx.ellipse(5, 4, 16, 6, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#a68c46';
          ctx.beginPath();
          ctx.moveTo(-13, 4); ctx.quadraticCurveTo(0, -22, 13, 4);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#c2a558';
          ctx.beginPath();
          ctx.moveTo(-13, 4); ctx.quadraticCurveTo(-4, -18, 2, 4);
          ctx.closePath(); ctx.fill();
          break;

        case 'debris':
          ctx.rotate(p.rot);
          ctx.fillStyle = 'rgba(40,36,28,0.45)';
          ctx.beginPath(); ctx.ellipse(0, 0, 14, 8, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#6d6455';
          for (var dbi = 0; dbi < 6; dbi++) {
            ctx.fillRect(-11 + (dbi * 5) % 20, -6 + (dbi * 7) % 11, 5, 3.4);
          }
          ctx.fillStyle = '#4a4437';
          ctx.fillRect(-9, -2, 16, 2.6);
          break;

        case 'hulk':
          ctx.rotate(p.rot);
          ctx.fillStyle = 'rgba(22,20,14,0.45)';
          ctx.beginPath(); ctx.ellipse(4, 4, 22, 12, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#3a3830';
          ctx.fillRect(-19, -11, 38, 22);
          ctx.fillStyle = '#26251e';
          ctx.fillRect(-19, -11, 38, 5);
          ctx.fillRect(-19, 6, 38, 5);
          ctx.fillStyle = '#4a483d';
          ctx.fillRect(-15, -6, 30, 12);
          ctx.fillStyle = '#191811';
          ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#2e2c24';
          ctx.beginPath(); ctx.arc(-1, -1.5, 7, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#191811';
          ctx.fillRect(6, -1.8, 18, 3.6);
          // rust streaks
          ctx.fillStyle = 'rgba(120,64,32,0.35)';
          ctx.fillRect(-12, -9, 4, 18);
          ctx.fillRect(7, -9, 3, 18);
          break;
      }
      ctx.restore();
    },

    /* -------------------------------------------------------- shadows */
    shadowOf: function (ctx, e, g) {
      ctx.save();
      ctx.fillStyle = PAL.shadow;
      if (e.kind === 'building') {
        var H = HEIGHT[e.type] || 24;
        var gx = e.x - e.w / 2, gy = e.y - e.h / 2;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + e.w, gy);
        ctx.lineTo(gx + e.w + H * 0.55, gy + H * 0.30);
        ctx.lineTo(gx + e.w + H * 0.55, gy + e.h + H * 0.30);
        ctx.lineTo(gx + H * 0.55, gy + e.h + H * 0.30);
        ctx.lineTo(gx, gy + e.h);
        ctx.closePath();
        ctx.fill();
      } else {
        var lift = e.armor === 'infantry' ? 4 : 6;
        ctx.beginPath();
        ctx.ellipse(e.x + lift * 0.8, e.y + lift * 0.5, e.rad * 1.05, e.rad * 0.68, 0, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    },

    /* ------------------------------------------------------ buildings */
    drawRuin: function (ctx, b, g) {
      ctx.save();
      ctx.translate(b.x, b.y);
      var w = b.w, h = b.h, H = 10;
      ctx.fillStyle = '#4d4638';
      ctx.fillRect(-w / 2, -h / 2 - H, w, h);
      ctx.fillStyle = '#3a352a';
      ctx.fillRect(-w / 2, h / 2 - H, w, H);
      ctx.fillStyle = '#5c5545';
      for (var i = 0; i < 7; i++) {
        var rx = -w / 2 + ((i * 37) % (w - 12)), ry = -h / 2 + ((i * 53) % (h - 10));
        ctx.fillRect(rx, ry - H, 9, 7);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-w / 2 + 5, -h / 2 - H + 5, w - 10, h - 12);
      ctx.restore();
    },

    drawBuilding: function (ctx, b, g, remembered) {
      if (!this.onScreen(g, b.x, b.y, Math.max(b.w, b.h) + 60)) return;
      var f = g.players[b.owner].faction;
      var legion = f.id === 'legion';
      var w = b.w, h = b.h, H = HEIGHT[b.type] || 24;
      var gx = -w / 2, gy = -h / 2;

      // a cleared, compacted yard so the building sits in the ground rather
      // than on top of it
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = 'rgba(122,108,78,0.55)';
      ctx.beginPath();
      ctx.ellipse(2, 4, w * 0.72, h * 0.62, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = 'rgba(88,77,55,0.40)';
      ctx.beginPath();
      ctx.ellipse(2, 6, w * 0.60, h * 0.50, 0, 0, 6.283);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(b.x, b.y);

      var wallBase = legion ? '#5a5245' : '#59634a';
      var wallDark = legion ? '#3b352c' : '#39422e';
      var roofBase = legion ? '#6d6353' : '#6b7554';
      var roofHi = legion ? '#857a67' : '#83906a';

      /* the side wall you can see, from the roof edge down to the ground */
      ctx.fillStyle = wallBase;
      ctx.fillRect(gx, gy + h - H, w, H);
      ctx.fillStyle = wallDark;
      ctx.fillRect(gx, gy + h - 4, w, 4);
      // windows, warmly lit from inside
      var winY = gy + h - H + H * 0.34, winH = Math.max(3, H * 0.26);
      for (var wx = gx + 5; wx < gx + w - 7; wx += 11) {
        ctx.fillStyle = 'rgba(20,26,30,0.75)';
        ctx.fillRect(wx, winY, 6, winH);
        if (b.complete && ((b.id * 7 + wx) % 3)) {
          ctx.fillStyle = 'rgba(255,206,120,0.42)';
          ctx.fillRect(wx + 0.8, winY + 0.8, 4.4, winH - 1.6);
        }
      }
      // a door, so there is somewhere for the men to come out of
      var doorW = Math.min(13, w * 0.22), doorH = H * 0.72;
      ctx.fillStyle = '#221f18';
      ctx.fillRect(-doorW / 2, gy + h - doorH, doorW, doorH);
      ctx.fillStyle = 'rgba(255,206,120,0.20)';
      ctx.fillRect(-doorW / 2 + 1, gy + h - doorH + 1, doorW - 2, doorH - 2);
      ctx.fillStyle = '#4a4436';
      ctx.fillRect(-doorW / 2 - 1.5, gy + h - doorH - 2, doorW + 3, 2.5);
      // vertical ribs so the wall does not read as one flat slab
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (var rx2 = gx + 9; rx2 < gx + w - 4; rx2 += 16) ctx.fillRect(rx2, gy + h - H, 2.5, H);

      /* the roof, lifted by the building's height */
      ctx.fillStyle = roofBase;
      ctx.fillRect(gx, gy - H, w, h);
      ctx.fillStyle = roofHi;
      ctx.fillRect(gx + 2, gy - H + 2, w - 4, h - 6);
      ctx.fillStyle = 'rgba(255,244,206,0.16)';
      ctx.fillRect(gx + 2, gy - H + 2, w - 4, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(gx + 2, gy - H + h - 9, w - 4, 3);

      if (legion) {
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        for (var ry = gy - H + 7; ry < gy - H + h - 8; ry += 11)
          for (var rx3 = gx + 7; rx3 < gx + w - 5; rx3 += 11) ctx.fillRect(rx3, ry, 2.5, 2.5);
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1;
        for (var ly = gy - H + 9; ly < gy - H + h - 8; ly += 8) {
          ctx.beginPath(); ctx.moveTo(gx + 4, ly); ctx.lineTo(gx + w - 4, ly); ctx.stroke();
        }
      }

      /* team colour, read at a glance from across the map */
      ctx.fillStyle = f.color;
      ctx.fillRect(gx + 2, gy - H + h - 6, w - 4, 4);
      ctx.fillRect(gx, gy + h - H, w, 3);

      this.roofDetail(ctx, b, f, w, h, H, g);
      this.structureDetail(ctx, b, f, w, h, H, g);

      if (b.complete) this.battleDamage(ctx, b, w, h, H);
      if (!b.complete) this.scaffold(ctx, b, w, h, H);
      if (b.def.defence && b.complete) this.emplacement(ctx, b, H);
      this.siteProps(ctx, b, g);

      ctx.restore();

      if (!remembered && b.complete) this.fires(ctx, b, g, H);
      if (!remembered) this.healthBar(ctx, b, b.x, b.y - h / 2 - H - 9, w * 0.8, g);
    },

    /* Fittings every structure carries: roof vents, an access ladder up the
       wall, a floodlight, cable runs and a stencilled unit number. Small
       things, but they are what make a box read as a building. */
    structureDetail: function (ctx, b, f, w, h, H, g) {
      var gx = -w / 2, gy = -h / 2, seed = b.id * 41;
      ctx.save();

      // roof vents and a water tank
      ctx.translate(0, -H);
      var vents = w > 100 ? 3 : 2;
      for (var v = 0; v < vents; v++) {
        var vx = gx + 9 + ((seed * (v + 3)) % Math.max(1, w - 26));
        var vy = gy + 7 + ((seed * (v + 5)) % Math.max(1, h - 20));
        ctx.fillStyle = 'rgba(0,0,0,0.30)';
        ctx.fillRect(vx + 2, vy + 2, 9, 7);
        ctx.fillStyle = '#5a6058';
        ctx.fillRect(vx, vy, 9, 7);
        ctx.fillStyle = '#767d72';
        ctx.fillRect(vx, vy, 9, 2.4);
        ctx.fillStyle = '#2b2f2a';
        ctx.fillRect(vx + 1.5, vy + 3.5, 6, 1.6);
      }
      if (w > 90) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath(); ctx.ellipse(gx + w - 18, gy + 16, 9, 6, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#4e5550';
        ctx.beginPath(); ctx.ellipse(gx + w - 20, gy + 13, 9, 6, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#6b736c';
        ctx.beginPath(); ctx.ellipse(gx + w - 20, gy + 11, 9, 4, 0, 0, 6.283); ctx.fill();
      }
      ctx.restore();

      ctx.save();
      // access ladder running up the wall face
      var lx = gx + w - 15;
      ctx.strokeStyle = '#2f342b'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(lx, gy + h); ctx.lineTo(lx, gy + h - H);
      ctx.moveTo(lx + 6, gy + h); ctx.lineTo(lx + 6, gy + h - H);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      for (var rung = 3; rung < H; rung += 5) {
        ctx.beginPath(); ctx.moveTo(lx, gy + h - rung); ctx.lineTo(lx + 6, gy + h - rung); ctx.stroke();
      }

      // floodlight on a bracket, throwing a pool of light down the wall
      var fx3 = gx + 11;
      ctx.fillStyle = '#33382f';
      ctx.fillRect(fx3, gy + h - H - 4, 8, 5);
      ctx.fillStyle = '#ffdf9e';
      ctx.fillRect(fx3 + 1, gy + h - H - 3, 6, 3);
      var lg = ctx.createLinearGradient(fx3 + 4, gy + h - H, fx3 + 4, gy + h);
      lg.addColorStop(0, 'rgba(255,214,140,0.22)');
      lg.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(fx3 + 1, gy + h - H);
      ctx.lineTo(fx3 + 13, gy + h);
      ctx.lineTo(fx3 - 8, gy + h);
      ctx.closePath(); ctx.fill();

      // stencilled unit number on the wall
      ctx.fillStyle = 'rgba(228,220,196,0.42)';
      ctx.font = 'bold 9px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.fillText((b.def.short || 'HQ') + '-' + (100 + (b.id % 90)), gx + 6, gy + h - 5);

      // cable running out to the yard
      ctx.strokeStyle = 'rgba(20,20,14,0.55)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(gx + w - 8, gy + h - H + 3);
      ctx.quadraticCurveTo(gx + w + 14, gy + h - 6, gx + w + 22, gy + h + 8);
      ctx.stroke();
      ctx.restore();
    },

    /* ------------------------------------------------------------------
       THE YARD
       Every structure gets equipment laid out in front of it, chosen to fit
       what the building does — crates at a depot, tents at the barracks, a
       fuel bowser at the airfield. Generated once per building.
       ------------------------------------------------------------------ */
    SITE: {
      hq:       ['sandbag', 'crate', 'mast', 'jeep'],
      power:    ['drum', 'spool', 'transformer', 'drum'],
      depot:    ['crate', 'crate', 'jeep', 'crate'],
      refinery: ['drum', 'drum', 'pipe', 'drum'],
      barracks: ['tent', 'tent', 'crate', 'sandbag'],
      factory:  ['crate', 'hulkSmall', 'drum', 'crate'],
      airfield: ['bowser', 'windsock', 'drum', 'crate'],
      lab:      ['mast', 'crate', 'spool'],
      radar:    ['spool', 'drum', 'mast'],
      bunker:   ['sandbag', 'sandbag', 'crate'],
      atgun:    ['sandbag', 'crate'],
      aagun:    ['sandbag', 'crate']
    },

    siteProps: function (ctx, b, g) {
      if (!b._site) {
        var list = this.SITE[b.type] || ['crate'];
        var seed = b.id * 2654435761 % 100000;
        b._site = [];
        for (var i = 0; i < list.length; i++) {
          var frac = (i + 0.5) / list.length;
          // spread them along the lower perimeter so they read as in front
          var px = -b.w / 2 - 12 + frac * (b.w + 24) + ((seed >> (i * 3)) % 9) - 4;
          var py = b.h / 2 + 6 + ((seed >> (i * 2)) % 11);
          b._site.push({ type: list[i], x: px, y: py, v: (seed >> i) % 4 });
        }
      }
      for (var k = 0; k < b._site.length; k++) this.siteItem(ctx, b._site[k], g);
    },

    siteItem: function (ctx, it, g) {
      ctx.save();
      ctx.translate(it.x, it.y);
      var sh = 'rgba(26,24,16,0.36)';
      switch (it.type) {
        case 'crate':
          ctx.fillStyle = sh; ctx.fillRect(-5, -1, 17, 10);
          ctx.fillStyle = '#7a6440'; ctx.fillRect(-8, -11, 16, 13);
          ctx.fillStyle = '#94794e'; ctx.fillRect(-8, -11, 16, 4);
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-1.4, -11, 1.6, 13);
          if (it.v > 1) { ctx.fillStyle = '#6d5937'; ctx.fillRect(-5, -19, 12, 8); ctx.fillStyle = '#8a7048'; ctx.fillRect(-5, -19, 12, 3); }
          break;
        case 'drum':
          for (var d2 = 0; d2 < 3; d2++) {
            var dx = -9 + d2 * 9, dy = (d2 % 2) * 3;
            ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(dx + 2, dy + 2, 6, 3, 0, 0, 6.283); ctx.fill();
            ctx.fillStyle = d2 % 2 ? '#5c6b4c' : '#7a4a30';
            ctx.fillRect(dx - 4, dy - 12, 8, 13);
            ctx.fillStyle = 'rgba(255,244,206,0.20)'; ctx.fillRect(dx - 4, dy - 12, 2.6, 13);
            ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(dx - 4, dy - 8, 8, 1.4);
          }
          break;
        case 'sandbag':
          ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(3, 3, 18, 6, 0, 0, 6.283); ctx.fill();
          for (var row = 0; row < 2; row++)
            for (var sb = 0; sb < 4; sb++) {
              var sx = -14 + sb * 8 + (row ? 4 : 0), sy = -row * 5;
              ctx.fillStyle = row ? '#9c8f68' : '#867a56';
              ctx.beginPath(); ctx.ellipse(sx, sy, 5, 3.4, 0, 0, 6.283); ctx.fill();
            }
          break;
        case 'tent':
          ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(4, 3, 17, 6, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#5d6146';
          ctx.beginPath(); ctx.moveTo(-14, 2); ctx.lineTo(0, -16); ctx.lineTo(14, 2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#727756';
          ctx.beginPath(); ctx.moveTo(-14, 2); ctx.lineTo(0, -16); ctx.lineTo(-2, 2); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#2b2e22';
          ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(0, -8); ctx.lineTo(4, 2); ctx.closePath(); ctx.fill();
          break;
        case 'jeep':
          ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(3, 3, 16, 6, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#15170f';
          ctx.beginPath(); ctx.ellipse(-9, 3, 3.2, 2.4, 0, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.ellipse(8, 3, 3.2, 2.4, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#54604c'; ctx.fillRect(-14, -8, 28, 11);
          ctx.fillStyle = '#69765f'; ctx.fillRect(-14, -8, 28, 4);
          ctx.fillStyle = '#3a4234'; ctx.fillRect(1, -13, 11, 6);
          break;
        case 'bowser':
          ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(3, 3, 19, 6, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#15170f';
          ctx.beginPath(); ctx.ellipse(-11, 3, 3.4, 2.4, 0, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.ellipse(9, 3, 3.4, 2.4, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#3f4a44';
          ctx.beginPath(); ctx.ellipse(-2, -6, 14, 7, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,244,206,0.22)';
          ctx.beginPath(); ctx.ellipse(-2, -9, 12, 3, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#4f9a72'; ctx.fillRect(-6, -6, 9, 2);
          break;
        case 'windsock':
          ctx.strokeStyle = '#3d4238'; ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -26); ctx.stroke();
          var sway = Math.sin(g.time * 1.3) * 3;
          ctx.fillStyle = '#d8722f';
          ctx.beginPath();
          ctx.moveTo(0, -26); ctx.lineTo(16, -23 + sway); ctx.lineTo(16, -17 + sway); ctx.lineTo(0, -18);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#efe4d2';
          ctx.fillRect(7, -23 + sway * 0.6, 4, 5.5);
          break;
        case 'mast':
          ctx.strokeStyle = '#2f342b'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -34); ctx.stroke();
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-9, 2); ctx.moveTo(0, -12); ctx.lineTo(9, 2); ctx.stroke();
          ctx.fillStyle = '#d0452f';
          ctx.beginPath(); ctx.arc(0, -34, 2.2, 0, 6.283); ctx.fill();
          break;
        case 'spool':
          ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(3, 3, 11, 4, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#5b4b32';
          ctx.beginPath(); ctx.arc(0, -6, 9, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#3b3020';
          ctx.beginPath(); ctx.arc(0, -6, 4.5, 0, 6.283); ctx.fill();
          ctx.strokeStyle = '#6d5c3f'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(0, -6, 7, 0, 6.283); ctx.stroke();
          break;
        case 'transformer':
          ctx.fillStyle = sh; ctx.fillRect(-6, -1, 18, 9);
          ctx.fillStyle = '#4b5157'; ctx.fillRect(-9, -14, 18, 15);
          ctx.fillStyle = '#5f676e'; ctx.fillRect(-9, -14, 18, 4);
          ctx.strokeStyle = '#2b2f33'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(-5, -14); ctx.lineTo(-5, -21); ctx.moveTo(5, -14); ctx.lineTo(5, -21); ctx.stroke();
          ctx.fillStyle = '#9fd6e6';
          ctx.beginPath(); ctx.arc(-5, -22, 2, 0, 6.283); ctx.arc(5, -22, 2, 0, 6.283); ctx.fill();
          break;
        case 'pipe':
          ctx.fillStyle = sh; ctx.fillRect(-14, 1, 30, 5);
          ctx.fillStyle = '#4a544d'; ctx.fillRect(-16, -6, 32, 6);
          ctx.fillStyle = '#5e6a61'; ctx.fillRect(-16, -6, 32, 2);
          ctx.fillStyle = '#39413b'; ctx.fillRect(-12, -10, 5, 10); ctx.fillRect(8, -10, 5, 10);
          break;
        case 'hulkSmall':
          ctx.fillStyle = sh; ctx.beginPath(); ctx.ellipse(3, 3, 16, 7, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#3a3830'; ctx.fillRect(-14, -8, 28, 15);
          ctx.fillStyle = '#26251e'; ctx.fillRect(-14, -8, 28, 4);
          ctx.fillStyle = '#191811'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 6.283); ctx.fill();
          break;
      }
      ctx.restore();
    },

    /* Three visible stages of ruin: scorching and cracks, then holes and a
       collapsed corner, then the fires (drawn separately, on top). */
    battleDamage: function (ctx, b, w, h, H) {
      var frac = b.hp / b.maxHp;
      if (frac > 0.75) return;
      var gx = -w / 2, gy = -h / 2, seed = b.id * 17;
      ctx.save();

      // soot over the roof and wall
      ctx.fillStyle = 'rgba(24,20,14,' + ((0.75 - frac) * 0.7).toFixed(3) + ')';
      ctx.fillRect(gx, gy - H, w, h);
      ctx.fillRect(gx, gy + h - H, w, H);

      // cracks
      ctx.strokeStyle = 'rgba(18,15,10,0.65)';
      ctx.lineWidth = 1.6;
      for (var c = 0; c < 3; c++) {
        var cx0 = gx + ((seed * (c + 3) * 13) % (w - 10)) + 5;
        var cy0 = gy - H + ((seed * (c + 2) * 7) % (h - 10)) + 5;
        ctx.beginPath();
        ctx.moveTo(cx0, cy0);
        ctx.lineTo(cx0 + 7, cy0 + 9);
        ctx.lineTo(cx0 + 3, cy0 + 17);
        ctx.stroke();
      }

      if (frac < 0.45) {
        // blown-out holes in the roof
        for (var k = 0; k < 3; k++) {
          var hx = gx + ((seed * (k + 5) * 11) % (w - 20)) + 10;
          var hy = gy - H + ((seed * (k + 4) * 19) % (h - 20)) + 10;
          ctx.fillStyle = '#15140e';
          ctx.beginPath(); ctx.ellipse(hx, hy, 7 + k, 5 + k * 0.6, k, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(90,78,58,0.7)';
          ctx.beginPath(); ctx.ellipse(hx - 1, hy - 2, 7 + k, 2.4, k, 0, 6.283); ctx.fill();
        }
        // rubble spilling out at the base
        ctx.fillStyle = 'rgba(78,70,56,0.85)';
        for (var rb = 0; rb < 6; rb++) {
          ctx.fillRect(gx + ((seed * (rb + 2) * 23) % (w - 8)), gy + h - 3, 7, 5);
        }
      }

      if (frac < 0.25) {
        // a corner has come down entirely
        ctx.fillStyle = '#1b1912';
        ctx.beginPath();
        ctx.moveTo(gx + w, gy - H);
        ctx.lineTo(gx + w - w * 0.36, gy - H);
        ctx.lineTo(gx + w, gy - H + h * 0.42);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(96,86,68,0.8)';
        ctx.fillRect(gx + w - w * 0.3, gy + h - 6, w * 0.3, 8);
      }
      ctx.restore();
    },

    scaffold: function (ctx, b, w, h, H) {
      var gx = -w / 2, gy = -h / 2;
      ctx.fillStyle = 'rgba(12,14,10,0.50)';
      ctx.fillRect(gx, gy - H, w, h + H);
      ctx.strokeStyle = '#e2c46a'; ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(gx + 2, gy - H + 2, w - 4, h + H - 4);
      ctx.setLineDash([]);
      // crane arm
      ctx.strokeStyle = '#c9a53f'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gx + 6, gy + h);
      ctx.lineTo(gx + 6, gy - H - 14);
      ctx.lineTo(gx + w * 0.55, gy - H - 14);
      ctx.stroke();
      var bw = w - 18;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(-bw / 2, -4, bw, 11);
      ctx.fillStyle = '#e2c46a';
      ctx.fillRect(-bw / 2 + 1, -3, (bw - 2) * b.progress, 9);
      ctx.fillStyle = '#12160f';
      ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(Math.round(b.progress * 100) + '%', 0, 5);
    },

    emplacement: function (ctx, b, H) {
      ctx.save();
      ctx.translate(0, -H);
      ctx.fillStyle = '#3c4137';
      ctx.beginPath(); ctx.arc(0, 0, 13, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#4d5346';
      ctx.beginPath(); ctx.arc(-1, -1.5, 10, 0, 6.283); ctx.fill();
      ctx.rotate(b.turret);
      var rec = (b.recoil > 0 ? b.recoil : 0) * 5;
      ctx.fillStyle = '#23261f';
      if (b.type === 'aagun') { ctx.fillRect(-rec, -5, 22, 3.4); ctx.fillRect(-rec, 2, 22, 3.4); }
      else if (b.type === 'atgun') { ctx.fillRect(-rec, -2.6, 28, 5.2); }
      else { ctx.fillRect(-rec, -2.2, 15, 4.4); }
      ctx.restore();
    },

    /* Rooftop clutter. Antennas, vents, tanks — this is most of what makes a
       building look like a building rather than a coloured rectangle. */
    roofDetail: function (ctx, b, f, w, h, H, g) {
      var t = b.type, gy = -h / 2 - H;
      ctx.save();
      ctx.translate(0, -H);

      function box(x, y, bw, bh, col, hi) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x + 3, y + 3, bw, bh);
        ctx.fillStyle = col;
        ctx.fillRect(x, y, bw, bh);
        ctx.fillStyle = hi || 'rgba(255,244,206,0.18)';
        ctx.fillRect(x, y, bw, 2.5);
      }
      function mast(x, y, len) {
        ctx.strokeStyle = '#2a2e26'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - len); ctx.stroke();
        ctx.fillStyle = '#d0452f';
        ctx.beginPath(); ctx.arc(x, y - len, 2.2, 0, 6.283); ctx.fill();
      }

      if (t === 'hq') {
        box(-20, -20, 40, 40, '#5a636a');
        box(-11, -11, 22, 22, '#6d777e');
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.beginPath(); ctx.arc(-2.5, -2.5, 3.4, 0, 6.283); ctx.fill();
        mast(-24, -18, 26);
        mast(24, -18, 20);
        // flag
        ctx.fillStyle = f.color; ctx.fillRect(24, -40, 16, 10);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(24, -35, 16, 2);
      } else if (t === 'power') {
        ctx.fillStyle = '#2e3238';
        ctx.beginPath(); ctx.ellipse(-9, -4, 11, 10, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.ellipse(10, 9, 9, 8, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#787f86';
        ctx.beginPath(); ctx.ellipse(-9, -5, 7, 6, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.ellipse(10, 8, 5.5, 5, 0, 0, 6.283); ctx.fill();
        // steam
        var pf = (g.time * 0.6) % 1;
        ctx.fillStyle = 'rgba(220,224,220,' + (0.30 * (1 - pf)).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(-9, -12 - pf * 16, 5 + pf * 7, 0, 6.283); ctx.fill();
      } else if (t === 'depot') {
        for (var i = 0; i < 4; i++) box(-20 + (i % 2) * 21, -14 + Math.floor(i / 2) * 19, 17, 15, PAL.supply, 'rgba(255,255,255,0.30)');
      } else if (t === 'refinery') {
        ctx.fillStyle = '#333c38';
        ctx.beginPath(); ctx.ellipse(-11, 0, 13, 12, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#465049';
        ctx.beginPath(); ctx.ellipse(-11, -1.5, 10, 9, 0, 0, 6.283); ctx.fill();
        box(6, -12, 14, 24, '#3f4a44');
        ctx.strokeStyle = PAL.fuel; ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(13, 0); ctx.stroke();
        mast(18, -12, 16);
      } else if (t === 'barracks') {
        box(-18, -12, 36, 10, '#4d5348');
        box(-8, 4, 16, 12, '#3c4238');
        ctx.fillStyle = f.color; ctx.fillRect(-5, 7, 10, 9);
        for (var v = 0; v < 3; v++) box(-16 + v * 13, -22, 8, 6, '#5a6055');
      } else if (t === 'factory') {
        for (var s = 0; s < 4; s++) {
          ctx.fillStyle = s % 2 ? '#5b646a' : '#4a5258';
          ctx.beginPath();
          ctx.moveTo(-28 + s * 15, 16); ctx.lineTo(-21 + s * 15, -14);
          ctx.lineTo(-14 + s * 15, 16);
          ctx.closePath(); ctx.fill();
        }
        box(-13, 12, 26, 12, '#33383c');
        ctx.fillStyle = '#d0452f'; ctx.fillRect(-13, 12, 26, 2.5);
      } else if (t === 'airfield') {
        ctx.fillStyle = '#3f444a';
        ctx.fillRect(-b.w / 2 + 5, -11, b.w - 10, 24);
        ctx.strokeStyle = 'rgba(236,230,206,0.75)'; ctx.lineWidth = 2.5;
        ctx.setLineDash([11, 8]);
        ctx.beginPath(); ctx.moveTo(-b.w / 2 + 10, 1); ctx.lineTo(b.w / 2 - 10, 1); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = f.color;
        ctx.fillRect(-b.w / 2 + 7, -13, 5, 4); ctx.fillRect(b.w / 2 - 12, 11, 5, 4);
      } else if (t === 'lab') {
        ctx.fillStyle = '#48525c';
        ctx.beginPath(); ctx.ellipse(0, 0, 16, 14, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#9fd6e6';
        ctx.beginPath(); ctx.ellipse(-1.5, -2, 11, 9, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.ellipse(-5, -5, 4, 3, 0, 0, 6.283); ctx.fill();
        mast(16, -8, 18);
      } else if (t === 'radar') {
        ctx.fillStyle = '#3c444b';
        ctx.beginPath(); ctx.ellipse(0, 4, 14, 6, 0, 0, 6.283); ctx.fill();
        ctx.save();
        ctx.translate(0, -2);
        ctx.rotate(g.time * 1.1);
        ctx.fillStyle = '#8d97a0';
        ctx.beginPath(); ctx.ellipse(0, 0, 15, 5, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#5d666e';
        ctx.beginPath(); ctx.ellipse(0, 1.5, 15, 3, 0, 0, 6.283); ctx.fill();
        ctx.restore();
        mast(-16, 6, 14);
      } else if (t === 'bunker') {
        ctx.fillStyle = '#4a5145';
        ctx.beginPath();
        ctx.moveTo(-16, -7); ctx.lineTo(16, -7); ctx.lineTo(20, 8); ctx.lineTo(-20, 8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#171a15'; ctx.fillRect(-13, -3, 26, 5);
        // sandbags
        ctx.fillStyle = '#8b7f5f';
        for (var sb = 0; sb < 5; sb++) {
          ctx.beginPath(); ctx.ellipse(-18 + sb * 9, 11, 5.5, 3.4, 0, 0, 6.283); ctx.fill();
        }
      }
      ctx.restore();
    },

    fires: function (ctx, b, g, H) {
      var frac = b.hp / b.maxHp;
      if (frac > 0.5) return;
      var n = frac < 0.25 ? 4 : 2;
      ctx.save();
      ctx.translate(b.x, b.y - H);
      for (var i = 0; i < n; i++) {
        var seed = b.id * 7 + i * 31;
        var fx2 = ((seed * 13) % 100) / 100 * (b.w - 18) - (b.w - 18) / 2;
        var fy2 = ((seed * 29) % 100) / 100 * (b.h - 18) - (b.h - 18) / 2;
        var fl = 0.6 + 0.4 * Math.sin(g.time * 11 + i * 2.1);
        var hgt = 10 + fl * 9;
        var gr = ctx.createRadialGradient(fx2, fy2 - hgt * 0.3, 0, fx2, fy2 - hgt * 0.3, hgt);
        gr.addColorStop(0, 'rgba(255,238,170,0.95)');
        gr.addColorStop(0.4, 'rgba(244,142,42,0.80)');
        gr.addColorStop(1, 'rgba(170,55,18,0)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.ellipse(fx2, fy2 - hgt * 0.3, hgt * 0.55, hgt, 0, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    },

    /* ----------------------------------------------------------- units */
    drawUnit: function (ctx, u, g) {
      var f = g.players[u.owner].faction;
      if (u.armor === 'infantry') this.drawInfantry(ctx, u, f, g);
      else this.drawVehicle(ctx, u, f, g);
      this.healthBar(ctx, u, u.x, u.y - u.rad - 15, Math.max(20, u.rad * 2.4), g);
      if (u.rank > 0) this.chevrons(ctx, u);
      if (u.chute > 0) this.parachute(ctx, u);
    },

    chevrons: function (ctx, u) {
      var y = u.y - u.rad - 21, n = u.rank;
      ctx.save();
      ctx.strokeStyle = n >= 2 ? '#f5d879' : '#e2ddc6';
      ctx.lineWidth = 1.8;
      for (var i = 0; i < n; i++) {
        var yy = y - i * 4;
        ctx.beginPath();
        ctx.moveTo(u.x - 4.5, yy + 2); ctx.lineTo(u.x, yy - 1.4); ctx.lineTo(u.x + 4.5, yy + 2);
        ctx.stroke();
      }
      ctx.restore();
    },

    parachute: function (ctx, u) {
      var lift = u.chute * 30;
      ctx.save();
      ctx.translate(u.x, u.y - lift);
      ctx.globalAlpha = Math.min(1, u.chute * 1.6);
      ctx.strokeStyle = '#cfcab4'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-12, -15); ctx.lineTo(0, lift); ctx.lineTo(12, -15); ctx.stroke();
      ctx.fillStyle = '#ddd8c1';
      ctx.beginPath(); ctx.arc(0, -15, 15, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath(); ctx.arc(0, -15, 15, Math.PI * 1.5, 0); ctx.fill();
      ctx.restore();
    },

    /* ------------------------------------------------------------------
       INFANTRY
       Each infantry counter is drawn as an actual squad — a rifle squad is
       three men, a gun team is two — and men drop out of the drawing as the
       unit takes casualties. They stride when moving and go down on one knee
       when firing, which is what makes a firing line read as a firing line.
       ------------------------------------------------------------------ */
    SQUAD: { rifle: 3, mg: 2, at_inf: 2, sniper: 1, engineer: 1 },
    FORMATION: [[0, 0], [-8, 6], [7, 7], [-2, -7]],

    drawInfantry: function (ctx, u, f, g) {
      var full = this.SQUAD[u.type] || 1;
      var alive = Math.max(1, Math.ceil(full * IF.clamp(u.hp / u.maxHp, 0.01, 1)));
      var moving = g && (g.time - (u.lastMoveT || -9)) < 0.2;
      var firing = !moving && (u.recoil > 0.01 || (u.autoTarget && !u.autoTarget.dead));
      var cos = Math.cos(u.facing), sin = Math.sin(u.facing);

      for (var m = 0; m < alive; m++) {
        var o = this.FORMATION[m % this.FORMATION.length];
        var ox = o[0] * cos - o[1] * sin;
        var oy = o[0] * sin + o[1] * cos;
        this.soldier(ctx, u, f, u.x + ox * 0.85, u.y + oy * 0.85, m, moving, firing, g);
      }
    },

    soldier: function (ctx, u, f, x, y, seat, moving, firing, g) {
      var coat = f.id === 'legion' ? '#6a5642' : '#5c6740';
      var coatLo = f.id === 'legion' ? '#4a3c2d' : '#3f492a';
      var ink = 'rgba(12,12,9,0.62)';
      var phase = (u.walk || 0) + seat * 1.9;
      var ph = moving ? Math.sin(phase) : 0;
      var crouch = firing ? 1.6 : 0;
      var lift = 5 + (moving ? Math.abs(Math.cos(phase)) * 0.9 : 0) - crouch;

      // shadow on the ground
      ctx.save();
      ctx.fillStyle = 'rgba(26,24,16,0.34)';
      ctx.beginPath(); ctx.ellipse(x + 3, y + 2.5, 5.4, 3, 0, 0, 6.283); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(x, y - lift);
      ctx.rotate(u.facing + Math.PI / 2);

      // legs
      ctx.fillStyle = coatLo;
      ctx.save(); ctx.translate(-2.2, 2.2 - crouch * 0.4); ctx.rotate(ph * 0.55);
      ctx.fillRect(-1.2, 0, 2.4, 4.6 - crouch); ctx.restore();
      ctx.save(); ctx.translate(2.2, 2.2 - crouch * 0.4); ctx.rotate(-ph * 0.55);
      ctx.fillRect(-1.2, 0, 2.4, 4.6 - crouch); ctx.restore();

      // webbing and pack
      ctx.fillStyle = coatLo;
      ctx.beginPath(); ctx.ellipse(0, 3.4, 3.9, 2.5, 0, 0, 6.283); ctx.fill();

      // torso
      ctx.fillStyle = coat;
      ctx.beginPath(); ctx.ellipse(0, 0.4, 4.3, 5.2 - crouch * 0.5, 0, 0, 6.283); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,244,206,0.20)';
      ctx.beginPath(); ctx.ellipse(-1.3, -1.6, 2.4, 2.3, 0, 0, 6.283); ctx.fill();

      // helmet, with the team colour on the crown so friend and foe read fast
      ctx.fillStyle = f.dark;
      ctx.beginPath(); ctx.arc(0, -2.4 + crouch * 0.3, 3.7, 0, 6.283); ctx.fill();
      ctx.strokeStyle = ink; ctx.stroke();
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(0, -2.4 + crouch * 0.3, 2.2, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(-1.2, -3.4 + crouch * 0.3, 1.1, 0, 6.283); ctx.fill();
      ctx.restore();

      // weapon, aimed independently of the body
      ctx.save();
      ctx.translate(x, y - lift);
      ctx.rotate(u.turret);
      var rc = (u.recoil > 0 ? u.recoil : 0) * 2.4;
      ctx.strokeStyle = '#1e211a'; ctx.lineWidth = 1.9;
      ctx.beginPath(); ctx.moveTo(1 - rc, 0);
      var len = u.type === 'sniper' ? 13 : (u.type === 'at_inf' ? 12 : 9);
      ctx.lineTo(len - rc, 0); ctx.stroke();

      if (u.type === 'mg') {
        ctx.fillStyle = '#1e211a';
        ctx.fillRect(4 - rc, -3.2, 3.6, 6.4);
        if (firing) {   // bipod goes down when the gun is in action
          ctx.strokeStyle = '#242820'; ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(8, 0); ctx.lineTo(11, -4); ctx.moveTo(8, 0); ctx.lineTo(11, 4);
          ctx.stroke();
        }
      }
      if (u.type === 'at_inf') {
        ctx.fillStyle = '#3d4335';
        ctx.fillRect(4 - rc, -3, 9, 6);
        ctx.fillStyle = '#22261d';
        ctx.beginPath(); ctx.arc(13.5 - rc, 0, 2.6, 0, 6.283); ctx.fill();
      }
      if (u.type === 'sniper') { ctx.fillStyle = '#2c3128'; ctx.fillRect(4 - rc, -2.8, 4.5, 1.9); }
      if (u.type === 'engineer') {
        ctx.fillStyle = '#e2c46a'; ctx.fillRect(1, -2.4, 5, 4.8);
        ctx.fillStyle = '#8a6f2c'; ctx.fillRect(1, -0.4, 5, 1.2);
      }
      ctx.restore();
    },

    /* ------------------------------------------------------------------
       VEHICLES
       Every type has its own hull proportions, running gear and turret so
       you can tell a light tank from a heavy at a glance, without reading
       a label. Weathering, stowage and a commander in the hatch do the rest.
       ------------------------------------------------------------------ */
    drawVehicle: function (ctx, u, f, g) {
      var legion = f.id === 'legion';
      var lift = 6;
      var t = u.type;
      var hull = legion ? '#6b6049' : '#5e6a44';
      var hullHi = legion ? '#847860' : '#7b8a58';
      var hullLo = legion ? '#463d2d' : '#3b4429';
      var ink = 'rgba(14,14,10,0.66)';

      // proportions per type
      var spec = {
        light:     { L: 1.80, W: 1.28, bogies: 4, turret: 0.70, gun: 1.55, skirt: 0 },
        medium:    { L: 1.95, W: 1.40, bogies: 5, turret: 0.76, gun: 1.75, skirt: 0 },
        heavy:     { L: 2.10, W: 1.58, bogies: 6, turret: 0.86, gun: 2.10, skirt: 1 },
        halftrack: { L: 1.95, W: 1.30, bogies: 3, turret: 0, gun: 0, skirt: 0 },
        artillery: { L: 1.95, W: 1.36, bogies: 5, turret: 0, gun: 2.60, skirt: 0 },
        truck:     { L: 1.90, W: 1.24, bogies: 0, turret: 0, gun: 0, skirt: 0 },
        tanker:    { L: 1.95, W: 1.28, bogies: 0, turret: 0, gun: 0, skirt: 0 }
      }[t] || { L: 1.9, W: 1.35, bogies: 5, turret: 0.74, gun: 1.7, skirt: 0 };

      var L = u.rad * spec.L, W = u.rad * spec.W;

      ctx.save();
      ctx.translate(u.x, u.y - lift);
      ctx.rotate(u.facing);

      /* ---- wheeled supply vehicles ---- */
      if (u.def.harvest) {
        ctx.fillStyle = '#15170f';
        for (var wq = 0; wq < 3; wq++) {
          var wxp = -L / 2 + 4 + wq * (L - 10) / 2;
          ctx.beginPath(); ctx.ellipse(wxp, -W / 2 - 1.4, 3.2, 2.2, 0, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.ellipse(wxp, W / 2 + 1.4, 3.2, 2.2, 0, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = hull;
        ctx.fillRect(-L / 2, -W / 2, L, W);
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.strokeRect(-L / 2, -W / 2, L, W);
        ctx.fillStyle = hullHi;
        ctx.fillRect(-L / 2 + 1.5, -W / 2 + 1.5, L - 3, W * 0.40);

        if (t === 'tanker') {
          ctx.fillStyle = '#3c463f';
          ctx.beginPath(); ctx.ellipse(-2, 0, L * 0.31, W * 0.44, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,244,206,0.24)';
          ctx.beginPath(); ctx.ellipse(-2, -W * 0.15, L * 0.27, W * 0.15, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#2c332e';
          ctx.fillRect(-L * 0.34, -1.4, 3, 2.8);
        } else {
          // canvas tilt over the load bed
          ctx.fillStyle = u.carry > 0 ? PAL.supply : '#6b7059';
          ctx.fillRect(-L / 2 + 2, -W / 2 + 2, L * 0.52, W - 4);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          for (var hoop = 0; hoop < 3; hoop++) ctx.fillRect(-L / 2 + 5 + hoop * L * 0.15, -W / 2 + 2, 1.6, W - 4);
        }
        // cab
        ctx.fillStyle = f.dark;
        ctx.fillRect(L / 2 - 8, -W / 2, 8, W);
        ctx.fillStyle = 'rgba(160,200,220,0.45)';
        ctx.fillRect(L / 2 - 7, -W / 2 + 1.5, 2.4, W - 3);
        ctx.fillStyle = f.color;
        ctx.fillRect(-L / 2 + 2, W / 2 - 4, 10, 3);
        ctx.restore();
        return;
      }

      /* ---- running gear ---- */
      if (t === 'halftrack') {
        ctx.fillStyle = '#15170f';
        ctx.beginPath(); ctx.ellipse(L / 2 - 5, -W / 2 - 1.2, 3.4, 2.4, 0, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.ellipse(L / 2 - 5, W / 2 + 1.2, 3.4, 2.4, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#1d201a';
        ctx.fillRect(-L / 2, -W / 2 - 3, L * 0.55, 4);
        ctx.fillRect(-L / 2, W / 2 - 1, L * 0.55, 4);
      } else {
        ctx.fillStyle = '#1d201a';
        ctx.fillRect(-L / 2, -W / 2 - 3, L, 4);
        ctx.fillRect(-L / 2, W / 2 - 1, L, 4);
        // individual road wheels showing through the track run
        ctx.fillStyle = 'rgba(120,120,104,0.30)';
        for (var bg = 0; bg < spec.bogies; bg++) {
          var bx = -L / 2 + 3.5 + bg * (L - 7) / Math.max(1, spec.bogies - 1);
          ctx.beginPath(); ctx.arc(bx, -W / 2 - 1, 1.7, 0, 6.283); ctx.fill();
          ctx.beginPath(); ctx.arc(bx, W / 2 + 1, 1.7, 0, 6.283); ctx.fill();
        }
        // the link pattern scrolls with distance travelled, so the tracks
        // visibly turn over as the tank drives
        var roll = ((u.walk || 0) * 5) % 5;
        ctx.fillStyle = 'rgba(255,255,255,0.11)';
        for (var lk = -5; lk < L; lk += 5) {
          var lx = -L / 2 + lk + roll;
          if (lx < -L / 2 || lx > L / 2 - 2) continue;
          ctx.fillRect(lx, -W / 2 - 3, 2.2, 4);
          ctx.fillRect(lx, W / 2 - 1, 2.2, 4);
        }
      }

      /* ---- hull ---- */
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(-L / 2, -W / 2);
      ctx.lineTo(L / 2 - 4, -W / 2 + 1.5);
      ctx.lineTo(L / 2, 0);
      ctx.lineTo(L / 2 - 4, W / 2 - 1.5);
      ctx.lineTo(-L / 2, W / 2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.stroke();

      ctx.fillStyle = hullHi;
      ctx.fillRect(-L / 2 + 2, -W / 2 + 2, L - 7, W * 0.34);
      ctx.fillStyle = hullLo;
      ctx.fillRect(-L / 2 + 2, W / 2 - W * 0.26, L - 7, W * 0.22);

      // side skirts on the heavy
      if (spec.skirt) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(-L / 2 + 2, -W / 2 - 3.5, L - 6, 2);
        ctx.fillRect(-L / 2 + 2, W / 2 + 1.5, L - 6, 2);
      }

      // spare track links bolted to the glacis, stowage bins, exhaust
      ctx.fillStyle = '#3f3a2c';
      for (var sl = 0; sl < 3; sl++) ctx.fillRect(L / 2 - 9 + sl * 2.4, -2.6, 1.8, 5.2);
      ctx.fillStyle = '#4a4436';
      ctx.fillRect(-L / 2 + 1.5, -W / 2 + 1.5, 5, 3.2);
      ctx.fillRect(-L / 2 + 1.5, W / 2 - 4.5, 5, 3.2);
      ctx.fillStyle = '#26251d';
      ctx.fillRect(-L / 2 - 1.5, -2.2, 3.5, 4.4);
      ctx.fillStyle = 'rgba(160,200,220,0.30)';
      ctx.fillRect(L / 2 - 6, -2.4, 2.4, 4.8);

      // mud and dust caked along the lower hull
      ctx.fillStyle = 'rgba(96,82,54,0.30)';
      ctx.fillRect(-L / 2 + 2, W / 2 - 3, L - 6, 2.6);

      // team colour panel
      ctx.fillStyle = f.color;
      ctx.fillRect(-L / 2 + 2, W / 2 - 5.2, 11, 3.4);
      ctx.fillStyle = f.light;
      ctx.fillRect(-L / 2 + 2, W / 2 - 5.2, 11, 1.1);

      // whip antenna
      ctx.strokeStyle = 'rgba(20,20,14,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-L / 2 + 6, -W / 2 + 2); ctx.lineTo(-L / 2 + 1, -W / 2 - 9); ctx.stroke();
      ctx.restore();

      /* ---- turret / superstructure ---- */
      ctx.save();
      ctx.translate(u.x, u.y - lift - 3);
      ctx.rotate(u.turret);
      var rec = (u.recoil > 0 ? u.recoil : 0);

      if (t === 'halftrack') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-3, -3, 10, 10);
        ctx.fillStyle = '#3b4137'; ctx.fillRect(-5, -5, 10, 10);
        ctx.strokeStyle = ink; ctx.lineWidth = 1; ctx.strokeRect(-5, -5, 10, 10);
        ctx.fillStyle = 'rgba(255,244,206,0.18)'; ctx.fillRect(-5, -5, 10, 2.6);
        // crew heads over the open top
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.arc(-1.5, -1.5, 1.9, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(1.5, 2, 1.9, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#1e211a'; ctx.fillRect(4 - rec * 3, -1.2, 13, 2.4);

      } else if (t === 'artillery') {
        ctx.fillStyle = '#3f463a'; ctx.fillRect(-8, -6, 14, 12);
        ctx.strokeStyle = ink; ctx.lineWidth = 1.1; ctx.strokeRect(-8, -6, 14, 12);
        ctx.fillStyle = 'rgba(255,244,206,0.18)'; ctx.fillRect(-8, -6, 14, 3);
        ctx.fillStyle = '#2d3229';
        ctx.fillRect(-13, -10, 5, 20);                        // recoil spade
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.arc(-3, -2, 1.9, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(-3, 2.5, 1.9, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#1e211a';
        ctx.fillRect(2 - rec * 8, -2.3, u.rad * spec.gun, 4.6);
        ctx.fillRect(2 + u.rad * spec.gun - rec * 8, -3.4, 5, 6.8);   // muzzle brake

      } else {
        var tr = u.rad * spec.turret;
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        ctx.beginPath(); ctx.arc(1.5, 2.5, tr, 0, 6.283); ctx.fill();

        ctx.fillStyle = legion ? '#77694f' : '#6d7a4e';
        if (t === 'heavy') {                       // slab-sided casemate turret
          ctx.beginPath();
          ctx.moveTo(-tr, -tr * 0.86); ctx.lineTo(tr * 0.75, -tr * 0.72);
          ctx.lineTo(tr, 0); ctx.lineTo(tr * 0.75, tr * 0.72);
          ctx.lineTo(-tr, tr * 0.86);
          ctx.closePath(); ctx.fill();
        } else if (t === 'medium') {               // angular, faceted
          ctx.beginPath();
          ctx.moveTo(-tr * 0.9, -tr * 0.75); ctx.lineTo(tr * 0.55, -tr * 0.85);
          ctx.lineTo(tr, 0); ctx.lineTo(tr * 0.55, tr * 0.85);
          ctx.lineTo(-tr * 0.9, tr * 0.75);
          ctx.closePath(); ctx.fill();
        } else {                                   // light: small and round
          ctx.beginPath(); ctx.arc(0, 0, tr, 0, 6.283); ctx.fill();
        }
        ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.stroke();

        ctx.fillStyle = 'rgba(255,244,206,0.22)';
        ctx.beginPath(); ctx.arc(-1, -1.6, tr * 0.78, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.arc(0, 2, tr * 0.55, 0, Math.PI); ctx.fill();

        // commander's hatch, and his head if the tank is buttoned up on the move
        ctx.fillStyle = '#3a4036';
        ctx.beginPath(); ctx.arc(-tr * 0.34, -tr * 0.30, tr * 0.30, 0, 6.283); ctx.fill();
        ctx.fillStyle = f.dark;
        ctx.beginPath(); ctx.arc(-tr * 0.34, -tr * 0.30, tr * 0.17, 0, 6.283); ctx.fill();

        // smoke dischargers
        ctx.fillStyle = '#2b2f26';
        ctx.fillRect(-tr * 0.2, -tr - 1.2, 4.5, 2.2);

        // mantlet and gun
        ctx.fillStyle = '#2c3129';
        ctx.fillRect(tr - 3, -4.2, 5.5, 8.4);
        ctx.fillStyle = '#1e211a';
        ctx.fillRect(tr - 2 - rec * 4, -2.1, u.rad * spec.gun, 4.2);
        if (t !== 'light') {                        // muzzle brake on the bigger guns
          ctx.fillRect(tr - 2 + u.rad * spec.gun - rec * 4, -3.2, 5, 6.4);
        }
      }
      ctx.restore();
    },

    /* ------------------------------------------------------------------
       AIRCRAFT
       Three clearly different machines: a slim single-engine fighter, a
       heavy ground-attack aircraft with rockets slung under the wings, and
       a twin-engine bomber. All carry national markings.
       ------------------------------------------------------------------ */
    drawPlane: function (ctx, a, g) {
      var f = g.players[a.owner].faction;
      var alt = 46;

      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.translate(a.x + 15, a.y + alt);
      ctx.rotate(a.facing);
      ctx.scale(0.94, 0.94);
      this.planeShape(ctx, a, '#000', '#000', f, true);
      ctx.restore();

      ctx.save();
      ctx.translate(a.x, a.y - alt * 0.15);
      ctx.rotate(a.facing);
      ctx.scale(1, Math.max(0.38, Math.cos(a.bank || 0)));
      this.planeShape(ctx, a, f.id === 'legion' ? '#6a6049' : '#5b6742', f.color, f, false);
      ctx.restore();

      // propellers
      ctx.save();
      ctx.translate(a.x, a.y - alt * 0.15);
      ctx.rotate(a.facing);
      var spin = (g.time * 42) % 6.283;
      var props = a.type === 'bomber' ? [[a.rad * 0.30, -a.rad * 0.75], [a.rad * 0.30, a.rad * 0.75]]
                                      : [[a.rad * 1.35, 0]];
      for (var pi = 0; pi < props.length; pi++) {
        var px = props[pi][0], py = props[pi][1];
        var pr = a.type === 'bomber' ? a.rad * 0.42 : a.rad * 0.72;
        ctx.globalAlpha = 0.26;
        ctx.fillStyle = '#d8dad2';
        ctx.beginPath(); ctx.ellipse(px, py, 1.8, pr, 0, 0, 6.283); ctx.fill();
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#9aa09a'; ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(px, py - Math.cos(spin + pi) * pr);
        ctx.lineTo(px, py + Math.cos(spin + pi) * pr);
        ctx.stroke();
      }
      ctx.restore();

      if (a.hp < a.maxHp * 0.5 && Math.random() < 0.45) {
        IF.fx.smoke(g, a.x - Math.cos(a.facing) * a.rad, a.y - Math.sin(a.facing) * a.rad - alt * 0.15, IF.rand(5, 9));
      }

      this.healthBar(ctx, a, a.x, a.y - a.rad - 18, a.rad * 2.2, g);
    },

    planeShape: function (ctx, a, body, accent, f, flat) {
      var s = a.rad / 13;
      var bomber = a.type === 'bomber';
      var attacker = a.type === 'attacker';
      var span = bomber ? 21 : (attacker ? 18 : 16);
      var chord = bomber ? 9 : (attacker ? 8.5 : 7);

      // fuselage
      ctx.fillStyle = body;
      ctx.beginPath();
      if (bomber) {
        ctx.moveTo(19 * s, 0); ctx.lineTo(7 * s, -5 * s); ctx.lineTo(-15 * s, -4 * s);
        ctx.lineTo(-19 * s, 0); ctx.lineTo(-15 * s, 4 * s); ctx.lineTo(7 * s, 5 * s);
      } else {
        ctx.moveTo(17 * s, 0); ctx.lineTo(5 * s, -4.2 * s); ctx.lineTo(-14 * s, -3.2 * s);
        ctx.lineTo(-17 * s, 0); ctx.lineTo(-14 * s, 3.2 * s); ctx.lineTo(5 * s, 4.2 * s);
      }
      ctx.closePath(); ctx.fill();

      // main wing and tailplane
      ctx.fillRect(-4 * s, -span * s, chord * s, span * 2 * s);
      ctx.fillRect(-15.5 * s, -8.5 * s, 5 * s, 17 * s);
      if (bomber) {                       // twin fins
        ctx.fillRect(-17 * s, -10 * s, 4 * s, 5 * s);
        ctx.fillRect(-17 * s, 5 * s, 4 * s, 5 * s);
      }

      if (!flat) {
        // engine nacelles
        if (bomber) {
          ctx.fillStyle = body;
          ctx.fillRect(-2 * s, -9.5 * s, 10 * s, 5 * s);
          ctx.fillRect(-2 * s, 4.5 * s, 10 * s, 5 * s);
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          ctx.fillRect(-2 * s, -9.5 * s, 10 * s, 1.6 * s);
          ctx.fillRect(-2 * s, 4.5 * s, 10 * s, 1.6 * s);
        }
        // rockets under the attacker's wings
        if (attacker) {
          ctx.fillStyle = '#2a2c24';
          for (var r = 0; r < 2; r++) {
            var ry = (r ? 1 : -1) * 12 * s;
            ctx.fillRect(-1 * s, ry - 1.2 * s, 9 * s, 2.4 * s);
            ctx.fillRect(-1 * s, ry + 2.4 * s, 9 * s, 2.4 * s);
          }
        }
        // lighting
        ctx.fillStyle = 'rgba(255,244,206,0.24)';
        ctx.fillRect(-4 * s, -span * s, chord * s, 3 * s);
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        ctx.fillRect(-4 * s, (span - 3) * s, chord * s, 3 * s);
        // canopy
        ctx.fillStyle = '#9fd6e6';
        ctx.beginPath(); ctx.ellipse(bomber ? 9 * s : 6 * s, 0, 3.4 * s, 2.3 * s, 0, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath(); ctx.ellipse(bomber ? 10 * s : 7 * s, -0.7 * s, 1.4 * s, 0.9 * s, 0, 0, 6.283); ctx.fill();

        // national markings: a roundel for one side, a cross for the other
        for (var w = 0; w < 2; w++) {
          var my = (w ? 1 : -1) * (span - 5) * s;
          if (f.id === 'alliance') {
            ctx.fillStyle = accent;
            ctx.beginPath(); ctx.arc(0.5 * s, my, 2.8 * s, 0, 6.283); ctx.fill();
            ctx.fillStyle = '#efe9d6';
            ctx.beginPath(); ctx.arc(0.5 * s, my, 1.5 * s, 0, 6.283); ctx.fill();
          } else {
            ctx.fillStyle = accent;
            ctx.fillRect(-2 * s, my - 0.9 * s, 5 * s, 1.8 * s);
            ctx.fillRect(-0.1 * s, my - 2.6 * s, 1.8 * s, 5.2 * s);
          }
        }
      } else {
        ctx.fillStyle = body;
        if (bomber) { ctx.fillRect(-2 * s, -9.5 * s, 10 * s, 5 * s); ctx.fillRect(-2 * s, 4.5 * s, 10 * s, 5 * s); }
      }
    },

    /* ----------------------------------------------------- everything else */
    drawDecals: function (g, ctx) {
      for (var i = 0; i < g.decals.length; i++) {
        var d = g.decals[i];
        if (!this.onScreen(g, d.x, d.y, d.r + 40)) continue;
        ctx.save();
        ctx.translate(d.x, d.y);
        if (d.type === 'scorch') {
          ctx.globalAlpha = 0.45;
          var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, d.r);
          gr.addColorStop(0, 'rgba(18,15,10,0.95)');
          gr.addColorStop(0.6, 'rgba(30,24,16,0.55)');
          gr.addColorStop(1, 'rgba(30,24,16,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 6.283); ctx.fill();
        } else if (d.type === 'crater') {
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = '#3a3427';
          ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.72, d.rot, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#221e16';
          ctx.beginPath(); ctx.ellipse(1, 1.5, d.r * 0.66, d.r * 0.44, d.rot, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(196,182,142,0.40)';
          ctx.beginPath(); ctx.ellipse(-1, -d.r * 0.28, d.r * 0.8, d.r * 0.30, d.rot, 0, 6.283); ctx.fill();
        } else if (d.type === 'track') {
          ctx.globalAlpha = Math.max(0, 1 - d.age / d.life) * 0.30;
          ctx.rotate(d.facing || 0);
          ctx.fillStyle = '#4e4531';
          var tw = d.r * 1.6;
          ctx.fillRect(-tw / 2, -d.r * 0.64, tw, 2.6);
          ctx.fillRect(-tw / 2, d.r * 0.38, tw, 2.6);
        } else if (d.type === 'body') {
          ctx.globalAlpha = Math.max(0, 1 - d.age / d.life) * 0.75;
          ctx.rotate(d.facing || 0);
          ctx.fillStyle = 'rgba(20,18,12,0.4)';
          ctx.beginPath(); ctx.ellipse(1.5, 1.5, 7, 3.6, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#3f4438';
          ctx.beginPath(); ctx.ellipse(0, 0, 6, 3.2, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#2d3229';
          ctx.beginPath(); ctx.arc(-5, 0, 2.6, 0, 6.283); ctx.fill();
        } else if (d.type === 'wreck') {
          ctx.globalAlpha = Math.max(0, 1 - d.age / d.life) * 0.92;
          ctx.fillStyle = 'rgba(20,18,12,0.5)';
          ctx.beginPath(); ctx.ellipse(3, 3, d.r * 1.1, d.r * 0.7, 0, 0, 6.283); ctx.fill();
          ctx.rotate(d.facing || 0);
          var L = d.r * 1.9, W2 = d.r * 1.35;
          ctx.fillStyle = '#2a2a20';
          ctx.fillRect(-L / 2, -W2 / 2, L, W2);
          ctx.fillStyle = '#17170f';
          ctx.fillRect(-L / 2 + 3, -W2 / 2 + 2, L - 6, W2 - 4);
          if (d.age < 14) {
            var fl2 = 0.5 + 0.5 * Math.sin(g.time * 9 + d.x);
            var fg = ctx.createRadialGradient(0, 0, 0, 0, 0, 10 + fl2 * 6);
            fg.addColorStop(0, 'rgba(255,226,150,0.85)');
            fg.addColorStop(0.5, 'rgba(238,126,40,0.6)');
            fg.addColorStop(1, 'rgba(160,50,16,0)');
            ctx.fillStyle = fg;
            ctx.beginPath(); ctx.arc(0, 0, 10 + fl2 * 6, 0, 6.283); ctx.fill();
          }
          if (d.kindW === 'tank') {
            ctx.fillStyle = '#33332a';
            ctx.beginPath(); ctx.arc(1, 0, d.r * 0.58, 0, 6.283); ctx.fill();
            ctx.fillStyle = '#17170f';
            ctx.fillRect(d.r * 0.5, -1.6, d.r * 1.5, 3.2);
          }
        }
        ctx.restore();
      }
    },

    drawNodes: function (g, ctx) {
      for (var i = 0; i < g.map.nodes.length; i++) {
        var n = g.map.nodes[i];
        if (!this.onScreen(g, n.x, n.y, 70)) continue;
        var frac = n.amount / n.max;
        ctx.save();
        ctx.translate(n.x, n.y);

        if (n.type === 'supplies') {
          var boxes = Math.max(1, Math.round(frac * 6));
          for (var b = 0; b < boxes; b++) {
            var bx = -24 + (b % 3) * 17, by = -14 + Math.floor(b / 3) * 17;
            ctx.fillStyle = PAL.shadow;
            ctx.fillRect(bx + 5, by + 5, 15, 15);
            ctx.fillStyle = '#a8802c';
            ctx.fillRect(bx, by, 15, 15);
            ctx.fillStyle = PAL.supply;
            ctx.fillRect(bx, by, 15, 11);
            ctx.fillStyle = 'rgba(255,255,255,0.28)';
            ctx.fillRect(bx, by, 15, 3);
            ctx.fillStyle = 'rgba(0,0,0,0.30)';
            ctx.fillRect(bx, by + 6, 15, 2);
          }
        } else {
          ctx.fillStyle = PAL.shadow;
          ctx.beginPath(); ctx.ellipse(9, 8, 26, 11, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#39413c';
          ctx.fillRect(-18, 2, 36, 9);
          ctx.fillStyle = '#4b544d';
          ctx.fillRect(-18, 2, 36, 3);
          ctx.fillStyle = '#2b322f';
          ctx.fillRect(-4.5, -34, 9, 38);
          ctx.fillStyle = '#3d4642';
          ctx.fillRect(-4.5, -34, 3.5, 38);
          ctx.fillStyle = PAL.fuel;
          ctx.beginPath(); ctx.arc(0, -37, 8, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.30)';
          ctx.beginPath(); ctx.arc(-2.5, -39, 3, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(-18, 2, 36 * (1 - frac), 9);
        }
        ctx.restore();
      }
    },

    drawProjectiles: function (g, ctx) {
      for (var i = 0; i < g.projectiles.length; i++) {
        var p = g.projectiles[i];
        if (!this.onScreen(g, p.x, p.y, 40)) continue;
        var z = p.z || 0;
        if (p.kindP === 'bomb') {
          ctx.fillStyle = 'rgba(0,0,0,0.28)';
          ctx.beginPath(); ctx.ellipse(p.x, p.y + 8, 4, 2.4, 0, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#2c2e24';
          ctx.beginPath(); ctx.ellipse(p.x, p.y - z, 3.2, 4.4, 0, 0, 6.283); ctx.fill();
        } else if (p.kindP === 'rocket') {
          var a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
          ctx.strokeStyle = 'rgba(255,196,120,0.85)'; ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(a) * 13, p.y - Math.sin(a) * 13 - z);
          ctx.lineTo(p.x, p.y - z); ctx.stroke();
          ctx.fillStyle = '#fff3cf';
          ctx.beginPath(); ctx.arc(p.x, p.y - z, 2.4, 0, 6.283); ctx.fill();
        } else {
          if (z > 2) {
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.beginPath(); ctx.ellipse(p.x, p.y, 2.4, 1.4, 0, 0, 6.283); ctx.fill();
          }
          ctx.fillStyle = '#ffeeb4';
          ctx.beginPath(); ctx.arc(p.x, p.y - z, 2.6, 0, 6.283); ctx.fill();
        }
      }
    },

    drawEffects: function (g, ctx, above) {
      for (var i = 0; i < g.effects.length; i++) {
        var e = g.effects[i];
        var k = e.age / e.life;
        var isAbove = (e.t === 'smoke' || e.t === 'text');
        if (isAbove !== above) continue;
        if (!this.onScreen(g, e.x, e.y, 110)) continue;
        ctx.save();
        switch (e.t) {
          case 'muzzle':
            ctx.globalAlpha = 1 - k;
            ctx.translate(e.x, e.y); ctx.rotate(e.a);
            var mg = ctx.createRadialGradient(6, 0, 0, 6, 0, 17);
            mg.addColorStop(0, 'rgba(255,247,210,0.95)');
            mg.addColorStop(0.5, 'rgba(255,182,74,0.65)');
            mg.addColorStop(1, 'rgba(255,150,40,0)');
            ctx.fillStyle = mg;
            ctx.beginPath(); ctx.arc(6, 0, 17, 0, 6.283); ctx.fill();
            ctx.fillStyle = 'rgba(255,244,190,0.95)';
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13, -4.5); ctx.lineTo(18, 0); ctx.lineTo(13, 4.5);
            ctx.closePath(); ctx.fill();
            break;
          case 'tracer':
            ctx.globalAlpha = (1 - k) * 0.95;
            ctx.strokeStyle = e.col; ctx.lineWidth = 1.8;
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
            ctx.globalAlpha = (1 - k) * 0.28;
            ctx.lineWidth = 4.5;
            ctx.stroke();
            break;
          case 'ring':
            ctx.globalAlpha = (1 - k) * 0.55;
            ctx.strokeStyle = 'rgba(255,236,196,0.9)';
            ctx.lineWidth = Math.max(1, 5 * (1 - k));
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.5 + k * 2.8), 0, 6.283); ctx.stroke();
            break;
          case 'dring':
            ctx.globalAlpha = (1 - k) * 0.34;
            ctx.strokeStyle = '#c9b78e';
            ctx.lineWidth = Math.max(1.5, 9 * (1 - k));
            ctx.beginPath();
            ctx.ellipse(e.x, e.y, e.r * (0.3 + k * 2.2), e.r * (0.3 + k * 2.2) * 0.42, 0, 0, 6.283);
            ctx.stroke();
            break;
          case 'boom':
            if (e.delay && e.age < e.delay) break;
            ctx.globalAlpha = 1 - k;
            var ry = e.y - (e.rise || 0) * k;
            var r = e.r * (0.4 + k * 1.6);
            var grd = ctx.createRadialGradient(e.x, ry, 0, e.x, ry, r);
            grd.addColorStop(0, 'rgba(255,248,214,0.98)');
            grd.addColorStop(0.32, 'rgba(255,178,60,0.85)');
            grd.addColorStop(0.7, 'rgba(196,72,26,0.55)');
            grd.addColorStop(1, 'rgba(80,34,16,0)');
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(e.x, ry, r, 0, 6.283); ctx.fill();
            break;
          case 'mark':
            var mk = 1 - k;
            ctx.globalAlpha = mk;
            ctx.translate(e.x, e.y);
            if (e.kind === 'attack') {
              ctx.strokeStyle = '#e8613a'; ctx.lineWidth = 2.4;
              var ms = 16 - k * 5;
              ctx.beginPath();
              ctx.moveTo(-ms, -ms + 6); ctx.lineTo(-ms, -ms); ctx.lineTo(-ms + 6, -ms);
              ctx.moveTo(ms - 6, -ms); ctx.lineTo(ms, -ms); ctx.lineTo(ms, -ms + 6);
              ctx.moveTo(ms, ms - 6); ctx.lineTo(ms, ms); ctx.lineTo(ms - 6, ms);
              ctx.moveTo(-ms + 6, ms); ctx.lineTo(-ms, ms); ctx.lineTo(-ms, ms - 6);
              ctx.stroke();
            } else {
              ctx.strokeStyle = '#b6e055'; ctx.lineWidth = 2.2;
              var sc = 1 + k * 0.7;
              ctx.beginPath();
              ctx.ellipse(0, 2, 13 * sc, 7 * sc, 0, 0, 6.283);
              ctx.stroke();
              ctx.beginPath();
              ctx.moveTo(-6, -8 + k * 5); ctx.lineTo(0, -2 + k * 5); ctx.lineTo(6, -8 + k * 5);
              ctx.stroke();
            }
            break;
          case 'trail':
            ctx.globalAlpha = (1 - k) * 0.26;
            ctx.fillStyle = '#e6ebec';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + k * 1.8), 0, 6.283); ctx.fill();
            break;
          case 'chunk':
            ctx.globalAlpha = Math.min(1, (1 - k) * 1.6);
            ctx.translate(e.x, e.y - (e.z || 0));
            ctx.rotate(e.rot + e.age * e.spin);
            ctx.fillStyle = e.brass ? (k < 0.6 ? '#e0b95c' : '#8a6f2c') : (k < 0.5 ? '#57503f' : '#3b362b');
            ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size * 0.7);
            break;
          case 'spark':
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = k < 0.35 ? '#fff0b4' : (k < 0.7 ? '#e8853a' : '#8c4a22');
            ctx.fillRect(e.x, e.y, e.size, e.size);
            break;
          case 'dust':
            ctx.globalAlpha = (1 - k) * 0.32;
            ctx.fillStyle = '#c4b795';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + k * 1.4), 0, 6.283); ctx.fill();
            break;
          case 'smoke':
            ctx.globalAlpha = (1 - k) * 0.42;
            ctx.fillStyle = k < 0.3 ? '#4a453d' : '#5d574d';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.283); ctx.fill();
            break;
          case 'text':
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(e.str, e.x + 1, e.y + 1);
            ctx.fillStyle = e.col;
            ctx.fillText(e.str, e.x, e.y);
            break;
        }
        ctx.restore();
      }
    },

    healthBar: function (ctx, e, x, y, w, g) {
      var hurt = e.hp < e.maxHp - 0.5;
      var sel = g.selection.indexOf(e) >= 0;
      if (!hurt && !sel) return;
      var frac = IF.clamp(e.hp / e.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(x - w / 2 - 1.5, y - 1.5, w + 3, 6);
      ctx.fillStyle = frac > 0.6 ? '#79c05a' : (frac > 0.3 ? '#e0b13c' : '#cf4a34');
      ctx.fillRect(x - w / 2, y, w * frac, 3.5);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x - w / 2, y, w * frac, 1.2);
    },

    drawFog: function (g, ctx) {
      var tex = g.fog.texture();
      if (!tex || !g.fog.enabled) return;
      var x0 = Math.max(0, Math.floor(g.cam.x / T) - 1);
      var y0 = Math.max(0, Math.floor(g.cam.y / T) - 1);
      var x1 = Math.min(g.map.w, Math.ceil((g.cam.x + g.viewW) / T) + 1);
      var y1 = Math.min(g.map.h, Math.ceil((g.cam.y + g.viewH) / T) + 1);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tex, x0, y0, x1 - x0, y1 - y0, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T);
      ctx.restore();
    },

    drawSelection: function (g, ctx) {
      var pulse = 1.5 + 0.5 * Math.sin(g.time * 4);
      for (var i = 0; i < g.selection.length; i++) {
        var e = g.selection[i];
        if (e.dead) continue;
        ctx.save();
        ctx.strokeStyle = '#b6e055';
        ctx.lineWidth = pulse;
        if (e.kind === 'building') {
          var w = e.w / 2 + 5, h = e.h / 2 + 5, c = 11;
          ctx.beginPath();
          ctx.moveTo(e.x - w, e.y - h + c); ctx.lineTo(e.x - w, e.y - h); ctx.lineTo(e.x - w + c, e.y - h);
          ctx.moveTo(e.x + w - c, e.y - h); ctx.lineTo(e.x + w, e.y - h); ctx.lineTo(e.x + w, e.y - h + c);
          ctx.moveTo(e.x + w, e.y + h - c); ctx.lineTo(e.x + w, e.y + h); ctx.lineTo(e.x + w - c, e.y + h);
          ctx.moveTo(e.x - w + c, e.y + h); ctx.lineTo(e.x - w, e.y + h); ctx.lineTo(e.x - w, e.y + h - c);
          ctx.stroke();
          if (e.rally) {
            ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(182,224,85,0.5)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.rally.x, e.rally.y); ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#b6e055'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(e.rally.x, e.rally.y); ctx.lineTo(e.rally.x, e.rally.y - 22); ctx.stroke();
            ctx.fillStyle = '#b6e055';
            ctx.beginPath();
            ctx.moveTo(e.rally.x, e.rally.y - 22);
            ctx.lineTo(e.rally.x + 14, e.rally.y - 18);
            ctx.lineTo(e.rally.x, e.rally.y - 13);
            ctx.closePath(); ctx.fill();
          }
        } else {
          // a decal on the ground, like the ring under a Generals unit
          ctx.fillStyle = 'rgba(182,224,85,0.13)';
          ctx.beginPath();
          ctx.ellipse(e.x, e.y + 2, e.rad + 7, (e.rad + 7) * 0.62, 0, 0, 6.283);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(e.x, e.y + 2, e.rad + 7, (e.rad + 7) * 0.62, 0, 0, 6.283);
          ctx.stroke();
          if (e.def.domain === 'air') {
            ctx.strokeStyle = 'rgba(182,224,85,0.30)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + 14, e.y - 46); ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (g.dragBox) {
        var d = g.dragBox;
        ctx.save();
        ctx.strokeStyle = '#b6e055'; ctx.lineWidth = 1.2;
        ctx.fillStyle = 'rgba(182,224,85,0.10)';
        var bx = Math.min(d.x0, d.x1), by = Math.min(d.y0, d.y1);
        var bw = Math.abs(d.x1 - d.x0), bh = Math.abs(d.y1 - d.y0);
        ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx + 0.5, by + 0.5, bw, bh);
        ctx.restore();
      }
    },

    drawPlacement: function (g, ctx) {
      if (!g.placing) return;
      var def = IF.BUILDINGS[g.placing.type];
      var tx = g.placing.tx, ty = g.placing.ty;
      var ok = g.canPlaceForPlayer(0, g.placing.type, tx, ty) && g.canAfford(0, def.cost);
      var H = HEIGHT[g.placing.type] || 24;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ok ? 'rgba(150,210,110,0.5)' : 'rgba(215,80,58,0.5)';
      ctx.fillRect(tx * T, ty * T - H, def.w * T, def.h * T + H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#b6e055' : '#e06a52';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx * T + 1, ty * T + 1, def.w * T - 2, def.h * T - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      for (var gx = 1; gx < def.w; gx++) { ctx.beginPath(); ctx.moveTo((tx + gx) * T, ty * T); ctx.lineTo((tx + gx) * T, (ty + def.h) * T); ctx.stroke(); }
      for (var gy = 1; gy < def.h; gy++) { ctx.beginPath(); ctx.moveTo(tx * T, (ty + gy) * T); ctx.lineTo((tx + def.w) * T, (ty + gy) * T); ctx.stroke(); }
      ctx.restore();
    },

    drawTargeting: function (g, ctx) {
      if (!g.targeting) return;
      var d = IF.POWERS[g.targeting];
      var r = d.radius || d.splash || 120;
      var mx = IF.input.mouse.worldX, my = IF.input.mouse.worldY;
      ctx.save();
      ctx.fillStyle = 'rgba(226,196,106,0.08)';
      ctx.beginPath(); ctx.arc(mx, my, r, 0, 6.283); ctx.fill();
      ctx.strokeStyle = '#e2c46a'; ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(mx, my, r, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(mx - r - 16, my); ctx.lineTo(mx - r + 8, my);
      ctx.moveTo(mx + r - 8, my); ctx.lineTo(mx + r + 16, my);
      ctx.moveTo(mx, my - r - 16); ctx.lineTo(mx, my - r + 8);
      ctx.moveTo(mx, my + r - 8); ctx.lineTo(mx, my + r + 16);
      ctx.stroke();
      ctx.fillStyle = '#e2c46a';
      ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.name.toUpperCase(), mx, my - r - 24);
      ctx.restore();
    },

    /* Names on the battlefield: whatever the cursor is over gets a clean
       label, so you never have to guess what a shape is. */
    hoverLabel: function (g, ctx) {
      var e = IF.input.hover;
      if (!e || e.dead) return;
      var name = e.def ? e.def.name : '';
      if (!name) return;
      var friendly = e.owner === 0;
      var sub = friendly ? '' : 'ENEMY';
      if (e.kind === 'unit' && e.rank > 0) sub = (sub ? sub + ' · ' : '') + IF.RANKS[e.rank].name;

      var lift = e.kind === 'building' ? (HEIGHT[e.type] || 24) + e.h / 2 + 22 : e.rad + 30;
      var x = e.x, y = e.y - lift;

      ctx.save();
      ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      var wName = ctx.measureText(name).width;
      var wSub = sub ? ctx.measureText(sub).width * 0.82 : 0;
      var boxW = Math.max(wName, wSub) + 18;
      var boxH = sub ? 34 : 22;

      ctx.fillStyle = 'rgba(10,13,9,0.88)';
      ctx.strokeStyle = friendly ? 'rgba(182,224,85,0.75)' : 'rgba(200,84,47,0.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - boxW / 2, y - boxH + 4, boxW, boxH, 3);
      else ctx.rect(x - boxW / 2, y - boxH + 4, boxW, boxH);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = '#efeada';
      ctx.fillText(name, x, y - (sub ? 12 : 2));
      if (sub) {
        ctx.font = '600 10px ui-monospace, Menlo, monospace';
        ctx.fillStyle = friendly ? '#b6e055' : '#e8916f';
        ctx.fillText(sub, x, y + 1);
      }
      ctx.restore();
    },

    postFx: function (g, ctx) {
      var w = this.cw, h = this.ch;
      if (!this._vig) {
        var gr = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.36, w / 2, h * 0.45, Math.max(w, h) * 0.80);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(6,8,5,0.28)');
        this._vig = gr;
      }
      ctx.save();

      /* Colour grade: a warm sunlit top falling to cool shadow at the
         bottom, laid over the whole image. This is what pulls the terrain,
         the units and the effects into looking like one photograph rather
         than a set of separate drawings. */
      if (!this._grade) {
        var gg = ctx.createLinearGradient(0, 0, 0, h);
        gg.addColorStop(0,    'rgba(255,214,150,0.20)');
        gg.addColorStop(0.45, 'rgba(255,236,196,0.06)');
        gg.addColorStop(1,    'rgba(46,58,86,0.22)');
        this._grade = gg;
      }
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = this._grade;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      /* Battlefield haze drifting across the view. */
      if (this.quality === 'low') { ctx.fillStyle = this._vig; ctx.fillRect(0, 0, w, h); ctx.restore(); return; }
      var t1 = g.time * 9, t2 = g.time * 5.5;
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#d8c39a';
      ctx.beginPath();
      ctx.ellipse((t1 % (w + 900)) - 450, h * 0.42, 460, 110, 0, 0, 6.283);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w - ((t2 % (w + 700)) - 350), h * 0.68, 380, 80, 0, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = this._vig;
      ctx.fillRect(0, 0, w, h);

      // Attack-move stays armed until you click, so say so plainly.
      if (IF.input.attackMove) {
        var label = 'ATTACK-MOVE — click a destination  (Esc to cancel)';
        ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        var tw = ctx.measureText(label).width + 26;
        ctx.fillStyle = 'rgba(10,13,9,0.90)';
        ctx.strokeStyle = '#d0452f'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(w / 2 - tw / 2, h - 56, tw, 30, 3);
        else ctx.rect(w / 2 - tw / 2, h - 56, tw, 30);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#f0d9c6';
        ctx.fillText(label, w / 2, h - 36);
      }
      var since = g.time - (g._alertAt || -99);
      if (since < 2.2) {
        var pulse = Math.abs(Math.sin(since * 5)) * (1 - since / 2.2);
        ctx.strokeStyle = 'rgba(200,70,40,' + (pulse * 0.75).toFixed(3) + ')';
        ctx.lineWidth = 16;
        ctx.strokeRect(8, 8, w - 16, h - 16);
      }
      ctx.restore();
    },

    /* -------------------------------------------------------- minimap */
    drawMinimap: function (g) {
      var ctx = this.mctx;
      var w = this.mini.clientWidth, h = this.mini.clientHeight;
      var sx = w / g.map.pxW, sy = h / g.map.pxH;
      ctx.clearRect(0, 0, w, h);

      if (!g.hasRadar(0)) {
        ctx.fillStyle = '#10140e'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(140,150,120,0.18)';
        for (var n0 = 0; n0 < 220; n0++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1.5);
        ctx.fillStyle = '#c2542f';
        ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('RADAR OFFLINE', w / 2, h / 2);
        return;
      }

      if (!this._miniBase || this._miniDirty) {
        this._miniBase = document.createElement('canvas');
        this._miniBase.width = g.map.w; this._miniBase.height = g.map.h;
        var bc = this._miniBase.getContext('2d');
        var img = bc.createImageData(g.map.w, g.map.h);
        var cols = {};
        cols[IF.T.FIELD] = [121, 129, 74]; cols[IF.T.ROAD] = [125, 115, 96];
        cols[IF.T.FOREST] = [70, 89, 47]; cols[IF.T.WATER] = [47, 84, 104];
        cols[IF.T.BRIDGE] = [150, 125, 84]; cols[IF.T.RUBBLE] = [107, 99, 80];
        cols[IF.T.RUIN] = [123, 115, 97];
        for (var i = 0; i < g.map.tiles.length; i++) {
          var c = cols[g.map.tiles[i]] || cols[IF.T.FIELD];
          img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
        }
        bc.putImageData(img, 0, 0);
        this._miniDirty = false;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._miniBase, 0, 0, w, h);

      var n;
      for (n = 0; n < g.map.nodes.length; n++) {
        var nd = g.map.nodes[n];
        if (nd.amount <= 0 || !g.fog.exploredAt(nd.x, nd.y)) continue;
        ctx.fillStyle = nd.type === 'supplies' ? PAL.supply : PAL.fuel;
        ctx.fillRect(nd.x * sx - 2, nd.y * sy - 2, 4, 4);
      }
      for (n = 0; n < g.buildings.length; n++) {
        var b = g.buildings[n];
        if (b.dead) continue;
        if (b.owner !== 0 && !g.fog.exploredAt(b.x, b.y)) continue;
        ctx.fillStyle = g.players[b.owner].faction.color;
        ctx.fillRect(b.x * sx - b.w * sx / 2, b.y * sy - b.h * sy / 2, Math.max(3, b.w * sx), Math.max(3, b.h * sy));
      }
      for (n = 0; n < g.units.length; n++) {
        var u = g.units[n];
        if (u.dead) continue;
        if (u.owner !== 0 && !g.fog.visibleAt(u.x, u.y)) continue;
        ctx.fillStyle = g.players[u.owner].faction.light;
        ctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2.5, 2.5);
      }

      var ang = (g.time * 1.1) % 6.283;
      var cx = w / 2, cy = h / 2, rad = Math.max(w, h);
      var sweep = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      sweep.addColorStop(0, 'rgba(150,220,150,0.22)');
      sweep.addColorStop(1, 'rgba(150,220,150,0)');
      ctx.save();
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rad, ang - 0.5, ang);
      ctx.closePath();
      ctx.fillStyle = sweep; ctx.fill();
      ctx.restore();

      ctx.strokeStyle = '#e8e2cc'; ctx.lineWidth = 1;
      ctx.strokeRect(g.cam.x * sx, g.cam.y * sy, g.viewW * sx, g.viewH * sy);
    }
  };

  IF.render = R;
})(window.IF);

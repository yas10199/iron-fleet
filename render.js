/* IRON FRONT — render.js
   Everything is drawn with canvas paths, so the game ships with no image
   files. Swap any draw* function for a sprite later without touching logic. */
(function (IF) {
  'use strict';

  var T = IF.TILE;

  var PAL = {
    field: '#6e7a4c', fieldAlt: '#77834f', fieldDark: '#5f6a42',
    road: '#7a7160', roadEdge: '#5d5648',
    forest: '#2f4a2c', forestTop: '#3d6036',
    water: '#2f5468', waterLite: '#3d6b83',
    bridge: '#8a7350', bridgeDark: '#5e4e35',
    shore: '#8d8460', foam: 'rgba(190,215,225,0.5)', deep: '#25455a',
    rubble: '#575344', ruin: '#736b5c', ruinDark: '#4d4740',
    supply: '#d4ab48', fuel: '#4f8f6d'
  };

  var R = {
    canvas: null, ctx: null, mini: null, mctx: null,
    miniTimer: 0,

    init: function (canvas, mini) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.mini = mini;
      this.mctx = mini.getContext('2d');
      this.resize();
    },

    resize: function () {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.dpr = dpr;
      this.cw = w; this.ch = h;
      if (IF.game) {
        var z = IF.game.cam.zoom || 1;
        IF.game.viewW = w / z; IF.game.viewH = h / z;
      }
      this.mini.width = this.mini.clientWidth * dpr;
      this.mini.height = this.mini.clientHeight * dpr;
      this.mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },

    /* ================================================================ */
    draw: function (g, dt) {
      var ctx = this.ctx;
      var z = g.cam.zoom || 1;
      g.viewW = this.cw / z; g.viewH = this.ch / z;

      ctx.save();
      ctx.clearRect(0, 0, this.cw, this.ch);
      ctx.scale(z, z);
      ctx.translate(-Math.round(g.cam.x) + (g.shakeX || 0), -Math.round(g.cam.y) + (g.shakeY || 0));

      this.drawTerrain(g, ctx);
      this.groundWash(g, ctx);
      this.drawDecals(g, ctx);
      this.drawNodes(g, ctx);

      var fog = g.fog, i, b;

      // ruins first, then live buildings
      for (i = 0; i < g.buildings.length; i++) {
        b = g.buildings[i];
        if (!b.dead) continue;
        if (b.owner !== 0 && !fog.exploredAt(b.x, b.y)) continue;
        this.drawRuin(ctx, b);
      }
      for (i = 0; i < g.buildings.length; i++) {
        b = g.buildings[i];
        if (b.dead) continue;
        if (b.owner !== 0) {
          if (!fog.exploredAt(b.x, b.y)) continue;
          // Seen once, but not watched now: draw it as a memory, no health bar.
          if (!fog.canSee(b)) { ctx.save(); ctx.globalAlpha = 0.72; this.drawBuilding(ctx, b, g, true); ctx.restore(); continue; }
        }
        this.drawBuilding(ctx, b, g, false);
      }

      for (i = 0; i < g.units.length; i++) {
        var u = g.units[i];
        if (u.dead || u.def.domain === 'air') continue;
        if (u.owner !== 0 && !fog.visibleAt(u.x, u.y)) continue;
        if (!this.onScreen(g, u.x, u.y, 40)) continue;
        this.drawUnit(ctx, u, g);
      }

      this.drawEffects(g, ctx, false);

      for (i = 0; i < g.units.length; i++) {
        var a = g.units[i];
        if (a.dead || a.def.domain !== 'air') continue;
        if (a.astate === 'rearm') continue;
        if (a.owner !== 0 && !fog.visibleAt(a.x, a.y)) continue;
        if (!this.onScreen(g, a.x, a.y, 60)) continue;
        this.drawPlane(ctx, a, g);
      }

      this.drawProjectiles(g, ctx);
      this.drawEffects(g, ctx, true);
      this.drawFog(g, ctx);
      this.drawSelection(g, ctx);
      this.drawPlacement(g, ctx);
      this.drawTargeting(g, ctx);

      ctx.restore();
      this.postFx(g, ctx);

      this.miniTimer -= dt;
      if (this.miniTimer <= 0) { this.miniTimer = 0.12; this.drawMinimap(g); }
    },

    /* Screen-space finish: a vignette to pull the eye to the middle, and a
       red pulse round the edge when the base is being hit. */
    postFx: function (g, ctx) {
      var w = this.cw, h = this.ch;
      if (!this._vig || this._vigW !== w || this._vigH !== h) {
        this._vigW = w; this._vigH = h;
        var gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.78);
        gr.addColorStop(0, 'rgba(0,0,0,0)');
        gr.addColorStop(1, 'rgba(4,7,4,0.46)');
        this._vig = gr;
      }
      ctx.save();
      ctx.fillStyle = this._vig;
      ctx.fillRect(0, 0, w, h);

      var since = g.time - (g._alertAt || -99);
      if (since < 2.2) {
        var pulse = Math.abs(Math.sin(since * 5)) * (1 - since / 2.2);
        ctx.strokeStyle = 'rgba(194,84,47,' + (pulse * 0.7).toFixed(3) + ')';
        ctx.lineWidth = 14;
        ctx.strokeRect(7, 7, w - 14, h - 14);
      }
      ctx.restore();
    },

    drawFog: function (g, ctx) {
      var tex = g.fog.texture();
      if (!tex || !g.fog.enabled) return;
      var T2 = IF.TILE;
      var x0 = Math.max(0, Math.floor(g.cam.x / T2) - 1);
      var y0 = Math.max(0, Math.floor(g.cam.y / T2) - 1);
      var x1 = Math.min(g.map.w, Math.ceil((g.cam.x + g.viewW) / T2) + 1);
      var y1 = Math.min(g.map.h, Math.ceil((g.cam.y + g.viewH) / T2) + 1);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tex, x0, y0, x1 - x0, y1 - y0, x0 * T2, y0 * T2, (x1 - x0) * T2, (y1 - y0) * T2);
      ctx.restore();
    },

    /* A big soft blotch pattern laid over the tiles. Costs one fill per frame
       and stops the ground reading as a grid of flat squares. */
    groundWash: function (g, ctx) {
      if (!this._wash) {
        var c = document.createElement('canvas');
        c.width = c.height = 256;
        var w = c.getContext('2d');
        w.fillStyle = '#808080'; w.fillRect(0, 0, 256, 256);
        for (var i = 0; i < 90; i++) {
          var x = Math.random() * 256, y = Math.random() * 256, r = 18 + Math.random() * 60;
          var gr = w.createRadialGradient(x, y, 0, x, y, r);
          var dark = Math.random() < 0.5;
          gr.addColorStop(0, dark ? 'rgba(40,44,30,0.42)' : 'rgba(190,196,150,0.30)');
          gr.addColorStop(1, 'rgba(128,128,128,0)');
          w.fillStyle = gr;
          w.beginPath(); w.arc(x, y, r, 0, 6.283); w.fill();
        }
        this._wash = ctx.createPattern(c, 'repeat');
      }
      if (!this._wash) return;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = this._wash;
      ctx.fillRect(g.cam.x - 40, g.cam.y - 40, g.viewW + 80, g.viewH + 80);
      ctx.restore();
    },

    drawDecals: function (g, ctx) {
      for (var i = 0; i < g.decals.length; i++) {
        var d = g.decals[i];
        if (!this.onScreen(g, d.x, d.y, d.r + 30)) continue;
        ctx.save();
        ctx.translate(d.x, d.y);
        if (d.type === 'scorch') {
          ctx.globalAlpha = 0.42;
          var gr = ctx.createRadialGradient(0, 0, 0, 0, 0, d.r);
          gr.addColorStop(0, 'rgba(20,16,12,0.95)');
          gr.addColorStop(1, 'rgba(20,16,12,0)');
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 6.283); ctx.fill();
        } else if (d.type === 'crater') {
          ctx.globalAlpha = 0.55;
          ctx.fillStyle = '#2e2a20';
          ctx.beginPath(); ctx.ellipse(0, 0, d.r, d.r * 0.75, d.rot, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(150,140,110,0.35)';
          ctx.beginPath(); ctx.ellipse(0, -2, d.r * 0.72, d.r * 0.5, d.rot, 0, 6.283); ctx.fill();
        } else if (d.type === 'track') {
          ctx.globalAlpha = Math.max(0, 1 - d.age / d.life) * 0.30;
          ctx.rotate(d.facing || 0);
          ctx.fillStyle = '#4a4534';
          var tw = d.r * 1.5;
          ctx.fillRect(-tw / 2, -d.r * 0.62, tw, 2.4);
          ctx.fillRect(-tw / 2, d.r * 0.38, tw, 2.4);
        } else if (d.type === 'wreck') {
          ctx.globalAlpha = Math.max(0, 1 - d.age / d.life) * 0.9;
          ctx.rotate(d.facing || 0);
          var L = d.r * 1.8, W2 = d.r * 1.3;
          ctx.fillStyle = '#23241d';
          ctx.fillRect(-L / 2, -W2 / 2, L, W2);
          ctx.fillStyle = '#141510';
          ctx.fillRect(-L / 2 + 3, -W2 / 2 + 2, L - 6, W2 - 4);
          if (d.kindW === 'tank') {
            ctx.fillStyle = '#2b2c23';
            ctx.beginPath(); ctx.arc(1, 0, d.r * 0.55, 0, 6.283); ctx.fill();
          }
        }
        ctx.restore();
      }
    },

    drawTargeting: function (g, ctx) {
      if (!g.targeting) return;
      var d = IF.POWERS[g.targeting];
      var r = d.radius || d.splash || 120;
      var mx = IF.input.mouse.worldX, my = IF.input.mouse.worldY;
      ctx.save();
      ctx.strokeStyle = '#e2c46a'; ctx.lineWidth = 2;
      ctx.setLineDash([9, 7]);
      ctx.beginPath(); ctx.arc(mx, my, r, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(mx - r - 14, my); ctx.lineTo(mx - r + 6, my);
      ctx.moveTo(mx + r - 6, my); ctx.lineTo(mx + r + 14, my);
      ctx.moveTo(mx, my - r - 14); ctx.lineTo(mx, my - r + 6);
      ctx.moveTo(mx, my + r - 6); ctx.lineTo(mx, my + r + 14);
      ctx.stroke();
      ctx.fillStyle = '#e2c46a';
      ctx.font = 'bold 13px ui-monospace, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.name.toUpperCase(), mx, my - r - 22);
      ctx.restore();
    },

    onScreen: function (g, x, y, pad) {
      return x > g.cam.x - pad && x < g.cam.x + g.viewW + pad &&
             y > g.cam.y - pad && y < g.cam.y + g.viewH + pad;
    },

    /* ------------------------------------------------------- terrain */
    drawTerrain: function (g, ctx) {
      var map = g.map;
      var x0 = Math.max(0, Math.floor(g.cam.x / T) - 1);
      var y0 = Math.max(0, Math.floor(g.cam.y / T) - 1);
      var x1 = Math.min(map.w - 1, Math.floor((g.cam.x + g.viewW) / T) + 1);
      var y1 = Math.min(map.h - 1, Math.floor((g.cam.y + g.viewH) / T) + 1);

      for (var ty = y0; ty <= y1; ty++) {
        for (var tx = x0; tx <= x1; tx++) {
          var i = ty * map.w + tx, t = map.tiles[i], d = map.detail[i];
          var px = tx * T, py = ty * T;

          switch (t) {
            case IF.T.WATER:
              ctx.fillStyle = PAL.water; ctx.fillRect(px, py, T, T);
              // deeper in the middle of the channel
              if (this.isWater(map, tx - 1, ty) && this.isWater(map, tx + 1, ty)) {
                ctx.fillStyle = PAL.deep; ctx.fillRect(px, py, T, T);
              }
              // shimmer that actually moves
              var ph = Math.sin(g.time * 1.6 + tx * 0.7 + ty * 0.4);
              if (d < 3) {
                ctx.strokeStyle = 'rgba(140,180,200,' + (0.18 + 0.16 * (ph + 1) / 2).toFixed(3) + ')';
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                var wy = py + 9 + d * 7 + ph * 2.5;
                ctx.moveTo(px + 3, wy);
                ctx.quadraticCurveTo(px + 16, wy - 4, px + 29, wy);
                ctx.stroke();
              }
              // foam where the bank meets the river
              ctx.fillStyle = PAL.foam;
              if (!this.isWater(map, tx, ty - 1)) ctx.fillRect(px, py, T, 2.5);
              if (!this.isWater(map, tx, ty + 1)) ctx.fillRect(px, py + T - 2.5, T, 2.5);
              if (!this.isWater(map, tx - 1, ty)) ctx.fillRect(px, py, 2.5, T);
              if (!this.isWater(map, tx + 1, ty)) ctx.fillRect(px + T - 2.5, py, 2.5, T);
              break;
            case IF.T.BRIDGE:
              ctx.fillStyle = PAL.bridge; ctx.fillRect(px, py, T, T);
              ctx.fillStyle = PAL.bridgeDark;
              for (var p = 0; p < T; p += 8) ctx.fillRect(px + p, py, 2, T);
              break;
            case IF.T.ROAD:
              ctx.fillStyle = PAL.road; ctx.fillRect(px, py, T, T);
              ctx.fillStyle = 'rgba(93,86,72,0.85)';
              if (!this.isRoad(map, tx, ty - 1)) ctx.fillRect(px, py, T, 3);
              if (!this.isRoad(map, tx, ty + 1)) ctx.fillRect(px, py + T - 3, T, 3);
              if (!this.isRoad(map, tx - 1, ty)) ctx.fillRect(px, py, 3, T);
              if (!this.isRoad(map, tx + 1, ty)) ctx.fillRect(px + T - 3, py, 3, T);
              ctx.fillStyle = PAL.roadEdge;
              if (d === 0) ctx.fillRect(px + 6, py + 12, 7, 3);
              if (d === 3) { ctx.fillStyle = 'rgba(60,55,45,0.5)'; ctx.fillRect(px + 18, py + 5, 9, 2); }
              break;
            case IF.T.FOREST:
              ctx.fillStyle = PAL.forest; ctx.fillRect(px, py, T, T);
              ctx.fillStyle = 'rgba(0,0,0,0.30)';
              ctx.beginPath();
              ctx.ellipse(px + 13 + d, py + 17, 9, 6, 0, 0, 6.283);
              ctx.ellipse(px + 25, py + 27 - d, 8, 5, 0, 0, 6.283);
              ctx.fill();
              ctx.fillStyle = PAL.forestTop;
              ctx.beginPath();
              ctx.arc(px + 10 + d, py + 12, 8, 0, 6.283);
              ctx.arc(px + 22, py + 22 - d, 7, 0, 6.283);
              ctx.fill();
              ctx.fillStyle = 'rgba(255,255,255,0.10)';
              ctx.beginPath();
              ctx.arc(px + 8 + d, py + 9, 3.5, 0, 6.283);
              ctx.fill();
              break;
            case IF.T.RUIN:
              ctx.fillStyle = PAL.ruin; ctx.fillRect(px, py, T, T);
              ctx.fillStyle = PAL.ruinDark;
              ctx.fillRect(px + 3, py + 3, T - 6, 5);
              ctx.fillRect(px + 3, py + 3, 5, T - 6);
              break;
            case IF.T.RUBBLE:
              ctx.fillStyle = PAL.rubble; ctx.fillRect(px, py, T, T);
              ctx.fillStyle = 'rgba(0,0,0,0.18)';
              ctx.fillRect(px + 4 + d, py + 7, 5, 4);
              ctx.fillRect(px + 18, py + 18 - d, 6, 5);
              break;
            default:
              ctx.fillStyle = (d % 3 === 0) ? PAL.fieldAlt : PAL.field;
              ctx.fillRect(px, py, T, T);
              if (d === 4) { ctx.fillStyle = PAL.fieldDark; ctx.fillRect(px + 12, py + 9, 8, 3); }
              if (this.nearWater(map, tx, ty)) {
                ctx.fillStyle = 'rgba(141,132,96,0.55)';
                if (this.isWater(map, tx, ty - 1)) ctx.fillRect(px, py, T, 7);
                if (this.isWater(map, tx, ty + 1)) ctx.fillRect(px, py + T - 7, T, 7);
                if (this.isWater(map, tx - 1, ty)) ctx.fillRect(px, py, 7, T);
                if (this.isWater(map, tx + 1, ty)) ctx.fillRect(px + T - 7, py, 7, T);
              }
              if (d === 1) {
                ctx.strokeStyle = 'rgba(120,134,84,0.7)'; ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px + 7, py + 24); ctx.lineTo(px + 9, py + 18);
                ctx.moveTo(px + 11, py + 24); ctx.lineTo(px + 12, py + 19);
                ctx.moveTo(px + 21, py + 12); ctx.lineTo(px + 23, py + 7);
                ctx.stroke();
              }
          }
        }
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

    drawNodes: function (g, ctx) {
      for (var i = 0; i < g.map.nodes.length; i++) {
        var n = g.map.nodes[i];
        if (!this.onScreen(g, n.x, n.y, 60)) continue;
        var frac = n.amount / n.max;
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(0, 8, 30, 14, 0, 0, 6.283); ctx.fill();

        if (n.type === 'supplies') {
          var boxes = Math.max(1, Math.round(frac * 6));
          for (var b = 0; b < boxes; b++) {
            var bx = -22 + (b % 3) * 16, by = -12 + Math.floor(b / 3) * 16;
            ctx.fillStyle = PAL.supply; ctx.fillRect(bx, by, 13, 13);
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(bx, by + 5, 13, 2);
            ctx.strokeStyle = '#8a6c22'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, 12, 12);
          }
        } else {
          ctx.fillStyle = '#2b3230';
          ctx.fillRect(-4, -26, 8, 34);
          ctx.fillRect(-16, 4, 32, 8);
          ctx.fillStyle = PAL.fuel;
          ctx.beginPath(); ctx.arc(0, -28, 7, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(-16, 4, 32 * (1 - frac), 8);
        }
        ctx.restore();
      }
    },

    /* ----------------------------------------------------- buildings */
    factionPal: function (g, owner) {
      var f = g.players[owner].faction;
      return f;
    },

    drawRuin: function (ctx, b) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = 'rgba(30,26,20,0.55)';
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.fillStyle = '#4a463c';
      ctx.fillRect(-b.w / 2 + 4, -b.h / 2 + 4, b.w - 8, 7);
      ctx.fillRect(-b.w / 2 + 4, -b.h / 2 + 4, 7, b.h - 8);
      ctx.fillRect(b.w / 2 - 14, b.h / 2 - 16, 10, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (var i = 0; i < 6; i++) ctx.fillRect(-b.w / 2 + 6 + (i * 11) % (b.w - 12), -b.h / 2 + 12 + (i * 17) % (b.h - 16), 5, 4);
      ctx.restore();
    },

    drawBuilding: function (ctx, b, g, remembered) {
      if (!this.onScreen(g, b.x, b.y, Math.max(b.w, b.h))) return;
      var f = this.factionPal(g, b.owner);
      var legion = f.id === 'legion';
      var w = b.w, h = b.h;
      ctx.save();
      ctx.translate(b.x, b.y);

      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fillRect(-w / 2 + 5, -h / 2 + 6, w, h);

      // main body
      ctx.fillStyle = legion ? '#4a423a' : '#4e5459';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = legion ? '#5c5147' : '#616a70';
      ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);

      // faction trim
      ctx.fillStyle = f.dark;
      ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w - 6, 5);
      ctx.fillStyle = f.color;
      ctx.fillRect(-w / 2 + 3, h / 2 - 8, w - 6, 5);

      if (legion) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        for (var rx = -w / 2 + 8; rx < w / 2 - 4; rx += 12)
          for (var ry = -h / 2 + 12; ry < h / 2 - 8; ry += 12) ctx.fillRect(rx, ry, 2, 2);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (var ly = -h / 2 + 12; ly < h / 2 - 8; ly += 8) {
          ctx.beginPath(); ctx.moveTo(-w / 2 + 6, ly); ctx.lineTo(w / 2 - 6, ly); ctx.stroke();
        }
      }

      this.buildingDetail(ctx, b, f, w, h);

      // construction overlay
      if (!b.complete) {
        ctx.fillStyle = 'rgba(12,14,10,0.55)';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = '#d7b45a'; ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
        ctx.setLineDash([]);
        var bw = w - 16;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-bw / 2, -4, bw, 9);
        ctx.fillStyle = '#d7b45a';
        ctx.fillRect(-bw / 2 + 1, -3, (bw - 2) * b.progress, 7);
        ctx.fillStyle = '#0d0f0b';
        ctx.font = 'bold 10px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(b.progress * 100) + '%', 0, 4);
      }

      // turret for defences
      if (b.def.defence && b.complete) {
        ctx.rotate(b.turret);
        var brc = (b.recoil > 0 ? b.recoil : 0) * 5;
        ctx.fillStyle = '#2b2b26';
        if (b.type === 'aagun') {
          ctx.fillRect(-brc, -5, 20, 3); ctx.fillRect(-brc, 2, 20, 3);
        } else if (b.type === 'atgun') {
          ctx.fillRect(-brc, -2.5, 26, 5);
        } else {
          ctx.fillRect(-brc, -2, 14, 4);
        }
      }
      ctx.restore();

      if (!remembered && b.complete) this.fires(ctx, b, g);
      if (!remembered) this.healthBar(ctx, b, b.x, b.y - h / 2 - 8, w * 0.8, g);
    },

    /* Flames licking out of a damaged structure. Two seats below half
       health, four below a quarter, flickering off the clock. */
    fires: function (ctx, b, g) {
      var frac = b.hp / b.maxHp;
      if (frac > 0.5) return;
      var n = frac < 0.25 ? 4 : 2;
      ctx.save();
      ctx.translate(b.x, b.y);
      for (var i = 0; i < n; i++) {
        var seed = b.id * 7 + i * 31;
        var fx2 = ((seed * 13) % 100) / 100 * (b.w - 16) - (b.w - 16) / 2;
        var fy2 = ((seed * 29) % 100) / 100 * (b.h - 16) - (b.h - 16) / 2;
        var fl = 0.6 + 0.4 * Math.sin(g.time * 11 + i * 2.1);
        var hgt = 9 + fl * 8;
        var gr = ctx.createRadialGradient(fx2, fy2 - hgt * 0.3, 0, fx2, fy2 - hgt * 0.3, hgt);
        gr.addColorStop(0, 'rgba(255,232,150,0.95)');
        gr.addColorStop(0.45, 'rgba(240,140,40,0.75)');
        gr.addColorStop(1, 'rgba(180,60,20,0)');
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.ellipse(fx2, fy2 - hgt * 0.3, hgt * 0.55, hgt, 0, 0, 6.283);
        ctx.fill();
      }
      ctx.restore();
    },

    buildingDetail: function (ctx, b, f, w, h) {
      var t = b.type;
      ctx.save();
      if (t === 'hq') {
        ctx.fillStyle = '#3a4048';
        ctx.fillRect(-16, -16, 32, 32);
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(0, 0, 10, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#20242a'; ctx.fillRect(-2, -34, 3, 22);
        ctx.fillStyle = f.color; ctx.fillRect(1, -34, 14, 9);
      } else if (t === 'power') {
        ctx.fillStyle = '#33383c';
        ctx.beginPath(); ctx.arc(-9, -6, 9, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(9, 8, 9, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#8d949a';
        ctx.beginPath(); ctx.arc(-9, -6, 5, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(9, 8, 5, 0, 6.283); ctx.fill();
      } else if (t === 'depot') {
        ctx.fillStyle = PAL.supply;
        ctx.fillRect(-20, -6, 12, 12); ctx.fillRect(-4, 2, 12, 12); ctx.fillRect(10, -10, 10, 10);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.strokeRect(-20, -6, 12, 12);
      } else if (t === 'refinery') {
        ctx.fillStyle = '#39443f';
        ctx.beginPath(); ctx.arc(-10, 0, 12, 0, 6.283); ctx.fill();
        ctx.beginPath(); ctx.arc(12, 6, 8, 0, 6.283); ctx.fill();
        ctx.strokeStyle = PAL.fuel; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(12, 6); ctx.stroke();
      } else if (t === 'barracks') {
        ctx.fillStyle = '#2f3630';
        ctx.fillRect(-w / 2 + 10, h / 2 - 20, 16, 16);
        ctx.fillStyle = f.color; ctx.fillRect(-w / 2 + 14, h / 2 - 16, 8, 12);
        ctx.fillStyle = '#404a41';
        for (var i = 0; i < 3; i++) ctx.fillRect(-14 + i * 14, -h / 2 + 14, 9, 7);
      } else if (t === 'factory') {
        ctx.fillStyle = '#3b4145';
        for (var s = 0; s < 4; s++) {
          ctx.beginPath();
          ctx.moveTo(-w / 2 + 8 + s * 14, h / 2 - 12);
          ctx.lineTo(-w / 2 + 15 + s * 14, -h / 2 + 14);
          ctx.lineTo(-w / 2 + 22 + s * 14, h / 2 - 12);
          ctx.fill();
        }
        ctx.fillStyle = '#20242a'; ctx.fillRect(-12, h / 2 - 18, 24, 14);
      } else if (t === 'airfield') {
        ctx.fillStyle = '#3d4147';
        ctx.fillRect(-w / 2 + 6, -8, w - 12, 20);
        ctx.strokeStyle = '#d7d2be'; ctx.lineWidth = 2; ctx.setLineDash([9, 7]);
        ctx.beginPath(); ctx.moveTo(-w / 2 + 10, 2); ctx.lineTo(w / 2 - 10, 2); ctx.stroke();
        ctx.setLineDash([]);
      } else if (t === 'lab') {
        ctx.fillStyle = '#4b5560';
        ctx.beginPath(); ctx.arc(0, -2, 15, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#9fd6e6';
        ctx.beginPath(); ctx.arc(0, -2, 8, Math.PI, 0); ctx.fill();
      } else if (t === 'bunker') {
        ctx.fillStyle = '#3d423a';
        ctx.beginPath();
        ctx.moveTo(-16, -8); ctx.lineTo(16, -8); ctx.lineTo(20, 8); ctx.lineTo(-20, 8);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#191c17'; ctx.fillRect(-12, -3, 24, 5);
      } else if (t === 'atgun' || t === 'aagun') {
        ctx.fillStyle = '#3a3f38';
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, 6.283); ctx.fill();
        ctx.fillStyle = t === 'aagun' ? '#6d7a5a' : '#5a5f52';
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.283); ctx.fill();
      }
      ctx.restore();
    },

    /* --------------------------------------------------------- units */
    drawUnit: function (ctx, u, g) {
      var f = this.factionPal(g, u.owner);

      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath(); ctx.ellipse(2, 3, u.rad * 1.05, u.rad * 0.75, 0, 0, 6.283); ctx.fill();
      ctx.restore();

      if (u.armor === 'infantry') this.drawInfantry(ctx, u, f);
      else this.drawVehicle(ctx, u, f, g);

      this.healthBar(ctx, u, u.x, u.y - u.rad - 9, Math.max(20, u.rad * 2.4), g);
      if (u.rank > 0) this.chevrons(ctx, u);
      if (u.chute > 0) this.parachute(ctx, u);
    },

    chevrons: function (ctx, u) {
      var y = u.y - u.rad - 15, n = u.rank;
      ctx.save();
      ctx.strokeStyle = n >= 2 ? '#f0d582' : '#d8d3bd';
      ctx.lineWidth = 1.6;
      for (var i = 0; i < n; i++) {
        var yy = y - i * 4;
        ctx.beginPath();
        ctx.moveTo(u.x - 4, yy + 2); ctx.lineTo(u.x, yy - 1); ctx.lineTo(u.x + 4, yy + 2);
        ctx.stroke();
      }
      ctx.restore();
    },

    parachute: function (ctx, u) {
      var lift = u.chute * 26;
      ctx.save();
      ctx.translate(u.x, u.y - lift);
      ctx.globalAlpha = Math.min(1, u.chute * 1.6);
      ctx.strokeStyle = '#cfcab4'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-11, -14); ctx.lineTo(0, lift); ctx.lineTo(11, -14); ctx.stroke();
      ctx.fillStyle = '#d9d4bd';
      ctx.beginPath(); ctx.arc(0, -14, 14, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath(); ctx.arc(0, -14, 14, Math.PI, Math.PI * 1.5); ctx.fill();
      ctx.restore();
    },

    /* Body faces where the soldier is walking; the weapon tracks the target
       independently, which is what makes a firing line read as a firing line. */
    drawInfantry: function (ctx, u, f) {
      var body = f.id === 'legion' ? '#5a4a3c' : '#4a5c50';

      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.facing + Math.PI / 2);
      ctx.fillStyle = '#20231c';
      ctx.fillRect(-3.4, 2.5, 2.2, 3.4);
      ctx.fillRect(1.2, 2.5, 2.2, 3.4);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.ellipse(0, 1, 4.2, 5.2, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.beginPath(); ctx.ellipse(0, 3.4, 3.6, 2.4, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = f.dark;
      ctx.beginPath(); ctx.arc(0, -1.5, 3.4, 0, 6.283); ctx.fill();
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(0, -1.5, 2.0, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.20)';
      ctx.beginPath(); ctx.arc(-1, -2.5, 1.1, 0, 6.283); ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.turret);
      var rc = (u.recoil > 0 ? u.recoil : 0) * 2.2;
      ctx.strokeStyle = '#20231c'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(1 - rc, 0);
      var len = u.type === 'sniper' ? 12 : (u.type === 'at_inf' ? 11 : 8);
      ctx.lineTo(len - rc, 0); ctx.stroke();
      if (u.type === 'mg') { ctx.fillStyle = '#20231c'; ctx.fillRect(4 - rc, -3, 3, 6); }
      if (u.type === 'at_inf') { ctx.fillStyle = '#3a3f33'; ctx.fillRect(6 - rc, -2.5, 6, 5); }
      if (u.type === 'sniper') { ctx.fillStyle = '#2c3128'; ctx.fillRect(4 - rc, -2.4, 4, 1.6); }
      if (u.type === 'engineer') { ctx.fillStyle = '#d7b45a'; ctx.fillRect(2, -2, 4, 4); }
      ctx.restore();
    },

    drawVehicle: function (ctx, u, f, g) {
      var legion = f.id === 'legion';
      var L = u.rad * 1.85, Wd = u.rad * 1.35;

      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.facing);

      if (u.def.harvest) {
        ctx.fillStyle = legion ? '#4b4137' : '#485245';
        ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
        ctx.fillStyle = f.dark;
        ctx.fillRect(L / 2 - 7, -Wd / 2, 7, Wd);
        if (u.type === 'tanker') {
          ctx.fillStyle = '#39443f';
          ctx.beginPath(); ctx.ellipse(-2, 0, L * 0.32, Wd * 0.42, 0, 0, 6.283); ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-L * 0.32, -2); ctx.lineTo(L * 0.28, -2); ctx.stroke();
        } else {
          ctx.fillStyle = u.carry > 0 ? PAL.supply : '#5d6350';
          ctx.fillRect(-L / 2 + 2, -Wd / 2 + 2, L * 0.55, Wd - 4);
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(-L / 2 + 2, -1, L * 0.55, 1.8);
        }
        ctx.fillStyle = '#1c1f19';
        ctx.fillRect(-L / 2 + 3, -Wd / 2 - 1.8, 5, 2.8);
        ctx.fillRect(-L / 2 + 3, Wd / 2 - 1, 5, 2.8);
        ctx.fillRect(L / 2 - 9, -Wd / 2 - 1.8, 5, 2.8);
        ctx.fillRect(L / 2 - 9, Wd / 2 - 1, 5, 2.8);
        ctx.restore();
        return;
      }

      // running gear
      ctx.fillStyle = '#22251f';
      ctx.fillRect(-L / 2, -Wd / 2 - 2.5, L, 3.6);
      ctx.fillRect(-L / 2, Wd / 2 - 1, L, 3.6);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      for (var i = 0; i < L; i += 5) {
        ctx.fillRect(-L / 2 + i, -Wd / 2 - 2.5, 2, 3.6);
        ctx.fillRect(-L / 2 + i, Wd / 2 - 1, 2, 3.6);
      }

      // hull with a sloped glacis
      var hull = legion ? '#514a3c' : '#4d5850';
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(-L / 2, -Wd / 2);
      ctx.lineTo(L / 2 - 3, -Wd / 2 + 1.5);
      ctx.lineTo(L / 2, 0);
      ctx.lineTo(L / 2 - 3, Wd / 2 - 1.5);
      ctx.lineTo(-L / 2, Wd / 2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(-L / 2 + 2, -Wd / 2 + 2, L - 6, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.fillRect(-L / 2 + 2, Wd / 2 - 5, L - 6, 2.5);
      ctx.fillStyle = f.color;
      ctx.fillRect(-L / 2 + 2, Wd / 2 - 3.5, 6, 2.5);
      if (u.type === 'heavy') {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(-L / 2 + 4, -Wd / 2 + 1, 3, Wd - 2);
        ctx.fillRect(-L / 2 + 10, -Wd / 2 + 1, 3, Wd - 2);
      }
      ctx.restore();

      // turret, drawn separately so it can aim independently of the hull
      ctx.save();
      ctx.translate(u.x, u.y);
      ctx.rotate(u.turret);
      var rec = (u.recoil > 0 ? u.recoil : 0);
      if (u.type === 'halftrack') {
        ctx.fillStyle = '#333830';
        ctx.fillRect(-4, -4, 8, 8);
        ctx.fillStyle = '#20231c'; ctx.fillRect(3 - rec * 3, -1, 11, 2);
      } else if (u.type === 'artillery') {
        ctx.fillStyle = '#3a4036';
        ctx.fillRect(-6, -5, 11, 10);
        ctx.fillStyle = '#2b2f26';
        ctx.fillRect(-9, -8, 4, 16);
        ctx.fillStyle = '#20231c'; ctx.fillRect(2 - rec * 7, -2, u.rad * 2.4, 4);
      } else {
        var tr = u.rad * 0.72;
        ctx.fillStyle = legion ? '#5c5445' : '#586359';
        ctx.beginPath(); ctx.arc(0, 0, tr, 0, 6.283); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.09)';
        ctx.beginPath(); ctx.arc(-1, -1.5, tr * 0.8, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.arc(-1, 1.5, tr * 0.55, 0, 6.283); ctx.fill();
        ctx.fillStyle = '#2b2f26';
        ctx.fillRect(tr - 3, -4, 5, 8);
        ctx.fillStyle = '#20231c';
        ctx.fillRect(tr - 2 - rec * 4, -2, u.rad * (u.type === 'heavy' ? 2.0 : 1.6), 4);
        if (u.type === 'heavy') ctx.fillRect(tr + u.rad * 1.4 - rec * 4, -3, 5, 6);
      }
      ctx.restore();
    },

    drawPlane: function (ctx, a, g) {
      var f = this.factionPal(g, a.owner);
      var alt = 34;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      ctx.translate(a.x + 10, a.y + alt);
      ctx.rotate(a.facing);
      this.planeShape(ctx, a, '#000', '#000');
      ctx.restore();

      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.facing);
      var bank = a.bank || 0;
      ctx.scale(1, Math.max(0.35, Math.cos(bank)));
      this.planeShape(ctx, a, f.id === 'legion' ? '#57503f' : '#4a5a68', f.color);
      ctx.restore();
      this.healthBar(ctx, a, a.x, a.y - a.rad - 12, a.rad * 2.2, g);
    },

    planeShape: function (ctx, a, body, accent) {
      var s = a.rad / 13;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(16 * s, 0); ctx.lineTo(4 * s, -4 * s); ctx.lineTo(-14 * s, -3 * s);
      ctx.lineTo(-16 * s, 0); ctx.lineTo(-14 * s, 3 * s); ctx.lineTo(4 * s, 4 * s);
      ctx.closePath(); ctx.fill();
      // wings
      ctx.fillRect(-4 * s, -16 * s, 7 * s, 32 * s);
      ctx.fillRect(-15 * s, -8 * s, 5 * s, 16 * s);
      ctx.fillStyle = accent;
      ctx.fillRect(-3 * s, -15 * s, 3 * s, 5 * s);
      ctx.fillRect(-3 * s, 10 * s, 3 * s, 5 * s);
      if (a.type === 'bomber') { ctx.fillStyle = body; ctx.fillRect(-2 * s, -19 * s, 6 * s, 6 * s); ctx.fillRect(-2 * s, 13 * s, 6 * s, 6 * s); }
    },

    /* --------------------------------------------------- misc layers */
    drawProjectiles: function (g, ctx) {
      for (var i = 0; i < g.projectiles.length; i++) {
        var p = g.projectiles[i];
        if (!this.onScreen(g, p.x, p.y, 30)) continue;
        var z = p.z || 0;
        if (p.kindP === 'bomb') {
          ctx.fillStyle = '#2a2c24';
          ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, 6.283); ctx.fill();
        } else if (p.kindP === 'rocket') {
          ctx.strokeStyle = 'rgba(255,190,110,0.75)'; ctx.lineWidth = 2.5;
          var a = Math.atan2(p.ty - p.sy, p.tx - p.sx);
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(a) * 10, p.y - Math.sin(a) * 10 - z);
          ctx.lineTo(p.x, p.y - z); ctx.stroke();
        } else {
          ctx.fillStyle = '#ffe7a8';
          ctx.beginPath(); ctx.arc(p.x, p.y - z, 2.4, 0, 6.283); ctx.fill();
          if (z > 2) { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 6.283); ctx.fill(); }
        }
      }
    },

    drawEffects: function (g, ctx, above) {
      for (var i = 0; i < g.effects.length; i++) {
        var e = g.effects[i];
        var k = e.age / e.life;
        var isAbove = (e.t === 'smoke' || e.t === 'text');
        if (isAbove !== above) continue;
        if (!this.onScreen(g, e.x, e.y, 80)) continue;
        ctx.save();
        switch (e.t) {
          case 'muzzle':
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = '#ffe08a';
            ctx.translate(e.x, e.y); ctx.rotate(e.a);
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(11, -4); ctx.lineTo(15, 0); ctx.lineTo(11, 4);
            ctx.closePath(); ctx.fill();
            break;
          case 'tracer':
            ctx.globalAlpha = (1 - k) * 0.9;
            ctx.strokeStyle = e.col; ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); ctx.stroke();
            break;
          case 'boom':
            ctx.globalAlpha = 1 - k;
            var r = e.r * (0.4 + k * 1.5);
            var grd = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
            grd.addColorStop(0, 'rgba(255,240,190,0.95)');
            grd.addColorStop(0.4, 'rgba(255,150,50,0.75)');
            grd.addColorStop(1, 'rgba(90,40,20,0)');
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, 6.283); ctx.fill();
            break;
          case 'ring':
            ctx.globalAlpha = (1 - k) * 0.6;
            ctx.strokeStyle = 'rgba(255,236,196,0.9)';
            ctx.lineWidth = Math.max(1, 4 * (1 - k));
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.5 + k * 2.6), 0, 6.283); ctx.stroke();
            break;
          case 'trail':
            ctx.globalAlpha = (1 - k) * 0.30;
            ctx.fillStyle = '#dfe4e6';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + k * 1.6), 0, 6.283); ctx.fill();
            break;
          case 'spark':
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = k < 0.4 ? '#ffd98a' : '#c8703a';
            ctx.fillRect(e.x, e.y, e.size, e.size);
            break;
          case 'dust':
            ctx.globalAlpha = (1 - k) * 0.35;
            ctx.fillStyle = '#b8ae8c';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (1 + k), 0, 6.283); ctx.fill();
            break;
          case 'smoke':
            ctx.globalAlpha = (1 - k) * 0.45;
            ctx.fillStyle = '#4b4a44';
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.283); ctx.fill();
            break;
          case 'text':
            ctx.globalAlpha = 1 - k;
            ctx.fillStyle = e.col;
            ctx.font = 'bold 12px ui-monospace, Menlo, monospace';
            ctx.textAlign = 'center';
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
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
      ctx.fillStyle = frac > 0.6 ? '#79c05a' : (frac > 0.3 ? '#e0b13c' : '#cf4a34');
      ctx.fillRect(x - w / 2, y, w * frac, 3);
    },

    drawSelection: function (g, ctx) {
      for (var i = 0; i < g.selection.length; i++) {
        var e = g.selection[i];
        if (e.dead) continue;
        ctx.save();
        var pulse = 1.4 + 0.45 * Math.sin(g.time * 4);
        ctx.strokeStyle = '#c9e07a';
        ctx.lineWidth = pulse;
        if (e.kind === 'building') {
          var w = e.w / 2 + 4, h = e.h / 2 + 4, c = 9;
          ctx.beginPath();
          ctx.moveTo(e.x - w, e.y - h + c); ctx.lineTo(e.x - w, e.y - h); ctx.lineTo(e.x - w + c, e.y - h);
          ctx.moveTo(e.x + w - c, e.y - h); ctx.lineTo(e.x + w, e.y - h); ctx.lineTo(e.x + w, e.y - h + c);
          ctx.moveTo(e.x + w, e.y + h - c); ctx.lineTo(e.x + w, e.y + h); ctx.lineTo(e.x + w - c, e.y + h);
          ctx.moveTo(e.x - w + c, e.y + h); ctx.lineTo(e.x - w, e.y + h); ctx.lineTo(e.x - w, e.y + h - c);
          ctx.stroke();
          if (e.rally) {
            ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(201,224,122,0.55)';
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.rally.x, e.rally.y); ctx.stroke();
            ctx.setLineDash([]);
            // little rally flag at the far end
            ctx.strokeStyle = '#c9e07a'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(e.rally.x, e.rally.y); ctx.lineTo(e.rally.x, e.rally.y - 20); ctx.stroke();
            ctx.fillStyle = '#c9e07a';
            ctx.beginPath();
            ctx.moveTo(e.rally.x, e.rally.y - 20);
            ctx.lineTo(e.rally.x + 13, e.rally.y - 16);
            ctx.lineTo(e.rally.x, e.rally.y - 12);
            ctx.closePath(); ctx.fill();
          }
        } else {
          ctx.fillStyle = 'rgba(201,224,122,0.10)';
          ctx.beginPath();
          ctx.ellipse(e.x, e.y + 2, e.rad + 6, (e.rad + 6) * 0.7, 0, 0, 6.283);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(e.x, e.y + 2, e.rad + 5, (e.rad + 5) * 0.7, 0, 0, 6.283);
          ctx.stroke();
          if (e.def.domain === 'air') {
            ctx.strokeStyle = 'rgba(201,224,122,0.35)';
            ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + 10, e.y + 34); ctx.stroke();
          }
        }
        ctx.restore();
      }
      if (g.dragBox) {
        var d = g.dragBox;
        ctx.save();
        ctx.strokeStyle = '#c9e07a'; ctx.lineWidth = 1;
        ctx.fillStyle = 'rgba(201,224,122,0.10)';
        var x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
        var w2 = Math.abs(d.x1 - d.x0), h2 = Math.abs(d.y1 - d.y0);
        ctx.fillRect(x, y, w2, h2); ctx.strokeRect(x + 0.5, y + 0.5, w2, h2);
        ctx.restore();
      }
    },

    drawPlacement: function (g, ctx) {
      if (!g.placing) return;
      var def = IF.BUILDINGS[g.placing.type];
      var tx = g.placing.tx, ty = g.placing.ty;
      var ok = g.canPlaceForPlayer(0, g.placing.type, tx, ty) && g.canAfford(0, def.cost);
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = ok ? 'rgba(140,200,110,0.55)' : 'rgba(210,80,60,0.55)';
      ctx.fillRect(tx * T, ty * T, def.w * T, def.h * T);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#a9e07a' : '#e06a52';
      ctx.lineWidth = 2;
      ctx.strokeRect(tx * T + 1, ty * T + 1, def.w * T - 2, def.h * T - 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      for (var gx = 1; gx < def.w; gx++) { ctx.beginPath(); ctx.moveTo((tx + gx) * T, ty * T); ctx.lineTo((tx + gx) * T, (ty + def.h) * T); ctx.stroke(); }
      for (var gy = 1; gy < def.h; gy++) { ctx.beginPath(); ctx.moveTo(tx * T, (ty + gy) * T); ctx.lineTo((tx + def.w) * T, (ty + gy) * T); ctx.stroke(); }
      ctx.restore();
    },

    /* ------------------------------------------------------- minimap */
    drawMinimap: function (g) {
      var ctx = this.mctx;
      var w = this.mini.clientWidth, h = this.mini.clientHeight;
      var sx = w / g.map.pxW, sy = h / g.map.pxH;
      ctx.clearRect(0, 0, w, h);

      // No Radar Station, or the power is out: static instead of a map.
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
        cols[IF.T.FIELD] = [110, 122, 76]; cols[IF.T.ROAD] = [122, 113, 96];
        cols[IF.T.FOREST] = [47, 74, 44]; cols[IF.T.WATER] = [47, 84, 104];
        cols[IF.T.BRIDGE] = [138, 115, 80]; cols[IF.T.RUBBLE] = [87, 83, 68];
        cols[IF.T.RUIN] = [115, 107, 92];
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
      // sweeping radar trace
      var ang = (g.time * 1.1) % 6.283;
      var cx = w / 2, cy = h / 2, rad = Math.max(w, h);
      var sweep = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
      sweep.addColorStop(0, 'rgba(150,220,150,0.20)');
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

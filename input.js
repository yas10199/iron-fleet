/* IRON FRONT — input.js
   Mouse, keyboard, minimap and touch. Every command funnels through
   issueCommand() so a future multiplayer layer can send that one call
   over the network instead of applying it locally. */
(function (IF) {
  'use strict';

  var T = IF.TILE;

  var IN = {
    keys: {},
    mouse: { x: 0, y: 0, down: false, worldX: 0, worldY: 0 },
    attackMove: false,
    groups: {},
    panSpeed: 900,

    init: function (canvas, mini) {
      var self = this;
      this.canvas = canvas;

      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      canvas.addEventListener('wheel', function (e) {
        var g = IF.game; if (!g) return;
        e.preventDefault();
        var r = canvas.getBoundingClientRect();
        self.zoomBy(g, e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });

      canvas.addEventListener('mousedown', function (e) {
        var g = IF.game; if (!g) return;
        IF.audio.resume();
        var w = self.toWorld(e);
        if (g.targeting) {
          if (e.button === 2) { g.targeting = null; return; }
          IF.Powers.fire(g, 0, g.targeting, w.x, w.y);
          g.targeting = null;
          return;
        }
        if (e.button === 2) { self.rightClick(g, w, e.shiftKey); return; }
        if (e.button === 1) { self.panning = { x: e.clientX, y: e.clientY, cx: g.cam.tx, cy: g.cam.ty }; return; }

        if (g.placing) { self.place(g, e.shiftKey); return; }
        // "A then click" is an attack-move order, not the start of a drag.
        if (self.attackMove) { self.issueCommand(g, w.x, w.y, true, e.shiftKey); return; }
        self.dragStart = { x: w.x, y: w.y, shift: e.shiftKey, t: performance.now() };
        g.dragBox = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      });

      window.addEventListener('mousemove', function (e) {
        var g = IF.game; if (!g) return;
        var r = canvas.getBoundingClientRect();
        self.mouse.x = e.clientX - r.left;
        self.mouse.y = e.clientY - r.top;
        self.mouse.inside = self.mouse.x >= 0 && self.mouse.y >= 0 && self.mouse.x < r.width && self.mouse.y < r.height
                            && e.target === canvas;
        var w = self.toWorld(e);
        self.mouse.worldX = w.x; self.mouse.worldY = w.y;
        if (g.placing) {
          var def = IF.BUILDINGS[g.placing.type];
          g.placing.tx = IF.clamp(Math.round(w.x / T - def.w / 2), 0, g.map.w - def.w);
          g.placing.ty = IF.clamp(Math.round(w.y / T - def.h / 2), 0, g.map.h - def.h);
        }
        if (self.panning) {
          var z2 = g.cam.zoom || 1;
          g.cam.tx = IF.clamp(self.panning.cx - (e.clientX - self.panning.x) / z2, 0, Math.max(0, g.map.pxW - g.viewW));
          g.cam.ty = IF.clamp(self.panning.cy - (e.clientY - self.panning.y) / z2, 0, Math.max(0, g.map.pxH - g.viewH));
          g.cam.x = g.cam.tx; g.cam.y = g.cam.ty;
        }
        if (g.dragBox) { g.dragBox.x1 = w.x; g.dragBox.y1 = w.y; }

        // Cheap throttle: picking scans every unit, and mousemove fires a lot.
        var now = performance.now();
        if (now - (self._hoverAt || 0) > 70) {
          self._hoverAt = now;
          self.hover = self.mouse.inside ? self.entityAt(g, w.x, w.y) : null;
        }
      });

      window.addEventListener('mouseup', function (e) {
        var g = IF.game; if (!g) return;
        self.panning = null;
        if (!g.dragBox) return;
        var box = g.dragBox;
        g.dragBox = null;
        var w = Math.abs(box.x1 - box.x0), h = Math.abs(box.y1 - box.y0);
        if (w < 7 && h < 7) self.clickSelect(g, box.x0, box.y0, self.dragStart && self.dragStart.shift, e.detail >= 2);
        else self.boxSelect(g, box, self.dragStart && self.dragStart.shift);
      });

      /* --- minimap --- */
      var miniJump = function (e) {
        var g = IF.game; if (!g) return;
        var r = mini.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width * g.map.pxW;
        var py = (e.clientY - r.top) / r.height * g.map.pxH;
        if (e.button === 2 || e.type === 'contextmenu') { self.rightClick(g, { x: px, y: py }, false); return; }
        g.centerOn(px, py);
      };
      mini.addEventListener('mousedown', function (e) { e.preventDefault(); miniJump(e); self.miniDrag = true; });
      mini.addEventListener('contextmenu', function (e) { e.preventDefault(); miniJump(e); });
      window.addEventListener('mousemove', function (e) { if (self.miniDrag && e.buttons === 1) miniJump(e); });
      window.addEventListener('mouseup', function () { self.miniDrag = false; });

      /* --- keyboard --- */
      window.addEventListener('keydown', function (e) {
        var g = IF.game;
        self.keys[e.key.toLowerCase()] = true;
        if (!g) return;
        var k = e.key.toLowerCase();
        if (k === 'escape') { g.placing = null; g.targeting = null; self.attackMove = false; }
        if (k === '+' || k === '=') self.zoomBy(g, 1.15, IF.render.cw / 2, IF.render.ch / 2);
        if (k === '-' || k === '_') self.zoomBy(g, 1 / 1.15, IF.render.cw / 2, IF.render.ch / 2);
        if (k === 'a') { self.attackMove = true; if (IF.game) IF.game.msg('Attack-move armed — click a destination'); }
        if (k === ' ') {
          // Jump to wherever the base was last hit.
          if (g.alertAt) { g.centerOn(g.alertAt.x, g.alertAt.y); e.preventDefault(); }
        }
        if (k === 's') { self.forEachSelectedUnit(g, function (u) { u.orderStop(); }); }
        if (k === 'h') { var hq = g.findBuilding(0, 'hq'); if (hq) g.centerOn(hq.x, hq.y); }
        if (k === 'e') {
          // every fighting unit on the map, harvesters left alone
          var army = [];
          for (var ai = 0; ai < g.units.length; ai++) {
            var au = g.units[ai];
            if (!au.dead && au.owner === 0 && !au.def.harvest) army.push(au);
          }
          if (army.length) { g.selection = army; g.msg('Selected your whole army — ' + army.length + ' units'); IF.audio.play('select'); }
        }
        if (k === 'p') { g.paused = !g.paused; }
        if (k === 'tab') { document.body.classList.toggle('uihidden'); e.preventDefault(); }
        if (k >= '1' && k <= '9') {
          if (e.ctrlKey || e.metaKey) {
            self.groups[k] = g.selection.slice();
            g.msg('Group ' + k + ' set');
          } else {
            var grp = (self.groups[k] || []).filter(function (u) { return !u.dead; });
            if (grp.length) { g.selection = grp.slice(); if (e.shiftKey) g.centerOn(grp[0].x, grp[0].y); }
          }
          e.preventDefault();
        }
      });
      window.addEventListener('keyup', function (e) { self.keys[e.key.toLowerCase()] = false; });

      /* --- touch --- */
      this.initTouch(canvas, mini);
    },

    /* Called when a new match starts. Without this, control groups still
       hold units from the last game and the attack cursor stays armed. */
    reset: function () {
      this.groups = {};
      this.hover = null;
      this.attackMove = false;
      this.dragStart = null;
      this.panning = null;
      this.miniDrag = false;
      this.touchMode = null;
      var a = document.getElementById('btnTouchAttack');
      if (a) a.classList.remove('on');
      var sBtn = document.getElementById('btnTouchSelect');
      if (sBtn) sBtn.classList.remove('on');
    },

    toWorld: function (e) {
      var g = IF.game;
      var r = this.canvas.getBoundingClientRect();
      var z = g.cam.zoom || 1;
      return { x: (e.clientX - r.left) / z + g.cam.x, y: (e.clientY - r.top) / z + g.cam.y };
    },

    /* Wheel zoom, anchored on whatever is under the cursor. */
    zoomBy: function (g, factor, sx, sy) {
      var z0 = g.cam.zoomT || g.cam.zoom || 1;
      var z1 = IF.clamp(z0 * factor, 0.6, 1.8);
      if (Math.abs(z1 - z0) < 0.0001) return;
      var wx = sx / z0 + g.cam.tx, wy = sy / z0 + g.cam.ty;
      g.cam.zoomT = z1;
      var vw = IF.render.cw / z1, vh = IF.render.ch / z1;
      g.cam.tx = IF.clamp(wx - sx / z1, 0, Math.max(0, g.map.pxW - vw));
      g.cam.ty = IF.clamp(wy - sy / z1, 0, Math.max(0, g.map.pxH - vh));
    },

    /* --------------------------------------------------- placement */
    startPlacement: function (type) {
      var g = IF.game;
      g.placing = { type: type, tx: 0, ty: 0 };
      var def = IF.BUILDINGS[type];
      g.placing.tx = IF.clamp(Math.round(this.mouse.worldX / T - def.w / 2), 0, g.map.w - def.w);
      g.placing.ty = IF.clamp(Math.round(this.mouse.worldY / T - def.h / 2), 0, g.map.h - def.h);
    },

    place: function (g, keepGoing) {
      var pl = g.placing;
      if (g.tryBuild(0, pl.type, pl.tx, pl.ty)) {
        if (!keepGoing) g.placing = null;
      }
    },

    /* --------------------------------------------------- selection */
    clickSelect: function (g, x, y, additive, dbl) {
      var hit = this.entityAt(g, x, y);
      if (!hit) { if (!additive) g.selection = []; return; }
      if (hit.owner !== 0) { g.selection = [hit]; return; }

      if (dbl && hit.kind === 'unit') {
        var same = [];
        for (var i = 0; i < g.units.length; i++) {
          var u = g.units[i];
          if (u.dead || u.owner !== 0 || u.type !== hit.type) continue;
          if (Math.abs(u.x - g.cam.x - g.viewW / 2) < g.viewW && Math.abs(u.y - g.cam.y - g.viewH / 2) < g.viewH) same.push(u);
        }
        g.selection = same;
      } else if (additive) {
        var idx = g.selection.indexOf(hit);
        if (idx >= 0) g.selection.splice(idx, 1); else g.selection.push(hit);
      } else {
        g.selection = [hit];
      }
      IF.audio.play('select');
      if (g.selection.length && g.selection[0].kind === 'unit') IF.audio.ack(g.selection[0].type, 'select');
    },

    boxSelect: function (g, box, additive) {
      var x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
      var y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
      var found = [];
      for (var i = 0; i < g.units.length; i++) {
        var u = g.units[i];
        if (u.dead || u.owner !== 0) continue;
        if (u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) found.push(u);
      }
      // Prefer fighting units — don't drag harvesters into an assault by accident.
      var fighters = found.filter(function (u) { return !u.def.harvest; });
      if (fighters.length) found = fighters;
      if (!found.length) {
        for (var b = 0; b < g.buildings.length; b++) {
          var bl = g.buildings[b];
          if (bl.dead || bl.owner !== 0) continue;
          if (bl.x >= x0 - bl.w / 2 && bl.x <= x1 + bl.w / 2 && bl.y >= y0 - bl.h / 2 && bl.y <= y1 + bl.h / 2) { found = [bl]; break; }
        }
      }
      if (!found.length && !additive) { g.selection = []; return; }
      g.selection = additive ? g.selection.concat(found.filter(function (f) { return g.selection.indexOf(f) < 0; })) : found;
      if (found.length) {
        IF.audio.play('select');
        if (found[0].kind === 'unit') IF.audio.ack(found[0].type, 'select');
      }
    },

    entityAt: function (g, x, y) {
      var best = null, bd = Infinity, i;
      for (i = 0; i < g.units.length; i++) {
        var u = g.units[i];
        if (u.dead) continue;
        if (u.owner !== 0 && !g.fog.visibleAt(u.x, u.y)) continue;
        if (u.def.domain === 'air' && u.astate === 'rearm') continue;
        var d = IF.dist2(x, y + 5, u.x, u.y);
        if (d < (u.rad + 11) * (u.rad + 11) && d < bd) { bd = d; best = u; }
      }
      if (best) return best;
      for (i = 0; i < g.buildings.length; i++) {
        var b = g.buildings[i];
        if (b.dead) continue;
        if (b.owner !== 0 && !g.fog.exploredAt(b.x, b.y)) continue;
        // Buildings are drawn lifted by their height, so the clickable area
        // has to cover the raised roof as well as the ground footprint.
        var lift = (IF.render.heightOf ? IF.render.heightOf(b.type) : 0);
        if (x > b.x - b.w / 2 && x < b.x + b.w / 2 &&
            y > b.y - b.h / 2 - lift && y < b.y + b.h / 2) return b;
      }
      return null;
    },

    /* Closest enemy to a point that the player can actually see. */
    enemyNear: function (g, x, y, r) {
      var best = null, bd = r * r, i;
      for (i = 0; i < g.units.length; i++) {
        var u = g.units[i];
        if (u.dead || u.owner === 0) continue;
        if (!g.fog.visibleAt(u.x, u.y)) continue;
        var d = IF.dist2(x, y + 5, u.x, u.y);
        if (d < bd) { bd = d; best = u; }
      }
      if (best) return best;
      for (i = 0; i < g.buildings.length; i++) {
        var b = g.buildings[i];
        if (b.dead || b.owner === 0) continue;
        if (!g.fog.exploredAt(b.x, b.y)) continue;
        if (IF.rectDist(x, y, b) < r) return b;
      }
      return null;
    },

    nodeAt: function (g, x, y) {
      for (var i = 0; i < g.map.nodes.length; i++) {
        var n = g.map.nodes[i];
        if (n.amount > 0 && IF.dist(x, y, n.x, n.y) < 42) return n;
      }
      return null;
    },

    forEachSelectedUnit: function (g, fn) {
      for (var i = 0; i < g.selection.length; i++) {
        var e = g.selection[i];
        if (e.kind === 'unit' && !e.dead && e.owner === 0) fn(e);
      }
    },

    /* ----------------------------------------------------- commands */
    rightClick: function (g, w, shift) {
      if (g.placing) { g.placing = null; return; }
      this.issueCommand(g, w.x, w.y, false, shift);
    },

    /* Single funnel for all player orders. */
    issueCommand: function (g, x, y, forceAttackMove, queue) {
      if (g.over) return;
      var sel = g.selection.filter(function (e) { return !e.dead && e.owner === 0; });
      if (!sel.length) return;

      // Buildings only: set a rally point.
      var units = sel.filter(function (e) { return e.kind === 'unit'; });
      if (!units.length) {
        for (var b = 0; b < sel.length; b++) if (sel[b].def.produces) sel[b].rally = { x: x, y: y };
        g.msg('Rally point set');
        IF.audio.play('order');
        return;
      }

      var target = this.entityAt(g, x, y);
      // Small units are hard to hit exactly, especially on a phone. If the
      // order lands near an enemy, treat it as an order to attack that enemy.
      if (!target || target.owner === 0) {
        var snap = this.enemyNear(g, x, y, this.attackMove || forceAttackMove ? 60 : 30);
        if (snap) target = snap;
      }
      var node = this.nodeAt(g, x, y);
      var ordered = false;

      for (var i = 0; i < units.length; i++) {
        var u = units[i];
        if (target && target.owner !== 0 && u.canHit(target)) {
          u.orderAttack(target);
          if (u.def.cat === 'air' && u.astate === 'parked') u.astate = 'mission';
          ordered = true;
        } else if (target && target.owner === 0 && u.def.repair && target !== u && target.hp < target.maxHp) {
          u.orderRepair(target);
          ordered = true;
        } else if (node && u.def.harvest && node.type === u.def.harvest) {
          u.orderHarvest(node);
          ordered = true;
        } else {
          var off = this.formationOffset(i, units.length);
          if (queue) u.queueWaypoint(x + off.x, y + off.y, forceAttackMove || this.attackMove);
          else u.orderMove(x + off.x, y + off.y, forceAttackMove || this.attackMove);
          if (u.def.cat === 'air') { u.astate = 'mission'; u.order.hostile = forceAttackMove || this.attackMove; }
          ordered = true;
        }
      }
      if (ordered) {
        IF.audio.play('order');
        IF.audio.ack(units[0].type, (target && target.owner !== 0) ? 'attack' : 'move');
        if (target && target.owner !== 0) IF.fx.mark(g, target.x, target.y, 'attack');
        else IF.fx.mark(g, x, y, 'move');
      }
      this.attackMove = false;
    },

    formationOffset: function (i, n) {
      if (n <= 1) return { x: 0, y: 0 };
      var cols = Math.ceil(Math.sqrt(n));
      var cx = i % cols, cy = Math.floor(i / cols);
      var sp = 30;
      return { x: (cx - (cols - 1) / 2) * sp, y: (cy - (Math.ceil(n / cols) - 1) / 2) * sp };
    },

    /* -------------------------------------------------------- touch */
    initTouch: function (canvas, mini) {
      var self = this, start = null, moved = false, lastTap = 0;

      canvas.addEventListener('touchstart', function (e) {
        IF.audio.resume();
        var g = IF.game; if (!g) return;
        if (e.touches.length !== 1) return;
        var t = e.touches[0], r = canvas.getBoundingClientRect();
        start = {
          sx: t.clientX, sy: t.clientY, cx: g.cam.tx, cy: g.cam.ty,
          wx: t.clientX - r.left + g.cam.x, wy: t.clientY - r.top + g.cam.y,
          time: performance.now()
        };
        moved = false;
      }, { passive: true });

      canvas.addEventListener('touchmove', function (e) {
        var g = IF.game; if (!g || !start || e.touches.length !== 1) return;
        var t = e.touches[0];
        var dx = t.clientX - start.sx, dy = t.clientY - start.sy;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
        if (self.touchMode === 'select' && moved) {
          var r = canvas.getBoundingClientRect();
          g.dragBox = { x0: start.wx, y0: start.wy, x1: t.clientX - r.left + g.cam.x, y1: t.clientY - r.top + g.cam.y };
        } else if (moved) {
          var tz = g.cam.zoom || 1;
          g.cam.tx = IF.clamp(start.cx - dx / tz, 0, Math.max(0, g.map.pxW - g.viewW));
          g.cam.ty = IF.clamp(start.cy - dy / tz, 0, Math.max(0, g.map.pxH - g.viewH));
          g.cam.x = g.cam.tx; g.cam.y = g.cam.ty;
        }
      }, { passive: true });

      canvas.addEventListener('touchend', function (e) {
        var g = IF.game; if (!g || !start) return;
        var held = performance.now() - start.time;
        if (self.touchMode === 'select' && moved && g.dragBox) {
          self.boxSelect(g, g.dragBox, false);
          g.dragBox = null;
          self.touchMode = null;
          document.getElementById('btnTouchSelect').classList.remove('on');
        } else if (!moved) {
          if (g.placing) { self.place(g, false); }
          else if (held > 420) { self.issueCommand(g, start.wx, start.wy, true); }   // long press = attack-move
          else {
            var hit = self.entityAt(g, start.wx, start.wy);
            var node = self.nodeAt(g, start.wx, start.wy);
            var now = performance.now();
            if (hit && hit.owner === 0) { self.clickSelect(g, start.wx, start.wy, false, now - lastTap < 300); lastTap = now; }
            else if (g.selection.length) { self.issueCommand(g, start.wx, start.wy, false); }
            else if (hit || node) { self.clickSelect(g, start.wx, start.wy, false, false); }
          }
        }
        start = null;
      });

      mini.addEventListener('touchstart', function (e) {
        var g = IF.game; if (!g) return;
        var t = e.touches[0], r = mini.getBoundingClientRect();
        g.centerOn((t.clientX - r.left) / r.width * g.map.pxW, (t.clientY - r.top) / r.height * g.map.pxH);
      }, { passive: true });

      var bs = document.getElementById('btnTouchSelect');
      if (bs) bs.addEventListener('click', function () {
        self.touchMode = self.touchMode === 'select' ? null : 'select';
        this.classList.toggle('on', self.touchMode === 'select');
      });
      var batk = document.getElementById('btnTouchAttack');
      if (batk) batk.addEventListener('click', function () {
        self.attackMove = !self.attackMove;
        this.classList.toggle('on', self.attackMove);
        if (IF.game) IF.game.msg(self.attackMove
          ? 'Attack ordered — now tap the target'
          : 'Attack order cancelled');
      });
      var ba = document.getElementById('btnTouchStop');
      if (ba) ba.addEventListener('click', function () {
        var g = IF.game; if (!g) return;
        self.forEachSelectedUnit(g, function (u) { u.orderStop(); });
      });
    },

    /* ------------------------------------------------------- camera
       The camera chases a target rather than snapping to it, so panning,
       edge-scrolling and map jumps all glide instead of juddering. */
    updateCamera: function (g, dt) {
      var ease = 1 - Math.pow(0.0016, dt);          // frame-rate independent
      var zt = g.cam.zoomT || g.cam.zoom;
      if (Math.abs(zt - g.cam.zoom) > 0.0008) {
        g.cam.zoom += (zt - g.cam.zoom) * ease;
        g.viewW = IF.render.cw / g.cam.zoom;
        g.viewH = IF.render.ch / g.cam.zoom;
      } else g.cam.zoom = zt;
      this.driveTarget(g, dt);
      g.cam.tx = IF.clamp(g.cam.tx, 0, Math.max(0, g.map.pxW - g.viewW));
      g.cam.ty = IF.clamp(g.cam.ty, 0, Math.max(0, g.map.pxH - g.viewH));
      g.cam.x += (g.cam.tx - g.cam.x) * ease;
      g.cam.y += (g.cam.ty - g.cam.y) * ease;
      if (Math.abs(g.cam.tx - g.cam.x) < 0.4) g.cam.x = g.cam.tx;
      if (Math.abs(g.cam.ty - g.cam.y) < 0.4) g.cam.y = g.cam.ty;
    },

    driveTarget: function (g, dt) {
      var sp = this.panSpeed * dt;
      var dx = 0, dy = 0;
      if (this.keys['arrowleft']) dx -= sp;
      if (this.keys['arrowright']) dx += sp;
      if (this.keys['arrowup']) dy -= sp;
      if (this.keys['arrowdown']) dy += sp;

      if (this.mouse.inside && !this.panning) {
        var edge = 26;
        if (this.mouse.x < edge) dx -= sp;
        if (this.mouse.x > g.viewW - edge) dx += sp;
        if (this.mouse.y < edge) dy -= sp;
        if (this.mouse.y > g.viewH - edge) dy += sp;
      }
      if (dx || dy) { g.cam.tx += dx; g.cam.ty += dy; }
    }
  };

  IF.input = IN;
})(window.IF);

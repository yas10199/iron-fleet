/* IRON FRONT — ai.js
   The computer opponent. It plays through exactly the same functions the
   player's buttons call: it pays for things, queues them, and waits. */
(function (IF) {
  'use strict';

  function AI(game, playerId, difficulty) {
    this.game = game;
    this.id = playerId;
    this.diff = IF.DIFFICULTY[difficulty] || IF.DIFFICULTY.normal;
    this.tick = 0;
    this.waveNo = 0;
    this.attackAt = this.diff.firstAttack;
    this.attacking = false;
    this.attackTarget = null;
    this.plan = [
      'power', 'barracks', 'depot', 'refinery', 'radar', 'factory', 'power',
      'bunker', 'lab', 'atgun', 'power', 'airfield', 'aagun', 'barracks', 'atgun', 'factory'
    ];
    this.planIdx = 0;
    this.techPlan = ['weapons1', 'armor1', 'logistics', 'heavy_program', 'aero_program', 'fortify', 'aero_weapons', 'artillery_program'];
  }

  AI.prototype.p = function () { return this.game.players[this.id]; };

  AI.prototype.update = function (dt) {
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 1.0;

    var g = this.game, p = this.p();
    if (p.defeated) return;

    this.manageHarvesters();
    this.manageConstruction();
    this.manageProduction();
    this.manageResearch();
    this.manageDefence();
    this.manageAttack();
  };

  /* --- economy -------------------------------------------------------- */
  AI.prototype.manageHarvesters = function () {
    var g = this.game, p = this.p();
    var trucks = 0, tankers = 0;
    for (var i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (u.dead || u.owner !== this.id) continue;
      if (u.type === 'truck') trucks++;
      if (u.type === 'tanker') tankers++;
      if (u.def.harvest && u.order.type !== 'harvest') u.orderHarvest(null);
    }
    trucks += g.queuedCount(this.id, 'truck');
    tankers += g.queuedCount(this.id, 'tanker');
    if (trucks < this.diff.maxHarvesters && g.hasBuilding(this.id, 'depot')) g.queueUnit(this.id, 'truck');
    if (tankers < this.diff.maxTankers && g.hasBuilding(this.id, 'refinery')) g.queueUnit(this.id, 'tanker');
  };

  AI.prototype.manageConstruction = function () {
    var g = this.game, p = this.p();
    if (g.isConstructing(this.id)) return;
    if (this.planIdx >= this.plan.length) {
      // Late game: keep the lights on, raise the unit limit when we're capped,
      // and only fortify up to a point — endless turrets make for a dull war.
      var defs = 0;
      for (var d = 0; d < g.buildings.length; d++) {
        var bb = g.buildings[d];
        if (!bb.dead && bb.owner === this.id && bb.def.defence) defs++;
      }
      var next;
      if (p.powerBalance < 40) next = 'power';
      else if (p.pop >= p.popCap - 6 && p.popCap < IF.POP_MAX) next = Math.random() < 0.5 ? 'barracks' : 'factory';
      else if (defs < 8) next = Math.random() < 0.5 ? 'atgun' : 'bunker';
      else next = Math.random() < 0.5 ? 'factory' : 'barracks';
      this.plan.push(next);
    }
    var want = this.plan[this.planIdx];
    var def = IF.BUILDINGS[want];
    if (!g.canAfford(this.id, def.cost)) return;
    if (want === 'power' && p.powerBalance > 60) { this.planIdx++; return; }

    var spot = this.findSpot(def, want);
    if (!spot) { this.planIdx++; return; }
    if (g.tryBuild(this.id, want, spot.tx, spot.ty)) this.planIdx++;
  };

  AI.prototype.findSpot = function (def, type) {
    var g = this.game;
    var hq = g.findBuilding(this.id, 'hq');
    if (!hq) return null;
    var cx = hq.tx, cy = hq.ty;
    var towardEnemy = this.id === 0 ? 1 : -1;
    var isDefence = !!def.defence;

    for (var r = 3; r < 16; r++) {
      for (var attempt = 0; attempt < 26; attempt++) {
        var a = Math.random() * Math.PI * 2;
        var tx = Math.round(cx + Math.cos(a) * r + (isDefence ? towardEnemy * r * 0.5 : 0));
        var ty = Math.round(cy + Math.sin(a) * r);
        if (g.map.canPlace(tx, ty, def.w, def.h) && g.hasSpaceAround(tx, ty, def)) return { tx: tx, ty: ty };
      }
    }
    return null;
  };

  /* --- production ----------------------------------------------------- */
  AI.prototype.manageProduction = function () {
    var g = this.game, p = this.p();
    if (p.pop >= p.popCap - 2) return;

    var have = this.countArmy();
    var wantInf = 6 + this.waveNo * 2;

    if (g.hasBuilding(this.id, 'barracks') && have.inf < wantInf && g.queueLength(this.id, 'inf') < 2) {
      var pool = ['rifle', 'rifle', 'mg', 'at_inf'];
      if (have.inf > 4) pool.push('sniper');
      if (have.engineer < 2) pool.push('engineer');
      g.queueUnit(this.id, IF.pick(pool));
    }
    if (g.hasBuilding(this.id, 'factory') && p.fuel > 250 && g.queueLength(this.id, 'veh') < 2) {
      var vpool = ['light', 'halftrack', 'medium', 'medium'];
      if (p.tech.heavy_program) vpool.push('heavy', 'heavy');
      if (p.tech.artillery_program && have.arty < 2) vpool.push('artillery');
      g.queueUnit(this.id, IF.pick(vpool));
    }
    if (g.hasBuilding(this.id, 'airfield') && p.fuel > 400 && have.air < 4 + this.waveNo && g.queueLength(this.id, 'air') < 2) {
      var apool = ['fighter'];
      if (p.tech.aero_program) apool.push('attacker', 'bomber');
      g.queueUnit(this.id, IF.pick(apool));
    }
  };

  AI.prototype.countArmy = function () {
    var g = this.game, c = { inf: 0, veh: 0, air: 0, arty: 0, engineer: 0, total: 0 };
    for (var i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (u.dead || u.owner !== this.id || u.def.harvest) continue;
      if (u.type === 'engineer') { c.engineer++; continue; }
      if (u.type === 'artillery') c.arty++;
      c[u.def.cat === 'air' ? 'air' : (u.def.cat === 'veh' ? 'veh' : 'inf')]++;
      c.total++;
    }
    return c;
  };

  AI.prototype.manageResearch = function () {
    if (!this.diff.tech) return;
    var g = this.game, p = this.p();
    if (p.research || !g.hasBuilding(this.id, 'lab')) return;
    for (var i = 0; i < this.techPlan.length; i++) {
      var t = this.techPlan[i];
      if (p.tech[t]) continue;
      if (g.startResearch(this.id, t)) return;
      return; // can't afford the next one yet — wait rather than skip ahead
    }
  };

  /* --- defence --------------------------------------------------------
     Only the home garrison answers an alarm. Units already committed to an
     assault keep going, otherwise both sides just walk back and forth. */
  AI.prototype.manageDefence = function () {
    var g = this.game;
    var hq = g.findBuilding(this.id, 'hq');
    if (!hq) { this.defending = false; return; }
    var threat = null, bestD = 750 * 750;
    for (var i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (u.dead || u.owner === this.id || u.def.domain === 'air') continue;
      var d = IF.dist2(u.x, u.y, hq.x, hq.y);
      if (d < bestD) { bestD = d; threat = u; }
    }
    if (!threat) { this.defending = false; return; }
    this.defending = true;
    var critical = bestD < 420 * 420;
    var army = this.armyUnits();
    for (var k = 0; k < army.length; k++) {
      var a = army[k];
      if (a.aiRole === 'assault' && !critical) continue;
      if (a.def.domain === 'air') { if (a.astate === 'parked') this.launch(a, threat); continue; }
      if (IF.dist2(a.x, a.y, hq.x, hq.y) > 1200 * 1200) continue;
      if (a.order.type === 'attack') continue;
      a.orderMove(threat.x, threat.y, true);
    }
  };

  /* --- attacking ------------------------------------------------------ */
  AI.prototype.armyUnits = function () {
    var g = this.game, out = [];
    for (var i = 0; i < g.units.length; i++) {
      var u = g.units[i];
      if (u.dead || u.owner !== this.id || u.def.harvest || u.type === 'engineer') continue;
      if (!u.aiRole) u.aiRole = 'defend';
      out.push(u);
    }
    return out;
  };

  AI.prototype.manageAttack = function () {
    var g = this.game, i, u;

    // Keep an assault that's already under way moving forward.
    if (this.assault && this.assault.length) {
      this.assault = this.assault.filter(function (x) { return !x.dead; });
      if (!this.assaultTarget || this.assaultTarget.dead) this.assaultTarget = this.pickTarget();
      if (!this.assaultTarget || this.assault.length < Math.max(2, this.assaultSize * 0.2)) {
        for (i = 0; i < this.assault.length; i++) this.assault[i].aiRole = 'defend';
        this.assault = [];
      } else {
        var t = this.assaultTarget;
        // Nudge the whole group along every few seconds. Anything that has
        // bogged down on terrain gets a fresh route instead of sitting there.
        var nudge = g.time >= (this.reorderAt || 0);
        if (nudge) this.reorderAt = g.time + 6;
        for (i = 0; i < this.assault.length; i++) {
          u = this.assault[i];
          if (u.def.domain === 'air') { if (u.astate === 'parked') this.launch(u, t); continue; }
          if (u.autoTarget && !u.autoTarget.dead) continue;   // busy fighting
          var arrived = IF.dist2(u.x, u.y, u.order.x, u.order.y) < 130 * 130;
          if (u.order.type === 'idle' || arrived || (nudge && u.order.type !== 'attack')) {
            u.orderMove(t.x + IF.rand(-80, 80), t.y + IF.rand(-80, 80), true);
          }
        }
        return;
      }
    }

    if (this.defending) return;
    if (g.time < this.attackAt) return;

    var reserve = this.armyUnits().filter(function (x) { return x.aiRole !== 'assault'; });
    var ground = reserve.filter(function (x) { return x.def.domain !== 'air'; });
    var needed = this.diff.waveSize + Math.floor(this.waveNo * this.diff.waveGrowth * 1.5);
    if (ground.length < Math.min(needed, 24)) { this.attackAt = g.time + 8; return; }

    var target = this.pickTarget();
    if (!target) return;

    this.waveNo++;
    this.attackAt = g.time + this.diff.attackGap;
    this.assaultTarget = target;
    this.assault = reserve.slice();
    this.assaultSize = this.assault.length;
    this.reorderAt = g.time + 6;

    // Leave a couple of defenders at home rather than emptying the base.
    for (i = 0; i < 2 && this.assault.length > 4; i++) this.assault.pop();

    for (i = 0; i < this.assault.length; i++) {
      u = this.assault[i];
      u.aiRole = 'assault';
      if (u.def.domain === 'air') { if (u.astate === 'parked') this.launch(u, target); }
      else u.orderMove(target.x + IF.rand(-80, 80), target.y + IF.rand(-80, 80), true);
    }
    if (this.id !== 0) g.warn('Enemy attack wave inbound — wave ' + this.waveNo);
  };

  AI.prototype.launch = function (plane, fallback) {
    var g = this.game, best = null, bestScore = -1;
    var enemy = 1 - this.id;
    var prefer = plane.type === 'fighter' ? 'air' : (plane.type === 'bomber' ? 'building' : 'vehicle');

    var consider = function (e) {
      if (e.dead || e.owner !== enemy) return;
      var w = plane.def.weapon;
      if ((IF.DMG[w.type][e.armor] || 0) < 0.2) return;
      var score = 1;
      if (prefer === 'air' && e.armor === 'air') score = 10;
      if (prefer === 'building' && e.kind === 'building') score = 8 + (e.type === 'hq' ? 4 : 0);
      if (prefer === 'vehicle' && e.armor === 'vehicle') score = 8;
      score -= IF.dist(plane.x, plane.y, e.x, e.y) / 2000;
      if (score > bestScore) { bestScore = score; best = e; }
    };
    for (var i = 0; i < g.units.length; i++) consider(g.units[i]);
    for (var b = 0; b < g.buildings.length; b++) consider(g.buildings[b]);

    if (!best) best = fallback;
    if (best) { plane.orderAttack(best); plane.astate = 'mission'; plane.order.hostile = true; }
  };

  AI.prototype.pickTarget = function () {
    var g = this.game, enemy = 1 - this.id;
    // Push on whatever is closest to our HQ first, then the enemy HQ itself.
    var hq = g.findBuilding(this.id, 'hq');
    var best = null, bd = Infinity;
    for (var i = 0; i < g.buildings.length; i++) {
      var b = g.buildings[i];
      if (b.dead || b.owner !== enemy) continue;
      var d = IF.dist2(b.x, b.y, hq ? hq.x : 0, hq ? hq.y : 0);
      var weight = b.def.defence ? 1.4 : 1;
      if (this.waveNo > 3 && b.type === 'hq') weight = 0.5;
      if (d * weight < bd) { bd = d * weight; best = b; }
    }
    return best;
  };

  IF.AI = AI;
})(window.IF);

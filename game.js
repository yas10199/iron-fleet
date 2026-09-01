/* IRON FRONT — game.js
   The match itself: players, resources, production queues, research,
   the update loop, and the win/lose check. */
(function (IF) {
  'use strict';

  var T = IF.TILE;

  function Game(opts) {
    this.opts = opts;
    this.map = new IF.GameMap(opts.seed);
    this.units = [];
    this.buildings = [];
    this.projectiles = [];
    this.effects = [];
    this.selection = [];
    this.decals = [];
    this.strikes = [];
    this.targeting = null;
    this.shakeAmt = 0; this.shakeX = 0; this.shakeY = 0;
    this.hash = new IF.SpatialHash(96);
    this._tmpQ = [];
    this._tmpQ2 = [];
    this._tmpQ3 = [];
    this._id = 1;
    this.time = 0;
    this.over = null;
    this.paused = false;
    this.speed = 1;
    this.messages = [];
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.viewW = 1200; this.viewH = 700;

    this.players = [
      this.makePlayer(0, opts.playerFaction, false),
      this.makePlayer(1, opts.enemyFaction, true)
    ];
    this.players[1].incomeMult = IF.DIFFICULTY[opts.difficulty].income;
    this.players[1].aiBuildSpeed = IF.DIFFICULTY[opts.difficulty].buildSpeed;
    this.ai = new IF.AI(this, 1, opts.difficulty);

    this.fog = new IF.Fog(this);
    this.setupBases();
    this.centerOn(this.players[0].hqStart.x, this.players[0].hqStart.y);
  }

  Game.prototype.makePlayer = function (id, factionId, isAI) {
    var f = IF.FACTIONS[factionId];
    return {
      id: id, faction: f, mods: f.mods, isAI: isAI,
      supplies: IF.START.supplies, fuel: IF.START.fuel,
      tech: {}, research: null,
      powerProd: 0, powerUse: 0, powerBalance: 0,
      pop: 0, popCap: 0, popQueued: 0,
      queues: { inf: [], veh: [], air: [], sup: [], fue: [] },
      incomeMult: 1,
      defeated: false,
      powerPts: 1, powerCharge: 0, cooldowns: {}, killTally: 0,
      stats: { supplies: 0, fuel: 0, killedUnits: 0, lostUnits: 0, killedBuildings: 0, lostBuildings: 0 }
    };
  };

  Game.prototype.nextId = function () { return this._id++; };

  Game.prototype.setupBases = function () {
    for (var i = 0; i < 2; i++) {
      var b = this.map.bases[i];
      var hq = this.addBuilding('hq', i, b.tx, b.ty, true);
      this.players[i].hqStart = { x: hq.x, y: hq.y };
      this.addBuilding('power', i, b.tx + (i === 0 ? -3 : 5), b.ty, true);
      var dep = this.addBuilding('depot', i, b.tx + (i === 0 ? 0 : 1), b.ty + 5, true);
      var sp = dep.spawnPoint();
      for (var k = 0; k < 2; k++) {
        var u = this.spawnUnit('truck', i, sp.x + k * 26, sp.y + 18);
        u.orderHarvest(null);
      }
      for (var r = 0; r < 2; r++) this.spawnUnit('rifle', i, hq.x + IF.rand(-60, 60), hq.y + 80);
    }
    this.recalc();
  };

  /* Scorch marks, craters and burnt-out hulls stay on the battlefield so a
     long fight leaves visible history behind it. */
  Game.prototype.addDecal = function (x, y, type, r, extra) {
    var life = 999999;
    if (type === 'wreck') life = 90;
    else if (type === 'track') life = 18;
    var d = { x: x, y: y, type: type, r: r, age: 0, life: life, rot: Math.random() * 6.283 };
    if (extra) for (var k in extra) d[k] = extra[k];
    this.decals.push(d);
    if (this.decals.length > 900) this.decals.shift();
  };

  Game.prototype.shake = function (amount, x, y) {
    if (x !== undefined) {
      var cx = this.cam.x + this.viewW / 2, cy = this.cam.y + this.viewH / 2;
      var d = IF.dist(x, y, cx, cy);
      amount *= IF.clamp(1 - d / (this.viewW * 0.9), 0, 1);
    }
    if (amount > this.shakeAmt) this.shakeAmt = amount;
  };

  Game.prototype.hasRadar = function (pid) {
    if (!IF.REQUIRE_RADAR) return true;
    return this.hasBuilding(pid, 'radar') && this.players[pid].powerBalance >= 0;
  };

  Game.prototype.centerOn = function (x, y) {
    this.cam.x = IF.clamp(x - this.viewW / 2, 0, Math.max(0, this.map.pxW - this.viewW));
    this.cam.y = IF.clamp(y - this.viewH / 2, 0, Math.max(0, this.map.pxH - this.viewH));
  };

  /* ---------------------------------------------------------- spawning */
  Game.prototype.addBuilding = function (type, owner, tx, ty, instant) {
    var b = new IF.Building(this, type, owner, tx, ty, instant);
    this.buildings.push(b);
    this.map.occupy(b);
    if (instant) this.onBuildingComplete(b, true);
    this.recalc();
    return b;
  };

  Game.prototype.spawnUnit = function (type, owner, x, y) {
    var u = new IF.Unit(this, type, owner, x, y);
    this.units.push(u);
    this.recalc();
    return u;
  };

  Game.prototype.onBuildingComplete = function (b, silent) {
    this.recalc();
    if (!silent) {
      if (b.owner === 0) { IF.audio.play('complete'); IF.audio.eva('Construction complete'); this.msg(b.def.name + ' ready'); }
    }
    if (b.def.freeUnit) {
      var sp = b.spawnPoint();
      var u = this.spawnUnit(b.def.freeUnit, b.owner, sp.x, sp.y);
      u.orderHarvest(null);
    }
    if (b.type === 'airfield') {
      // planes already in the air get somewhere to land
      for (var i = 0; i < this.units.length; i++) {
        var p = this.units[i];
        if (p.owner === b.owner && p.def.cat === 'air' && !p.home) p.home = b;
      }
    }
  };

  Game.prototype.deliverUnit = function (building, unitId) {
    var sp = building.spawnPoint();
    var u = this.spawnUnit(unitId, building.owner, sp.x, sp.y);
    if (u.def.harvest) {
      u.orderHarvest(null);
    } else if (u.def.cat === 'air') {
      u.home = building;
      u.x = building.x; u.y = building.y;
      u.astate = 'parked';
    } else if (building.rally) {
      u.orderMove(building.rally.x, building.rally.y, false);
    }
    if (building.owner === 0) { IF.audio.play('complete', u.x, u.y); IF.audio.eva('Unit ready'); }
    this.recalc();
    return u;
  };

  /* ------------------------------------------------------------ death */
  Game.prototype.kill = function (e, attacker) {
    if (e.dead) return;
    e.dead = true;
    var owner = this.players[e.owner];
    var killer = attacker ? this.players[attacker.owner] : null;

    if (e.kind === 'building') {
      // Anything half-built inside it is refunded rather than silently lost.
      if (e.busy) {
        var refund = this.unitCost(e.owner, e.busy.unitId);
        owner.supplies += refund.s; owner.fuel += refund.f;
        if (e.owner === 0) this.msg('Production refunded — ' + IF.UNITS[e.busy.unitId].name + ' lost with the building');
        e.busy = null;
      }
      this.map.release(e);
      owner.stats.lostBuildings++;
      if (killer && killer !== owner) killer.stats.killedBuildings++;
      IF.fx.explosion(this, e.x, e.y, Math.max(e.w, e.h) * 0.8);
      for (var i = 0; i < 6; i++) {
        IF.fx.smoke(this, e.x + IF.rand(-e.w / 2, e.w / 2), e.y + IF.rand(-e.h / 2, e.h / 2), IF.rand(10, 22));
      }
      IF.audio.play('boom', e.x, e.y);
      this.addDecal(e.x, e.y, 'scorch', Math.max(e.w, e.h) * 0.55);
      this.shake(14, e.x, e.y);
      if (e.type === 'hq') this.endMatch(1 - e.owner);
    } else {
      owner.stats.lostUnits++;
      if (killer && killer !== owner) killer.stats.killedUnits++;
      IF.fx.explosion(this, e.x, e.y, e.armor === 'infantry' ? 9 : 20);
      if (e.armor !== 'infantry') {
        IF.fx.smoke(this, e.x, e.y, 14);
        this.addDecal(e.x, e.y, 'wreck', e.rad, { facing: e.facing, kindW: e.def.harvest ? 'truck' : 'tank' });
        this.addDecal(e.x, e.y, 'scorch', e.rad * 1.4);
        this.shake(5, e.x, e.y);
      }
    }
    if (attacker && attacker.owner !== e.owner) {
      IF.Powers.awardKill(this, attacker.owner);
      if (attacker.kind === 'unit' && attacker.addKill) attacker.addKill(this);
    }
    var s = this.selection.indexOf(e);
    if (s >= 0) this.selection.splice(s, 1);
    this.recalc();
  };

  /* ------------------------------------------------------- bookkeeping */
  Game.prototype.recalc = function () {
    for (var pi = 0; pi < 2; pi++) {
      var p = this.players[pi];
      p.powerProd = 0; p.powerUse = 0; p.popCap = 0; p.pop = 0;
    }
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (b.dead || !b.complete) continue;
      var pl = this.players[b.owner];
      if (b.def.power > 0) pl.powerProd += b.def.power; else pl.powerUse += -b.def.power;
      pl.popCap += b.def.pop;
    }
    for (var u = 0; u < this.units.length; u++) {
      var un = this.units[u];
      if (un.dead) continue;
      this.players[un.owner].pop += un.def.pop;
    }
    for (var k = 0; k < 2; k++) {
      var pp = this.players[k];
      pp.powerBalance = pp.powerProd - pp.powerUse;
      pp.popCap = Math.min(IF.POP_MAX, pp.popCap);
    }
  };

  Game.prototype.canAfford = function (pid, cost) {
    var p = this.players[pid];
    return p.supplies >= (cost.s || 0) && p.fuel >= (cost.f || 0);
  };
  Game.prototype.pay = function (pid, cost) {
    var p = this.players[pid];
    p.supplies -= (cost.s || 0);
    p.fuel -= (cost.f || 0);
  };

  Game.prototype.unitCost = function (pid, id) {
    var d = IF.UNITS[id], p = this.players[pid];
    var s = d.cost.s, f = d.cost.f || 0;
    if (d.armor === 'infantry') s *= p.mods.infCost;
    return { s: Math.round(s), f: Math.round(f) };
  };

  Game.prototype.unitBuildTime = function (pid, id) {
    var d = IF.UNITS[id], p = this.players[pid];
    var t = d.build * p.mods.buildSpeed;
    if (p.tech.logistics && (d.cat === 'veh')) t *= 0.75;
    if (p.isAI && p.aiBuildSpeed) t *= p.aiBuildSpeed;
    return t;
  };

  Game.prototype.unitAvailable = function (pid, id) {
    var d = IF.UNITS[id], p = this.players[pid];
    if (d.requires && !p.tech[d.requires]) return false;
    return this.hasBuilding(pid, d.from);
  };

  /* --------------------------------------------------------- commands */
  Game.prototype.queueUnit = function (pid, id) {
    var p = this.players[pid], d = IF.UNITS[id];
    if (!this.unitAvailable(pid, id)) { if (pid === 0) this.deny('Requires ' + (d.requires ? IF.TECH[d.requires].name : IF.BUILDINGS[d.from].name)); return false; }
    if (p.pop + p.popQueued + d.pop > p.popCap) { if (pid === 0) this.deny('Unit limit reached — build a Barracks, Factory or Airfield'); return false; }
    var cost = this.unitCost(pid, id);
    if (!this.canAfford(pid, cost)) { if (pid === 0) this.deny('Not enough ' + (p.supplies < cost.s ? 'supplies' : 'fuel')); return false; }
    this.pay(pid, cost);
    p.popQueued += d.pop;
    p.queues[d.cat].push({ id: id, cost: cost });
    if (pid === 0) IF.audio.play('order');
    return true;
  };

  Game.prototype.cancelQueue = function (pid, cat) {
    var p = this.players[pid], q = p.queues[cat];
    if (!q.length) return;
    var item = q.pop();
    p.supplies += item.cost.s; p.fuel += item.cost.f;
    p.popQueued -= IF.UNITS[item.id].pop;
  };

  Game.prototype.pumpQueues = function (dt) {
    for (var pid = 0; pid < 2; pid++) {
      var p = this.players[pid];
      for (var cat in p.queues) {
        var q = p.queues[cat];
        if (!q.length) continue;
        var producer = this.idleProducer(pid, cat);
        if (!producer) continue;
        var item = q.shift();
        p.popQueued -= IF.UNITS[item.id].pop;
        var t = this.unitBuildTime(pid, item.id);
        producer.busy = { unitId: item.id, left: t, total: t };
      }
    }
  };

  Game.prototype.queueLength = function (pid, cat) {
    return this.players[pid].queues[cat] ? this.players[pid].queues[cat].length : 0;
  };

  Game.prototype.queuedCount = function (pid, unitId) {
    var q = this.players[pid].queues[IF.UNITS[unitId].cat], n = 0;
    for (var i = 0; i < q.length; i++) if (q[i].id === unitId) n++;
    for (var b = 0; b < this.buildings.length; b++) {
      var bl = this.buildings[b];
      if (!bl.dead && bl.owner === pid && bl.busy && bl.busy.unitId === unitId) n++;
    }
    return n;
  };

  Game.prototype.idleProducer = function (pid, cat) {
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (b.dead || !b.complete || b.owner !== pid) continue;
      if (b.def.produces === cat && !b.busy) return b;
    }
    return null;
  };

  Game.prototype.canPlaceForPlayer = function (pid, type, tx, ty) {
    var def = IF.BUILDINGS[type];
    if (!this.map.canPlace(tx, ty, def.w, def.h)) return false;
    // must be near something you already own
    var cx = tx * T + def.w * T / 2, cy = ty * T + def.h * T / 2;
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (b.dead || b.owner !== pid) continue;
      if (IF.dist(cx, cy, b.x, b.y) < 9 * T + b.rad) return true;
    }
    return false;
  };

  Game.prototype.hasSpaceAround = function (tx, ty, def) {
    var open = 0;
    for (var x = tx - 1; x <= tx + def.w; x++) {
      if (this.map.passTile(x, ty - 1, 'wheel')) open++;
      if (this.map.passTile(x, ty + def.h, 'wheel')) open++;
    }
    return open >= 3;
  };

  Game.prototype.tryBuild = function (pid, type, tx, ty) {
    var def = IF.BUILDINGS[type];
    if (!this.canPlaceForPlayer(pid, type, tx, ty)) { if (pid === 0) this.deny('Build closer to your base, on clear ground'); return false; }
    if (!this.canAfford(pid, def.cost)) { if (pid === 0) this.deny('Not enough resources'); return false; }
    this.pay(pid, def.cost);
    var b = this.addBuilding(type, pid, tx, ty, false);
    if (pid === 0) { IF.audio.play('build', b.x, b.y); }
    return true;
  };

  Game.prototype.startResearch = function (pid, techId) {
    var p = this.players[pid], t = IF.TECH[techId];
    if (p.tech[techId] || p.research) return false;
    if (!this.hasBuilding(pid, 'lab')) { if (pid === 0) this.deny('Research Laboratory required'); return false; }
    if (t.needs && !p.tech[t.needs]) { if (pid === 0) this.deny('Requires ' + IF.TECH[t.needs].name); return false; }
    var cost = { s: Math.round(t.cost.s * p.mods.techCost), f: Math.round((t.cost.f || 0) * p.mods.techCost) };
    if (!this.canAfford(pid, cost)) { if (pid === 0) this.deny('Not enough resources'); return false; }
    this.pay(pid, cost);
    p.research = { id: techId, left: t.time * p.mods.buildSpeed, total: t.time * p.mods.buildSpeed };
    if (pid === 0) IF.audio.play('order');
    return true;
  };

  Game.prototype.techCost = function (pid, techId) {
    var p = this.players[pid], t = IF.TECH[techId];
    return { s: Math.round(t.cost.s * p.mods.techCost), f: Math.round((t.cost.f || 0) * p.mods.techCost) };
  };

  /* ---------------------------------------------------------- lookups */
  Game.prototype.findBuilding = function (pid, type) {
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (!b.dead && b.owner === pid && b.type === type) return b;
    }
    return null;
  };
  Game.prototype.hasBuilding = function (pid, type) {
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (!b.dead && b.complete && b.owner === pid && b.type === type) return true;
    }
    return false;
  };
  Game.prototype.isConstructing = function (pid) {
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (!b.dead && b.owner === pid && !b.complete) return true;
    }
    return false;
  };
  Game.prototype.nearestBuilding = function (pid, type, x, y) {
    var best = null, bd = Infinity;
    for (var i = 0; i < this.buildings.length; i++) {
      var b = this.buildings[i];
      if (b.dead || !b.complete || b.owner !== pid || b.type !== type) continue;
      var d = IF.dist2(x, y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };

  Game.prototype.findTargetForUnit = function (u) {
    var w = u.def.weapon;
    if (!w) return null;
    var sight = Math.max(u.def.sight, w.range + 40);
    var list = this.hash.query(u.x, u.y, sight, this._tmpQ3);
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.owner === u.owner) continue;
      if (!u.canHit(e)) continue;
      var d = IF.dist(u.x, u.y, e.x, e.y);
      if (d > sight) continue;
      var score = 100 - d / 10;
      if (e.armor === 'air' && u.def.cat !== 'air' && w.type !== 'aa') score -= 30;
      if (e.def.weapon) score += 12;
      if (e.def.harvest) score += 6;
      if (score > bestScore) { bestScore = score; best = e; }
    }
    if (best) return best;

    // nothing alive nearby: shoot at buildings we're standing next to
    if (u.order.hostile || u.order.type === 'attackmove') {
      var br = w.range + 30;
      for (var b = 0; b < this.buildings.length; b++) {
        var bl = this.buildings[b];
        if (bl.dead || bl.owner === u.owner) continue;
        if (!u.canHit(bl)) continue;
        if (IF.dist(u.x, u.y, bl.x, bl.y) - bl.rad < br) return bl;
      }
    }
    return null;
  };

  Game.prototype.findTargetForBuilding = function (b) {
    var w = b.def.weapon, r = w.range;
    var list = this.hash.query(b.x, b.y, r + b.rad, this._tmpQ3);
    var best = null, bd = Infinity;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.owner === b.owner) continue;
      if (b.def.airOnly && e.armor !== 'air') continue;
      if (!b.def.airOnly && e.armor === 'air') continue;
      if ((IF.DMG[w.type][e.armor] || 0) < 0.05) continue;
      var d = IF.dist2(b.x, b.y, e.x, e.y);
      if (d < bd && Math.sqrt(d) <= r + b.rad * 0.4) { bd = d; best = e; }
    }
    return best;
  };

  /* -------------------------------------------------------- explosions */
  Game.prototype.damageBridge = function (x, y, r, amount) {
    for (var i = 0; i < this.map.bridges.length; i++) {
      var br = this.map.bridges[i];
      if (br.dead) continue;
      var bx = br.x * T, by = br.y * T;
      if (IF.dist(x, y, bx, by) > r + 90) continue;
      br.hp -= amount;
      if (br.hp <= 0) {
        this.map.destroyBridge(br);
        this.msg('A bridge has collapsed');
        IF.fx.explosion(this, bx, by, 70);
        IF.audio.play('boom', bx, by);
        if (this.onTerrainChanged) this.onTerrainChanged();
      }
    }
  };

  /* ------------------------------------------------------------ update */
  Game.prototype.update = function (dt) {
    if (this.paused || this.over) return;
    dt *= this.speed;
    this.time += dt;

    // spatial index
    this.hash.clear();
    var i;
    for (i = 0; i < this.units.length; i++) if (!this.units[i].dead) this.hash.insert(this.units[i]);

    IF.Path.tick(this.map);

    for (i = 0; i < this.units.length; i++) { var u = this.units[i]; if (!u.dead) u.update(dt, this); }
    for (i = 0; i < this.buildings.length; i++) { var b = this.buildings[i]; if (!b.dead) b.update(dt, this); }

    for (i = this.projectiles.length - 1; i >= 0; i--) {
      var pr = this.projectiles[i];
      pr.update(dt, this);
      if (pr.dead) this.projectiles.splice(i, 1);
    }

    // Field requisition: a slow trickle from each surviving HQ. It is far too
    // small to live on, but it means losing every truck is never a dead end.
    for (var hq = 0; hq < 2; hq++) {
      if (this.findBuilding(hq, 'hq')) {
        var pl = this.players[hq];
        pl.supplies += 2.5 * dt;
        pl.stats.supplies += 2.5 * dt;
      }
    }

    IF.fx.update(this, dt);
    IF.Powers.update(this, dt);
    this.fog.update(dt, 0);

    for (var dc = this.decals.length - 1; dc >= 0; dc--) {
      this.decals[dc].age += dt;
      if (this.decals[dc].age >= this.decals[dc].life) this.decals.splice(dc, 1);
    }
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 34);
      this.shakeX = IF.rand(-this.shakeAmt, this.shakeAmt);
      this.shakeY = IF.rand(-this.shakeAmt, this.shakeAmt);
    } else { this.shakeX = 0; this.shakeY = 0; }

    this.pumpQueues(dt);

    // research
    for (var pid = 0; pid < 2; pid++) {
      var p = this.players[pid];
      if (p.research) {
        p.research.left -= dt * (p.powerBalance < 0 ? 0.5 : 1);
        if (p.research.left <= 0) {
          p.tech[p.research.id] = true;
          if (pid === 0) { this.msg(IF.TECH[p.research.id].name + ' complete'); IF.audio.play('complete'); }
          p.research = null;
          this.applyTechToExisting(pid);
        }
      }
    }

    var me = this.players[0];
    if (me.powerBalance < 0 && this.time - (this._powWarn || -99) > 40) {
      this._powWarn = this.time;
      this.warn('Low power — production slowed and defences offline');
      IF.audio.eva('Low power');
    }

    this.ai.update(dt);
    if (this.time - (this._aiPower || 0) > 6) { this._aiPower = this.time; IF.Powers.aiThink(this, this.ai); }

    // Sweep dead units out of the list now and then. Destroyed buildings stay
    // in the array on purpose — the renderer draws them as ruins.
    if (this.time - (this._lastSweep || 0) > 4) {
      this._lastSweep = this.time;
      this.units = this.units.filter(function (x) { return !x.dead; });
    }

    for (var m = this.messages.length - 1; m >= 0; m--) {
      this.messages[m].t -= dt;
      if (this.messages[m].t <= 0) this.messages.splice(m, 1);
    }
  };

  Game.prototype.applyTechToExisting = function (pid) {
    // Armour upgrade retro-fits existing vehicles.
    for (var i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.dead || u.owner !== pid || u.armor !== 'vehicle') continue;
      var p = this.players[pid];
      if (p.tech.armor1 && !u._armored) {
        u._armored = true;
        var ratio = u.hp / u.maxHp;
        u.maxHp = Math.round(u.maxHp * 1.2);
        u.hp = u.maxHp * ratio;
      }
    }
  };

  /* --------------------------------------------------------- messages */
  /* One "under attack" warning at a time, not one per shell. */
  Game.prototype.baseAlert = function (b) {
    if (this.time - (this._alertAt || -99) < 25) return;
    this._alertAt = this.time;
    this.warn('Our base is under attack');
    IF.audio.eva('Warning, our base is under attack');
    if (b) this.alertAt = { x: b.x, y: b.y, t: this.time };
  };

  Game.prototype.msg = function (text) { this.messages.push({ text: text, t: 5, warn: false }); };
  Game.prototype.warn = function (text) {
    this.messages.push({ text: text, t: 6, warn: true });
    IF.audio.play('alert');
  };
  Game.prototype.deny = function (text) {
    this.messages.push({ text: text, t: 3, warn: true });
    IF.audio.play('deny');
  };

  /* ---------------------------------------------------------- endgame */
  Game.prototype.endMatch = function (winner) {
    if (this.over) return;
    this.over = { winner: winner, time: this.time };
    this.players[1 - winner].defeated = true;
    IF.audio.play(winner === 0 ? 'victory' : 'defeat');
    IF.audio.eva(winner === 0 ? 'Mission accomplished' : 'Our headquarters has been destroyed');
    if (IF.ui) IF.ui.showResults(this);
  };

  IF.Game = Game;
})(window.IF);

/* IRON FRONT — entities.js
   Everything that sits on the battlefield: Buildings and Units. */
(function (IF) {
  'use strict';

  var T = IF.TILE;

  /* ==================================================================
     BUILDING
     ================================================================== */
  function Building(game, defId, owner, tx, ty, instant) {
    this.game = game;
    this.id = game.nextId();
    this.kind = 'building';
    this.def = IF.BUILDINGS[defId];
    this.type = defId;
    this.owner = owner;
    this.armor = 'building';
    this.tx = tx; this.ty = ty;
    this.w = this.def.w * T; this.h = this.def.h * T;
    this.x = tx * T + this.w / 2;
    this.y = ty * T + this.h / 2;
    this.rad = Math.max(this.w, this.h) / 2;

    var p = game.players[owner];
    var mods = p.mods;
    var hpMult = this.def.defence ? mods.defHp : 1;
    this.maxHp = Math.round(this.def.hp * hpMult * (p.tech.fortify && this.def.defence ? 1.25 : 1));
    this.buildTime = this.def.build * mods.buildSpeed;
    this.complete = !!instant || this.def.build === 0;
    this.progress = this.complete ? 1 : 0;
    this.hp = this.complete ? this.maxHp : Math.max(1, this.maxHp * 0.15);
    this.dead = false;
    this.cool = 0;
    this.busy = null;         // { unitId, left, total }
    this.rally = null;
    this.turret = -Math.PI / 2;
    this.smokeTimer = 0;
    this.lastHit = -99;
  }

  Building.prototype.powered = function () {
    var p = this.game.players[this.owner];
    return p.powerBalance >= 0 || this.def.power > 0;
  };

  Building.prototype.update = function (dt, game) {
    var p = game.players[this.owner];
    if (this.recoil > 0) this.recoil -= dt * 4;

    if (!this.complete) {
      var rate = p.powerBalance < 0 ? 0.55 : 1;
      this.progress += (dt / this.buildTime) * rate;
      this.hp = Math.max(this.hp, this.maxHp * (0.15 + 0.85 * this.progress));
      if (this.progress >= 1) {
        this.progress = 1;
        this.complete = true;
        this.hp = this.maxHp;
        game.onBuildingComplete(this);
      }
      return;
    }

    // Production
    if (this.busy) {
      var speed = p.powerBalance < 0 ? 0.5 : 1;
      this.busy.left -= dt * speed;
      if (this.busy.left <= 0) {
        var id = this.busy.unitId;
        this.busy = null;
        game.deliverUnit(this, id);
      }
    }

    // Defensive fire
    if (this.def.defence && this.def.weapon) {
      this.cool -= dt;
      if (p.powerBalance < 0) return;
      if (!this.target || this.target.dead || !this.inRange(this.target)) {
        this.target = game.findTargetForBuilding(this);
      }
      if (this.target) {
        this.turret = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        if (this.cool <= 0) {
          var w = this.weapon();
          this.cool = w.rof;
          IF.fireWeapon(game, this, this.target, w);
        }
      }
    }

    if (this.hp < this.maxHp * 0.5) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = this.hp < this.maxHp * 0.25 ? 0.35 : 0.9;
        IF.fx.smoke(game, this.x + IF.rand(-this.w / 3, this.w / 3), this.y + IF.rand(-this.h / 3, this.h / 3), IF.rand(6, 12));
      }
    }
  };

  Building.prototype.weapon = function () {
    var w = this.def.weapon, p = this.game.players[this.owner];
    var dmg = w.dmg;
    if (p.tech.fortify) dmg *= 1.25;
    return { dmg: dmg, rof: w.rof, range: w.range, type: w.type };
  };

  Building.prototype.inRange = function (t) {
    return IF.dist(this.x, this.y, t.x, t.y) <= this.def.weapon.range + this.rad * 0.4;
  };

  Building.prototype.spawnPoint = function () {
    var map = this.game.map;
    for (var r = 0; r < 6; r++) {
      for (var y = this.ty - 1 - r; y <= this.ty + this.def.h + r; y++) {
        for (var x = this.tx - 1 - r; x <= this.tx + this.def.w + r; x++) {
          if (x > this.tx - 1 - r && x < this.tx + this.def.w + r && y > this.ty - 1 - r && y < this.ty + this.def.h + r) continue;
          if (map.passTile(x, y, 'wheel')) return { x: x * T + T / 2, y: y * T + T / 2 };
        }
      }
    }
    return { x: this.x, y: this.y + this.h };
  };

  IF.Building = Building;

  /* ==================================================================
     UNIT
     ================================================================== */
  function Unit(game, defId, owner, x, y) {
    this.game = game;
    this.id = game.nextId();
    this.kind = 'unit';
    this.def = IF.UNITS[defId];
    this.type = defId;
    this.owner = owner;
    this.armor = this.def.armor;
    this.x = x; this.y = y;
    this.rad = this.def.r;

    var p = game.players[owner];
    var m = p.mods;
    var hp = this.def.hp;
    if (this.def.cat === 'veh' || this.def.cat === 'sup' || this.def.cat === 'fue') hp *= m.vehHp;
    if (this.def.cat === 'air') hp *= m.airHp;
    if (p.tech.armor1 && this.armor === 'vehicle') hp *= 1.2;
    this.baseMaxHp = Math.round(hp);
    this.maxHp = this.baseMaxHp;
    this.hp = this.maxHp;
    this.kills = 0;
    this.rank = 0;

    this.speed = this.def.speed * m.moveSpeed;
    this.facing = IF.rand(-Math.PI, Math.PI);
    this.turret = this.facing;
    this.path = null;
    this.pathIdx = 0;
    this.pathPending = false;
    this.order = { type: 'idle', x: x, y: y, target: null, hostile: false };
    this.guardX = x; this.guardY = y;
    this.autoTarget = null;
    this.retarget = IF.rand(0, 0.4);
    this.cool = IF.rand(0, 0.4);
    this.dead = false;
    this.vx = 0; this.vy = 0;
    this.dustTimer = 0;
    this.lastHit = -99;
    this.stuck = 0;

    // harvesting
    this.carry = 0;
    this.hstate = 'seek';
    this.hnode = null;
    this.htimer = 0;

    // aircraft
    if (this.def.cat === 'air') {
      this.ammo = this.def.ammo;
      this.astate = 'parked';
      this.home = null;
      this.rearm = 0;
      this.orbit = Math.random() < 0.5 ? 1 : -1;
    }
  }

  /* Promotions, Generals style: kills earn rank, rank earns damage, health
     and — at Elite — the ability to patch yourself up between fights. */
  Unit.prototype.addKill = function (game) {
    this.kills++;
    var newRank = this.rank;
    for (var i = IF.RANKS.length - 1; i > this.rank; i--) {
      if (this.kills >= IF.RANKS[i].kills) { newRank = i; break; }
    }
    if (newRank === this.rank) return;
    this.rank = newRank;
    var r = IF.RANKS[this.rank];
    this.maxHp = Math.round(this.baseMaxHp * r.hp);
    this.hp = this.maxHp;
    IF.fx.text(game, this.x, this.y - this.rad - 14, r.name.toUpperCase(), '#f0d582');
    if (this.owner === 0) {
      IF.audio.play('promote', this.x, this.y);
      IF.audio.ack(this.type, 'promote');
    }
  };

  Unit.prototype.weapon = function () {
    var w = this.def.weapon;
    if (!w) return null;
    var p = this.game.players[this.owner], dmg = w.dmg * IF.RANKS[this.rank].dmg;
    if (this.armor === 'infantry' && p.tech.weapons1) dmg *= 1.25;
    if (this.def.cat === 'air') { dmg *= p.mods.airDmg; if (p.tech.aero_weapons) dmg *= 1.25; }
    if (this.def.cat === 'veh') dmg *= p.mods.vehDmg;
    return { dmg: dmg, rof: w.rof, range: w.range, minRange: w.minRange || 0, splash: w.splash || 0, type: w.type, shell: w.shell };
  };

  Unit.prototype.canHit = function (t) {
    var w = this.def.weapon;
    if (!w || !t || t.dead) return false;
    var tbl = IF.DMG[w.type];
    return (tbl[t.armor] || 0) > 0.05;
  };

  /* --- orders --------------------------------------------------------- */
  /* Shift-clicking stacks waypoints; a unit walks them in order. */
  Unit.prototype.queueWaypoint = function (x, y, hostile) {
    this.waypoints = this.waypoints || [];
    if (this.order.type === 'idle') { this.orderMove(x, y, hostile); return; }
    this.waypoints.push({ x: x, y: y, hostile: !!hostile });
  };

  Unit.prototype.nextWaypoint = function () {
    if (!this.waypoints || !this.waypoints.length) return false;
    var w = this.waypoints.shift();
    this.orderMove(w.x, w.y, w.hostile);
    return true;
  };

  Unit.prototype.orderMove = function (x, y, hostile) {
    this.order = { type: hostile ? 'attackmove' : 'move', x: x, y: y, target: null, hostile: !!hostile };
    this.guardX = x; this.guardY = y;
    this.autoTarget = null;
    this.repathTo(x, y);
  };
  Unit.prototype.orderAttack = function (target) {
    this.order = { type: 'attack', x: target.x, y: target.y, target: target, hostile: true };
    this.autoTarget = null;
    this.repathTo(target.x, target.y);
  };
  Unit.prototype.orderStop = function () {
    this.order = { type: 'idle', x: this.x, y: this.y, target: null, hostile: false };
    this.guardX = this.x; this.guardY = this.y;
    this.path = null;
    this.autoTarget = null;
    this.waypoints = null;
  };
  Unit.prototype.orderHarvest = function (node) {
    this.order = { type: 'harvest', x: this.x, y: this.y, target: null, hostile: false };
    this.hnode = node || null;
    this.hstate = this.carry > 0 ? 'return' : 'seek';
    this.path = null;
  };
  Unit.prototype.orderRepair = function (target) {
    this.order = { type: 'repair', x: target.x, y: target.y, target: target, hostile: false };
    this.repathTo(target.x, target.y);
  };

  Unit.prototype.repathTo = function (x, y) {
    if (this.def.domain === 'air') { this.path = null; return; }
    this.destX = x; this.destY = y;
    IF.Path.request(this, x, y);
  };

  /* --- update --------------------------------------------------------- */
  Unit.prototype.update = function (dt, game) {
    this.cool -= dt;
    this.retarget -= dt;
    if (this.recoil > 0) this.recoil -= dt * 5;

    // Paratroopers hang under the canopy for a moment before they can act.
    if (this.chute > 0) { this.chute -= dt * 0.55; return; }

    var regen = IF.RANKS[this.rank].regen;
    if (regen && this.hp < this.maxHp && game.time - this.lastHit > 6) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * regen * dt);
    }

    if (this.def.domain === 'air') { this.updateAir(dt, game); return; }

    if (this.order.type === 'harvest') { this.updateHarvest(dt, game); return; }
    if (this.order.type === 'repair') { this.updateRepair(dt, game); return; }

    var w = this.weapon();
    var tgt = null, stopToFight = false;

    if (this.order.type === 'attack' && this.order.target) {
      if (this.order.target.dead) { this.orderStop(); }
      else { tgt = this.order.target; stopToFight = true; }
    }

    if (w && !tgt) {
      if (this.autoTarget && (this.autoTarget.dead || IF.dist(this.x, this.y, this.autoTarget.x, this.autoTarget.y) > w.range * 1.6 + 60)) this.autoTarget = null;
      if (!this.autoTarget && this.retarget <= 0) {
        this.retarget = 0.3 + Math.random() * 0.4;
        this.autoTarget = game.findTargetForUnit(this);
      }
      tgt = this.autoTarget;
      if (tgt && (this.order.type === 'attackmove' || this.order.type === 'idle')) stopToFight = true;
    }

    // Move
    var moving = false;
    if (stopToFight && tgt) {
      var d = IF.dist(this.x, this.y, tgt.x, tgt.y) - (tgt.rad || 0);
      if (d > w.range * 0.92) {
        this.chase(tgt, dt, game);
        moving = true;
      } else if (w.minRange && d < w.minRange * 0.8) {
        // artillery backs away from anything that gets close
        var a = Math.atan2(this.y - tgt.y, this.x - tgt.x);
        this.stepTowards(this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 60, dt, game);
        moving = true;
      } else {
        this.path = null;
      }
    } else if (this.order.type === 'move' || this.order.type === 'attackmove') {
      moving = this.followPath(dt, game);
      if (!moving && !this.nextWaypoint()) {
        this.order.type = 'idle';
        this.guardX = this.x; this.guardY = this.y;
      }
    } else if (this.order.type === 'idle' && this.def.repair) {
      // An idle engineer looks for the nearest damaged thing worth fixing.
      this.repairScan = (this.repairScan || 0) - dt;
      if (this.repairScan <= 0) {
        this.repairScan = 1.5;
        var best = null, bd = 420 * 420;
        for (var bi = 0; bi < game.buildings.length; bi++) {
          var bb = game.buildings[bi];
          if (bb.dead || bb.owner !== this.owner || !bb.complete) continue;
          if (bb.hp >= bb.maxHp - 1) continue;
          var dd2 = IF.dist2(this.x, this.y, bb.x, bb.y);
          if (dd2 < bd) { bd = dd2; best = bb; }
        }
        if (best) this.orderRepair(best);
      }
    } else if (this.order.type === 'idle') {
      // drift back towards guard post if pushed away
      if (IF.dist2(this.x, this.y, this.guardX, this.guardY) > 90 * 90) {
        this.stepTowards(this.guardX, this.guardY, dt, game);
      }
    }

    // Fire
    if (w && tgt && !tgt.dead) {
      var dist = IF.dist(this.x, this.y, tgt.x, tgt.y) - (tgt.rad || 0);
      if (dist <= w.range && (!w.minRange || dist >= w.minRange * 0.75)) {
        this.turret = IF.turnTowards(this.turret, Math.atan2(tgt.y - this.y, tgt.x - this.x), 6 * dt);
        if (this.cool <= 0) {
          this.cool = w.rof;
          IF.fireWeapon(game, this, tgt, w);
        }
      }
    } else if (moving) {
      this.turret = IF.turnTowards(this.turret, this.facing, 4 * dt);
    }

    this.separate(dt, game);
    if (this.def.crush) this.crush(game);
  };

  /* Tracks flatten infantry. One of the most satisfying things in this genre,
     and the reason you screen your riflemen with your own armour. */
  Unit.prototype.crush = function (game) {
    var near = game.hash.query(this.x, this.y, this.rad + 10, game._tmpQ2);
    for (var i = 0; i < near.length; i++) {
      var o = near[i];
      if (o.dead || o.owner === this.owner || o.armor !== 'infantry') continue;
      if (IF.dist2(this.x, this.y, o.x, o.y) > (this.rad * 0.85) * (this.rad * 0.85)) continue;
      o.hp = 0;
      game.kill(o, this);
      game.addDecal(o.x, o.y, 'scorch', 9);
      IF.audio.play('crush', o.x, o.y);
    }
  };

  Unit.prototype.chase = function (tgt, dt, game) {
    if (!this.destX || IF.dist2(this.destX, this.destY, tgt.x, tgt.y) > 70 * 70) {
      this.repathTo(tgt.x, tgt.y);
    }
    if (!this.followPath(dt, game)) this.stepTowards(tgt.x, tgt.y, dt, game);
  };

  Unit.prototype.followPath = function (dt, game) {
    if (this.path && this.pathIdx < this.path.length) {
      var wp = this.path[this.pathIdx];
      if (IF.dist2(this.x, this.y, wp.x, wp.y) < 16 * 16) {
        this.pathIdx++;
        if (this.pathIdx >= this.path.length) { this.path = null; }
        else wp = this.path[this.pathIdx];
      }
      if (this.path) return this.stepTowards(wp.x, wp.y, dt, game);
    }
    // No usable route yet: head straight for the destination. The proper path
    // arrives a frame or two later and takes over.
    if (this.destX !== undefined && this.order.type !== 'idle' &&
        IF.dist2(this.x, this.y, this.destX, this.destY) > 24 * 24) {
      return this.stepTowards(this.destX, this.destY, dt, game);
    }
    return false;
  };

  Unit.prototype.stepTowards = function (tx, ty, dt, game) {
    var dx = tx - this.x, dy = ty - this.y;
    var d = Math.hypot(dx, dy);
    if (d < 3) return false;
    var want = Math.atan2(dy, dx);
    this.facing = IF.turnTowards(this.facing, want, (this.armor === 'infantry' ? 9 : 3.4) * dt);
    var terrain = game.map.speedAt(this.x, this.y);
    var sp = this.speed * terrain;
    var nx = this.x + Math.cos(this.facing) * sp * dt;
    var ny = this.y + Math.sin(this.facing) * sp * dt;
    var dom = this.def.domain;

    if (game.map.passWorld(nx, ny, dom)) {
      this.x = nx; this.y = ny; this.stuck = 0;
    } else if (game.map.passWorld(nx, this.y, dom)) {
      this.x = nx; this.stuck += dt;
    } else if (game.map.passWorld(this.x, ny, dom)) {
      this.y = ny; this.stuck += dt;
    } else {
      this.stuck += dt;
    }

    // Traffic jams at bridges and building walls: sidestep, then ask for a
    // fresh route. Without this a queue of units grinds in place forever.
    if (this.stuck > 1.4) {
      this.stuck = 0;
      var side = this.facing + (Math.random() < 0.5 ? 1.7 : -1.7);
      var sxx = this.x + Math.cos(side) * sp * dt * 4;
      var syy = this.y + Math.sin(side) * sp * dt * 4;
      if (game.map.passWorld(sxx, syy, dom)) { this.x = sxx; this.y = syy; }
      else if (this.destX !== undefined) { this.path = null; this.repathTo(this.destX, this.destY); }
    }
    this.x = IF.clamp(this.x, 8, game.map.pxW - 8);
    this.y = IF.clamp(this.y, 8, game.map.pxH - 8);

    if (this.armor === 'vehicle') {
      this.dustTimer -= dt;
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.14;
        IF.fx.dust(game, this.x - Math.cos(this.facing) * this.rad, this.y - Math.sin(this.facing) * this.rad);
      }
      // Tyre and track marks pressed into the ground behind heavy vehicles.
      this.trackTimer = (this.trackTimer || 0) - dt;
      if (this.trackTimer <= 0) {
        this.trackTimer = 1.0;
        game.addDecal(this.x, this.y, 'track', this.rad, { facing: this.facing });
      }
    }
    return true;
  };

  Unit.prototype.separate = function (dt, game) {
    var near = game.hash.query(this.x, this.y, this.rad * 3, game._tmpQ2);
    var px = 0, py = 0, n = 0;
    for (var i = 0; i < near.length; i++) {
      var o = near[i];
      if (o === this || o.dead || o.def.domain === 'air') continue;
      if (this.def.crush && o.armor === 'infantry') continue;
      var dx = this.x - o.x, dy = this.y - o.y;
      var d2 = dx * dx + dy * dy;
      var min = this.rad + o.rad;
      if (d2 > min * min || d2 < 0.01) continue;
      var d = Math.sqrt(d2);
      px += (dx / d) * (min - d);
      py += (dy / d) * (min - d);
      n++;
    }
    if (n) {
      var nx = this.x + px * 5 * dt, ny = this.y + py * 5 * dt;
      if (game.map.passWorld(nx, ny, this.def.domain)) { this.x = nx; this.y = ny; }
    }
  };

  /* --- harvesting ----------------------------------------------------- */
  Unit.prototype.updateHarvest = function (dt, game) {
    var res = this.def.harvest;
    var depotType = res === 'supplies' ? 'depot' : 'refinery';

    if (this.hstate === 'seek') {
      if (!this.hnode || this.hnode.amount <= 0) {
        this.hnode = game.map.nearestNode(this.x, this.y, res, null);
        this.destX = undefined;
      }
      if (!this.hnode) { this.order.type = 'idle'; return; }
      if (this.destX === undefined || IF.dist2(this.destX, this.destY, this.hnode.x, this.hnode.y) > 4) this.repathTo(this.hnode.x, this.hnode.y);
      var d = IF.dist(this.x, this.y, this.hnode.x, this.hnode.y);
      if (d < 34) { this.hstate = 'load'; this.htimer = 0; this.path = null; }
      else this.followPath(dt, game) || this.stepTowards(this.hnode.x, this.hnode.y, dt, game);

    } else if (this.hstate === 'load') {
      var rate = this.def.gatherRate * dt;
      var take = Math.min(rate, this.def.capacity - this.carry, this.hnode ? this.hnode.amount : 0);
      this.carry += take;
      if (this.hnode) this.hnode.amount -= take;
      if (this.carry >= this.def.capacity || !this.hnode || this.hnode.amount <= 0) {
        this.hstate = 'return';
        this.destX = undefined;
      }

    } else if (this.hstate === 'return') {
      var depot = game.nearestBuilding(this.owner, depotType, this.x, this.y);
      if (!depot) {   // nowhere to unload — sit tight
        this.path = null;
        return;
      }
      if (this.destX === undefined || IF.dist2(this.destX, this.destY, depot.x, depot.y) > 4) this.repathTo(depot.x, depot.y);
      var dd = IF.rectDist(this.x, this.y, depot);
      if (dd < 26) {
        this.hstate = 'unload'; this.htimer = 1.1; this.path = null;
      } else this.followPath(dt, game) || this.stepTowards(depot.x, depot.y, dt, game);

    } else if (this.hstate === 'unload') {
      this.htimer -= dt;
      if (this.htimer <= 0) {
        var p = game.players[this.owner];
        var amount = Math.round(this.carry * p.incomeMult);
        if (res === 'supplies') { p.supplies += amount; p.stats.supplies += amount; }
        else { p.fuel += amount; p.stats.fuel += amount; }
        if (this.owner === 0) IF.fx.text(game, this.x, this.y - 14, '+' + amount, res === 'supplies' ? '#e2c46a' : '#7fd0a8');
        this.carry = 0;
        this.hstate = 'seek';
        this.destX = undefined;
      }
    }
    this.separate(dt, game);
  };

  /* --- engineer repair ------------------------------------------------ */
  Unit.prototype.updateRepair = function (dt, game) {
    var t = this.order.target;
    if (!t || t.dead) { this.orderStop(); return; }
    var reach = this.def.repairRange;
    var d = t.kind === 'building' ? IF.rectDist(this.x, this.y, t) : IF.dist(this.x, this.y, t.x, t.y) - t.rad;
    if (d > reach) {
      if (this.destX === undefined || IF.dist2(this.destX, this.destY, t.x, t.y) > 40 * 40) this.repathTo(t.x, t.y);
      this.followPath(dt, game) || this.stepTowards(t.x, t.y, dt, game);
    } else {
      this.path = null;
      if (t.hp < t.maxHp) {
        var p = game.players[this.owner];
        var heal = this.def.repair * dt;
        var cost = heal * 0.35;
        if (p.supplies >= cost) {
          p.supplies -= cost;
          t.hp = Math.min(t.maxHp, t.hp + heal);
          if (Math.random() < dt * 6) IF.fx.push(game, { t: 'spark', x: t.x + IF.rand(-t.rad, t.rad), y: t.y + IF.rand(-t.rad, t.rad), vx: 0, vy: -20, life: 0.4, age: 0, size: 2 });
        }
      } else {
        this.orderStop();
      }
    }
    this.separate(dt, game);
  };

  /* --- aircraft ------------------------------------------------------- */
  Unit.prototype.updateAir = function (dt, game) {
    var w = this.weapon();

    if (this.astate === 'rearm') {
      this.rearm -= dt;
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.06 * dt);
      if (this.rearm <= 0) { this.ammo = this.def.ammo; this.astate = 'parked'; }
      return;
    }

    var tgt = null;
    if (this.order.type === 'attack' && this.order.target && !this.order.target.dead) tgt = this.order.target;
    if (!tgt && this.order.hostile) {
      if (this.autoTarget && this.autoTarget.dead) this.autoTarget = null;
      if (!this.autoTarget && this.retarget <= 0) {
        this.retarget = 0.4;
        this.autoTarget = game.findTargetForUnit(this);
      }
      tgt = this.autoTarget;
    }

    if (this.ammo <= 0 || (!tgt && this.order.type !== 'move' && this.order.type !== 'attackmove')) {
      if (this.astate !== 'parked') this.astate = 'return';
    }

    var gx, gy;
    if (this.astate === 'return' || this.ammo <= 0) {
      var home = this.home && !this.home.dead ? this.home : game.nearestBuilding(this.owner, 'airfield', this.x, this.y);
      if (!home) { gx = this.guardX; gy = this.guardY; }
      else {
        gx = home.x; gy = home.y;
        if (IF.dist(this.x, this.y, home.x, home.y) < 40) {
          this.astate = 'rearm';
          this.rearm = 9;
          this.x = home.x; this.y = home.y;
          this.order = { type: 'idle', x: this.x, y: this.y, target: null, hostile: false };
          this.autoTarget = null;
          return;
        }
      }
    } else if (tgt) {
      this.astate = 'mission';
      var d = IF.dist(this.x, this.y, tgt.x, tgt.y);
      if (d < w.range * 0.75) {
        // bank around the target instead of parking on top of it
        var a = Math.atan2(this.y - tgt.y, this.x - tgt.x) + this.orbit * 0.9;
        gx = tgt.x + Math.cos(a) * w.range * 0.8;
        gy = tgt.y + Math.sin(a) * w.range * 0.8;
      } else { gx = tgt.x; gy = tgt.y; }
    } else {
      this.astate = 'mission';
      gx = this.order.x; gy = this.order.y;
      if (IF.dist(this.x, this.y, gx, gy) < 40) {
        if (this.order.type === 'move') { this.astate = 'return'; }
      }
    }

    var want = Math.atan2(gy - this.y, gx - this.x);
    var before = this.facing;
    this.facing = IF.turnTowards(this.facing, want, 2.2 * dt);
    // Bank into the turn, and lay a thin contrail behind.
    var turn = this.facing - before;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    this.bank = IF.clamp((this.bank || 0) * 0.86 + turn * 9, -0.9, 0.9);
    this.trailTimer = (this.trailTimer || 0) - dt;
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.12;
      IF.fx.trail(game, this.x - Math.cos(this.facing) * this.rad, this.y - Math.sin(this.facing) * this.rad);
    }
    this.x += Math.cos(this.facing) * this.speed * dt;
    this.y += Math.sin(this.facing) * this.speed * dt;
    this.x = IF.clamp(this.x, 4, game.map.pxW - 4);
    this.y = IF.clamp(this.y, 4, game.map.pxH - 4);
    this.turret = this.facing;

    if (Math.random() < dt * 1.5) IF.audio.play('plane', this.x, this.y);

    if (tgt && this.ammo > 0 && this.cool <= 0) {
      var dd = IF.dist(this.x, this.y, tgt.x, tgt.y) - (tgt.rad || 0);
      var facingOk = Math.abs(((Math.atan2(tgt.y - this.y, tgt.x - this.x) - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.9;
      if (dd <= w.range && facingOk) {
        this.cool = w.rof;
        this.ammo--;
        IF.fireWeapon(game, this, tgt, w);
      }
    }
  };

  IF.Unit = Unit;
})(window.IF);

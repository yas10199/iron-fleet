/* IRON FRONT — powers.js
   Command Powers. You earn points just by staying alive and killing things,
   then spend them on off-map support: recon flights, artillery barrages,
   paradrops and, late on, a strike that flattens a city block. */
(function (IF) {
  'use strict';

  var P = {
    /* --- charge ------------------------------------------------------- */
    update: function (g, dt) {
      for (var pid = 0; pid < 2; pid++) {
        var p = g.players[pid];
        if (p.powerPts === undefined) { p.powerPts = 1; p.powerCharge = 0; p.cooldowns = {}; }
        if (p.powerPts < IF.POWER_MAX) {
          p.powerCharge += dt;
          if (p.powerCharge >= IF.POWER_RATE) { p.powerCharge -= IF.POWER_RATE; p.powerPts++; }
        }
        for (var k in p.cooldowns) if (p.cooldowns[k] > 0) p.cooldowns[k] -= dt;
      }
      this.runStrikes(g, dt);
    },

    awardKill: function (g, pid) {
      var p = g.players[pid];
      if (!p) return;
      p.killTally = (p.killTally || 0) + 1;
      if (p.killTally % 6 === 0 && p.powerPts < IF.POWER_MAX) p.powerPts++;
    },

    /* --- availability ------------------------------------------------- */
    reason: function (g, pid, id) {
      var d = IF.POWERS[id], p = g.players[pid];
      if (d.needs && !g.hasBuilding(pid, d.needs)) return 'Needs ' + IF.BUILDINGS[d.needs].name;
      if ((p.cooldowns[id] || 0) > 0) return Math.ceil(p.cooldowns[id]) + 's';
      if ((p.powerPts || 0) < d.cost) return 'Needs ' + d.cost + ' pts';
      return null;
    },
    canUse: function (g, pid, id) { return this.reason(g, pid, id) === null; },

    /* --- firing ------------------------------------------------------- */
    fire: function (g, pid, id, x, y) {
      if (!this.canUse(g, pid, id)) return false;
      var d = IF.POWERS[id], p = g.players[pid];
      p.powerPts -= d.cost;
      p.cooldowns[id] = d.cooldown;

      switch (id) {
        case 'recon':
          if (pid === 0) g.fog.reveal(x, y, d.radius, d.duration);
          IF.fx.text(g, x, y, 'RECON', '#9fd6e6');
          for (var r = 0; r < 10; r++) IF.fx.dust(g, x + IF.rand(-d.radius, d.radius), y + IF.rand(-d.radius, d.radius));
          if (pid === 0) IF.audio.eva('Recon flight inbound');
          break;

        case 'repair':
          var healed = 0;
          for (var i = 0; i < g.units.length; i++) {
            var u = g.units[i];
            if (u.dead || u.owner !== pid) continue;
            if (IF.dist(u.x, u.y, x, y) > d.radius) continue;
            u.hp = Math.min(u.maxHp, u.hp + u.maxHp * d.heal);
            IF.fx.push(g, { t: 'spark', x: u.x, y: u.y - 10, vx: 0, vy: -30, life: 0.7, age: 0, size: 3 });
            healed++;
          }
          IF.fx.text(g, x, y, 'FIELD REPAIR ×' + healed, '#8fbf5c');
          if (pid === 0) IF.audio.eva('Repair drop delivered');
          break;

        case 'barrage':
          g.strikes.push({
            kind: 'barrage', x: x, y: y, owner: pid, left: d.shells,
            every: d.spread / d.shells, t: 0, radius: d.radius,
            dmg: d.dmg, splash: d.splash
          });
          if (pid === 0) IF.audio.eva('Artillery barrage, firing');
          else g.warn('Enemy artillery barrage incoming');
          break;

        case 'paradrop':
          g.strikes.push({ kind: 'para', x: x, y: y, owner: pid, left: d.count, every: 0.35, t: 0 });
          if (pid === 0) IF.audio.eva('Paratroopers away');
          else g.warn('Enemy paratroopers dropping');
          break;

        case 'fuelair':
          g.strikes.push({ kind: 'fuelair', x: x, y: y, owner: pid, left: 1, every: 2.5, t: 0, dmg: d.dmg, splash: d.splash });
          if (pid === 0) IF.audio.eva('Fuel air bomb, target marked');
          else g.warn('WARNING — heavy ordnance inbound');
          break;
      }
      return true;
    },

    /* --- delayed effects --------------------------------------------- */
    runStrikes: function (g, dt) {
      for (var i = g.strikes.length - 1; i >= 0; i--) {
        var s = g.strikes[i];
        s.t -= dt;
        if (s.t > 0) continue;
        s.t = s.every;

        if (s.kind === 'barrage') {
          var a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * s.radius;
          var hx = s.x + Math.cos(a) * rr, hy = s.y + Math.sin(a) * rr;
          IF.splashDamage(g, hx, hy, s.splash, s.dmg, 'explosive', s.owner, null);
          IF.fx.explosion(g, hx, hy, 46);
          g.addDecal(hx, hy, 'crater', 22);
          IF.audio.play('boom', hx, hy);
          g.shake(6, hx, hy);
        } else if (s.kind === 'para') {
          var px = s.x + IF.rand(-70, 70), py = s.y + IF.rand(-70, 70);
          if (g.map.passWorld(px, py, 'foot')) {
            var u = g.spawnUnit('rifle', s.owner, px, py);
            u.chute = 1;
            IF.fx.dust(g, px, py);
          }
        } else if (s.kind === 'cookoff') {
          IF.fx.explosion(g, s.x, s.y, s.radius);
          IF.fx.smoke(g, s.x, s.y, 22);
          IF.audio.play('boom', s.x, s.y);
          g.shake(9, s.x, s.y);
        } else if (s.kind === 'fuelair') {
          IF.splashDamage(g, s.x, s.y, s.splash, s.dmg, 'bomb', s.owner, null);
          IF.fx.explosion(g, s.x, s.y, 150);
          for (var k = 0; k < 14; k++) {
            IF.fx.smoke(g, s.x + IF.rand(-90, 90), s.y + IF.rand(-90, 90), IF.rand(18, 34));
          }
          g.addDecal(s.x, s.y, 'scorch', 110);
          IF.audio.play('boom', s.x, s.y);
          g.shake(26, s.x, s.y);
        }

        s.left--;
        if (s.left <= 0) g.strikes.splice(i, 1);
      }
    },

    /* --- the AI spends its points too -------------------------------- */
    aiThink: function (g, ai) {
      var pid = ai.id, p = g.players[pid];
      if ((p.powerPts || 0) < 3) return;
      var enemy = 1 - pid;

      // Find the densest clump of enemy units and shell it.
      var best = null, bestN = 3;
      for (var i = 0; i < g.units.length; i++) {
        var u = g.units[i];
        if (u.dead || u.owner !== enemy || u.def.domain === 'air') continue;
        var n = 0;
        for (var j = 0; j < g.units.length; j++) {
          var o = g.units[j];
          if (o.dead || o.owner !== enemy) continue;
          if (IF.dist2(u.x, u.y, o.x, o.y) < 200 * 200) n++;
        }
        if (n > bestN) { bestN = n; best = u; }
      }
      if (!best) return;

      if (this.canUse(g, pid, 'fuelair') && bestN >= 6) this.fire(g, pid, 'fuelair', best.x, best.y);
      else if (this.canUse(g, pid, 'barrage')) this.fire(g, pid, 'barrage', best.x, best.y);
      else if (this.canUse(g, pid, 'repair')) {
        var hq = g.findBuilding(pid, 'hq');
        if (hq) this.fire(g, pid, 'repair', hq.x, hq.y);
      }
    }
  };

  IF.Powers = P;
})(window.IF);

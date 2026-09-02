/* IRON FRONT — combat.js
   Damage resolution, projectiles and the visual effects they throw off. */
(function (IF) {
  'use strict';

  /* ---------------------------------------------------------------- damage */
  IF.applyDamage = function (game, target, amount, dtype, attacker) {
    if (!target || target.dead) return 0;
    var table = IF.DMG[dtype] || IF.DMG.bullet;
    var mult = table[target.armor] !== undefined ? table[target.armor] : 1;
    var dealt = amount * mult;
    if (dealt <= 0) return 0;

    target.hp -= dealt;
    target.lastHit = game.time;
    if (target.owner === 0 && target.kind === 'building') game.baseAlert(target);

    if (attacker && attacker.x !== undefined && target.kind === 'unit' && !target.order.hostile && target.def.weapon) {
      // Shot at from out of the blue: shoot back.
      if (target.order.type === 'idle' || target.order.type === 'guard') target.autoTarget = attacker;
    }

    if (target.hp <= 0) {
      target.hp = 0;
      game.kill(target, attacker);
    }
    return dealt;
  };

  IF.splashDamage = function (game, x, y, radius, amount, dtype, ownerId, attacker) {
    // Off-map strikes have no firing unit. Give them a stand-in so kills are
    // still credited to the right commander.
    if (!attacker) attacker = { owner: ownerId, kind: 'strike' };
    var list = game.hash.query(x, y, radius + 24, game._tmpQ);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead || e.owner === ownerId) continue;
      var d = IF.dist(x, y, e.x, e.y);
      if (d > radius) continue;
      if (e.armor === 'air') continue;
      IF.applyDamage(game, e, amount * (1 - d / radius * 0.65), dtype, attacker);
    }
    for (var b = 0; b < game.buildings.length; b++) {
      var bl = game.buildings[b];
      if (bl.dead || bl.owner === ownerId) continue;
      var dd = IF.dist(x, y, bl.x, bl.y);
      if (dd > radius + bl.rad * 0.6) continue;
      IF.applyDamage(game, bl, amount * 0.8, dtype, attacker);
    }
    if (radius >= 55 && game.damageBridge) game.damageBridge(x, y, radius, amount * 0.6);
  };

  /* ----------------------------------------------------------- projectiles */
  function Projectile(o) {
    this.x = o.x; this.y = o.y;
    this.sx = o.x; this.sy = o.y;
    this.target = o.target;
    this.tx = o.tx; this.ty = o.ty;
    this.speed = o.speed || 420;
    this.dmg = o.dmg;
    this.dtype = o.dtype;
    this.splash = o.splash || 0;
    this.owner = o.owner;
    this.attacker = o.attacker;
    this.kindP = o.kindP || 'shell';   // shell | rocket | bomb | aa
    this.arc = o.arc || 0;
    this.dead = false;
    var d = IF.dist(this.x, this.y, this.tx, this.ty);
    this.total = Math.max(0.05, d / this.speed);
    this.t = 0;
  }

  Projectile.prototype.update = function (dt, game) {
    // Home in on a live target, otherwise keep going to the last known spot.
    if (this.target && !this.target.dead && this.kindP !== 'bomb') {
      this.tx = this.target.x; this.ty = this.target.y;
    }
    this.t += dt;
    var k = Math.min(1, this.t / this.total);
    this.x = IF.lerp(this.sx, this.tx, k);
    this.y = IF.lerp(this.sy, this.ty, k);
    this.z = this.arc ? Math.sin(k * Math.PI) * this.arc : 0;
    if (k >= 1) this.hit(game);
  };

  Projectile.prototype.hit = function (game) {
    this.dead = true;
    if (this.splash > 0) {
      IF.splashDamage(game, this.x, this.y, this.splash, this.dmg, this.dtype, this.owner, this.attacker);
      IF.fx.explosion(game, this.x, this.y, this.splash * 0.5);
      IF.audio.play('boom', this.x, this.y);
    } else {
      if (this.target && !this.target.dead) IF.applyDamage(game, this.target, this.dmg, this.dtype, this.attacker);
      IF.fx.explosion(game, this.x, this.y, this.kindP === 'rocket' ? 18 : 12);
      IF.audio.play('hit', this.x, this.y);
    }
  };

  IF.Projectile = Projectile;

  IF.fireWeapon = function (game, attacker, target, w) {
    var ax = attacker.x, ay = attacker.y;
    var ang = Math.atan2(target.y - ay, target.x - ax);
    var muzX = ax + Math.cos(ang) * (attacker.rad || 12);
    var muzY = ay + Math.sin(ang) * (attacker.rad || 12);

    if (w.shell || w.splash) {
      game.projectiles.push(new Projectile({
        x: muzX, y: muzY, target: w.type === 'bomb' ? null : target,
        tx: target.x, ty: target.y,
        speed: w.type === 'bomb' ? 260 : 320,
        dmg: w.dmg, dtype: w.type, splash: w.splash || 40,
        owner: attacker.owner, attacker: attacker,
        kindP: w.type === 'bomb' ? 'bomb' : 'shell',
        arc: w.type === 'bomb' ? 0 : 26
      }));
      IF.audio.play(w.type === 'bomb' ? 'bombdrop' : 'cannon', ax, ay);
      IF.fx.gunSmoke(game, muzX, muzY, ang);
    } else if (w.type === 'rocket') {
      game.projectiles.push(new Projectile({
        x: muzX, y: muzY, target: target, tx: target.x, ty: target.y,
        speed: 300, dmg: w.dmg, dtype: 'rocket', owner: attacker.owner,
        attacker: attacker, kindP: 'rocket'
      }));
      IF.audio.play('rocket', ax, ay);
    } else if (w.type === 'ap') {
      game.projectiles.push(new Projectile({
        x: muzX, y: muzY, target: target, tx: target.x, ty: target.y,
        speed: 620, dmg: w.dmg, dtype: 'ap', owner: attacker.owner,
        attacker: attacker, kindP: 'shell'
      }));
      IF.audio.play('cannon', ax, ay);
      IF.fx.gunSmoke(game, muzX, muzY, ang);
    } else {
      // Bullets and flak hit instantly; we only draw the tracer.
      IF.applyDamage(game, target, w.dmg, w.type, attacker);
      IF.fx.tracer(game, muzX, muzY, target.x, target.y, w.type === 'aa' ? '#ffd27a' : '#fff2b0');
      IF.audio.play(w.type === 'aa' ? 'flak' : 'gun', ax, ay);
      // rounds kicking up dirt around whatever is being shot at
      if (Math.random() < 0.5) {
        IF.fx.dust(game, target.x + IF.rand(-10, 10), target.y + IF.rand(-8, 8));
      }
      // spent brass
      if (Math.random() < 0.6) {
        var ca = ang + Math.PI / 2 + IF.rand(-0.4, 0.4);
        IF.fx.push(game, {
          t: 'chunk', x: muzX, y: muzY, vx: Math.cos(ca) * 26, vy: Math.sin(ca) * 26,
          vz: IF.rand(20, 45), z: 4, rot: Math.random() * 6.283, spin: IF.rand(-14, 14),
          size: 1.6, life: 0.75, age: 0, brass: true
        });
      }
    }
    IF.fx.muzzle(game, muzX, muzY, ang);
    attacker.recoil = 1;
  };

  /* --------------------------------------------------------------- effects */
  IF.fx = {
    push: function (game, e) {
      if (game.effects.length > 900) game.effects.shift();
      game.effects.push(e);
    },
    muzzle: function (game, x, y, ang) {
      this.push(game, { t: 'muzzle', x: x, y: y, a: ang, life: 0.07, age: 0 });
    },
    tracer: function (game, x, y, x2, y2, col) {
      this.push(game, { t: 'tracer', x: x, y: y, x2: x2, y2: y2, col: col, life: 0.09, age: 0 });
    },
    ring: function (game, x, y, r) {
      this.push(game, { t: 'ring', x: x, y: y, r: r, life: 0.5, age: 0 });
    },
    /* The grey bloom that hangs at the muzzle after a heavy gun fires. */
    gunSmoke: function (game, x, y, ang) {
      for (var i = 0; i < 2; i++) {
        this.push(game, {
          t: 'smoke', x: x + Math.cos(ang) * (5 + i * 7), y: y + Math.sin(ang) * (5 + i * 7),
          r: 4 + i * 2.5, life: IF.rand(0.8, 1.4), age: 0, vy: -14
        });
      }
    },
    trail: function (game, x, y) {
      this.push(game, { t: 'trail', x: x, y: y, r: IF.rand(2.5, 4.5), life: 1.6, age: 0 });
    },
    explosion: function (game, x, y, r) {
      this.push(game, { t: 'boom', x: x, y: y, r: r, life: 0.45, age: 0 });
      if (r > 14) this.ring(game, x, y, r);
      var n = Math.min(18, 4 + (r / 4) | 0);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2, sp = IF.rand(30, 40 + r * 3);
        this.push(game, {
          t: 'spark', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: IF.rand(0.3, 0.8), age: 0, size: IF.rand(1.5, 3.5)
        });
      }
      for (var s = 0; s < 3; s++) {
        this.push(game, {
          t: 'smoke', x: x + IF.rand(-r / 2, r / 2), y: y + IF.rand(-r / 2, r / 2),
          r: r * IF.rand(0.5, 0.9), life: IF.rand(1.0, 2.0), age: 0, vy: -8
        });
      }
      // lumps of metal and earth thrown clear of the blast
      var chunks = Math.min(10, 2 + (r / 9) | 0);
      for (var ch = 0; ch < chunks; ch++) {
        var ca = Math.random() * Math.PI * 2, cs = IF.rand(40, 60 + r * 2);
        this.push(game, {
          t: 'chunk', x: x, y: y, vx: Math.cos(ca) * cs, vy: Math.sin(ca) * cs,
          vz: IF.rand(40, 90), z: 0, rot: Math.random() * 6.283,
          spin: IF.rand(-9, 9), size: IF.rand(2.5, 5.5),
          life: IF.rand(0.7, 1.3), age: 0
        });
      }
    },
    dust: function (game, x, y) {
      this.push(game, { t: 'dust', x: x, y: y, r: IF.rand(3, 6), life: 0.7, age: 0 });
    },
    smoke: function (game, x, y, r) {
      this.push(game, { t: 'smoke', x: x, y: y, r: r, life: IF.rand(1.2, 2.4), age: 0, vy: -10 });
    },
    text: function (game, x, y, str, col) {
      this.push(game, { t: 'text', x: x, y: y, str: str, col: col || '#e8e4d2', life: 1.4, age: 0 });
    },
    update: function (game, dt) {
      var list = game.effects;
      for (var i = list.length - 1; i >= 0; i--) {
        var e = list[i];
        e.age += dt;
        if (e.t === 'spark') { e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= 0.94; e.vy = e.vy * 0.94 + 40 * dt; }
        if (e.t === 'chunk') {
          e.x += e.vx * dt; e.y += e.vy * dt;
          e.z += e.vz * dt; e.vz -= 190 * dt;
          if (e.z < 0) { e.z = 0; e.vz *= -0.35; e.vx *= 0.5; e.vy *= 0.5; }
          e.vx *= 0.99; e.vy *= 0.99;
        }
        if (e.t === 'smoke') { e.y += e.vy * dt; e.x += 11 * dt; e.r += 9 * dt; }
        if (e.t === 'text') { e.y -= 16 * dt; }
        if (e.age >= e.life) list.splice(i, 1);
      }
    }
  };

})(window.IF);

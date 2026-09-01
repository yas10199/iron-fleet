/* IRON FRONT — ui.js
   The command interface: top readout, build panels, selection info, minimap
   frame, alerts and the after-action report. */
(function (IF) {
  'use strict';

  var UI = {
    tab: 'build',
    refresh: 0,

    init: function () {
      var self = this;
      this.el = {
        supplies: document.getElementById('rSupplies'),
        fuel: document.getElementById('rFuel'),
        power: document.getElementById('rPower'),
        pop: document.getElementById('rPop'),
        timer: document.getElementById('rTimer'),
        pwrFill: document.getElementById('pwrFill'),
        cards: document.getElementById('cards'),
        queue: document.getElementById('queue'),
        sel: document.getElementById('selinfo'),
        msgs: document.getElementById('messages'),
        tabs: document.getElementById('tabs'),
        results: document.getElementById('results'),
        resultBody: document.getElementById('resultBody'),
        resultTitle: document.getElementById('resultTitle'),
        menu: document.getElementById('mainmenu'),
        help: document.getElementById('help'),
        sidebar: document.getElementById('sidebar'),
        powers: document.getElementById('powers'),
        pts: document.getElementById('rPts')
      };
      this.buildPowerBar();

      this.el.tabs.addEventListener('click', function (e) {
        var t = e.target.closest('.tab');
        if (!t) return;
        self.tab = t.dataset.tab;
        self.buildCards(IF.game, true);
        Array.prototype.forEach.call(self.el.tabs.children, function (c) { c.classList.toggle('on', c.dataset.tab === self.tab); });
      });

      document.getElementById('btnMusic').addEventListener('click', function () {
        IF.audio.setMusic(!IF.audio.musicOn);
        this.textContent = IF.audio.musicOn ? 'MUSIC ON' : 'MUSIC OFF';
      });
      document.getElementById('btnVoice').addEventListener('click', function () {
        IF.audio.voiceOn = !IF.audio.voiceOn;
        if (!IF.audio.voiceOn && window.speechSynthesis) window.speechSynthesis.cancel();
        this.textContent = IF.audio.voiceOn ? 'VOICE ON' : 'VOICE OFF';
      });
      document.getElementById('btnSound').addEventListener('click', function () {
        IF.audio.setMuted(!IF.audio.muted);
        this.textContent = IF.audio.muted ? 'SOUND OFF' : 'SOUND ON';
      });
      document.getElementById('btnPause').addEventListener('click', function () {
        var g = IF.game; if (!g) return;
        g.paused = !g.paused;
        this.textContent = g.paused ? 'RESUME' : 'PAUSE';
      });
      document.getElementById('btnHelp').addEventListener('click', function () {
        self.el.help.classList.toggle('hidden');
      });
      document.getElementById('btnCloseHelp').addEventListener('click', function () {
        self.el.help.classList.add('hidden');
      });
      document.getElementById('btnRestart').addEventListener('click', function () {
        self.el.results.classList.add('hidden');
        self.el.menu.classList.remove('hidden');
      });
      document.getElementById('sidebarToggle').addEventListener('click', function () {
        self.el.sidebar.classList.toggle('collapsed');
      });
    },

    /* --------------------------------------------------- command powers */
    buildPowerBar: function () {
      var self = this;
      this.el.powers.innerHTML = '';
      this._pw = {};
      IF.POWER_ORDER.forEach(function (id) {
        var d = IF.POWERS[id];
        var b = document.createElement('button');
        b.className = 'pw';
        b.innerHTML = '<span class="pwname">' + d.name + '</span>' +
                      '<span class="pwcost">' + d.cost + ' PT</span>' +
                      '<i class="pwcool"></i>';
        b.title = d.desc;
        b.addEventListener('click', function () {
          var g = IF.game;
          if (!g || g.over) return;
          if (!IF.Powers.canUse(g, 0, id)) { g.deny(IF.Powers.reason(g, 0, id)); return; }
          g.placing = null;
          g.targeting = g.targeting === id ? null : id;
        });
        self.el.powers.appendChild(b);
        self._pw[id] = b;
      });
    },

    refreshPowers: function (g) {
      var p = g.players[0];
      this.el.pts.textContent = (p.powerPts || 0) + '/' + IF.POWER_MAX;
      for (var i = 0; i < IF.POWER_ORDER.length; i++) {
        var id = IF.POWER_ORDER[i], b = this._pw[id], d = IF.POWERS[id];
        var why = IF.Powers.reason(g, 0, id);
        b.classList.toggle('ready', why === null);
        b.classList.toggle('armed', g.targeting === id);
        var cd = (p.cooldowns && p.cooldowns[id]) || 0;
        b.querySelector('.pwcool').style.height = cd > 0 ? Math.round(cd / d.cooldown * 100) + '%' : '0%';
        b.querySelector('.pwcost').textContent = why === null ? 'READY' : why;
      }
    },

    /* --------------------------------------------------------- frame */
    update: function (g, dt) {
      var p = g.players[0];
      this.el.supplies.textContent = Math.floor(p.supplies);
      this.el.fuel.textContent = Math.floor(p.fuel);
      this.el.power.textContent = p.powerProd + '/' + p.powerUse;
      this.el.power.className = p.powerBalance < 0 ? 'val bad' : 'val';
      var load = p.powerProd > 0 ? p.powerUse / p.powerProd : (p.powerUse > 0 ? 1.4 : 0);
      this.el.pwrFill.style.width = Math.min(100, load * 100) + '%';
      this.el.pwrFill.className = load > 1 ? 'over' : (load > 0.85 ? 'warn' : '');
      this.el.pop.textContent = p.pop + '/' + p.popCap;
      this.el.pop.className = (p.pop >= p.popCap) ? 'val bad' : 'val';
      this.el.timer.textContent = IF.fmtTime(g.time);

      this.refresh -= dt;
      if (this.refresh <= 0) {
        this.refresh = 0.2;
        this.refreshPowers(g);
        this.buildCards(g, false);
        this.drawQueue(g);
        this.drawSelection(g);
      }
      this.drawMessages(g);
    },

    /* --------------------------------------------------------- cards */
    buildCards: function (g, force) {
      var list = [], kind = 'unit';
      if (this.tab === 'build') { list = IF.BUILD_ORDER_MENU; kind = 'building'; }
      else if (this.tab === 'tech') { list = IF.TECH_ORDER; kind = 'tech'; }
      else list = IF.MENU[this.tab] || [];

      if (this.tab === 'inf') list = list.concat(IF.MENU.sup, IF.MENU.fue);

      var sig = this.tab + '|' + list.join(',');
      if (force || sig !== this._sig) {
        this._sig = sig;
        this.el.cards.innerHTML = '';
        this._cards = {};
        for (var i = 0; i < list.length; i++) this.el.cards.appendChild(this.makeCard(g, list[i], kind));
      }
      this.refreshCards(g, kind, list);
    },

    makeCard: function (g, id, kind) {
      var self = this;
      var d = kind === 'building' ? IF.BUILDINGS[id] : (kind === 'tech' ? IF.TECH[id] : IF.UNITS[id]);
      var el = document.createElement('button');
      el.className = 'card';
      el.dataset.id = id;

      var cv = document.createElement('canvas');
      cv.width = 48; cv.height = 48; cv.className = 'icon';
      this.drawIcon(cv.getContext('2d'), id, kind, g.players[0].faction);

      var txt = document.createElement('div');
      txt.className = 'ctext';
      txt.innerHTML = '<div class="cname">' + d.name + '</div>' +
        '<div class="ccost"><span class="s">' + (d.cost.s || 0) + '</span>' +
        ((d.cost.f) ? '<span class="f">' + d.cost.f + '</span>' : '') + '</div>' +
        '<div class="clock"></div>';

      var wipe = document.createElement('i');
      wipe.className = 'cwipe';
      el.appendChild(wipe);
      var badge = document.createElement('b');
      badge.className = 'cbadge';
      el.appendChild(badge);
      el.appendChild(cv); el.appendChild(txt);
      el.title = d.desc || '';
      el.addEventListener('click', function () {
        if (!IF.game || IF.game.over) return;
        if (kind === 'building') IF.input.startPlacement(id);
        else if (kind === 'tech') IF.game.startResearch(0, id);
        else IF.game.queueUnit(0, id);
      });
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        if (kind === 'unit') IF.game.cancelQueue(0, IF.UNITS[id].cat);
      });
      this._cards = this._cards || {};
      this._cards[id] = el;
      return el;
    },

    refreshCards: function (g, kind, list) {
      var p = g.players[0];
      for (var i = 0; i < list.length; i++) {
        var id = list[i], el = this._cards[id];
        if (!el) continue;
        var lockText = '', cost, ok = true;

        if (kind === 'building') {
          cost = IF.BUILDINGS[id].cost;
          if ((id === 'atgun' || id === 'aagun' || id === 'bunker') && !g.hasBuilding(0, 'barracks')) { ok = false; lockText = 'Needs Barracks'; }
        } else if (kind === 'tech') {
          var t = IF.TECH[id];
          cost = g.techCost(0, id);
          if (p.tech[id]) { ok = false; lockText = 'Researched'; }
          else if (!g.hasBuilding(0, 'lab')) { ok = false; lockText = 'Needs Laboratory'; }
          else if (t.needs && !p.tech[t.needs]) { ok = false; lockText = 'Needs ' + IF.TECH[t.needs].name; }
          else if (p.research) { ok = false; lockText = p.research.id === id ? 'Researching…' : 'Lab busy'; }
        } else {
          var u = IF.UNITS[id];
          cost = g.unitCost(0, id);
          if (u.requires && !p.tech[u.requires]) { ok = false; lockText = 'Needs ' + IF.TECH[u.requires].name; }
          else if (!g.hasBuilding(0, u.from)) { ok = false; lockText = 'Needs ' + IF.BUILDINGS[u.from].name; }
          else if (p.pop + p.popQueued + u.pop > p.popCap) { ok = false; lockText = 'Unit limit'; }
        }

        // Fill the card while this item is actually being produced.
        var prog = 0;
        if (kind === 'unit') {
          for (var bb = 0; bb < g.buildings.length; bb++) {
            var bd = g.buildings[bb];
            if (!bd.dead && bd.owner === 0 && bd.busy && bd.busy.unitId === id) {
              prog = 1 - bd.busy.left / bd.busy.total; break;
            }
          }
          if (!prog && g.queuedCount(0, id) > 0) prog = 0.02;
        } else if (kind === 'building') {
          for (var bc = 0; bc < g.buildings.length; bc++) {
            var bx = g.buildings[bc];
            if (!bx.dead && bx.owner === 0 && bx.type === id && !bx.complete) { prog = bx.progress; break; }
          }
        } else if (p.research && p.research.id === id) {
          prog = 1 - p.research.left / p.research.total;
        }
        el.querySelector('.cwipe').style.height = Math.round(prog * 100) + '%';

        var badge = el.querySelector('.cbadge');
        var waiting = kind === 'unit' ? g.queuedCount(0, id) : 0;
        badge.textContent = waiting > 0 ? waiting : '';
        badge.style.display = waiting > 0 ? 'block' : 'none';

        var afford = p.supplies >= (cost.s || 0) && p.fuel >= (cost.f || 0);
        el.classList.toggle('locked', !ok);
        el.classList.toggle('poor', ok && !afford);
        el.querySelector('.clock').textContent = lockText;
        var cc = el.querySelector('.ccost');
        cc.innerHTML = '<span class="s">' + (cost.s || 0) + '</span>' + (cost.f ? '<span class="f">' + cost.f + '</span>' : '');
      }
    },

    /* --------------------------------------------------------- queue */
    drawQueue: function (g) {
      var p = g.players[0], html = '';
      // in-progress items at each building
      for (var i = 0; i < g.buildings.length; i++) {
        var b = g.buildings[i];
        if (b.dead || b.owner !== 0) continue;
        if (!b.complete) {
          html += this.qrow(b.def.name, b.progress, 'building');
        } else if (b.busy) {
          html += this.qrow(IF.UNITS[b.busy.unitId].name, 1 - b.busy.left / b.busy.total, 'unit');
        }
      }
      if (p.research) html += this.qrow(IF.TECH[p.research.id].name, 1 - p.research.left / p.research.total, 'tech');
      var waiting = 0;
      for (var c in p.queues) waiting += p.queues[c].length;
      if (waiting) html += '<div class="qwait">' + waiting + ' waiting in queue</div>';
      this.el.queue.innerHTML = html || '<div class="qwait dim">Nothing in production</div>';
    },

    qrow: function (name, frac, cls) {
      return '<div class="qrow ' + cls + '"><span>' + name + '</span>' +
        '<i style="width:' + Math.round(IF.clamp(frac, 0, 1) * 100) + '%"></i></div>';
    },

    /* ----------------------------------------------------- selection */
    drawSelection: function (g) {
      var s = g.selection.filter(function (e) { return !e.dead; });
      if (!s.length) {
        this.el.sel.innerHTML = '<div class="dim">No selection — drag a box over your units, or click a building.</div>';
        return;
      }
      var e = s[0];
      var html = '';

      if (s.length > 1) {
        var counts = {};
        s.forEach(function (u) { var n = u.def.name; counts[n] = (counts[n] || 0) + 1; });
        html += '<div class="selhead">' + s.length + ' units selected</div><div class="selgrid">';
        for (var k in counts) html += '<span class="chip">' + counts[k] + ' × ' + k + '</span>';
        html += '</div>';
      } else {
        var d = e.def;
        html += '<div class="selhead">' + d.name + '</div>';
        html += '<div class="selstat"><b>Health</b> ' + Math.ceil(e.hp) + ' / ' + e.maxHp + '</div>';
        if (e.kind === 'unit' && e.rank !== undefined) {
          html += '<div class="selstat"><b>Rank</b> ' + IF.RANKS[e.rank].name + ' <span class="dim">(' + e.kills + ' kills)</span></div>';
        }
        if (d.weapon) {
          html += '<div class="selstat"><b>Attack</b> ' + Math.round(e.weapon ? e.weapon().dmg : d.weapon.dmg) +
            ' <span class="dim">(' + d.weapon.type + ')</span></div>';
          html += '<div class="selstat"><b>Range</b> ' + d.weapon.range + '</div>';
        }
        if (d.speed) html += '<div class="selstat"><b>Speed</b> ' + Math.round(e.speed) + '</div>';
        if (d.harvest) html += '<div class="selstat"><b>Cargo</b> ' + Math.floor(e.carry) + ' / ' + d.capacity + ' ' + d.harvest + '</div>';
        if (d.repair) html += '<div class="selstat"><b>Repairs</b> ' + d.repair + ' hp/sec</div>';
        if (e.kind === 'unit' && d.cat === 'air') html += '<div class="selstat"><b>Ammo</b> ' + e.ammo + ' / ' + d.ammo + (e.astate === 'rearm' ? ' <span class="dim">(rearming)</span>' : '') + '</div>';
        if (e.kind === 'building' && !e.complete) html += '<div class="selstat"><b>Building</b> ' + Math.round(e.progress * 100) + '%</div>';
        if (e.kind === 'building' && e.def.produces) html += '<div class="selstat dim">Right-click the map to set a rally point.</div>';
        html += '<div class="seldesc">' + (d.desc || '') + '</div>';
      }
      this.el.sel.innerHTML = html;
    },

    /* ------------------------------------------------------ messages */
    drawMessages: function (g) {
      var html = '';
      for (var i = 0; i < g.messages.length; i++) {
        var m = g.messages[i];
        html += '<div class="msg' + (m.warn ? ' warn' : '') + '">' + m.text + '</div>';
      }
      this.el.msgs.innerHTML = html;
    },

    /* ------------------------------------------------------- results */
    showResults: function (g) {
      var win = g.over.winner === 0;
      var p = g.players[0], e = g.players[1];
      this.el.resultTitle.textContent = win ? 'VICTORY' : 'DEFEAT';
      this.el.resultTitle.className = win ? 'win' : 'lose';
      var rows = [
        ['Outcome', win ? 'Enemy Headquarters destroyed' : 'Your Headquarters was destroyed'],
        ['Battle length', IF.fmtTime(g.time)],
        ['Units destroyed', p.stats.killedUnits],
        ['Units lost', p.stats.lostUnits],
        ['Buildings destroyed', p.stats.killedBuildings],
        ['Buildings lost', p.stats.lostBuildings],
        ['Supplies collected', Math.round(p.stats.supplies)],
        ['Fuel collected', Math.round(p.stats.fuel)],
        ['Enemy units lost', e.stats.lostUnits],
        ['Enemy resources collected', Math.round(e.stats.supplies + e.stats.fuel)],
        ['Command points earned', (p.killTally || 0) + ' kills worth']
      ];
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        html += '<div class="rrow"><span>' + rows[i][0] + '</span><b>' + rows[i][1] + '</b></div>';
      }
      this.el.resultBody.innerHTML = html;
      this.el.results.classList.remove('hidden');
    },

    /* ---------------------------------------------------------- icons */
    drawIcon: function (c, id, kind, faction) {
      c.clearRect(0, 0, 48, 48);
      c.save();
      c.translate(24, 24);
      var col = faction.color, dark = faction.dark;

      if (kind === 'tech') {
        c.strokeStyle = '#d7b45a'; c.lineWidth = 2.5;
        c.beginPath(); c.arc(0, 0, 12, 0, 6.283); c.stroke();
        c.beginPath(); c.moveTo(-12, 0); c.lineTo(12, 0); c.moveTo(0, -12); c.lineTo(0, 12); c.stroke();
        c.fillStyle = '#d7b45a'; c.beginPath(); c.arc(0, 0, 4, 0, 6.283); c.fill();
        c.restore(); return;
      }

      if (kind === 'building') {
        c.fillStyle = '#59605d'; c.fillRect(-15, -13, 30, 26);
        c.fillStyle = dark; c.fillRect(-15, -13, 30, 5);
        c.fillStyle = col; c.fillRect(-15, 8, 30, 5);
        c.fillStyle = '#2f3630';
        switch (id) {
          case 'power': c.beginPath(); c.arc(-6, 0, 6, 0, 6.283); c.arc(7, 3, 5, 0, 6.283); c.fill(); break;
          case 'depot': c.fillStyle = '#d4ab48'; c.fillRect(-10, -4, 9, 9); c.fillRect(2, -1, 9, 9); break;
          case 'refinery': c.fillStyle = '#4f8f6d'; c.beginPath(); c.arc(-5, 1, 7, 0, 6.283); c.fill(); c.fillRect(3, -2, 9, 9); break;
          case 'barracks': c.fillRect(-4, -2, 9, 11); c.fillStyle = col; c.fillRect(-2, 1, 5, 8); break;
          case 'factory':
            for (var s = 0; s < 3; s++) { c.beginPath(); c.moveTo(-12 + s * 9, 8); c.lineTo(-8 + s * 9, -6); c.lineTo(-4 + s * 9, 8); c.fill(); }
            break;
          case 'airfield':
            c.fillRect(-13, -3, 26, 8);
            c.strokeStyle = '#ddd8c4'; c.lineWidth = 1.5; c.setLineDash([4, 3]);
            c.beginPath(); c.moveTo(-11, 1); c.lineTo(11, 1); c.stroke(); c.setLineDash([]);
            break;
          case 'lab': c.fillStyle = '#9fd6e6'; c.beginPath(); c.arc(0, 2, 9, Math.PI, 0); c.fill(); break;
          case 'radar':
            c.strokeStyle = '#9fd6e6'; c.lineWidth = 2;
            c.beginPath(); c.arc(0, 6, 5, Math.PI, 0); c.stroke();
            c.beginPath(); c.arc(0, 6, 9, Math.PI, 0); c.stroke();
            c.beginPath(); c.arc(0, 6, 13, Math.PI, 0); c.stroke();
            c.fillStyle = '#9fd6e6'; c.beginPath(); c.arc(0, 6, 2.5, 0, 6.283); c.fill();
            break;
          case 'bunker': c.beginPath(); c.moveTo(-11, -3); c.lineTo(11, -3); c.lineTo(14, 6); c.lineTo(-14, 6); c.closePath(); c.fill(); break;
          case 'atgun': c.beginPath(); c.arc(0, 2, 8, 0, 6.283); c.fill(); c.fillRect(0, 0, 17, 3); break;
          case 'aagun': c.beginPath(); c.arc(0, 4, 8, 0, 6.283); c.fill(); c.fillRect(-1, -14, 3, 16); c.fillRect(4, -12, 3, 14); break;
          default: c.fillStyle = col; c.beginPath(); c.arc(0, 0, 8, 0, 6.283); c.fill();
        }
        c.restore(); return;
      }

      var d = IF.UNITS[id];
      if (d.cat === 'air') {
        c.rotate(-Math.PI / 2);
        c.fillStyle = '#4a5a68';
        c.beginPath();
        c.moveTo(17, 0); c.lineTo(4, -4); c.lineTo(-15, -3); c.lineTo(-17, 0); c.lineTo(-15, 3); c.lineTo(4, 4);
        c.closePath(); c.fill();
        c.fillRect(-5, -17, 8, 34);
        c.fillRect(-16, -9, 5, 18);
        c.fillStyle = col; c.fillRect(-4, -16, 3, 6); c.fillRect(-4, 10, 3, 6);
      } else if (d.armor === 'infantry') {
        c.fillStyle = faction.id === 'legion' ? '#5a4a3c' : '#4a5c50';
        c.beginPath(); c.ellipse(0, 4, 8, 11, 0, 0, 6.283); c.fill();
        c.fillStyle = dark; c.beginPath(); c.arc(0, -8, 7, 0, 6.283); c.fill();
        c.fillStyle = col; c.beginPath(); c.arc(0, -8, 4, 0, 6.283); c.fill();
        c.strokeStyle = '#20231c'; c.lineWidth = 2.5;
        c.beginPath(); c.moveTo(7, 8); c.lineTo(14, -8); c.stroke();
        if (id === 'engineer') { c.fillStyle = '#d7b45a'; c.fillRect(-14, 0, 7, 7); }
        if (id === 'sniper') { c.strokeStyle = '#20231c'; c.beginPath(); c.moveTo(7, 8); c.lineTo(17, -12); c.stroke(); }
      } else {
        c.fillStyle = '#22251f';
        c.fillRect(-16, -12, 32, 4); c.fillRect(-16, 8, 32, 4);
        c.fillStyle = faction.id === 'legion' ? '#514a3c' : '#4d5850';
        c.fillRect(-16, -8, 32, 16);
        if (d.harvest) {
          c.fillStyle = id === 'truck' ? '#d4ab48' : '#39443f';
          c.fillRect(-13, -5, 16, 10);
        } else {
          c.fillStyle = faction.id === 'legion' ? '#5c5445' : '#586359';
          c.beginPath(); c.arc(-2, 0, 8, 0, 6.283); c.fill();
          c.fillStyle = '#20231c';
          c.fillRect(4, -2, id === 'artillery' ? 20 : 16, 4);
        }
        c.fillStyle = col; c.fillRect(-14, 4, 6, 3);
      }
      c.restore();
    }
  };

  IF.ui = UI;
})(window.IF);

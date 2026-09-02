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
    /* Icons are drawn in the same language as the battlefield art: a lifted
       box with a roof for structures, a hull and turret for vehicles, a
       helmeted figure for infantry. So the sidebar reads like the map. */
    drawIcon: function (c, id, kind, faction) {
      c.clearRect(0, 0, 48, 48);
      c.save();
      c.translate(24, 27);
      var col = faction.color, dark = faction.dark;
      var legion = faction.id === 'legion';

      if (kind === 'tech') {
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath(); c.ellipse(2, 12, 14, 5, 0, 0, 6.283); c.fill();
        c.strokeStyle = '#d7b45a'; c.lineWidth = 2.4;
        c.beginPath(); c.arc(0, -2, 11, 0, 6.283); c.stroke();
        c.beginPath(); c.moveTo(-11, -2); c.lineTo(11, -2); c.moveTo(0, -13); c.lineTo(0, 9); c.stroke();
        c.fillStyle = '#d7b45a'; c.beginPath(); c.arc(0, -2, 3.6, 0, 6.283); c.fill();
        c.strokeStyle = 'rgba(215,180,90,0.5)'; c.lineWidth = 1.4;
        c.beginPath(); c.arc(0, -2, 16, -0.9, 0.9); c.stroke();
        c.restore(); return;
      }

      if (kind === 'building') {
        var H = 13, w = 28, h = 20;
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.beginPath();
        c.moveTo(-w / 2, -h / 2); c.lineTo(w / 2, -h / 2);
        c.lineTo(w / 2 + 8, -h / 2 + 5); c.lineTo(w / 2 + 8, h / 2 + 5);
        c.lineTo(-w / 2 + 8, h / 2 + 5); c.lineTo(-w / 2, h / 2);
        c.closePath(); c.fill();
        // wall
        c.fillStyle = legion ? '#5a5245' : '#5c6469';
        c.fillRect(-w / 2, h / 2 - H, w, H);
        c.fillStyle = 'rgba(20,24,28,0.55)';
        for (var wx = -w / 2 + 3; wx < w / 2 - 4; wx += 8) c.fillRect(wx, h / 2 - H + 4, 4, 4);
        // roof
        c.fillStyle = legion ? '#6d6353' : '#6e777d';
        c.fillRect(-w / 2, -h / 2 - H, w, h);
        c.fillStyle = legion ? '#857a67' : '#87919a';
        c.fillRect(-w / 2 + 1.5, -h / 2 - H + 1.5, w - 3, h - 4);
        c.fillStyle = 'rgba(255,244,206,0.20)';
        c.fillRect(-w / 2 + 1.5, -h / 2 - H + 1.5, w - 3, 2.5);
        c.fillStyle = col;
        c.fillRect(-w / 2 + 1.5, -h / 2 - H + h - 5, w - 3, 3);

        c.save();
        c.translate(0, -H);
        c.fillStyle = '#2f3630';
        switch (id) {
          case 'power':
            c.beginPath(); c.ellipse(-6, -1, 6, 5, 0, 0, 6.283); c.fill();
            c.beginPath(); c.ellipse(7, 4, 4.5, 4, 0, 0, 6.283); c.fill();
            c.fillStyle = '#8a9198';
            c.beginPath(); c.ellipse(-6, -2, 3.6, 3, 0, 0, 6.283); c.fill();
            break;
          case 'depot':
            for (var q = 0; q < 4; q++) {
              c.fillStyle = '#a8802c'; c.fillRect(-10 + (q % 2) * 11, -6 + Math.floor(q / 2) * 10, 9, 8);
              c.fillStyle = '#dcb14a'; c.fillRect(-10 + (q % 2) * 11, -6 + Math.floor(q / 2) * 10, 9, 5);
            }
            break;
          case 'refinery':
            c.fillStyle = '#3a443f'; c.beginPath(); c.ellipse(-6, 0, 7, 6, 0, 0, 6.283); c.fill();
            c.fillStyle = '#4b564f'; c.beginPath(); c.ellipse(-6, -1.4, 5, 4.4, 0, 0, 6.283); c.fill();
            c.fillStyle = '#3f4a44'; c.fillRect(4, -6, 8, 12);
            c.strokeStyle = '#4f9a72'; c.lineWidth = 2.2;
            c.beginPath(); c.moveTo(-6, 0); c.lineTo(8, 0); c.stroke();
            break;
          case 'barracks':
            c.fillStyle = '#4d5348'; c.fillRect(-11, -7, 22, 6);
            c.fillStyle = '#3c4238'; c.fillRect(-5, 1, 10, 8);
            c.fillStyle = col; c.fillRect(-3, 3, 6, 6);
            break;
          case 'factory':
            for (var sw = 0; sw < 3; sw++) {
              c.fillStyle = sw % 2 ? '#5b646a' : '#4a5258';
              c.beginPath();
              c.moveTo(-13 + sw * 9, 8); c.lineTo(-9 + sw * 9, -8); c.lineTo(-5 + sw * 9, 8);
              c.closePath(); c.fill();
            }
            break;
          case 'airfield':
            c.fillStyle = '#3f444a'; c.fillRect(-13, -5, 26, 11);
            c.strokeStyle = 'rgba(236,230,206,0.8)'; c.lineWidth = 1.6;
            c.setLineDash([5, 4]);
            c.beginPath(); c.moveTo(-11, 0.5); c.lineTo(11, 0.5); c.stroke();
            c.setLineDash([]);
            break;
          case 'lab':
            c.fillStyle = '#48525c'; c.beginPath(); c.ellipse(0, 0, 9, 8, 0, 0, 6.283); c.fill();
            c.fillStyle = '#9fd6e6'; c.beginPath(); c.ellipse(-1, -1, 6, 5, 0, 0, 6.283); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.ellipse(-3, -3, 2.2, 1.6, 0, 0, 6.283); c.fill();
            break;
          case 'radar':
            c.fillStyle = '#3c444b'; c.beginPath(); c.ellipse(0, 5, 9, 4, 0, 0, 6.283); c.fill();
            c.fillStyle = '#8d97a0'; c.beginPath(); c.ellipse(0, -1, 11, 4.5, -0.35, 0, 6.283); c.fill();
            c.fillStyle = '#5d666e'; c.beginPath(); c.ellipse(0, 0.5, 11, 2.6, -0.35, 0, 6.283); c.fill();
            c.strokeStyle = '#2a2e26'; c.lineWidth = 2;
            c.beginPath(); c.moveTo(0, 2); c.lineTo(0, 6); c.stroke();
            break;
          case 'bunker':
            c.fillStyle = '#4a5145';
            c.beginPath(); c.moveTo(-10, -4); c.lineTo(10, -4); c.lineTo(13, 6); c.lineTo(-13, 6);
            c.closePath(); c.fill();
            c.fillStyle = '#171a15'; c.fillRect(-8, -1, 16, 3.5);
            c.fillStyle = '#8b7f5f';
            for (var sb = 0; sb < 4; sb++) { c.beginPath(); c.ellipse(-11 + sb * 7, 8, 4, 2.6, 0, 0, 6.283); c.fill(); }
            break;
          case 'atgun':
            c.fillStyle = '#3c4137'; c.beginPath(); c.arc(-2, 2, 8, 0, 6.283); c.fill();
            c.fillStyle = '#4d5346'; c.beginPath(); c.arc(-3, 0.5, 6, 0, 6.283); c.fill();
            c.fillStyle = '#23261f'; c.fillRect(-2, 0, 18, 4);
            break;
          case 'aagun':
            c.fillStyle = '#3c4137'; c.beginPath(); c.arc(0, 5, 8, 0, 6.283); c.fill();
            c.fillStyle = '#23261f';
            c.save(); c.rotate(-0.85);
            c.fillRect(-1.6, -16, 3.2, 18); c.fillRect(3, -14, 3.2, 16);
            c.restore();
            break;
          default:
            c.fillStyle = col; c.beginPath(); c.arc(0, 0, 7, 0, 6.283); c.fill();
            c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(-2, -2, 3, 0, 6.283); c.fill();
        }
        c.restore();
        c.restore(); return;
      }

      /* ---- units ---- */
      var d = IF.UNITS[id];

      if (d.cat === 'air') {
        c.fillStyle = 'rgba(0,0,0,0.32)';
        c.beginPath(); c.ellipse(4, 16, 15, 5, 0, 0, 6.283); c.fill();
        c.translate(0, -4);
        c.rotate(-Math.PI / 2);
        c.fillStyle = legion ? '#6a6049' : '#55697a';
        c.beginPath();
        c.moveTo(16, 0); c.lineTo(5, -4); c.lineTo(-13, -3); c.lineTo(-16, 0);
        c.lineTo(-13, 3); c.lineTo(5, 4);
        c.closePath(); c.fill();
        c.fillRect(-4, -16, 7, 32);
        c.fillRect(-14, -8, 5, 16);
        c.fillStyle = 'rgba(255,244,206,0.22)';
        c.fillRect(-4, -16, 7, 3);
        c.fillStyle = '#9fd6e6';
        c.beginPath(); c.ellipse(6, 0, 3, 2, 0, 0, 6.283); c.fill();
        c.fillStyle = col;
        c.fillRect(-3, -15, 3, 5); c.fillRect(-3, 10, 3, 5);
        if (id === 'bomber') { c.fillStyle = legion ? '#6a6049' : '#55697a'; c.fillRect(-2, -19, 5, 5); c.fillRect(-2, 14, 5, 5); }
        c.restore(); return;
      }

      if (d.armor === 'infantry') {
        c.fillStyle = 'rgba(0,0,0,0.32)';
        c.beginPath(); c.ellipse(3, 15, 10, 4, 0, 0, 6.283); c.fill();
        var coat = legion ? '#6a5642' : '#556b5c';
        var coatLo = legion ? '#4a3c2d' : '#3b4c41';
        c.fillStyle = coatLo;
        c.fillRect(-5, 4, 4, 10); c.fillRect(1.5, 4, 4, 10);
        c.fillStyle = coat;
        c.beginPath(); c.ellipse(0, -1, 8, 10, 0, 0, 6.283); c.fill();
        c.fillStyle = 'rgba(255,244,206,0.20)';
        c.beginPath(); c.ellipse(-2.5, -4, 4.5, 5, 0, 0, 6.283); c.fill();
        c.fillStyle = dark;
        c.beginPath(); c.arc(0, -13, 6.5, 0, 6.283); c.fill();
        c.fillStyle = col;
        c.beginPath(); c.arc(0, -13, 4, 0, 6.283); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.beginPath(); c.arc(-2, -15, 2, 0, 6.283); c.fill();
        c.strokeStyle = '#1e211a'; c.lineWidth = 2.6;
        c.beginPath();
        if (id === 'sniper') { c.moveTo(8, 10); c.lineTo(15, -13); }
        else if (id === 'at_inf') { c.moveTo(6, 8); c.lineTo(16, -8); }
        else { c.moveTo(7, 9); c.lineTo(14, -8); }
        c.stroke();
        if (id === 'mg') { c.fillStyle = '#1e211a'; c.fillRect(8, -4, 5, 7); }
        if (id === 'at_inf') { c.fillStyle = '#3d4335'; c.fillRect(9, -6, 8, 5); }
        if (id === 'engineer') { c.fillStyle = '#e2c46a'; c.fillRect(-15, 0, 8, 8); }
        c.restore(); return;
      }

      /* ---- vehicles ---- */
      c.fillStyle = 'rgba(0,0,0,0.34)';
      c.beginPath(); c.ellipse(4, 12, 20, 7, 0, 0, 6.283); c.fill();
      c.translate(0, -3);
      var hull = legion ? '#6b6049' : '#5c6a5f';
      var hullHi = legion ? '#847860' : '#75857a';
      c.fillStyle = '#1d201a';
      c.fillRect(-18, -13, 36, 4.5);
      c.fillRect(-18, 8.5, 36, 4.5);
      c.fillStyle = 'rgba(255,255,255,0.10)';
      for (var tk = -18; tk < 18; tk += 5) { c.fillRect(tk, -13, 2.2, 4.5); c.fillRect(tk, 8.5, 2.2, 4.5); }
      c.fillStyle = hull;
      c.beginPath();
      c.moveTo(-18, -9); c.lineTo(14, -7.5); c.lineTo(18, 0); c.lineTo(14, 7.5); c.lineTo(-18, 9);
      c.closePath(); c.fill();
      c.fillStyle = hullHi;
      c.fillRect(-16, -7, 30, 6);
      if (d.harvest) {
        c.fillStyle = id === 'truck' ? '#dcb14a' : '#3c463f';
        c.fillRect(-15, -6, 17, 12);
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.fillRect(-15, -6, 17, 3);
        c.fillStyle = dark; c.fillRect(9, -8, 8, 16);
      } else {
        var tr = id === 'heavy' ? 10 : (id === 'light' ? 7.5 : 8.6);
        c.fillStyle = 'rgba(0,0,0,0.28)';
        c.beginPath(); c.arc(-1, 2.5, tr, 0, 6.283); c.fill();
        c.fillStyle = legion ? '#77694f' : '#68786c';
        c.beginPath(); c.arc(-2, 0, tr, 0, 6.283); c.fill();
        c.fillStyle = 'rgba(255,244,206,0.24)';
        c.beginPath(); c.arc(-3, -1.6, tr * 0.8, Math.PI, 0); c.fill();
        c.fillStyle = '#1e211a';
        c.fillRect(tr - 4, -2.2, id === 'artillery' ? 25 : (id === 'heavy' ? 22 : 17), 4.4);
        if (id === 'artillery') { c.fillStyle = '#2d3229'; c.fillRect(-13, -10, 5, 20); }
        if (id === 'heavy') { c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(-14, -8, 3.5, 16); c.fillRect(-8, -8, 3.5, 16); }
      }
      c.fillStyle = col;
      c.fillRect(-16, 5, 8, 3);
      c.restore();
    }
  };

  IF.ui = UI;
})(window.IF);

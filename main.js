/* IRON FRONT — main.js : boot, menu and the animation loop. */
(function (IF) {
  'use strict';

  var setup = { playerFaction: 'alliance', difficulty: 'normal', opening: 'standard' };
  var last = 0;

  function startGame() {
    var canvas = document.getElementById('view');
    IF.render.resize();
    IF.game = new IF.Game({
      playerFaction: setup.playerFaction,
      enemyFaction: setup.playerFaction === 'alliance' ? 'legion' : 'alliance',
      difficulty: setup.difficulty,
      startBoost: setup.opening === 'fast' ? 2 : 1,
      seed: 20260829
    });
    IF.game.viewW = canvas.clientWidth;
    IF.game.viewH = canvas.clientHeight;
    IF.game.centerOn(IF.game.players[0].hqStart.x, IF.game.players[0].hqStart.y, true);
    IF.game.onTerrainChanged = function () { IF.render._miniDirty = true; };
    IF.render._miniBase = null;
    IF.input.reset();
    IF.ui.buildCards(IF.game, true);
    IF.game.msg('Build a Barracks and a Vehicle Factory. Find the enemy HQ across the river.');
    document.getElementById('mainmenu').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    IF.audio.resume();
  }

  function loop(ts) {
    var dt = Math.min(0.05, (ts - last) / 1000 || 0);
    last = ts;
    var g = IF.game;
    if (g) {
      g.update(dt);
      IF.input.updateCamera(g, dt);
      IF.render.draw(g, dt);
      IF.ui.update(g, dt);
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', function () {
    var canvas = document.getElementById('view');
    var mini = document.getElementById('minimap');

    IF.render.init(canvas, mini);
    IF.ui.init();
    IF.input.init(canvas, mini);

    window.addEventListener('resize', function () {
      IF.render.resize();
      if (IF.game) {
        IF.game.viewW = canvas.clientWidth;
        IF.game.viewH = canvas.clientHeight;
      }
    });

    document.querySelectorAll('[data-faction]').forEach(function (b) {
      b.addEventListener('click', function () {
        setup.playerFaction = b.dataset.faction;
        document.querySelectorAll('[data-faction]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    document.querySelectorAll('[data-diff]').forEach(function (b) {
      b.addEventListener('click', function () {
        setup.difficulty = b.dataset.diff;
        document.querySelectorAll('[data-diff]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    document.querySelectorAll('[data-start]').forEach(function (b) {
      b.addEventListener('click', function () {
        setup.opening = b.dataset.start;
        document.querySelectorAll('[data-start]').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    document.getElementById('btnStart').addEventListener('click', startGame);

    requestAnimationFrame(loop);
  });

})(window.IF);

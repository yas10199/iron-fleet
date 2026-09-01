/* IRON FRONT — pathfinding.js
   Plain A* over the tile grid. Requests are queued and a limited number are
   solved per frame so a big group order can never freeze the game. */
(function (IF) {
  'use strict';

  var W = IF.MAP_W, H = IF.MAP_H, N = W * H;

  function Heap() { this.items = []; this.score = []; }
  Heap.prototype.push = function (item, score) {
    var i = this.items.length;
    this.items.push(item); this.score.push(score);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (this.score[p] <= this.score[i]) break;
      this.swap(p, i); i = p;
    }
  };
  Heap.prototype.swap = function (a, b) {
    var t = this.items[a]; this.items[a] = this.items[b]; this.items[b] = t;
    var s = this.score[a]; this.score[a] = this.score[b]; this.score[b] = s;
  };
  Heap.prototype.pop = function () {
    var top = this.items[0], last = this.items.pop(), ls = this.score.pop();
    if (this.items.length) {
      this.items[0] = last; this.score[0] = ls;
      var i = 0, n = this.items.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, m = i;
        if (l < n && this.score[l] < this.score[m]) m = l;
        if (r < n && this.score[r] < this.score[m]) m = r;
        if (m === i) break;
        this.swap(i, m); i = m;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.items.length; };

  var gScore = new Float32Array(N);
  var came = new Int32Array(N);
  var stamp = new Int32Array(N);
  var closed = new Int32Array(N);
  var run = 0;

  var DX = [1, -1, 0, 0, 1, 1, -1, -1];
  var DY = [0, 0, 1, -1, 1, -1, 1, -1];
  var DC = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];

  IF.Path = {
    queue: [],
    perFrame: 6,

    /* Ask for a path. One pending job per unit: asking again just updates the
       destination, so a busy frame can never leave a unit waiting forever. */
    request: function (unit, tx, ty) {
      unit.pathPending = true;
      for (var i = 0; i < this.queue.length; i++) {
        if (this.queue[i].unit === unit) { this.queue[i].tx = tx; this.queue[i].ty = ty; return; }
      }
      this.queue.push({ unit: unit, tx: tx, ty: ty });
      while (this.queue.length > 300) {
        var dropped = this.queue.shift();
        if (dropped.unit) dropped.unit.pathPending = false;
      }
    },

    tick: function (map) {
      var n = Math.min(this.perFrame, this.queue.length);
      for (var i = 0; i < n; i++) {
        var job = this.queue.shift();
        var u = job.unit;
        if (!u || u.dead) continue;
        u.pathPending = false;
        var p = this.solve(map, u.x, u.y, job.tx, job.ty, u.def.domain);
        u.path = p;
        u.pathIdx = 0;
        if (!p) { u.moveTargetX = job.tx; u.moveTargetY = job.ty; }
      }
    },

    /* Direct solve (world pixels in, world points out). */
    solve: function (map, sx, sy, tx, ty, domain) {
      var T = IF.TILE;
      var s = (Math.floor(sy / T) * W + Math.floor(sx / T));
      var goal = (Math.floor(ty / T) * W + Math.floor(tx / T));
      if (s < 0 || s >= N || goal < 0 || goal >= N) return null;

      if (!map.passIdx(goal, domain)) {
        goal = this.nearestOpen(map, goal, domain);
        if (goal < 0) return null;
      }
      if (s === goal) return null;

      run++;
      var heap = new Heap();
      gScore[s] = 0; stamp[s] = run; came[s] = -1;
      var gx = goal % W, gy = (goal / W) | 0;
      heap.push(s, 0);
      var expanded = 0, limit = 9000;

      while (heap.size()) {
        var cur = heap.pop();
        if (closed[cur] === run) continue;
        closed[cur] = run;
        if (cur === goal) return this.build(cur, s);
        if (++expanded > limit) break;

        var cx = cur % W, cy = (cur / W) | 0;
        var baseG = gScore[cur];
        for (var d = 0; d < 8; d++) {
          var nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          var ni = ny * W + nx;
          if (closed[ni] === run) continue;
          if (!map.passIdx(ni, domain)) continue;
          if (d >= 4) { /* no cutting diagonally through a blocked corner */
            if (!map.passIdx(cy * W + nx, domain) || !map.passIdx(ny * W + cx, domain)) continue;
          }
          var step = DC[d] * map.costIdx(ni);
          var ng = baseG + step;
          if (stamp[ni] !== run || ng < gScore[ni]) {
            stamp[ni] = run; gScore[ni] = ng; came[ni] = cur;
            var hx = Math.abs(nx - gx), hy = Math.abs(ny - gy);
            var hcost = (hx > hy) ? (hx + 0.414 * hy) : (hy + 0.414 * hx);
            heap.push(ni, ng + hcost * 1.08);
          }
        }
      }
      return null;
    },

    build: function (goal, start) {
      var T = IF.TILE, pts = [], cur = goal, guard = 0;
      while (cur !== start && cur !== -1 && guard++ < 4000) {
        pts.push({ x: (cur % W) * T + T / 2, y: (((cur / W) | 0)) * T + T / 2 });
        cur = came[cur];
      }
      pts.reverse();
      return pts.length ? pts : null;
    },

    nearestOpen: function (map, idx, domain) {
      var ox = idx % W, oy = (idx / W) | 0;
      for (var r = 1; r < 14; r++) {
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            var nx = ox + dx, ny = oy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            var ni = ny * W + nx;
            if (map.passIdx(ni, domain)) return ni;
          }
        }
      }
      return -1;
    }
  };

})(window.IF);

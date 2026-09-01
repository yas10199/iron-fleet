/* IRON FRONT — map.js
   Builds the battlefield: a river splitting the field with two bridges, roads,
   forests, ruined villages, and the resource nodes both sides fight over.
   The layout is mirrored so neither side gets a better start. */
(function (IF) {
  'use strict';

  var T = IF.TILE, W = IF.MAP_W, H = IF.MAP_H;

  function GameMap(seed) {
    this.w = W; this.h = H;
    this.pxW = W * T; this.pxH = H * T;
    this.tiles = new Uint8Array(W * H);
    this.block = new Int32Array(W * H);   // building id sitting on this tile
    this.detail = new Uint8Array(W * H);  // cosmetic variation for the renderer
    this.nodes = [];
    this.bases = [];
    this.generate(seed || 20260829);
  }

  GameMap.prototype.idx = function (tx, ty) { return ty * W + tx; };
  GameMap.prototype.inBounds = function (tx, ty) { return tx >= 0 && ty >= 0 && tx < W && ty < H; };

  GameMap.prototype.set = function (tx, ty, v) {
    if (this.inBounds(tx, ty)) this.tiles[ty * W + tx] = v;
  };

  GameMap.prototype.passIdx = function (i, domain) {
    if (domain === 'air') return true;
    if (this.block[i] !== 0) return false;
    var t = this.tiles[i];
    if (t === IF.T.WATER || t === IF.T.RUIN) return false;
    if (t === IF.T.FOREST) return domain === 'foot';
    return true;
  };

  GameMap.prototype.passTile = function (tx, ty, domain) {
    if (!this.inBounds(tx, ty)) return false;
    return this.passIdx(ty * W + tx, domain);
  };

  GameMap.prototype.passWorld = function (x, y, domain) {
    return this.passTile(Math.floor(x / T), Math.floor(y / T), domain);
  };

  GameMap.prototype.costIdx = function (i) {
    var t = this.tiles[i];
    if (t === IF.T.ROAD || t === IF.T.BRIDGE) return 0.65;
    if (t === IF.T.FOREST) return 1.7;
    if (t === IF.T.RUBBLE) return 1.25;
    return 1;
  };

  GameMap.prototype.speedAt = function (x, y) {
    var tx = Math.floor(x / T), ty = Math.floor(y / T);
    if (!this.inBounds(tx, ty)) return 1;
    var t = this.tiles[ty * W + tx];
    if (t === IF.T.ROAD || t === IF.T.BRIDGE) return 1.35;
    if (t === IF.T.FOREST) return 0.65;
    if (t === IF.T.RUBBLE) return 0.85;
    return 1;
  };

  /* --- occupancy ------------------------------------------------------- */
  GameMap.prototype.occupy = function (b) {
    for (var y = b.ty; y < b.ty + b.def.h; y++)
      for (var x = b.tx; x < b.tx + b.def.w; x++)
        if (this.inBounds(x, y)) this.block[y * W + x] = b.id;
  };
  GameMap.prototype.release = function (b) {
    for (var y = b.ty; y < b.ty + b.def.h; y++)
      for (var x = b.tx; x < b.tx + b.def.w; x++)
        if (this.inBounds(x, y) && this.block[y * W + x] === b.id) {
          this.block[y * W + x] = 0;
          this.tiles[y * W + x] = IF.T.RUBBLE;
        }
  };

  GameMap.prototype.canPlace = function (tx, ty, w, h) {
    for (var y = ty; y < ty + h; y++) {
      for (var x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, y)) return false;
        var i = y * W + x;
        if (this.block[i] !== 0) return false;
        var t = this.tiles[i];
        if (t === IF.T.WATER || t === IF.T.RUIN || t === IF.T.FOREST || t === IF.T.BRIDGE) return false;
        for (var n = 0; n < this.nodes.length; n++) {
          var nd = this.nodes[n];
          if (x >= nd.tx - 1 && x <= nd.tx + 2 && y >= nd.ty - 1 && y <= nd.ty + 2) return false;
        }
      }
    }
    return true;
  };

  /* --- generation ------------------------------------------------------ */
  GameMap.prototype.generate = function (seed) {
    var rng = IF.makeRng(seed), i, x, y;

    for (i = 0; i < this.tiles.length; i++) {
      this.tiles[i] = IF.T.FIELD;
      this.detail[i] = (rng() * 6) | 0;
    }

    // River down the middle, wiggling a little.
    this.riverX = new Float32Array(H);
    for (y = 0; y < H; y++) {
      var cx = 48 + Math.sin(y * 0.085) * 4.5 + Math.sin(y * 0.031) * 2.5;
      this.riverX[y] = cx;
      var halfW = 2 + Math.sin(y * 0.05) * 0.8;
      for (x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) this.set(x, y, IF.T.WATER);
    }

    // Two bridges — the only way armour crosses.
    this.bridges = [];
    var bys = [15, 54];
    for (var b = 0; b < bys.length; b++) {
      var by = bys[b], tilesB = [];
      for (y = by; y <= by + 2; y++) {
        var c = this.riverX[y];
        for (x = Math.floor(c - 4); x <= Math.ceil(c + 4); x++) {
          if (this.inBounds(x, y) && this.tiles[y * W + x] === IF.T.WATER) {
            this.set(x, y, IF.T.BRIDGE);
            tilesB.push(y * W + x);
          }
        }
      }
      this.bridges.push({ y: by + 1, x: this.riverX[by + 1], tiles: tilesB, hp: 900, maxHp: 900, dead: false });
    }

    // Roads: two east-west highways through the bridges, plus base spurs.
    this.hLine(6, 89, 16);
    this.hLine(6, 89, 55);
    this.vLine(12, 16, 55);
    this.vLine(83, 16, 55);
    this.hLine(12, 22, 34);
    this.hLine(73, 83, 34);

    // Forests, mirrored left/right.
    for (var f = 0; f < 16; f++) {
      var fx = 6 + Math.floor(rng() * 36), fy = 4 + Math.floor(rng() * (H - 8));
      var r = 2 + Math.floor(rng() * 3);
      this.blob(fx, fy, r, IF.T.FOREST, rng);
      this.blob(W - 1 - fx, fy, r, IF.T.FOREST, rng);
    }

    // Abandoned villages near the crossings — cover and chokepoints.
    var villages = [[38, 12], [38, 58], [30, 34], [42, 44]];
    for (var v = 0; v < villages.length; v++) {
      this.village(villages[v][0], villages[v][1], rng);
      this.village(W - 1 - villages[v][0], villages[v][1], rng);
    }

    // Base positions.
    this.bases = [
      { tx: 10, ty: 32 },       // player, west
      { tx: W - 14, ty: 32 }    // AI, east
    ];
    this.clearArea(this.bases[0].tx - 6, this.bases[0].ty - 8, 18, 18);
    this.clearArea(this.bases[1].tx - 6, this.bases[1].ty - 8, 18, 18);

    // Resource nodes: two safe per side, four contested in the middle.
    var nodeSpots = [
      [20, 16, 'supplies'], [20, 50, 'supplies'], [9, 22, 'fuel'], [9, 46, 'fuel'],
      [40, 9, 'supplies'], [40, 62, 'supplies'], [39, 34, 'fuel']
    ];
    for (var n = 0; n < nodeSpots.length; n++) {
      var sp = nodeSpots[n];
      this.addNode(sp[0], sp[1], sp[2]);
      this.addNode(W - 2 - sp[0], sp[1], sp[2]);
    }
  };

  GameMap.prototype.hLine = function (x0, x1, y) {
    for (var x = x0; x <= x1; x++) {
      for (var d = 0; d < 2; d++) {
        var yy = y + d;
        if (!this.inBounds(x, yy)) continue;
        var t = this.tiles[yy * W + x];
        if (t === IF.T.WATER || t === IF.T.BRIDGE) continue;
        this.tiles[yy * W + x] = IF.T.ROAD;
      }
    }
  };
  GameMap.prototype.vLine = function (x, y0, y1) {
    for (var y = y0; y <= y1; y++) {
      for (var d = 0; d < 2; d++) {
        var xx = x + d;
        if (!this.inBounds(xx, y)) continue;
        var t = this.tiles[y * W + xx];
        if (t === IF.T.WATER || t === IF.T.BRIDGE) continue;
        this.tiles[y * W + xx] = IF.T.ROAD;
      }
    }
  };

  GameMap.prototype.blob = function (cx, cy, r, type, rng) {
    for (var y = cy - r; y <= cy + r; y++) {
      for (var x = cx - r; x <= cx + r; x++) {
        if (!this.inBounds(x, y)) continue;
        var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d > r + rng() * 0.9 - 0.4) continue;
        var t = this.tiles[y * W + x];
        if (t === IF.T.WATER || t === IF.T.BRIDGE || t === IF.T.ROAD) continue;
        this.tiles[y * W + x] = type;
      }
    }
  };

  GameMap.prototype.village = function (cx, cy, rng) {
    var count = 3 + Math.floor(rng() * 3);
    for (var k = 0; k < count; k++) {
      var ox = cx + Math.floor(rng() * 7) - 3, oy = cy + Math.floor(rng() * 7) - 3;
      var w = 1 + Math.floor(rng() * 2), h = 1 + Math.floor(rng() * 2);
      for (var y = oy; y < oy + h; y++) {
        for (var x = ox; x < ox + w; x++) {
          if (!this.inBounds(x, y)) continue;
          var t = this.tiles[y * W + x];
          if (t === IF.T.WATER || t === IF.T.BRIDGE) continue;
          this.tiles[y * W + x] = IF.T.RUIN;
        }
      }
    }
  };

  GameMap.prototype.clearArea = function (tx, ty, w, h) {
    for (var y = ty; y < ty + h; y++)
      for (var x = tx; x < tx + w; x++) {
        if (!this.inBounds(x, y)) continue;
        var t = this.tiles[y * W + x];
        if (t === IF.T.FOREST || t === IF.T.RUIN || t === IF.T.RUBBLE) this.tiles[y * W + x] = IF.T.FIELD;
      }
  };

  GameMap.prototype.addNode = function (tx, ty, type) {
    // Never drop a node in the river.
    for (var tries = 0; tries < 40; tries++) {
      var ok = true;
      for (var y = ty; y < ty + 2 && ok; y++)
        for (var x = tx; x < tx + 2 && ok; x++)
          if (!this.inBounds(x, y) || this.tiles[y * W + x] === IF.T.WATER || this.tiles[y * W + x] === IF.T.BRIDGE) ok = false;
      if (ok) break;
      tx += (tx < W / 2) ? -2 : 2;
    }
    this.clearArea(tx - 1, ty - 1, 4, 4);
    var max = type === 'supplies' ? IF.NODE_SUPPLY : IF.NODE_FUEL;
    this.nodes.push({
      tx: tx, ty: ty, type: type,
      x: tx * T + T, y: ty * T + T,
      amount: max, max: max
    });
  };

  GameMap.prototype.destroyBridge = function (bridge) {
    if (bridge.dead) return;
    bridge.dead = true;
    for (var i = 0; i < bridge.tiles.length; i++) this.tiles[bridge.tiles[i]] = IF.T.WATER;
  };

  GameMap.prototype.nearestNode = function (x, y, type, filterFn) {
    var best = null, bd = Infinity;
    for (var i = 0; i < this.nodes.length; i++) {
      var n = this.nodes[i];
      if (n.type !== type || n.amount <= 0) continue;
      if (filterFn && !filterFn(n)) continue;
      var d = IF.dist2(x, y, n.x, n.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };

  IF.GameMap = GameMap;
})(window.IF);

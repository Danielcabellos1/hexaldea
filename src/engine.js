/* Hexaldea — motor de reglas (sin interfaz). Funciona igual en el navegador y en Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HX = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Constantes ---------- */
  // Recursos: W madera, B ladrillo, S lana, G trigo, O piedra. Terreno D = páramo (no produce).
  var RES = ['W', 'B', 'S', 'G', 'O'];
  var RES_NAME = { W: 'madera', B: 'ladrillo', S: 'lana', G: 'trigo', O: 'piedra' };
  // Cartas de progreso: K guardia, V monumento (1 punto), R obras (2 caminos), P abundancia (2 recursos), M acaparador.
  var DEV_NAME = { K: 'Guardia', V: 'Monumento', R: 'Obras', P: 'Abundancia', M: 'Acaparador' };
  var COST = {
    road: { W: 1, B: 1 },
    sett: { W: 1, B: 1, S: 1, G: 1 },
    city: { G: 2, O: 3 },
    dev: { S: 1, G: 1, O: 1 }
  };
  var PIECES = { road: 15, sett: 5, city: 4 };
  var PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  var BOARD = {
    std: {
      rows: [3, 4, 5, 4, 3],
      terrain: { W: 4, S: 4, G: 4, B: 3, O: 3, D: 1 },
      nums: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
      harbors: ['*', '*', '*', '*', 'W', 'B', 'S', 'G', 'O'],
      steps: [3, 3, 4, 3, 3, 4, 3, 3, 4],
      bank: 19,
      deck: { K: 14, V: 5, R: 2, P: 2, M: 2 }
    },
    ext: {
      rows: [3, 4, 5, 6, 5, 4, 3],
      terrain: { W: 6, S: 6, G: 6, B: 5, O: 5, D: 2 },
      nums: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
      harbors: ['*', '*', '*', '*', '*', 'W', 'B', 'S', 'S', 'G', 'O'],
      steps: [3, 4, 3, 4, 3, 4, 3, 4, 3, 4, 3],
      bank: 24,
      deck: { K: 20, V: 5, R: 3, P: 3, M: 3 }
    }
  };
  var MAX_PLAYERS = 6;
  var LOG_MAX = 60;

  /* ---------- Utilidades ---------- */
  function emptyRes() { return { W: 0, B: 0, S: 0, G: 0, O: 0 }; }
  function total(r) { return (r.W || 0) + (r.B || 0) + (r.S || 0) + (r.G || 0) + (r.O || 0); }
  function hasRes(have, cost) {
    for (var k in cost) if ((have[k] || 0) < cost[k]) return false;
    return true;
  }
  function addRes(to, r, sign) {
    sign = sign === undefined ? 1 : sign;
    for (var k in r) to[k] = (to[k] || 0) + sign * r[k];
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  // Generador con semilla (para pruebas reproducibles).
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function cleanRes(o) {
    // Normaliza un objeto {recurso: cantidad} recibido de fuera. Devuelve null si no es válido.
    if (!o || typeof o !== 'object') return null;
    var out = {}, any = false;
    for (var i = 0; i < RES.length; i++) {
      var k = RES[i], n = o[k];
      if (n === undefined || n === null || n === 0) continue;
      if (typeof n !== 'number' || n < 0 || n > 99 || Math.floor(n) !== n) return null;
      out[k] = n; any = true;
    }
    for (var key in o) if (RES.indexOf(key) < 0) return null;
    return any ? out : {};
  }
  function resText(r) {
    var parts = [];
    for (var i = 0; i < RES.length; i++) if (r[RES[i]]) parts.push(r[RES[i]] + ' ' + RES_NAME[RES[i]]);
    return parts.join(', ');
  }

  /* ---------- Geometría del tablero ---------- */
  // Rejilla entera: el centro de cada hexágono está en (x, y) con x = 2*col - (L-1), y = 3*fila.
  // En píxeles: px = x * (√3/2 · lado), py = y * (lado/2).
  var GEO = {};
  function geo(kind) {
    if (GEO[kind]) return GEO[kind];
    var rows = BOARD[kind].rows;
    var hexes = [], vertices = [], edges = [];
    var vKey = {}, eKey = {};
    var r, c, i;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r]; c++) {
        hexes.push({ id: hexes.length, r: r, c: c, x: 2 * c - (rows[r] - 1), y: 3 * r, v: [], e: [], nbr: [] });
      }
    }
    var OFF = [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]];
    hexes.forEach(function (h) {
      for (i = 0; i < 6; i++) {
        var key = (h.x + OFF[i][0]) + ',' + (h.y + OFF[i][1]);
        var id = vKey[key];
        if (id === undefined) {
          id = vertices.length; vKey[key] = id;
          vertices.push({ id: id, x: h.x + OFF[i][0], y: h.y + OFF[i][1], hexes: [], adj: [], edges: [] });
        }
        h.v.push(id); vertices[id].hexes.push(h.id);
      }
      for (i = 0; i < 6; i++) {
        var a = h.v[i], b = h.v[(i + 1) % 6];
        var lo = Math.min(a, b), hi = Math.max(a, b);
        var ek = lo + '-' + hi;
        var eid = eKey[ek];
        if (eid === undefined) {
          eid = edges.length; eKey[ek] = eid;
          edges.push({ id: eid, a: lo, b: hi, hexes: [] });
          vertices[lo].adj.push(hi); vertices[hi].adj.push(lo);
          vertices[lo].edges.push(eid); vertices[hi].edges.push(eid);
        }
        h.e.push(eid); edges[eid].hexes.push(h.id);
      }
    });
    edges.forEach(function (e) {
      if (e.hexes.length === 2) {
        hexes[e.hexes[0]].nbr.push(e.hexes[1]);
        hexes[e.hexes[1]].nbr.push(e.hexes[0]);
      }
    });
    // Costa: aristas con un solo hexágono, ordenadas en ciclo en sentido horario empezando arriba.
    var cx = 0, cy = (rows.length - 1) * 3 / 2;
    var coastSet = edges.filter(function (e) { return e.hexes.length === 1; });
    var byV = {};
    coastSet.forEach(function (e) {
      (byV[e.a] = byV[e.a] || []).push(e.id);
      (byV[e.b] = byV[e.b] || []).push(e.id);
    });
    function ang(e) {
      // Ángulo horario desde "arriba", en píxeles reales para que sea correcto.
      var mx = (vertices[e.a].x + vertices[e.b].x) / 2 * 0.8660254;
      var my = (vertices[e.a].y + vertices[e.b].y) / 2 * 0.5 - cy * 0.5;
      var t = Math.atan2(mx - cx, -my);
      return t < 0 ? t + 2 * Math.PI : t;
    }
    var start = coastSet.slice().sort(function (p, q) { return ang(p) - ang(q); })[0];
    var coast = [start.id];
    // Elegir sentido: el extremo cuya otra arista costera tiene mayor ángulo.
    function other(vid, eid) { var l = byV[vid]; return l[0] === eid ? l[1] : l[0]; }
    var na = other(start.a, start.id), nb = other(start.b, start.id);
    var v = ang(edges[na]) < ang(edges[nb]) ? start.a : start.b;
    var prev = start.id;
    for (;;) {
      var next = other(v, prev);
      if (next === start.id) break;
      coast.push(next);
      v = edges[next].a === v ? edges[next].b : edges[next].a;
      prev = next;
    }
    var steps = BOARD[kind].steps, slots = [], pos = 1;
    for (i = 0; i < steps.length; i++) { slots.push(coast[pos % coast.length]); pos += steps[i]; }
    GEO[kind] = { kind: kind, rows: rows, hexes: hexes, vertices: vertices, edges: edges, coast: coast, harborSlots: slots };
    return GEO[kind];
  }

  /* ---------- Creación de partida ---------- */
  function placeNumbers(G, terrain, nums, rng) {
    var land = [];
    terrain.forEach(function (t, i) { if (t !== 'D') land.push(i); });
    var reds = nums.filter(function (x) { return x === 6 || x === 8; });
    var rest = nums.filter(function (x) { return x !== 6 && x !== 8; });
    for (var attempt = 0; attempt < 300; attempt++) {
      var num = [];
      for (var k = 0; k < terrain.length; k++) num.push(0);
      var cand = shuffle(land.slice(), rng);
      var rs = shuffle(reds.slice(), rng);
      var ok = true;
      for (var i = 0; i < rs.length && ok; i++) {
        var found = -1;
        for (var j = 0; j < cand.length; j++) {
          var h = cand[j];
          if (num[h] !== 0) continue;
          var clash = G.hexes[h].nbr.some(function (x) { return num[x] === 6 || num[x] === 8; });
          if (!clash) { found = h; break; }
        }
        if (found < 0) ok = false; else num[found] = rs[i];
      }
      if (!ok) continue;
      var others = shuffle(rest.slice(), rng);
      land.forEach(function (h) { if (num[h] === 0) num[h] = others.pop(); });
      return num;
    }
    return null;
  }

  function newGame(playerDefs, opts, rng) {
    rng = rng || Math.random;
    opts = opts || {};
    var n = playerDefs.length;
    if (n < 2 || n > MAX_PLAYERS) throw new Error('Número de jugadores no válido');
    var kind = opts.board === 'std' || opts.board === 'ext' ? opts.board : (n >= 5 ? 'ext' : 'std');
    if (n >= 5) kind = 'ext';
    var B = BOARD[kind], G = geo(kind);
    var bag = [];
    Object.keys(B.terrain).forEach(function (t) { for (var i = 0; i < B.terrain[t]; i++) bag.push(t); });
    var terrain, num = null;
    while (!num) { terrain = shuffle(bag.slice(), rng); num = placeNumbers(G, terrain, B.nums, rng); }
    var types = shuffle(B.harbors.slice(), rng);
    var harbors = G.harborSlots.map(function (e, i) { return { e: e, t: types[i] }; });
    var deck = [];
    Object.keys(B.deck).forEach(function (k) { for (var i = 0; i < B.deck[k]; i++) deck.push(k); });
    shuffle(deck, rng);
    var defs = playerDefs.slice();
    if (opts.shuffle !== false) shuffle(defs, rng);
    var players = defs.map(function (d) {
      return {
        name: String(d.name || 'Jugador').slice(0, 14), color: d.color || 0, bot: !!d.bot, key: d.key || null,
        res: emptyRes(), dev: [], played: { K: 0, R: 0, P: 0, M: 0 },
        left: { road: PIECES.road, sett: PIECES.sett, city: PIECES.city }, roadLen: 0
      };
    });
    var order = [];
    var i;
    for (i = 0; i < n; i++) order.push(i);
    for (i = n - 1; i >= 0; i--) order.push(i);
    var bank = {};
    RES.forEach(function (r) { bank[r] = B.bank; });
    var state = {
      v: 1, phase: 'setup',
      opts: { target: opts.target >= 5 && opts.target <= 15 ? opts.target : 10 },
      players: players,
      board: { kind: kind, terrain: terrain, num: num, harbors: harbors, robber: terrain.indexOf('D') },
      bld: {}, roads: {}, bank: bank, deck: deck,
      turn: { p: 0, n: 0, rolled: false, dice: null, devUsed: false, gains: null },
      setup: { order: order, i: 0, v: null },
      pend: null, special: null,
      awards: { road: null, army: null },
      trades: [], tid: 0,
      log: [], ev: 0, fx: null, plog: players.map(function () { return []; }),
      winner: null
    };
    addLog(state, -1, 'Empieza la partida. Colocad vuestras dos primeras aldeas.');
    return state;
  }

  function addLog(state, p, m) {
    state.ev++;
    state.log.push({ n: state.ev, p: p, m: m });
    if (state.log.length > LOG_MAX) state.log.splice(0, state.log.length - LOG_MAX);
  }
  function addPriv(state, p, m) {
    state.ev++;
    var l = state.plog[p];
    l.push({ n: state.ev, m: m });
    if (l.length > 8) l.splice(0, l.length - 8);
  }
  function setFx(state, fx) { state.ev++; fx.n = state.ev; state.fx = fx; }

  /* ---------- Consultas de reglas (valen para el estado completo y para la vista del cliente) ---------- */
  function okSettlement(state, G, p, v, setup) {
    var V = G.vertices[v];
    if (!V || state.bld[v]) return false;
    for (var i = 0; i < V.adj.length; i++) if (state.bld[V.adj[i]]) return false;
    if (setup) return true;
    for (var j = 0; j < V.edges.length; j++) if (state.roads[V.edges[j]] === p) return true;
    return false;
  }
  function okRoad(state, G, p, e) {
    var E = G.edges[e];
    if (!E || state.roads[e] !== undefined) return false;
    var ends = [E.a, E.b];
    for (var i = 0; i < 2; i++) {
      var x = ends[i], b = state.bld[x];
      if (b && b[0] === p) return true;
      if (b && b[0] !== p) continue; // un edificio rival corta el paso
      var es = G.vertices[x].edges;
      for (var j = 0; j < es.length; j++) if (es[j] !== e && state.roads[es[j]] === p) return true;
    }
    return false;
  }
  function legalSettlements(state, p, setup) {
    var G = geo(state.board.kind), out = [];
    for (var v = 0; v < G.vertices.length; v++) if (okSettlement(state, G, p, v, setup)) out.push(v);
    return out;
  }
  function legalRoads(state, p) {
    var G = geo(state.board.kind), out = [];
    for (var e = 0; e < G.edges.length; e++) if (okRoad(state, G, p, e)) out.push(e);
    return out;
  }
  function setupRoads(state) {
    // Caminos posibles junto a la aldea recién colocada en la preparación.
    var G = geo(state.board.kind), su = state.setup, out = [];
    if (!su || su.v === null) return out;
    G.vertices[su.v].edges.forEach(function (e) { if (state.roads[e] === undefined) out.push(e); });
    return out;
  }
  function legalCities(state, p) {
    var out = [];
    for (var k in state.bld) if (state.bld[k][0] === p && state.bld[k][1] === 1) out.push(+k);
    return out;
  }
  function harborMap(state) {
    // vértice -> tipo de puerto ('*' genérico o un recurso)
    var G = geo(state.board.kind), m = {};
    state.board.harbors.forEach(function (h) {
      var E = G.edges[h.e];
      m[E.a] = h.t; m[E.b] = h.t;
    });
    return m;
  }
  function ratios(state, p) {
    var hm = harborMap(state), r = { W: 4, B: 4, S: 4, G: 4, O: 4 };
    for (var k in state.bld) {
      if (state.bld[k][0] !== p) continue;
      var t = hm[k];
      if (!t) continue;
      if (t === '*') RES.forEach(function (x) { if (r[x] > 3) r[x] = 3; });
      else r[t] = 2;
    }
    return r;
  }
  function roadLength(state, G, p) {
    var best = 0, used = {};
    function dfs(v, len) {
      if (len > best) best = len;
      var b = state.bld[v];
      if (len > 0 && b && b[0] !== p) return;
      var es = G.vertices[v].edges;
      for (var i = 0; i < es.length; i++) {
        var e = es[i];
        if (state.roads[e] !== p || used[e]) continue;
        used[e] = true;
        dfs(G.edges[e].a === v ? G.edges[e].b : G.edges[e].a, len + 1);
        used[e] = false;
      }
    }
    var starts = {};
    for (var k in state.roads) {
      if (state.roads[k] !== p) continue;
      starts[G.edges[k].a] = 1; starts[G.edges[k].b] = 1;
    }
    for (var s in starts) dfs(+s, 0);
    return best;
  }
  function vpPublic(state, p) {
    var pl = state.players[p];
    var v = (PIECES.sett - pl.left.sett) + 2 * (PIECES.city - pl.left.city);
    if (state.awards.road === p) v += 2;
    if (state.awards.army === p) v += 2;
    return v;
  }
  function hiddenVp(pl) {
    var n = 0;
    for (var i = 0; i < pl.dev.length; i++) if (pl.dev[i].k === 'V') n++;
    return n;
  }
  function vpTotal(state, p) { return vpPublic(state, p) + hiddenVp(state.players[p]); }
  function robberVictims(state, G, p, h) {
    var out = [];
    G.hexes[h].v.forEach(function (v) {
      var b = state.bld[v];
      if (b && b[0] !== p && out.indexOf(b[0]) < 0) {
        var pl = state.players[b[0]];
        var n = pl.res ? total(pl.res) : pl.nRes;
        if (n > 0) out.push(b[0]);
      }
    });
    return out;
  }
  function canBuildAnything(state, p) {
    var me = state.players[p];
    if (hasRes(me.res, COST.city) && me.left.city > 0 && legalCities(state, p).length) return true;
    if (hasRes(me.res, COST.sett) && me.left.sett > 0 && legalSettlements(state, p, false).length) return true;
    if (hasRes(me.res, COST.dev) && state.deck.length > 0) return true;
    if (hasRes(me.res, COST.road) && me.left.road > 0 && legalRoads(state, p).length) return true;
    return false;
  }
  // Quién tiene que hacer algo ahora mismo.
  function whoActs(state) {
    if (state.phase === 'setup') {
      return { who: [state.setup.order[state.setup.i]], what: state.setup.v === null ? 'setupS' : 'setupR' };
    }
    if (state.phase !== 'main') return { who: [], what: state.phase };
    var pd = state.pend;
    if (pd) {
      if (pd.type === 'discard') return { who: Object.keys(pd.need).map(Number), what: 'discard' };
      return { who: [pd.by], what: pd.type };
    }
    if (state.special) return { who: [state.special.p], what: 'special' };
    return { who: [state.turn.p], what: state.turn.rolled ? 'main' : 'roll' };
  }

  /* ---------- Premios ---------- */
  function updateRoadAward(state, G) {
    var n = state.players.length, max = 0, p;
    for (p = 0; p < n; p++) {
      var L = roadLength(state, G, p);
      state.players[p].roadLen = L;
      if (L > max) max = L;
    }
    var cur = state.awards.road, nw;
    if (max < 5) nw = null;
    else if (cur !== null && state.players[cur].roadLen === max) nw = cur;
    else {
      var c = [];
      for (p = 0; p < n; p++) if (state.players[p].roadLen === max) c.push(p);
      nw = c.length === 1 ? c[0] : null;
    }
    if (nw !== cur) {
      state.awards.road = nw;
      if (nw !== null) addLog(state, nw, 'consigue la Ruta más larga (2 puntos)');
      else addLog(state, -1, 'La Ruta más larga queda sin dueño');
    }
  }
  function updateArmyAward(state) {
    var cur = state.awards.army;
    var best = cur, bestN = cur === null ? 2 : state.players[cur].played.K;
    for (var p = 0; p < state.players.length; p++) {
      if (state.players[p].played.K > bestN) { best = p; bestN = state.players[p].played.K; }
    }
    if (best !== cur) {
      state.awards.army = best;
      addLog(state, best, 'consigue la Guardia más numerosa (2 puntos)');
    }
  }

  /* ---------- Flujo de turnos ---------- */
  function checkWin(state) {
    if (state.phase !== 'main' || state.special) return;
    var p = state.turn.p;
    if (vpTotal(state, p) >= state.opts.target) {
      state.phase = 'over';
      state.winner = p;
      state.pend = null; state.trades = [];
      addLog(state, p, '¡gana la partida con ' + vpTotal(state, p) + ' puntos!');
      setFx(state, { k: 'win', p: p });
    }
  }
  function beginTurn(state, p) {
    state.turn = { p: p, n: state.turn.n + 1, rolled: false, dice: null, devUsed: false, gains: null };
    state.trades = []; state.special = null; state.pend = null;
    checkWin(state);
  }
  function nextTurn(state) { beginTurn(state, (state.turn.p + 1) % state.players.length); }
  function advanceSpecial(state) {
    var sp = state.special;
    while (sp.queue.length) {
      var q = sp.queue.shift();
      if (canBuildAnything(state, q)) { sp.p = q; return; }
    }
    state.special = null;
    nextTurn(state);
  }
  function produce(state, G, sum) {
    var n = state.players.length, due = [], p, gains = {};
    for (p = 0; p < n; p++) due.push(emptyRes());
    G.hexes.forEach(function (h) {
      if (state.board.num[h.id] !== sum || state.board.robber === h.id) return;
      var r = state.board.terrain[h.id];
      h.v.forEach(function (v) { var b = state.bld[v]; if (b) due[b[0]][r] += b[1]; });
    });
    RES.forEach(function (r) {
      var tot = 0, who = 0;
      for (p = 0; p < n; p++) if (due[p][r]) { tot += due[p][r]; who++; }
      if (!tot) return;
      if (tot > state.bank[r]) {
        if (who === 1) { for (p = 0; p < n; p++) if (due[p][r]) due[p][r] = state.bank[r]; }
        else {
          for (p = 0; p < n; p++) due[p][r] = 0;
          addLog(state, -1, 'No queda suficiente ' + RES_NAME[r] + ' en la banca: nadie recibe');
        }
      }
      for (p = 0; p < n; p++) {
        if (!due[p][r]) continue;
        state.players[p].res[r] += due[p][r];
        state.bank[r] -= due[p][r];
        (gains[p] = gains[p] || {})[r] = due[p][r];
      }
    });
    return gains;
  }
  function stealFrom(state, p, q, rng) {
    var vr = state.players[q].res, pool = [];
    RES.forEach(function (r) { for (var i = 0; i < vr[r]; i++) pool.push(r); });
    if (!pool.length) return;
    var r = pool[Math.floor(rng() * pool.length)];
    vr[r]--; state.players[p].res[r]++;
    addLog(state, p, 'roba una carta a ' + state.players[q].name);
    addPriv(state, p, 'Has robado 1 ' + RES_NAME[r] + ' a ' + state.players[q].name);
    addPriv(state, q, state.players[p].name + ' te ha robado 1 ' + RES_NAME[r]);
    setFx(state, { k: 'steal', p: p, q: q });
  }
  function doTrade(state, a, b, aGives, bGives) {
    addRes(state.players[a].res, aGives, -1); addRes(state.players[b].res, aGives, 1);
    addRes(state.players[b].res, bGives, -1); addRes(state.players[a].res, bGives, 1);
    addLog(state, a, 'cambia ' + resText(aGives) + ' por ' + resText(bGives) + ' con ' + state.players[b].name);
    setFx(state, { k: 'trade', p: a, q: b });
  }

  /* ---------- Acciones ---------- */
  var E_TURN = 'No es tu turno', E_PEND = 'Antes hay que resolver lo pendiente', E_RES = 'Te faltan recursos',
    E_BAD = 'Jugada no válida', E_SPOT = 'Ahí no se puede construir';

  // Devuelve null si la jugada se ha aplicado, o un texto con el motivo si no es válida.
  function act(state, p, a, rng) {
    rng = rng || Math.random;
    if (!a || typeof a !== 'object' || typeof a.t !== 'string') return E_BAD;
    if (state.phase === 'over') return 'La partida ha terminado';
    if (state.phase !== 'setup' && state.phase !== 'main') return 'La partida no ha empezado';
    if (!state.players[p]) return E_BAD;
    var G = geo(state.board.kind);
    var err = state.phase === 'setup' ? actSetup(state, G, p, a) : actMain(state, G, p, a, rng);
    if (!err) { state.v++; if (state.phase === 'main') checkWin(state); }
    return err || null;
  }

  function actSetup(state, G, p, a) {
    var su = state.setup, n = state.players.length, me = state.players[p];
    if (su.order[su.i] !== p) return E_TURN;
    if (a.t === 'sett') {
      if (su.v !== null) return 'Ahora toca colocar el camino';
      if (!okSettlement(state, G, p, a.v, true)) return E_SPOT;
      state.bld[a.v] = [p, 1]; me.left.sett--;
      su.v = a.v;
      if (su.i >= n) {
        var got = {};
        G.vertices[a.v].hexes.forEach(function (h) {
          var t = state.board.terrain[h];
          if (t !== 'D' && state.bank[t] > 0) { me.res[t]++; state.bank[t]--; got[t] = (got[t] || 0) + 1; }
        });
        addLog(state, p, 'coloca su segunda aldea y recibe ' + (resText(got) || 'nada'));
      } else addLog(state, p, 'coloca su primera aldea');
      setFx(state, { k: 'sett', p: p, at: a.v });
      return null;
    }
    if (a.t === 'road') {
      if (su.v === null) return 'Primero coloca la aldea';
      var E = G.edges[a.e];
      if (!E || state.roads[a.e] !== undefined || (E.a !== su.v && E.b !== su.v)) return 'El camino tiene que salir de tu nueva aldea';
      state.roads[a.e] = p; me.left.road--;
      su.v = null; su.i++;
      setFx(state, { k: 'road', p: p, at: a.e });
      updateRoadAward(state, G);
      if (su.i >= su.order.length) {
        state.setup = null; state.phase = 'main';
        addLog(state, -1, 'Preparación terminada. Empieza ' + state.players[0].name + '.');
        beginTurn(state, 0);
      }
      return null;
    }
    return E_BAD;
  }

  function buildErr(state, p) {
    // ¿Puede este jugador construir o comprar ahora?
    if (state.special) return state.special.p === p ? null : E_TURN;
    if (state.turn.p !== p) return E_TURN;
    if (!state.turn.rolled) return 'Primero tira los dados';
    if (state.pend) return E_PEND;
    return null;
  }
  function tradeOpen(state) { return state.turn.rolled && !state.pend && !state.special; }

  function actMain(state, G, p, a, rng) {
    var T = state.turn, pd = state.pend, sp = state.special, me = state.players[p], n = state.players.length;
    var e, q, i, r;
    switch (a.t) {
      case 'roll': {
        if (sp || T.p !== p) return E_TURN;
        if (T.rolled) return 'Ya has tirado los dados';
        if (pd) return E_PEND;
        var d1 = 1 + Math.floor(rng() * 6), d2 = 1 + Math.floor(rng() * 6), sum = d1 + d2;
        T.rolled = true; T.dice = [d1, d2]; T.gains = null;
        addLog(state, p, 'tira los dados: ' + sum);
        if (sum === 7) {
          var need = {}, any = false;
          for (q = 0; q < n; q++) {
            var c = total(state.players[q].res);
            if (c > 7) { need[q] = Math.floor(c / 2); any = true; }
          }
          state.pend = any ? { type: 'discard', need: need, by: p } : { type: 'robber', by: p };
        } else {
          var gains = produce(state, G, sum);
          T.gains = gains;
          Object.keys(gains).forEach(function (k) { addLog(state, +k, 'recibe ' + resText(gains[k])); });
        }
        setFx(state, { k: 'roll', p: p, dice: [d1, d2] });
        return null;
      }
      case 'discard': {
        if (!pd || pd.type !== 'discard' || !pd.need[p]) return E_BAD;
        r = cleanRes(a.res);
        if (!r || total(r) !== pd.need[p]) return 'Tienes que descartar exactamente ' + pd.need[p] + ' cartas';
        if (!hasRes(me.res, r)) return 'No tienes esas cartas';
        addRes(me.res, r, -1); addRes(state.bank, r, 1);
        addLog(state, p, 'descarta ' + pd.need[p] + ' cartas');
        delete pd.need[p];
        if (!Object.keys(pd.need).length) state.pend = { type: 'robber', by: pd.by };
        return null;
      }
      case 'robber': {
        if (!pd || pd.type !== 'robber' || pd.by !== p) return E_BAD;
        if (!G.hexes[a.h] || a.h === state.board.robber) return 'Tienes que mover al bandido a otra casilla';
        state.board.robber = a.h;
        addLog(state, p, 'mueve al bandido');
        setFx(state, { k: 'robber', p: p, at: a.h });
        var vict = robberVictims(state, G, p, a.h);
        if (vict.length === 0) state.pend = null;
        else if (vict.length === 1) { state.pend = null; stealFrom(state, p, vict[0], rng); }
        else state.pend = { type: 'steal', by: p, from: vict };
        return null;
      }
      case 'steal': {
        if (!pd || pd.type !== 'steal' || pd.by !== p) return E_BAD;
        if (pd.from.indexOf(a.from) < 0) return 'No puedes robar a ese jugador';
        state.pend = null;
        stealFrom(state, p, a.from, rng);
        return null;
      }
      case 'road': {
        var free = !!(pd && pd.type === 'roads' && pd.by === p);
        if (!free) {
          e = buildErr(state, p); if (e) return e;
          if (!hasRes(me.res, COST.road)) return E_RES;
        }
        if (me.left.road <= 0) return 'No te quedan caminos';
        if (!okRoad(state, G, p, a.e)) return E_SPOT;
        if (!free) { addRes(me.res, COST.road, -1); addRes(state.bank, COST.road, 1); }
        state.roads[a.e] = p; me.left.road--;
        addLog(state, p, 'construye un camino');
        setFx(state, { k: 'road', p: p, at: a.e });
        updateRoadAward(state, G);
        if (free) {
          pd.n--;
          if (pd.n <= 0 || me.left.road <= 0 || !legalRoads(state, p).length) state.pend = null;
        }
        return null;
      }
      case 'sett': {
        e = buildErr(state, p); if (e) return e;
        if (!hasRes(me.res, COST.sett)) return E_RES;
        if (me.left.sett <= 0) return 'No te quedan aldeas: mejora alguna a ciudad';
        if (!okSettlement(state, G, p, a.v, false)) return E_SPOT;
        addRes(me.res, COST.sett, -1); addRes(state.bank, COST.sett, 1);
        state.bld[a.v] = [p, 1]; me.left.sett--;
        addLog(state, p, 'construye una aldea');
        setFx(state, { k: 'sett', p: p, at: a.v });
        updateRoadAward(state, G);
        return null;
      }
      case 'city': {
        e = buildErr(state, p); if (e) return e;
        if (!hasRes(me.res, COST.city)) return E_RES;
        if (me.left.city <= 0) return 'No te quedan ciudades';
        var b = state.bld[a.v];
        if (!b || b[0] !== p || b[1] !== 1) return 'Solo puedes mejorar una aldea tuya';
        addRes(me.res, COST.city, -1); addRes(state.bank, COST.city, 1);
        b[1] = 2; me.left.city--; me.left.sett++;
        addLog(state, p, 'mejora una aldea a ciudad');
        setFx(state, { k: 'city', p: p, at: a.v });
        return null;
      }
      case 'buy': {
        e = buildErr(state, p); if (e) return e;
        if (!hasRes(me.res, COST.dev)) return E_RES;
        if (!state.deck.length) return 'No quedan cartas de progreso';
        addRes(me.res, COST.dev, -1); addRes(state.bank, COST.dev, 1);
        var card = state.deck.pop();
        me.dev.push({ k: card, t: T.n });
        addLog(state, p, 'compra una carta de progreso');
        addPriv(state, p, 'Has comprado: ' + DEV_NAME[card]);
        setFx(state, { k: 'buy', p: p });
        return null;
      }
      case 'play': {
        if (sp || T.p !== p) return E_TURN;
        if (pd) return E_PEND;
        if (T.devUsed) return 'Solo se puede jugar una carta de progreso por turno';
        var k = a.k;
        if (k !== 'K' && k !== 'R' && k !== 'P' && k !== 'M') return E_BAD;
        var idx = -1;
        for (i = 0; i < me.dev.length; i++) if (me.dev[i].k === k && me.dev[i].t < T.n) { idx = i; break; }
        if (idx < 0) return 'No puedes jugar esa carta ahora';
        if (k === 'R' && (me.left.road <= 0 || !legalRoads(state, p).length)) return 'No tienes dónde colocar caminos';
        if (k === 'P') {
          if (!Array.isArray(a.res) || a.res.length !== 2 || RES.indexOf(a.res[0]) < 0 || RES.indexOf(a.res[1]) < 0) return E_BAD;
          var w = {}; w[a.res[0]] = 1; w[a.res[1]] = (w[a.res[1]] || 0) + 1;
          if (!hasRes(state.bank, w)) return 'La banca no tiene esos recursos';
        }
        if (k === 'M' && RES.indexOf(a.res) < 0) return E_BAD;
        me.dev.splice(idx, 1); T.devUsed = true; me.played[k]++;
        if (k === 'K') {
          addLog(state, p, 'juega una carta de Guardia');
          state.pend = { type: 'robber', by: p };
          updateArmyAward(state);
        } else if (k === 'R') {
          addLog(state, p, 'juega Obras: 2 caminos gratis');
          state.pend = { type: 'roads', by: p, n: Math.min(2, me.left.road) };
        } else if (k === 'P') {
          var g = {}; g[a.res[0]] = 1; g[a.res[1]] = (g[a.res[1]] || 0) + 1;
          addRes(me.res, g, 1); addRes(state.bank, g, -1);
          addLog(state, p, 'juega Abundancia y coge ' + resText(g));
        } else {
          var tot = 0;
          for (q = 0; q < n; q++) {
            if (q === p) continue;
            var x = state.players[q].res[a.res];
            if (x) { state.players[q].res[a.res] = 0; tot += x; }
          }
          me.res[a.res] += tot;
          addLog(state, p, 'juega Acaparador: se lleva ' + tot + ' de ' + RES_NAME[a.res]);
        }
        setFx(state, { k: 'play', p: p, card: k });
        return null;
      }
      case 'bank': {
        if (sp || T.p !== p) return E_TURN;
        if (!T.rolled) return 'Primero tira los dados';
        if (pd) return E_PEND;
        if (RES.indexOf(a.give) < 0 || RES.indexOf(a.get) < 0 || a.give === a.get) return E_BAD;
        var times = a.n === undefined ? 1 : a.n;
        if (typeof times !== 'number' || times < 1 || times > 10 || Math.floor(times) !== times) return E_BAD;
        var ratio = ratios(state, p)[a.give];
        if (me.res[a.give] < ratio * times) return E_RES;
        if (state.bank[a.get] < times) return 'La banca no tiene suficiente ' + RES_NAME[a.get];
        me.res[a.give] -= ratio * times; state.bank[a.give] += ratio * times;
        me.res[a.get] += times; state.bank[a.get] -= times;
        addLog(state, p, 'cambia ' + (ratio * times) + ' ' + RES_NAME[a.give] + ' por ' + times + ' ' + RES_NAME[a.get] + ' con la banca');
        setFx(state, { k: 'bank', p: p });
        return null;
      }
      case 'offer': {
        if (!tradeOpen(state)) return 'Ahora no se puede comerciar';
        var give = cleanRes(a.give), want = cleanRes(a.want);
        if (!give || !want || !total(give) || !total(want)) return 'Tienes que ofrecer algo y pedir algo';
        for (i = 0; i < RES.length; i++) if (give[RES[i]] && want[RES[i]]) return 'No puedes dar y pedir el mismo recurso';
        if (!hasRes(me.res, give)) return 'No tienes esas cartas';
        state.trades = state.trades.filter(function (t) { return t.from !== p; });
        state.tid++;
        state.trades.push({ id: state.tid, from: p, give: give, want: want, resp: {} });
        addLog(state, p, 'ofrece ' + resText(give) + ' a cambio de ' + resText(want));
        setFx(state, { k: 'offer', p: p });
        return null;
      }
      case 'respond': {
        if (!tradeOpen(state)) return 'Ahora no se puede comerciar';
        var t = null;
        for (i = 0; i < state.trades.length; i++) if (state.trades[i].id === a.id) t = state.trades[i];
        if (!t) return 'Esa oferta ya no existe';
        if (t.from === p) return E_BAD;
        if (t.from === T.p) {
          if (a.ok) {
            if (!hasRes(me.res, t.want)) return 'No tienes lo que pide';
            t.resp[p] = 1;
          } else t.resp[p] = -1;
          return null;
        }
        if (p !== T.p) return 'Solo puede responder quien tiene el turno';
        if (a.ok) {
          if (!hasRes(me.res, t.want)) return 'No tienes lo que pide';
          if (!hasRes(state.players[t.from].res, t.give)) return 'Ya no tiene esas cartas';
          state.trades = state.trades.filter(function (o) { return o !== t; });
          doTrade(state, t.from, p, t.give, t.want);
        } else {
          state.trades = state.trades.filter(function (o) { return o !== t; });
          addLog(state, p, 'rechaza la oferta de ' + state.players[t.from].name);
        }
        return null;
      }
      case 'confirm': {
        if (!tradeOpen(state)) return 'Ahora no se puede comerciar';
        var o = null;
        for (i = 0; i < state.trades.length; i++) if (state.trades[i].id === a.id) o = state.trades[i];
        if (!o || o.from !== p || p !== T.p) return 'Esa oferta ya no existe';
        q = a['with'];
        if (o.resp[q] !== 1 || !state.players[q]) return 'Ese jugador no ha aceptado';
        if (!hasRes(me.res, o.give)) return 'Ya no tienes esas cartas';
        if (!hasRes(state.players[q].res, o.want)) return 'Ya no tiene esas cartas';
        state.trades = state.trades.filter(function (z) { return z !== o; });
        doTrade(state, p, q, o.give, o.want);
        return null;
      }
      case 'cancel': {
        var before = state.trades.length;
        state.trades = state.trades.filter(function (z) { return !(z.id === a.id && z.from === p); });
        return state.trades.length === before ? 'Esa oferta ya no existe' : null;
      }
      case 'end': {
        if (sp || T.p !== p) return E_TURN;
        if (!T.rolled) return 'Primero tira los dados';
        if (pd) return E_PEND;
        state.trades = [];
        if (n >= 5) {
          var queue = [];
          for (i = 1; i < n; i++) queue.push((T.p + i) % n);
          state.special = { p: null, queue: queue };
          advanceSpecial(state);
        } else nextTurn(state);
        return null;
      }
      case 'pass': {
        if (!sp || sp.p !== p) return E_TURN;
        advanceSpecial(state);
        return null;
      }
    }
    return E_BAD;
  }

  /* ---------- Vistas (lo que ve cada uno) ---------- */
  function publicView(state) {
    var over = state.phase === 'over';
    return {
      v: state.v, phase: state.phase, opts: state.opts,
      board: state.board, bld: state.bld, roads: state.roads, bank: state.bank, deckN: state.deck.length,
      players: state.players.map(function (pl, i) {
        var o = {
          name: pl.name, color: pl.color, bot: pl.bot, nRes: total(pl.res), nDev: pl.dev.length,
          played: pl.played, left: pl.left, roadLen: pl.roadLen, vp: vpPublic(state, i)
        };
        if (over) { o.hid = hiddenVp(pl); o.vpAll = vpTotal(state, i); }
        return o;
      }),
      turn: state.turn, setup: state.setup,
      pend: state.pend, special: state.special ? { p: state.special.p } : null,
      awards: state.awards, trades: state.trades, log: state.log, ev: state.ev, fx: state.fx, winner: state.winner
    };
  }
  function privateView(state, p) {
    var pl = state.players[p], T = state.turn;
    return {
      me: p, res: pl.res,
      dev: pl.dev.map(function (c) { return { k: c.k, ok: c.k !== 'V' && c.t < T.n }; }),
      plog: state.plog[p]
    };
  }
  // Une la vista pública con la privada para que las consultas de reglas funcionen en el cliente.
  function mergeView(pub, priv) {
    var s = {};
    for (var k in pub) s[k] = pub[k];
    s.players = pub.players.map(function (pl, i) {
      var o = {};
      for (var k2 in pl) o[k2] = pl[k2];
      if (priv && priv.me === i) {
        o.res = priv.res; o.devCards = priv.dev;
        // misma forma que en el estado completo, para reutilizar las consultas de reglas y el bot
        o.dev = priv.dev.map(function (c) { return { k: c.k, t: c.ok ? -1 : 1e9 }; });
      }
      return o;
    });
    s.deck = { length: pub.deckN };
    s.me = priv ? priv.me : -1;
    s.plog = priv ? priv.plog : [];
    return s;
  }

  /* ---------- Bots sencillos ---------- */
  function vertexScore(state, G, hm, v, rng) {
    var s = 0, seen = {};
    G.vertices[v].hexes.forEach(function (h) {
      var t = state.board.terrain[h];
      if (t === 'D') return;
      s += PIPS[state.board.num[h]] || 0;
      if (!seen[t]) { seen[t] = 1; s += 1; }
    });
    if (hm[v]) s += 0.8;
    return s + rng() * 0.6;
  }
  function bestBy(list, f) {
    var best = null, bs = -Infinity;
    list.forEach(function (x) { var s = f(x); if (s > bs) { bs = s; best = x; } });
    return best;
  }
  function roadValue(state, G, hm, p, e, rng) {
    // Valor de un camino: lo bueno que es el mejor sitio libre al que acerca.
    var E = G.edges[e], best = 0;
    [E.a, E.b].forEach(function (x) {
      var cands = [x].concat(G.vertices[x].adj);
      cands.forEach(function (v) {
        if (state.bld[v]) return;
        var free = G.vertices[v].adj.every(function (u) { return !state.bld[u]; });
        if (!free) return;
        var sc = vertexScore(state, G, hm, v, rng) * (v === x ? 1 : 0.7);
        if (sc > best) best = sc;
      });
    });
    return best + rng() * 0.3;
  }
  function botGoal(state, p) {
    var me = state.players[p];
    function missing(cost) { var m = 0; for (var k in cost) m += Math.max(0, cost[k] - me.res[k]); return m; }
    var opts = [];
    if (me.left.city > 0 && legalCities(state, p).length) opts.push(COST.city);
    if (me.left.sett > 0 && legalSettlements(state, p, false).length) opts.push(COST.sett);
    else if (me.left.road > 0 && legalRoads(state, p).length) opts.push(COST.road);
    if (state.deck.length) opts.push(COST.dev);
    if (!opts.length) return null;
    var best = opts[0], bm = missing(opts[0]);
    for (var i = 1; i < opts.length; i++) { var m = missing(opts[i]); if (m < bm - 1) { best = opts[i]; bm = m; } }
    return best;
  }
  function botBuild(state, G, hm, p, rng, special) {
    var me = state.players[p];
    if (hasRes(me.res, COST.city) && me.left.city > 0) {
      var cs = legalCities(state, p);
      if (cs.length) return { t: 'city', v: bestBy(cs, function (v) { return vertexScore(state, G, hm, v, rng); }) };
    }
    var spots = legalSettlements(state, p, false);
    if (hasRes(me.res, COST.sett) && me.left.sett > 0 && spots.length) {
      return { t: 'sett', v: bestBy(spots, function (v) { return vertexScore(state, G, hm, v, rng); }) };
    }
    if (!special) {
      // Cambios con la banca para acercarse al objetivo.
      var goal = botGoal(state, p);
      if (goal && !hasRes(me.res, goal)) {
        var rt = ratios(state, p), need = null, i;
        for (i = 0; i < RES.length; i++) if ((goal[RES[i]] || 0) > me.res[RES[i]] && state.bank[RES[i]] > 0) { need = RES[i]; break; }
        if (need) {
          for (i = 0; i < RES.length; i++) {
            var x = RES[i];
            if (x !== need && me.res[x] - (goal[x] || 0) >= rt[x]) return { t: 'bank', give: x, get: need, n: 1 };
          }
        }
      }
    }
    if (hasRes(me.res, COST.dev) && state.deck.length && (!spots.length || me.left.sett === 0 || rng() < 0.6)) return { t: 'buy' };
    if (hasRes(me.res, COST.road) && me.left.road > 0 && (!spots.length || (me.res.W >= 2 && me.res.B >= 2))) {
      var rs = legalRoads(state, p);
      if (rs.length) return { t: 'road', e: bestBy(rs, function (e) { return roadValue(state, G, hm, p, e, rng); }) };
    }
    return null;
  }
  // Devuelve la jugada que haría el bot p ahora, o null si no le toca hacer nada.
  function botChoose(state, p, rng) {
    rng = rng || Math.random;
    var G = geo(state.board.kind), me = state.players[p], hm = harborMap(state), i;
    if (state.phase === 'setup') {
      var su = state.setup;
      if (su.order[su.i] !== p) return null;
      if (su.v === null) {
        var sp0 = legalSettlements(state, p, true);
        return { t: 'sett', v: bestBy(sp0, function (v) { return vertexScore(state, G, hm, v, rng); }) };
      }
      return { t: 'road', e: bestBy(setupRoads(state), function (e) { return roadValue(state, G, hm, p, e, rng); }) };
    }
    if (state.phase !== 'main') return null;
    var pd = state.pend, T = state.turn;
    if (pd) {
      if (pd.type === 'discard') {
        if (!pd.need[p]) return null;
        var left = {}, out = {}, k = pd.need[p];
        RES.forEach(function (r) { left[r] = me.res[r]; });
        while (k > 0) {
          var mx = bestBy(RES, function (r) { return left[r] + rng() * 0.5; });
          left[mx]--; out[mx] = (out[mx] || 0) + 1; k--;
        }
        return { t: 'discard', res: out };
      }
      if (pd.by !== p) return null;
      if (pd.type === 'robber') {
        var lead = bestBy(state.players.map(function (_, q) { return q; }).filter(function (q) { return q !== p; }),
          function (q) { return vpPublic(state, q) + rng(); });
        var h = bestBy(G.hexes.filter(function (x) { return x.id !== state.board.robber; }), function (x) {
          var s = rng() * 0.5, pips = PIPS[state.board.num[x.id]] || 0;
          x.v.forEach(function (v) {
            var b = state.bld[v];
            if (!b) return;
            if (b[0] === p) s -= 10 * b[1];
            else s += pips * b[1] * (b[0] === lead ? 1.5 : 1);
          });
          return s;
        });
        return { t: 'robber', h: h.id };
      }
      if (pd.type === 'steal') return { t: 'steal', from: bestBy(pd.from, function (q) { return vpPublic(state, q) + rng(); }) };
      if (pd.type === 'roads') {
        var lr = legalRoads(state, p);
        return { t: 'road', e: bestBy(lr, function (e) { return roadValue(state, G, hm, p, e, rng); }) };
      }
      return null;
    }
    if (state.special) {
      if (state.special.p !== p) return null;
      return botBuild(state, G, hm, p, rng, true) || { t: 'pass' };
    }
    if (T.p !== p) {
      for (i = 0; i < state.trades.length; i++) {
        var tr = state.trades[i];
        if (tr.from === T.p && tr.resp[p] === undefined) return { t: 'respond', id: tr.id, ok: botLikes(state, p, tr, rng) };
      }
      return null;
    }
    for (i = 0; i < state.trades.length; i++) {
      if (state.trades[i].from !== p) return { t: 'respond', id: state.trades[i].id, ok: botLikes(state, p, state.trades[i], rng) };
    }
    var hasK = false, playable = {};
    me.dev.forEach(function (c) { if (c.t < T.n && c.k !== 'V') playable[c.k] = true; });
    hasK = !!playable.K;
    if (!T.rolled) {
      if (!T.devUsed && hasK) {
        var onMe = G.hexes[state.board.robber].v.some(function (v) { return state.bld[v] && state.bld[v][0] === p; });
        if (onMe || rng() < 0.35) return { t: 'play', k: 'K' };
      }
      return { t: 'roll' };
    }
    if (!T.devUsed) {
      if (playable.R && me.left.road > 0 && legalRoads(state, p).length) return { t: 'play', k: 'R' };
      if (playable.P) {
        var goal = botGoal(state, p) || COST.dev, wants = [];
        RES.forEach(function (r) { for (var z = me.res[r]; z < (goal[r] || 0); z++) if (state.bank[r] > wants.filter(function (w) { return w === r; }).length) wants.push(r); });
        while (wants.length < 2) {
          var any = RES.filter(function (r) { return state.bank[r] > wants.filter(function (w) { return w === r; }).length; });
          if (!any.length) break;
          wants.push(any[Math.floor(rng() * any.length)]);
        }
        if (wants.length >= 2) return { t: 'play', k: 'P', res: [wants[0], wants[1]] };
      }
      if (playable.M) {
        var g2 = botGoal(state, p) || COST.dev;
        var want = bestBy(RES, function (r) { return ((g2[r] || 0) - me.res[r]) + rng() * 0.5; });
        return { t: 'play', k: 'M', res: want };
      }
      if (hasK && rng() < 0.6) return { t: 'play', k: 'K' };
    }
    return botBuild(state, G, hm, p, rng, false) || { t: 'end' };
  }
  function botLikes(state, p, tr, rng) {
    // tr.from da tr.give y pide tr.want. El bot acepta si le sobra lo que piden y no le dan menos cartas.
    var me = state.players[p];
    if (!hasRes(me.res, tr.want)) return false;
    if (total(tr.give) < total(tr.want)) return false;
    var goal = botGoal(state, p) || {};
    for (var k in tr.want) if (me.res[k] - tr.want[k] < (goal[k] || 0)) return false;
    return rng() < 0.8;
  }

  return {
    RES: RES, RES_NAME: RES_NAME, DEV_NAME: DEV_NAME, COST: COST, PIECES: PIECES, PIPS: PIPS, BOARD: BOARD, MAX_PLAYERS: MAX_PLAYERS,
    geo: geo, newGame: newGame, act: act, seeded: seeded, shuffle: shuffle,
    emptyRes: emptyRes, total: total, hasRes: hasRes, addRes: addRes, cleanRes: cleanRes, resText: resText,
    okSettlement: okSettlement, okRoad: okRoad, legalSettlements: legalSettlements, legalRoads: legalRoads,
    setupRoads: setupRoads, legalCities: legalCities, harborMap: harborMap, ratios: ratios, roadLength: roadLength,
    vpPublic: vpPublic, vpTotal: vpTotal, robberVictims: robberVictims, canBuildAnything: canBuildAnything, whoActs: whoActs,
    publicView: publicView, privateView: privateView, mergeView: mergeView, botChoose: botChoose
  };
});

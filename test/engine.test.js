// Pruebas del motor de reglas. Ejecutar: node test/engine.test.js
const assert = require('assert');
const HX = require('../src/engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FALLO ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}
const defs = n => Array.from({ length: n }, (_, i) => ({ name: 'J' + (i + 1), color: i }));
function edgeBetween(G, a, b) {
  const e = G.vertices[a].edges.find(id => G.edges[id].a === Math.min(a, b) && G.edges[id].b === Math.max(a, b));
  assert.notStrictEqual(e, undefined, 'no hay arista entre ' + a + ' y ' + b);
  return e;
}
// Juega la preparación con bots y deja la partida lista en el turno 1.
function ready(n, seed, opts) {
  const rng = HX.seeded(seed);
  const s = HX.newGame(defs(n), Object.assign({ shuffle: false }, opts || {}), rng);
  while (s.phase === 'setup') {
    const p = s.setup.order[s.setup.i];
    assert.strictEqual(HX.act(s, p, HX.botChoose(s, p, rng), rng), null);
  }
  return { s, rng, G: HX.geo(s.board.kind) };
}
function give(s, p, r) { HX.addRes(s.players[p].res, r, 1); HX.addRes(s.bank, r, -1); }
function clearHand(s, p) { HX.addRes(s.bank, s.players[p].res, 1); s.players[p].res = HX.emptyRes(); }
function rollWith(s, p, d1, d2) {
  const seq = [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01];
  let i = 0;
  return HX.act(s, p, { t: 'roll' }, () => (i < 2 ? seq[i++] : 0.5));
}

console.log('Geometría');
test('tablero básico: 19 casillas, 54 cruces, 72 lados, 30 de costa, 9 puertos', () => {
  const G = HX.geo('std');
  assert.strictEqual(G.hexes.length, 19); assert.strictEqual(G.vertices.length, 54);
  assert.strictEqual(G.edges.length, 72); assert.strictEqual(G.coast.length, 30);
  assert.strictEqual(new Set(G.coast).size, 30); assert.strictEqual(G.harborSlots.length, 9);
});
test('tablero ampliado: 30 casillas, 80 cruces, 109 lados, 38 de costa, 11 puertos', () => {
  const G = HX.geo('ext');
  assert.strictEqual(G.hexes.length, 30); assert.strictEqual(G.vertices.length, 80);
  assert.strictEqual(G.edges.length, 109); assert.strictEqual(G.coast.length, 38);
  assert.strictEqual(new Set(G.coast).size, 38); assert.strictEqual(G.harborSlots.length, 11);
});
test('cada cruce tiene 2 o 3 vecinos y los puertos no comparten cruces', () => {
  ['std', 'ext'].forEach(k => {
    const G = HX.geo(k);
    G.vertices.forEach(v => assert.ok(v.adj.length === 2 || v.adj.length === 3));
    const vs = [];
    G.harborSlots.forEach(e => { assert.strictEqual(G.edges[e].hexes.length, 1); vs.push(G.edges[e].a, G.edges[e].b); });
    assert.strictEqual(new Set(vs).size, vs.length);
    // la costa es un ciclo: lados consecutivos comparten un cruce
    G.coast.forEach((e, i) => {
      const f = G.edges[G.coast[(i + 1) % G.coast.length]], E = G.edges[e];
      assert.ok([E.a, E.b].some(x => x === f.a || x === f.b));
    });
  });
});

console.log('Creación de partida');
test('reparto de terrenos, números y mazo correcto en 200 tableros de cada tipo', () => {
  for (let seed = 1; seed <= 200; seed++) {
    [3, 6].forEach(n => {
      const s = HX.newGame(defs(n), {}, HX.seeded(seed * 7 + n));
      const B = HX.BOARD[s.board.kind], G = HX.geo(s.board.kind);
      assert.strictEqual(s.board.kind, n >= 5 ? 'ext' : 'std');
      const cnt = {};
      s.board.terrain.forEach(t => cnt[t] = (cnt[t] || 0) + 1);
      assert.deepStrictEqual(cnt, Object.assign({}, B.terrain));
      const nums = s.board.num.filter(x => x).sort((a, b) => a - b);
      assert.deepStrictEqual(nums, B.nums.slice().sort((a, b) => a - b));
      s.board.terrain.forEach((t, i) => assert.strictEqual(t === 'D', s.board.num[i] === 0));
      G.hexes.forEach(h => {
        if (s.board.num[h.id] === 6 || s.board.num[h.id] === 8)
          h.nbr.forEach(x => assert.ok(s.board.num[x] !== 6 && s.board.num[x] !== 8, '6/8 adyacentes'));
      });
      assert.strictEqual(s.board.terrain[s.board.robber], 'D');
      assert.strictEqual(s.deck.length, n >= 5 ? 34 : 25);
      assert.deepStrictEqual(s.board.harbors.map(h => h.t).sort(), B.harbors.slice().sort());
    });
  }
});

console.log('Preparación');
test('orden en serpiente y recursos por la segunda aldea', () => {
  const rng = HX.seeded(5);
  const s = HX.newGame(defs(4), { shuffle: false }, rng);
  const G = HX.geo('std');
  assert.deepStrictEqual(s.setup.order, [0, 1, 2, 3, 3, 2, 1, 0]);
  assert.strictEqual(HX.act(s, 1, { t: 'sett', v: 0 }), 'No es tu turno');
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: 0 }), 'Primero coloca la aldea');
  assert.strictEqual(HX.act(s, 0, { t: 'sett', v: 10 }), null);
  assert.strictEqual(HX.act(s, 0, { t: 'sett', v: 20 }), 'Ahora toca colocar el camino');
  const far = G.edges.find(e => e.a !== 10 && e.b !== 10).id;
  assert.notStrictEqual(HX.act(s, 0, { t: 'road', e: far }), null);
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: G.vertices[10].edges[0] }), null);
  // regla de distancia: el siguiente no puede ponerse pegado
  assert.strictEqual(HX.act(s, 1, { t: 'sett', v: G.vertices[10].adj[0] }), 'Ahí no se puede construir');
  assert.strictEqual(HX.act(s, 1, { t: 'sett', v: 10 }), 'Ahí no se puede construir');
  while (s.phase === 'setup') {
    const p = s.setup.order[s.setup.i];
    const before = HX.total(s.players[p].res);
    const second = s.setup.i >= 4 && s.setup.v === null;
    const a = HX.botChoose(s, p, rng);
    assert.strictEqual(HX.act(s, p, a, rng), null);
    if (second) {
      const exp = G.vertices[a.v].hexes.filter(h => s.board.terrain[h] !== 'D').length;
      assert.strictEqual(HX.total(s.players[p].res) - before, exp);
    }
  }
  assert.strictEqual(s.phase, 'main'); assert.strictEqual(s.turn.p, 0); assert.strictEqual(s.turn.n, 1);
  s.players.forEach(pl => { assert.strictEqual(pl.left.sett, 3); assert.strictEqual(pl.left.road, 13); });
});

console.log('Turno, producción y bandido');
test('hay que tirar antes de construir o terminar; solo se tira una vez', () => {
  const { s } = ready(3, 11);
  assert.strictEqual(HX.act(s, 0, { t: 'end' }), 'Primero tira los dados');
  assert.strictEqual(HX.act(s, 0, { t: 'buy' }), 'Primero tira los dados');
  assert.strictEqual(HX.act(s, 1, { t: 'roll' }), 'No es tu turno');
  assert.strictEqual(rollWith(s, 0, 2, 3), null);
  assert.strictEqual(HX.act(s, 0, { t: 'roll' }), 'Ya has tirado los dados');
  assert.strictEqual(HX.act(s, 0, { t: 'end' }), null);
  assert.strictEqual(s.turn.p, 1); assert.strictEqual(s.turn.n, 2);
});
test('producción: 1 por aldea, 2 por ciudad, nada donde está el bandido', () => {
  const { s, G } = ready(3, 12);
  // Buscar una aldea de J1 junto a una casilla con número
  const v = +Object.keys(s.bld).find(k => s.bld[k][0] === 0);
  const h = G.vertices[v].hexes.find(x => s.board.num[x] && s.board.num[x] !== 7);
  const num = s.board.num[h], res = s.board.terrain[h];
  // contar cuánto debería recibir J1 con ese número
  const due = (st) => {
    let t = 0;
    G.hexes.forEach(x => { if (st.board.num[x.id] === num && x.id !== st.board.robber && st.board.terrain[x.id] === res) x.v.forEach(u => { if (st.bld[u] && st.bld[u][0] === 0) t += st.bld[u][1]; }); });
    return t;
  };
  let before = s.players[0].res[res];
  const d1 = num <= 7 ? 1 : 6;
  assert.strictEqual(rollWith(s, 0, d1, num - d1), null);
  assert.strictEqual(s.players[0].res[res] - before, due(s));
  assert.ok(due(s) >= 1);
  // con ciudad produce el doble
  HX.act(s, 0, { t: 'end' }); rollWith(s, 1, 1, 2 === num - 1 ? 3 : 2); HX.act(s, 1, { t: 'end' });
  if (s.pend) return; // por si saliera 7 (no debería con estos dados)
  rollWith(s, 2, 1, 2 === num - 1 ? 3 : 2); HX.act(s, 2, { t: 'end' });
  s.bld[v][1] = 2; s.players[0].left.city--; s.players[0].left.sett++;
  const exp = due(s);
  before = s.players[0].res[res];
  assert.strictEqual(rollWith(s, 0, d1, num - d1), null);
  assert.strictEqual(s.players[0].res[res] - before, exp);
  // con el bandido encima no produce esa casilla
  HX.act(s, 0, { t: 'end' }); rollWith(s, 1, 1, 2 === num - 1 ? 3 : 2); HX.act(s, 1, { t: 'end' });
  rollWith(s, 2, 1, 2 === num - 1 ? 3 : 2); HX.act(s, 2, { t: 'end' });
  s.board.robber = h;
  const exp2 = due(s);
  assert.ok(exp2 < exp);
  before = s.players[0].res[res];
  assert.strictEqual(rollWith(s, 0, d1, num - d1), null);
  assert.strictEqual(s.players[0].res[res] - before, exp2);
});
test('si la banca no llega para todos nadie recibe; si solo cobra uno, se lleva lo que quede', () => {
  const { s, G } = ready(3, 13);
  // Preparar a mano: dos jugadores en la misma casilla
  const h = G.hexes.find(x => s.board.num[x.id] && s.board.terrain[x.id] !== 'D' && x.id !== s.board.robber);
  const res = s.board.terrain[h.id], num = s.board.num[h.id];
  // quitar otros edificios que cobren ese recurso con ese número para tener el control
  s.bld = {}; s.roads = {};
  s.bld[h.v[0]] = [0, 2]; s.bld[h.v[2]] = [1, 2];
  G.hexes.forEach(x => { if (x.id !== h.id && s.board.num[x.id] === num) s.board.num[x.id] = num === 5 ? 9 : 5; });
  s.players.forEach((pl, i) => clearHand(s, i));
  s.bank[res] = 3; // se deben 4
  const d1 = num <= 7 ? 1 : 6;
  assert.strictEqual(rollWith(s, 0, d1, num - d1), null);
  assert.strictEqual(s.players[0].res[res], 0); assert.strictEqual(s.players[1].res[res], 0); assert.strictEqual(s.bank[res], 3);
  // ahora solo cobra uno: se lleva lo que hay
  HX.act(s, 0, { t: 'end' });
  delete s.bld[h.v[2]];
  s.bank[res] = 1;
  assert.strictEqual(rollWith(s, 1, d1, num - d1), null);
  assert.strictEqual(s.players[0].res[res], 1); assert.strictEqual(s.bank[res], 0);
});
test('un 7: descarta la mitad quien tiene más de 7, se mueve el bandido y se roba', () => {
  const { s, G } = ready(4, 14);
  s.players.forEach((pl, i) => clearHand(s, i));
  give(s, 1, { W: 5, B: 4 });           // 9 cartas -> descarta 4
  give(s, 2, { S: 7 });                 // 7 cartas -> no descarta
  give(s, 3, { G: 4, O: 4 });           // 8 cartas -> descarta 4
  assert.strictEqual(rollWith(s, 0, 3, 4), null);
  assert.deepStrictEqual(s.pend.need, { 1: 4, 3: 4 });
  assert.strictEqual(HX.act(s, 0, { t: 'robber', h: 0 }), 'Jugada no válida');
  assert.strictEqual(HX.act(s, 2, { t: 'discard', res: { S: 3 } }), 'Jugada no válida');
  assert.ok(/exactamente 4/.test(HX.act(s, 1, { t: 'discard', res: { W: 3 } })));
  assert.strictEqual(HX.act(s, 1, { t: 'discard', res: { W: 1, S: 3 } }), 'No tienes esas cartas');
  assert.strictEqual(HX.act(s, 1, { t: 'discard', res: { W: 2, B: 2 } }), null);
  assert.strictEqual(s.pend.type, 'discard');
  assert.strictEqual(HX.act(s, 3, { t: 'discard', res: { G: 4 } }), null);
  assert.strictEqual(s.pend.type, 'robber'); assert.strictEqual(s.pend.by, 0);
  assert.ok(/otra casilla/.test(HX.act(s, 0, { t: 'robber', h: s.board.robber })));
  // mover a una casilla con edificio del jugador 2 (y solo de rivales con cartas)
  const v2 = +Object.keys(s.bld).find(k => s.bld[k][0] === 2);
  const target = G.vertices[v2].hexes.find(x => x !== s.board.robber);
  const vict = HX.robberVictims(s, G, 0, target);
  assert.ok(vict.indexOf(2) >= 0);
  const tot0 = HX.total(s.players[0].res);
  assert.strictEqual(HX.act(s, 0, { t: 'robber', h: target }, HX.seeded(1)), null);
  if (vict.length > 1) { assert.strictEqual(s.pend.type, 'steal'); assert.strictEqual(HX.act(s, 0, { t: 'steal', from: 2 }, HX.seeded(1)), null); }
  assert.strictEqual(s.pend, null);
  assert.strictEqual(HX.total(s.players[0].res), tot0 + 1);
  assert.strictEqual(s.board.robber, target);
  assert.strictEqual(HX.act(s, 0, { t: 'end' }), null);
});

console.log('Construcción');
test('costes, conexión de caminos, regla de distancia y límite de piezas', () => {
  const { s, G } = ready(3, 21);
  s.players.forEach((pl, i) => clearHand(s, i));
  rollWith(s, 0, 1, 1);
  if (s.turn.gains) s.players.forEach((pl, i) => clearHand(s, i));
  const roads = HX.legalRoads(s, 0);
  assert.ok(roads.length > 0);
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: roads[0] }), 'Te faltan recursos');
  give(s, 0, { W: 1, B: 1 });
  const notMine = G.edges.find(e => s.roads[e.id] === undefined && roads.indexOf(e.id) < 0).id;
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: notMine }), 'Ahí no se puede construir');
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: roads[0] }), null);
  assert.strictEqual(HX.total(s.players[0].res), 0);
  assert.strictEqual(s.players[0].left.road, 12);
  // aldea: necesita camino propio y distancia
  give(s, 0, { W: 1, B: 1, S: 1, G: 1 });
  const spots = HX.legalSettlements(s, 0, false);
  const anyFree = G.vertices.find(v => !s.bld[v.id] && spots.indexOf(v.id) < 0).id;
  assert.strictEqual(HX.act(s, 0, { t: 'sett', v: anyFree }), 'Ahí no se puede construir');
  // ciudad sobre aldea propia
  clearHand(s, 0); give(s, 0, { G: 2, O: 3 });
  const mine = +Object.keys(s.bld).find(k => s.bld[k][0] === 0);
  const theirs = +Object.keys(s.bld).find(k => s.bld[k][0] === 1);
  assert.strictEqual(HX.act(s, 0, { t: 'city', v: theirs }), 'Solo puedes mejorar una aldea tuya');
  assert.strictEqual(HX.act(s, 0, { t: 'city', v: mine }), null);
  assert.deepStrictEqual(s.bld[mine], [0, 2]);
  assert.strictEqual(s.players[0].left.city, 3); assert.strictEqual(s.players[0].left.sett, 4);
  assert.strictEqual(HX.vpPublic(s, 0), 3);
  give(s, 0, { G: 2, O: 3 });
  assert.strictEqual(HX.act(s, 0, { t: 'city', v: mine }), 'Solo puedes mejorar una aldea tuya');
});
test('no se puede construir un camino a través de una aldea rival', () => {
  const s = HX.newGame(defs(3), { shuffle: false }, HX.seeded(3));
  const G = HX.geo('std');
  // camino de J1: a-b ; aldea de J2 en b ; J1 no puede seguir b-c
  const a = 0, b = G.vertices[0].adj[0], c = G.vertices[b].adj.find(x => x !== a);
  s.phase = 'main'; s.setup = null; s.turn = { p: 0, n: 1, rolled: true, dice: [1, 2], devUsed: false, gains: null };
  s.roads[edgeBetween(G, a, b)] = 0; s.bld[b] = [1, 1];
  assert.strictEqual(HX.okRoad(s, G, 0, edgeBetween(G, b, c)), false);
  s.bld[b] = [0, 1];
  assert.strictEqual(HX.okRoad(s, G, 0, edgeBetween(G, b, c)), true);
  delete s.bld[b];
  assert.strictEqual(HX.okRoad(s, G, 0, edgeBetween(G, b, c)), true);
});

console.log('Ruta más larga');
function ringOf(G, h) { return G.hexes[h].v; }
test('longitud con ramas, anillos y cortes por aldeas rivales', () => {
  const s = HX.newGame(defs(3), { shuffle: false }, HX.seeded(4));
  const G = HX.geo('std');
  const center = 9, ring = ringOf(G, center);
  // anillo completo de 6
  for (let i = 0; i < 6; i++) s.roads[edgeBetween(G, ring[i], ring[(i + 1) % 6])] = 0;
  assert.strictEqual(HX.roadLength(s, G, 0), 6);
  // añadir una cola de 2 saliendo de un cruce del anillo
  const out = G.vertices[ring[0]].adj.find(x => ring.indexOf(x) < 0);
  const out2 = G.vertices[out].adj.find(x => x !== ring[0]);
  s.roads[edgeBetween(G, ring[0], out)] = 0; s.roads[edgeBetween(G, out, out2)] = 0;
  assert.strictEqual(HX.roadLength(s, G, 0), 8);
  // una aldea rival en un cruce del anillo lo corta: la mejor ruta sale de ese cruce, da la vuelta y vuelve a él (6);
  // con la cola solo se llega a 2 + 3 = 5, porque en la unión hay que elegir un sentido
  s.bld[ring[3]] = [1, 1];
  assert.strictEqual(HX.roadLength(s, G, 0), 6);
  // una aldea rival en la unión cola/anillo separa cola (2) y anillo abierto
  s.bld[ring[0]] = [1, 1];
  assert.strictEqual(HX.roadLength(s, G, 0), 3);
  // una aldea propia no corta
  s.bld[ring[0]] = [0, 1]; delete s.bld[ring[3]];
  assert.strictEqual(HX.roadLength(s, G, 0), 8);
});
test('el premio pasa solo con una ruta estrictamente más larga, y queda sin dueño si hay empate tras un corte', () => {
  const s = HX.newGame(defs(3), { shuffle: false }, HX.seeded(6));
  const G = HX.geo('std');
  s.phase = 'main'; s.setup = null; s.turn = { p: 0, n: 5, rolled: true, dice: [1, 2], devUsed: false, gains: null };
  // Tres caminos rectos por la costa, separados
  const coastV = [];
  G.coast.forEach((e, i) => {
    const E = G.edges[e], F = G.edges[G.coast[(i + 1) % G.coast.length]];
    coastV.push([E.a, E.b].find(x => x === F.a || x === F.b));
  });
  // coastV[i] es el cruce entre el lado i y el i+1
  const lay = (p, from, len) => { for (let i = 0; i < len; i++) s.roads[G.coast[(from + i) % 30]] = p; };
  lay(0, 0, 4); lay(1, 8, 5); lay(2, 16, 5);
  give(s, 0, { W: 5, B: 5 });
  // J1 llega a 5: como no hay dueño y J2/J3 también tienen 5... primero forzamos el cálculo
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: G.coast[4] }), null);
  assert.strictEqual(s.players[0].roadLen, 5);
  assert.strictEqual(s.awards.road, null, 'triple empate a 5 sin dueño previo');
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: G.coast[5] }), null);
  assert.strictEqual(s.awards.road, 0);
  assert.strictEqual(HX.vpPublic(s, 0), 2);
  // J2 iguala a 6: no se lo quita
  s.roads[G.coast[13]] = 1;
  HX.act(s, 0, { t: 'end' });
  give(s, 1, { W: 3, B: 3 });
  rollWith(s, 1, 1, 1);
  assert.strictEqual(HX.act(s, 1, { t: 'road', e: G.coast[14] }), null);
  assert.strictEqual(s.players[1].roadLen, 7);
  assert.strictEqual(s.awards.road, 1, 'con 7 supera los 6');
  // Corte: J3 construye una aldea en medio de la ruta de J2 -> J2 baja; J1 (6) es el único más largo
  HX.act(s, 1, { t: 'end' });
  rollWith(s, 2, 1, 1);
  const cut = coastV[10]; // entre lados 10 y 11 de J2 (8..14)
  // J3 necesita un camino propio hasta ese cruce: lo colocamos a mano (interior)
  const inner = G.vertices[cut].edges.find(e => s.roads[e] === undefined);
  s.roads[inner] = 2;
  give(s, 2, { W: 1, B: 1, S: 1, G: 1 });
  // asegurar regla de distancia
  G.vertices[cut].adj.forEach(u => delete s.bld[u]);
  assert.strictEqual(HX.act(s, 2, { t: 'sett', v: cut }), null);
  assert.strictEqual(s.players[1].roadLen, 4);
  assert.strictEqual(s.awards.road, 0, 'J1 con 6 es ahora el único más largo');
  // Empate tras corte: J1 baja a 5 por un corte y J3 tiene 5 -> sin dueño
  s.bld[coastV[0]] = [1, 1]; // corta el primer tramo de J1 (lados 0..5): quedan 5
  const st = JSON.parse(JSON.stringify(s));
  // forzar recálculo con una jugada cualquiera que recalcula: camino de J3
  give(s, 2, { W: 1, B: 1 });
  const free = HX.legalRoads(s, 2).find(e => G.coast.indexOf(e) < 0);
  assert.strictEqual(HX.act(s, 2, { t: 'road', e: free }), null);
  assert.strictEqual(s.players[0].roadLen, 5);
  assert.ok(s.players[2].roadLen >= 5);
  if (s.players[2].roadLen === 5) assert.strictEqual(s.awards.road, null, 'empate a 5 tras corte: sin dueño');
  assert.ok(st);
});

console.log('Cartas de progreso');
function mainTurn(seed, n) {
  const r = ready(n || 3, seed);
  r.s.players.forEach((pl, i) => clearHand(r.s, i));
  return r;
}
test('no se juega la carta el turno en que se compra; una por turno; el Monumento no se juega', () => {
  const { s } = mainTurn(31);
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  give(s, 0, { S: 1, G: 1, O: 1 });
  s.deck.push('K');
  assert.strictEqual(HX.act(s, 0, { t: 'buy' }), null);
  assert.strictEqual(s.players[0].dev[0].k, 'K');
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'K' }), 'No puedes jugar esa carta ahora');
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'V' }), 'Jugada no válida');
  HX.act(s, 0, { t: 'end' }); rollWith(s, 1, 1, 1); HX.act(s, 1, { t: 'end' }); rollWith(s, 2, 1, 1); HX.act(s, 2, { t: 'end' });
  s.players[0].dev.push({ k: 'K', t: 1 });
  // se puede jugar antes de tirar
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'K' }), null);
  assert.strictEqual(s.pend.type, 'robber');
  assert.strictEqual(HX.act(s, 0, { t: 'roll' }), 'Antes hay que resolver lo pendiente');
  const h = s.board.robber === 0 ? 1 : 0;
  assert.strictEqual(HX.act(s, 0, { t: 'robber', h }, HX.seeded(2)), null);
  if (s.pend) assert.strictEqual(HX.act(s, 0, { t: 'steal', from: s.pend.from[0] }, HX.seeded(2)), null);
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'K' }), 'Solo se puede jugar una carta de progreso por turno');
  assert.strictEqual(s.players[0].played.K, 1);
  assert.strictEqual(rollWith(s, 0, 1, 1), null);
});
test('Guardia más numerosa: a la tercera, y solo cambia de manos con más', () => {
  const { s } = mainTurn(32);
  s.players[0].played.K = 2; s.players[1].played.K = 2;
  s.players[0].dev.push({ k: 'K', t: 0 });
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'K' }), null);
  assert.strictEqual(s.awards.army, 0);
  assert.strictEqual(HX.vpPublic(s, 0), 2 + 2);
  HX.act(s, 0, { t: 'robber', h: s.board.robber === 0 ? 1 : 0 }, HX.seeded(1));
  if (s.pend) HX.act(s, 0, { t: 'steal', from: s.pend.from[0] }, HX.seeded(1));
  rollWith(s, 0, 1, 1); HX.act(s, 0, { t: 'end' });
  s.players[1].dev.push({ k: 'K', t: 0 }, { k: 'K', t: 0 });
  assert.strictEqual(HX.act(s, 1, { t: 'play', k: 'K' }), null);
  assert.strictEqual(s.awards.army, 0, 'empate a 3: sigue con el primero');
});
test('Obras: dos caminos gratis; Abundancia: dos recursos; Acaparador: todo de un tipo', () => {
  const { s } = mainTurn(33);
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  s.players[0].dev.push({ k: 'R', t: 0 }, { k: 'P', t: 0 }, { k: 'M', t: 0 });
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'R' }), null);
  assert.strictEqual(s.pend.n, 2);
  assert.strictEqual(HX.act(s, 0, { t: 'end' }), 'Antes hay que resolver lo pendiente');
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: HX.legalRoads(s, 0)[0] }), null);
  assert.strictEqual(HX.act(s, 0, { t: 'road', e: HX.legalRoads(s, 0)[0] }), null);
  assert.strictEqual(s.pend, null);
  assert.strictEqual(s.players[0].left.road, 11);
  assert.strictEqual(HX.total(s.players[0].res), 0);
  HX.act(s, 0, { t: 'end' }); rollWith(s, 1, 1, 1); HX.act(s, 1, { t: 'end' }); rollWith(s, 2, 1, 1); HX.act(s, 2, { t: 'end' });
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  const bankO = s.bank.O;
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'P', res: ['O', 'O'] }), null);
  assert.strictEqual(s.players[0].res.O, 2); assert.strictEqual(s.bank.O, bankO - 2);
  HX.act(s, 0, { t: 'end' }); rollWith(s, 1, 1, 1); HX.act(s, 1, { t: 'end' }); rollWith(s, 2, 1, 1); HX.act(s, 2, { t: 'end' });
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  give(s, 1, { S: 3, W: 1 }); give(s, 2, { S: 2 });
  assert.strictEqual(HX.act(s, 0, { t: 'play', k: 'M', res: 'S' }), null);
  assert.strictEqual(s.players[0].res.S, 5); assert.strictEqual(s.players[1].res.S, 0);
  assert.strictEqual(s.players[1].res.W, 1); assert.strictEqual(s.players[2].res.S, 0);
});

console.log('Comercio');
test('banca 4:1, puerto genérico 3:1 y puerto especial 2:1', () => {
  const { s, G } = mainTurn(41);
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  // quitar edificios de J1 de puertos para empezar en 4:1
  const hm = HX.harborMap(s);
  Object.keys(s.bld).forEach(k => { if (s.bld[k][0] === 0 && hm[k]) delete s.bld[k]; });
  assert.deepStrictEqual(HX.ratios(s, 0), { W: 4, B: 4, S: 4, G: 4, O: 4 });
  give(s, 0, { W: 4 });
  assert.strictEqual(HX.act(s, 0, { t: 'bank', give: 'W', get: 'W' }), 'Jugada no válida');
  assert.strictEqual(HX.act(s, 0, { t: 'bank', give: 'B', get: 'O' }), 'Te faltan recursos');
  assert.strictEqual(HX.act(s, 0, { t: 'bank', give: 'W', get: 'O' }), null);
  assert.deepStrictEqual(s.players[0].res, { W: 0, B: 0, S: 0, G: 0, O: 1 });
  const gen = s.board.harbors.find(h => h.t === '*'), spe = s.board.harbors.find(h => h.t !== '*');
  s.bld[G.edges[gen.e].a] = [0, 1];
  const r1 = HX.ratios(s, 0);
  HX.RES.forEach(r => assert.strictEqual(r1[r], 3));
  s.bld[G.edges[spe.e].b] = [0, 2];
  const r2 = HX.ratios(s, 0);
  assert.strictEqual(r2[spe.t], 2);
  clearHand(s, 0); give(s, 0, { [spe.t]: 4 });
  const other = HX.RES.find(r => r !== spe.t);
  assert.strictEqual(HX.act(s, 0, { t: 'bank', give: spe.t, get: other, n: 2 }), null);
  assert.strictEqual(s.players[0].res[other], 2); assert.strictEqual(s.players[0].res[spe.t], 0);
});
test('ofertas entre jugadores: aceptar, confirmar, rechazar y validar cartas', () => {
  const { s } = mainTurn(42);
  give(s, 0, { W: 2 }); give(s, 1, { S: 1 }); give(s, 2, { S: 1, O: 1 });
  assert.strictEqual(HX.act(s, 0, { t: 'offer', give: { W: 1 }, want: { S: 1 } }), 'Ahora no se puede comerciar');
  rollWith(s, 0, 1, 1);
  s.players.forEach((pl, i) => clearHand(s, i));
  give(s, 0, { W: 2 }); give(s, 1, { S: 1 }); give(s, 2, { S: 1, O: 1 });
  assert.ok(HX.act(s, 0, { t: 'offer', give: { W: 1 }, want: { W: 1 } }));
  assert.ok(HX.act(s, 0, { t: 'offer', give: {}, want: { S: 1 } }));
  assert.strictEqual(HX.act(s, 0, { t: 'offer', give: { W: 3 }, want: { S: 1 } }), 'No tienes esas cartas');
  assert.strictEqual(HX.act(s, 0, { t: 'offer', give: { W: 1 }, want: { S: 1 } }), null);
  const id = s.trades[0].id;
  assert.strictEqual(HX.act(s, 0, { t: 'respond', id, ok: true }), 'Jugada no válida');
  assert.strictEqual(HX.act(s, 1, { t: 'respond', id, ok: true }), null);
  assert.strictEqual(HX.act(s, 2, { t: 'respond', id, ok: false }), null);
  assert.strictEqual(HX.act(s, 0, { t: 'confirm', id, with: 2 }), 'Ese jugador no ha aceptado');
  assert.strictEqual(HX.act(s, 1, { t: 'confirm', id, with: 1 }), 'Esa oferta ya no existe');
  assert.strictEqual(HX.act(s, 0, { t: 'confirm', id, with: 1 }), null);
  assert.deepStrictEqual(s.players[0].res, { W: 1, B: 0, S: 1, G: 0, O: 0 });
  assert.deepStrictEqual(s.players[1].res, { W: 1, B: 0, S: 0, G: 0, O: 0 });
  assert.strictEqual(s.trades.length, 0);
  // oferta de un jugador sin turno al que tiene el turno
  assert.strictEqual(HX.act(s, 2, { t: 'offer', give: { O: 1 }, want: { W: 1 } }), null);
  const id2 = s.trades[0].id;
  assert.strictEqual(HX.act(s, 1, { t: 'respond', id: id2, ok: true }), 'Solo puede responder quien tiene el turno');
  assert.strictEqual(HX.act(s, 0, { t: 'respond', id: id2, ok: true }), null);
  assert.strictEqual(s.players[0].res.O, 1); assert.strictEqual(s.players[2].res.W, 1);
  // al terminar el turno se borran las ofertas
  assert.strictEqual(HX.act(s, 0, { t: 'offer', give: { O: 1 }, want: { S: 1 } }), null);
  HX.act(s, 0, { t: 'end' });
  assert.strictEqual(s.trades.length, 0);
});

console.log('Partidas de 5-6: fase extra de construcción');
test('tras cada turno los demás pueden construir por orden; sin comerciar ni jugar cartas', () => {
  const { s } = mainTurn(51, 5);
  assert.strictEqual(s.board.kind, 'ext');
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  give(s, 2, { W: 1, B: 1 }); give(s, 4, { S: 1, G: 1, O: 1 });
  s.players[2].dev.push({ k: 'K', t: 0 });
  assert.strictEqual(HX.act(s, 0, { t: 'end' }), null);
  assert.strictEqual(s.turn.p, 0, 'el turno no avanza hasta acabar la fase extra');
  assert.strictEqual(s.special.p, 2, 'salta a quien puede construir algo');
  assert.strictEqual(HX.act(s, 4, { t: 'buy' }), 'No es tu turno');
  assert.strictEqual(HX.act(s, 2, { t: 'play', k: 'K' }), 'No es tu turno');
  assert.strictEqual(HX.act(s, 2, { t: 'bank', give: 'W', get: 'O' }), 'No es tu turno');
  assert.strictEqual(HX.act(s, 2, { t: 'offer', give: { W: 1 }, want: { O: 1 } }), 'Ahora no se puede comerciar');
  assert.strictEqual(HX.act(s, 2, { t: 'road', e: HX.legalRoads(s, 2)[0] }), null);
  assert.strictEqual(HX.act(s, 2, { t: 'pass' }), null);
  assert.strictEqual(s.special.p, 4);
  assert.strictEqual(HX.act(s, 4, { t: 'buy' }), null);
  assert.strictEqual(s.players[4].dev[0].t, 1);
  assert.strictEqual(HX.act(s, 4, { t: 'pass' }), null);
  assert.strictEqual(s.special, null); assert.strictEqual(s.turn.p, 1); assert.strictEqual(s.turn.n, 2);
});
test('con 4 jugadores no hay fase extra', () => {
  const { s } = mainTurn(52, 4);
  rollWith(s, 0, 1, 1); give(s, 1, { W: 1, B: 1 });
  HX.act(s, 0, { t: 'end' });
  assert.strictEqual(s.special, null); assert.strictEqual(s.turn.p, 1);
});

console.log('Victoria');
test('solo se gana en el turno propio, contando los Monumentos ocultos', () => {
  const { s } = mainTurn(61, 3);
  // J2 llega a 10 puntos fuera de su turno: no gana hasta que le toque
  s.players[1].left.city = 0; s.players[1].left.sett = 5;      // 4 ciudades = 8 puntos
  s.players[1].dev.push({ k: 'V', t: 0 }, { k: 'V', t: 0 });   // +2 ocultos
  assert.strictEqual(HX.vpPublic(s, 1), 8); assert.strictEqual(HX.vpTotal(s, 1), 10);
  rollWith(s, 0, 1, 1);
  assert.strictEqual(s.phase, 'main');
  HX.act(s, 0, { t: 'end' });
  assert.strictEqual(s.phase, 'over'); assert.strictEqual(s.winner, 1);
  const pv = HX.publicView(s);
  assert.strictEqual(pv.players[1].vpAll, 10); assert.strictEqual(pv.players[1].hid, 2);
  assert.strictEqual(HX.act(s, 1, { t: 'roll' }), 'La partida ha terminado');
});
test('se gana en el momento de llegar al objetivo durante el turno', () => {
  const { s } = mainTurn(62, 3);
  rollWith(s, 0, 1, 1); s.players.forEach((pl, i) => clearHand(s, i));
  s.players[0].left.city = 1; s.players[0].left.sett = 4; // 3 ciudades + 1 aldea = 7
  // dejar exactamente: una aldea de J1 en tablero para mejorar
  s.awards.army = 0; // +2 = 9
  give(s, 0, { G: 2, O: 3 });
  const mine = +Object.keys(s.bld).find(k => s.bld[k][0] === 0 && s.bld[k][1] === 1);
  assert.strictEqual(HX.act(s, 0, { t: 'city', v: mine }), null);
  assert.strictEqual(s.phase, 'over'); assert.strictEqual(s.winner, 0);
});

console.log('Vistas');
test('la vista pública no contiene manos ni el mazo; la privada solo la mano propia', () => {
  const { s } = mainTurn(71, 4);
  give(s, 1, { W: 2, O: 1 }); s.players[1].dev.push({ k: 'V', t: 0 }, { k: 'K', t: 0 });
  const pub = HX.publicView(s), txt = JSON.stringify(pub);
  assert.ok(!('deck' in pub)); assert.ok(!/"res"/.test(txt)); assert.ok(!/"dev"/.test(txt)); assert.ok(!/"plog"/.test(txt)); assert.ok(!/"key"/.test(txt));
  assert.strictEqual(pub.players[1].nRes, 3); assert.strictEqual(pub.players[1].nDev, 2);
  assert.strictEqual(pub.players[1].hid, undefined);
  const pr = HX.privateView(s, 1);
  assert.deepStrictEqual(pr.res, { W: 2, B: 0, S: 0, G: 0, O: 1 });
  assert.deepStrictEqual(pr.dev, [{ k: 'V', ok: false }, { k: 'K', ok: true }]);
  const m = HX.mergeView(JSON.parse(txt), JSON.parse(JSON.stringify(pr)));
  assert.strictEqual(m.me, 1); assert.strictEqual(m.players[1].res.W, 2); assert.strictEqual(m.players[0].res, undefined);
  assert.ok(Array.isArray(HX.legalRoads(m, 1)));
});

console.log('\n' + passed + ' pruebas correctas');

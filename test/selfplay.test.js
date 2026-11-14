// Simula partidas completas entre bots comprobando invariantes en cada jugada.
// Uso: node test/selfplay.test.js [partidasPorTamaño]
const assert = require('assert');
const HX = require('../src/engine.js');
const N = +process.argv[2] || 150;

function check(s, tag) {
  const B = HX.BOARD[s.board.kind], G = HX.geo(s.board.kind);
  // 1. las cartas de recurso ni se crean ni se destruyen
  HX.RES.forEach(r => {
    let t = s.bank[r];
    s.players.forEach(pl => { assert.ok(pl.res[r] >= 0, tag + ' mano negativa'); t += pl.res[r]; });
    assert.ok(s.bank[r] >= 0, tag + ' banca negativa');
    assert.strictEqual(t, B.bank, tag + ' total de ' + r);
  });
  // 2. cartas de progreso
  let dev = s.deck.length;
  s.players.forEach(pl => { dev += pl.dev.length + pl.played.K + pl.played.R + pl.played.P + pl.played.M; });
  assert.strictEqual(dev, s.board.kind === 'ext' ? 34 : 25, tag + ' cartas de progreso');
  // 3. piezas y tablero coherentes
  const cnt = s.players.map(() => ({ road: 0, sett: 0, city: 0 }));
  for (const k in s.roads) cnt[s.roads[k]].road++;
  for (const k in s.bld) {
    const b = s.bld[k];
    cnt[b[0]][b[1] === 1 ? 'sett' : 'city']++;
    G.vertices[k].adj.forEach(u => assert.ok(!s.bld[u], tag + ' regla de distancia rota'));
  }
  s.players.forEach((pl, i) => {
    assert.strictEqual(pl.left.road, 15 - cnt[i].road, tag + ' caminos');
    assert.strictEqual(pl.left.sett, 5 - cnt[i].sett, tag + ' aldeas');
    assert.strictEqual(pl.left.city, 4 - cnt[i].city, tag + ' ciudades');
    assert.ok(pl.left.road >= 0 && pl.left.sett >= 0 && pl.left.city >= 0, tag + ' piezas negativas');
    assert.strictEqual(pl.roadLen, HX.roadLength(s, G, i), tag + ' longitud de ruta');
  });
  // 4. premios
  if (s.awards.road !== null) {
    const L = s.players[s.awards.road].roadLen;
    assert.ok(L >= 5, tag + ' ruta más larga con menos de 5');
    s.players.forEach(pl => assert.ok(pl.roadLen <= L, tag + ' alguien tiene ruta más larga que el dueño'));
  } else {
    const mx = Math.max(...s.players.map(pl => pl.roadLen));
    if (mx >= 5) assert.ok(s.players.filter(pl => pl.roadLen === mx).length > 1, tag + ' ruta única >=5 sin premio');
  }
  if (s.awards.army !== null) {
    const K = s.players[s.awards.army].played.K;
    assert.ok(K >= 3, tag + ' guardia con menos de 3');
    s.players.forEach(pl => assert.ok(pl.played.K <= K, tag + ' alguien con más guardias'));
  } else s.players.forEach(pl => assert.ok(pl.played.K < 3, tag + ' 3 guardias sin premio'));
  // 5. nadie por encima del objetivo sin haber ganado, salvo fuera de su turno
  if (s.phase === 'main' && !s.special) assert.ok(HX.vpTotal(s, s.turn.p) < s.opts.target, tag + ' debería haber ganado');
  // 6. la vista pública es serializable y no filtra manos
  const txt = JSON.stringify(HX.publicView(s));
  assert.ok(!/"res":/.test(txt) && !/"deck":/.test(txt), tag + ' fuga en vista pública');
}

let games = 0, totalTurns = 0, maxTurns = 0, actions = 0, t0 = Date.now();
const stats = { winsByVp: {}, turns: [] };
for (let n = 2; n <= 6; n++) {
  let turnsN = 0;
  for (let g = 0; g < N; g++) {
    const seed = n * 100000 + g;
    const rng = HX.seeded(seed);
    const s = HX.newGame(Array.from({ length: n }, (_, i) => ({ name: 'Bot' + (i + 1), color: i, bot: true })), {}, rng);
    let steps = 0;
    while (s.phase !== 'over') {
      const w = HX.whoActs(s);
      assert.ok(w.who.length > 0, 'nadie puede actuar: ' + JSON.stringify(w));
      let did = false;
      // probar también a los que no les toca: no deben poder hacer nada (salvo responder ofertas)
      for (let p = 0; p < n && !did; p++) {
        const a = HX.botChoose(s, p, rng);
        if (!a) continue;
        const err = HX.act(s, p, a, rng);
        assert.strictEqual(err, null, 'semilla ' + seed + ' jugada rechazada ' + JSON.stringify(a) + ': ' + err);
        did = true; actions++;
      }
      assert.ok(did, 'semilla ' + seed + ': bloqueo en ' + JSON.stringify(w));
      if (steps % 7 === 0 || s.phase === 'over') check(s, 'semilla ' + seed + ' paso ' + steps);
      steps++;
      assert.ok(steps < 60000, 'semilla ' + seed + ': partida interminable (turno ' + s.turn.n + ')');
    }
    assert.ok(HX.vpTotal(s, s.winner) >= 10);
    games++; totalTurns += s.turn.n; turnsN += s.turn.n; maxTurns = Math.max(maxTurns, s.turn.n);
  }
  console.log('  ' + n + ' jugadores: ' + N + ' partidas, media ' + Math.round(turnsN / N) + ' turnos (' + Math.round(turnsN / N / n) + ' rondas)');
}
console.log(games + ' partidas completas, ' + actions + ' jugadas, máximo ' + maxTurns + ' turnos, ' + (Date.now() - t0) + ' ms');

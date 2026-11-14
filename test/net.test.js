// Pruebas de la capa de red: sellado, cliente MQTT contra un servidor de prueba, y partidas completas
// jugadas a través de un canal con pérdidas, duplicados y desorden.
const assert = require('assert');
const http = require('http');
const HX = require('../src/engine.js');
const NET = require('../src/net.js');
const WS = require('/opt/npm-tools/node_modules/ws');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.log('FALLO ' + name + '\n' + (e.stack || e)); process.exitCode = 1; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('tiempo agotado: ' + what); await sleep(5); }
}

/* ---- Servidor MQTT de prueba (independiente del cliente: solo lo justo del protocolo) ---- */
function mockBroker(opts) {
  opts = opts || {};
  const server = http.createServer();
  const wss = new WS.Server({ server, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false) });
  const clients = new Set(), retained = new Map();
  const stats = { connects: 0, publishes: 0, pings: 0 };
  function send(ws, bytes) {
    if (ws.readyState !== 1) return;
    if (opts.fragment) { // trocear para probar el reensamblado
      for (let i = 0; i < bytes.length; i += 7) ws.send(bytes.subarray(i, Math.min(i + 7, bytes.length)));
    } else ws.send(bytes);
  }
  function varint(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 128; o.push(d); } while (n); return o; }
  function pubPacket(topic, payload, retain) {
    const t = Buffer.from(topic, 'utf8');
    return Buffer.concat([Buffer.from([0x30 | (retain ? 1 : 0)]), Buffer.from(varint(2 + t.length + payload.length)), Buffer.from([t.length >> 8, t.length & 255]), t, payload]);
  }
  wss.on('connection', ws => {
    const c = { ws, subs: new Set(), buf: Buffer.alloc(0), ok: false };
    clients.add(c);
    ws.on('close', () => clients.delete(c));
    ws.on('message', data => {
      c.buf = Buffer.concat([c.buf, Buffer.from(data)]);
      for (;;) {
        if (c.buf.length < 2) return;
        let len = 0, mult = 1, i = 1, done = false;
        for (; i < c.buf.length && i < 5; i++) { len += (c.buf[i] & 127) * mult; mult *= 128; if (!(c.buf[i] & 128)) { done = true; i++; break; } }
        if (!done || c.buf.length < i + len) return;
        const h = c.buf[0], p = c.buf.subarray(i, i + len);
        c.buf = c.buf.subarray(i + len);
        const type = h >> 4;
        if (type === 1) { // CONNECT
          assert.strictEqual(p.subarray(0, 6).toString('latin1'), '\x00\x04MQTT');
          assert.strictEqual(p[6], 4, 'nivel de protocolo 3.1.1');
          assert.strictEqual(p[7] & 2, 2, 'sesión limpia');
          const idLen = (p[10] << 8) | p[11];
          assert.ok(idLen > 0 && idLen <= 23, 'longitud del identificador');
          assert.strictEqual(p.length, 12 + idLen);
          c.ok = true; stats.connects++;
          send(ws, Buffer.from([0x20, 2, 0, 0]));
        } else if (!c.ok) { ws.close(); return; }
        else if (type === 8) { // SUBSCRIBE
          assert.strictEqual(h & 15, 2);
          const tl = (p[2] << 8) | p[3], topic = p.subarray(4, 4 + tl).toString('utf8');
          assert.strictEqual(p.length, 4 + tl + 1);
          c.subs.add(topic);
          send(ws, Buffer.from([0x90, 3, p[0], p[1], 0]));
          if (retained.has(topic)) send(ws, pubPacket(topic, retained.get(topic), true));
        } else if (type === 3) { // PUBLISH QoS 0
          assert.strictEqual((h >> 1) & 3, 0);
          const tl = (p[0] << 8) | p[1], topic = p.subarray(2, 2 + tl).toString('utf8'), payload = Buffer.from(p.subarray(2 + tl));
          stats.publishes++;
          if (h & 1) { if (payload.length) retained.set(topic, payload); else retained.delete(topic); }
          clients.forEach(o => { if (o.subs.has(topic)) send(o.ws, pubPacket(topic, payload, false)); });
        } else if (type === 12) { stats.pings++; send(ws, Buffer.from([0xD0, 0])); }
        else if (type === 14) { ws.close(); return; }
      }
    });
  });
  return new Promise(res => server.listen(0, '127.0.0.1', () => res({
    url: 'ws://127.0.0.1:' + server.address().port + '/mqtt', stats, retained, clients,
    dropAll() { clients.forEach(c => c.ws.terminate()); },
    close() { clients.forEach(c => c.ws.terminate()); wss.close(); server.close(); }
  })));
}

/* ---- Canal en memoria con pérdidas, duplicados, desorden y mensajes retenidos ---- */
function memBus(o) {
  o = Object.assign({ loss: 0, dup: 0, maxDelay: 0, seed: 1 }, o || {});
  const rng = HX.seeded(o.seed), ends = [], retained = new Map();
  const bus = {
    sent: 0, dropped: 0,
    endpoint() {
      const ep = {
        onmsg: null, onstatus: null, topics: new Set(),
        sub(t) { ep.topics.add(t); if (retained.has(t)) deliver(ep, t, retained.get(t)); },
        pub(t, b, retain) {
          bus.sent++;
          if (retain) retained.set(t, b);
          ends.forEach(x => { if (x !== ep && x.topics.has(t)) deliver(x, t, b); });
          return 1;
        },
        status() { return { up: 1, total: 1, kind: 'mem', settled: true }; }, kick() { }, close() { ep.dead = true; }
      };
      ends.push(ep);
      return ep;
    }
  };
  function deliver(ep, t, b) {
    if (rng() < o.loss) { bus.dropped++; return; }
    const n = rng() < o.dup ? 2 : 1;
    for (let i = 0; i < n; i++) setTimeout(() => { if (!ep.dead && ep.onmsg) ep.onmsg(t, b); }, Math.floor(rng() * o.maxDelay));
  }
  return bus;
}

(async () => {
  console.log('Sellado de mensajes');
  await test('ida y vuelta, clave equivocada y basura', () => {
    const obj = { k: 's', v: 12, s: { texto: 'ñandú €', lista: [1, 2, { a: null }] } };
    const b = NET.seal(obj, 'ABC234|k');
    assert.deepStrictEqual(NET.unseal(b, 'ABC234|k'), obj);
    assert.strictEqual(NET.unseal(b, 'ABC235|k'), null);
    const c = b.slice(); c[10] ^= 1;
    assert.strictEqual(NET.unseal(c, 'ABC234|k'), null);
    assert.strictEqual(NET.unseal(new Uint8Array(0), 'x'), null);
    assert.strictEqual(NET.unseal(new TextEncoder().encode('{"k":"s"}'), 'ABC234|k'), null);
    // el texto no viaja en claro
    assert.ok(Buffer.from(b).toString('latin1').indexOf('texto') < 0);
    // dos sellados del mismo mensaje no son iguales
    assert.notDeepStrictEqual(Array.from(NET.seal(obj, 'k')), Array.from(NET.seal(obj, 'k')));
    for (let n = 0; n < 300; n++) {
      const o = { s: 'x'.repeat(n), n };
      assert.deepStrictEqual(NET.unseal(NET.seal(o, 'clave' + n), 'clave' + n), o);
    }
  });
  await test('códigos de sala', () => {
    for (let i = 0; i < 200; i++) { const c = NET.newCode(); assert.ok(NET.validCode(c), c); }
    assert.strictEqual(NET.cleanCode(' k7m-q2x '), 'K7MQ2X');
    assert.ok(!NET.validCode('ABCDE')); assert.ok(!NET.validCode('ABCDE0'));
    assert.notStrictEqual(NET.topicBase('ABCDEF'), NET.topicBase('ABCDEG'));
    assert.ok(/^hxa1\/[0-9a-f]{16}$/.test(NET.topicBase('ABCDEF')));
  });

  console.log('Cliente MQTT');
  for (const fragment of [false, true]) {
    await test('conectar, suscribir, publicar, retenidos y reconexión' + (fragment ? ' (paquetes troceados)' : ''), async () => {
      const br = await mockBroker({ fragment });
      const got = { a: [], b: [] };
      const A = new NET.MqttTransport([br.url], WS, { pingMs: 60 }), B = new NET.MqttTransport([br.url], WS, { pingMs: 60 });
      A.onmsg = (t, b) => got.a.push([t, Buffer.from(b).toString()]);
      B.onmsg = (t, b) => got.b.push([t, Buffer.from(b).toString()]);
      A.sub('sala/x'); B.sub('sala/x'); B.sub('sala/y');
      await until(() => A.status().up === 1 && B.status().up === 1, 3000, 'conexión');
      await sleep(30);
      assert.strictEqual(A.pub('sala/x', Buffer.from('hola'), false), 1);
      const big = 'z'.repeat(20000);
      A.pub('sala/y', Buffer.from(big), true);
      await until(() => got.b.length === 2, 3000, 'recepción');
      assert.deepStrictEqual(got.b[0], ['sala/x', 'hola']);
      assert.strictEqual(got.b[1][1].length, 20000);
      await until(() => got.a.length === 1, 1000, 'eco propio'); // el emisor también está suscrito a sala/x
      // un cliente nuevo recibe el retenido al suscribirse
      const C = new NET.MqttTransport([br.url], WS), gc = [];
      C.onmsg = (t, b) => gc.push([t, b.length]);
      C.sub('sala/y');
      await until(() => gc.length === 1, 3000, 'retenido');
      assert.deepStrictEqual(gc[0], ['sala/y', 20000]);
      // latidos
      await until(() => br.stats.pings >= 2, 2000, 'latidos');
      // caída del servidor: reconecta solo y se vuelve a suscribir
      let downs = 0; B.onstatus = st => { if (!st.up) downs++; };
      br.dropAll();
      await until(() => B.status().up === 0, 2000, 'detecta caída');
      await until(() => A.status().up === 1 && B.status().up === 1, 6000, 'reconexión');
      await sleep(50);
      got.b.length = 0;
      A.pub('sala/x', Buffer.from('otra vez'), false);
      await until(() => got.b.some(m => m[1] === 'otra vez'), 3000, 'tras reconectar');
      assert.ok(downs >= 1);
      A.close(); B.close(); C.close(); br.close();
    });
  }
  await test('con dos servidores, si uno no existe la partida sigue por el otro', async () => {
    const br = await mockBroker();
    const A = new NET.MqttTransport(['ws://127.0.0.1:9/mqtt', br.url], WS), B = new NET.MqttTransport([br.url, 'ws://127.0.0.1:9/mqtt'], WS);
    const got = [];
    B.onmsg = (t, b) => got.push(Buffer.from(b).toString());
    B.sub('t');
    await until(() => A.status().up === 1 && B.status().up === 1, 3000, 'conexión parcial');
    await sleep(30);
    assert.strictEqual(A.pub('t', Buffer.from('ok'), false), 1);
    await until(() => got.length === 1, 2000, 'entrega');
    assert.strictEqual(A.status().total, 2);
    A.close(); B.close(); br.close();
  });

  console.log('Anfitrión y clientes');
  function mkStore() { let v = null; return { set(x) { v = x; }, get() { return v; } }; }
  async function playGame({ humans, bots, loss, dup, maxDelay, seed, viaMqtt, restartAt }) {
    const rng = HX.seeded(seed);
    let bus, br, mk;
    if (viaMqtt) { br = await mockBroker(); mk = () => new NET.MqttTransport([br.url], WS); }
    else { bus = memBus({ loss, dup, maxDelay, seed }); mk = () => bus.endpoint(); }
    const store = mkStore();
    let host = new NET.Host({ transport: mk(), store, rng, botMs: 0, tickMs: 50, awayMs: 4000 });
    const code = host.code;
    const clients = [];
    for (let i = 0; i < humans; i++) {
      const c = new NET.Client({ transport: mk(), code, key: NET.randomStr(20), pingMs: 60, resendMs: 40 });
      c.errs = [];
      c.onerr = m => c.errs.push(m);
      c.join('Humano ' + (i + 1), i);
      clients.push(c);
    }
    const tv = new NET.Client({ transport: mk(), code, pingMs: 60, resendMs: 40 });
    await until(() => host.seats.length === humans, 8000, 'entradas en la sala');
    for (let i = 0; i < bots; i++) host.addBot();
    await until(() => clients.every(c => c.pub && c.pub.phase === 'lobby' && c.pub.seats.length === humans + bots && c.inSeat()), 8000, 'sala sincronizada');
    assert.strictEqual(host.start(), null);
    let restarted = false, moves = 0;
    const t0 = Date.now();
    for (;;) {
      if (host.state && host.state.phase === 'over') break;
      if (Date.now() - t0 > 120000) throw new Error('partida demasiado lenta: turno ' + (host.state && host.state.turn.n));
      // cada humano decide con SOLO lo que ve en su pantalla
      for (const c of clients) {
        if (!c.pub || c.pub.phase === 'lobby' || !c.body || c.body.me < 0 || c.pending || !c.body.priv || !c.synced()) continue;
        if (c.pub.phase === 'over') continue;
        const view = HX.mergeView(c.pub, c.body.priv);
        const a = HX.botChoose(view, c.body.me, rng);
        if (a && c.act(a)) moves++;
      }
      if (restartAt && !restarted && host.state && host.state.turn.n >= restartAt) {
        // el anfitrión se cae y vuelve (recarga de la página) recuperando lo guardado
        restarted = true;
        host.close(); host.t.close();
        await sleep(30);
        host = new NET.Host({ transport: mk(), store, rng, botMs: 0, tickMs: 50, awayMs: 4000, restore: JSON.parse(store.get()) });
        assert.strictEqual(host.code, code);
      }
      await sleep(2);
    }
    const final = host.pubView();
    await until(() => clients.every(c => c.pub && c.pub.phase === 'over' && c.pub.winner === final.winner) && tv.pub && tv.pub.phase === 'over', 10000, 'final sincronizado');
    // cada cliente ve su propia mano idéntica a la real, y nunca la de otros
    clients.forEach(c => {
      const idx = c.body.me;
      assert.deepStrictEqual(c.body.priv.res, host.state.players[idx].res);
      assert.ok(!/"res":/.test(JSON.stringify(c.pub)));
    });
    assert.ok(!tv.body);
    const errs = clients.reduce((n, c) => n + c.errs.length, 0);
    const out = { turns: host.state.turn.n, moves, errs, sent: bus ? bus.sent : br.stats.publishes, dropped: bus ? bus.dropped : 0, restarted };
    host.close(); clients.forEach(c => { c.close(); c.t.close(); }); tv.close(); tv.t.close(); host.t.close();
    if (br) br.close();
    return out;
  }
  await test('partida de 3 humanos + 1 bot por canal perfecto', async () => {
    const r = await playGame({ humans: 3, bots: 1, loss: 0, dup: 0, maxDelay: 0, seed: 101 });
    assert.ok(r.turns > 10);
    console.log('        ' + JSON.stringify(r));
  });
  await test('partida de 4 humanos con 25 % de pérdidas, duplicados y desorden', async () => {
    const r = await playGame({ humans: 4, bots: 0, loss: 0.25, dup: 0.2, maxDelay: 25, seed: 202 });
    assert.ok(r.dropped > 50);
    console.log('        ' + JSON.stringify(r));
  });
  await test('partida de 6 (5 humanos + 1 bot) con pérdidas y recarga del anfitrión a mitad', async () => {
    const r = await playGame({ humans: 5, bots: 1, loss: 0.1, dup: 0.1, maxDelay: 10, seed: 303, restartAt: 12 });
    assert.ok(r.restarted);
    console.log('        ' + JSON.stringify(r));
  });
  await test('partida de 2 humanos + 2 bots a través del cliente MQTT real', async () => {
    const r = await playGame({ humans: 2, bots: 2, seed: 404, viaMqtt: true });
    console.log('        ' + JSON.stringify(r));
  });
  await test('sala: colores únicos, sala llena, partida empezada, expulsión y revancha', async () => {
    const bus = memBus({ seed: 5 });
    const host = new NET.Host({ transport: bus.endpoint(), botMs: 0, tickMs: 50 });
    const mk = (name, color) => { const c = new NET.Client({ transport: bus.endpoint(), code: host.code, key: NET.randomStr(20), pingMs: 40, resendMs: 40 }); c.join(name, color); return c; };
    const a = mk('  Ana <b>  ', 2), b = mk('Luis', 2);
    await until(() => host.seats.length === 2, 2000, 'dos entradas');
    assert.strictEqual(host.seats[0].name, 'Ana b'); assert.strictEqual(host.seats[0].color, 2);
    assert.notStrictEqual(host.seats[1].color, 2);
    for (let i = 0; i < 4; i++) host.addBot();
    assert.strictEqual(host.addBot(), false);
    const c = mk('Tarde', 0);
    await until(() => c.rej === 'full', 2000, 'sala llena');
    // expulsar a Luis
    host.removeSeat(1);
    await until(() => b.rej === 'kicked' && !b.inSeat(), 2000, 'expulsión');
    await sleep(120);
    assert.strictEqual(host.seats.length, 5, 'el expulsado no vuelve a entrar solo');
    b.join('Luis', 1);
    await until(() => host.seats.length === 6 && b.inSeat(), 2000, 'vuelve a entrar');
    host.removeSeat(5); host.removeSeat(4); host.removeSeat(3);
    assert.strictEqual(host.start(), null);
    const d = mk('Nuevo', 0);
    await until(() => d.rej === 'started', 2000, 'partida empezada');
    // jugadas fuera de turno devuelven el error al cliente
    await until(() => a.body && a.body.me >= 0 && a.seqKnown, 2000, 'vista privada');
    let err = null; a.onerr = m => err = m;
    // los bots juegan hasta que le toca a Ana; entonces una jugada imposible devuelve su motivo
    await until(() => HX.whoActs(host.state).who[0] === a.body.me && a.synced() && a.pub.setup && a.pub.setup.v === null, 4000, 'turno de Ana');
    assert.ok(a.act({ t: 'road', e: 0 }));
    await until(() => err === 'Primero coloca la aldea', 2000, 'error devuelto');
    host.rematch();
    await until(() => a.pub.phase === 'lobby' && a.body.me === -1 && a.inSeat(), 2000, 'revancha');
    assert.strictEqual(host.seats.length, 3);
    host.close(); [a, b, c, d].forEach(x => x.close());
  });
  await test('modo automático: un bot juega por un jugador ausente y luego se le devuelve el control', async () => {
    const bus = memBus({ seed: 6 });
    const host = new NET.Host({ transport: bus.endpoint(), botMs: 0, tickMs: 30, awayMs: 150 });
    const c = new NET.Client({ transport: bus.endpoint(), code: host.code, key: NET.randomStr(20), pingMs: 40, resendMs: 40 });
    c.join('Ausente', 0);
    await until(() => host.seats.length === 1, 2000, 'entrada');
    host.addBot();
    host.start();
    const me = host.playerIdx(c.key);
    c.close(); // deja de dar señales de vida
    await until(() => host.pubView().on[me] === false, 3000, 'detecta ausencia');
    host.setAuto(me, true);
    await until(() => host.state.phase === 'main' && host.state.turn.n > 6, 20000, 'la partida avanza sola');
    host.setAuto(me, false);
    const n = host.state.turn.n;
    await sleep(200);
    assert.ok(host.state.turn.n <= n + 1, 'al quitar el automático la partida espera al jugador');
    assert.ok(typeof host.takeoverKey(me) === 'string');
    host.close();
  });

  console.log('\n' + passed + ' pruebas correctas');
  setTimeout(() => process.exit(process.exitCode || 0), 100);
})();

// Comercio entre dos móviles a través de la interfaz.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'));
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext(); const errors = [];
  const tv = await ctx.newPage(); tv.on('pageerror', e => errors.push(e.message));
  await tv.goto(base + '?red=local'); await tv.click('[data-a=create]');
  await tv.waitForSelector('.lobby .code'); const code = (await tv.textContent('.lobby .code')).trim();
  const ph = [];
  for (let i = 0; i < 2; i++) {
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(base + '?sala=' + code + '&red=local&llave=trade' + i + 'abcdefghijk');
    await p.waitForSelector('#nm'); await p.fill('#nm', ['Ana', 'Beto'][i]); await p.click('[data-a=enter]');
    await p.waitForSelector('text=¡Dentro!'); ph.push(p);
  }
  // el orden de juego se sortea: en la tele se fija sin barajar para la prueba
  await tv.evaluate(() => { const h = HXA.ctl().host; h.rng = HX.seeded(7); });
  await tv.click('[data-a=start]');
  for (const p of ph) await p.waitForSelector('.pv');
  // preparación rápida con jugadas directas
  const info = async p => p.evaluate(() => { const c = HXA.ctl().client; return { me: c.body && c.body.me, ok: c.synced() && !c.pending, phase: c.pub.phase }; });
  for (let n = 0; n < 200; n++) {
    let moved = false;
    for (const p of ph) {
      moved = (await p.evaluate(() => {
        const c = HXA.ctl().client; if (!c.body || !c.body.priv || c.pending || !c.synced()) return false;
        const v = HX.mergeView(c.pub, c.body.priv); if (v.phase !== 'setup') return false;
        const a = HX.botChoose(v, c.body.me, Math.random); return a ? c.act(a) : false;
      })) || moved;
    }
    if ((await info(ph[0])).phase === 'main' && (await info(ph[1])).phase === 'main') break;
    await sleep(40);
  }
  const cur = await tv.evaluate(() => HXA.ctl().host.state.turn.p);
  const A = (await info(ph[0])).me === cur ? ph[0] : ph[1], B = A === ph[0] ? ph[1] : ph[0];
  await A.bringToFront();
  await A.click('[data-a=roll]');
  await sleep(500);
  // si sale 7, resolverlo
  for (let k = 0; k < 20; k++) {
    const pend = await tv.evaluate(() => HXA.ctl().host.state.pend);
    if (!pend) break;
    for (const p of ph) await p.evaluate(() => { const c = HXA.ctl().client; if (!c.body || c.pending || !c.synced()) return; const v = HX.mergeView(c.pub, c.body.priv); const a = HX.botChoose(v, c.body.me, Math.random); if (a && a.t !== 'end') c.act(a); });
    await sleep(300);
  }
  const st = await tv.evaluate(() => { const s = HXA.ctl().host.state; return { res: s.players.map(p => p.res), p: s.turn.p }; });
  const aIdx = st.p, bIdx = 1 - aIdx;
  const give = Object.keys(st.res[aIdx]).find(r => st.res[aIdx][r] > 0), want = Object.keys(st.res[bIdx]).find(r => st.res[bIdx][r] > 0 && r !== give);
  console.log('A da', give, 'y pide', want);
  await A.click('[data-a=sheet][data-s=trade]');
  await A.click(`[data-a=st][data-k=give][data-r=${give}][data-d="1"]`);
  await A.click(`[data-a=st][data-k=want][data-r=${want}][data-d="1"]`);
  await A.click('[data-a=offer]');
  await B.bringToFront();
  await B.waitForSelector('.offers [data-a=respond][data-ok="1"]', { timeout: 5000 });
  await B.screenshot({ path: path.join(__dirname, 'shots', '15-movil-oferta.png') });
  await B.click('.offers [data-a=respond][data-ok="1"]');
  await A.bringToFront();
  await A.waitForSelector('.offers [data-a=confirmtrade]', { timeout: 5000 });
  await A.screenshot({ path: path.join(__dirname, 'shots', '16-movil-aceptada.png') });
  await A.click('.offers [data-a=confirmtrade]');
  await sleep(600);
  const after = await tv.evaluate(() => HXA.ctl().host.state.players.map(p => p.res));
  const ok = after[aIdx][give] === st.res[aIdx][give] - 1 && after[aIdx][want] === st.res[aIdx][want] + 1 && after[bIdx][give] === st.res[bIdx][give] + 1 && after[bIdx][want] === st.res[bIdx][want] - 1;
  console.log(ok ? 'comercio entre jugadores por la interfaz: ok' : 'FALLO en el comercio ' + JSON.stringify({ st, after }));
  if (errors.length) console.log('ERRORES', errors);
  await browser.close(); server.close();
  process.exit(ok && !errors.length ? 0 : 1);
})().catch(e => { console.error('FALLO', e); process.exit(1); });

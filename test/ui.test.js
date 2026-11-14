// Prueba de la interfaz en Chrome: 1 tele (anfitrión) + 3 móviles + 1 bot, partida completa manejando la interfaz.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'));
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = path.join(__dirname, 'shots');
const errors = [];

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const watch = (p, name) => {
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(name + ' consola: ' + m.text()); });
  };
  const tv = await ctx.newPage(); watch(tv, 'tele');
  await tv.setViewportSize({ width: 1600, height: 900 });
  await tv.goto(base + '?red=local');
  await tv.screenshot({ path: SHOTS + '/01-inicio.png' });
  await tv.click('[data-a=create]');
  await tv.waitForSelector('.lobby .code');
  const code = (await tv.textContent('.lobby .code')).trim();
  console.log('sala', code);
  const names = ['Brian', 'Dani', 'Lucía'];
  const phones = [];
  for (let i = 0; i < 3; i++) {
    const p = await ctx.newPage(); watch(p, names[i]);
    await p.setViewportSize({ width: 390, height: 844 });
    // en la prueba los "móviles" comparten almacenamiento: cada uno lleva su propia llave en el enlace
    await p.goto(base + '?sala=' + code + '&red=local&llave=movil' + i + 'abcdefghij');
    try { await p.waitForSelector('#nm', { timeout: 8000 }); }
    catch (e) { console.log(await p.evaluate(() => document.querySelector('#app').innerText)); await p.screenshot({ path: SHOTS + '/x-fallo.png' }); throw e; }
    // distinto almacenamiento por "móvil": el mismo contexto comparte localStorage, así que cada uno usa su llave
    await p.fill('#nm', names[i]);
    await p.click('.colors button[data-i="' + (i + 1) + '"]');
    if (i === 0) await p.screenshot({ path: SHOTS + '/02-movil-unirse.png' });
    await p.click('[data-a=enter]');
    await p.waitForSelector('text=¡Dentro!', { timeout: 8000 });
    phones.push(p);
  }
  await tv.click('[data-a=bot]');
  await sleep(400);
  await tv.screenshot({ path: SHOTS + '/03-tele-sala.png' });
  await phones[0].screenshot({ path: SHOTS + '/04-movil-espera.png' });
  await tv.click('[data-a=start]');
  await tv.waitForSelector('.tv');
  for (const p of phones) await p.waitForSelector('.pv', { timeout: 8000 });

  // --- conductor de la interfaz ---
  async function clickSel(p, sel) {
    // espera (hasta 3 s) a que el botón exista y esté activo, como haría una persona
    try { await p.waitForFunction(s => { const el = document.querySelector(s); return el && !el.disabled; }, sel, { timeout: 3000, polling: 50 }); } catch (e) { return false; }
    return p.evaluate(s => { const el = document.querySelector(s); if (!el || el.disabled) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; }, sel);
  }
  async function step(p, i) {
    // ¿qué haría un bot con lo que ve este móvil?
    const plan = await p.evaluate(() => {
      const c = window.HXA.ctl(); const cl = c.client;
      if (!cl || !cl.pub || !cl.body || !cl.body.priv || cl.pending || !cl.synced()) return null;
      if (cl.pub.phase === 'over') return { over: true };
      const v = HX.mergeView(cl.pub, cl.body.priv);
      const a = HX.botChoose(v, cl.body.me, Math.random);
      return a ? { a, sheet: window.HXA.ui.sheet && window.HXA.ui.sheet.k } : null;
    });
    if (!plan || plan.over) return plan;
    await p.bringToFront();
    const a = plan.a;
    const t = a.t;
    let ok = false;
    if (t === 'sett' || t === 'road' || t === 'city' || t === 'robber') {
      const attr = t === 'robber' ? 'h' : (t === 'road' ? 'e' : 'v'), id = a[attr];
      if (!(await p.$('[data-' + attr + '="' + id + '"]'))) {
        const m = t === 'sett' ? 'sett' : t === 'city' ? 'city' : 'road';
        await clickSel(p, '[data-a=mode][data-m=' + m + ']');
        await sleep(60);
      }
      ok = await clickSel(p, '[data-' + attr + '="' + id + '"]');
      await sleep(40);
      ok = ok && await clickSel(p, '[data-a=confirm]');
    } else if (t === 'roll' || t === 'end' || t === 'pass' || t === 'buy') {
      ok = await clickSel(p, '[data-a=' + t + ']');
    } else if (t === 'discard') {
      for (const r of Object.keys(a.res)) for (let k = 0; k < a.res[r]; k++) { await clickSel(p, '[data-a=st][data-k=disc][data-r=' + r + '][data-d="1"]'); }
      ok = await clickSel(p, '[data-a=discard]');
    } else if (t === 'steal') {
      ok = await clickSel(p, '[data-a=steal][data-i="' + a.from + '"]');
    } else if (t === 'bank') {
      await clickSel(p, '[data-a=sheet][data-s=trade]'); await sleep(30);
      await clickSel(p, '[data-a=bg][data-r=' + a.give + ']'); await clickSel(p, '[data-a=bt][data-r=' + a.get + ']');
      ok = await clickSel(p, '[data-a=bank]');
    } else if (t === 'play') {
      await clickSel(p, '[data-a=sheet][data-s=cards]'); await sleep(30);
      ok = await clickSel(p, '[data-a=playcard][data-k=' + a.k + ']');
      if (a.k === 'P') { await clickSel(p, '[data-a=p2][data-r=' + a.res[0] + ']'); await clickSel(p, '[data-a=p2][data-r=' + a.res[1] + ']'); ok = await clickSel(p, '[data-a=playP]'); }
      if (a.k === 'M') { await clickSel(p, '[data-a=m1][data-r=' + a.res + ']'); ok = await clickSel(p, '[data-a=playM]'); }
    } else if (t === 'respond') {
      ok = await clickSel(p, '[data-a=respond][data-id="' + a.id + '"][data-ok="' + (a.ok ? 1 : 0) + '"]');
    }
    if (!ok) {
      // si la interfaz no ofrece la jugada, es un fallo de la interfaz
      const st = await p.evaluate(() => ({ banner: document.querySelector('.banner') && document.querySelector('.banner').textContent, sheet: window.HXA.ui.sheet, actions: [...document.querySelectorAll('.actions button')].map(b => b.textContent + (b.disabled ? '(off)' : '')) }));
      throw new Error(names[i] + ': la interfaz no permite ' + JSON.stringify(a) + ' ' + JSON.stringify(st));
    }
    return { did: t };
  }
  const counts = {};
  let shots = { setup: false, main: false, trade: false, cards: false, discard: false, tv: false }, steps = 0;
  const t0 = Date.now();
  for (;;) {
    let any = false, over = false;
    for (let i = 0; i < phones.length; i++) {
      const r = await step(phones[i], i);
      if (r && r.over) over = true;
      if (r && r.did) {
        any = true; counts[r.did] = (counts[r.did] || 0) + 1; steps++;
        await sleep(25);
        // capturas
        if (!shots.setup && r.did === 'sett') { shots.setup = true; await phones[i].screenshot({ path: SHOTS + '/05-movil-preparacion.png' }); }
        if (!shots.main && r.did === 'roll' && counts.roll > 6) { shots.main = true; await sleep(300); await phones[i].screenshot({ path: SHOTS + '/06-movil-turno.png' }); }
        if (!shots.tv && counts.roll > 12) { shots.tv = true; await tv.screenshot({ path: SHOTS + '/07-tele-partida.png' }); }
        if (!shots.discard && await phones[i].$('[data-a=discard]')) { shots.discard = true; await phones[i].screenshot({ path: SHOTS + '/08-movil-descartar.png' }); }
      }
    }
    if (over) break;
    if (!any) await sleep(60);
    if (Date.now() - t0 > 600000) throw new Error('demasiado tiempo');
    // a mitad de partida, abrir la hoja de comercio y la de cartas para capturarlas
    if (!shots.trade && counts.roll > 20) {
      for (let i = 0; i < 3; i++) {
        const myTurn = await phones[i].evaluate(() => !!document.querySelector('[data-a=end]:not([disabled])'));
        if (myTurn) {
          shots.trade = true;
          await clickSel(phones[i], '[data-a=sheet][data-s=trade]'); await sleep(200);
          await clickSel(phones[i], '[data-a=st][data-k=want][data-r=O][data-d="1"]'); await sleep(100);
          await phones[i].screenshot({ path: SHOTS + '/09-movil-comercio.png' });
          await clickSel(phones[i], '[data-a=close]');
          await clickSel(phones[i], '[data-a=sheet][data-s=menu]'); await sleep(150);
          await phones[i].screenshot({ path: SHOTS + '/10-movil-menu.png' });
          await clickSel(phones[i], '[data-a=close]');
          break;
        }
      }
    }
  }
  await sleep(800);
  await tv.screenshot({ path: SHOTS + '/11-tele-final.png' });
  await phones[0].screenshot({ path: SHOTS + '/12-movil-final.png' });
  console.log('jugadas por la interfaz:', steps, JSON.stringify(counts), Math.round((Date.now() - t0) / 1000) + ' s');
  // revancha y recarga del anfitrión
  await tv.click('[data-a=rematch]');
  await phones[0].waitForSelector('text=¡Dentro!', { timeout: 8000 });
  await tv.click('[data-a=start]');
  await phones[0].waitForSelector('.pv', { timeout: 8000 });
  await tv.reload();
  await tv.waitForSelector('.tv', { timeout: 8000 });
  // un móvil recarga y recupera su sitio
  await phones[1].goto(base + '?sala=' + code + '&red=local&llave=movil1abcdefghij');
  await phones[1].waitForSelector('.pv', { timeout: 10000 });
  console.log('revancha, recarga de la tele y de un móvil: ok');
  // espectador
  const spec = await ctx.newPage(); watch(spec, 'espectador');
  await spec.setViewportSize({ width: 1280, height: 720 });
  await spec.goto(base + '?tele=' + code + '&red=local');
  await spec.waitForSelector('.tv', { timeout: 10000 });
  await spec.screenshot({ path: SHOTS + '/13-espectador.png' });
  console.log('espectador: ok');
  // modo práctica
  const solo = await ctx.newPage(); watch(solo, 'solo');
  await solo.setViewportSize({ width: 390, height: 844 });
  await solo.goto(base);
  await solo.click('[data-a=solo]');
  await solo.fill('#nm', 'Yo');
  await solo.click('[data-a=nbots][data-i="3"]');
  await solo.click('[data-a=solostart]');
  await solo.waitForSelector('.pv');
  await sleep(2500);
  await solo.screenshot({ path: SHOTS + '/14-practica.png' });
  console.log('práctica: ok');
  await browser.close(); server.close();
  if (errors.length) { console.log('ERRORES:\n' + errors.join('\n')); process.exit(1); }
  console.log('sin errores de JavaScript');
})().catch(async e => { console.error('FALLO', e); console.log(errors.join('\n')); process.exit(1); });

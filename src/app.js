/* Hexaldea — interfaz: inicio, sala, móvil de cada jugador y pantalla de tele. */
(function () {
  'use strict';
  var HX = window.HX, NET = window.NET, QR = window.QR;

  /* ---------- Datos de presentación ---------- */
  var PCOL = [
    { n: 'Rojo', c: '#e5383b', t: '#fff' }, { n: 'Azul', c: '#3a7bd5', t: '#fff' }, { n: 'Naranja', c: '#f39c12', t: '#1b1200' },
    { n: 'Blanco', c: '#f2f2ec', t: '#111' }, { n: 'Morado', c: '#9b59d0', t: '#fff' }, { n: 'Turquesa', c: '#16b3a6', t: '#03201d' }
  ];
  var RU = {
    W: { e: '🌲', n: 'Madera' }, B: { e: '🧱', n: 'Ladrillo' }, S: { e: '🐑', n: 'Lana' }, G: { e: '🌾', n: 'Trigo' }, O: { e: '🪨', n: 'Piedra' }
  };
  var TERR = { W: '#2f6f31', B: '#b4552c', S: '#86b84a', G: '#e1b33b', O: '#8b9099', D: '#d8c38e' };
  var TEMO = { W: '🌲', B: '🧱', S: '🐑', G: '🌾', O: '⛰️', D: '🏜️' };
  var DEV = {
    K: { e: '🛡️', n: 'Guardia', d: 'Mueve el bandido y roba una carta. Con 3 o más tienes la Guardia más numerosa (2 puntos).' },
    V: { e: '🏛️', n: 'Monumento', d: 'Vale 1 punto. Los demás no lo ven hasta el final; cuenta solo para ganar.' },
    R: { e: '🛠️', n: 'Obras', d: 'Construye 2 caminos gratis.' },
    P: { e: '🎁', n: 'Abundancia', d: 'Coge 2 recursos de la banca, los que quieras.' },
    M: { e: '💰', n: 'Acaparador', d: 'Elige un recurso: todos te dan todas sus cartas de ese tipo.' }
  };
  var DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

  /* ---------- Utilidades ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function col(c) { return PCOL[c] || PCOL[0]; }
  function sw(c) { return '<span class="sw" style="background:' + col(c).c + '"></span>'; }
  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { }
    return null;
  }
  function costHtml(c) {
    var o = '';
    HX.RES.forEach(function (r) { for (var i = 0; i < (c[r] || 0); i++) o += RU[r].e; });
    return o;
  }
  function resLine(r) {
    var o = [];
    HX.RES.forEach(function (k) { if (r[k]) o.push(r[k] + RU[k].e); });
    return o.join(' ');
  }
  function q(name) { try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; } }
  function baseUrl() { return location.origin + location.pathname; }
  function setUrl(params) {
    var u = new URLSearchParams();
    Object.keys(params).forEach(function (k) { if (params[k]) u.set(k, params[k]); });
    if (q('red')) u.set('red', q('red'));
    var s = u.toString();
    try { history.replaceState(null, '', location.pathname + (s ? '?' + s : '')); } catch (e) { }
  }
  function joinUrl(code, key) {
    var u = baseUrl() + '?sala=' + code;
    if (key) u += '&llave=' + encodeURIComponent(key);
    if (q('red')) u += '&red=' + q('red');
    return u;
  }
  function ago(t) {
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'hace un momento' : m < 60 ? 'hace ' + m + ' min' : 'hace ' + Math.round(m / 60) + ' h';
  }

  /* ---------- Avisos ---------- */
  function toast(msg, kind) {
    var box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; document.body.appendChild(box); }
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, kind === 'err' ? 3500 : 3000);
  }
  var wake = null;
  function keepAwake() {
    try {
      if (navigator.wakeLock && (!wake || wake.released)) navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () { });
    } catch (e) { }
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } }

  /* ---------- Conexión ---------- */
  function makeTransport() {
    var r = q('red');
    if (r === 'local') return new NET.LocalTransport('hx');
    if (r === 'nada') return new NET.NullTransport();
    return new NET.MqttTransport(NET.BROKERS, WebSocket);
  }

  /* ---------- Estado de la aplicación ---------- */
  var ctl = null; // { kind: 'host'|'client'|'tv'|'solo', host, client, transport, code }
  var ui = { sheet: null, mode: null, pick: null, zoom: false, give: {}, want: {}, bg: null, bt: null, disc: {}, p2: [], m1: null, hostTv: false, lastPlog: 0, lastLog: 0, myTurn: false, firstPub: 0, nameDraft: null, colorDraft: null };
  var renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    var done = false;
    var run = function () { if (done) return; done = true; renderQueued = false; try { draw(); } catch (e) { console.error(e); } };
    // algunos navegadores (pestañas en segundo plano, paneles incrustados) no dan fotogramas: el temporizador lo garantiza
    if (!document.hidden) requestAnimationFrame(run);
    setTimeout(run, document.hidden ? 30 : 60);
  }
  function resetUi() {
    ui.sheet = null; ui.mode = null; ui.pick = null; ui.give = {}; ui.want = {}; ui.bg = null; ui.bt = null; ui.disc = {}; ui.p2 = []; ui.m1 = null;
  }
  function stop() {
    if (!ctl) return;
    try { if (ctl.host) ctl.host.close(); } catch (e) { }
    try { if (ctl.client) ctl.client.close(); } catch (e) { }
    if (ctl.iv) clearInterval(ctl.iv);
    try { ctl.transport.close(); } catch (e) { }
    ctl = null;
  }
  function goHome() { stop(); resetUi(); setUrl({}); render(); }

  function hostStore() { return { set: function (v) { ls('hxa-host', v); } }; }
  function startHost(restore, solo) {
    stop(); resetUi();
    var t = solo ? new NET.NullTransport() : makeTransport();
    var h = new NET.Host({ transport: t, store: hostStore(), restore: restore || null, botMs: solo ? 650 : 1100 });
    ls('hxa-host-mode', solo ? 'solo' : 'red');
    ctl = { kind: solo ? 'solo' : 'host', host: h, transport: t, code: h.code };
    h.on(render);
    t.onstatus = function () { render(); };
    setUrl(solo ? { solo: h.code } : { anfitrion: h.code });
    keepAwake();
    render();
    return h;
  }
  function startClient(code, asTv) {
    stop(); resetUi();
    var t = makeTransport(), key = null;
    if (!asTv) {
      var given = q('llave');
      key = given || ls('hxa-key-' + code) || NET.randomStr(20);
      ls('hxa-key-' + code, key);
    }
    var c = new NET.Client({ transport: t, code: code, key: key });
    ctl = { kind: asTv ? 'tv' : 'client', client: c, transport: t, code: code, started: Date.now() };
    var last = t.onstatus;
    t.onstatus = function (st) { if (last) last(st); render(); };
    c.on(function () { if (c.pub && !ui.firstPub) ui.firstPub = Date.now(); render(); });
    c.onerr = function (m) { toast(m, 'err'); };
    setUrl(asTv ? { tele: code } : { sala: code });
    ui.firstPub = 0;
    ctl.iv = setInterval(function () { if (ctl && ctl.client === c && !c.pub) render(); }, 2500);
    render();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !ctl) return;
    try { ctl.transport.kick(); } catch (e) { }
    if (ctl.client) ctl.client.hello();
    if (wake) keepAwake();
    render();
  });

  /* ---------- Contexto de jugador (en remoto o en este mismo dispositivo) ---------- */
  function playerCtx() {
    if (!ctl) return null;
    if (ctl.host) {
      var h = ctl.host;
      if (!h.localKey) return null;
      var me = h.playerIdx(h.localKey);
      return {
        local: true, pub: h.pubView(), priv: me >= 0 ? HX.privateView(h.state, me) : null, me: me, busy: false,
        act: function (a) { var e = h.actLocal(a); if (e) toast(e, 'err'); return !e; }
      };
    }
    var c = ctl.client;
    if (!c || !c.pub) return null;
    return {
      local: false, pub: c.pub, priv: c.body && c.body.priv, me: c.body ? c.body.me : -1, busy: !!c.pending || !c.synced(),
      act: function (a) { if (!c.act(a)) { toast('Un momento, sincronizando…'); return false; } return true; }
    };
  }
  function connDot() {
    if (!ctl) return '';
    var st = ctl.transport.status();
    if (st.kind === 'none') return '<span class="dot on" title="Sin red: partida en este dispositivo"></span>';
    var cls = st.up === 0 ? '' : (st.up < st.total ? 'half' : 'on');
    return '<span class="dot ' + cls + '" title="Conectado a ' + st.up + ' de ' + st.total + ' servidores"></span>';
  }

  /* ---------- Tablero (SVG) ---------- */
  var U = 40, SX = 0.8660254 * U, SY = 0.5 * U;
  function P(o) { return [o.x * SX, o.y * SY]; }
  function f1(n) { return Math.round(n * 10) / 10; }
  function housePath(x, y, s, city) {
    if (!city) return 'M' + f1(x - s) + ',' + f1(y + s * .75) + 'V' + f1(y - s * .15) + 'L' + f1(x) + ',' + f1(y - s) + 'L' + f1(x + s) + ',' + f1(y - s * .15) + 'V' + f1(y + s * .75) + 'Z';
    var w = s * 1.25;
    return 'M' + f1(x - w) + ',' + f1(y + s * .8) + 'V' + f1(y - s * .1) + 'L' + f1(x - w * .5) + ',' + f1(y - s * .75) + 'L' + f1(x) + ',' + f1(y - s * .1) +
      'H' + f1(x + w) + 'V' + f1(y + s * .8) + 'Z';
  }
  function boardSvg(s, opt) {
    opt = opt || {};
    var G = HX.geo(s.board.kind), o = [], i;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    G.vertices.forEach(function (v) { var p = P(v); minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); });
    var m = U * 1.25;
    o.push('<svg viewBox="' + f1(minX - m) + ' ' + f1(minY - m) + ' ' + f1(maxX - minX + 2 * m) + ' ' + f1(maxY - minY + 2 * m) + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">');
    function poly(h) { return h.v.map(function (v) { var p = P(G.vertices[v]); return f1(p[0]) + ',' + f1(p[1]); }).join(' '); }
    // puertos (debajo)
    s.board.harbors.forEach(function (hb) {
      var E = G.edges[hb.e], a = P(G.vertices[E.a]), b = P(G.vertices[E.b]), c = P(G.hexes[E.hexes[0]]);
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = mx - c[0], dy = my - c[1], L = Math.sqrt(dx * dx + dy * dy);
      var hx = mx + dx / L * U * .62, hy = my + dy / L * U * .62;
      o.push('<line class="harb-l" x1="' + f1(hx) + '" y1="' + f1(hy) + '" x2="' + f1(a[0]) + '" y2="' + f1(a[1]) + '"/>');
      o.push('<line class="harb-l" x1="' + f1(hx) + '" y1="' + f1(hy) + '" x2="' + f1(b[0]) + '" y2="' + f1(b[1]) + '"/>');
      o.push('<circle class="harb" cx="' + f1(hx) + '" cy="' + f1(hy) + '" r="' + f1(U * .38) + '"/>');
      if (hb.t === '*') o.push('<text class="harb-t" x="' + f1(hx) + '" y="' + f1(hy) + '" font-size="' + f1(U * .3) + '">3:1</text>');
      else {
        o.push('<text class="emo" x="' + f1(hx) + '" y="' + f1(hy - U * .11) + '" font-size="' + f1(U * .27) + '">' + RU[hb.t].e + '</text>');
        o.push('<text class="harb-t" x="' + f1(hx) + '" y="' + f1(hy + U * .19) + '" font-size="' + f1(U * .2) + '">2:1</text>');
      }
    });
    // playa y casillas
    G.hexes.forEach(function (h) { o.push('<polygon class="beach" points="' + poly(h) + '"/>'); });
    G.hexes.forEach(function (h) {
      var t = s.board.terrain[h.id], c = P(h), n = s.board.num[h.id], rob = s.board.robber === h.id;
      o.push('<polygon class="hx-poly" fill="' + TERR[t] + '" points="' + poly(h) + '"/>');
      o.push('<text class="emo" x="' + f1(c[0]) + '" y="' + f1(c[1] - U * .5) + '" font-size="' + f1(U * .36) + '">' + TEMO[t] + '</text>');
      if (n) {
        var red = n === 6 || n === 8;
        o.push('<g' + (rob ? ' class="dim"' : '') + '><circle class="tok" cx="' + f1(c[0]) + '" cy="' + f1(c[1] + U * .08) + '" r="' + f1(U * .36) + '"/>');
        o.push('<text class="tok-n' + (red ? ' red' : '') + '" x="' + f1(c[0]) + '" y="' + f1(c[1] + U * .02) + '" font-size="' + f1(U * (red ? .34 : .3)) + '">' + n + '</text>');
        var pips = HX.PIPS[n];
        for (i = 0; i < pips; i++) o.push('<circle class="pip' + (red ? ' red' : '') + '" cx="' + f1(c[0] + (i - (pips - 1) / 2) * U * .085) + '" cy="' + f1(c[1] + U * .28) + '" r="' + f1(U * .028) + '"/>');
        o.push('</g>');
      }
    });
    // caminos
    var fx = s.fx || {};
    Object.keys(s.roads).forEach(function (e) {
      var E = G.edges[e], a = P(G.vertices[E.a]), b = P(G.vertices[E.b]), pc = col(s.players[s.roads[e]].color).c;
      var k = .2, ax = a[0] + (b[0] - a[0]) * k, ay = a[1] + (b[1] - a[1]) * k, bx = b[0] - (b[0] - a[0]) * k, by = b[1] - (b[1] - a[1]) * k;
      var isfx = fx.k === 'road' && fx.at === +e && opt.fx;
      o.push('<g' + (isfx ? ' class="fx"' : '') + '><line class="road-o" stroke-width="' + f1(U * .27) + '" x1="' + f1(ax) + '" y1="' + f1(ay) + '" x2="' + f1(bx) + '" y2="' + f1(by) + '"/>');
      o.push('<line stroke="' + pc + '" stroke-linecap="round" stroke-width="' + f1(U * .17) + '" x1="' + f1(ax) + '" y1="' + f1(ay) + '" x2="' + f1(bx) + '" y2="' + f1(by) + '"/></g>');
    });
    // bandido
    var rc = P(G.hexes[s.board.robber]), rx = rc[0] - U * .42, ry = rc[1] + U * .12;
    o.push('<g' + (fx.k === 'robber' && opt.fx ? ' class="fx"' : '') + '><path class="robber" d="M' + f1(rx - U * .17) + ',' + f1(ry + U * .3) + 'Q' + f1(rx - U * .17) + ',' + f1(ry - U * .05) + ' ' + f1(rx) + ',' + f1(ry - U * .08) +
      'Q' + f1(rx + U * .17) + ',' + f1(ry - U * .05) + ' ' + f1(rx + U * .17) + ',' + f1(ry + U * .3) + 'Z"/><circle class="robber" cx="' + f1(rx) + '" cy="' + f1(ry - U * .18) + '" r="' + f1(U * .12) + '"/></g>');
    // edificios
    Object.keys(s.bld).forEach(function (v) {
      var b = s.bld[v], p = P(G.vertices[v]), pc = col(s.players[b[0]].color).c;
      var isfx = (fx.k === 'sett' || fx.k === 'city') && fx.at === +v && opt.fx;
      o.push('<path class="bld' + (isfx ? ' fx' : '') + '" fill="' + pc + '" d="' + housePath(p[0], p[1], U * (b[1] === 2 ? .25 : .22), b[1] === 2) + '"/>');
    });
    // selección
    var sel = opt.sel;
    if (sel) {
      if (sel.kind === 'v') sel.ids.forEach(function (v) {
        var p = P(G.vertices[v]);
        if (sel.pick === v) o.push('<circle class="pk-v" cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(U * .2) + '"/>');
        else o.push('<circle class="hl-v" cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(U * .14) + '"/>');
        o.push('<circle class="t-v" data-v="' + v + '" cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(U * .42) + '"/>');
      });
      if (sel.kind === 'e') sel.ids.forEach(function (e) {
        var E = G.edges[e], a = P(G.vertices[E.a]), b = P(G.vertices[E.b]);
        var ax = a[0] + (b[0] - a[0]) * .2, ay = a[1] + (b[1] - a[1]) * .2, bx = b[0] - (b[0] - a[0]) * .2, by = b[1] - (b[1] - a[1]) * .2;
        o.push('<line class="' + (sel.pick === e ? 'pk-e' : 'hl-e') + '" stroke-width="' + f1(U * (sel.pick === e ? .22 : .14)) + '" x1="' + f1(ax) + '" y1="' + f1(ay) + '" x2="' + f1(bx) + '" y2="' + f1(by) + '"/>');
        o.push('<line class="t-e" data-e="' + e + '" stroke-width="' + f1(U * .5) + '" x1="' + f1(ax) + '" y1="' + f1(ay) + '" x2="' + f1(bx) + '" y2="' + f1(by) + '"/>');
      });
      if (sel.kind === 'h') sel.ids.forEach(function (h) {
        var H = G.hexes[h];
        o.push('<polygon class="' + (sel.pick === h ? 'pk-h' : 'hl-h') + '" points="' + poly(H) + '"/>');
        o.push('<polygon class="t-h" data-h="' + h + '" fill="rgba(0,0,0,0.001)" points="' + poly(H) + '"/>');
      });
    }
    o.push('</svg>');
    return o.join('');
  }

  /* ---------- Qué le toca hacer a cada uno ---------- */
  function taskText(s, forTv) {
    if (s.phase === 'setup') {
      var su = s.setup, p = su.order[su.i], round = su.i >= s.players.length ? 'segunda' : 'primera';
      return { p: p, t: su.v === null ? 'coloca su ' + round + ' aldea' : 'coloca un camino junto a su aldea' };
    }
    if (s.phase === 'over') return { p: s.winner, t: '¡ha ganado!' };
    var pd = s.pend;
    if (pd) {
      if (pd.type === 'discard') {
        var names = Object.keys(pd.need).map(function (k) { return s.players[k].name; });
        return { p: s.turn.p, t: '¡7! Descartan la mitad: ' + names.join(', ') };
      }
      if (pd.type === 'robber') return { p: pd.by, t: 'mueve el bandido' };
      if (pd.type === 'steal') return { p: pd.by, t: 'elige a quién robar' };
      if (pd.type === 'roads') return { p: pd.by, t: 'coloca caminos gratis (Obras)' };
    }
    if (s.special) return { p: s.special.p, t: 'fase extra: puede construir' };
    return { p: s.turn.p, t: s.turn.rolled ? 'construye y comercia' : 'tiene que tirar los dados' };
  }

  /* ---------- Pantalla de inicio ---------- */
  var LOGO = '<svg viewBox="0 0 64 64"><polygon points="32,3 57,17.5 57,46.5 32,61 7,46.5 7,17.5" fill="#e1b33b" stroke="#e8d39b" stroke-width="4"/><path d="M20,44V31L32,20L44,31V44Z" fill="#e5383b" stroke="#141414" stroke-width="2.5" stroke-linejoin="round"/><rect x="28.5" y="34" width="7" height="10" fill="#141414"/></svg>';
  function drawHome() {
    var saved = null;
    try { saved = JSON.parse(ls('hxa-host') || 'null'); } catch (e) { }
    if (saved && Date.now() - (saved.at || 0) > 36 * 3600e3) saved = null;
    var mode = ls('hxa-host-mode');
    var h = '<div class="home">';
    h += '<div class="logo">' + LOGO + '<div><h1>Hexaldea</h1><p>Construye, comercia y gana. Cada uno desde su móvil.</p></div></div>';
    if (saved && saved.state && saved.state.phase !== 'over') {
      h += '<button class="bigbtn ok" data-a="resume"><span class="ic">↩️</span><div><b>Continuar la partida ' + esc(saved.code) + '</b><span style="color:#0b3a1d">Guardada ' + ago(saved.at) + ' · ' + saved.seats.length + ' jugadores</span></div></button>';
    }
    h += '<button class="bigbtn pri" data-a="create"><span class="ic">📺</span><div><b>Crear partida</b><span>Abre esto en la tele o en el portátil: saldrá el QR para que os unáis</span></div></button>';
    h += '<div class="card col"><h2>📱 Unirme a una partida</h2><div class="row"><input id="code" class="codein" maxlength="6" placeholder="CÓDIGO" autocomplete="off" autocapitalize="characters"><button class="pri" data-a="join">Entrar</button></div><div class="mut sm-t">Lo más fácil: escanea el QR de la tele con la cámara del móvil.</div></div>';
    h += '<button class="bigbtn" data-a="watch"><span class="ic">🖥️</span><div><b>Ver una partida en otra pantalla</b><span>Solo mira el tablero (por ejemplo en una tele con Chromecast)</span></div></button>';
    h += '<button class="bigbtn" data-a="solo"><span class="ic">🤖</span><div><b>Practicar contra bots</b><span>Una partida tú solo en este dispositivo</span></div></button>';
    h += '<button class="ghost" data-a="rules">📖 Reglas en 2 minutos</button>';
    h += '</div>';
    $('#app').innerHTML = h;
    var inp = $('#code');
    if (inp) inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doJoin(); });
  }
  function doJoin(asTv) {
    var c = NET.cleanCode(($('#code') || {}).value);
    if (!NET.validCode(c)) {
      if (asTv && !c) { askCode(true); return; }
      toast('El código tiene 6 letras o números', 'err'); return;
    }
    startClient(c, !!asTv);
  }
  function askCode(asTv) {
    ui.sheet = { k: 'code', tv: asTv };
    drawSheet();
  }

  /* ---------- Sala (lobby) ---------- */
  function seatsHtml(seats, max, hostCtl) {
    var h = '';
    for (var i = 0; i < max; i++) {
      var s = seats[i];
      if (!s) { if (i < Math.max(seats.length + 1, 3)) h += '<div class="seat empty">Sitio libre</div>'; continue; }
      h += '<div class="seat" style="border-left-color:' + col(s.color).c + '"><span class="nm">' + esc(s.name) + '</span>' +
        (s.bot ? '<span class="tag">bot</span>' : '') + (!s.on ? '<span class="tag off">desconectado</span>' : '') +
        (hostCtl ? '<button class="sm ghost" data-a="kick" data-i="' + i + '" title="Quitar">✕</button>' : '') + '</div>';
    }
    return h;
  }
  function drawLobbyTv(pub, isHost) {
    var code = ctl.code, url = joinUrl(code);
    var h = '<div class="lobby"><div class="join"><div class="qrbox">' + QR.svg(url) + '</div>';
    h += '<p>Escanea con la cámara del móvil<br>o entra en <span class="url">' + esc(baseUrl().replace(/^https?:\/\//, '')) + '</span> con el código</p><div class="code">' + code + '</div></div>';
    h += '<div class="side"><div class="row">' + LOGO.replace('<svg', '<svg style="width:2.6em;height:2.6em"') + '<h1 style="margin:0">Hexaldea</h1><span class="grow"></span>' + connDot() + '</div>';
    var n = pub.seats.length;
    h += '<div class="mut">' + (n ? n + ' de ' + pub.max + ' jugadores' : 'Esperando jugadores…') + (n >= 5 ? ' · tablero grande' : '') + '</div>';
    h += seatsHtml(pub.seats, pub.max, isHost);
    if (isHost) {
      var hs = ctl.host;
      h += '<div class="ctrls"><label class="mut">Puntos para ganar</label><select id="target">';
      for (var t = 6; t <= 14; t++) h += '<option value="' + t + '"' + (t === pub.opts.target ? ' selected' : '') + '>' + t + '</option>';
      h += '</select><button class="sm" data-a="bot"' + (n >= pub.max ? ' disabled' : '') + '>+ Añadir bot</button>' +
        (hs.localKey ? '' : '<button class="sm" data-a="localjoin"' + (n >= pub.max ? ' disabled' : '') + '>🎮 Jugar también desde aquí</button>') + '</div>';
      h += '<button class="pri big" data-a="start"' + (n < 2 ? ' disabled' : '') + '>▶ Empezar partida</button>';
      if (n < 2) h += '<div class="mut sm-t">Hacen falta al menos 2 jugadores (puedes añadir bots).</div>';
      var st = ctl.transport.status();
      if (st.settled && st.up === 0) h += '<div class="note">⚠️ No consigo conectar con los servidores de la partida. Revisa la wifi de este dispositivo.</div>';
      h += '<div class="row"><button class="sm ghost" data-a="rules">📖 Reglas</button><button class="sm ghost" data-a="fs">⛶ Pantalla completa</button><button class="sm ghost" data-a="home">Salir</button></div>';
    } else h += '<div class="note">Cuando estéis todos, el anfitrión empezará la partida.</div><div class="row"><button class="sm ghost" data-a="fs">⛶ Pantalla completa</button><button class="sm ghost" data-a="home">Salir</button></div>';
    h += '</div></div>';
    $('#app').innerHTML = h;
    var sel = $('#target');
    if (sel) sel.addEventListener('change', function () { ctl.host.setTarget(+sel.value); });
  }
  function drawJoinForm(pub, c, opt) {
    opt = opt || {};
    var me = null;
    try { me = JSON.parse(ls('hxa-me') || 'null'); } catch (e) { }
    if (ui.nameDraft === null) ui.nameDraft = me && me.name || '';
    var taken = {};
    (pub && pub.seats || []).forEach(function (s, i) { if (i !== opt.selfSeat) taken[s.color] = 1; });
    if (ui.colorDraft === null || taken[ui.colorDraft]) {
      ui.colorDraft = me && me.color !== undefined && !taken[me.color] ? me.color : 0;
      while (taken[ui.colorDraft] && ui.colorDraft < 5) ui.colorDraft++;
    }
    var h = '<div class="home"><div class="logo">' + LOGO + '<div><h1>Hexaldea</h1><p>Sala ' + ctl.code + ' ' + connDot() + '</p></div></div>';
    if (c.rej === 'started') {
      h += '<div class="card col"><h2>La partida ya ha empezado</h2><p class="mut">Si eras jugador, abre el enlace desde tu móvil de siempre. Si has cambiado de móvil, pide al anfitrión que te enseñe tu QR de recuperación (Opciones en la tele).</p><button data-a="watchthis">🖥️ Mirar la partida</button><button class="ghost" data-a="home">Volver</button></div></div>';
    } else if (c.rej === 'full') {
      h += '<div class="card col"><h2>La sala está llena</h2><p class="mut">Ya hay 6 jugadores.</p><button data-a="watchthis">🖥️ Mirar la partida</button><button class="ghost" data-a="home">Volver</button></div></div>';
    } else {
      if (c.rej === 'kicked') h += '<div class="note">El anfitrión te ha quitado de la sala. Puedes volver a entrar.</div>';
      h += '<div class="card col"><h2>¿Cómo te llamas?</h2><input id="nm" maxlength="14" placeholder="Tu nombre" value="' + esc(ui.nameDraft) + '" autocomplete="nickname">';
      h += '<div class="sec">Tu color</div><div class="colors">';
      PCOL.forEach(function (p, i) { h += '<button style="background:' + p.c + '" class="' + (i === ui.colorDraft ? 'on' : '') + (taken[i] ? ' taken' : '') + '" data-a="color" data-i="' + i + '"' + (taken[i] ? ' disabled' : '') + ' title="' + p.n + '"></button>'; });
      h += '</div><button class="pri big" data-a="enter"' + (c.wantJoin ? ' disabled' : '') + '>' + (c.wantJoin ? '<span class="spin"></span> Entrando…' : 'Entrar en la sala') + '</button></div>';
      h += '<button class="ghost" data-a="' + (opt.cancel || 'home') + '">' + (opt.cancel === 'canceledit' ? 'Cancelar' : 'Volver') + '</button></div>';
    }
    var had = document.activeElement && document.activeElement.id === 'nm';
    $('#app').innerHTML = h;
    var inp = $('#nm');
    if (inp) {
      inp.addEventListener('input', function () { ui.nameDraft = inp.value; });
      inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') enterRoom(); });
      if (had) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  }
  function enterRoom() {
    var name = (ui.nameDraft || '').trim();
    if (!name) { toast('Escribe tu nombre', 'err'); return; }
    ls('hxa-me', JSON.stringify({ name: name, color: ui.colorDraft }));
    if (ctl.host) { ctl.host.localJoin(name, ui.colorDraft); ui.sheet = null; render(); return; }
    ctl.client.join(name, ui.colorDraft);
    if (ui.sheet && ui.sheet.k === 'edit') ui.sheet = null;
    keepAwake();
    render();
  }
  function drawWaitingRoom(pub, c) {
    var h = '<div class="home"><div class="logo">' + LOGO + '<div><h1>Hexaldea</h1><p>Sala ' + ctl.code + ' ' + connDot() + '</p></div></div>';
    h += '<div class="card col"><h2>¡Dentro! 🎉</h2><p class="mut">Espera a que el anfitrión empiece la partida. Mira la tele.</p>' + seatsHtml(pub.seats, pub.max, false) + '</div>';
    h += '<div class="row"><button class="grow" data-a="editme">Cambiar nombre o color</button><button class="ghost" data-a="leave">Salir de la sala</button></div>';
    h += '<button class="ghost" data-a="rules">📖 Reglas en 2 minutos</button></div>';
    $('#app').innerHTML = h;
  }
  function drawConnecting() {
    var waited = ctl.started ? Date.now() - ctl.started : 0, st = ctl.transport.status();
    var h = '<div class="home"><div class="logo">' + LOGO + '<div><h1>Hexaldea</h1><p>Sala ' + esc(ctl.code) + '</p></div></div><div class="card col center">';
    h += '<p class="big"><span class="spin"></span> ' + (st.up ? 'Buscando la partida…' : 'Conectando…') + '</p>';
    if (waited > 12000) {
      h += st.up ? '<p class="mut">No encuentro la sala ' + esc(ctl.code) + '. Comprueba el código y que la pantalla del anfitrión siga abierta.</p>'
        : '<p class="mut">No consigo conectar. Revisa que el móvil tenga internet (wifi o datos).</p>';
    }
    h += '<button class="ghost" data-a="home">Volver</button></div></div>';
    $('#app').innerHTML = h;
  }

  /* ---------- Vista de jugador ---------- */
  function drawPlayer(pc) {
    var s = HX.mergeView(pc.pub, pc.priv), me = pc.me, mine = s.players[me], T = s.turn;
    var w = HX.whoActs(s), task = taskText(s), myTask = w.who.indexOf(me) >= 0, i;
    // avisos privados y de turno
    if (s.plog && s.plog.length) {
      var lastN = s.plog[s.plog.length - 1].n;
      if (ui.lastPlog && lastN > ui.lastPlog) s.plog.forEach(function (x) { if (x.n > ui.lastPlog) toast(x.m, 'good'); });
      ui.lastPlog = lastN;
    }
    if (myTask && !ui.myTurn) buzz(120);
    ui.myTurn = myTask;
    var tradeOk = s.phase === 'main' && T.rolled && !s.pend && !s.special;
    var myMain = s.phase === 'main' && T.p === me && !s.pend && !s.special && T.rolled;
    var mySpecial = s.special && s.special.p === me && !s.pend;
    // --- modo del tablero ---
    var sel = null, forced = null;
    if (s.phase === 'setup' && myTask) {
      if (w.what === 'setupS') forced = { kind: 'v', ids: HX.legalSettlements(s, me, true), a: 'sett', label: 'Colocar aldea aquí' };
      else forced = { kind: 'e', ids: HX.setupRoads(s), a: 'road', label: 'Colocar camino aquí' };
    } else if (s.pend && s.pend.by === me && s.pend.type === 'robber') {
      var hs = [];
      for (i = 0; i < HX.geo(s.board.kind).hexes.length; i++) if (i !== s.board.robber) hs.push(i);
      forced = { kind: 'h', ids: hs, a: 'robber', label: 'Mover el bandido aquí' };
    } else if (s.pend && s.pend.by === me && s.pend.type === 'roads') {
      forced = { kind: 'e', ids: HX.legalRoads(s, me), a: 'road', label: 'Camino gratis aquí' };
    }
    if (forced) { if (ui.mode !== 'f-' + forced.a) { ui.mode = 'f-' + forced.a; ui.pick = null; } sel = forced; }
    else if (ui.mode && ui.mode.indexOf('f-') === 0) { ui.mode = null; ui.pick = null; }
    if (!forced && ui.mode && (myMain || mySpecial)) {
      if (ui.mode === 'road') sel = { kind: 'e', ids: HX.legalRoads(s, me), a: 'road', label: 'Construir camino aquí' };
      if (ui.mode === 'sett') sel = { kind: 'v', ids: HX.legalSettlements(s, me, false), a: 'sett', label: 'Construir aldea aquí' };
      if (ui.mode === 'city') sel = { kind: 'v', ids: HX.legalCities(s, me), a: 'city', label: 'Mejorar a ciudad' };
    } else if (!forced) { ui.mode = null; }
    if (sel) {
      if (ui.pick !== null && sel.ids.indexOf(ui.pick) < 0) ui.pick = null;
      sel.pick = ui.pick;
      ui.sel = sel;
    } else { ui.sel = null; ui.pick = null; }
    // --- cabecera ---
    var h = '<div class="pv"><div class="top">' + connDot() + '<span class="code">' + esc(ctl.code) + '</span><div class="minis">';
    s.players.forEach(function (pl, k) {
      var on = !pc.pub.on || pc.pub.on[k];
      h += '<div class="mini' + (k === task.p ? ' cur' : '') + '" data-a="sheet" data-s="players"><span class="sw" style="background:' + col(pl.color).c + '"></span>' +
        esc(k === me ? 'Tú' : pl.name) + ' <b>' + (k === me ? HX.vpTotal(s, me) : pl.vp) + '</b>' + (on ? '' : ' 💤') + '</div>';
    });
    h += '</div>' + (pc.local ? '<button class="iconbtn" data-a="tvview" title="Vista de tele">📺</button>' : '') + '<button class="iconbtn" data-a="sheet" data-s="menu">☰</button></div>';
    // --- banner ---
    var dice = T.dice && s.phase === 'main' ? '<span class="dice">' + DICE[T.dice[0]] + DICE[T.dice[1]] + '</span>' : '';
    var bn;
    if (s.phase === 'setup') bn = myTask ? (w.what === 'setupS' ? '📍 Toca un punto brillante para colocar tu ' + (s.setup.i >= s.players.length ? 'segunda' : 'primera') + ' aldea' : '📍 Ahora coloca un camino junto a tu aldea') : esc(s.players[task.p].name) + ' ' + task.t;
    else if (s.phase === 'over') bn = '🏆 ' + esc(s.players[s.winner].name) + ' ha ganado';
    else if (s.pend && s.pend.type === 'discard') bn = s.pend.need[me] ? '🎴 ¡Ha salido un 7! Descarta ' + s.pend.need[me] + ' cartas' : '⏳ Esperando a que descarten: ' + Object.keys(s.pend.need).map(function (k) { return esc(s.players[k].name); }).join(', ');
    else if (s.pend && s.pend.by === me) bn = s.pend.type === 'robber' ? '🦹 Toca una casilla para mover el bandido' : s.pend.type === 'steal' ? '🦹 Elige a quién robar' : '🛠️ Coloca ' + s.pend.n + ' camino' + (s.pend.n > 1 ? 's' : '') + ' gratis';
    else if (mySpecial) bn = '🔨 Fase extra: puedes construir o comprar (sin comerciar)';
    else if (T.p === me && !s.special && !s.pend) bn = T.rolled ? '✅ Tu turno: construye, comercia o termina' : '🎲 ¡Tu turno! Tira los dados';
    else bn = esc(s.players[task.p].name) + ' ' + task.t;
    h += '<div class="banner' + (myTask ? ' me' : '') + '">' + dice + '<span>' + bn + '</span></div>';
    // --- tablero ---
    h += '<div class="boardwrap sea"><div class="board' + (ui.zoom ? ' zoom' : '') + '" id="bd">' + boardSvg(s, { sel: sel, fx: true }) + '</div><button class="zoombtn" data-a="zoom">' + (ui.zoom ? '🔍−' : '🔍+') + '</button></div>';
    // --- ofertas que me afectan ---
    var offH = offersHtml(s, me, true);
    if (offH) h += '<div class="offers">' + offH + '</div>';
    // --- mano ---
    h += '<div class="hand">';
    HX.RES.forEach(function (r) { h += '<div class="rc' + (mine.res[r] ? '' : ' zero') + '"><span class="e">' + RU[r].e + '</span><span class="n">' + mine.res[r] + '</span></div>'; });
    var playableN = (mine.devCards || []).filter(function (c) { return c.ok; }).length;
    h += '<div class="rc dev" data-a="sheet" data-s="cards" style="cursor:pointer"><span class="e">📜</span><span class="n">' + mine.devCards.length + '</span>' + (playableN && T.p === me && !T.devUsed && s.phase === 'main' ? '<span class="badge">!</span>' : '') + '</div>';
    h += '</div>';
    // --- acciones ---
    h += '<div class="actions">' + actionsHtml(s, me, pc, sel, myMain, mySpecial, tradeOk) + '</div></div>';
    $('#app').innerHTML = h;
    // hojas obligatorias
    if (s.pend && s.pend.type === 'discard' && s.pend.need[me]) { if (!ui.sheet || ui.sheet.k !== 'discard') { ui.sheet = { k: 'discard' }; ui.disc = {}; } }
    else if (s.pend && s.pend.type === 'steal' && s.pend.by === me) { if (!ui.sheet || ui.sheet.k !== 'steal') ui.sheet = { k: 'steal' }; }
    else if (ui.sheet && (ui.sheet.k === 'discard' || ui.sheet.k === 'steal')) ui.sheet = null;
    ui.s = s; ui.pc = pc;
    drawSheet();
    if (s.phase === 'over') drawOver(pc.pub, !!ctl.host);
  }
  function actionsHtml(s, me, pc, sel, myMain, mySpecial, tradeOk) {
    var T = s.turn, mine = s.players[me], h = '', dis = pc.busy ? ' disabled' : '';
    if (s.phase === 'over') return '<button class="full" data-a="sheet" data-s="players">Ver puntuaciones</button>';
    if (sel) {
      var lab = sel.ids.length ? (ui.pick === null ? 'Toca un sitio iluminado' : sel.label) : 'No hay sitios disponibles';
      h += '<button class="ok full" data-a="confirm"' + (ui.pick === null || pc.busy ? ' disabled' : '') + '>' + (pc.busy ? '<span class="spin"></span> ' : '') + lab + '</button>';
      if (ui.mode && ui.mode.indexOf('f-') !== 0) h += '<button class="full ghost" data-a="cancelmode">Cancelar</button>';
      return h;
    }
    if (s.phase !== 'main') return '<button class="full" disabled>Esperando…</button>';
    if (s.pend) {
      if (s.pend.type === 'discard' && s.pend.need[me]) return '<button class="pri full" data-a="sheet" data-s="discard">Elegir cartas para descartar</button>';
      if (s.pend.type === 'steal' && s.pend.by === me) return '<button class="pri full" data-a="sheet" data-s="steal">Elegir a quién robar</button>';
      return '<button class="full" data-a="sheet" data-s="players">Esperando… · Ver jugadores</button>';
    }
    if (T.p === me && !s.special && !T.rolled) {
      var canPlay = !T.devUsed && (mine.devCards || []).some(function (c) { return c.ok; });
      h += '<button class="pri" style="flex-basis:60%" data-a="roll"' + dis + '>🎲 Tirar dados</button>';
      h += '<button data-a="sheet" data-s="cards"' + (canPlay ? '' : ' disabled') + '>📜 Jugar carta</button>';
      return h;
    }
    if (myMain || mySpecial) {
      var C = HX.COST;
      var canRoad = HX.hasRes(mine.res, C.road) && mine.left.road > 0 && HX.legalRoads(s, me).length > 0;
      var canSett = HX.hasRes(mine.res, C.sett) && mine.left.sett > 0 && HX.legalSettlements(s, me, false).length > 0;
      var canCity = HX.hasRes(mine.res, C.city) && mine.left.city > 0 && HX.legalCities(s, me).length > 0;
      var canBuy = HX.hasRes(mine.res, C.dev) && s.deckN > 0;
      h += '<button data-a="mode" data-m="road"' + (canRoad && !pc.busy ? '' : ' disabled') + '>Camino<span class="bcost">' + costHtml(C.road) + '</span></button>';
      h += '<button data-a="mode" data-m="sett"' + (canSett && !pc.busy ? '' : ' disabled') + '>Aldea<span class="bcost">' + costHtml(C.sett) + '</span></button>';
      h += '<button data-a="mode" data-m="city"' + (canCity && !pc.busy ? '' : ' disabled') + '>Ciudad<span class="bcost">' + costHtml(C.city) + '</span></button>';
      h += '<button data-a="buy"' + (canBuy && !pc.busy ? '' : ' disabled') + '>Carta<span class="bcost">' + costHtml(C.dev) + '</span></button>';
      if (myMain) {
        h += '<button data-a="sheet" data-s="trade">🤝 Comerciar</button>';
        h += '<button class="pri" data-a="end"' + dis + '>Terminar turno</button>';
      } else h += '<button class="pri" style="flex-basis:60%" data-a="pass"' + dis + '>Pasar</button>';
      return h;
    }
    // no es mi turno
    h += '<button data-a="sheet" data-s="trade"' + (tradeOk ? '' : ' disabled') + '>🤝 Proponer cambio</button>';
    h += '<button data-a="sheet" data-s="players">👥 Jugadores</button>';
    return h;
  }
  function offersHtml(s, me, compact) {
    if (s.phase !== 'main' || !s.trades || !s.trades.length) return '';
    var T = s.turn, h = '';
    s.trades.forEach(function (t) {
      var from = s.players[t.from], txt;
      if (t.from === me) {
        if (compact && T.p !== me) {
          h += '<div class="offer"><span class="what">Tu oferta: das ' + resLine(t.give) + ' por ' + resLine(t.want) + '</span><button class="sm ghost" data-a="cancel" data-id="' + t.id + '">Retirar</button></div>';
          return;
        }
        var acc = Object.keys(t.resp).filter(function (k) { return t.resp[k] === 1; });
        var rej = Object.keys(t.resp).filter(function (k) { return t.resp[k] === -1; });
        txt = '<span class="what">Ofreces ' + resLine(t.give) + ' por ' + resLine(t.want) + (rej.length && compact ? ' <span class="mut sm-t">· ' + rej.length + ' no</span>' : '') + '</span>';
        acc.forEach(function (k) { txt += '<button class="sm ok" data-a="confirmtrade" data-id="' + t.id + '" data-w="' + k + '">✓ ' + esc(s.players[k].name) + '</button>'; });
        if (!acc.length) txt += '<span class="mut sm-t">esperando…</span>';
        h += '<div class="offer">' + txt + '<button class="sm ghost" data-a="cancel" data-id="' + t.id + '">✕</button></div>';
        return;
      }
      // ofertas de otros
      var mineResp = t.resp[me];
      var canAfford = HX.hasRes(s.players[me].res, t.want);
      if (t.from === T.p) {
        txt = '<span class="what">' + sw(from.color) + ' ' + esc(from.name) + ' da ' + resLine(t.give) + ' y pide ' + resLine(t.want) + '</span>';
        if (mineResp === 1) txt += '<span class="mut sm-t">Aceptada ✓</span><button class="sm ghost" data-a="respond" data-id="' + t.id + '" data-ok="0">✕</button>';
        else if (mineResp === -1) { if (compact) return; txt += '<span class="mut sm-t">Rechazada</span>'; }
        else txt += '<button class="sm ok" data-a="respond" data-id="' + t.id + '" data-ok="1"' + (canAfford ? '' : ' disabled') + '>Aceptar</button><button class="sm bad" data-a="respond" data-id="' + t.id + '" data-ok="0">No</button>';
        h += '<div class="offer">' + txt + '</div>';
      } else if (T.p === me) {
        txt = '<span class="what">' + sw(from.color) + ' ' + esc(from.name) + ' te da ' + resLine(t.give) + ' por ' + resLine(t.want) + '</span>';
        txt += '<button class="sm ok" data-a="respond" data-id="' + t.id + '" data-ok="1"' + (canAfford ? '' : ' disabled') + '>Cambiar</button><button class="sm bad" data-a="respond" data-id="' + t.id + '" data-ok="0">No</button>';
        h += '<div class="offer">' + txt + '</div>';
      } else if (!compact) {
        h += '<div class="offer"><span class="what">' + sw(from.color) + ' ' + esc(from.name) + ' propone a ' + esc(s.players[T.p].name) + ': ' + resLine(t.give) + ' por ' + resLine(t.want) + '</span></div>';
      }
    });
    return h;
  }

  /* ---------- Hojas (paneles que suben desde abajo) ---------- */
  function closeSheet() { ui.sheet = null; drawSheet(); }
  function stepper(kind, r, val, hint, canMinus, canPlus) {
    return '<div class="step"><span class="e">' + RU[r].e + '</span><span class="v">' + val + '</span>' + (hint !== '' ? '<span class="h">' + hint + '</span>' : '') +
      '<div class="bt"><button data-a="st" data-k="' + kind + '" data-r="' + r + '" data-d="-1"' + (canMinus ? '' : ' disabled') + '>−</button><button data-a="st" data-k="' + kind + '" data-r="' + r + '" data-d="1"' + (canPlus ? '' : ' disabled') + '>+</button></div></div>';
  }
  function drawSheet() {
    var old = $('#sheet');
    if (old) old.parentNode.removeChild(old);
    var sh = ui.sheet;
    if (!sh || sh.k === 'edit' || sh.k === 'localjoin' || sh.k === 'tvopts' || sh.k === 'qr') return;
    var h = '', s = ui.s, me = ui.pc ? ui.pc.me : -1, busy = ui.pc && ui.pc.busy, mine = s && me >= 0 ? s.players[me] : null, forcedSheet = sh.k === 'discard' || sh.k === 'steal';
    var x = forcedSheet ? '' : '<button class="sm ghost x" data-a="close">✕</button>';
    if (sh.k === 'code') {
      h += '<h2>' + (sh.tv ? '🖥️ Ver una partida' : '📱 Unirme') + x + '</h2><p class="mut">Escribe el código de 6 letras que sale en la pantalla del anfitrión.</p>';
      h += '<div class="row"><input id="code2" class="codein" maxlength="6" placeholder="CÓDIGO" autocomplete="off" autocapitalize="characters"><button class="pri" data-a="code2">Ver</button></div>';
    } else if (sh.k === 'rules') h += '<h2>📖 Reglas en 2 minutos' + x + '</h2>' + RULES;
    else if (sh.k === 'menu') {
      h += '<h2>Menú' + x + '</h2><div class="col">';
      h += '<button data-a="sheet" data-s="players">👥 Jugadores y puntos</button><button data-a="sheet" data-s="log">📋 Qué ha pasado</button><button data-a="sheet" data-s="rules">📖 Reglas</button><button data-a="sheet" data-s="costs">🧾 Costes de construcción</button><button data-a="fs">⛶ Pantalla completa</button>';
      h += '<button class="ghost" data-a="home">Salir al inicio</button>';
      if (!ctl.host) h += '<p class="mut sm-t">Si sales o se cierra la página, vuelve a abrir el enlace o escanea el QR: recuperas tu sitio y tus cartas.</p>';
      h += '</div>';
    } else if (sh.k === 'costs') {
      h += '<h2>🧾 Costes' + x + '</h2>';
      [['Camino', 'road', '0 puntos. Une tus construcciones.'], ['Aldea', 'sett', '1 punto. Produce 1 recurso.'], ['Ciudad', 'city', '2 puntos. Sustituye a una aldea; produce 2.'], ['Carta de progreso', 'dev', 'Efectos especiales o 1 punto oculto.']].forEach(function (c) {
        h += '<div class="devc"><span class="e">' + costHtml(HX.COST[c[1]]) + '</span><div class="d"><b>' + c[0] + '</b>' + c[2] + '</div></div>';
      });
    } else if (sh.k === 'players') {
      h += '<h2>👥 Jugadores' + x + '</h2>' + playersHtml(s, me, ui.pc.pub);
    } else if (sh.k === 'log') {
      h += '<h2>📋 Qué ha pasado' + x + '</h2>';
      if (s.plog && s.plog.length) { h += '<div class="sec">Solo para ti</div><div class="loglist">'; s.plog.slice().reverse().forEach(function (l) { h += '<div>🔒 ' + esc(l.m) + '</div>'; }); h += '</div>'; }
      h += '<div class="sec">Partida</div><div class="loglist">' + logHtml(s, 40, true) + '</div>';
    } else if (sh.k === 'discard') {
      var need = s.pend && s.pend.need ? s.pend.need[me] : 0, tot = HX.total(ui.disc);
      h += '<h2>🎴 Descarta ' + need + ' cartas</h2><p class="mut">Ha salido un 7 y tienes más de 7 cartas. Elige cuáles devuelves a la banca.</p><div class="steps">';
      HX.RES.forEach(function (r) { var v = ui.disc[r] || 0; h += stepper('disc', r, v, 'de ' + mine.res[r], v > 0, v < mine.res[r] && tot < need); });
      h += '</div><p class="center big">' + tot + ' / ' + need + '</p><button class="pri full" style="width:100%" data-a="discard"' + (tot === need && !busy ? '' : ' disabled') + '>Descartar</button>';
    } else if (sh.k === 'steal') {
      h += '<h2>🦹 ¿A quién robas?</h2><p class="mut">Te llevas una carta al azar.</p>';
      (s.pend.from || []).forEach(function (k) {
        var pl = s.players[k];
        h += '<button class="prow" style="width:100%;border-left-color:' + col(pl.color).c + '" data-a="steal" data-i="' + k + '"' + (busy ? ' disabled' : '') + '><span class="nm">' + esc(pl.name) + '</span><span class="mut">' + pl.nRes + ' cartas</span></button>';
      });
    } else if (sh.k === 'cards') {
      var T = s.turn, canPlayNow = s.phase === 'main' && T.p === me && !T.devUsed && !s.pend && !s.special;
      h += '<h2>📜 Tus cartas de progreso' + x + '</h2>';
      if (!mine.devCards.length) h += '<p class="mut">No tienes cartas. Se compran con ' + costHtml(HX.COST.dev) + '.</p>';
      if (T.p === me && T.devUsed) h += '<div class="note">Ya has jugado una carta este turno.</div>';
      var shown = {};
      mine.devCards.forEach(function (c) {
        var key = c.k + (c.ok ? '1' : '0');
        shown[key] = (shown[key] || 0) + 1;
      });
      Object.keys(shown).sort().forEach(function (key) {
        var k = key[0], ok = key[1] === '1', d = DEV[k], n = shown[key];
        h += '<div class="devc"><span class="e">' + d.e + '</span><div class="d"><b>' + d.n + (n > 1 ? ' ×' + n : '') + '</b>' + d.d + (k !== 'V' && !ok ? '<br><span class="mut">Comprada este turno: podrás jugarla en el siguiente.</span>' : '') + '</div>';
        if (k !== 'V') h += '<button class="sm pri" data-a="playcard" data-k="' + k + '"' + (ok && canPlayNow && !busy ? '' : ' disabled') + '>Jugar</button>';
        h += '</div>';
      });
      if (sh.pick === 'P') {
        h += '<div class="sec">Abundancia: elige 2 recursos</div><div class="pickres">';
        HX.RES.forEach(function (r) { var c = ui.p2.filter(function (z) { return z === r; }).length; h += '<button data-a="p2" data-r="' + r + '" class="' + (c ? 'on' : '') + '"><span class="e">' + RU[r].e + '</span>' + (c ? '×' + c : RU[r].n) + '</button>'; });
        h += '</div><div class="row" style="margin-top:8px"><button class="ghost" data-a="p2clear">Borrar</button><button class="pri grow" data-a="playP"' + (ui.p2.length === 2 && !busy ? '' : ' disabled') + '>Coger ' + ui.p2.map(function (r) { return RU[r].e; }).join(' ') + '</button></div>';
      }
      if (sh.pick === 'M') {
        h += '<div class="sec">Acaparador: elige un recurso</div><div class="pickres">';
        HX.RES.forEach(function (r) { h += '<button data-a="m1" data-r="' + r + '" class="' + (ui.m1 === r ? 'on' : '') + '"><span class="e">' + RU[r].e + '</span>' + RU[r].n + '</button>'; });
        h += '</div><button class="pri" style="width:100%;margin-top:8px" data-a="playM"' + (ui.m1 && !busy ? '' : ' disabled') + '>Llevarme todo el ' + (ui.m1 ? RU[ui.m1].n.toLowerCase() : '…') + '</button>';
      }
    } else if (sh.k === 'trade') {
      h += tradeSheet(s, me, busy, x);
    }
    var el = document.createElement('div');
    el.id = 'sheet'; el.className = 'shade';
    el.innerHTML = '<div class="sheet">' + h + '</div>';
    if (!forcedSheet) el.addEventListener('click', function (ev) { if (ev.target === el) closeSheet(); });
    document.body.appendChild(el);
    var c2 = $('#code2');
    if (c2) { c2.focus(); c2.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') onAction('code2'); }); }
  }
  function tradeSheet(s, me, busy, x) {
    var T = s.turn, mine = s.players[me], h = '<h2>🤝 Comerciar' + x + '</h2>';
    var open = s.phase === 'main' && T.rolled && !s.pend && !s.special;
    if (!open) return h + '<p class="mut">Ahora no se puede comerciar.</p>';
    var offers = offersHtml(s, me, false);
    if (offers) h += '<div class="sec">Ofertas</div><div class="offers" style="padding:0;background:none">' + offers + '</div>';
    if (T.p === me) {
      var rt = HX.ratios(s, me);
      h += '<div class="sec">Con la banca</div><div class="mut sm-t" style="margin-bottom:6px">Das varias iguales y recibes 1 de lo que quieras. Los puertos mejoran el cambio.</div><div class="pickres">';
      HX.RES.forEach(function (r) { var ok = mine.res[r] >= rt[r]; h += '<button data-a="bg" data-r="' + r + '" class="' + (ui.bg === r ? 'on' : '') + '"' + (ok ? '' : ' disabled') + '><span class="e">' + RU[r].e + '</span>Das ' + rt[r] + '</button>'; });
      h += '</div><div class="pickres" style="margin-top:6px">';
      HX.RES.forEach(function (r) { h += '<button data-a="bt" data-r="' + r + '" class="' + (ui.bt === r ? 'on' : '') + '"' + (r === ui.bg || !s.bank[r] ? ' disabled' : '') + '><span class="e">' + RU[r].e + '</span>Recibes 1</button>'; });
      h += '</div><button class="pri" style="width:100%;margin-top:8px" data-a="bank"' + (ui.bg && ui.bt && ui.bg !== ui.bt && !busy && mine.res[ui.bg] >= rt[ui.bg] ? '' : ' disabled') + '>Cambiar con la banca</button>';
    }
    h += '<div class="sec">' + (T.p === me ? 'Con los demás jugadores' : 'Proponer a ' + esc(s.players[T.p].name)) + '</div><div class="mut sm-t" style="margin-bottom:4px">Das</div><div class="steps">';
    HX.RES.forEach(function (r) { var v = ui.give[r] || 0; h += stepper('give', r, v, 'tienes ' + mine.res[r], v > 0, v < mine.res[r] && !ui.want[r]); });
    h += '</div><div class="mut sm-t" style="margin:8px 0 4px">Pides</div><div class="steps">';
    HX.RES.forEach(function (r) { var v = ui.want[r] || 0; h += stepper('want', r, v, '', v > 0, v < 9 && !ui.give[r]); });
    h += '</div><button class="pri" style="width:100%;margin-top:10px" data-a="offer"' + (HX.total(ui.give) && HX.total(ui.want) && !busy ? '' : ' disabled') + '>Enviar oferta</button>';
    return h;
  }
  function playersHtml(s, me, pub) {
    var h = '', task = taskText(s);
    s.players.forEach(function (pl, k) {
      var on = !pub.on || pub.on[k];
      var vp = s.phase === 'over' ? pl.vpAll : (k === me ? HX.vpTotal(s, me) : pl.vp);
      h += '<div class="prow" style="border-left-color:' + col(pl.color).c + '"><div class="grow"><div class="nm">' + esc(pl.name) + (k === me ? ' (tú)' : '') + (k === task.p && s.phase !== 'over' ? ' 👈' : '') +
        (pl.bot ? ' <span class="tag">bot</span>' : '') + (pub.auto && pub.auto[k] ? ' <span class="tag">bot jugando</span>' : '') + (!on ? ' <span class="tag off">desconectado</span>' : '') + '</div>';
      h += '<div class="stats"><span>🃏 ' + pl.nRes + '</span><span>📜 ' + pl.nDev + '</span><span>🛡️ ' + pl.played.K + '</span><span>🛤️ ' + pl.roadLen + '</span>';
      if (s.awards.road === k) h += '<span class="tag gold">Ruta más larga +2</span>';
      if (s.awards.army === k) h += '<span class="tag gold">Guardia más numerosa +2</span>';
      h += '</div></div><span class="vp">' + vp + '</span></div>';
    });
    h += '<p class="mut sm-t">Se gana con ' + s.opts.target + ' puntos en tu turno. 🃏 cartas de recurso · 📜 cartas de progreso · 🛡️ guardias jugadas · 🛤️ ruta más larga. Los puntos de los demás no incluyen sus Monumentos ocultos.</p>';
    return h;
  }
  function logHtml(s, n, newestFirst) {
    var l = s.log.slice(-n);
    if (newestFirst) l.reverse();
    return l.map(function (e) {
      var who = e.p >= 0 ? sw(s.players[e.p].color) + '<b>' + esc(s.players[e.p].name) + '</b> ' : '<span class="sw" style="background:#555"></span>';
      return '<div>' + who + '<span>' + esc(e.m) + '</span></div>';
    }).join('');
  }

  /* ---------- Vista de tele ---------- */
  function drawTv(pub, isHost) {
    var s = HX.mergeView(pub, null), T = s.turn, task = taskText(s, true), cur = s.players[task.p];
    var h = '<div class="tv"><div class="tvboard sea"><div class="board">' + boardSvg(s, { fx: true }) + '</div></div><aside>';
    h += '<div class="tvhead">' + LOGO.replace('<svg', '<svg style="width:1.8em;height:1.8em"') + '<span class="ttl">Hexaldea</span>' + connDot() + '<span class="code">' + esc(ctl.code) + '</span></div>';
    var dice = T.dice && s.phase === 'main' ? '<span class="dice' + (T.dice[0] + T.dice[1] === 7 ? ' seven' : '') + '">' + DICE[T.dice[0]] + DICE[T.dice[1]] + '</span>' : '';
    h += '<div class="tvturn"><span class="sw" style="width:1.4em;height:1.4em;background:' + col(cur.color).c + '"></span><div><div class="who">' + esc(cur.name) + '</div><div class="task">' + esc(task.t) + '</div></div>' + dice + '</div>';
    h += '<div class="tvplayers">';
    s.players.forEach(function (pl, k) {
      var on = !pub.on || pub.on[k];
      h += '<div class="tvp' + (k === task.p ? ' cur' : '') + '" style="border-left-color:' + col(pl.color).c + '"><div><div class="nm">' + esc(pl.name) +
        (pl.bot ? ' <span class="tag">bot</span>' : '') + (pub.auto && pub.auto[k] ? ' <span class="tag">bot jugando</span>' : '') + (!on ? ' <span class="tag off">desconectado</span>' : '') + '</div>';
      h += '<div class="stats"><span>🃏 ' + pl.nRes + '</span><span>📜 ' + pl.nDev + '</span><span>🛡️ ' + pl.played.K + '</span><span>🛤️ ' + pl.roadLen + '</span>' +
        (s.awards.road === k ? '<span class="tag gold">Ruta +2</span>' : '') + (s.awards.army === k ? '<span class="tag gold">Guardia +2</span>' : '') + '</div></div><span class="vp">' + pl.vp + '</span></div>';
    });
    h += '</div>';
    if (s.trades && s.trades.length) {
      h += '<div class="tvlog" style="flex:none;border-top:1px solid var(--line)">';
      s.trades.forEach(function (t) { h += '<div>🤝 ' + sw(s.players[t.from].color) + '<b>' + esc(s.players[t.from].name) + '</b> da ' + resLine(t.give) + ' por ' + resLine(t.want) + '</div>'; });
      h += '</div>';
    }
    h += '<div class="tvlog">' + logHtml(s, 9, false) + '</div>';
    h += '<div class="bankrow"><span>Banca:</span>' + HX.RES.map(function (r) { return '<span>' + RU[r].e + ' ' + s.bank[r] + '</span>'; }).join('') + '<span>📜 ' + s.deckN + '</span><span>Meta: ' + s.opts.target + ' puntos</span></div>';
    h += '<div class="tvfoot">' + (isHost ? '<button data-a="tvopts">⚙ Opciones</button>' : '') + (isHost && ctl.host.localKey ? '<button data-a="tvview">🎮 Mi mano</button>' : '') +
      '<button data-a="showqr">📱 QR</button><button data-a="fs">⛶</button><button data-a="rules">📖</button>' + (isHost ? '' : '<button data-a="home">Salir</button>') + '</div>';
    h += '</aside></div>';
    $('#app').innerHTML = h;
    ui.s = s; ui.pc = { me: -1, pub: pub, busy: false };
    if (ui.sheet && ui.sheet.k === 'tvopts') drawTvOpts();
    else if (ui.sheet && ui.sheet.k === 'qr') drawQrSheet();
    else drawSheet();
    if (s.phase === 'over') drawOver(pub, isHost);
  }
  function drawTvOpts() {
    var old = $('#sheet'); if (old) old.parentNode.removeChild(old);
    var hst = ctl.host, s = ui.s, pub = ui.pc.pub;
    var h = '<h2>⚙ Opciones del anfitrión<button class="sm ghost x" data-a="close">✕</button></h2>';
    h += '<p class="mut sm-t">Si a alguien se le acaba la batería puedes dejar que un bot juegue por él, o darle un QR para seguir desde otro móvil.</p>';
    s.players.forEach(function (pl, k) {
      var seat = hst.seat(hst.state.players[k].key);
      if (!seat || seat.bot) return;
      h += '<div class="prow" style="border-left-color:' + col(pl.color).c + '"><span class="nm">' + esc(pl.name) + (!pub.on || pub.on[k] ? '' : ' <span class="tag off">desconectado</span>') + '</span>';
      h += '<button class="sm' + (seat.auto ? ' ok' : '') + '" data-a="auto" data-i="' + k + '">' + (seat.auto ? '🤖 Bot jugando' : '🤖 Que juegue un bot') + '</button>';
      if (!seat.local) h += '<button class="sm" data-a="takeover" data-i="' + k + '">📱 Otro móvil</button>';
      h += '</div>';
    });
    h += '<div class="sec">Partida</div><div class="col"><button class="bad" data-a="endgame">Terminar partida y volver a la sala</button><button class="ghost" data-a="home">Salir al inicio (la partida queda guardada)</button></div>';
    var el = document.createElement('div');
    el.id = 'sheet'; el.className = 'shade';
    el.innerHTML = '<div class="sheet">' + h + '</div>';
    el.addEventListener('click', function (ev) { if (ev.target === el) closeSheet(); });
    document.body.appendChild(el);
  }
  function drawQrSheet() {
    var old = $('#sheet'); if (old) old.parentNode.removeChild(old);
    var sh = ui.sheet, url = joinUrl(ctl.code, sh.key);
    var h = '<h2>' + (sh.key ? '📱 Seguir en otro móvil' : '📱 Unirse a la partida') + '<button class="sm ghost x" data-a="close">✕</button></h2>';
    if (sh.key) h += '<p>Que <b>' + esc(sh.name) + '</b> escanee este código con su nuevo móvil. <span class="err-t">Solo él: quien lo escanee verá sus cartas.</span></p>';
    else h += '<p class="mut">Para mirar la partida desde otro móvil. Una vez empezada no entran jugadores nuevos.</p>';
    h += '<div style="background:#fff;border-radius:16px;padding:10px;max-width:340px;margin:0 auto">' + QR.svg(url) + '</div><p class="center mut sm-t" style="word-break:break-all">' + esc(sh.key ? 'Código de sala ' + ctl.code : url) + '</p>';
    var el = document.createElement('div');
    el.id = 'sheet'; el.className = 'shade';
    el.innerHTML = '<div class="sheet">' + h + '</div>';
    el.addEventListener('click', function (ev) { if (ev.target === el) closeSheet(); });
    document.body.appendChild(el);
  }
  function drawOver(pub, isHost) {
    var s = HX.mergeView(pub, null), w = s.players[s.winner];
    var rows = s.players.map(function (pl, k) { return { k: k, pl: pl }; }).sort(function (a, b) { return (b.pl.vpAll || 0) - (a.pl.vpAll || 0); });
    var h = '<div class="box"><div class="trophy">🏆</div><h1>¡' + esc(w.name) + ' gana!</h1><table>';
    rows.forEach(function (r) {
      h += '<tr><td>' + sw(r.pl.color) + ' <b>' + esc(r.pl.name) + '</b>' + (r.pl.hid ? ' <span class="mut sm-t">(' + r.pl.hid + ' 🏛️ ocultos)</span>' : '') + '</td><td>' + (r.pl.vpAll || r.pl.vp) + '</td></tr>';
    });
    h += '</table>';
    if (isHost) h += '<button class="pri" style="width:100%" data-a="rematch">🔁 Otra partida con la misma gente</button><button class="ghost" style="width:100%;margin-top:8px" data-a="hideover">Ver el tablero</button>';
    else h += '<p class="mut">El anfitrión puede empezar otra partida.</p><button class="ghost" style="width:100%" data-a="hideover">Ver el tablero</button>';
    h += '</div>';
    if (ui.hideOver === s.v) return;
    var el = document.createElement('div');
    el.className = 'over'; el.id = 'over';
    el.innerHTML = h;
    document.body.appendChild(el);
  }

  /* ---------- Dibujo principal ---------- */
  function draw() {
    var ov = $('#over'); if (ov) ov.parentNode.removeChild(ov);
    if (!ctl) { drawHome(); drawSheet(); return; }
    if (ctl.host) {
      var hst = ctl.host, pub = hst.pubView();
      if (pub.phase === 'lobby') {
        if (ctl.kind === 'solo') { drawSoloSetup(); return; }
        if (ui.sheet && ui.sheet.k === 'localjoin') { drawJoinForm(pub, { rej: null, wantJoin: false }, { cancel: 'canceledit' }); return; }
        drawLobbyTv(pub, true); drawSheet(); return;
      }
      var pc = playerCtx();
      if (pc && pc.me >= 0 && !ui.hostTv) { drawPlayer(pc); return; }
      drawTv(pub, true);
      return;
    }
    var c = ctl.client;
    if (!c.pub) { drawConnecting(); drawSheet(); return; }
    if (ctl.kind === 'tv') {
      if (c.pub.phase === 'lobby') { drawLobbyTv(c.pub, false); return; }
      drawTv(c.pub, false); return;
    }
    if (c.pub.phase === 'lobby') {
      var editing = !!(ui.sheet && ui.sheet.k === 'edit');
      if (c.inSeat() && !editing) { drawWaitingRoom(c.pub, c); drawSheet(); return; }
      if (!c.inSeat() && !c.wantJoin && !c.rej && Date.now() - ui.firstPub < 1500) { drawConnecting(); setTimeout(render, 1600); return; }
      drawJoinForm(c.pub, { rej: c.rej, wantJoin: !editing && c.wantJoin && !c.inSeat() && !c.rej }, { selfSeat: c.body ? c.body.seat : -1, cancel: editing ? 'canceledit' : 'home' });
      return;
    }
    // partida empezada
    if (c.body && c.body.me >= 0 && c.body.priv) { drawPlayer(playerCtx()); return; }
    if (c.rej || (c.body && c.body.me < 0) || Date.now() - ui.firstPub > 2500) { drawJoinForm(c.pub, { rej: 'started', wantJoin: false }); return; }
    drawConnecting();
    setTimeout(render, 800);
  }
  function drawSoloSetup() {
    var hst = ctl.host, pub = hst.pubView();
    var me = null;
    try { me = JSON.parse(ls('hxa-me') || 'null'); } catch (e) { }
    if (ui.nameDraft === null) ui.nameDraft = me && me.name || '';
    var h = '<div class="home"><div class="logo">' + LOGO + '<div><h1>Práctica</h1><p>Tú contra los bots, en este dispositivo</p></div></div><div class="card col">';
    h += '<input id="nm" maxlength="14" placeholder="Tu nombre" value="' + esc(ui.nameDraft) + '"><div class="sec">¿Contra cuántos bots?</div><div class="row wrap">';
    for (var n = 1; n <= 5; n++) h += '<button class="' + ((ui.nbots || 2) === n ? 'pri' : '') + '" data-a="nbots" data-i="' + n + '">' + n + '</button>';
    h += '</div><button class="pri big" data-a="solostart">▶ Empezar</button></div><button class="ghost" data-a="home">Volver</button></div>';
    $('#app').innerHTML = h;
    var inp = $('#nm');
    inp.addEventListener('input', function () { ui.nameDraft = inp.value; });
  }

  /* ---------- Acciones de la interfaz ---------- */
  function act(a) {
    var pc = playerCtx();
    if (!pc) return false;
    return pc.act(a);
  }
  function onAction(a, d, el) {
    d = d || {};
    var s = ui.s, me = ui.pc ? ui.pc.me : -1, hst = ctl && ctl.host;
    switch (a) {
      case 'create': startHost(null, false); break;
      case 'resume': {
        var saved = null;
        try { saved = JSON.parse(ls('hxa-host') || 'null'); } catch (e) { }
        if (saved) startHost(saved, ls('hxa-host-mode') === 'solo');
        break;
      }
      case 'join': doJoin(false); break;
      case 'watch': askCode(true); break;
      case 'code2': {
        var c2 = NET.cleanCode(($('#code2') || {}).value);
        if (!NET.validCode(c2)) { toast('El código tiene 6 letras o números', 'err'); break; }
        ui.sheet = null; startClient(c2, true); break;
      }
      case 'solo': startHost(null, true); ui.nameDraft = null; render(); break;
      case 'nbots': ui.nbots = +d.i; render(); break;
      case 'solostart': {
        var nm = (ui.nameDraft || '').trim() || 'Yo';
        ls('hxa-me', JSON.stringify({ name: nm, color: 0 }));
        for (var z = hst.seats.length - 1; z >= 0; z--) if (hst.seats[z].bot) hst.removeSeat(z);
        hst.localJoin(nm, 0);
        for (var b = 0; b < (ui.nbots || 2); b++) hst.addBot();
        hst.start(); break;
      }
      case 'rules': ui.sheet = { k: 'rules' }; drawSheet(); break;
      case 'home': goHome(); break;
      case 'fs': try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () { }); } catch (e) { } break;
      case 'close': closeSheet(); break;
      case 'sheet': ui.sheet = { k: d.s }; if (d.s === 'trade') { ui.give = {}; ui.want = {}; ui.bg = null; ui.bt = null; } drawSheet(); break;
      // sala
      case 'bot': hst.addBot(); break;
      case 'kick': hst.removeSeat(+d.i); break;
      case 'start': { var e = hst.start(); if (e) toast(e, 'err'); else keepAwake(); break; }
      case 'localjoin': ui.sheet = { k: 'localjoin' }; ui.nameDraft = null; render(); break;
      case 'color': ui.colorDraft = +d.i; render(); break;
      case 'enter': enterRoom(); break;
      case 'canceledit': ui.sheet = null; render(); break;
      case 'editme': ui.sheet = { k: 'edit' }; ui.nameDraft = null; ui.colorDraft = null; render(); break;
      case 'leave': ctl.client.leave(); ctl.client.wantJoin = false; ctl.client.body = null; goHome(); break;
      case 'watchthis': startClient(ctl.code, true); break;
      // tele
      case 'tvview': ui.hostTv = !ui.hostTv; ui.sheet = null; render(); break;
      case 'tvopts': ui.sheet = { k: 'tvopts' }; drawTvOpts(); break;
      case 'showqr': ui.sheet = { k: 'qr' }; drawQrSheet(); break;
      case 'auto': hst.setAuto(+d.i, !hst.seat(hst.state.players[+d.i].key).auto); break;
      case 'takeover': ui.sheet = { k: 'qr', key: hst.takeoverKey(+d.i), name: hst.state.players[+d.i].name }; drawQrSheet(); break;
      case 'endgame': ui.sheet = null; hst.rematch(); break;
      case 'rematch': ui.hideOver = null; hst.rematch(); break;
      case 'hideover': ui.hideOver = s && s.v; render(); break;
      // juego
      case 'zoom': ui.zoom = !ui.zoom; render(); break;
      case 'roll': act({ t: 'roll' }); break;
      case 'end': ui.mode = null; act({ t: 'end' }); break;
      case 'pass': ui.mode = null; act({ t: 'pass' }); break;
      case 'buy': act({ t: 'buy' }); break;
      case 'mode': ui.mode = d.m; ui.pick = null; render(); break;
      case 'cancelmode': ui.mode = null; ui.pick = null; render(); break;
      case 'confirm': {
        var sel = ui.sel;
        if (!sel || ui.pick === null) break;
        var o = { t: sel.a };
        if (sel.kind === 'v') o.v = ui.pick; else if (sel.kind === 'e') o.e = ui.pick; else o.h = ui.pick;
        if (act(o)) { if (ui.mode && ui.mode.indexOf('f-') !== 0) ui.mode = null; ui.pick = null; }
        render(); break;
      }
      case 'st': {
        var bag = d.k === 'give' ? ui.give : d.k === 'want' ? ui.want : ui.disc;
        bag[d.r] = Math.max(0, (bag[d.r] || 0) + (+d.d));
        if (!bag[d.r]) delete bag[d.r];
        drawSheet(); break;
      }
      case 'discard': if (act({ t: 'discard', res: ui.disc })) { ui.disc = {}; } break;
      case 'steal': if (act({ t: 'steal', from: +d.i })) closeSheet(); break;
      case 'playcard': {
        var k = d.k;
        if (k === 'P' || k === 'M') { ui.sheet.pick = k; ui.p2 = []; ui.m1 = null; drawSheet(); break; }
        if (act({ t: 'play', k: k })) closeSheet();
        break;
      }
      case 'p2': if (ui.p2.length < 2) ui.p2.push(d.r); drawSheet(); break;
      case 'p2clear': ui.p2 = []; drawSheet(); break;
      case 'playP': if (act({ t: 'play', k: 'P', res: ui.p2.slice() })) closeSheet(); break;
      case 'm1': ui.m1 = d.r; drawSheet(); break;
      case 'playM': if (act({ t: 'play', k: 'M', res: ui.m1 })) closeSheet(); break;
      case 'bg': ui.bg = d.r; if (ui.bt === d.r) ui.bt = null; drawSheet(); break;
      case 'bt': ui.bt = d.r; drawSheet(); break;
      case 'bank': if (act({ t: 'bank', give: ui.bg, get: ui.bt, n: 1 })) { ui.bg = null; ui.bt = null; closeSheet(); toast('Cambio hecho', 'good'); } break;
      case 'offer': if (act({ t: 'offer', give: ui.give, want: ui.want })) { ui.give = {}; ui.want = {}; closeSheet(); toast('Oferta enviada', 'good'); } break;
      case 'respond': act({ t: 'respond', id: +d.id, ok: d.ok === '1' }); break;
      case 'confirmtrade': act({ t: 'confirm', id: +d.id, 'with': +d.w }); break;
      case 'cancel': act({ t: 'cancel', id: +d.id }); break;
    }
  }
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    // selección en el tablero
    var tgt = t.closest && t.closest('[data-v],[data-e],[data-h]');
    if (tgt && ui.sel) {
      var id = tgt.getAttribute('data-v') || tgt.getAttribute('data-e') || tgt.getAttribute('data-h');
      ui.pick = +id;
      render();
      return;
    }
    var b = t.closest && t.closest('[data-a]');
    if (!b || b.disabled) return;
    var d = {};
    for (var i = 0; i < b.attributes.length; i++) {
      var at = b.attributes[i];
      if (at.name.indexOf('data-') === 0 && at.name !== 'data-a') d[at.name.slice(5)] = at.value;
    }
    onAction(b.getAttribute('data-a'), d, b);
  });

  /* ---------- Reglas ---------- */
  var RULES = '<div class="rules">' +
    '<p><b>Objetivo:</b> ser el primero en llegar a 10 puntos (o los que elija el anfitrión) durante tu turno.</p>' +
    '<p><b>Preparación:</b> cada uno coloca una aldea y un camino; luego, en orden inverso, una segunda aldea y otro camino. La segunda aldea te da un recurso de cada casilla que toca.</p>' +
    '<p><b>Tu turno:</b></p><ul><li><b>Tira los dados.</b> Las casillas con ese número dan recursos a quien tenga aldeas (1) o ciudades (2) en sus esquinas.</li>' +
    '<li><b>Comercia</b> con los demás (ofertas) o con la banca: 4 iguales por 1, o 3:1 y 2:1 si tienes un puerto.</li>' +
    '<li><b>Construye:</b> camino 🌲🧱 · aldea 🌲🧱🐑🌾 · ciudad 🌾🌾🪨🪨🪨 · carta 🐑🌾🪨.</li></ul>' +
    '<p><b>Reglas de construcción:</b> los caminos salen de tus caminos o edificios. Una aldea necesita un camino tuyo y no puede tener otra construcción en un cruce vecino. Las ciudades sustituyen a una aldea.</p>' +
    '<p><b>El 7:</b> quien tenga más de 7 cartas descarta la mitad. Quien tiró mueve el bandido (esa casilla deja de producir) y roba una carta a alguien con construcción allí.</p>' +
    '<p><b>Cartas de progreso:</b> una por turno, nunca la del mismo turno en que la compras. Guardia, Obras, Abundancia, Acaparador y Monumento (1 punto).</p>' +
    '<p><b>Puntos:</b> aldea 1 · ciudad 2 · Monumento 1 · Ruta más larga (5+ caminos seguidos) 2 · Guardia más numerosa (3+ guardias) 2.</p>' +
    '<p><b>5 y 6 jugadores:</b> el tablero es más grande y, después de cada turno, los demás pueden construir por orden (sin comerciar).</p></div>';

  /* ---------- Arranque ---------- */
  function boot() {
    var sala = q('sala'), tele = q('tele'), anf = q('anfitrion'), solo = q('solo');
    var saved = null;
    try { saved = JSON.parse(ls('hxa-host') || 'null'); } catch (e) { }
    if ((anf || solo) && saved && saved.code === (anf || solo)) { startHost(saved, !!solo); return; }
    if (anf || solo) { toast('Esa partida no está guardada en este dispositivo'); setUrl({}); }
    if (sala && NET.validCode(NET.cleanCode(sala))) {
      var code = NET.cleanCode(sala);
      // el anfitrión que escanea su propio QR no se convierte en jugador remoto
      startClient(code, false);
      if (q('llave')) setUrl({ sala: code });
      return;
    }
    if (tele && NET.validCode(NET.cleanCode(tele))) { startClient(NET.cleanCode(tele), true); return; }
    render();
  }
  window.HXA = { onAction: onAction, ctl: function () { return ctl; }, ui: ui };
  boot();
})();

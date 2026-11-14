/* Hexaldea — conexión: sellado de mensajes, cliente MQTT mínimo, anfitrión y cliente de partida. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.NET = factory(root.HX);
})(typeof self !== 'undefined' ? self : this, function (HX) {
  'use strict';

  // Servidores públicos y gratuitos de mensajería (MQTT sobre WebSocket seguro). Se usan todos a la vez:
  // si uno falla, la partida sigue por los otros.
  var BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  var CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var COLORS = 6;

  /* ---------- Utilidades ---------- */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function rnd32() {
    try {
      var a = new Uint32Array(1);
      (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(a);
      return a[0];
    } catch (e) { return Math.floor(Math.random() * 4294967296) >>> 0; }
  }
  function randomStr(n, abc) {
    abc = abc || 'abcdefghijklmnopqrstuvwxyz0123456789';
    var s = '';
    for (var i = 0; i < n; i++) s += abc[rnd32() % abc.length];
    return s;
  }
  function newCode() { return randomStr(6, CODE_ABC); }
  function cleanCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function validCode(s) {
    if (s.length !== 6) return false;
    for (var i = 0; i < 6; i++) if (CODE_ABC.indexOf(s[i]) < 0) return false;
    return true;
  }
  function h32(str, seed) {
    var h = (0x811c9dc5 ^ seed) >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return h >>> 0;
  }
  function hid(str) {
    function hex(n) { return ('0000000' + n.toString(16)).slice(-8); }
    return hex(h32(str, 0x1234567)) + hex(h32(str, 0x89abcde));
  }
  // Cifrado ligero: evita mirones y mensajes basura en los servidores públicos. No es seguridad fuerte.
  function stream(key, nonce) {
    var a = h32(key, nonce ^ 0xa5a5a5a5), b = h32(key, nonce ^ 0x3c3c3c3c), c = h32(key, nonce ^ 0x0f0f0f0f), d = nonce >>> 0, t;
    function next() {
      // sfc32
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
      return t >>> 0;
    }
    for (var i = 0; i < 12; i++) next();
    return next;
  }
  function mac(bytes, key, nonce) {
    var h = h32(key, nonce ^ 0x5bd1e995);
    for (var i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); h ^= h >>> 13; }
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h ^= h >>> 13;
    return h >>> 0;
  }
  function seal(obj, key) {
    var pt = enc.encode(JSON.stringify(obj)), nonce = rnd32();
    var out = new Uint8Array(pt.length + 8), ks = stream(key, nonce), w = 0;
    out[0] = nonce >>> 24; out[1] = (nonce >>> 16) & 255; out[2] = (nonce >>> 8) & 255; out[3] = nonce & 255;
    for (var i = 0; i < pt.length; i++) {
      if ((i & 3) === 0) w = ks();
      out[4 + i] = pt[i] ^ ((w >>> ((i & 3) * 8)) & 255);
    }
    var m = mac(pt, key, nonce), o = 4 + pt.length;
    out[o] = m >>> 24; out[o + 1] = (m >>> 16) & 255; out[o + 2] = (m >>> 8) & 255; out[o + 3] = m & 255;
    return out;
  }
  function unseal(bytes, key) {
    try {
      if (!bytes || bytes.length < 10 || bytes.length > 400000) return null;
      var nonce = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
      var n = bytes.length - 8, pt = new Uint8Array(n), ks = stream(key, nonce), w = 0;
      for (var i = 0; i < n; i++) {
        if ((i & 3) === 0) w = ks();
        pt[i] = bytes[4 + i] ^ ((w >>> ((i & 3) * 8)) & 255);
      }
      var o = 4 + n, m = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
      if (m !== mac(pt, key, nonce)) return null;
      var obj = JSON.parse(dec.decode(pt));
      return obj && typeof obj === 'object' ? obj : null;
    } catch (e) { return null; }
  }
  function topicBase(code) { return 'hxa1/' + hid(code + '|t'); }

  /* ---------- Cliente MQTT 3.1.1 mínimo sobre WebSocket ---------- */
  function encLen(n) {
    var out = [];
    do { var d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
    return out;
  }
  function mqStr(s) { var b = enc.encode(s); return [b.length >> 8, b.length & 255].concat(Array.prototype.slice.call(b)); }
  function pktConnect(clientId, keepalive) {
    var body = mqStr('MQTT').concat([4, 2, keepalive >> 8, keepalive & 255], mqStr(clientId));
    return new Uint8Array([0x10].concat(encLen(body.length), body));
  }
  function pktSubscribe(id, topic) {
    var body = [id >> 8, id & 255].concat(mqStr(topic), [0]);
    return new Uint8Array([0x82].concat(encLen(body.length), body));
  }
  function pktPublish(topic, payload, retain) {
    var t = mqStr(topic), head = [0x30 | (retain ? 1 : 0)].concat(encLen(t.length + payload.length), t);
    var out = new Uint8Array(head.length + payload.length);
    out.set(head, 0); out.set(payload, head.length);
    return out;
  }

  function MqttConn(url, WS, cb, o) {
    o = o || {};
    this.url = url; this.WS = WS; this.cb = cb;
    this.subs = {}; this.up = false; this.closed = false; this.ws = null;
    this.buf = new Uint8Array(0); this.retry = 0; this.sid = 1; this.lastRx = 0;
    this.keep = o.keepalive || 30; this.pingMs = o.pingMs || 20000; this.tries = 0; this.everUp = false;
    this.open();
  }
  MqttConn.prototype.open = function () {
    var self = this, ws;
    if (this.closed) return;
    this.tries++;
    try { ws = new this.WS(this.url, 'mqtt'); } catch (e) { this.sched(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws; this.buf = new Uint8Array(0);
    var to = setTimeout(function () { if (self.ws === ws && !self.up) { try { ws.close(); } catch (e) { } self.down(ws); } }, 9000);
    ws.onopen = function () {
      if (self.ws !== ws) return;
      try { ws.send(pktConnect('hxa_' + randomStr(14), self.keep)); } catch (e) { }
    };
    ws.onmessage = function (ev) {
      if (self.ws !== ws) return;
      self.lastRx = Date.now();
      try { self.feed(new Uint8Array(ev.data)); } catch (e) { }
    };
    ws.onclose = function () { clearTimeout(to); self.down(ws); };
    ws.onerror = function () { clearTimeout(to); self.down(ws); };
  };
  MqttConn.prototype.down = function (ws) {
    if (this.ws !== ws) return;
    this.ws = null;
    try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch (e) { }
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
    var was = this.up;
    this.up = false;
    if (was && this.cb.state) this.cb.state();
    this.sched();
  };
  MqttConn.prototype.sched = function () {
    var self = this;
    if (this.closed || this.timer) return;
    var d = Math.min(1000 * Math.pow(2, this.retry++), 15000) + Math.floor(Math.random() * 500);
    this.timer = setTimeout(function () { self.timer = null; self.open(); }, d);
  };
  MqttConn.prototype.feed = function (chunk) {
    var b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf, 0); b.set(chunk, this.buf.length);
    var pos = 0;
    for (;;) {
      if (b.length - pos < 2) break;
      var mult = 1, len = 0, i = pos + 1, done = false;
      for (; i < b.length && i < pos + 5; i++) {
        len += (b[i] & 127) * mult; mult *= 128;
        if (!(b[i] & 128)) { done = true; i++; break; }
      }
      if (!done) { if (i >= pos + 5) { pos = b.length; } break; }
      if (b.length - i < len) break;
      this.packet(b[pos], b.subarray(i, i + len));
      pos = i + len;
    }
    this.buf = b.slice(pos);
  };
  MqttConn.prototype.packet = function (h, p) {
    var type = h >> 4, self = this;
    if (type === 2) { // CONNACK
      if (p.length >= 2 && p[1] === 0) {
        this.up = true; this.retry = 0; this.everUp = true;
        Object.keys(this.subs).forEach(function (t) { self.sendSub(t); });
        if (this.ping) clearInterval(this.ping);
        this.ping = setInterval(function () {
          if (!self.up || !self.ws) return;
          if (Date.now() - self.lastRx > self.pingMs * 2.6) { self.down(self.ws); return; }
          try { self.ws.send(new Uint8Array([0xC0, 0])); } catch (e) { }
        }, this.pingMs);
        if (this.cb.state) this.cb.state();
      } else if (this.ws) this.down(this.ws);
    } else if (type === 3) { // PUBLISH
      var qos = (h >> 1) & 3, tl = (p[0] << 8) | p[1];
      var topic = dec.decode(p.subarray(2, 2 + tl)), off = 2 + tl;
      if (qos) {
        var idh = p[off], idl = p[off + 1]; off += 2;
        try { this.ws.send(new Uint8Array([0x40, 2, idh, idl])); } catch (e) { }
      }
      // copia: el búfer se reutiliza
      if (this.cb.msg) this.cb.msg(topic, p.slice(off));
    }
  };
  MqttConn.prototype.sendSub = function (topic) {
    try { this.ws.send(pktSubscribe(this.sid++ & 0xffff || 1, topic)); } catch (e) { }
  };
  MqttConn.prototype.subscribe = function (topic) {
    if (this.subs[topic]) return;
    this.subs[topic] = 1;
    if (this.up) this.sendSub(topic);
  };
  MqttConn.prototype.publish = function (topic, bytes, retain) {
    if (!this.up || !this.ws) return false;
    try { this.ws.send(pktPublish(topic, bytes, retain)); return true; } catch (e) { return false; }
  };
  MqttConn.prototype.kick = function () {
    // Tras volver de segundo plano: reconectar ya si está caído.
    if (this.closed || this.up) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.retry = 0;
    if (!this.ws) this.open();
  };
  MqttConn.prototype.close = function () {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ping) clearInterval(this.ping);
    var ws = this.ws; this.ws = null; this.up = false;
    if (ws) { try { ws.send(new Uint8Array([0xE0, 0])); } catch (e) { } try { ws.close(); } catch (e) { } }
  };

  /* ---------- Transportes: todos con la misma forma {sub, pub, status, close, onmsg, onstatus} ---------- */
  function MqttTransport(urls, WS, o) {
    var self = this;
    this.onmsg = null; this.onstatus = null;
    this.conns = urls.map(function (u) {
      return new MqttConn(u, WS, {
        msg: function (t, b) { if (self.onmsg) self.onmsg(t, b); },
        state: function () { if (self.onstatus) self.onstatus(self.status()); }
      }, o);
    });
  }
  MqttTransport.prototype.sub = function (t) { this.conns.forEach(function (c) { c.subscribe(t); }); };
  MqttTransport.prototype.pub = function (t, b, retain) {
    var n = 0;
    this.conns.forEach(function (c) { if (c.publish(t, b, retain)) n++; });
    return n;
  };
  MqttTransport.prototype.status = function () {
    var up = 0, tried = true;
    this.conns.forEach(function (c) { if (c.up) up++; if (!c.everUp && c.tries < 2) tried = false; });
    return { up: up, total: this.conns.length, kind: 'red', settled: up > 0 || tried };
  };
  MqttTransport.prototype.kick = function () { this.conns.forEach(function (c) { c.kick(); }); };
  MqttTransport.prototype.close = function () { this.conns.forEach(function (c) { c.close(); }); };

  // Entre pestañas del mismo navegador (pruebas y modo sin red).
  function LocalTransport(name) {
    var self = this;
    this.onmsg = null; this.onstatus = null; this.topics = {};
    this.bc = new BroadcastChannel('hxa-' + name);
    this.bc.onmessage = function (ev) {
      var d = ev.data;
      if (d && self.topics[d.t] && self.onmsg) self.onmsg(d.t, d.b);
    };
  }
  LocalTransport.prototype.sub = function (t) { this.topics[t] = 1; };
  LocalTransport.prototype.pub = function (t, b) { this.bc.postMessage({ t: t, b: b }); return 1; };
  LocalTransport.prototype.status = function () { return { up: 1, total: 1, kind: 'local', settled: true }; };
  LocalTransport.prototype.kick = function () { };
  LocalTransport.prototype.close = function () { try { this.bc.close(); } catch (e) { } };

  // Sin red: para jugar en un solo dispositivo contra bots.
  function NullTransport() { this.onmsg = null; this.onstatus = null; }
  NullTransport.prototype.sub = function () { };
  NullTransport.prototype.pub = function () { return 0; };
  NullTransport.prototype.status = function () { return { up: 0, total: 0, kind: 'none', settled: true }; };
  NullTransport.prototype.kick = function () { };
  NullTransport.prototype.close = function () { };

  /* ---------- Anfitrión: tiene la partida completa y manda a cada uno lo que puede ver ---------- */
  function Host(o) {
    var self = this;
    this.t = o.transport; this.store = o.store || null; this.rng = o.rng || Math.random;
    this.botMs = o.botMs === undefined ? 900 : o.botMs;
    this.awayMs = o.awayMs || 25000;
    this.listeners = [];
    this.timers = [];
    var saved = o.restore || null;
    if (saved) {
      this.code = saved.code; this.e = saved.e; this.v = saved.v; this.seats = saved.seats; this.opts = saved.opts;
      this.state = saved.state; this.localKey = saved.localKey || null;
      this.seats.forEach(function (s) { s.seen = 0; s.lastPriv = null; s.body = null; s.pv = s.pv || 0; });
    } else {
      this.code = o.code || newCode(); this.e = randomStr(6); this.v = 0;
      this.seats = []; this.opts = { target: 10 }; this.state = null; this.localKey = null;
    }
    this.base = topicBase(this.code); this.rk = this.code + '|k';
    this.lastPubAt = 0; this.botTimer = null; this.dead = false;
    this.t.onmsg = function (topic, bytes) { self.onmsg(topic, bytes); };
    this.t.onstatus = function (st) { self.resync(); if (self.onstatus) self.onstatus(st); };
    this.t.sub(this.base + '/h');
    this.timers.push(setInterval(function () { self.tick(); }, o.tickMs || 4000));
    this.announce = setTimeout(function () { self.broadcast(true); }, 50);
  }
  Host.prototype.on = function (fn) { this.listeners.push(fn); };
  Host.prototype.emit = function () { this.listeners.forEach(function (fn) { try { fn(); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }); };
  Host.prototype.seat = function (key) {
    for (var i = 0; i < this.seats.length; i++) if (this.seats[i].key === key) return this.seats[i];
    return null;
  };
  Host.prototype.playerIdx = function (key) {
    if (!this.state) return -1;
    for (var i = 0; i < this.state.players.length; i++) if (this.state.players[i].key === key) return i;
    return -1;
  };
  Host.prototype.isOn = function (s) { return !!(s.bot || s.local || (Date.now() - (s.seen || 0) < this.awayMs)); };
  Host.prototype.freeColor = function (want) {
    var used = {};
    this.seats.forEach(function (s) { used[s.color] = 1; });
    if (want !== undefined && want !== null && want >= 0 && want < COLORS && !used[want]) return want;
    for (var c = 0; c < COLORS; c++) if (!used[c]) return c;
    return 0;
  };
  Host.prototype.cleanName = function (n) {
    n = String(n === undefined || n === null ? '' : n).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
    return n || 'Jugador';
  };
  // --- vistas ---
  Host.prototype.pubView = function () {
    var self = this, v;
    if (this.state) {
      v = HX.publicView(this.state);
      v.on = this.state.players.map(function (pl) { var s = self.seat(pl.key); return s ? self.isOn(s) : true; });
      v.auto = this.state.players.map(function (pl) { var s = self.seat(pl.key); return !!(s && s.auto); });
    } else {
      v = {
        phase: 'lobby', opts: this.opts, max: HX.MAX_PLAYERS,
        seats: this.seats.map(function (s) { return { name: s.name, color: s.color, bot: !!s.bot, on: self.isOn(s) }; })
      };
    }
    // Versión de los datos privados de cada uno: así cada cliente sabe si su mano está al día con este estado.
    var list = this.state ? this.state.players.map(function (pl) { return self.seat(pl.key); }) : this.seats;
    v.pvs = list.map(function (s) { return s && !s.bot && !s.local ? (s.pv || 0) : 0; });
    v.hv = this.v;
    return v;
  };
  Host.prototype.privFor = function (key) {
    var s = this.seat(key), idx = this.playerIdx(key);
    var o = { ack: s ? s.seq || 0 : 0, err: s ? s.err || null : null, seat: s ? this.seats.indexOf(s) : -1, me: idx };
    if (idx >= 0) o.priv = HX.privateView(this.state, idx);
    return o;
  };
  // --- envío ---
  Host.prototype.save = function () {
    if (!this.store) return;
    try {
      this.store.set(JSON.stringify({
        code: this.code, e: this.e, v: this.v, opts: this.opts, state: this.state, localKey: this.localKey, at: Date.now(),
        seats: this.seats.map(function (s) {
          return { key: s.key, name: s.name, color: s.color, bot: !!s.bot, local: !!s.local, auto: !!s.auto, seq: s.seq || 0, err: null, pv: s.pv || 0 };
        })
      }));
    } catch (e) { }
  };
  Host.prototype.sendPub = function () {
    this.lastPubAt = Date.now();
    this.t.pub(this.base + '/s', seal({ k: 's', e: this.e, v: this.v, s: this.pubView() }, this.rk), true);
  };
  Host.prototype.prep = function (s) {
    // Recalcula lo privado de un asiento. Devuelve true si ha cambiado (y sube su versión).
    if (s.bot || s.local) return false;
    var body = this.privFor(s.key), txt = JSON.stringify(body);
    if (txt === s.lastPriv) return false;
    s.lastPriv = txt; s.body = body; s.pv = (s.pv || 0) + 1; s.hv = this.v;
    return true;
  };
  Host.prototype.sendPriv = function (s) {
    if (s.bot || s.local) return;
    if (!s.body) this.prep(s);
    this.t.pub(this.base + '/p/' + hid(s.key + '|t'), seal({ k: 'p', e: this.e, pv: s.pv, hv: s.hv, b: s.body }, s.key + '|' + this.code), true);
  };
  Host.prototype.resync = function () {
    // Al (re)conectar con un servidor: volver a dejar allí el último estado de todos.
    var self = this;
    if (this.dead || !this.v) return;
    this.sendPub();
    this.seats.forEach(function (s) { self.sendPriv(s); });
  };
  Host.prototype.broadcast = function (quiet) {
    var self = this;
    if (this.dead) return;
    this.v++;
    var changed = this.seats.filter(function (s) { return self.prep(s); });
    this.save();
    this.sendPub();
    changed.forEach(function (s) { self.sendPriv(s); });
    if (!quiet) this.emit();
    this.scheduleBots();
  };
  // --- mensajes entrantes ---
  Host.prototype.onmsg = function (topic, bytes) {
    if (this.dead || topic !== this.base + '/h') return;
    var m = unseal(bytes, this.rk);
    if (!m || typeof m.k !== 'string') return;
    var s = typeof m.key === 'string' && m.key.length >= 8 && m.key.length <= 40 ? this.seat(m.key) : null;
    var wasOn = s ? this.isOn(s) : true;
    if (s) s.seen = Date.now();
    if (m.k === 'join') {
      if (typeof m.key !== 'string' || m.key.length < 8 || m.key.length > 40) return;
      if (s) {
        if (!this.state && !s.bot) {
          var nm = this.cleanName(m.name), ch = false;
          if (m.name !== undefined && nm !== s.name) { s.name = nm; ch = true; }
          if (typeof m.color === 'number' && m.color !== s.color && this.freeColor(m.color) === m.color) { s.color = m.color; ch = true; }
          if (ch) { this.broadcast(); return; }
        }
        if (!wasOn) this.broadcast(); else { this.sendPriv(s); this.maybePub(m.v); }
        return;
      }
      var rej = this.state ? 'started' : (this.seats.length >= HX.MAX_PLAYERS ? 'full' : null);
      if (rej) {
        this.t.pub(this.base + '/p/' + hid(m.key + '|t'), seal({ k: 'p', e: this.e, pv: 0, rej: rej }, m.key + '|' + this.code), false);
        this.maybePub(m.v);
        return;
      }
      this.seats.push({ key: m.key, name: this.cleanName(m.name), color: this.freeColor(m.color), bot: false, seq: 0, err: null, seen: Date.now(), pv: 0 });
      this.broadcast();
      return;
    }
    if (m.k === 'leave') {
      if (s && !this.state) { this.seats.splice(this.seats.indexOf(s), 1); this.broadcast(); }
      return;
    }
    if (m.k === 'ping') {
      if (s) {
        if (!wasOn) { this.broadcast(); return; }
        if (typeof m.pv !== 'number' || m.pv < (s.pv || 0)) this.sendPriv(s);
      }
      this.maybePub(m.v);
      return;
    }
    if (m.k === 'act') {
      if (!s || typeof m.seq !== 'number') return;
      if (m.seq <= (s.seq || 0)) { this.sendPriv(s); return; }
      var idx = this.playerIdx(m.key), err;
      if (idx < 0) err = 'La partida no ha empezado';
      else if (s.auto) err = 'Ahora mismo un bot juega por ti';
      else err = HX.act(this.state, idx, m.a, this.rng);
      s.seq = m.seq;
      s.err = err ? { seq: m.seq, m: err } : null;
      if (err) { this.prep(s); this.save(); this.sendPriv(s); } else this.broadcast();
      return;
    }
  };
  Host.prototype.maybePub = function (clientV) {
    // Reenviar el estado público si alguien va por detrás (como mucho una vez cada 700 ms).
    if (typeof clientV === 'number' && clientV >= this.v) return;
    if (Date.now() - this.lastPubAt < 700) return;
    this.sendPub();
  };
  // --- controles locales del anfitrión ---
  Host.prototype.localJoin = function (name, color) {
    if (this.state) return null;
    var s = this.localKey ? this.seat(this.localKey) : null;
    if (!s) {
      if (this.seats.length >= HX.MAX_PLAYERS) return null;
      this.localKey = 'local-' + randomStr(12);
      s = { key: this.localKey, name: this.cleanName(name), color: this.freeColor(color), bot: false, local: true, seq: 0, err: null, pv: 0 };
      this.seats.push(s);
    } else { s.name = this.cleanName(name); if (typeof color === 'number' && this.freeColor(color) === color) s.color = color; }
    this.broadcast();
    return this.localKey;
  };
  Host.prototype.addBot = function () {
    if (this.state || this.seats.length >= HX.MAX_PLAYERS) return false;
    var names = ['Bot Ada', 'Bot Leo', 'Bot Iris', 'Bot Hugo', 'Bot Noa', 'Bot Teo'], used = {};
    this.seats.forEach(function (s) { used[s.name] = 1; });
    var nm = names.filter(function (n) { return !used[n]; })[0] || 'Bot';
    this.seats.push({ key: 'bot-' + randomStr(12), name: nm, color: this.freeColor(), bot: true, seq: 0, err: null, pv: 0 });
    this.broadcast();
    return true;
  };
  Host.prototype.removeSeat = function (i) {
    if (this.state || !this.seats[i]) return;
    var s = this.seats[i];
    if (s.key === this.localKey) this.localKey = null;
    this.seats.splice(i, 1);
    if (!s.bot && !s.local) {
      this.t.pub(this.base + '/p/' + hid(s.key + '|t'), seal({ k: 'p', e: this.e, pv: (s.pv || 0) + 1, rej: 'kicked' }, s.key + '|' + this.code), true);
    }
    this.broadcast();
  };
  Host.prototype.setTarget = function (n) {
    if (this.state || !(n >= 5 && n <= 15)) return;
    this.opts.target = n; this.broadcast();
  };
  Host.prototype.start = function () {
    if (this.state) return 'La partida ya ha empezado';
    if (this.seats.length < 2) return 'Hacen falta al menos 2 jugadores';
    var defs = this.seats.map(function (s) { return { name: s.name, color: s.color, bot: !!s.bot, key: s.key }; });
    this.seats.forEach(function (s) { s.err = null; s.auto = false; });
    this.state = HX.newGame(defs, { target: this.opts.target }, this.rng);
    this.broadcast();
    return null;
  };
  Host.prototype.actLocal = function (a) {
    var idx = this.playerIdx(this.localKey);
    if (idx < 0) return 'No estás en la partida';
    var err = HX.act(this.state, idx, a, this.rng);
    if (!err) this.broadcast();
    return err;
  };
  Host.prototype.setAuto = function (playerIdx, on) {
    if (!this.state || !this.state.players[playerIdx]) return;
    var s = this.seat(this.state.players[playerIdx].key);
    if (!s || s.bot) return;
    s.auto = !!on;
    this.broadcast();
  };
  Host.prototype.takeoverKey = function (playerIdx) {
    if (!this.state || !this.state.players[playerIdx]) return null;
    var s = this.seat(this.state.players[playerIdx].key);
    return s && !s.bot && !s.local ? s.key : null;
  };
  Host.prototype.rematch = function () {
    this.state = null;
    this.seats.forEach(function (s) { s.err = null; s.auto = false; });
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
    this.broadcast();
  };
  // --- bots ---
  Host.prototype.botMove = function () {
    // Devuelve {p, a} con la siguiente jugada de un bot (o de un jugador en modo automático), o null.
    var st = this.state;
    if (!st || st.phase === 'over') return null;
    for (var p = 0; p < st.players.length; p++) {
      var s = this.seat(st.players[p].key);
      if (!s || !(s.bot || s.auto)) continue;
      var a = HX.botChoose(st, p, this.rng);
      if (a) return { p: p, a: a };
    }
    return null;
  };
  Host.prototype.scheduleBots = function () {
    var self = this;
    if (this.botTimer || this.dead) return;
    var mv = this.botMove();
    if (!mv) return;
    var quick = mv.a.t === 'respond' || mv.a.t === 'pass' || mv.a.t === 'discard';
    this.botTimer = setTimeout(function () {
      self.botTimer = null;
      if (self.dead) return;
      var m = self.botMove();
      if (!m) return;
      var err = HX.act(self.state, m.p, m.a, self.rng);
      if (err) {
        // No debería ocurrir; para no quedar bloqueados, el bot termina o pasa.
        HX.act(self.state, m.p, { t: 'end' }, self.rng); HX.act(self.state, m.p, { t: 'pass' }, self.rng);
      }
      self.broadcast();
    }, this.botMs ? Math.round(this.botMs * (quick ? 0.4 : 1)) : 0);
  };
  Host.prototype.tick = function () {
    // Presencia: si alguien aparece o desaparece, avisar.
    var self = this, sig = this.seats.map(function (s) { return self.isOn(s) ? '1' : '0'; }).join('');
    if (this.lastSig !== undefined && sig !== this.lastSig) { this.lastSig = sig; this.broadcast(); return; }
    this.lastSig = sig;
    this.scheduleBots();
  };
  Host.prototype.close = function () {
    this.dead = true;
    this.timers.forEach(clearInterval);
    clearTimeout(this.announce);
    if (this.botTimer) clearTimeout(this.botTimer);
  };

  /* ---------- Cliente: jugador a distancia o pantalla de tele (sin llave) ---------- */
  function Client(o) {
    var self = this;
    this.t = o.transport; this.code = o.code; this.key = o.key || null;
    this.name = o.name || ''; this.color = o.color;
    this.base = topicBase(this.code); this.rk = this.code + '|k';
    this.pk = this.key ? this.key + '|' + this.code : null;
    this.ptopic = this.key ? this.base + '/p/' + hid(this.key + '|t') : null;
    this.pub = null; this.body = null; this.e = null; this.v = -1; this.pv = -1; this.hv = 0;
    this.seq = 0; this.seqKnown = false; this.pending = null; this.rej = null;
    this.listeners = []; this.onerr = null; this.dead = false; this.lastRx = 0;
    this.pingMs = o.pingMs || 5000; this.resendMs = o.resendMs || 1500;
    this.t.onmsg = function (topic, bytes) { self.onmsg(topic, bytes); };
    this.t.onstatus = function (st) {
      if (st.up) { self.hello(); if (self.pending) self.pending.at = 0; self.beat(); }
      if (self.onstatus) self.onstatus(st);
    };
    this.t.sub(this.base + '/s');
    if (this.ptopic) this.t.sub(this.ptopic);
    this.timer = setInterval(function () { self.beat(); }, Math.min(this.pingMs, this.resendMs));
    this.lastPing = 0;
    setTimeout(function () { self.hello(); }, 30);
  }
  Client.prototype.on = function (fn) { this.listeners.push(fn); };
  Client.prototype.emit = function () { this.listeners.forEach(function (fn) { try { fn(); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }); };
  Client.prototype.send1 = function (obj) { return this.t.pub(this.base + '/h', seal(obj, this.rk), false); };
  Client.prototype.inSeat = function () { return !!(this.body && (this.body.seat >= 0 || this.body.me >= 0)); };
  // ¿Lo que vemos (estado público + mano) corresponde al mismo momento de la partida?
  Client.prototype.synced = function () {
    if (!this.pub) return false;
    if (!this.key || !this.body) return true;
    if (this.v < this.hv) return false;
    var i = this.pub.phase === 'lobby' ? this.body.seat : this.body.me;
    if (i < 0 || !this.pub.pvs) return true;
    return this.pv >= (this.pub.pvs[i] || 0);
  };
  Client.prototype.hello = function () {
    if (this.dead) return;
    this.lastPing = Date.now();
    if (this.key && !this.inSeat() && !this.rej && this.wantJoin) this.send1({ k: 'join', key: this.key, name: this.name, color: this.color, v: this.v });
    else this.send1({ k: 'ping', key: this.key || undefined, v: this.v, pv: this.pv });
  };
  Client.prototype.beat = function () {
    if (this.dead) return;
    var now = Date.now();
    if (this.pending && now - this.pending.at >= this.resendMs) { this.pending.at = now; this.pending.n++; this.send1({ k: 'act', key: this.key, seq: this.pending.seq, a: this.pending.a }); }
    // Más insistente hasta recibir el primer estado.
    var every = this.pub && this.synced() && !this.pending ? this.pingMs : Math.min(this.pingMs, 1200);
    if (now - this.lastPing >= every) this.hello();
  };
  Client.prototype.join = function (name, color) {
    this.name = name; this.color = color; this.wantJoin = true; this.rej = null;
    if (this.key) this.send1({ k: 'join', key: this.key, name: name, color: color, v: this.v });
  };
  Client.prototype.leave = function () { if (this.key) this.send1({ k: 'leave', key: this.key }); };
  Client.prototype.onmsg = function (topic, bytes) {
    if (this.dead) return;
    var m, changed = false;
    if (topic === this.base + '/s') {
      m = unseal(bytes, this.rk);
      if (!m || m.k !== 's' || typeof m.v !== 'number' || !m.s) return;
      this.lastRx = Date.now();
      if (m.e !== this.e) { if (this.e !== null && m.v < this.v) return; this.e = m.e; this.v = -1; }
      if (m.v <= this.v) return;
      this.v = m.v; this.pub = m.s; changed = true;
    } else if (topic === this.ptopic) {
      m = unseal(bytes, this.pk);
      if (!m || m.k !== 'p') return;
      this.lastRx = Date.now();
      if (m.rej) {
        if (m.rej === 'kicked') {
          if (typeof m.pv === 'number' && m.pv <= this.pv) return;
          this.pv = m.pv; this.body = null; this.wantJoin = false; this.rej = 'kicked'; this.pending = null; changed = true;
        } else if (!this.inSeat()) { this.rej = m.rej; changed = true; }
      }
      else {
        if (typeof m.pv !== 'number' || !m.b) return;
        if (m.pv <= this.pv && this.body) return;
        this.pv = m.pv; this.hv = m.hv || 0; this.body = m.b; this.rej = null; changed = true;
        if (!this.seqKnown) { this.seqKnown = true; if (m.b.ack > this.seq) this.seq = m.b.ack; }
        if (this.pending && m.b.ack >= this.pending.seq) {
          var done = this.pending; this.pending = null;
          if (m.b.err && m.b.err.seq === done.seq && this.onerr) this.onerr(m.b.err.m);
        }
      }
    }
    if (changed) this.emit();
  };
  // Envía una jugada. Solo una a la vez: devuelve false si aún hay otra en camino.
  Client.prototype.act = function (a) {
    if (!this.key || !this.seqKnown || this.pending || !this.synced()) return false;
    this.seq++;
    this.pending = { seq: this.seq, a: a, at: Date.now(), n: 0 };
    this.send1({ k: 'act', key: this.key, seq: this.seq, a: a });
    this.emit();
    return true;
  };
  Client.prototype.close = function () { this.dead = true; clearInterval(this.timer); };

  return {
    BROKERS: BROKERS, COLORS: COLORS, CODE_ABC: CODE_ABC,
    newCode: newCode, cleanCode: cleanCode, validCode: validCode, randomStr: randomStr, hid: hid,
    seal: seal, unseal: unseal, topicBase: topicBase,
    MqttConn: MqttConn, MqttTransport: MqttTransport, LocalTransport: LocalTransport, NullTransport: NullTransport,
    Host: Host, Client: Client
  };
});

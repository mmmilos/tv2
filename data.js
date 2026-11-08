'use strict';
const $ = id => document.getElementById(id);
const enc = encodeURIComponent;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const LS = {
  get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
};
const setStatus = s => { $('status').textContent = s || ''; };

/* ================= IndexedDB =================
   Die grossen Listen liegen NICHT im RAM oder localStorage, sondern hier.
   items: ein Eintrag pro Sender/Film, Indizes: ck (Kategorie), pt (Playlist+Typ), pl (Playlist) */
const DB = (() => {
  let db;
  const open = () => db ? Promise.resolve(db) : new Promise((res, rej) => {
    const r = indexedDB.open('iptv', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      const it = d.createObjectStore('items', { keyPath: 'k' });
      it.createIndex('ck', 'ck'); it.createIndex('pt', 'pt'); it.createIndex('pl', 'pl');
      const c = d.createObjectStore('cats', { keyPath: 'k' });
      c.createIndex('pt', 'pt'); c.createIndex('pl', 'pl');
      d.createObjectStore('meta');
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
  const wrap = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const tx = async (s, m) => (await open()).transaction(s, m || 'readonly');
  return {
    async put(store, rows) {
      const t = await tx(store, 'readwrite'), s = t.objectStore(store);
      rows.forEach(r => s.put(r));
      return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
    },
    async all(store, index, key) { return wrap((await tx(store)).objectStore(store).index(index).getAll(key)); },
    async getMeta(k) { return wrap((await tx('meta')).objectStore('meta').get(k)); },
    async setMeta(k, v) { (await tx('meta', 'readwrite')).objectStore('meta').put(v, k); },
    // Substring-Suche per Cursor ueber einen Typ (live/vod) einer Playlist, bricht bei cancel() ab
    async scan(pt, q, limit, cancel, ok) {
      const t = await tx('items');
      const out = [];
      const test = typeof q === 'function' ? q : v => v.n.toLowerCase().indexOf(q) > -1 && (!ok || ok(v));
      return new Promise((res, rej) => {
        const rq = t.objectStore('items').index('pt').openCursor(IDBKeyRange.only(pt));
        rq.onsuccess = () => {
          const c = rq.result;
          if (!c || cancel() || out.length >= limit) return res(out);
          if (test(c.value)) out.push(c.value);
          c.continue();
        };
        rq.onerror = () => rej(rq.error);
      });
    },
    async removePlaylist(pl) {
      const t = await tx(['items', 'cats', 'meta'], 'readwrite');
      const del = rq => { rq.onsuccess = () => { const c = rq.result; if (c) { c.delete(); c.continue(); } }; };
      del(t.objectStore('items').index('pl').openCursor(IDBKeyRange.only(pl)));
      del(t.objectStore('cats').index('pl').openCursor(IDBKeyRange.only(pl)));
      del(t.objectStore('meta').openCursor(IDBKeyRange.bound(pl + '|', pl + '|\uffff')));
      return new Promise(r => { t.oncomplete = r; });
    }
  };
})();

/* ================= Quellen: Xtream + M3U ================= */
const apiUrl = (p, act, extra) =>
  `${p.server}/player_api.php?username=${enc(p.user)}&password=${enc(p.pass)}&action=${act}${extra || ''}`;
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const isVod = u => /\/movie\/|\.(mp4|mkv|avi)(\?|$)/i.test(u);
const jobs = {};

// M3U wird als Stream gelesen und in Bloecken in die DB geschrieben (nie die ganze Datei als Objekt im RAM)
async function loadM3U(p) {
  let buf = '', cur = null, n = 0, rows = [];
  const cats = new Map();
  const flush = async () => { if (rows.length) { const r = rows; rows = []; await DB.put('items', r); } };
  const add = async (h, u) => {
    const t = /\/series\//i.test(u) ? 'series' : isVod(u) ? 'vod' : 'live';
    const g = (/group-title="([^"]*)"/.exec(h) || [])[1] || 'Ohne Gruppe';
    const ico = (/tvg-logo="([^"]*)"/.exec(h) || [])[1] || '';
    const ck = `${p.id}|${t}|${g}`;
    if (!cats.has(ck)) cats.set(ck, { k: ck, pl: p.id, pt: `${p.id}|${t}`, id: g, n: g, o: cats.size });
    rows.push({ k: `${p.id}|${t}|${n}`, pl: p.id, pt: `${p.id}|${t}`, ck, id: n, n: h.slice(h.lastIndexOf(',') + 1).trim(), i: ico, e: u });
    n++;
    if (rows.length >= 3000) await flush();
  };
  const feed = async (s, end) => {
    buf += s;
    const ls = buf.split('\n');
    buf = end ? '' : ls.pop();
    for (const raw of ls) {
      const l = raw.trim();
      if (!l) continue;
      if (l.charCodeAt(0) === 35) { if (l.indexOf('#EXTINF') === 0) cur = l; }
      else if (cur) { const h = cur; cur = null; await add(h, l); }
    }
  };
  setStatus('Lade M3U …');
  const r = await fetch(p.url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (r.body && r.body.getReader) {
    const rd = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      await feed(dec.decode(value, { stream: true }));
      setStatus(`M3U: ${n} Einträge gelesen …`);
    }
    await feed(dec.decode(), true);
  } else {
    await feed(await r.text(), true);
  }
  await flush();
  await DB.put('cats', [...cats.values()]);
  await DB.setMeta(`${p.id}|live|cats`, 1);
  await DB.setMeta(`${p.id}|vod|cats`, 1);
  await DB.setMeta(`${p.id}|series|cats`, 1);
}

const Src = {
  async cats(p, t) {
    const key = `${p.id}|${t}|cats`;
    if (!await DB.getMeta(key)) {
      if (p.type === 'm3u') {
        jobs[p.id] = jobs[p.id] || loadM3U(p).then(() => { delete jobs[p.id]; }, e => { delete jobs[p.id]; throw e; });
        await jobs[p.id];
      } else {
        const j = await getJSON(apiUrl(p, { live: 'get_live_categories', vod: 'get_vod_categories', series: 'get_series_categories' }[t]));
        await DB.put('cats', (Array.isArray(j) ? j : []).map((c, o) => ({
          k: `${p.id}|${t}|${c.category_id}`, pl: p.id, pt: `${p.id}|${t}`, id: String(c.category_id), n: String(c.category_name || ''), o
        })));
        await DB.setMeta(key, 1);
      }
    }
    const list = await DB.all('cats', 'pt', `${p.id}|${t}`);
    return list.sort((a, b) => a.o - b.o);
  },
  // Xtream: Streams werden pro Kategorie geholt und gecacht (nie alle 240.000 auf einmal)
  async items(p, t, catId) {
    const ck = `${p.id}|${t}|${catId}`;
    if (p.type === 'xtream' && !await DB.getMeta(ck + '|done')) {
      const sr = t === 'series';
      const j = await getJSON(apiUrl(p, { live: 'get_live_streams', vod: 'get_vod_streams', series: 'get_series' }[t], `&category_id=${enc(catId)}`));
      const rows = (Array.isArray(j) ? j : []).map(s => {
        const id = sr ? s.series_id : s.stream_id;
        return { k: `${p.id}|${t}|${id}`, pl: p.id, pt: `${p.id}|${t}`, ck, id, n: String(s.name || s.title || ''), i: (sr ? s.cover : s.stream_icon) || '', e: s.container_extension || 'mp4' };
      });
      for (let i = 0; i < rows.length; i += 5000) await DB.put('items', rows.slice(i, i + 5000));
      await DB.setMeta(ck + '|done', 1);
    }
    return DB.all('items', 'ck', ck);
  }
};

const idxJobs = {}, idxProg = {};
const TLABEL = { live: 'Live', vod: 'Filme', series: 'Serien' };
// Lädt alle Kategorien eines Typs einmalig in die Datenbank (danach findet die Suche alles). 4 Kategorien parallel.
function indexType(p, t, prog) {
  const k = `${p.id}|${t}`;
  if (idxJobs[k]) return idxJobs[k];
  idxJobs[k] = (async () => {
    if (p.type === 'm3u') { await Src.cats(p, 'live'); return; }
    if (await DB.getMeta(k + '|indexed')) return;
    const cs = await Src.cats(p, t);
    let bad = 0, done = 0, next = 0;
    idxProg[k] = { i: 0, n: cs.length };
    const work = async () => {
      while (next < cs.length) {
        const c = cs[next++];
        try { await Src.items(p, t, c.id); } catch (e) { bad++; }
        done++; idxProg[k].i = done;
        if (prog) prog(done, cs.length);
      }
    };
    await Promise.all([work(), work(), work(), work()]);
    if (cs.length && bad > cs.length / 2) throw new Error('Server nicht erreichbar');
    await DB.setMeta(k + '|indexed', 1);
  })().then(r => { delete idxJobs[k]; delete idxProg[k]; return r; }, e => { delete idxJobs[k]; delete idxProg[k]; throw e; });
  return idxJobs[k];
}
async function indexAll(p) {
  if (p.type === 'm3u') { await indexType(p, 'live'); setStatus('M3U ist bereits vollständig geladen.'); return; }
  for (const t of ['live', 'vod', 'series']) await indexType(p, t, (i, n) => setStatus(`Index ${TLABEL[t]}: Kategorie ${i}/${n} …`));
  setStatus('Index fertig – Suche findet jetzt alles.');
}


/* ================= TMDB (Trends + Poster/Hintergründe) ================= */
const TM = {
  key() { return String(LS.get('tmdb', '') || (window.CFG && window.CFG.tmdbKey) || '').trim(); },
  async get(path, extra) {
    const k = TM.key();
    if (!k) throw new Error('kein TMDB-Key');
    const bearer = k.length > 40;                       // langer Token (v4) -> Bearer, sonst api_key
    const url = `https://api.themoviedb.org/3${path}?language=de-DE${extra || ''}${bearer ? '' : '&api_key=' + enc(k)}`;
    const r = await fetch(url, bearer ? { headers: { Authorization: 'Bearer ' + k } } : undefined);
    if (!r.ok) throw new Error('TMDB HTTP ' + r.status);
    return r.json();
  },
  map(x, mt) {
    return {
      src: 'tmdb', mt, tid: x.id, n: x.title || x.name || '', on: x.original_title || x.original_name || '',
      y: String(x.release_date || x.first_air_date || '').slice(0, 4), ov: x.overview || '',
      img: x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '',
      bd: x.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + x.backdrop_path : '',
      vote: x.vote_average || 0
    };
  },
  cached() { const c = LS.get('tmdbc', null); return c && Date.now() - c.t < 6 * 3600 * 1000 ? c : null; },
  async trends() {
    const c = TM.cached(); if (c) return c;
    const res = await Promise.all([TM.get('/trending/movie/week'), TM.get('/trending/tv/week')]);
    const o = {
      t: Date.now(),
      movie: (res[0].results || []).slice(0, 20).map(x => TM.map(x, 'movie')),
      tv: (res[1].results || []).slice(0, 20).map(x => TM.map(x, 'tv'))
    };
    LS.set('tmdbc', o);
    return o;
  }
};

/* ================= Titel in der eigenen Playlist finden ================= */
function findMatches(pt, titles, year, cancel) {
  const ts = titles.filter(Boolean), qs = ts.map(norm).filter(q => q.length > 1);
  if (!qs.length) return Promise.resolve([]);
  const words = ts.map(t => t.toLowerCase().split(/[\s\-:,.!?'"()\[\]&]+/).sort((a, b) => b.length - a.length)[0]).filter(w => w && w.length > 1);
  const y = +year || 0;
  const test = v => {
    const l = v.n.toLowerCase();
    if (!words.some(w => l.indexOf(w) > -1)) return false;                 // schneller Vorfilter
    const nn = ' ' + norm(v.n) + ' ';
    const hit = qs.some(q => { const i = nn.indexOf(' ' + q + ' '); return q.indexOf(' ') < 0 ? i === 0 : i > -1; });
    if (!hit) return false;
    const vy = yearOf(v.n);
    return !(y && vy && Math.abs(vy - y) > 1);                              // Jahr passt nicht -> anderer Film
  };
  const rank = v => (qs.indexOf(norm(v.n)) > -1 ? 0 : 1);
  return DB.scan(pt, test, 60, cancel).then(r => r.sort((a, b) => rank(a) - rank(b)));
}

const catMap = {};
async function catNames(p, t) {
  const k = `${p.id}|${t}`;
  if (!catMap[k]) {
    const l = await DB.all('cats', 'pt', k), m = {};
    l.forEach(c => { m[c.id] = c.n; });
    catMap[k] = m;
  }
  return catMap[k];
}

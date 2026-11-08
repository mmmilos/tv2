'use strict';
/* ================= Zustand ================= */
let pls = LS.get('pls', []);
const oldAuth = LS.get('xtream_auth', null);       // Migration der ersten Version
if (oldAuth && !pls.length) {
  pls.push({ id: 'p' + Date.now(), name: 'Xtream', type: 'xtream', server: oldAuth.server, user: oldAuth.username, pass: oldAuth.password });
  LS.set('pls', pls);
}
let pos = LS.get('pos', {}), hidden = LS.get('hidden', {});   // Wiedergabepositionen, ausgeblendete Kategorien
let favs = LS.get('favs', {});                                 // key -> kompletter Eintrag
let P = null, T = 'live', GRID = null, zone = 'cats', screen = 'home', tok = 0, E = null, editing = false, delArmed = false;
let allCats = [], manage = false;
const isFav = it => !!favs[it.k];
const INFO = {};                                               // Provider-Infos (Plot, Hintergrund …) je Eintrag

/* ================= Start- und Detailseite (Hero + Zeilen) ================= */
function mkScreen(id, p) {
  $(id).innerHTML =
    '<div class="hero"><div class="hbd" id="' + p + '-bd"></div><div class="hsh"></div>' +
    '<div class="htx"><div class="hk" id="' + p + '-k"></div><div class="ht" id="' + p + '-t"></div>' +
    '<div class="hm" id="' + p + '-m"></div><div class="hd" id="' + p + '-d"></div></div></div>' +
    '<div class="rowsvp" id="' + p + '-rows"></div>';
}
mkScreen('home', 'hm'); mkScreen('detail', 'dt');
const HOME = new Rows($('hm-rows'), { focus: (it, row) => homeFocus(it, row) }, 1);
const DET = new Rows($('dt-rows'), { focus: (it, row) => detFocus(it, row) }, 2);

const CATS = new VList($('cats'), {
  cols: 1, h: 60, gap: 2,
  make: () => { const n = document.createElement('div'); n.className = 'cat'; return n; },
  fill: (n, it) => { n.textContent = (it.h ? '✕ ' : '') + it.n; n.style.opacity = it.h ? 0.4 : 1; }
});

function makeGrid(mode) {
  $('grid').innerHTML = '';
  const poster = mode !== 'live';
  GRID = new VList($('grid'), {
    w: poster ? 190 : 420, h: poster ? 330 : 84, gap: poster ? 20 : 14,
    make: () => {
      const n = document.createElement('div'); n.className = poster ? 'poster' : 'live';
      n.innerHTML = '<img alt=""><div class="t"></div><b class="star">★</b>';
      n.im = n.children[0]; n.t = n.children[1]; n.s = n.children[2];
      n.im.onerror = () => { n.im.src = BLANK; };
      return n;
    },
    fill: (n, it) => { n.t.textContent = it.n; n.im._s = it.i; n.im.src = BLANK; n.s.style.display = isFav(it) ? 'block' : 'none'; },
    img: n => { const s = n.im._s || BLANK; if (n.im.getAttribute('src') !== s) n.im.src = s; }
  });
  GRID.el.classList.toggle('on', zone === 'grid');
}


/* ================= Bildschirme ================= */
function show(id) {
  screen = id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (id === 'main') { CATS.layout(); CATS.draw(); GRID.layout(); GRID.draw(); }
  if (id !== 'main' && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (id === 'player' || id === 'home' || id === 'detail') setStatus('');
}
function setZone(z) {
  zone = z;
  if (z !== 'top' && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  CATS.el.classList.toggle('on', z === 'cats');
  GRID.el.classList.toggle('on', z === 'grid');
  if (z === 'top') $('tab-' + T).focus();
}

/* ================= Stream-URLs ================= */
function streamUrl(kind, it, fmtx) {
  if (P.type === 'm3u') return it.e;
  const u = `${enc(P.user)}/${enc(P.pass)}`;
  if (kind === 'live') return `${P.server}/live/${u}/${it.id}.${fmtx || 'm3u8'}`;
  if (kind === 'ep') return `${P.server}/series/${u}/${it.id}.${it.e}`;
  return `${P.server}/movie/${u}/${it.id}.${it.e}`;
}
const detTypeOf = it => (it.pt ? it.pt.split('|')[1] : 'vod');

/* ================= Provider-Infos (Plot, Hintergrund, Staffeln) ================= */
function normInfo(j) {
  const i = j.info || {}, b = i.backdrop_path, bd = Array.isArray(b) ? b[0] : b;
  return {
    plot: i.plot || i.description || '', genre: i.genre || '',
    year: String(i.releasedate || i.releaseDate || i.release_date || '').slice(0, 4),
    rating: parseFloat(i.rating) || 0,
    dur: i.duration || (i.episode_run_time ? i.episode_run_time + ' min' : ''),
    bd: bd || '', poster: i.movie_image || i.cover || '', eps: j.episodes || null
  };
}
function libInfo(it, t) {
  if (!P || P.type !== 'xtream' || t === 'live') return Promise.resolve({});
  if (INFO[it.k]) return INFO[it.k];
  const url = apiUrl(P, t === 'series' ? 'get_series_info' : 'get_vod_info', (t === 'series' ? '&series_id=' : '&vod_id=') + enc(it.id));
  INFO[it.k] = getJSON(url).then(normInfo).catch(() => { delete INFO[it.k]; return {}; });
  return INFO[it.k];
}
const infoLine = inf => [inf.year, inf.genre, inf.dur, inf.rating ? '★ ' + inf.rating.toFixed(1) : ''].filter(Boolean).join('  ·  ');

/* ================= Hero ================= */
function paintHero(p, m) {
  $(p + '-k').textContent = m.kind || '';
  $(p + '-t').textContent = m.title || '';
  $(p + '-m').textContent = m.meta || '';
  $(p + '-d').textContent = m.desc || '';
  const b = $(p + '-bd'), u = m.bd || m.poster;
  b.className = 'hbd' + (m.bd ? '' : m.poster ? ' po' : '');
  b.style.backgroundImage = u ? 'url("' + String(u).replace(/"/g, '%22') + '")' : 'none';
}
let feat = null, featT = 0;
async function heroFor(p, it) {
  paintHero(p, { kind: it.kindLabel, title: it.n, meta: it.metaLine, desc: it.ov, bd: it.bd, poster: it.img });
  if (it.lib && it.lt !== 'live') {
    const inf = await libInfo(it.lib, it.lt);
    if (feat !== it) return;
    paintHero(p, { kind: it.kindLabel, title: it.n, meta: [it.metaLine, infoLine(inf)].filter(Boolean).join('  ·  '), desc: inf.plot || it.ov, bd: inf.bd, poster: inf.poster || it.img });
  }
}

/* ================= Startseite ================= */
const TILES = [
  { l: 'Live TV', c: 0, go: 'live' }, { l: 'Filme', c: 1, go: 'vod' }, { l: 'Serien', c: 2, go: 'series' },
  { l: 'Favoriten', c: 3, go: 'fav' }, { l: 'Playlists', c: 4, go: 'pls' }
];
let homeTm = null;
const kindLabel = t => (t === 'series' ? 'SERIE' : t === 'live' ? 'LIVE' : 'FILM');
function contItem(k, v) {
  const ep = v.kind === 'ep';
  return { act: 'cont', feat: true, n: v.n, img: v.i, prog: v.t / v.d, ref: { k, v }, lib: ep ? v.ser : v.it, lt: ep ? 'series' : 'vod', kindLabel: ep ? 'SERIE' : 'FILM', metaLine: 'Weiter bei ' + fmt(v.t) };
}
function libItem(f) {
  const t = detTypeOf(f);
  return { act: 'lib', feat: true, n: f.n, img: f.i, fav: true, ref: f, lib: f, lt: t, kindLabel: kindLabel(t), metaLine: '' };
}
function tmdbItem(x) {
  return { act: 'tmdb', feat: true, n: x.n, img: x.img, bd: x.bd, ov: x.ov, ref: x, kindLabel: x.mt === 'movie' ? 'FILM' : 'SERIE', metaLine: [x.y, x.vote ? '★ ' + x.vote.toFixed(1) : ''].filter(Boolean).join('  ·  ') };
}
function buildHome(keepId, keepX) {
  const cont = Object.keys(pos).filter(k => pos[k].kind && k.indexOf(P.id + '|') === 0)
    .sort((a, b) => pos[b].u - pos[a].u).slice(0, 20).map(k => contItem(k, pos[k]));
  const fav = Object.keys(favs).map(k => favs[k]).filter(f => f.pl === P.id);
  const favP = fav.filter(f => detTypeOf(f) !== 'live').slice(0, 30).map(libItem);
  const favL = fav.filter(f => detTypeOf(f) === 'live').slice(0, 30).map(f => ({ act: 'live', l: f.n, sub: 'Live', ref: f }));
  const tm = homeTm || TM.cached();
  const tmM = tm ? tm.movie.map(tmdbItem) : [], tmT = tm ? tm.tv.map(tmdbItem) : [];
  if (!feat || !feat.act || feat.act === 'tile') feat = cont[0] || tmM[0] || favP[0] || null;
  const rows = [
    { id: 'hero', kind: 'btn', items: feat ? [{ l: '▶  Abspielen', act: 'fplay' }, { l: 'Mehr Infos', act: 'finfo' }] : [] },
    { id: 'tiles', kind: 'tile', items: TILES.map(t => ({ l: t.l, c: t.c, act: 'tile', go: t.go })) },
    { id: 'cont', kind: 'poster', title: 'Weiter schauen', items: cont },
    { id: 'tm', kind: 'poster', title: 'Im Trend – Filme', items: tmM },
    { id: 'tt', kind: 'poster', title: 'Im Trend – Serien', items: tmT },
    { id: 'fav', kind: 'poster', title: 'Favoriten', items: favP },
    { id: 'favl', kind: 'wide', title: 'Live-Favoriten', items: favL }
  ];
  HOME.set(rows, keepId || 'tiles', keepX || 0);
  if (feat) heroFor('hm', feat); else paintHero('hm', { kind: '', title: 'Willkommen', meta: P.name, desc: TM.key() ? 'Lade Trends …' : 'Wähle eine Sparte. Für „Im Trend“ trage unter Playlists deinen TMDB-Key ein.' });
}
function rebuildHome() {
  const r = HOME.row();
  buildHome(r ? r.id : 'tiles', r ? r.x : 0);
}
function showHome() {
  show('home');
  buildHome();
  loadTrends();
}
async function loadTrends() {
  if (!TM.key() || homeTm) return;
  try {
    homeTm = await TM.trends();
    if (screen === 'home') rebuildHome();
  } catch (e) { setStatus('TMDB: ' + e.message); setTimeout(() => setStatus(''), 4000); }
}
function homeFocus(it) {
  if (!it || !it.feat) return;
  feat = it; clearTimeout(featT);
  featT = setTimeout(() => heroFor('hm', it), 280);
}
function browse(t, fav) { show('main'); loadTab(t, fav); }
function homeOk(it) {
  switch (it.act) {
    case 'tile': if (it.go === 'pls') showPls(); else browse(it.go === 'fav' ? 'vod' : it.go, it.go === 'fav'); break;
    case 'fplay': featPlay(); break;
    case 'finfo': featInfo(); break;
    case 'cont': resumeCont(it.ref.k, it.ref.v); break;
    case 'lib': openDetail({ src: 'lib', item: it.ref, t: it.lt }); break;
    case 'tmdb': openDetail({ src: 'tmdb', item: it.ref }); break;
    case 'live': { const r = HOME.row(); playLive(r.items.map(x => x.ref), r.x); break; }
  }
}
function featPlay() {
  const f = feat; if (!f) return;
  if (f.act === 'cont') resumeCont(f.ref.k, f.ref.v);
  else if (f.act === 'lib' && f.lt === 'vod') { const p = pos[f.lib.k]; playLib(f.lib, p ? p.t : 0); }
  else featInfo();
}
function featInfo() {
  const f = feat; if (!f) return;
  if (f.act === 'tmdb') openDetail({ src: 'tmdb', item: f.ref });
  else openDetail({ src: 'lib', item: f.lib, t: f.lt });
}

/* ================= Abspielen ================= */
function playLib(it, from) { openPlayer({ kind: 'vod', it, from, title: it.n, key: it.k, img: it.i }); }
function playLive(list, i) {
  const it = list[i]; if (!it) return;
  openPlayer({ kind: 'live', it, title: it.n, key: it.k, img: it.i, list, idx: i });
}
function flatFrom(series, inf) {
  const eps = inf.eps || {}, flat = [];
  Object.keys(eps).filter(s => Array.isArray(eps[s]) && eps[s].length).sort((x, y) => x - y)
    .forEach(s => eps[s].forEach(e => flat.push({ s, ep: mkEp(series, s, e) })));
  return flat;
}
function resumeCont(k, v) {
  const o = { kind: v.kind, it: v.it, from: v.t, title: v.n, key: k, img: v.i, ser: v.ser };
  openPlayer(o);
  if (v.kind === 'ep' && v.ser) {                      // Folgen-Liste nachladen, damit „Nächste Folge“ geht
    libInfo(v.ser, 'series').then(inf => {
      if (np !== o || !inf || !inf.eps) return;
      const ctx = { item: v.ser, flat: flatFrom(v.ser, inf) };
      const i = ctx.flat.findIndex(f => f.ep.k === k);
      if (i >= 0) o.nextOpts = () => (i + 1 < ctx.flat.length ? epOpts(ctx, i + 1, 0) : null);
    });
  }
}
function mkEp(series, s, e) {
  return {
    k: `${P.id}|ep|${e.id}`, id: e.id, e: e.container_extension || 'mp4', n: `S${s}E${e.episode_num}`,
    title: e.title || '', dur: (e.info && e.info.duration) || '', season: s, i: series.i
  };
}
function epOpts(ctx, idx, from) {
  const f = ctx.flat[idx], ep = f.ep;
  return {
    kind: 'ep', it: ep, from, title: `${ctx.item.n} – ${ep.n} ${ep.title}`.trim(), key: ep.k, img: ctx.item.i, ser: ctx.item,
    nextOpts: () => (idx + 1 < ctx.flat.length ? epOpts(ctx, idx + 1, 0) : null)
  };
}
function afterPlayer() {
  if (screen === 'home') rebuildHome();
  else if (screen === 'detail' && detCtx) refreshDet(detCtx);
  else if (screen === 'main') { GRID.reveal(); GRID.draw(); }
}

/* ================= Detailseite ================= */
let detCtx = null, detStack = [], detFrom = 'home', dtok = 0, seaT = 0;
const favBtn = it => ({ l: favs[it.k] ? '★  In Favoriten' : '☆  Zu Favoriten', act: 'fav' });

function openDetail(ctx, opt) {
  opt = opt || {};
  if (screen !== 'detail') { detFrom = screen; detStack = []; }
  else if (!opt.pop && detCtx) detStack.push(detCtx);
  ctx.t = ctx.t || (ctx.src === 'tmdb' ? (ctx.item.mt === 'movie' ? 'vod' : 'series') : detTypeOf(ctx.item));
  ctx.vers = []; ctx.info = null; ctx.flat = null; ctx.seasons = null; ctx.eps = null; ctx.sel = null; ctx.resumeEp = null; ctx.searching = true;
  detCtx = ctx;
  const my = ++dtok, it = ctx.item;
  show('detail');
  if (ctx.src === 'tmdb') paintHero('dt', { kind: kindLabel(ctx.t), title: it.n, meta: [it.y, it.vote ? '★ ' + it.vote.toFixed(1) : ''].filter(Boolean).join('  ·  '), desc: it.ov, bd: it.bd, poster: it.img });
  else paintHero('dt', { kind: kindLabel(ctx.t), title: it.n, poster: it.i });
  DET.set(buildDetRows(ctx), 'btn', 0);
  if (ctx.src === 'lib') {
    libInfo(it, ctx.t).then(inf => {
      if (my !== dtok) return;
      ctx.info = inf;
      paintHero('dt', { kind: kindLabel(ctx.t), title: it.n, meta: infoLine(inf), desc: inf.plot, bd: inf.bd, poster: inf.poster || it.i });
      if (ctx.t === 'series' && P.type === 'xtream') setupSeries(ctx, inf);
    });
  }
  loadVersions(ctx, my);
}
function setupSeries(ctx, inf) {
  const eps = inf.eps || {};
  const seasons = Object.keys(eps).filter(s => Array.isArray(eps[s]) && eps[s].length).sort((a, b) => a - b);
  ctx.eps = eps; ctx.seasons = seasons; ctx.flat = [];
  seasons.forEach(s => eps[s].forEach(e => ctx.flat.push({ s, ep: mkEp(ctx.item, s, e) })));
  let last = 0; ctx.sel = seasons[0];
  ctx.flat.forEach((f, i) => { const p = pos[f.ep.k]; if (p && (p.u || 0) > last) { last = p.u || 1; ctx.resumeEp = i; ctx.sel = f.s; } });
  refreshDet(ctx);
}
async function loadVersions(ctx, my) {
  const it = ctx.item, tmdb = ctx.src === 'tmdb', t = ctx.t;
  try {
    if (tmdb && P.type === 'xtream' && !await DB.getMeta(`${P.id}|${t}|indexed`)) {
      let last = 0;
      ctx.idxMsg = `Erstmalige Indexierung der Playlist (${TLABEL[t]}) … einmalig, kann etwas dauern`;
      refreshDet(ctx);
      await indexType(P, t, (i, n) => {
        if (my !== dtok || Date.now() - last < 1500) return;
        last = Date.now(); ctx.idxMsg = `Indexiere ${TLABEL[t]}: Kategorie ${i}/${n} …`; refreshDet(ctx);
      });
      if (my !== dtok) return;
    }
    const res = await findMatches(`${P.id}|${t}`, tmdb ? [it.n, it.on] : [it.n], tmdb ? it.y : yearOf(it.n), () => my !== dtok);
    if (my !== dtok) return;
    const names = await catNames(P, t), pre = `${P.id}|${t}|`;
    ctx.vers = res.map(r => {
      const tags = (r.n.match(/\b(4K|UHD|FHD|HDR|HEVC|OV|MULTI|DUAL|ATMOS|1080p|720p)\b/gi) || []).join(' ');
      const cat = names[r.ck.slice(pre.length)] || '';
      const isCur = !tmdb && r.k === it.k;
      return { l: r.n, sub: [isCur ? 'aktuell' : '', cat, tags].filter(Boolean).join(' · '), act: 'open', ref: r, t, cur: isCur };
    });
  } catch (e) { ctx.vers = []; }
  ctx.searching = false; ctx.idxMsg = '';
  refreshDet(ctx);
}
function epItems(ctx) {
  return ((ctx.eps && ctx.eps[ctx.sel]) || []).map(e => {
    const ep = mkEp(ctx.item, ctx.sel, e), p = pos[ep.k];
    return { l: ep.n + (ep.title ? ' – ' + ep.title : ''), sub: [ep.dur, p ? '▶ bei ' + fmt(p.t) : ''].filter(Boolean).join('  ·  '), prog: p ? p.t / p.d : 0, act: 'ep', ref: ep };
  });
}
function buildDetRows(ctx) {
  const it = ctx.item, series = ctx.t === 'series' && P.type === 'xtream', rows = [], btn = [];
  if (ctx.src === 'tmdb') {
    btn.push({ l: ctx.searching ? 'Suche in deiner Playlist …' : ctx.vers.length ? '▶  Abspielen' : 'Nicht in deiner Playlist', act: 'tplay' });
  } else if (series) {
    if (ctx.flat && ctx.flat.length) {
      const i = ctx.resumeEp || 0, f = ctx.flat[i], p = pos[f.ep.k];
      btn.push({ l: p ? `▶  Weiter ${f.ep.n}  ${fmt(p.t)}` : `▶  Abspielen ${f.ep.n}`, act: 'splay', i, from: p ? p.t : 0 });
    }
    btn.push(favBtn(it));
  } else {
    const p = pos[it.k];
    if (p) { btn.push({ l: '▶  Fortsetzen ' + fmt(p.t), act: 'resume' }); btn.push({ l: 'Von vorne', act: 'play' }); }
    else btn.push({ l: '▶  Abspielen', act: 'play' });
    btn.push(favBtn(it));
  }
  rows.push({ id: 'btn', kind: 'btn', items: btn });
  if (series) {
    if (ctx.seasons) {
      rows.push({ id: 'chips', kind: 'chip', items: ctx.seasons.map(s => ({ l: 'Staffel ' + s, act: 'season', s, sel: s === ctx.sel })) });
      rows.push({ id: 'eps', kind: 'wide', title: 'Episoden', items: epItems(ctx) });
    } else rows.push({ id: 'load', kind: 'wide', items: [{ l: 'Lade Staffeln …', act: 'none' }] });
  }
  if (ctx.src === 'tmdb') {
    rows.push({
      id: 'vers', kind: 'wide', title: 'In deiner Playlist verfügbar',
      items: ctx.searching ? [{ l: ctx.idxMsg || 'Suche …', act: 'none' }]
        : ctx.vers.length ? ctx.vers
          : [{ l: 'Keine Treffer', sub: 'Tipp: Playlists → „Index“ (durchsucht alle Kategorien)', act: 'none' }]
    });
  } else rows.push({ id: 'vers', kind: 'wide', title: 'Weitere Versionen & Sprachen', items: ctx.vers.length > 1 ? ctx.vers : [] });
  return rows;
}
function refreshDet(ctx) {
  if (ctx !== detCtx) return;
  const r = DET.row();
  DET.set(buildDetRows(ctx), r ? r.id : 'btn', r ? r.x : 0);
}
function detFocus(it) {
  const ctx = detCtx;
  if (!it || !ctx || it.act !== 'season' || ctx.sel === it.s) return;
  ctx.sel = it.s;
  clearTimeout(seaT);
  seaT = setTimeout(() => {
    if (detCtx !== ctx) return;
    DET.setItems('eps', epItems(ctx));
    const ci = DET.idx('chips');
    if (ci >= 0) DET.rows[ci].cards.forEach((c, i) => c.classList.toggle('sel', DET.rows[ci].items[i].s === ctx.sel));
  }, 150);
}
function detAct(it) {
  const ctx = detCtx; if (!ctx) return;
  switch (it.act) {
    case 'play': playLib(ctx.item, 0); break;
    case 'resume': playLib(ctx.item, pos[ctx.item.k].t); break;
    case 'fav': favToggle(ctx.item); refreshDet(ctx); break;
    case 'open': openDetail({ src: 'lib', item: it.ref, t: it.t }); break;
    case 'splay': openPlayer(epOpts(ctx, it.i, it.from)); break;
    case 'ep': {
      const i = ctx.flat.findIndex(f => f.ep.k === it.ref.k), p = pos[it.ref.k];
      if (i >= 0) openPlayer(epOpts(ctx, i, p ? p.t : 0));
      break;
    }
    case 'tplay':
      if (ctx.vers.length === 1) openDetail({ src: 'lib', item: ctx.vers[0].ref, t: ctx.vers[0].t });
      else if (ctx.vers.length) DET.focusRow('vers');
      break;
  }
}
function detBack() {
  if (detStack.length) { openDetail(detStack.pop(), { pop: true }); return; }
  detCtx = null; ++dtok;
  if (detFrom === 'main') show('main'); else { show('home'); rebuildHome(); }
}

/* ================= Browse (Live / Filme / Serien) ================= */
function activate(i) {
  const it = GRID.items[i]; if (!it) return;
  GRID.idx = i;
  if (T === 'live') playLive(GRID.items, i);
  else openDetail({ src: 'lib', item: it, t: T });
}
function hotkey(n) {
  if (n === 6) { showHome(); return; }
  if (screen === 'main') {
    if (n === 1) { if (CATS.items.length) { CATS.idx = 0; CATS.reveal(); selectCat(0); } }
    else if (n >= 2 && n <= 4) loadTab(['live', 'vod', 'series'][n - 2]);
    else if (n === 5) showPls();
    else if (n === 0) toggleManage();
  } else {
    if (n === 1) browse('vod', true);
    else if (n >= 2 && n <= 4) browse(['live', 'vod', 'series'][n - 2]);
    else if (n === 5) showPls();
  }
}
let exitT = 0;
function exitApp() {
  if (Date.now() - exitT < 2500) { try { tizen.application.getCurrentApplication().exit(); } catch (e) { /* Browser */ } return; }
  exitT = Date.now(); setStatus('Nochmal „Zurück“ drücken zum Beenden');
  setTimeout(() => setStatus(''), 2500);
}

/* ================= Hauptablauf ================= */
async function openPlaylist(p) {
  P = p; LS.set('cur', p.id);
  $('pl-name').textContent = p.name;
  Object.keys(INFO).forEach(k => { delete INFO[k]; });
  homeTm = null; feat = null;
  showHome();
}

async function loadTab(t, fav) {
  T = t; const my = ++tok;
  ['live', 'vod', 'series'].forEach(x => $('tab-' + x).classList.toggle('act', t === x));
  manage = false; $('btn-man').textContent = 'Kategorien';
  $('search').value = '';
  $('title').textContent = 'Kategorie wählen';
  makeGrid(t); GRID.layout(); GRID.draw();
  CATS.sel = -1; CATS.setItems([]);
  setStatus('Lade Kategorien …');
  try {
    const cats = await Src.cats(P, t);
    if (my !== tok) return;
    allCats = cats; CATS.idx = 0; applyCats();
    setStatus('1 = Favoriten · 2/3/4 = Live/Filme/Serien · 0 = Kategorien verwalten');
    setZone('cats');
    if (fav) selectCat(0);
  } catch (e) {
    if (my === tok) setStatus('Fehler: ' + e.message + ' (Zugangsdaten, Server oder CORS prüfen)');
  }
}

async function selectCat(i, stay) {
  const c = CATS.items[i]; if (!c) return;
  CATS.sel = i; CATS.draw();
  const my = ++tok;
  $('title').textContent = c.n;
  setStatus('Lade …');
  try {
    const items = c.id === '__fav'
      ? Object.values(favs).filter(x => x.pt === `${P.id}|${T}`)
      : await Src.items(P, T, c.id);
    if (my !== tok) return;
    GRID.setItems(items);
    setStatus(items.length + ' Einträge');
    if (!stay) setZone('grid');
  } catch (e) {
    if (my === tok) setStatus('Fehler: ' + e.message);
  }
}

let st;
$('search').addEventListener('input', () => { clearTimeout(st); st = setTimeout(runSearch, 450); });
async function runSearch() {
  const raw = $('search').value.trim(), q = raw.toLowerCase();
  if (q.length < 2) { if (CATS.sel >= 0) selectCat(CATS.sel, true); return; }
  const my = ++tok;
  $('title').textContent = 'Suche: ' + raw;
  setStatus('Suche läuft …');
  try {
    const hd = hidden[hKey()] || {}, pre = `${P.id}|${T}|`;
    const r = await DB.scan(`${P.id}|${T}`, q, 500, () => my !== tok, it => !hd[it.ck.slice(pre.length)]);
    if (my !== tok) return;
    GRID.setItems(r);
    const full = P.type === 'm3u' || await DB.getMeta(`${P.id}|${T}|indexed`);
    setStatus(`${r.length}${r.length >= 500 ? '+' : ''} Treffer` + (full ? '' : ' – nur bereits geladene Kategorien (Playlists → Index)'));
  } catch (e) { setStatus('Suchfehler: ' + e.message); }
}

function favToggle(it) {
  if (favs[it.k]) delete favs[it.k]; else favs[it.k] = it;
  LS.set('favs', favs);
  const c = CATS.items[CATS.sel];
  if (c && c.id === '__fav') {
    GRID.items = GRID.items.filter(x => favs[x.k]);
    GRID.idx = Math.min(GRID.idx, Math.max(0, GRID.items.length - 1));
    GRID.layout();
  }
  GRID.pool.forEach(n => { n._i = -2; });
  GRID.draw();
}
function toggleFav() { const it = GRID.cur(); if (it) favToggle(it); }

/* ---- Kategorien ein-/ausblenden ---- */
const hKey = () => `${P.id}|${T}`;
const isHid = c => !!(hidden[hKey()] || {})[c.id];
function applyCats() {
  allCats.forEach(c => { c.h = isHid(c); });
  const list = allCats.filter(c => manage || !c.h), keep = CATS.idx;
  CATS.items = [{ id: '__fav', n: '★ Favoriten' }, ...list];
  CATS.sel = -1; CATS.idx = Math.min(keep, CATS.items.length - 1);
  CATS.layout(); CATS.reveal(); CATS.draw();
}
function toggleManage() {
  manage = !manage; $('btn-man').textContent = manage ? 'Fertig' : 'Kategorien';
  applyCats(); setZone('cats');
  setStatus(manage ? 'Verwalten: OK = ein/aus · Rechts oder Gelb = ganze Gruppe (z. B. [IT]) ein/aus' : 'Gespeichert.');
}
const grp = n => { const m = /^\s*(\[[^\]]*\]|[A-Z]{2,3}\s*[|:])/.exec(n); return m ? m[1] : null; };
function toggleHide(i, group) {
  const c = CATS.items[i]; if (!c || c.id === '__fav') return;
  const g = group ? grp(c.n) : null, to = !c.h;
  const h = hidden[hKey()] = hidden[hKey()] || {};
  (g ? allCats.filter(x => grp(x.n) === g) : [c]).forEach(x => { if (to) h[x.id] = 1; else delete h[x.id]; });
  LS.set('hidden', hidden); applyCats();
  setStatus(g ? `Gruppe ${g}: ${to ? 'ausgeblendet' : 'eingeblendet'}` : (to ? 'Ausgeblendet' : 'Eingeblendet'));
}


/* ================= Playlist-Verwaltung ================= */
function renderPls() {
  const box = $('pl-list'); box.innerHTML = '';
  pls.forEach(p => {
    const r = document.createElement('div'); r.className = 'plrow';
    const nm = document.createElement('span'); nm.className = 'pn';
    nm.textContent = `${p.name} (${p.type === 'm3u' ? 'M3U' : 'Xtream'})`;
    r.appendChild(nm);
    [['Öffnen', () => openPlaylist(p)], ['Bearbeiten', () => editPl(p)],
     ['Neu laden', () => reloadPl(p)], ['Index', () => runIndex(p)]].forEach(([t, f]) => {
      const b = document.createElement('button'); b.textContent = t; b.setAttribute('data-nav', ''); b.onclick = f; r.appendChild(b);
    });
    box.appendChild(r);
  });
  if (!pls.length) setStatus('Noch keine Playlist – unten eine hinzufügen.');
}
function showPls() {
  renderPls(); show('pls'); $('tm-key').value = LS.get('tmdb', '');
  const f = document.querySelector('#pls [data-nav]'); if (f) f.focus();
}
async function reloadPl(p) {
  setStatus('Cache wird geleert …');
  await DB.removePlaylist(p.id);
  openPlaylist(p);
}
let indexing = false;
async function runIndex(p) {
  if (indexing) return; indexing = true;
  try { await indexAll(p); } catch (e) { setStatus('Index-Fehler: ' + e.message); }
  indexing = false;
}

function editPl(p, type) {
  editing = !!p; delArmed = false; $('f-del').textContent = 'Löschen';
  E = p ? Object.assign({}, p) : { id: 'p' + Date.now(), name: '', type: type, server: '', user: '', pass: '', url: '' };
  const m = E.type === 'm3u';
  $('edit-title').textContent = editing ? 'Playlist bearbeiten' : (m ? 'M3U-Playlist hinzufügen' : 'Xtream-Playlist hinzufügen');
  $('l-server').textContent = m ? 'M3U-URL' : 'Server-URL';
  document.querySelector('#edit .xt').style.display = m ? 'none' : '';
  $('f-name').value = E.name; $('f-server').value = m ? E.url : E.server;
  $('f-user').value = E.user; $('f-pass').value = E.pass;
  $('f-del').style.display = editing ? '' : 'none';
  show('edit'); $('f-name').focus();
}
$('add-x').onclick = () => editPl(null, 'xtream');
$('add-m').onclick = () => editPl(null, 'm3u');
$('pl-back').onclick = () => { if (P) showHome(); };
$('btn-pl').onclick = showPls;
$('f-cancel').onclick = showPls;
$('f-save').onclick = async () => {
  const m = E.type === 'm3u', old = pls.find(x => x.id === E.id);
  const v = $('f-server').value.trim();
  const n = Object.assign({}, E, { name: $('f-name').value.trim() || 'Playlist' });
  if (m) n.url = v; else { n.server = v.replace(/\/+$/, ''); n.user = $('f-user').value.trim(); n.pass = $('f-pass').value.trim(); }
  if (!(m ? n.url : n.server && n.user && n.pass)) { setStatus('Bitte alle Felder ausfüllen.'); return; }
  if (old && (old.server !== n.server || old.user !== n.user || old.url !== n.url)) await DB.removePlaylist(n.id);
  const i = pls.findIndex(x => x.id === n.id);
  if (i < 0) pls.push(n); else pls[i] = n;
  LS.set('pls', pls); if (P && P.id === n.id) P = n;
  setStatus(''); showPls();
};
$('f-del').onclick = async () => {
  if (!delArmed) { delArmed = true; $('f-del').textContent = 'Wirklich löschen?'; return; }
  await DB.removePlaylist(E.id);
  pls = pls.filter(x => x.id !== E.id); LS.set('pls', pls);
  Object.keys(favs).forEach(k => { if (favs[k].pl === E.id) delete favs[k]; }); LS.set('favs', favs);
  if (P && P.id === E.id) P = null;
  showPls();
};
document.querySelectorAll('.tab').forEach(b => { b.onclick = () => { if (P) loadTab(b.dataset.tab); }; });
$('btn-man').onclick = () => { if (P) toggleManage(); };
$('btn-home').onclick = () => { if (P) showHome(); };
$('tm-key').onchange = () => { LS.set('tmdb', $('tm-key').value.trim()); localStorage.removeItem('tmdbc'); homeTm = null; };

// Raeumliche Navigation fuer normale DOM-Elemente (Buttons/Inputs mit data-nav)
function navDom(dx, dy) {
  const cur = document.activeElement, root = document.querySelector('.screen.active');
  const els = [...root.querySelectorAll('[data-nav]')].filter(e => e.offsetParent);
  if (!cur || els.indexOf(cur) < 0) { if (els[0]) els[0].focus(); return true; }
  const a = cur.getBoundingClientRect(); let best = null, bs = 1e9;
  els.forEach(e => {
    if (e === cur) return;
    const b = e.getBoundingClientRect();
    const vx = b.left + b.width / 2 - (a.left + a.width / 2), vy = b.top + b.height / 2 - (a.top + a.height / 2);
    if ((dx && vx * dx <= 0) || (dy && vy * dy <= 0)) return;
    const s = (dx ? Math.abs(vx) : Math.abs(vy)) + (dx ? Math.abs(vy) : Math.abs(vx)) * 3;
    if (s < bs) { bs = s; best = e; }
  });
  if (best) { best.focus(); if (best.scrollIntoView) best.scrollIntoView({ block: 'nearest' }); return true; }
  return false;
}


/* ================= Fernbedienung ================= */
try {
  ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
    'MediaRewind', 'MediaFastForward', 'ChannelUp', 'ChannelDown', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
    .forEach(k => { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* Taste nicht verfügbar */ } });
} catch (e) { /* ausserhalb von Tizen */ }

document.addEventListener('keydown', e => {
  const k = e.keyCode;
  const d = { 37: [-1, 0], 38: [0, -1], 39: [1, 0], 40: [0, 1] }[k];
  const ae = document.activeElement, inInput = ae && ae.tagName === 'INPUT';
  const back = k === 10009 || k === 27;
  const num = k >= 48 && k <= 57 ? k - 48 : k >= 96 && k <= 105 ? k - 96 : -1;

  if (screen === 'player') return playerKey(e, k, d);

  if (screen === 'home' || screen === 'detail') {
    const R = screen === 'home' ? HOME : DET;
    if (d) { e.preventDefault(); R.move(d[0], d[1]); }
    else if (k === 13) { e.preventDefault(); const it = R.cur(); if (it) { if (screen === 'home') homeOk(it); else detAct(it); } }
    else if (back) { e.preventDefault(); if (screen === 'home') exitApp(); else detBack(); }
    else if (num >= 0 && P) { e.preventDefault(); hotkey(num); }
    return;
  }

  if (screen !== 'main') {                                   // Playlists / Formular
    if (back) { e.preventDefault(); if (screen === 'edit') showPls(); else if (P) showHome(); else exitApp(); return; }
    if (inInput && (k === 37 || k === 39)) return;
    if (d) { e.preventDefault(); navDom(d[0], d[1]); }
    else if (k === 13 && ae && ae.tagName === 'BUTTON') { e.preventDefault(); ae.click(); }
    return;
  }

  // ---- Browse (Kategorien + Raster) ----
  if (num >= 0 && !inInput && P) { e.preventDefault(); hotkey(num); return; }
  if (back) {
    e.preventDefault();
    if (inInput) { ae.blur(); setZone('cats'); }
    else if (manage) toggleManage();
    else if (zone !== 'cats') setZone('cats');
    else showHome();
    return;
  }
  if (zone === 'top') {
    if (inInput && (k === 37 || k === 39)) return;           // Cursor im Textfeld
    if (d) { e.preventDefault(); if (!navDom(d[0], d[1]) && d[1] > 0) setZone('cats'); }
    else if (k === 13) {
      e.preventDefault();
      if (inInput) { runSearch(); setZone('grid'); } else if (ae) ae.click();
    }
  } else if (zone === 'cats') {
    if (d) {
      e.preventDefault();
      if (d[0] > 0) { if (manage) toggleHide(CATS.idx, true); else if (GRID.items.length) setZone('grid'); }
      else if (!CATS.move(d[0], d[1]) && d[1] < 0) setZone('top');
    }
    else if (k === 13) { e.preventDefault(); if (manage) toggleHide(CATS.idx, false); else selectCat(CATS.idx); }
    else if (manage && k === 405) { e.preventDefault(); toggleHide(CATS.idx, true); }
  } else if (zone === 'grid') {
    if (d) { e.preventDefault(); if (!GRID.move(d[0], d[1])) { if (d[0] < 0) setZone('cats'); else if (d[1] < 0) setZone('top'); } }
    else if (k === 13) { e.preventDefault(); activate(GRID.idx); }
    else if (k === 403 || k === 405 || k === 70) { e.preventDefault(); toggleFav(); }
  }
});

/* ================= Start ================= */
makeGrid('live');
if (pls.length) {
  const last = pls.find(p => p.id === LS.get('cur', '')) || pls[0];
  openPlaylist(last);
} else {
  showPls();
}

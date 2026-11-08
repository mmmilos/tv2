'use strict';
/* ================= Virtuelle Liste =================
   Nur sichtbare Zeilen existieren als DOM-Elemente, Knoten werden recycelt. */
class VList {
  constructor(el, o) {
    this.el = el; this.o = o; this.items = []; this.idx = 0; this.top = 0; this.sel = -1;
    this.pool = []; this.size = 0; this.cols = 1;
    this.inner = document.createElement('div'); this.inner.className = 'vi';
    el.appendChild(this.inner);
  }
  layout() {
    const W = this.el.clientWidth, H = this.el.clientHeight, o = this.o, g = o.gap || 0;
    if (!W) return;
    this.cols = o.cols || Math.max(1, Math.floor((W + g) / (o.w + g)));
    this.cw = (W + g) / this.cols - g; this.rh = o.h + g; this.H = H;
    this.size = (Math.ceil(H / this.rh) + 2) * this.cols;
    while (this.pool.length < this.size) {
      const n = o.make(); n.className += ' cell'; this.inner.appendChild(n); this.pool.push(n);
    }
    this.pool.forEach(n => { n.style.width = this.cw + 'px'; n.style.height = o.h + 'px'; n._i = -2; });
  }
  setItems(a) { this.items = a; this.idx = 0; this.top = 0; this.layout(); this.draw(); }
  draw() {
    if (!this.size) return;
    const c = this.cols, g = this.o.gap || 0;
    const first = Math.floor(this.top / this.rh) * c, end = this.items.length;
    this.inner.style.transform = `translate3d(0,${-this.top}px,0)`;
    for (let i = first; i < first + this.size; i++) {
      const n = this.pool[i % this.size];
      if (i >= end) { if (n._i !== -1) { n.style.display = 'none'; n._i = -1; } continue; }
      if (n._i !== i) {
        n._i = i; n.style.display = '';
        n.style.transform = `translate3d(${(i % c) * (this.cw + g)}px,${Math.floor(i / c) * this.rh}px,0)`;
        this.o.fill(n, this.items[i]);
      }
      n.classList.toggle('f', i === this.idx);
      n.classList.toggle('sel', i === this.sel);
    }
    if (this.o.img) { clearTimeout(this.t); this.t = setTimeout(() => this.imgs(), 150); }
  }
  // Bilder erst laden, wenn der Cursor kurz stillsteht und der Eintrag sichtbar ist
  imgs() {
    for (const n of this.pool) {
      if (n._i < 0) continue;
      const y = Math.floor(n._i / this.cols) * this.rh;
      if (y + this.rh > this.top && y < this.top + this.H) this.o.img(n);
    }
  }
  reveal() {
    const r = Math.floor(this.idx / this.cols) * this.rh;
    if (r < this.top) this.top = r;
    else if (r + this.rh > this.top + this.H) this.top = r + this.rh - this.H;
  }
  move(dx, dy) {
    const c = this.cols, n = this.items.length; let i = this.idx;
    if (!n) return false;
    if (dx) { const j = i + dx; if (j < 0 || j >= n || Math.floor(j / c) !== Math.floor(i / c)) return false; i = j; }
    if (dy) {
      let j = i + dy * c;
      if (j < 0) return false;
      if (j >= n) { if (Math.floor(i / c) === Math.floor((n - 1) / c)) return false; j = n - 1; }
      i = j;
    }
    this.idx = i; this.reveal(); this.draw(); return true;
  }
  cur() { return this.items[this.idx]; }
}


/* ================= Hilfsfunktionen ================= */
const fmt = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
};
const mk = (cls, txt) => {
  const n = document.createElement('div');
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
// Titel vereinheitlichen: Kleinbuchstaben, ohne Akzente, ohne [..] (..) und Qualitäts-Tags
function norm(s) {
  s = String(s || '').toLowerCase();
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { /* alt */ }
  s = s.replace(/^\s*(\[[a-z]{2,3}\]|\|[a-z]{2,3}\||\([a-z]{2,3}\)|(?:de|at|ch|en|us|uk|fr|it|es|tr|nl|pl|ru|pt|ar|ex)\s*[:|\-\u2013])\s*/, '');   // Länderpräfix wie [DE] | DE: |DE|
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(4k|uhd|fhd|hd|sd|hdr|hevc|x265|1080p|720p|2160p|bluray|german|deutsch|dubbed|multi|ac3)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function yearOf(s) { const m = /\b(19|20)\d{2}\b/.exec(String(s || '')); return m ? +m[0] : 0; }

/* ================= Rows: Netflix-artige Zeilen =================
   Jede Zeile ist horizontal scrollbar, der Fokus wandert per Pfeiltasten.
   Zeilenarten: btn (Buttons), tile (Kacheln), poster, wide (Textkarten), chip (Staffeln) */
const KIND = {
  btn: { h: 64, gap: 16 },
  tile: { h: 110, w: 300, gap: 20 },
  poster: { h: 330, w: 190, gap: 18 },
  wide: { h: 92, w: 420, gap: 16 },
  chip: { h: 56, w: 170, gap: 12 }
};
const CARD = {
  btn(it) { const n = mk('hb', it.l); n._w = Math.max(220, 70 + it.l.length * 14); return n; },
  tile(it) { return mk('tile c' + it.c, it.l); },
  poster(it) {
    const n = mk('pc'), im = document.createElement('img');
    im.alt = ''; im.onerror = () => { im.src = BLANK; };
    n.im = im; n._s = it.img || '';
    n.appendChild(im);
    if (it.prog) {
      const p = mk('pp'), i = document.createElement('i');
      i.style.width = Math.min(100, Math.round(it.prog * 100)) + '%';
      p.appendChild(i); n.appendChild(p);
    }
    n.appendChild(mk('pt', it.n));
    if (it.fav) { const s = mk('star', '★'); s.style.display = 'block'; n.appendChild(s); }
    return n;
  },
  wide(it) {
    const n = mk('wc');
    n.appendChild(mk('a', it.l)); n.appendChild(mk('b', it.sub || ''));
    if (it.prog) {
      const p = mk('wp'), i = document.createElement('i');
      i.style.width = Math.min(100, Math.round(it.prog * 100)) + '%';
      p.appendChild(i); n.appendChild(p);
    }
    if (it.cur) n.classList.add('cur');
    return n;
  },
  chip(it) { const n = mk('chip', it.l); if (it.sel) n.classList.add('sel'); return n; }
};

class Rows {
  constructor(el, cb, scrollFrom) {
    this.el = el; this.cb = cb || {}; this.scrollFrom = scrollFrom || 1;
    this.inner = mk('ri'); el.appendChild(this.inner);
    this.rows = []; this.r = 0; this.fe = null;
  }
  set(rows, r, x) {
    this.inner.innerHTML = ''; this.fe = null;
    this.rows = rows.filter(w => w.items.length || w.keep);
    let y = 0;
    this.rows.forEach(w => {
      const K = KIND[w.kind];
      w.y = y; w.sx = 0; w.x = 0;
      const box = mk('rw'); box.style.top = y + 'px';
      if (w.title) box.appendChild(mk('rt', w.title));
      w.strip = mk('rs'); w.strip.style.height = K.h + 'px';
      box.appendChild(w.strip); this.inner.appendChild(box);
      this.fill(w);
      y += (w.title ? 44 : 0) + K.h + 34;
    });
    let ri = typeof r === 'string' ? this.idx(r) : (r || 0);
    this.r = Math.max(0, Math.min(ri, this.rows.length - 1));
    const w = this.rows[this.r];
    if (w) w.x = Math.max(0, Math.min(x || 0, w.items.length - 1));
    this.draw();
  }
  fill(w) {
    const K = KIND[w.kind];
    w.strip.innerHTML = ''; w.cards = []; w.pos = [];
    let px = 0;
    w.items.forEach(it => {
      const n = CARD[w.kind](it), cw = n._w || K.w;
      n.style.left = px + 'px'; n.style.width = cw + 'px';
      w.strip.appendChild(n); w.cards.push(n); w.pos.push({ x: px, w: cw });
      px += cw + K.gap;
    });
    this.lazy(w, 0, 7);
  }
  lazy(w, a, b) {
    if (w.kind !== 'poster') return;
    for (let i = Math.max(0, a); i <= Math.min(w.cards.length - 1, b); i++) {
      const c = w.cards[i];
      if (!c._l) { c._l = 1; c.im.src = c._s || BLANK; }
    }
  }
  draw() {
    const w = this.rows[this.r]; if (!w) return;
    const W = this.el.clientWidth || 1920, p = w.pos[w.x];
    if (p) {
      if (p.x + p.w - w.sx > W - 140) w.sx = p.x + p.w - W + 140;
      if (p.x - w.sx < 0) w.sx = p.x;
    }
    w.strip.style.transform = 'translate3d(' + (-w.sx) + 'px,0,0)';
    if (this.fe) this.fe.classList.remove('rf');
    const c = w.cards[w.x];
    if (c) { c.classList.add('rf'); this.fe = c; }
    this.inner.style.transform = 'translate3d(0,' + (-(this.r >= this.scrollFrom ? w.y - 6 : 0)) + 'px,0)';
    this.lazy(w, w.x - 3, w.x + 10);
    [-1, 1, 2].forEach(o => { const n = this.rows[this.r + o]; if (n) this.lazy(n, 0, 9); });
  }
  move(dx, dy) {
    const w = this.rows[this.r]; if (!w) return false;
    if (dx) {
      const nx = w.x + dx;
      if (nx < 0 || nx >= w.items.length) return false;
      w.x = nx;
    } else if (dy) {
      const nr = this.r + dy;
      if (nr < 0 || nr >= this.rows.length) return false;
      this.r = nr;
    } else return false;
    this.draw(); this.fire(); return true;
  }
  fire() { if (this.cb.focus) this.cb.focus(this.cur(), this.row()); }
  cur() { const w = this.rows[this.r]; return w && w.items[w.x]; }
  row() { return this.rows[this.r]; }
  idx(id) { for (let i = 0; i < this.rows.length; i++) if (this.rows[i].id === id) return i; return -1; }
  setItems(id, items) {
    const i = this.idx(id); if (i < 0) return;
    const w = this.rows[i]; w.items = items; w.x = 0; w.sx = 0;
    this.fill(w); this.draw();
  }
  focusRow(id) { const i = this.idx(id); if (i >= 0) { this.r = i; this.draw(); this.fire(); } }
}

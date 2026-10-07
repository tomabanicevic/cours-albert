/* Cours Albert 3 — carte du monde hors ligne (Natural Earth), épingles des publications et choix d’un lieu. */
'use strict';

const GEO = { world: null, cities: null, loading: null };
GEO.load = function () {
  if (GEO.loading) return GEO.loading;
  const base = E.mode === 'guest' ? '/app/' : '';
  GEO.loading = Promise.all([fetch(`${base}vendor/world-50m.json`).then(r => r.json()), fetch(`${base}vendor/cities.json`).then(r => r.json())]).then(([w, c]) => {
    const WORLD = 1024;
    const path = new Path2D();
    const draw = (pts, shift) => { pts.forEach(([lng, lat], i) => { const [px, py] = GEO.project(lat, lng + shift, WORLD); if (i === 0) path.moveTo(px, py); else path.lineTo(px, py); }); path.closePath(); };
    for (const country of w.c) for (const ring of country.r) {
      // Décodage, puis « déroulage » des anneaux qui traversent l’antiméridien (Russie, Fidji…) pour éviter des traits parasites.
      let x = 0, y = 0, prev = null, offset = 0, min = Infinity, max = -Infinity;
      const pts = [];
      for (let i = 0; i < ring.length; i += 2) {
        x += ring[i]; y += ring[i + 1];
        let lng = x / w.q;
        if (prev !== null && Math.abs(lng + offset - prev) > 180) offset += lng + offset < prev ? 360 : -360;
        lng += offset;
        prev = lng; min = Math.min(min, lng); max = Math.max(max, lng);
        pts.push([lng, y / w.q]);
      }
      draw(pts, 0);
      if (max > 180) draw(pts, -360);
      if (min < -180) draw(pts, 360);
    }
    GEO.world = { path, size: WORLD };
    let names;
    try { names = new Intl.DisplayNames(['fr'], { type: 'region' }); } catch { names = null; }
    GEO.cities = c.map(([fr, en, iso, lat, lng]) => ({ name: fr || en, alt: en, country: (iso && names ? (() => { try { return names.of(iso); } catch { return iso; } })() : iso) || '', lat, lng, key: normalize(`${fr} ${en}`) }));
    return GEO;
  }).catch(err => { GEO.loading = null; throw err; });
  return GEO.loading;
};
GEO.project = (lat, lng, size) => {
  const la = clamp(lat, -85.05, 85.05) * Math.PI / 180;
  return [(lng + 180) / 360 * size, (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * size];
};
GEO.unproject = (x, y, size) => {
  const lng = x / size * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y / size;
  return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng];
};
GEO.search = function (q, limit = 8) {
  const n = normalize(q).trim();
  if (!n || !GEO.cities) return [];
  const starts = [], contains = [];
  for (const c of GEO.cities) { if (c.key.startsWith(n) || normalize(c.alt).startsWith(n)) starts.push(c); else if (c.key.includes(n)) contains.push(c); if (starts.length >= limit) break; }
  return [...starts, ...contains].slice(0, limit);
};
GEO.nearest = function (lat, lng) {
  if (!GEO.cities) return null;
  let best = null, bd = Infinity;
  for (const c of GEO.cities) { const d = Math.hypot((c.lat - lat), (c.lng - lng) * Math.cos(lat * Math.PI / 180)); if (d < bd) { bd = d; best = c; } }
  return best && bd < 1.2 ? best : null;
};
GEO.label = (lat, lng) => { const c = GEO.nearest(lat, lng); return c ? `${c.name}${c.country ? `, ${c.country}` : ''}` : `${lat.toFixed(3)}, ${lng.toFixed(3)}`; };

class WorldMap {
  constructor(host, { onClick, onPin, pins = [], interactiveClick = true } = {}) {
    this.host = host;
    this.onClick = onClick; this.onPin = onPin; this.pins = pins; this.interactiveClick = interactiveClick;
    host.classList.add('worldmap');
    host.innerHTML = `<canvas></canvas><div class="wm-pins"></div><div class="wm-zoom"><button data-wm="in" title="Zoomer">${I.plus}</button><button data-wm="out" title="Dézoomer">${I.minus}</button><button data-wm="fit" title="Tout afficher">${I.fit}</button></div><div class="wm-credit">Natural Earth</div>`;
    this.canvas = host.querySelector('canvas');
    this.pinsEl = host.querySelector('.wm-pins');
    this.k = 1; this.tx = 0; this.ty = 0;
    this.dpr = window.devicePixelRatio || 1;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.bind();
    GEO.load().then(() => { if (this.destroyed) return; this.resize(); this.fit(); }).catch(() => { host.insertAdjacentHTML('beforeend', '<div class="wm-error">Carte indisponible.</div>'); });
  }
  get size() { return GEO.world?.size || 1024; }
  resize() {
    const r = this.host.getBoundingClientRect();
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.canvas.width = this.w * this.dpr; this.canvas.height = this.h * this.dpr;
    this.canvas.style.width = `${this.w}px`; this.canvas.style.height = `${this.h}px`;
    if (!this.k || this.k < this.minK()) this.k = this.minK();
    this.clampView(); this.draw();
  }
  minK() { return Math.max(this.w / this.size, this.h / (this.size * 0.82)) * 0.98; }
  clampView() {
    const W = this.size * this.k, H = this.size * this.k;
    this.tx = W <= this.w ? (this.w - W) / 2 : clamp(this.tx, this.w - W, 0);
    const top = this.size * 0.06 * this.k, bottom = this.size * 0.88 * this.k;
    this.ty = (bottom - top) <= this.h ? (this.h - (bottom + top)) / 2 : clamp(this.ty, this.h - bottom, -top);
  }
  toScreen(lat, lng) { const [x, y] = GEO.project(lat, lng, this.size); return [x * this.k + this.tx, y * this.k + this.ty]; }
  toGeo(sx, sy) { return GEO.unproject((sx - this.tx) / this.k, (sy - this.ty) / this.k, this.size); }
  draw() {
    if (!GEO.world || this.destroyed) return;
    const g = this.canvas.getContext('2d');
    const css = getComputedStyle(this.host);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = css.getPropertyValue('--sea').trim() || '#cfe3f5';
    g.fillRect(0, 0, this.w, this.h);
    g.setTransform(this.dpr * this.k, 0, 0, this.dpr * this.k, this.dpr * this.tx, this.dpr * this.ty);
    g.fillStyle = css.getPropertyValue('--land').trim() || '#f4f1ea';
    g.fill(GEO.world.path, 'evenodd');
    g.lineWidth = 0.7 / this.k;
    g.strokeStyle = css.getPropertyValue('--border-line').trim() || '#b9b2a5';
    g.stroke(GEO.world.path);
    this.placePins();
  }
  setPins(pins) { this.pins = pins; this.renderPins(); }
  renderPins() {
    this.pinsEl.innerHTML = this.pins.map(p => `<button class="map-pin ${p.cls || ''}" data-pin="${attr(p.id)}" style="--pin:${attr(p.color || 'var(--accent)')}" title="${attr(p.label || '')}"><span class="pin-body"><span class="pin-in">${p.html || ''}</span></span></button>`).join('');
    this.placePins();
  }
  placePins() {
    for (const el of this.pinsEl.children) {
      const p = this.pins.find(x => x.id === el.dataset.pin);
      if (!p) continue;
      const [x, y] = this.toScreen(p.lat, p.lng);
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.display = x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40 ? 'none' : '';
    }
  }
  zoomAt(factor, sx = this.w / 2, sy = this.h / 2) {
    const k = clamp(this.k * factor, this.minK(), 600);
    const f = k / this.k;
    this.tx = sx - (sx - this.tx) * f; this.ty = sy - (sy - this.ty) * f; this.k = k;
    this.clampView(); this.draw();
  }
  fit() {
    const pts = this.pins.map(p => GEO.project(p.lat, p.lng, this.size));
    if (!pts.length) { this.k = this.minK(); this.tx = 0; this.ty = 0; this.clampView(); this.draw(); return; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const k = clamp(Math.min(this.w / Math.max(8, (maxX - minX) * 1.5), this.h / Math.max(8, (maxY - minY) * 1.6), 60), this.minK(), 600);
    this.k = k; this.tx = this.w / 2 - (minX + maxX) / 2 * k; this.ty = this.h / 2 - (minY + maxY) / 2 * k;
    this.clampView(); this.draw();
  }
  flyTo(lat, lng, k = Math.max(this.k, 12)) {
    const [x, y] = GEO.project(lat, lng, this.size);
    this.k = clamp(k, this.minK(), 600); this.tx = this.w / 2 - x * this.k; this.ty = this.h / 2 - y * this.k;
    this.clampView(); this.draw();
  }
  bind() {
    const c = this.host;
    c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 1.2 && !e.shiftKey) this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0025)), e.clientX - r.left, e.clientY - r.top); else { this.tx -= e.deltaX; this.ty -= e.deltaY; this.clampView(); this.draw(); } }, { passive: false });
    c.addEventListener('click', e => {
      const z = e.target.closest('[data-wm]');
      if (z) { e.stopPropagation(); if (z.dataset.wm === 'in') this.zoomAt(1.8); else if (z.dataset.wm === 'out') this.zoomAt(1 / 1.8); else this.fit(); return; }
      const pin = e.target.closest('[data-pin]');
      if (pin) { e.stopPropagation(); this.onPin?.(pin.dataset.pin); return; }
      if (this.moved || !this.interactiveClick || !this.onClick || e.target !== this.canvas) return;
      const r = c.getBoundingClientRect();
      const [lat, lng] = this.toGeo(e.clientX - r.left, e.clientY - r.top);
      this.onClick(lat, lng);
    });
    c.addEventListener('dblclick', e => { if (e.target !== this.canvas) return; const r = c.getBoundingClientRect(); this.zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
    const touches = new Map();
    let pinch = null;
    c.addEventListener('pointerdown', e => {
      if (e.target.closest('[data-wm], [data-pin]')) return;
      c.setPointerCapture(e.pointerId);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.moved = false;
      this.drag = { x: e.clientX, y: e.clientY, tx: this.tx, ty: this.ty };
      if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.k }; }
    });
    c.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinch) {
        const [a, b] = [...touches.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const r = c.getBoundingClientRect();
        this.zoomAt((pinch.k * d / pinch.d) / this.k, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        this.moved = true; return;
      }
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.moved = true;
      this.tx = this.drag.tx + dx; this.ty = this.drag.ty + dy;
      this.clampView(); this.draw();
    });
    const up = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; if (!touches.size) this.drag = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    this.mq = window.matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => this.draw();
    this.mq.addEventListener?.('change', this.onScheme);
  }
  destroy() { this.destroyed = true; this.ro.disconnect(); this.mq?.removeEventListener?.('change', this.onScheme); this.host.innerHTML = ''; }
}

// ======================= Disposition « Carte » d’un tableau =======================
E.mountMap = function (host, list) {
  const mapHost = host.querySelector('.map-host'), side = host.querySelector('.map-side');
  const placed = list.filter(p => p.location), unplaced = list.filter(p => !p.location);
  const pinFor = p => {
    const img = (p.attachments || []).find(a => ['image', 'drawing'].includes(a.kind));
    return { id: p.id, lat: p.location.lat, lng: p.location.lng, label: p.title || p.location.label, color: p.color && !E.isDark(p.color) ? 'var(--accent)' : 'var(--accent)', html: img ? `<img src="${attr(E.mediaUrl(img.file))}" alt="">` : `<span>${esc((p.title || MD.plain(p.body) || '•').slice(0, 1).toUpperCase())}</span>` };
  };
  if (!E.map || E.map.host !== mapHost) {
    E.map?.destroy();
    E.map = new WorldMap(mapHost, {
      pins: placed.map(pinFor),
      onPin: id => E.openPost(id),
      onClick: E.can('post') ? (lat, lng) => { GEO.load().then(() => E.compose({ })).then(() => { if (E.composer) { E.composer.c.location = { lat, lng, label: GEO.label(lat, lng) }; E.renderComposer(); } }); } : null,
    });
  }
  E.map.setPins(placed.map(pinFor));
  side.innerHTML = `<div class="ms-head"><b>${plural(placed.length, 'lieu')}</b>${E.can('post') ? '<span class="muted">Cliquez sur la carte pour publier à cet endroit.</span>' : ''}</div>
    <div class="ms-list">${E.sortList(placed).map(p => `<button class="ms-item" data-fly="${attr(p.id)}">${I.pin}<span><b>${esc(p.title || MD.plain(p.body).slice(0, 60) || 'Publication')}</b><small>${esc(p.location.label || '')}</small></span></button>`).join('') || '<p class="muted">Aucune publication n’a encore de lieu.</p>'}</div>
    ${unplaced.length ? `<div class="ms-head"><b>Sans lieu (${unplaced.length})</b></div><div class="ms-list">${unplaced.map(p => `<div class="ms-item"><span><b>${esc(p.title || MD.plain(p.body).slice(0, 60) || 'Publication')}</b></span>${p.mine || E.can('moderate') ? `<button class="btn sm" data-place="${attr(p.id)}">${I.pin}Placer</button>` : ''}</div>`).join('')}</div>` : ''}`;
  side.onclick = async e => {
    const fly = e.target.closest('[data-fly]');
    if (fly) { const p = E.space.posts.find(x => x.id === fly.dataset.fly); if (p) { E.map.flyTo(p.location.lat, p.location.lng); const pin = E.map.pinsEl.querySelector(`[data-pin="${CSS.escape(p.id)}"]`); pin?.classList.add('pulse'); setTimeout(() => pin?.classList.remove('pulse'), 1600); } return; }
    const place = e.target.closest('[data-place]');
    if (place) {
      const p = E.space.posts.find(x => x.id === place.dataset.place);
      const loc = await E.pickLocation(null);
      if (loc && p) { try { const { post } = await E.api('PATCH', `/spaces/${E.space.id}/posts/${p.id}`, { location: loc }); E.upsertPost(post); } catch (err) { toast(err.message, 'error'); } }
    }
  };
};

// ======================= Choix d’un lieu =======================
E.pickLocation = function (current) {
  return new Promise(resolve => {
    let picked = current ? { ...current } : null;
    let done = false;
    const box = UI.modal(`<div class="loc-pick"><div class="sheet-head"><h2>${I.pin}Choisir un lieu</h2><button class="btn icon ghost" data-lp="close">${I.close}</button></div>
      <div class="lp-search"><div class="search-box">${I.search}<input class="input" placeholder="Une ville : Paris, Bruxelles, Rome, Tokyo…" data-lp-q autofocus></div><div class="lp-results"></div></div>
      <div class="lp-map"></div>
      <div class="lp-foot"><span class="lp-label">${picked ? esc(picked.label || '') : 'Cliquez sur la carte ou cherchez une ville.'}</span><span class="grow"></span><button class="btn" data-lp="close">Annuler</button><button class="btn primary" data-lp="ok" ${picked ? '' : 'disabled'}>Choisir</button></div></div>`, { cls: 'sheet wide loc-sheet', onClose: () => { map.destroy(); if (!done) resolve(null); } });
    const setPick = (lat, lng, label) => {
      picked = { lat: Math.round(lat * 10000) / 10000, lng: Math.round(lng * 10000) / 10000, label: label || GEO.label(lat, lng) };
      map.setPins([{ id: 'pick', lat: picked.lat, lng: picked.lng, label: picked.label, cls: 'pick', html: I.pin }]);
      box.querySelector('.lp-label').innerHTML = `${I.pin}<input class="input sm" value="${attr(picked.label)}" data-lp-label>`;
      box.querySelector('[data-lp="ok"]').disabled = false;
    };
    const map = new WorldMap(box.querySelector('.lp-map'), { pins: picked ? [{ id: 'pick', lat: picked.lat, lng: picked.lng, cls: 'pick', html: I.pin }] : [], onClick: (lat, lng) => setPick(lat, lng) });
    if (picked) GEO.load().then(() => setTimeout(() => map.flyTo(picked.lat, picked.lng, 8), 50));
    box.addEventListener('input', e => {
      if (e.target.matches('[data-lp-q]')) {
        GEO.load().then(() => {
          const res = GEO.search(e.target.value);
          box.querySelector('.lp-results').innerHTML = res.map((c, i) => `<button data-city="${i}">${I.pin}<b>${esc(c.name)}</b><span>${esc(c.country)}</span></button>`).join('');
          box._res = res;
        });
      }
      if (e.target.matches('[data-lp-label]') && picked) picked.label = e.target.value;
    });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-lp-q]')) { e.preventDefault(); box.querySelector('[data-city]')?.click(); } });
    box.addEventListener('click', e => {
      const city = e.target.closest('[data-city]');
      if (city) { const c = box._res[+city.dataset.city]; setPick(c.lat, c.lng, `${c.name}${c.country ? `, ${c.country}` : ''}`); map.flyTo(c.lat, c.lng, 24); box.querySelector('.lp-results').innerHTML = ''; return; }
      const b = e.target.closest('[data-lp]');
      if (!b) return;
      if (b.dataset.lp === 'close') UI.close(box);
      if (b.dataset.lp === 'ok' && picked) { done = true; resolve(picked); UI.close(box); }
    });
  });
};

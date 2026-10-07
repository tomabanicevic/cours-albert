/* Cours Albert 3 — disposition « Libre » : cartes déplaçables sur une surface, reliées par des flèches (cartes mentales, réseaux d’idées). */
'use strict';

E.freeCardWidth = () => ({ s: 220, m: 280, l: 360 }[E.space?.theme?.size || 'm']);
E.freePos = function (list) {
  const w = E.freeCardWidth();
  const sorted = E.sortList(list, 'manual');
  let auto = 0;
  return new Map(sorted.map(p => [p.id, p.pos || { x: 60 + (auto % 5) * (w + 50), y: 60 + Math.floor(auto++ / 5) * 380 }]));
};
E.layFree = function (list) {
  const pos = E.freePos(list);
  E.ui.free ||= { x: 0, y: 0, k: 1 };
  const v = E.ui.free;
  const w = E.freeCardWidth();
  return `<div class="lay-free ${E.ui.linking ? 'linking' : ''}"><div class="free-surface" style="transform:translate(${v.x}px,${v.y}px) scale(${v.k})">
      <svg class="free-links"><defs><marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="currentColor"/></marker></defs></svg>
      ${list.map(p => E.postHTML(p, { extraClass: 'free-card', style: `left:${pos.get(p.id).x}px;top:${pos.get(p.id).y}px;width:${w}px;` })).join('')}
    </div>
    <div class="free-tools">
      ${E.can('edit') || E.can('moderate') ? `<button class="btn sm ${E.ui.linking ? 'primary' : ''}" data-free="link" title="Relier deux publications par une flèche">${I.arrow}${E.ui.linking ? (E.ui.linkFrom ? 'Choisissez la 2ᵉ carte…' : 'Choisissez la 1ʳᵉ carte…') : 'Relier'}</button>` : ''}
      <button class="btn icon sm" data-free="out" title="Dézoomer">${I.minus}</button><span class="zoom-val">${Math.round(v.k * 100)} %</span><button class="btn icon sm" data-free="in" title="Zoomer">${I.plus}</button><button class="btn icon sm" data-free="fit" title="Tout afficher">${I.fit}</button>
    </div></div>`;
};
E.freeApply = function () {
  const host = E.mounted?.el.querySelector('.lay-free');
  if (!host) return;
  const v = E.ui.free;
  host.querySelector('.free-surface').style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
  const z = host.querySelector('.zoom-val'); if (z) z.textContent = `${Math.round(v.k * 100)} %`;
};
E.freeZoom = function (factor, cx, cy) {
  const host = E.mounted?.el.querySelector('.lay-free');
  if (!host) return;
  const r = host.getBoundingClientRect();
  const v = E.ui.free;
  const k = clamp(v.k * factor, 0.2, 2.5), f = k / v.k;
  const x = (cx ?? r.left + r.width / 2) - r.left, y = (cy ?? r.top + r.height / 2) - r.top;
  v.x = x - (x - v.x) * f; v.y = y - (y - v.y) * f; v.k = k;
  E.freeApply();
};
E.freeFit = function () {
  const host = E.mounted?.el.querySelector('.lay-free');
  if (!host) return;
  const cards = [...host.querySelectorAll('.free-card')];
  if (!cards.length) { E.ui.free = { x: 0, y: 0, k: 1 }; return E.freeApply(); }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) { const x = parseFloat(c.style.left), y = parseFloat(c.style.top); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + c.offsetWidth); maxY = Math.max(maxY, y + c.offsetHeight); }
  const r = host.getBoundingClientRect();
  const k = clamp(Math.min((r.width - 60) / (maxX - minX), (r.height - 90) / (maxY - minY)), 0.2, 1.2);
  E.ui.free = { k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: 30 + (r.height - 60 - (maxY - minY) * k) / 2 - minY * k };
  E.freeApply();
};
E.freeLinks = function () {
  const host = E.mounted?.el.querySelector('.lay-free');
  if (!host) return;
  const svg = host.querySelector('.free-links');
  const cards = new Map([...host.querySelectorAll('.free-card')].map(c => [c.dataset.post, c]));
  let maxX = 2000, maxY = 1400;
  for (const c of cards.values()) { maxX = Math.max(maxX, parseFloat(c.style.left) + c.offsetWidth + 400); maxY = Math.max(maxY, parseFloat(c.style.top) + c.offsetHeight + 400); }
  svg.setAttribute('width', maxX); svg.setAttribute('height', maxY);
  svg.style.width = `${maxX}px`; svg.style.height = `${maxY}px`;
  const box = c => ({ x: parseFloat(c.style.left), y: parseFloat(c.style.top), w: c.offsetWidth, h: c.offsetHeight });
  const edge = (b, tx, ty) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = tx - cx, dy = ty - cy; const s = Math.min(Math.abs((b.w / 2 + 6) / (dx || 1e-6)), Math.abs((b.h / 2 + 6) / (dy || 1e-6))); return [cx + dx * s, cy + dy * s]; };
  const defs = svg.querySelector('defs').outerHTML;
  svg.innerHTML = defs + (E.space.connections || []).map(l => {
    const a = cards.get(l.from), b = cards.get(l.to);
    if (!a || !b) return '';
    const ba = box(a), bb = box(b);
    const [x1, y1] = edge(ba, bb.x + bb.w / 2, bb.y + bb.h / 2), [x2, y2] = edge(bb, ba.x + ba.w / 2, ba.y + ba.h / 2);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<g class="free-link" data-link="${attr(l.id)}"><path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" class="hit"/><path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" marker-end="url(#arrowhead)"/>${l.label ? `<text x="${mx}" y="${my - 8}">${esc(l.label)}</text>` : ''}</g>`;
  }).join('');
};
E.freeInit = function (host) {
  if (!host) return;
  if (!E.ui.freeFitted) { E.ui.freeFitted = true; requestAnimationFrame(() => { E.freeFit(); E.freeLinks(); }); }
  else E.freeLinks();
  const ro = new ResizeObserver(() => E.freeLinks());
  host.querySelectorAll('.free-card').forEach(c => ro.observe(c));
  E.resizeObs = ro;
  host.addEventListener('wheel', e => {
    if (e.target.closest('.post-text, .pm-video')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) E.freeZoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    else { E.ui.free.x -= e.deltaX; E.ui.free.y -= e.deltaY; E.freeApply(); }
  }, { passive: false });
  host.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.free-card, .free-tools, .free-link')) return;
    const start = { x: e.clientX, y: e.clientY, vx: E.ui.free.x, vy: E.ui.free.y };
    host.classList.add('panning');
    const move = ev => { E.ui.free.x = start.vx + ev.clientX - start.x; E.ui.free.y = start.vy + ev.clientY - start.y; E.freeApply(); };
    const up = () => { host.classList.remove('panning'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  host.addEventListener('click', async e => {
    const t = e.target.closest('[data-free]');
    if (t) {
      e.stopPropagation();
      const a = t.dataset.free;
      if (a === 'in') E.freeZoom(1.25); else if (a === 'out') E.freeZoom(0.8); else if (a === 'fit') E.freeFit();
      else if (a === 'link') { E.ui.linking = !E.ui.linking; E.ui.linkFrom = null; E.renderBoard(); }
      return;
    }
    const link = e.target.closest('.free-link');
    if (link && (E.can('edit') || E.can('moderate'))) {
      e.stopPropagation();
      const l = E.space.connections.find(x => x.id === link.dataset.link);
      UI.menu(null, [
        { label: l.label ? 'Modifier le libellé…' : 'Ajouter un libellé…', icon: 'text', act: async () => { const t2 = await UI.prompt('Libellé de la flèche', l.label || ''); if (t2 !== null) E.saveConnections(E.space.connections.map(x => x.id === l.id ? { ...x, label: t2.trim() } : x)); } },
        { label: 'Inverser le sens', icon: 'sync', act: () => E.saveConnections(E.space.connections.map(x => x.id === l.id ? { ...x, from: x.to, to: x.from } : x)) },
        { label: 'Supprimer la flèche', icon: 'trash', danger: true, act: () => E.saveConnections(E.space.connections.filter(x => x.id !== l.id)) },
      ], { x: e.clientX, y: e.clientY });
      return;
    }
    if (E.ui.linking) {
      const card = e.target.closest('.free-card');
      if (!card) return;
      e.stopPropagation(); e.preventDefault();
      if (!E.ui.linkFrom) { E.ui.linkFrom = card.dataset.post; card.classList.add('link-src'); host.querySelector('[data-free="link"]').innerHTML = `${I.arrow}Choisissez la 2ᵉ carte…`; return; }
      if (E.ui.linkFrom === card.dataset.post) return;
      const from = E.ui.linkFrom; E.ui.linkFrom = null; E.ui.linking = false;
      await E.saveConnections([...(E.space.connections || []), { id: `l_${randomId(8)}`, from, to: card.dataset.post, label: '' }]);
    }
  }, true);
};
E.saveConnections = async function (connections) {
  const before = E.space.connections;
  E.space.connections = connections;
  E.renderBoard();
  try { const r = await E.api('POST', `/spaces/${E.space.id}/connections`, { connections }); E.space.connections = r.connections; E.freeLinks(); }
  catch (err) { E.space.connections = before; E.renderBoard(); toast(err.message, 'error'); }
};
E.dragFree = function (ev, card, post) {
  if (E.ui.linking) return;
  const start = { x: ev.clientX, y: ev.clientY, left: parseFloat(card.style.left), top: parseFloat(card.style.top) };
  let moved = false;
  startDrag(ev, {
    onStart: () => { card.classList.add('free-dragging'); moved = true; },
    onMove: (x, y) => { const k = E.ui.free.k; card.style.left = `${Math.round(start.left + (x - start.x) / k)}px`; card.style.top = `${Math.round(start.top + (y - start.y) / k)}px`; E.freeLinks(); },
    onDrop: async () => {
      card.classList.remove('free-dragging');
      if (!moved) return;
      const pos = { x: parseFloat(card.style.left), y: parseFloat(card.style.top) };
      const before = post.pos;
      post.pos = pos;
      try { await E.api('POST', `/spaces/${E.space.id}/posts/move`, { moves: [{ id: post.id, pos }] }); }
      catch (err) { post.pos = before; E.renderBoard(); toast(err.message, 'error'); }
    },
    onCancel: () => card.classList.remove('free-dragging'),
  });
};

/* Cours Albert 3.1 — calque de dessin et de texte sur les tableaux : stylo, surligneur, texte libre, gomme.
   Les traits sont des objets de la carte « ink » de l’espace (même format que l’espace libre), enregistrés et diffusés en direct. */
'use strict';

E.Ink = (() => {
  const K = { on: false, tool: 'pen', color: '#ef4444', width: 4, draft: null, undo: [], host: null, obs: null, editing: null };
  const COLORS = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
  const WIDTHS = [2, 4, 8];
  const NO_INK = ['map', 'free'];
  const card = () => E.space?.cards?.find(c => c.id === 'ink') || null;
  const ensureCard = () => { let c = card(); if (!c) { c = { id: 'ink', title: 'Calque', objects: [] }; (E.space.cards ||= []).push(c); } return c; };
  const allowed = () => !!E.space && E.isBoard() && !NO_INK.includes(E.layout());
  const canDraw = () => allowed() && E.can('edit');
  const hostFor = body => {
    const lay = E.layout();
    const inner = lay === 'columns' ? body.querySelector('.lay-columns') : lay === 'timeline' ? body.querySelector('.lay-timeline, .tl-track, .timeline') : null;
    return inner && inner.scrollWidth > inner.clientWidth + 4 ? inner : body;
  };
  const pathD = pts => {
    if (!pts.length) return '';
    if (pts.length < 3) return `M${pts.map(p => p.join(' ')).join('L')}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`; }
    const last = pts[pts.length - 1];
    return `${d}L${last[0]} ${last[1]}`;
  };
  const objSVG = o => {
    const st = o.style || {};
    const pts = (o.points || []).map(([x, y]) => [Math.round((o.x + x) * 10) / 10, Math.round((o.y + y) * 10) / 10]);
    return `<path data-obj="${attr(o.id)}" d="${pathD(pts)}" fill="none" stroke="${attr(st.stroke || '#111827')}" stroke-width="${st.strokeWidth || 4}" stroke-linecap="round" stroke-linejoin="round" ${o.highlighter ? 'opacity=".35" class="hl"' : ''}/>`;
  };
  const textHTML = o => {
    const st = o.style || {};
    return `<div class="ink-text" data-obj="${attr(o.id)}" style="left:${o.x}px;top:${o.y}px;max-width:${Math.max(120, o.w || 320)}px;color:${attr(st.color || '#111827')};font-size:${st.fontSize || 18}px;${st.weight === 'bold' ? 'font-weight:700;' : ''}">${esc(o.text || '')}</div>`;
  };
  function size() {
    const h = K.host, layer = h?.querySelector(':scope > .ink-layer');
    if (!layer) return;
    layer.style.width = '0px'; layer.style.height = '0px';
    const objs = card()?.objects || [];
    const maxX = Math.max(h.scrollWidth, ...objs.map(o => (o.x || 0) + (o.w || 0) + 40));
    const maxY = Math.max(h.scrollHeight, ...objs.map(o => (o.y || 0) + (o.h || 0) + 40));
    layer.style.width = `${maxX}px`; layer.style.height = `${maxY}px`;
    const svg = layer.querySelector('svg');
    svg.setAttribute('width', maxX); svg.setAttribute('height', maxY);
  }
  function render() {
    const body = E.mounted?.el.querySelector('.esp-body');
    K.obs?.disconnect(); K.obs = null;
    if (!body || !allowed()) { K.host = null; if (K.on) setOn(false, true); return; }
    const objs = card()?.objects || [];
    const host = hostFor(body);
    K.host = host;
    host.querySelector(':scope > .ink-layer')?.remove();
    if (!objs.length && !K.on) { toolbar(); return; }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const layer = document.createElement('div');
    layer.className = `ink-layer ${K.on ? 'on' : ''} tool-${K.tool}`;
    layer.innerHTML = `<svg class="ink-svg">${objs.filter(o => o.type === 'path').map(objSVG).join('')}<path class="ink-draft" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>${objs.filter(o => o.type === 'text').map(textHTML).join('')}`;
    host.appendChild(layer);
    size();
    if (typeof ResizeObserver === 'function') { K.obs = new ResizeObserver(() => size()); K.obs.observe(host); if (host.firstElementChild && host.firstElementChild !== layer) K.obs.observe(host.firstElementChild); }
    if (K.on) bind(layer);
    toolbar();
  }
  function toolbar() {
    const root = E.mounted?.el;
    if (!root) return;
    root.querySelector('.ink-bar')?.remove();
    const btn = root.querySelector('[data-e="ink"]');
    if (btn) btn.classList.toggle('on', K.on);
    if (!K.on) return;
    const bar = document.createElement('div');
    bar.className = 'ink-bar';
    const tools = [['pen', 'pen', 'Stylo'], ['marker', 'marker', 'Surligneur'], ['text', 'text', 'Texte (cliquez où écrire)'], ['eraser', 'eraser', 'Gomme (cliquez sur un trait ou un texte)']];
    bar.innerHTML = `${tools.map(([t, ic, title]) => `<button class="${K.tool === t ? 'on' : ''}" data-ink-tool="${t}" title="${attr(title)}">${I[ic]}</button>`).join('')}<span class="sep"></span>
      ${COLORS.map(c => `<button class="sw ${K.color === c ? 'on' : ''}" data-ink-color="${c}" style="--c:${c}" title="Couleur"></button>`).join('')}<span class="sep"></span>
      ${WIDTHS.map(w => `<button class="wd ${K.width === w ? 'on' : ''}" data-ink-width="${w}" title="Épaisseur ${w}"><i style="width:${w + 3}px;height:${w + 3}px"></i></button>`).join('')}<span class="sep"></span>
      <button data-ink="undo" title="Annuler (⌘Z)" ${K.undo.length ? '' : 'disabled'}>${I.undo}</button>
      <button class="done" data-ink="done" title="Terminer (Échap)">${I.check}<span>Terminé</span></button>`;
    root.appendChild(bar);
  }
  function setOn(v, silent = false) {
    if (v && !canDraw()) { if (!silent) toast(allowed() ? 'Seuls les animateurs du tableau peuvent dessiner.' : 'Le dessin n’est pas disponible dans cette disposition (carte, libre).'); return; }
    K.on = v;
    finishText();
    document.body.classList.toggle('ink-mode', v);
    render();
    if (v && !silent) { let seen = true; try { seen = localStorage.getItem('ca-ink-tip') === '1'; localStorage.setItem('ca-ink-tip', '1'); } catch {} if (!seen) toast('Dessinez ou écrivez n’importe où sur le tableau. Échap pour terminer.'); }
  }
  const point = e => { const r = K.host.getBoundingClientRect(); return [e.clientX - r.left + K.host.scrollLeft, e.clientY - r.top + K.host.scrollTop]; };
  async function save(objs, { record = true, before = null } = {}) {
    const c = ensureCard();
    for (const o of objs) { const i = c.objects.findIndex(x => x.id === o.id); if (i >= 0) c.objects[i] = o; else c.objects.push(o); }
    if (record) K.undo.push({ type: before ? 'edit' : 'add', objs, before });
    render();
    try {
      const { objects } = await E.api('POST', `/spaces/${E.space.id}/cards/ink/objects`, { objects: objs });
      for (const o of objects) { const i = c.objects.findIndex(x => x.id === o.id); if (i >= 0) c.objects[i] = o; }
    } catch (err) { c.objects = c.objects.filter(o => !objs.some(x => x.id === o.id)); render(); toast(err.message, 'error'); }
  }
  async function remove(ids, { record = true } = {}) {
    const c = card(); if (!c) return;
    const gone = c.objects.filter(o => ids.includes(o.id));
    c.objects = c.objects.filter(o => !ids.includes(o.id));
    if (record && gone.length) K.undo.push({ type: 'remove', objs: gone });
    render();
    try { await E.api('POST', `/spaces/${E.space.id}/cards/ink/objects/delete`, { ids }); }
    catch (err) { c.objects.push(...gone); render(); toast(err.message, 'error'); }
  }
  async function undo() {
    const last = K.undo.pop();
    if (!last) return;
    if (last.type === 'add') await remove(last.objs.map(o => o.id), { record: false });
    else if (last.type === 'remove') await save(last.objs, { record: false });
    else if (last.type === 'edit') await save(last.before, { record: false });
    toolbar();
  }
  function bind(layer) {
    layer.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const target = e.target.closest('[data-obj]');
      if (K.tool === 'eraser') { if (target) remove([target.dataset.obj]); e.preventDefault(); return; }
      if (K.tool === 'text') { e.preventDefault(); if (target?.classList.contains('ink-text')) editText(target.dataset.obj); else newText(point(e)); return; }
      if (target?.classList.contains('ink-text') && e.detail >= 2) { editText(target.dataset.obj); return; }
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      K.draft = { pts: [point(e)], highlighter: K.tool === 'marker' };
      const d = layer.querySelector('.ink-draft');
      d.setAttribute('stroke', K.color); d.setAttribute('stroke-width', K.tool === 'marker' ? K.width * 4 : K.width); d.setAttribute('opacity', K.tool === 'marker' ? '.35' : '1');
    });
    layer.addEventListener('pointermove', e => {
      if (!K.draft) return;
      const p = point(e), prev = K.draft.pts[K.draft.pts.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1.5) return;
      K.draft.pts.push(p);
      layer.querySelector('.ink-draft').setAttribute('d', pathD(K.draft.pts));
    });
    const end = () => {
      if (!K.draft) return;
      const { pts, highlighter } = K.draft;
      K.draft = null;
      layer.querySelector('.ink-draft')?.setAttribute('d', '');
      if (pts.length < 2) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      const step = Math.max(1, Math.ceil(pts.length / 1500));
      const obj = { id: `o_${randomId(10)}`, type: 'path', x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y), points: pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(([px, py]) => [Math.round((px - x) * 10) / 10, Math.round((py - y) * 10) / 10]), style: { stroke: K.color, strokeWidth: highlighter ? K.width * 4 : K.width }, ...(highlighter ? { highlighter: true } : {}) };
      save([obj]);
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);
  }
  function editorAt(x, y, value, done) {
    finishText();
    const layer = K.host?.querySelector(':scope > .ink-layer');
    if (!layer) return;
    const ta = document.createElement('textarea');
    ta.className = 'ink-editor';
    ta.value = value || '';
    ta.style.cssText = `left:${x}px;top:${y}px;color:${K.color};`;
    ta.placeholder = 'Écrivez… (⌘Entrée pour valider)';
    layer.appendChild(ta);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; ta.style.width = 'auto'; ta.style.width = `${Math.min(520, Math.max(160, ta.scrollWidth + 4))}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishText(); } });
    ta.addEventListener('pointerdown', e => e.stopPropagation());
    K.editing = { ta, done };
    setTimeout(() => { ta.focus(); grow(); }, 0);
    ta.addEventListener('blur', () => setTimeout(() => { if (K.editing?.ta === ta) finishText(); }, 120));
  }
  function finishText() {
    const ed = K.editing;
    if (!ed) return;
    K.editing = null;
    const text = ed.ta.value.replace(/\s+$/, '');
    const box = ed.ta.getBoundingClientRect();
    ed.ta.remove();
    ed.done(text, box);
  }
  function newText([x, y]) {
    editorAt(x, y - 12, '', (text, box) => { if (text.trim()) save([{ id: `o_${randomId(10)}`, type: 'text', x, y: y - 12, w: Math.max(120, Math.round(box.width)), h: Math.max(28, Math.round(box.height)), text, style: { color: K.color, fontSize: 18 } }]); });
  }
  function editText(id) {
    const o = card()?.objects.find(x => x.id === id);
    if (!o) return;
    const before = [JSON.parse(JSON.stringify(o))];
    K.host.querySelector(`.ink-text[data-obj="${CSS.escape(id)}"]`)?.classList.add('editing');
    editorAt(o.x, o.y, o.text, (text, box) => {
      if (!text.trim()) return remove([id]);
      if (text === o.text) return render();
      save([{ ...o, text, w: Math.max(120, Math.round(box.width)), h: Math.max(28, Math.round(box.height)) }], { before });
    });
  }

  // ---------- Événements ----------
  document.addEventListener('click', e => {
    const bar = e.target.closest('.ink-bar');
    if (!bar) return;
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.inkTool) { K.tool = b.dataset.inkTool; render(); }
    else if (b.dataset.inkColor) { K.color = b.dataset.inkColor; toolbar(); }
    else if (b.dataset.inkWidth) { K.width = +b.dataset.inkWidth; toolbar(); }
    else if (b.dataset.ink === 'undo') undo();
    else if (b.dataset.ink === 'done') setOn(false);
  });
  document.addEventListener('keydown', e => {
    if (!E.mounted || !E.space || !E.isBoard()) return;
    const typing = e.target.closest?.('input, textarea, [contenteditable="true"], select');
    if (K.on && e.key === 'Escape' && !typing) { e.preventDefault(); setOn(false); return; }
    if (K.on && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); undo(); return; }
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'd' && !document.querySelector('.m-back.on') && canDraw()) { e.preventDefault(); setOn(!K.on); }
  });
  E.on('objects', d => { if (d?.cardId === 'ink' && E.isBoard()) render(); });
  E.on('cards', () => { if (E.isBoard()) render(); });

  // Le calque suit chaque nouveau rendu du tableau.
  const renderBoard = E.renderBoard;
  E.renderBoard = function (...args) { const out = renderBoard.apply(this, args); try { render(); } catch (err) { console.error(err); } return out; };
  const unmount = E.unmount;
  E.unmount = function (...args) { K.obs?.disconnect(); K.obs = null; K.on = false; K.undo = []; document.body.classList.remove('ink-mode'); return unmount.apply(this, args); };

  return { toggle: () => setOn(!K.on), get on() { return K.on; }, available: canDraw, render, state: K };
})();


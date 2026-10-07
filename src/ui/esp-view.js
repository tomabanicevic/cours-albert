/* Cours Albert 3.3 — affichage des tableaux : barre du bas (défilement horizontal, taille des cartes façon Finder, aperçus),
   colonnes et sections repliables (colonnes, mur, grille, flux). Réglages propres à chaque personne et à chaque espace, gardés dans ce navigateur (rien n’est envoyé). */
'use strict';
(() => {
  const Z_MIN = 0.6, Z_MAX = 1.6, Z_STEP = 0.1;
  const DEF = { z: 1, thumbs: true, folded: [] };
  const key = id => `cours-albert.vue.${id}`;
  const load = id => { try { const v = JSON.parse(localStorage.getItem(key(id)) || '{}'); return { ...DEF, ...v, folded: Array.isArray(v.folded) ? v.folded : [] }; } catch { return { ...DEF }; } };
  const store = (id, v) => { try { localStorage.setItem(key(id), JSON.stringify(v)); } catch {} };
  const clampZ = z => Math.round(Math.min(Z_MAX, Math.max(Z_MIN, Number(z) || 1)) * 100) / 100;
  const S = { id: null, v: { ...DEF }, timer: 0 };
  const cur = () => { const id = E.space?.id; if (id && S.id !== id) { S.id = id; S.v = load(id); } return S.v; };
  const save = () => { clearTimeout(S.timer); const id = S.id, v = S.v; S.timer = setTimeout(() => id && store(id, v), 250); };
  E.viewZ = () => (E.space && E.isBoard() ? cur().z : 1);

  const FLOW = ['wall', 'grid', 'stream'];
  const root = () => E.mounted?.el || null;
  const relayout = () => { if (E.layout() === 'wall') requestAnimationFrame(() => root()?.querySelectorAll('.masonry').forEach(l => E.masonry(l))); };
  const scroller = () => root()?.querySelector('.esp-body > .lay-columns, .esp-body > .lay-timeline') || null;

  function barHTML() {
    const v = cur(), lay = E.layout();
    const horiz = lay === 'columns' || lay === 'timeline';
    const pct = Math.round(v.z * 100);
    const foldable = E.space.sections.length > 1 && (lay === 'columns' || (FLOW.includes(lay) && E.space.settings.sections));
    const folded = foldable && v.folded.some(id => E.space.sections.some(s => s.id === id));
    return `<div class="esp-bar" role="toolbar" aria-label="Affichage du tableau">
      ${horiz ? `<div class="eb-scroll"><button class="eb-btn" data-v="left" title="Faire défiler vers la gauche">${I.chevL}</button><input type="range" class="eb-range wide" data-v-scroll min="0" max="1000" value="0" aria-label="Défilement horizontal du tableau" title="Faire défiler le tableau"><button class="eb-btn" data-v="right" title="Faire défiler vers la droite">${I.chevR}</button></div>` : '<span class="eb-fill"></span>'}
      <div class="eb-group">
        ${foldable ? `<button class="eb-btn" data-v="foldall" title="${folded ? 'Déplier toutes les colonnes' : 'Replier toutes les colonnes'}">${folded ? I.expand : I.columns}<span>${folded ? 'Tout déplier' : 'Tout replier'}</span></button>` : ''}
        <button class="eb-btn ${v.thumbs ? 'on' : ''}" data-v="thumbs" title="${v.thumbs ? 'Masquer les aperçus des fichiers (liste compacte)' : 'Afficher les aperçus des fichiers'}">${v.thumbs ? I.eye : I.eyeOff}<span>Aperçus</span></button>
        <div class="eb-size"><button class="eb-btn" data-v="smaller" title="Cartes plus petites">${I.zoomOut}</button><input type="range" class="eb-range" data-v-size min="${Z_MIN * 100}" max="${Z_MAX * 100}" step="5" value="${pct}" aria-label="Taille des cartes" title="Taille des cartes"><button class="eb-btn" data-v="bigger" title="Cartes plus grandes">${I.zoomIn}</button><button class="eb-pct" data-v="reset" title="Revenir à la taille normale">${pct} %</button></div>
      </div>
    </div>`;
  }

  /** Taille, aperçus, barre du bas et colonnes repliées : appliqués après chaque affichage du tableau. */
  function apply() {
    const el = root();
    if (!el || !E.space) return;
    if (!E.isBoard() || E.layout() === 'map') { el.querySelector('.esp-bar')?.remove(); el.classList.remove('has-bar'); el.style.removeProperty('--z'); return; }
    const v = cur();
    el.style.setProperty('--z', String(v.z));
    el.classList.toggle('no-thumbs', !v.thumbs);
    el.classList.add('has-bar');
    const html = barHTML();
    const bar = el.querySelector('.esp-bar');
    if (bar) bar.outerHTML = html; else el.querySelector('.esp-body')?.insertAdjacentHTML('afterend', html);
    decorate();
    requestAnimationFrame(sync);
  }
  function decorate() {
    const el = root();
    if (!el) return;
    const lay = E.layout();
    const folded = new Set(cur().folded);
    if (lay === 'columns') {
      for (const col of el.querySelectorAll('.lay-columns > .col[data-section]')) {
        const on = folded.has(col.dataset.section);
        col.classList.toggle('folded', on);
        const head = col.querySelector('.sec-head');
        let btn = head?.querySelector('[data-v="fold"]');
        if (head && !btn) { head.insertAdjacentHTML('beforeend', '<button class="btn icon ghost sm col-fold" data-v="fold"></button>'); btn = head.querySelector('[data-v="fold"]'); }
        if (btn) { btn.innerHTML = on ? I.chevR : I.chevL; btn.title = on ? 'Déplier la colonne' : 'Replier la colonne'; }
        if (on) col.title = `Déplier « ${col.querySelector('.sec-head h2')?.textContent || ''} »`; else col.removeAttribute('title');
      }
    } else if (FLOW.includes(lay)) {
      // Mur, grille, flux : chaque section se replie sur son titre (flèche à gauche du titre).
      for (const head of el.querySelectorAll('.esp-body section.sec > .sec-head[data-section]')) {
        const on = folded.has(head.dataset.section);
        head.parentElement.classList.toggle('folded', on);
        let btn = head.querySelector('[data-v="fold"]');
        if (!btn) { head.insertAdjacentHTML('afterbegin', '<button class="btn icon ghost sm sec-fold" data-v="fold"></button>'); btn = head.querySelector('[data-v="fold"]'); }
        btn.innerHTML = on ? I.chevR : I.chevD;
        btn.title = on ? 'Déplier la section' : 'Replier la section';
      }
    }
  }
  /** Curseur du bas ↔ défilement horizontal du tableau. */
  function sync() {
    const el = root(), s = scroller();
    const range = el?.querySelector('[data-v-scroll]');
    if (!range) return;
    const box = range.closest('.eb-scroll');
    if (!s) { box.classList.add('off'); return; }
    const max = s.scrollWidth - s.clientWidth;
    box.classList.toggle('off', max <= 4);
    if (document.activeElement !== range) range.value = max > 0 ? String(Math.round(s.scrollLeft / max * 1000)) : '0';
    if (!s.dataset.vBound) { s.dataset.vBound = '1'; s.addEventListener('scroll', () => requestAnimationFrame(sync), { passive: true }); }
  }
  function setZ(z) {
    const v = cur();
    v.z = clampZ(z);
    save();
    const el = root();
    if (!el) return;
    el.style.setProperty('--z', String(v.z));
    const range = el.querySelector('[data-v-size]'); if (range && document.activeElement !== range) range.value = String(Math.round(v.z * 100));
    const pct = el.querySelector('.eb-pct'); if (pct) pct.textContent = `${Math.round(v.z * 100)} %`;
    if (E.layout() === 'wall') { cancelAnimationFrame(S.raf); S.raf = requestAnimationFrame(() => el.querySelectorAll('.masonry').forEach(l => E.masonry(l))); }
    requestAnimationFrame(sync);
  }

  const renderSpace = E.renderSpace;
  E.renderSpace = function (...args) { const out = renderSpace.apply(this, args); apply(); return out; };
  const renderBoard = E.renderBoard;
  E.renderBoard = function (...args) {
    const out = renderBoard.apply(this, args);
    if (root()?.querySelector('.esp-bar')) { decorate(); requestAnimationFrame(sync); } else apply();
    return out;
  };

  // Clics : en phase de capture, pour qu’un clic sur une colonne repliée ne déclenche pas les actions de son en-tête.
  document.addEventListener('click', e => {
    const el = root();
    if (!el || !E.space || !el.contains(e.target)) return;
    const b = e.target.closest('[data-v]');
    const foldedCol = !b && e.target.closest('.lay-columns > .col.folded');
    if (!b && !foldedCol) return;
    e.preventDefault(); e.stopPropagation();
    const v = cur();
    const act = b ? b.dataset.v : 'unfold';
    const col = (b || foldedCol).closest('[data-section]');
    const s = scroller();
    switch (act) {
      case 'fold': { const id = col?.dataset.section; if (!id) return; v.folded = v.folded.includes(id) ? v.folded.filter(x => x !== id) : [...v.folded, id]; save(); apply(); relayout(); return; }
      case 'unfold': { const id = col?.dataset.section; v.folded = v.folded.filter(x => x !== id); save(); apply(); relayout(); return; }
      case 'foldall': { const ids = E.space.sections.map(x => x.id); v.folded = v.folded.some(id => ids.includes(id)) ? [] : ids; save(); apply(); relayout(); return; }
      case 'thumbs': v.thumbs = !v.thumbs; save(); apply(); if (E.layout() === 'wall') requestAnimationFrame(() => root()?.querySelectorAll('.masonry').forEach(l => E.masonry(l))); return;
      case 'smaller': return setZ(v.z - Z_STEP);
      case 'bigger': return setZ(v.z + Z_STEP);
      case 'reset': return setZ(1);
      case 'left': case 'right': if (s) s.scrollBy({ left: (act === 'left' ? -1 : 1) * Math.max(240, s.clientWidth * 0.75), behavior: 'smooth' }); return;
    }
  }, true);
  document.addEventListener('input', e => {
    const t = e.target, el = root();
    if (!el || !el.contains(t)) return;
    if (t.matches('[data-v-size]')) setZ(Number(t.value) / 100);
    else if (t.matches('[data-v-scroll]')) { const s = scroller(); if (s) s.scrollLeft = Number(t.value) / 1000 * (s.scrollWidth - s.clientWidth); }
  });
  addEventListener('resize', () => requestAnimationFrame(sync));
  // Raccourcis : ⌥⌘+ / ⌥⌘− pour la taille des cartes (⌘+ / ⌘− agrandissent toute l’interface).
  document.addEventListener('keydown', e => {
    if (!root() || !E.space || !E.isBoard() || !e.altKey || !(e.metaKey || e.ctrlKey)) return;
    if (e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') { e.preventDefault(); setZ(cur().z + Z_STEP); }
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') { e.preventDefault(); setZ(cur().z - Z_STEP); }
  });
})();

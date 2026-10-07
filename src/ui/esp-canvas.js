/* Cours Albert 3 — espace libre : tableau blanc en cartes (objets, outils, liens interactifs, groupes, présentation). */
'use strict';

E.Canvas = (() => {
  const C = {
    cardId: null, tool: 'select', shape: 'rect', sel: new Set(), k: 1, zoom: 1, history: {}, future: {}, clipboard: null,
    color: '#111827', fill: '#fef08a', width: 4, editing: null, preview: false, root: null, pending: new Map(), sendTimer: null,
  };
  const SIZES = { '16:9': [1600, 900], '4:3': [1600, 1200], '1:1': [1200, 1200], a4: [1240, 1754] };
  const size = () => SIZES[E.space?.settings.aspect] || SIZES['16:9'];
  const card = () => E.space?.cards.find(c => c.id === C.cardId) || E.space?.cards[0] || null;
  const obj = id => card()?.objects.find(o => o.id === id) || null;
  const SHAPES = ['rect', 'ellipse', 'triangle', 'diamond', 'star', 'hexagon'];
  const STICKY = ['#fef08a', '#fed7aa', '#fecaca', '#fbcfe8', '#e9d5ff', '#bfdbfe', '#a5f3fc', '#bbf7d0', '#ffffff'];
  const PALETTE = ['#111827', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#94a3b8'];
  const canEditStructure = () => E.can('edit') && !C.preview;
  const canDraw = () => {
    const k = card();
    if (!k || C.preview && E.can('edit')) return false;
    if (E.can('edit')) return true;
    if (!E.can('post')) return false;
    if (E.space.settings.groupWork && k.groupId && k.groupId !== E.me?.group) return false;
    return E.space.settings.canvasMode === 'edit' || E.space.settings.participantsCanAdd;
  };
  const canTouch = o => !!o && canDraw() && (E.can('edit') || (o.author?.id === E.me?.id && !o.locked && E.space.settings.canvasMode === 'edit') || (o.author?.id === E.me?.id && E.space.settings.participantsCanAdd && ['sticky', 'path', 'text'].includes(o.type)));
  const interactive = () => C.preview || !canDraw() || E.space.settings.canvasMode === 'interact' && !E.can('edit');

  // ---------- Rendu des objets ----------
  function textHTML(t) { return esc(t || '').replace(/\n/g, '<br>'); }
  function shapeSVG(o) {
    const { w, h } = o, st = o.style || {};
    const sw = st.strokeWidth ?? (st.stroke && st.stroke !== 'none' ? 3 : 0);
    const fill = st.fill || 'none', stroke = st.stroke && st.stroke !== 'none' ? st.stroke : 'none';
    const dash = st.dash === 'dashed' ? `stroke-dasharray="${sw * 3} ${sw * 2}"` : st.dash === 'dotted' ? `stroke-dasharray="0 ${sw * 2}" stroke-linecap="round"` : '';
    const a = `fill="${attr(fill)}" stroke="${attr(stroke)}" stroke-width="${sw}" ${dash} vector-effect="non-scaling-stroke"`;
    const i = sw / 2;
    let shape;
    if (o.type === 'ellipse') shape = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(1, w / 2 - i)}" ry="${Math.max(1, h / 2 - i)}" ${a}/>`;
    else if (o.type === 'triangle') shape = `<polygon points="${w / 2},${i} ${w - i},${h - i} ${i},${h - i}" ${a}/>`;
    else if (o.type === 'diamond') shape = `<polygon points="${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}" ${a}/>`;
    else if (o.type === 'hexagon') shape = `<polygon points="${w * 0.25},${i} ${w * 0.75},${i} ${w - i},${h / 2} ${w * 0.75},${h - i} ${w * 0.25},${h - i} ${i},${h / 2}" ${a}/>`;
    else if (o.type === 'star') { const pts = []; for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.42 : 1, ang = -Math.PI / 2 + k * Math.PI / 5; pts.push(`${w / 2 + Math.cos(ang) * (w / 2 - i) * r},${h / 2 + Math.sin(ang) * (h / 2 - i) * r}`); } shape = `<polygon points="${pts.join(' ')}" ${a}/>`; }
    else shape = `<rect x="${i}" y="${i}" width="${Math.max(1, w - sw)}" height="${Math.max(1, h - sw)}" rx="${st.radius ?? 10}" ${a}/>`;
    return `<svg class="obj-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${shape}</svg>`;
  }
  function pathD(points) {
    if (!points.length) return '';
    if (points.length < 3) return `M${points.map(p => p.join(',')).join(' L')}`;
    let d = `M${points[0][0]},${points[0][1]}`;
    for (let i = 1; i < points.length - 1; i++) { const [x, y] = points[i], [nx, ny] = points[i + 1]; d += ` Q${x},${y} ${(x + nx) / 2},${(y + ny) / 2}`; }
    const last = points[points.length - 1];
    return `${d} L${last[0]},${last[1]}`;
  }
  function objHTML(o, { thumb = false } = {}) {
    const st = o.style || {};
    const font = st.fontSize || (o.type === 'sticky' ? 24 : 28);
    const textStyle = `font-size:${font}px;color:${attr(st.color || (o.type === 'sticky' || o.type === 'text' ? '#111827' : '#ffffff'))};text-align:${st.align || (o.type === 'text' ? 'left' : 'center')};font-weight:${st.weight === 'bold' ? 700 : 450};${st.italic ? 'font-style:italic;' : ''}`;
    let inner = '';
    switch (o.type) {
      case 'text': inner = `<div class="obj-text font-${st.font || 'system'}" style="${textStyle}">${textHTML(o.text)}</div>`; break;
      case 'sticky': inner = `<div class="obj-sticky" style="background:${attr(st.fill || '#fef08a')};${textStyle}">${textHTML(o.text)}${o.author && !thumb && E.space.settings.showAuthor ? `<span class="by">${esc(o.author.name || '')}</span>` : ''}</div>`; break;
      case 'frame': inner = `<div class="obj-frame" style="border-color:${attr(st.stroke || '#94a3b8')};background:${attr(st.fill && st.fill !== 'none' ? st.fill : 'transparent')}"><span>${esc(o.text || 'Cadre')}</span></div>`; break;
      case 'path': inner = `<svg class="obj-svg" viewBox="0 0 ${o.w} ${o.h}" preserveAspectRatio="none" style="overflow:visible"><path d="${pathD(o.points || [])}" fill="none" stroke="${attr(st.stroke || '#111827')}" stroke-width="${st.strokeWidth || 4}" stroke-linecap="round" stroke-linejoin="round" ${o.highlighter ? 'opacity=".38" style="mix-blend-mode:multiply"' : ''}/></svg>`; break;
      case 'image': inner = `<img src="${attr(E.mediaUrl(o.media))}" alt="${attr(o.name || '')}" draggable="false" loading="lazy">`; break;
      case 'video': inner = thumb ? `<div class="obj-ph">${I.video}</div>` : `<video src="${attr(E.mediaUrl(o.media))}" controls playsinline preload="metadata"></video>`; break;
      case 'audio': inner = thumb ? `<div class="obj-ph">${I.mic}</div>` : `<div class="obj-audio">${I.mic}<audio src="${attr(E.mediaUrl(o.media))}" controls preload="none"></audio></div>`; break;
      case 'file': inner = `<button class="obj-file" data-thumb-box data-cv="open-file"><span class="thumb-frame"><img data-thumb src="${attr(E.thumbUrl(o.id))}" alt="" draggable="false" loading="lazy"></span><span class="obj-file-line">${E.fileBadge(o.name || '')}<span><b>${esc(o.name || 'Fichier')}</b><small>Ouvrir</small></span></span></button>`; break;
      case 'link': case 'embed': inner = o.embed && !thumb ? `<div class="obj-embed"><iframe src="${attr(o.embed)}" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>` : `<a class="obj-link" href="${attr(o.url)}" target="_blank" rel="noopener" data-cv="url">${o.preview?.image ? `<span class="ol-img" style="background-image:url('${attr(E.mediaUrl(o.preview.image))}')"></span>` : ''}<span class="ol-text"><b>${esc(o.preview?.title || o.url)}</b><small>${esc(o.preview?.site || '')}</small></span></a>`; break;
      case 'sticker': inner = `<div class="obj-sticker" style="font-size:${Math.round(Math.min(o.w, o.h) * 0.82)}px">${esc(o.emoji || '⭐️')}</div>`; break;
      case 'poll': inner = `<div class="obj-poll">${E.pollHTML({ id: o.id, poll: o.poll }, { cardId: C.cardId, objectId: o.id })}</div>`; break;
      case 'line': case 'arrow': return '';
      default: inner = `${shapeSVG(o)}${o.text ? `<div class="obj-label font-${st.font || 'system'}" style="${textStyle}">${textHTML(o.text)}</div>` : '<div class="obj-label" style="' + textStyle + '"></div>'}`;
    }
    const action = o.action && !thumb ? `<span class="obj-action" title="${attr(o.action.type === 'card' ? `Mène à « ${E.space.cards.find(k => k.id === o.action.target)?.title || 'carte'} »` : o.action.type === 'url' ? o.action.target : o.action.type === 'next' ? 'Carte suivante' : 'Carte précédente')}">${I.link}</span>` : '';
    return `<div class="obj t-${o.type} ${o.locked ? 'locked' : ''} ${o.action ? 'has-action' : ''}" data-obj="${attr(o.id)}" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px;z-index:${Math.round(o.z || 0) + 10};${st.opacity != null && st.opacity < 1 ? `opacity:${st.opacity};` : ''}${o.rot ? `transform:rotate(${o.rot}deg);` : ''}">${inner}${action}</div>`;
  }
  function anchor(o, toward) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    const dx = toward[0] - cx, dy = toward[1] - cy;
    if (!dx && !dy) return [cx, cy];
    const s = Math.min(Math.abs((o.w / 2 + 4) / (dx || 1e-6)), Math.abs((o.h / 2 + 4) / (dy || 1e-6)));
    return [cx + dx * s, cy + dy * s];
  }
  function lineEnds(o, objects) {
    let [p1, p2] = [o.points?.[0] || [o.x, o.y], o.points?.[o.points.length - 1] || [o.x + o.w, o.y + o.h]];
    const a = o.from && objects.find(x => x.id === o.from.id), b = o.to && objects.find(x => x.id === o.to.id);
    if (a && b) { p1 = anchor(a, [b.x + b.w / 2, b.y + b.h / 2]); p2 = anchor(b, [a.x + a.w / 2, a.y + a.h / 2]); }
    else if (a) p1 = anchor(a, p2); else if (b) p2 = anchor(b, p1);
    return [p1, p2];
  }
  function linesSVG(k, { thumb = false } = {}) {
    const [W, H] = size();
    const lines = k.objects.filter(o => o.type === 'line' || o.type === 'arrow').sort((a, b) => (a.z || 0) - (b.z || 0));
    return `<svg class="cv-lines" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px;height:${H}px"><defs>${lines.map(o => `<marker id="ah-${attr(o.id)}${thumb ? '-t' : ''}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${attr(o.style?.stroke || '#111827')}"/></marker>`).join('')}</defs>${lines.map(o => {
      const [p1, p2] = lineEnds(o, k.objects);
      const st = o.style || {};
      const sw = st.strokeWidth || 4;
      const head = o.type === 'arrow' ? (st.head || 'end') : (st.head || 'none');
      const m = `${thumb ? '-t' : ''}`;
      const dash = st.dash === 'dashed' ? `stroke-dasharray="${sw * 3} ${sw * 2}"` : st.dash === 'dotted' ? `stroke-dasharray="0 ${sw * 2}"` : '';
      return `<g data-obj="${attr(o.id)}" class="cv-line ${C.sel.has(o.id) ? 'sel' : ''}"><line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" class="hit"/><line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="${attr(st.stroke || '#111827')}" stroke-width="${sw}" stroke-linecap="round" ${dash} ${head === 'end' || head === 'both' ? `marker-end="url(#ah-${attr(o.id)}${m})"` : ''} ${head === 'both' ? `marker-start="url(#ah-${attr(o.id)}${m})"` : ''}/></g>`;
    }).join('')}</svg>`;
  }
  function pageInner(k, opts = {}) {
    const objects = [...k.objects].sort((a, b) => (a.z || 0) - (b.z || 0));
    return `${objects.map(o => objHTML(o, opts)).join('')}${linesSVG(k, opts)}`;
  }

  // ---------- Interface ----------
  C.render = function (body) {
    C.root = body;
    if (!E.space.cards.some(k => k.id === C.cardId)) C.cardId = E.space.cards[0]?.id || null;
    const tools = [['select', 'cursor', 'Sélection (V)'], ['hand', 'hand', 'Déplacer la vue (H ou espace)'], ['text', 'text', 'Texte (T)'], ['sticky', 'sticky', 'Note (N)'], ['shape', SHAPES.includes(C.shape) ? C.shape : 'rect', 'Formes (R)'], ['arrow', 'arrow', 'Flèche (A)'], ['line', 'line', 'Ligne (L)'], ['pen', 'pen', 'Stylo (P)'], ['marker', 'marker', 'Surligneur (M)'], ['eraser', 'eraser', 'Gomme (E)']];
    const draw = canDraw();
    body.innerHTML = `<div class="cv ${interactive() ? 'interactive' : ''}">
      <aside class="cv-cards"></aside>
      <div class="cv-main"><div class="cv-area">
        ${draw ? `<div class="cv-tools">${tools.map(([t, ic, title]) => `<button class="${C.tool === t ? 'on' : ''}" data-cv-tool="${t}" title="${attr(title)}">${I[ic]}</button>`).join('')}<span class="sep"></span>
          <button data-cv="image" title="Image ou fichier">${I.image}</button><button data-cv="link" title="Lien web ou vidéo">${I.link}</button><button data-cv="sticker" title="Autocollant">${I.smile}</button><button data-cv="poll" title="Sondage">${I.poll}</button><button data-cv="record" title="Enregistrer audio, vidéo ou écran">${I.mic}</button>${canEditStructure() ? `<button data-cv="frame" title="Cadre">${I.frame}</button>` : ''}
          <span class="sep"></span><button data-cv="undo" title="Annuler (⌘Z)">${I.undo}</button><button data-cv="redo" title="Rétablir (⇧⌘Z)">${I.redo}</button></div>` : ''}
        <div class="cv-stage"><div class="cv-sizer"><div class="cv-page"><div class="cv-objs"></div><div class="cv-overlay"></div></div></div></div>
        <div class="cv-props"></div></div>
        <div class="cv-foot">
          <button class="btn icon sm" data-cv="prev" title="Carte précédente">${I.chevL}</button><span class="cv-count"></span><button class="btn icon sm" data-cv="next" title="Carte suivante">${I.chevR}</button>
          <span class="grow"></span>
          ${E.can('edit') ? `<div class="segmented"><button class="${!C.preview ? 'on' : ''}" data-cv="mode-edit">Création</button><button class="${C.preview ? 'on' : ''}" data-cv="mode-preview" title="Voir l’activité comme un participant">Interaction</button></div>` : ''}
          ${E.can('edit') && E.space.cards.length > 1 ? `<button class="btn sm" data-cv="overview">${I.grid}Vue d’ensemble</button>` : ''}
          <button class="btn icon sm" data-cv="zoom-out">${I.minus}</button><button class="btn sm cv-zoom" data-cv="zoom-fit">100 %</button><button class="btn icon sm" data-cv="zoom-in">${I.plus}</button>
        </div>
      </div></div>`;
    C.renderCards();
    C.renderPage();
    if (!C.ro) { C.ro = new ResizeObserver(() => C.fit()); }
    C.ro.disconnect(); C.ro.observe(body.querySelector('.cv-stage'));
    C.bind(body);
  };
  C.unmount = function () { C.ro?.disconnect(); C.flush(); C.sel.clear(); C.editing = null; C.root = null; };
  C.renderCards = function () {
    const host = C.root?.querySelector('.cv-cards');
    if (!host) return;
    const [W, H] = size();
    const tw = 168, scale = tw / W;
    host.innerHTML = `<div class="cv-cards-list">${E.space.cards.map((k, i) => {
      const g = E.space.groups.find(x => x.id === k.groupId);
      return `<div class="cv-thumb ${k.id === C.cardId ? 'on' : ''}" data-card="${attr(k.id)}" draggable="false"><div class="ct-frame" style="height:${Math.round(H * scale)}px"><div class="ct-page" style="width:${W}px;height:${H}px;transform:scale(${scale});background:${attr(k.background || '#ffffff')}">${pageInner(k, { thumb: true })}</div></div><div class="ct-label"><span class="n">${i + 1}</span><b>${esc(k.title)}</b>${g ? `<i class="gdot" style="background:${attr(g.color)}" title="${attr(g.name)}"></i>` : ''}${canEditStructure() ? `<button class="btn icon sm ghost" data-cv="card-menu" title="Carte">${I.more}</button>` : ''}</div></div>`;
    }).join('')}</div>${canEditStructure() ? `<button class="btn sm cv-add-card" data-cv="add-card">${I.plus}Nouvelle carte</button>` : ''}`;
  };
  C.renderPage = function () {
    const page = C.root?.querySelector('.cv-page');
    const k = card();
    if (!page || !k) return;
    const [W, H] = size();
    page.style.width = `${W}px`; page.style.height = `${H}px`;
    page.style.background = k.background || '#ffffff';
    page.querySelector('.cv-objs').innerHTML = pageInner(k);
    C.root.querySelector('.cv-count').textContent = `${E.space.cards.indexOf(k) + 1} / ${E.space.cards.length} · ${k.title}`;
    for (const id of [...C.sel]) if (!obj(id)) C.sel.delete(id);
    C.fit(false);
    C.renderSelection();
  };
  C.fit = function (keepZoom = true) {
    const stage = C.root?.querySelector('.cv-stage'), page = C.root?.querySelector('.cv-page'), sizer = C.root?.querySelector('.cv-sizer');
    if (!stage || !page || !sizer) return;
    const [W, H] = size();
    // La barre d'outils flotte au-dessus de la scène : on réserve sa place pour ne jamais masquer la carte.
    const tools = C.root.querySelector('.cv-tools');
    const side = tools ? tools.offsetHeight >= tools.offsetWidth : false;
    const padL = side ? tools.offsetLeft + tools.offsetWidth + 16 : 24, padR = 24, padT = 24;
    const padB = tools && !side ? tools.offsetHeight + 22 : 24;
    const availW = Math.max(40, stage.clientWidth - padL - padR), availH = Math.max(40, stage.clientHeight - padT - padB);
    const fitK = Math.max(0.05, Math.min(availW / W, availH / H));
    if (!keepZoom || !C.zoomSet) C.zoom = 1;
    C.k = fitK * C.zoom;
    const sw = W * C.k, sh = H * C.k;
    const left = padL + Math.max(0, (availW - sw) / 2), top = padT + Math.max(0, (availH - sh) / 2);
    page.style.transform = `scale(${C.k})`;
    page.style.left = `${Math.round(left)}px`; page.style.top = `${Math.round(top)}px`;
    sizer.style.width = `${Math.ceil(left + sw + padR)}px`;
    sizer.style.height = `${Math.ceil(top + sh + padB)}px`;
    sizer.style.setProperty('--k', C.k);
    const z = C.root.querySelector('.cv-zoom'); if (z) z.textContent = `${Math.round(C.zoom * 100)} %`;
    C.renderSelection();
  };
  C.toCard = (cx, cy) => { const r = C.root.querySelector('.cv-page').getBoundingClientRect(); return [(cx - r.left) / C.k, (cy - r.top) / C.k]; };

  // ---------- Sélection ----------
  C.renderSelection = function () {
    const ov = C.root?.querySelector('.cv-overlay');
    if (!ov) return;
    const k = card();
    const list = [...C.sel].map(obj).filter(Boolean);
    C.root.querySelectorAll('.cv-page .cv-line').forEach(g => g.classList.toggle('sel', C.sel.has(g.dataset.obj)));
    if (!list.length || interactive()) { ov.innerHTML = ''; C.renderProps(); return; }
    const boxes = list.filter(o => o.type !== 'line' && o.type !== 'arrow');
    let html = '';
    for (const o of list) {
      if (o.type === 'line' || o.type === 'arrow') { const [p1, p2] = lineEnds(o, k.objects); html += `<span class="cv-pt" data-pt="0" data-id="${attr(o.id)}" style="left:${p1[0]}px;top:${p1[1]}px"></span><span class="cv-pt" data-pt="1" data-id="${attr(o.id)}" style="left:${p2[0]}px;top:${p2[1]}px"></span>`; continue; }
      html += `<div class="cv-selbox ${list.length > 1 ? 'multi' : ''}" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px"></div>`;
    }
    if (boxes.length === 1 && canTouch(boxes[0]) && !boxes[0].locked) {
      const o = boxes[0];
      html += ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => `<span class="cv-handle h-${h}" data-handle="${h}" style="left:${o.x + (h.includes('w') ? 0 : h.includes('e') ? o.w : o.w / 2)}px;top:${o.y + (h.includes('n') ? 0 : h.includes('s') ? o.h : o.h / 2)}px"></span>`).join('');
    }
    ov.innerHTML = html;
    C.renderProps();
  };
  C.renderProps = function () {
    const bar = C.root?.querySelector('.cv-props');
    if (!bar) return;
    const list = [...C.sel].map(obj).filter(Boolean);
    if (!list.length || interactive() || C.editing) { bar.innerHTML = ''; bar.classList.remove('on'); return; }
    const one = list.length === 1 ? list[0] : null;
    const types = new Set(list.map(o => o.type));
    const touchable = list.every(canTouch);
    if (!touchable) { bar.innerHTML = `<span class="muted">${list.length === 1 && list[0].author ? `Ajouté par ${esc(list[0].author.name)}` : 'Objet verrouillé'}</span>`; bar.classList.add('on'); return; }
    const has = t => [...types].some(x => t.includes(x));
    const st = one?.style || {};
    const swatches = (key, colors, current) => `<div class="pp-sw">${colors.map(c => `<button data-pp="${key}" data-v="${c}" class="${current === c ? 'on' : ''}" style="background:${c}" title="${c}"></button>`).join('')}${key !== 'fill' ? '' : `<button data-pp="fill" data-v="none" class="none ${current === 'none' ? 'on' : ''}" title="Transparent">${I.close}</button>`}</div>`;
    let html = '';
    if (has(['sticky'])) html += `<div class="pp-group" title="Couleur de la note">${swatches('fill', STICKY, st.fill)}</div>`;
    else if (has([...SHAPES, 'frame'])) html += `<div class="pp-group" title="Remplissage">${I.palette}${swatches('fill', PALETTE, st.fill)}</div>`;
    if (has([...SHAPES, 'line', 'arrow', 'path', 'frame'])) html += `<div class="pp-group" title="Trait">${I.pen}${swatches('stroke', PALETTE, st.stroke)}<select class="select sm" data-pp-sel="strokeWidth">${[0, 2, 4, 6, 10, 16].map(w => `<option value="${w}" ${(st.strokeWidth ?? 4) === w ? 'selected' : ''}>${w ? `${w} px` : 'Aucun'}</option>`).join('')}</select>${has([...SHAPES, 'line', 'arrow']) ? `<select class="select sm" data-pp-sel="dash">${[['solid', 'Plein'], ['dashed', 'Tirets'], ['dotted', 'Points']].map(([v, l]) => `<option value="${v}" ${(st.dash || 'solid') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}</div>`;
    if (has(['line', 'arrow'])) html += `<div class="pp-group"><select class="select sm" data-pp-sel="head">${[['none', 'Sans flèche'], ['end', 'Flèche →'], ['both', 'Double ↔']].map(([v, l]) => `<option value="${v}" ${(st.head || (one?.type === 'arrow' ? 'end' : 'none')) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
    if (has(['text', 'sticky', ...SHAPES, 'frame'])) html += `<div class="pp-group">${I.text}${swatches('color', ['#111827', '#ffffff', '#ef4444', '#2563eb', '#16a34a', '#7c3aed'], st.color)}<button data-pp="size" data-v="-1" title="Plus petit">A−</button><button data-pp="size" data-v="1" title="Plus grand">A+</button><button data-pp="weight" class="${st.weight === 'bold' ? 'on' : ''}" title="Gras">${I.bold}</button><button data-pp="align" title="Alignement">${st.align === 'center' ? '≡' : st.align === 'right' ? '⫶' : '☰'}</button></div>`;
    if (one && canEditStructure()) html += `<div class="pp-group"><button data-pp="action" class="${one.action ? 'on' : ''}" title="Rendre interactif : mène à une autre carte">${I.link}${one.action ? 'Interactif' : 'Lien'}</button></div>`;
    html += `<div class="pp-group"><button data-pp="front" title="Premier plan">${I.front}</button><button data-pp="back" title="Arrière-plan">${I.back}</button>${canEditStructure() ? `<button data-pp="lock" title="${one?.locked ? 'Déverrouiller' : 'Verrouiller'}">${one?.locked ? I.unlock : I.lock}</button>` : ''}<button data-pp="dup" title="Dupliquer (⌘D)">${I.copy}</button><button data-pp="del" class="danger" title="Supprimer (⌫)">${I.trash}</button></div>`;
    bar.innerHTML = html;
    bar.classList.add('on');
  };

  // ---------- Modifications (locales puis envoyées) ----------
  const snapshot = o => o ? JSON.parse(JSON.stringify(o)) : null;
  C.commit = function (changes, { record = true, send = true } = {}) {
    // changes : [{ id, before, after }] ; after null = suppression
    const k = card();
    if (!k || !changes.length) return;
    for (const ch of changes) {
      const i = k.objects.findIndex(o => o.id === ch.id);
      if (ch.after) { if (i >= 0) k.objects[i] = ch.after; else k.objects.push(ch.after); }
      else if (i >= 0) k.objects.splice(i, 1);
    }
    if (record) { (C.history[k.id] ||= []).push(changes); if (C.history[k.id].length > 120) C.history[k.id].shift(); C.future[k.id] = []; }
    if (send) for (const ch of changes) C.pending.set(`${k.id}|${ch.id}`, { cardId: k.id, id: ch.id, after: ch.after });
    C.redraw(changes.map(c => c.id));
    if (send) C.scheduleSend();
  };
  C.scheduleSend = function (delay = 120) { clearTimeout(C.sendTimer); C.sendTimer = setTimeout(() => C.flush(), delay); };
  C.flush = async function () {
    clearTimeout(C.sendTimer);
    if (!C.pending.size || !E.space) return;
    const batch = [...C.pending.values()];
    C.pending.clear();
    const byCard = new Map();
    for (const p of batch) { if (!byCard.has(p.cardId)) byCard.set(p.cardId, { up: [], del: [] }); (p.after ? byCard.get(p.cardId).up : byCard.get(p.cardId).del).push(p.after || p.id); }
    for (const [cid, { up, del }] of byCard) {
      try {
        if (up.length) { const r = await E.api('POST', `/spaces/${E.space.id}/cards/${cid}/objects`, { objects: up }); const k = E.space.cards.find(x => x.id === cid); if (k) for (const o of r.objects) { const i = k.objects.findIndex(x => x.id === o.id); if (i >= 0 && !C.pending.has(`${cid}|${o.id}`)) k.objects[i] = o; } }
        if (del.length) await E.api('POST', `/spaces/${E.space.id}/cards/${cid}/objects/delete`, { ids: del });
      } catch (err) { toast(err.message, 'error'); E.reload(); }
    }
  };
  C.redraw = function (ids) {
    const k = card();
    const objs = C.root?.querySelector('.cv-objs');
    if (!objs || !k) return;
    const lineIds = new Set(k.objects.filter(o => o.type === 'line' || o.type === 'arrow').map(o => o.id));
    for (const id of ids) {
      if (C.editing === id) continue;
      const el = objs.querySelector(`.obj[data-obj="${CSS.escape(id)}"]`);
      const o = k.objects.find(x => x.id === id);
      if (lineIds.has(id) || (!o && !el)) continue;
      if (!o) { el?.remove(); continue; }
      const tmp = document.createElement('div');
      tmp.innerHTML = objHTML(o);
      const fresh = tmp.firstElementChild;
      if (!fresh) continue;
      if (el) {
        const media = el.querySelector('video, audio, iframe');
        if (media && el.querySelector('video, audio, iframe')?.src === fresh.querySelector('video, audio, iframe')?.src) { el.setAttribute('style', fresh.getAttribute('style')); el.className = fresh.className; }
        else el.replaceWith(fresh);
      } else objs.insertBefore(fresh, objs.querySelector('.cv-lines'));
    }
    const svg = objs.querySelector('.cv-lines');
    const tmp = document.createElement('div');
    tmp.innerHTML = linesSVG(k);
    svg?.replaceWith(tmp.firstElementChild);
    C.renderSelection();
    C.thumbSoon();
  };
  C.thumbSoon = debounce(() => C.renderCards(), 600);
  C.patch = function (ids, fn, opts) {
    const changes = [];
    for (const id of ids) { const o = obj(id); if (!o || !canTouch(o)) continue; const before = snapshot(o); const after = snapshot(o); fn(after); changes.push({ id, before, after }); }
    C.commit(changes, opts);
  };
  C.add = function (o, { select = true } = {}) {
    const k = card();
    const z = Math.max(0, ...k.objects.map(x => x.z || 0)) + 1;
    const full = { id: `o_${randomId(10)}`, rot: 0, locked: false, style: {}, z, author: { id: E.me?.id, name: E.me?.name }, ...o };
    for (const key of ['x', 'y', 'w', 'h']) if (typeof full[key] === 'number') full[key] = Math.round(full[key]);
    C.commit([{ id: full.id, before: null, after: full }]);
    if (select) { C.sel = new Set([full.id]); C.renderSelection(); }
    return full;
  };
  C.remove = function (ids) { C.commit([...ids].map(obj).filter(o => o && canTouch(o)).map(o => ({ id: o.id, before: snapshot(o), after: null }))); C.sel.clear(); C.renderSelection(); };
  C.undo = function (redo = false) {
    const k = card();
    const stack = (redo ? C.future : C.history)[k.id] || [];
    const changes = stack.pop();
    if (!changes) return;
    (redo ? (C.history[k.id] ||= []) : (C.future[k.id] ||= [])).push(changes);
    C.commit(changes.map(c => ({ id: c.id, before: c.after, after: redo ? c.after : c.before })), { record: false });
  };
  C.center = (w, h) => { const [W, H] = size(); return { x: Math.round((W - w) / 2 + (Math.random() - 0.5) * 60), y: Math.round((H - h) / 2 + (Math.random() - 0.5) * 60) }; };
  C.addMedia = async function (file) {
    try {
      toast(`Envoi de ${file.name}…`);
      const att = await E.upload(file);
      let w = 480, h = 320;
      if (att.kind === 'image' || att.kind === 'svg' || att.kind === 'drawing') { const ratio = att.w && att.h ? att.h / att.w : 0.66; w = Math.min(640, att.w || 640); h = Math.round(w * ratio); if (h > 600) { h = 600; w = Math.round(h / ratio); } }
      if (att.kind === 'audio') { w = 420; h = 90; }
      if (att.kind === 'file') { w = 340; h = 90; }
      const type = att.kind === 'svg' || att.kind === 'drawing' ? 'image' : att.kind;
      C.add({ type, media: att.file, name: att.name, mime: att.mime, w, h, ...C.center(w, h) });
    } catch (err) { toast(err.message, 'error'); }
  };

  // ---------- Édition de texte ----------
  C.editText = function (id) {
    const o = obj(id);
    if (!o || !canTouch(o) || o.locked && !E.can('edit')) return;
    const el = C.root.querySelector(`.cv-page .obj[data-obj="${CSS.escape(id)}"]`);
    const target = el?.querySelector('.obj-text, .obj-sticky, .obj-label, .obj-frame span');
    if (!target) return;
    C.editing = id;
    C.renderProps();
    el.classList.add('editing');
    target.contentEditable = 'plaintext-only';
    if (target.contentEditable !== 'plaintext-only') target.contentEditable = 'true';
    target.querySelector('.by')?.remove();
    target.focus();
    const range = document.createRange(); range.selectNodeContents(target); const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    const finish = () => {
      target.removeEventListener('blur', finish);
      target.contentEditable = 'false';
      el.classList.remove('editing');
      const text = target.innerText.replace(/\n$/, '');
      C.editing = null;
      if (!text.trim() && (o.type === 'text' || o.type === 'sticky') && !o.text) { C.remove([id]); return; }
      C.patch([id], x => { x.text = text; });
      C.renderProps();
    };
    target.addEventListener('blur', finish);
    target.addEventListener('keydown', e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.stopPropagation(); target.blur(); } e.stopPropagation(); });
  };

  // ---------- Pointeur ----------
  C.bind = function (body) {
    const stage = body.querySelector('.cv-stage');
    stage.addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); C.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY); } }, { passive: false });
    stage.addEventListener('pointerdown', C.down);
    stage.addEventListener('dblclick', e => {
      if (interactive()) return;
      const el = e.target.closest('.obj');
      const media = el && obj(el.dataset.obj);
      // En mode création, un clic sélectionne ; le double-clic ouvre le lien ou le fichier, ou lance la lecture.
      if (media && (media.type === 'link' || media.type === 'embed') && media.url) { e.preventDefault(); return C.follow({ type: 'url', target: media.url }); }
      if (media?.type === 'file') return E.saveMedia({ file: media.media, name: media.name });
      if (media && (media.type === 'video' || media.type === 'audio')) { const m = el.querySelector('video, audio'); if (m) m.paused ? m.play().catch(() => {}) : m.pause(); return; }
      if (el && /^(text|sticky|frame|rect|ellipse|triangle|diamond|star|hexagon)$/.test(obj(el.dataset.obj)?.type)) { C.sel = new Set([el.dataset.obj]); C.renderSelection(); C.editText(el.dataset.obj); return; }
      if (!el && canDraw() && C.tool === 'select') { const [x, y] = C.toCard(e.clientX, e.clientY); const o = C.add({ type: 'text', text: '', x: x - 10, y: y - 20, w: 420, h: 60, style: { fontSize: 32, color: C.color } }); setTimeout(() => C.editText(o.id), 20); }
    });
  };
  C.zoomBy = function (f, cx, cy) {
    const stage = C.root?.querySelector('.cv-stage');
    if (!stage) return;
    // Le point sous le curseur (ou le centre de la vue) reste immobile pendant le zoom.
    const r = stage.getBoundingClientRect();
    const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
    const [x0, y0] = C.toCard(px, py);
    C.zoomSet = true; C.zoom = clamp(C.zoom * f, 0.25, 4); C.fit();
    const [x1, y1] = C.toCard(px, py);
    stage.scrollLeft += (x0 - x1) * C.k; stage.scrollTop += (y0 - y1) * C.k;
  };
  C.down = function (e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target.closest('.cv-props, .poll button, .poll input, video, audio, iframe, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const stage = C.root.querySelector('.cv-stage');
    const tool = C.spaceDown ? 'hand' : C.tool;
    const [x, y] = C.toCard(e.clientX, e.clientY);
    const objEl = e.target.closest('.obj, .cv-line');
    const id = objEl?.dataset.obj;
    if (interactive()) {
      const o = id && obj(id);
      if (o?.action) { e.preventDefault(); C.follow(o.action); }
      return;
    }
    if (tool === 'hand') { const sx = stage.scrollLeft, sy = stage.scrollTop, x0 = e.clientX, y0 = e.clientY; stage.classList.add('panning'); const mv = ev => { stage.scrollLeft = sx - (ev.clientX - x0); stage.scrollTop = sy - (ev.clientY - y0); }; const up = () => { stage.classList.remove('panning'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); return; }
    if (!canDraw()) { if (id) { const o = obj(id); if (o?.action && (e.metaKey || e.ctrlKey)) C.follow(o.action); } return; }
    e.preventDefault();
    const handle = e.target.closest('[data-handle]');
    const pt = e.target.closest('[data-pt]');
    if (pt) return C.dragPoint(e, pt.dataset.id, +pt.dataset.pt);
    if (handle) return C.resize(e, handle.dataset.handle);
    if (['pen', 'marker'].includes(tool)) return C.drawPath(e, tool === 'marker');
    if (tool === 'eraser') return C.erase(e);
    if (tool === 'line' || tool === 'arrow') return C.drawLine(e, tool);
    if (tool === 'shape' || tool === 'sticky' || tool === 'text') return C.drawBox(e, tool);
    if (id && (e.metaKey || e.ctrlKey) && obj(id)?.action) return C.follow(obj(id).action);
    if (id) {
      if (e.shiftKey) { C.sel.has(id) ? C.sel.delete(id) : C.sel.add(id); C.renderSelection(); return; }
      if (!C.sel.has(id)) { C.sel = new Set([id]); C.renderSelection(); }
      return C.moveSel(e);
    }
    return C.marquee(e);
  };
  C.moveSel = function (e) {
    const ids = [...C.sel].filter(id => { const o = obj(id); return o && canTouch(o) && !o.locked; });
    if (!ids.length) return;
    const start = C.toCard(e.clientX, e.clientY);
    const before = ids.map(id => snapshot(obj(id)));
    let moved = false;
    const mv = ev => {
      const [x, y] = C.toCard(ev.clientX, ev.clientY);
      let dx = x - start[0], dy = y - start[1];
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      for (const b of before) {
        const o = obj(b.id); if (!o) continue;
        o.x = Math.round(b.x + dx); o.y = Math.round(b.y + dy);
        if (o.points && (o.type === 'line' || o.type === 'arrow')) o.points = b.points.map(([px, py]) => [px + dx, py + dy]);
        const el = C.root.querySelector(`.cv-page .obj[data-obj="${CSS.escape(b.id)}"]`);
        if (el) { el.style.left = `${o.x}px`; el.style.top = `${o.y}px`; }
        C.pending.set(`${C.cardId}|${o.id}`, { cardId: C.cardId, id: o.id, after: snapshot(o) });
      }
      C.redrawLinesOnly();
      C.renderSelection();
      C.scheduleSend(90);
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      if (!moved) return;
      const changes = before.map(b => ({ id: b.id, before: b, after: snapshot(obj(b.id)) }));
      (C.history[C.cardId] ||= []).push(changes); C.future[C.cardId] = [];
      C.flush(); C.thumbSoon();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  C.redrawLinesOnly = function () { const k = card(); const svg = C.root?.querySelector('.cv-page .cv-lines'); if (!svg || !k) return; const tmp = document.createElement('div'); tmp.innerHTML = linesSVG(k); svg.replaceWith(tmp.firstElementChild); };
  C.resize = function (e, h) {
    const id = [...C.sel][0];
    const o0 = snapshot(obj(id));
    if (!o0) return;
    const keep = e.shiftKey || ['image', 'sticker', 'video'].includes(o0.type);
    const ratio = o0.w / o0.h;
    const mv = ev => {
      const [x, y] = C.toCard(ev.clientX, ev.clientY);
      const o = obj(id);
      let { x: nx, y: ny, w, h: hh } = o0;
      if (h.includes('e')) w = Math.max(16, x - o0.x);
      if (h.includes('s')) hh = Math.max(16, y - o0.y);
      if (h.includes('w')) { w = Math.max(16, o0.x + o0.w - x); nx = o0.x + o0.w - w; }
      if (h.includes('n')) { hh = Math.max(16, o0.y + o0.h - y); ny = o0.y + o0.h - hh; }
      if (keep && (ev.shiftKey || ['image', 'sticker', 'video'].includes(o0.type))) { if (h === 'n' || h === 's') w = hh * ratio; else hh = w / ratio; if (h.includes('w')) nx = o0.x + o0.w - w; if (h.includes('n')) ny = o0.y + o0.h - hh; }
      Object.assign(o, { x: Math.round(nx), y: Math.round(ny), w: Math.round(w), h: Math.round(hh) });
      if (o.type === 'path' && o0.points) { const sx = o.w / o0.w, sy = o.h / o0.h; o.points = o0.points.map(([px, py]) => [Math.round(px * sx * 10) / 10, Math.round(py * sy * 10) / 10]); }
      C.redraw([id]);
      C.pending.set(`${C.cardId}|${id}`, { cardId: C.cardId, id, after: snapshot(o) });
      C.scheduleSend(120);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); (C.history[C.cardId] ||= []).push([{ id, before: o0, after: snapshot(obj(id)) }]); C.flush(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  C.marquee = function (e) {
    const start = C.toCard(e.clientX, e.clientY);
    const ov = C.root.querySelector('.cv-overlay');
    const box = document.createElement('div'); box.className = 'cv-marquee'; ov.appendChild(box);
    if (!e.shiftKey) { C.sel.clear(); C.renderSelection(); ov.appendChild(box); }
    const mv = ev => {
      const [x, y] = C.toCard(ev.clientX, ev.clientY);
      const l = Math.min(x, start[0]), t = Math.min(y, start[1]), w = Math.abs(x - start[0]), h = Math.abs(y - start[1]);
      Object.assign(box.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
      box._r = { l, t, r: l + w, b: t + h };
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const r = box._r; box.remove();
      if (!r || (r.r - r.l < 3 && r.b - r.t < 3)) { C.renderSelection(); return; }
      for (const o of card().objects) { const [p1, p2] = o.type === 'line' || o.type === 'arrow' ? lineEnds(o, card().objects) : [[o.x, o.y], [o.x + o.w, o.y + o.h]]; const ox1 = Math.min(p1[0], p2[0]), oy1 = Math.min(p1[1], p2[1]), ox2 = Math.max(p1[0], p2[0]), oy2 = Math.max(p1[1], p2[1]); if (ox1 < r.r && ox2 > r.l && oy1 < r.b && oy2 > r.t) C.sel.add(o.id); }
      C.renderSelection();
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  C.drawBox = function (e, tool) {
    const start = C.toCard(e.clientX, e.clientY);
    const ov = C.root.querySelector('.cv-overlay');
    const ghost = document.createElement('div'); ghost.className = 'cv-ghost'; ov.appendChild(ghost);
    let rect = null;
    const mv = ev => { const [x, y] = C.toCard(ev.clientX, ev.clientY); let w = Math.abs(x - start[0]), h = Math.abs(y - start[1]); if (ev.shiftKey) w = h = Math.max(w, h); rect = { x: Math.min(x, start[0]), y: Math.min(y, start[1]), w, h }; Object.assign(ghost.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${w}px`, height: `${h}px` }); };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); ghost.remove();
      const def = tool === 'sticky' ? [260, 220] : tool === 'text' ? [420, 60] : [220, 160];
      if (!rect || rect.w < 12 || rect.h < 12) rect = { x: start[0] - def[0] / 2, y: start[1] - def[1] / 2, w: def[0], h: def[1] };
      let o;
      if (tool === 'sticky') o = C.add({ type: 'sticky', text: '', ...rect, style: { fill: C.stickyFill || '#fef08a', fontSize: 24 } });
      else if (tool === 'text') o = C.add({ type: 'text', text: '', ...rect, h: Math.max(60, rect.h), style: { fontSize: 32, color: C.color } });
      else o = C.add({ type: C.shape, text: '', ...rect, style: { fill: C.shapeFill || '#c7d2fe', stroke: 'none', strokeWidth: 0, color: '#111827', fontSize: 26 } });
      C.setTool('select');
      if (tool !== 'shape') setTimeout(() => C.editText(o.id), 20);
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  C.hitObject = (x, y, exclude) => [...card().objects].sort((a, b) => (b.z || 0) - (a.z || 0)).find(o => o.id !== exclude && o.type !== 'line' && o.type !== 'arrow' && o.type !== 'path' && x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h);
  C.drawLine = function (e, tool) {
    const start = C.toCard(e.clientX, e.clientY);
    const fromObj = C.hitObject(...start);
    const o = C.add({ type: tool, points: [start, start], x: start[0], y: start[1], w: 1, h: 1, from: fromObj ? { id: fromObj.id, side: 'auto' } : undefined, style: { stroke: C.color, strokeWidth: C.width, head: tool === 'arrow' ? 'end' : 'none' } }, { select: false });
    const mv = ev => { const p = C.toCard(ev.clientX, ev.clientY); const cur = obj(o.id); cur.points = [start, p]; cur.x = Math.min(start[0], p[0]); cur.y = Math.min(start[1], p[1]); cur.w = Math.max(1, Math.abs(p[0] - start[0])); cur.h = Math.max(1, Math.abs(p[1] - start[1])); C.redrawLinesOnly(); };
    const up = ev => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
      const p = C.toCard(ev.clientX, ev.clientY);
      const toObj = C.hitObject(...p, fromObj?.id);
      if (Math.hypot(p[0] - start[0], p[1] - start[1]) < 6 && !toObj) { C.commit([{ id: o.id, before: null, after: null }], { record: false }); C.pending.set(`${C.cardId}|${o.id}`, { cardId: C.cardId, id: o.id, after: null }); C.scheduleSend(); return; }
      C.patch([o.id], x => { x.points = [start, p]; if (toObj) x.to = { id: toObj.id, side: 'auto' }; }, { record: false });
      C.sel = new Set([o.id]); C.setTool('select');
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  C.dragPoint = function (e, id, which) {
    const o0 = snapshot(obj(id));
    const mv = ev => { const p = C.toCard(ev.clientX, ev.clientY); const o = obj(id); const pts = [...lineEnds(o0, card().objects)]; pts[which] = p; o.points = pts; if (which === 0) delete o.from; else delete o.to; C.redrawLinesOnly(); C.renderSelection(); };
    const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); const p = C.toCard(ev.clientX, ev.clientY); const hit = C.hitObject(...p); const o = obj(id); if (hit) o[which === 0 ? 'from' : 'to'] = { id: hit.id, side: 'auto' }; const after = snapshot(o); C.commit([{ id, before: o0, after }]); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  C.drawPath = function (e, highlighter) {
    const pts = [C.toCard(e.clientX, e.clientY)];
    const ov = C.root.querySelector('.cv-overlay');
    const [W, H] = size();
    ov.insertAdjacentHTML('beforeend', `<svg class="cv-live" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="width:${W}px;height:${H}px"><path fill="none" stroke="${attr(highlighter ? (C.hl || '#fde047') : C.color)}" stroke-width="${highlighter ? C.width * 4 : C.width}" stroke-linecap="round" stroke-linejoin="round" ${highlighter ? 'opacity=".38"' : ''}/></svg>`);
    const live = ov.lastElementChild, path = live.querySelector('path');
    const mv = ev => { const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]; for (const x of evs) { const p = C.toCard(x.clientX, x.clientY); const l = pts[pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 1.5) pts.push(p); } path.setAttribute('d', pathD(pts)); };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); live.remove();
      if (pts.length < 2) pts.push([pts[0][0] + 0.5, pts[0][1] + 0.5]);
      const sw = highlighter ? C.width * 4 : C.width;
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const x = Math.min(...xs) - sw / 2, y = Math.min(...ys) - sw / 2, w = Math.max(...xs) - x + sw / 2, h = Math.max(...ys) - y + sw / 2;
      C.add({ type: 'path', x: Math.round(x), y: Math.round(y), w: Math.max(2, Math.round(w)), h: Math.max(2, Math.round(h)), points: simplify(pts).map(([px, py]) => [Math.round((px - x) * 10) / 10, Math.round((py - y) * 10) / 10]), highlighter, style: { stroke: highlighter ? (C.hl || '#fde047') : C.color, strokeWidth: sw } }, { select: false });
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  function simplify(pts, tol = 1.2) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) { const [ax, ay] = out[out.length - 1], [bx, by] = pts[i], [cx, cy] = pts[i + 1]; const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / (Math.hypot(cx - ax, cy - ay) || 1); if (area > tol) out.push(pts[i]); }
    out.push(pts[pts.length - 1]);
    return out.slice(0, 5000);
  }
  C.erase = function (e) {
    const hit = new Set();
    const test = ev => {
      const [x, y] = C.toCard(ev.clientX, ev.clientY);
      for (const o of card().objects) {
        if (hit.has(o.id) || !canTouch(o)) continue;
        if (o.type === 'path') { if (x >= o.x - 8 && x <= o.x + o.w + 8 && y >= o.y - 8 && y <= o.y + o.h + 8 && (o.points || []).some(([px, py]) => Math.hypot(o.x + px - x, o.y + py - y) < 12 + (o.style?.strokeWidth || 4) / 2)) { hit.add(o.id); C.root.querySelector(`.cv-page .obj[data-obj="${CSS.escape(o.id)}"]`)?.classList.add('erasing'); } }
        else if (o.type === 'line' || o.type === 'arrow') { const [p1, p2] = lineEnds(o, card().objects); const l2 = (p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2 || 1; const t = clamp(((x - p1[0]) * (p2[0] - p1[0]) + (y - p1[1]) * (p2[1] - p1[1])) / l2, 0, 1); if (Math.hypot(x - (p1[0] + t * (p2[0] - p1[0])), y - (p1[1] + t * (p2[1] - p1[1]))) < 10) hit.add(o.id); }
      }
    };
    test(e);
    const up = () => { removeEventListener('pointermove', test); removeEventListener('pointerup', up); if (hit.size) C.remove(hit); };
    addEventListener('pointermove', test); addEventListener('pointerup', up);
  };
  C.follow = function (action) {
    if (action.type === 'url') { if (window.call && E.mode === 'app') call('openURL', { url: action.target }).catch(err => toast(err.message, 'error')); else window.open(action.target, '_blank', 'noopener'); return; }
    const i = E.space.cards.findIndex(k => k.id === C.cardId);
    const target = action.type === 'card' ? action.target : action.type === 'next' ? E.space.cards[i + 1]?.id : E.space.cards[i - 1]?.id;
    if (!target || !E.space.cards.some(k => k.id === target)) { toast('Cette carte n’est pas accessible.'); return; }
    C.go(target);
    if (C.presentGo) C.presentGo(target);
  };
  C.go = function (id) { C.flush(); C.cardId = id; C.sel.clear(); C.editing = null; C.renderCards(); C.renderPage(); C.root?.querySelector(`.cv-thumb[data-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }); };
  C.setTool = function (t) { C.tool = t; C.root?.querySelectorAll('[data-cv-tool]').forEach(b => b.classList.toggle('on', b.dataset.cvTool === t)); C.root?.querySelector('.cv-stage')?.setAttribute('data-tool', t); if (t !== 'select') { C.sel.clear(); C.renderSelection(); } };

  // ---------- Barre d’outils et propriétés ----------
  C.actionMenu = function (anchor, o) {
    const items = [{ header: 'Quand on clique sur l’objet' }, { label: 'Aucune action', checked: !o.action, act: () => C.patch([o.id], x => { delete x.action; }) }, { label: 'Carte suivante', icon: 'chevR', checked: o.action?.type === 'next', act: () => C.patch([o.id], x => { x.action = { type: 'next' }; }) }, { label: 'Carte précédente', icon: 'chevL', checked: o.action?.type === 'prev', act: () => C.patch([o.id], x => { x.action = { type: 'prev' }; }) }, { sep: true }, { header: 'Aller à la carte…' }];
    for (const k of E.space.cards) if (k.id !== C.cardId) items.push({ label: k.title, icon: 'canvas', checked: o.action?.type === 'card' && o.action.target === k.id, act: () => C.patch([o.id], x => { x.action = { type: 'card', target: k.id }; }) });
    items.push({ sep: true }, { label: 'Ouvrir une adresse web…', icon: 'external', checked: o.action?.type === 'url', act: async () => { const u = await UI.prompt('Adresse web', o.action?.type === 'url' ? o.action.target : 'https://', { ok: 'Enregistrer' }); if (u) C.patch([o.id], x => { x.action = { type: 'url', target: u.trim() }; }); } });
    UI.menu(anchor, items);
  };
  C.cardMenu = function (anchor, id) {
    const k = E.space.cards.find(x => x.id === id);
    const i = E.space.cards.indexOf(k);
    const items = [
      { label: 'Renommer…', icon: 'edit', act: async () => { const t = await UI.prompt('Nom de la carte', k.title); if (t && t.trim()) C.updateCard(id, { title: t.trim() }); } },
      { label: 'Dupliquer', icon: 'copy', act: async () => { const r = await E.api('POST', `/spaces/${E.space.id}/cards/${id}/duplicate`); E.upsertCard(r.card, r.index); C.go(r.card.id); } },
      { label: 'Monter', icon: 'chevU', disabled: i === 0, act: () => C.reorder(id, -1) },
      { label: 'Descendre', icon: 'chevD', disabled: i === E.space.cards.length - 1, act: () => C.reorder(id, 1) },
      { header: 'Fond' },
      ...['#ffffff', '#f8fafc', '#fef9c3', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3', '#1f2937'].map(c => ({ label: c === '#ffffff' ? 'Blanc' : c === '#1f2937' ? 'Sombre' : c, icon: `<i class="sw-ic" style="background:${c}"></i>`, checked: (k.background || '#ffffff') === c, act: () => C.updateCard(id, { background: c }) })),
    ];
    if (E.space.settings.groupWork && E.space.groups.length) { items.push({ header: 'Réservée à' }, { label: 'Tout le monde', checked: !k.groupId, act: () => C.updateCard(id, { groupId: null }) }); for (const g of E.space.groups) items.push({ label: g.name, icon: `<i class="sw-ic" style="background:${g.color}"></i>`, checked: k.groupId === g.id, act: () => C.updateCard(id, { groupId: g.id }) }); }
    items.push({ sep: true }, { label: 'Supprimer la carte', icon: 'trash', danger: true, disabled: E.space.cards.length <= 1, act: async () => { if (!await UI.confirm(`Supprimer « ${k.title} » et ses ${plural(k.objects.length, 'objet')} ?`, { ok: 'Supprimer', danger: true })) return; try { await E.api('DELETE', `/spaces/${E.space.id}/cards/${id}`); E.space.cards = E.space.cards.filter(x => x.id !== id); if (C.cardId === id) C.cardId = E.space.cards[Math.max(0, i - 1)]?.id; C.renderCards(); C.renderPage(); } catch (err) { toast(err.message, 'error'); } } });
    UI.menu(anchor, items, { align: 'right' });
  };
  C.updateCard = async function (id, patch) {
    try { const { card: k } = await E.api('PATCH', `/spaces/${E.space.id}/cards/${id}`, patch); E.upsertCard(k); C.renderCards(); if (id === C.cardId) C.renderPage(); } catch (err) { toast(err.message, 'error'); }
  };
  C.reorder = async function (id, dir) {
    const ids = E.space.cards.map(k => k.id); const i = ids.indexOf(id); const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const by = new Map(E.space.cards.map(k => [k.id, k])); E.space.cards = ids.map(x => by.get(x)); C.renderCards(); C.renderPage();
    try { await E.api('POST', `/spaces/${E.space.id}/cards/order`, { ids }); } catch (err) { toast(err.message, 'error'); E.reload(); }
  };
  C.addCard = async function () {
    try { const { card: k, index } = await E.api('POST', `/spaces/${E.space.id}/cards`, { title: `Carte ${E.space.cards.length + 1}`, index: E.space.cards.findIndex(x => x.id === C.cardId) + 1 }); E.upsertCard(k, index); C.go(k.id); }
    catch (err) { toast(err.message, 'error'); }
  };
  C.pollDialog = async function () {
    const q = await UI.prompt('Question du sondage', '', { placeholder: 'Ex. Quelle option préférez-vous ?', ok: 'Suivant' });
    if (q === null) return;
    const opts = await UI.prompt('Réponses (une par ligne)', 'Oui\nNon', { multiline: true, ok: 'Créer le sondage' });
    if (!opts) return;
    const options = opts.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12).map(text => ({ id: `o_${randomId(5)}`, text }));
    if (options.length < 2) { toast('Il faut au moins deux réponses.', 'error'); return; }
    C.add({ type: 'poll', w: 420, h: 110 + options.length * 52, ...C.center(420, 110 + options.length * 52), poll: { question: q.trim(), options, multiple: false } });
  };
  C.handleClick = async function (e) {
    const b = e.target.closest('[data-cv]');
    const tool = e.target.closest('[data-cv-tool]');
    const thumb = e.target.closest('.cv-thumb');
    const pp = e.target.closest('[data-pp]');
    if (tool) {
      const t = tool.dataset.cvTool;
      if (t === 'shape') return UI.menu(tool, SHAPES.map(s => ({ label: { rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', diamond: 'Losange', star: 'Étoile', hexagon: 'Hexagone' }[s], icon: s, checked: C.shape === s, act: () => { C.shape = s; tool.innerHTML = I[s]; C.setTool('shape'); } })));
      if ((t === 'pen' || t === 'marker' || t === 'line' || t === 'arrow') && C.tool === t) return C.strokeMenu(tool, t);
      if (t === 'sticky' && C.tool === 'sticky') return UI.menu(tool, STICKY.map(c => ({ label: 'Couleur', icon: `<i class="sw-ic" style="background:${c}"></i>`, checked: (C.stickyFill || '#fef08a') === c, act: () => { C.stickyFill = c; } })));
      return C.setTool(t);
    }
    if (pp) return C.applyProp(pp, e);
    if (b) {
      const a = b.dataset.cv;
      switch (a) {
        case 'image': { const files = await E.pickFiles(''); for (const f of files) C.addMedia(f); return; }
        case 'link': { const u = await UI.prompt('Lien web ou vidéo', '', { placeholder: 'https://…', ok: 'Ajouter' }); if (!u) return; try { const { preview } = await E.api('POST', `/spaces/${E.space.id}/preview`, { url: u.trim() }); const w = preview.embed ? 560 : 420, h = preview.embed ? 315 : 120; C.add({ type: preview.embed ? 'embed' : 'link', url: preview.url, embed: preview.embed || undefined, preview: { title: preview.title, site: preview.site, image: preview.image }, w, h, ...C.center(w, h) }); } catch (err) { toast(err.message, 'error'); } return; }
        case 'sticker': return emojiPicker(b, em => C.add({ type: 'sticker', emoji: em, w: 140, h: 140, ...C.center(140, 140) }));
        case 'poll': return C.pollDialog();
        case 'record': return UI.menu(b, [{ label: 'Message audio', icon: 'mic', act: () => E.record('audio').then(f => f && C.addMedia(f)) }, { label: 'Vidéo (caméra)', icon: 'video', act: () => E.record('video').then(f => f && C.addMedia(f)) }, { label: 'Enregistrement d’écran', icon: 'screen', act: () => E.record('screen').then(f => f && C.addMedia(f)) }, { label: 'Photo', icon: 'camera', act: () => E.capturePhoto().then(f => f && C.addMedia(f)) }]);
        case 'frame': return C.add({ type: 'frame', text: 'Cadre', w: 600, h: 400, ...C.center(600, 400), z: Math.min(0, ...card().objects.map(o => o.z || 0)) - 1, style: { stroke: '#94a3b8', fill: 'none' } });
        case 'undo': return C.undo();
        case 'redo': return C.undo(true);
        case 'prev': { const i = E.space.cards.findIndex(k => k.id === C.cardId); if (i > 0) C.go(E.space.cards[i - 1].id); return; }
        case 'next': { const i = E.space.cards.findIndex(k => k.id === C.cardId); if (i < E.space.cards.length - 1) C.go(E.space.cards[i + 1].id); return; }
        case 'zoom-in': return C.zoomBy(1.25);
        case 'zoom-out': return C.zoomBy(0.8);
        case 'zoom-fit': C.zoomSet = false; return C.fit(false);
        case 'mode-edit': C.preview = false; return E.renderSpace();
        case 'mode-preview': C.preview = true; C.sel.clear(); return E.renderSpace();
        case 'overview': return C.overview();
        case 'add-card': return C.addCard();
        case 'card-menu': e.stopPropagation(); return C.cardMenu(b, b.closest('.cv-thumb').dataset.card);
        case 'open-file': { if (!interactive() && !(e.metaKey || e.ctrlKey)) return; const o = obj(e.target.closest('.obj')?.dataset.obj); if (o) E.saveMedia({ file: o.media, name: o.name }); return; }
        case 'url': if (!interactive() && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); return; } if (window.call && E.mode === 'app') { e.preventDefault(); call('openURL', { url: b.href }).catch(err => toast(err.message, 'error')); } return;
      }
    }
    if (thumb && !e.target.closest('button')) return C.go(thumb.dataset.card);
  };
  C.strokeMenu = function (anchor, t) {
    const colors = t === 'marker' ? ['#fde047', '#86efac', '#93c5fd', '#f9a8d4', '#fdba74'] : PALETTE;
    UI.menu(anchor, [{ header: 'Couleur' }, ...colors.map(c => ({ label: c, icon: `<i class="sw-ic" style="background:${c}"></i>`, checked: (t === 'marker' ? (C.hl || '#fde047') : C.color) === c, act: () => { if (t === 'marker') C.hl = c; else C.color = c; } })), { header: 'Épaisseur' }, ...[2, 4, 8, 14].map(w => ({ label: `${w} px`, icon: 'minus', checked: C.width === w, act: () => { C.width = w; } }))]);
  };
  C.applyProp = function (pp, e) {
    const ids = [...C.sel];
    const k = pp.dataset.pp, v = pp.dataset.v;
    const one = obj(ids[0]);
    switch (k) {
      case 'fill': case 'stroke': case 'color': return C.patch(ids, o => { o.style = { ...o.style, [k]: v }; if (k === 'stroke' && !o.style.strokeWidth) o.style.strokeWidth = 4; });
      case 'size': return C.patch(ids, o => { o.style = { ...o.style, fontSize: clamp((o.style.fontSize || (o.type === 'sticky' ? 24 : 28)) + (+v) * 4, 8, 200) }; });
      case 'weight': return C.patch(ids, o => { o.style = { ...o.style, weight: o.style.weight === 'bold' ? 'normal' : 'bold' }; });
      case 'align': return C.patch(ids, o => { const order = ['left', 'center', 'right']; o.style = { ...o.style, align: order[(order.indexOf(o.style.align || (o.type === 'text' ? 'left' : 'center')) + 1) % 3] }; });
      case 'front': { const z = Math.max(...card().objects.map(o => o.z || 0)); let n = 1; return C.patch(ids, o => { o.z = z + n++; }); }
      case 'back': { const z = Math.min(...card().objects.map(o => o.z || 0)); let n = ids.length; return C.patch(ids, o => { o.z = z - n--; }); }
      case 'lock': return C.patch(ids, o => { o.locked = !one.locked; });
      case 'dup': return C.duplicate();
      case 'del': return C.remove(ids);
      case 'action': return C.actionMenu(pp, one);
    }
  };
  C.duplicate = function () {
    const src = [...C.sel].map(obj).filter(o => o && canTouch(o));
    if (!src.length) return;
    const map = new Map(src.map(o => [o.id, `o_${randomId(10)}`]));
    const z = Math.max(0, ...card().objects.map(o => o.z || 0));
    const copies = src.map((o, i) => { const c = snapshot(o); c.id = map.get(o.id); c.x += 24; c.y += 24; c.z = z + 1 + i; c.author = { id: E.me?.id, name: E.me?.name }; if (c.points && (c.type === 'line' || c.type === 'arrow')) c.points = c.points.map(([x, y]) => [x + 24, y + 24]); for (const end of ['from', 'to']) if (c[end]) { if (map.has(c[end].id)) c[end] = { ...c[end], id: map.get(c[end].id) }; else delete c[end]; } return c; });
    C.commit(copies.map(c => ({ id: c.id, before: null, after: c })));
    C.sel = new Set(copies.map(c => c.id)); C.renderSelection();
  };
  C.key = function (e) {
    if (!C.root || !E.space || E.space.kind !== 'canvas' || UI.stack.length || UI.menuEl || C.editing || C.presenting) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === ' ' && !C.spaceDown) { C.spaceDown = true; C.root.querySelector('.cv-stage')?.classList.add('hand'); e.preventDefault(); return; }
    if (interactive()) { if (e.key === 'ArrowRight') C.handleClick({ target: C.root.querySelector('[data-cv="next"]') }); if (e.key === 'ArrowLeft') C.handleClick({ target: C.root.querySelector('[data-cv="prev"]') }); return; }
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); return C.undo(e.shiftKey); }
    if (meta && e.key.toLowerCase() === 'a') { e.preventDefault(); C.sel = new Set(card().objects.filter(canTouch).map(o => o.id)); return C.renderSelection(); }
    if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); return C.duplicate(); }
    if (meta && e.key.toLowerCase() === 'c' && C.sel.size) { C.clipboard = [...C.sel].map(obj).filter(Boolean).map(snapshot); return; }
    if (meta && (e.key === '=' || e.key === '+')) { e.preventDefault(); return C.zoomBy(1.25); }
    if (meta && e.key === '-') { e.preventDefault(); return C.zoomBy(0.8); }
    if (meta && e.key === '0') { e.preventDefault(); C.zoomSet = false; return C.fit(false); }
    if ((e.key === 'Backspace' || e.key === 'Delete') && C.sel.size) { e.preventDefault(); return C.remove(C.sel); }
    if (e.key === 'Escape') { if (C.sel.size) { C.sel.clear(); C.renderSelection(); } else C.setTool('select'); return; }
    if (e.key === 'Enter' && C.sel.size === 1) { e.preventDefault(); return C.editText([...C.sel][0]); }
    if (e.key.startsWith('Arrow') && C.sel.size) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0; return C.patch([...C.sel], o => { o.x += dx; o.y += dy; if (o.points && (o.type === 'line' || o.type === 'arrow')) o.points = o.points.map(([x, y]) => [x + dx, y + dy]); }); }
    if (e.key === '[' && C.sel.size) return C.applyProp({ dataset: { pp: 'back' } });
    if (e.key === ']' && C.sel.size) return C.applyProp({ dataset: { pp: 'front' } });
    if (meta || e.altKey) return;
    const tools = { v: 'select', h: 'hand', t: 'text', n: 'sticky', r: 'shape', a: 'arrow', l: 'line', p: 'pen', m: 'marker', e: 'eraser' };
    if (tools[e.key.toLowerCase()] && canDraw()) { e.preventDefault(); C.setTool(tools[e.key.toLowerCase()]); }
  };
  C.paste = async function (e) {
    if (!C.root || E.space?.kind !== 'canvas' || UI.stack.length || C.editing || !canDraw()) return;
    if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    const files = E.filesFrom(e.clipboardData);
    if (files.length) { e.preventDefault(); for (const f of files) C.addMedia(f); return; }
    if (C.clipboard?.length) {
      e.preventDefault();
      const z = Math.max(0, ...card().objects.map(o => o.z || 0));
      const copies = C.clipboard.map((o, i) => { const c = snapshot(o); c.id = `o_${randomId(10)}`; c.x += 30; c.y += 30; c.z = z + 1 + i; c.author = { id: E.me?.id, name: E.me?.name }; delete c.from; delete c.to; if (c.points && (c.type === 'line' || c.type === 'arrow')) c.points = c.points.map(([x, y]) => [x + 30, y + 30]); return c; });
      C.commit(copies.map(c => ({ id: c.id, before: null, after: c })));
      C.sel = new Set(copies.map(c => c.id)); C.renderSelection();
      C.clipboard = copies.map(snapshot);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    if (text.trim()) { e.preventDefault(); const url = E.urlFrom(e.clipboardData); if (url) { try { const { preview } = await E.api('POST', `/spaces/${E.space.id}/preview`, { url }); const w = preview.embed ? 560 : 420, h = preview.embed ? 315 : 120; C.add({ type: preview.embed ? 'embed' : 'link', url: preview.url, embed: preview.embed || undefined, preview: { title: preview.title, site: preview.site, image: preview.image }, w, h, ...C.center(w, h) }); } catch (err) { toast(err.message, 'error'); } } else C.add({ type: 'sticky', text: text.slice(0, 2000), w: 280, h: 220, ...C.center(280, 220), style: { fill: '#fef08a', fontSize: 22 } }); }
  };

  // ---------- Vue d’ensemble, présentation, impression ----------
  C.overview = function () {
    const [W, H] = size();
    const tw = 360, scale = tw / W;
    const box = UI.modal(`<div class="sheet-head"><h2>${I.grid}Vue d’ensemble — mise en commun</h2><button class="btn icon ghost" data-ov="close">${I.close}</button></div><div class="cv-overview">${E.space.cards.map((k, i) => { const g = E.space.groups.find(x => x.id === k.groupId); return `<button class="cv-ov-card" data-ov-card="${attr(k.id)}"><div class="ct-frame" style="height:${Math.round(H * scale)}px"><div class="ct-page" style="width:${W}px;height:${H}px;transform:scale(${scale});background:${attr(k.background || '#ffffff')}">${pageInner(k, { thumb: true })}</div></div><span>${i + 1}. ${esc(k.title)}${g ? ` · <i class="gdot" style="background:${attr(g.color)}"></i>${esc(g.name)}` : ''} · ${plural(k.objects.length, 'objet')}</span></button>`; }).join('')}</div>`, { cls: 'sheet wide' });
    box.addEventListener('click', e => { if (e.target.closest('[data-ov="close"]')) return UI.close(box); const c = e.target.closest('[data-ov-card]'); if (c) { UI.close(box); C.go(c.dataset.ovCard); } });
  };
  C.present = function () {
    if (!E.space) return;
    C.flush();
    const [W, H] = size();
    let i = Math.max(0, E.space.cards.findIndex(k => k.id === C.cardId));
    const el = document.createElement('div');
    el.className = 'esp-present canvas-present';
    document.body.appendChild(el); document.body.classList.add('presenting');
    C.presenting = true;
    const draw = () => {
      const k = E.space.cards[i];
      if (!k) return close();
      const scale = Math.max(0.05, Math.min((innerWidth - 40) / W, (innerHeight - 100) / H));
      el.innerHTML = `<div class="pr-stage"><div class="cv-present-fit" style="width:${Math.round(W * scale)}px;height:${Math.round(H * scale)}px"><div class="cv-present-page" style="width:${W}px;height:${H}px;transform:scale(${scale});background:${attr(k.background || '#ffffff')}">${pageInner(k).replace(/class="obj /g, 'class="obj pres ')}</div></div></div><div class="pr-bar"><button data-pr="prev" ${i ? '' : 'disabled'}>${I.chevL}</button><span>${i + 1} / ${E.space.cards.length} · ${esc(k.title)}</span><button data-pr="next" ${i < E.space.cards.length - 1 ? '' : 'disabled'}>${I.chevR}</button><button data-pr="full">${I.fullscreen}</button><button data-pr="close">${I.close}</button></div>`;
    };
    C.presentGo = id => { const j = E.space.cards.findIndex(k => k.id === id); if (j >= 0) { i = j; draw(); } };
    const close = () => { C.presenting = false; C.presentGo = null; document.removeEventListener('keydown', onKey, true); removeEventListener('resize', draw); el.remove(); document.body.classList.remove('presenting'); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); C.go(E.space.cards[i]?.id || C.cardId); };
    const onKey = e => { if (UI.stack.length) return; if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); if (i < E.space.cards.length - 1) { i++; draw(); } } else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); if (i) { i--; draw(); } } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key.toLowerCase() === 'f') el.requestFullscreen?.().catch(() => {}); };
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', draw);
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-pr]');
      if (b) { const a = b.dataset.pr; if (a === 'prev' && i) i--; else if (a === 'next' && i < E.space.cards.length - 1) i++; else if (a === 'close') return close(); else if (a === 'full') return el.requestFullscreen?.().catch(() => {}); draw(); return; }
      const vote = e.target.closest('[data-e="vote"]');
      if (vote) { const pollEl = vote.closest('.poll'); await C.votePoll(pollEl.dataset.card, pollEl.dataset.obj, vote.dataset.opt); draw(); return; }
      const o = e.target.closest('.obj');
      const ob = o && E.space.cards[i].objects.find(x => x.id === o.dataset.obj);
      if (ob?.action) { if (ob.action.type === 'url') return C.follow(ob.action); const target = ob.action.type === 'card' ? ob.action.target : ob.action.type === 'next' ? E.space.cards[i + 1]?.id : E.space.cards[i - 1]?.id; const j = E.space.cards.findIndex(k => k.id === target); if (j >= 0) { i = j; draw(); } }
    });
    draw();
  };
  C.votePoll = async function (cardId, objectId, optionId) {
    const k = E.space.cards.find(x => x.id === cardId);
    const o = k?.objects.find(x => x.id === objectId);
    if (!o?.poll) return;
    const mine = o.poll.mine || [];
    const options = o.poll.multiple ? (mine.includes(optionId) ? mine.filter(x => x !== optionId) : [...mine, optionId]) : (mine[0] === optionId ? [] : [optionId]);
    try { const { object } = await E.api('POST', `/spaces/${E.space.id}/cards/${cardId}/objects/${objectId}/vote`, { options }); Object.assign(o, object); if (cardId === C.cardId) C.redraw([objectId]); }
    catch (err) { toast(err.message, 'error'); }
  };
  C.printHTML = function () {
    const [W, H] = size();
    const scale = Math.min(1, 1000 / W);
    return `<div class="pv pv-canvas"><header><span class="pv-icon">${esc(E.space.icon)}</span><div><h1>${esc(E.space.title)}</h1><small>${plural(E.space.cards.length, 'carte')}</small></div></header>${E.space.cards.map((k, i) => `<section class="pv-card"><h2>${i + 1}. ${esc(k.title)}</h2><div class="ct-frame" style="width:${W * scale}px;height:${H * scale}px"><div class="ct-page" style="width:${W}px;height:${H}px;transform:scale(${scale});background:${attr(k.background || '#ffffff')}">${pageInner(k, { thumb: true })}</div></div></section>`).join('')}</div>`;
  };

  // ---------- Temps réel ----------
  E.on('objects', d => { if (!C.root || E.space?.kind !== 'canvas') return; if (d.cardId === C.cardId) { for (const id of d.removed || []) C.sel.delete(id); C.redraw([...(d.objects || []).map(o => o.id), ...(d.removed || [])]); } else C.thumbSoon(); });
  E.on('cards', () => { if (!C.root || E.space?.kind !== 'canvas') return; if (!E.space.cards.some(k => k.id === C.cardId)) C.cardId = E.space.cards[0]?.id; C.renderCards(); C.renderPage(); });
  document.addEventListener('click', e => { if (C.root && C.root.contains(e.target)) C.handleClick(e); });
  document.addEventListener('click', async e => {
    if (!C.root || !C.root.contains(e.target)) return;
    const vote = e.target.closest('.obj-poll [data-e="vote"]');
    if (vote) { e.stopPropagation(); const pollEl = vote.closest('.poll'); C.votePoll(pollEl.dataset.card, pollEl.dataset.obj, vote.dataset.opt); }
  }, true);
  document.addEventListener('change', e => { if (!C.root || !C.root.contains(e.target)) return; const s = e.target.closest('[data-pp-sel]'); if (s) { const key = s.dataset.ppSel, v = key === 'strokeWidth' ? +s.value : s.value; C.patch([...C.sel], o => { o.style = { ...o.style, [key]: v }; }); } });
  document.addEventListener('keydown', C.key);
  document.addEventListener('keyup', e => { if (e.key === ' ' && C.spaceDown) { C.spaceDown = false; C.root?.querySelector('.cv-stage')?.classList.remove('hand'); } });
  document.addEventListener('paste', C.paste);
  document.addEventListener('dragover', e => { if (C.root && C.root.contains(e.target) && canDraw()) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!C.root || !C.root.contains(e.target) || !canDraw()) return;
    const files = E.filesFrom(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) C.addMedia(f);
  });
  window.addEventListener('beforeunload', () => C.flush());
  return C;
})();

/* Cours Albert 3 — affichage d’un espace : en-tête, dispositions des tableaux, cartes, glisser-déposer, temps réel. */
'use strict';

E.isBoard = () => E.space?.kind === 'board';
E.layout = () => E.ui.layout || E.space?.settings.layout || 'wall';

// ======================= Ouverture d’un espace =======================
E.mount = async function (container, id) {
  if (E.mounted?.id === id && container.contains(E.mounted.el)) return;
  E.unmount();
  container.innerHTML = `<div class="esp esp-loading"><div class="spinner"></div><span>Ouverture de l’espace…</span></div>`;
  const el = container.firstElementChild;
  E.mounted = { id, el, container };
  let data;
  try { data = await E.api('GET', `/spaces/${encodeURIComponent(id)}`); }
  catch (err) {
    if (E.mounted?.el !== el) return;
    el.className = 'esp esp-error';
    const msg = err.status === 404 ? 'Cet espace n’existe plus, ou il n’est plus partagé.' : err.status === 403 ? 'Ce lien de partage n’est plus valide. Demandez un nouveau lien à la personne qui a créé l’espace.' : err.message;
    el.innerHTML = `<div class="esp-msg">${I.alert}<h2>Impossible d’ouvrir l’espace</h2><p>${esc(msg)}</p>${E.mode === 'app' ? `<button class="btn" data-act="go" data-to="accueil">${I.chevL}Retour à l’accueil</button>` : `<button class="btn" onclick="location.reload()">${I.sync}Réessayer</button>`}</div>`;
    return;
  }
  if (E.mounted?.el !== el) return;
  E.space = data.space; E.me = data.me; E.draft = data.draft; E.people = data.people || []; if (data.lan) E.lan = data.lan;
  E.ui = { search: '', section: '', author: '', status: '', sort: null, layout: null, zoom: 1, cardIndex: 0, tableSort: null, free: null };
  if (E.mode === 'guest' && innerWidth < 600 && ['free', 'table', 'timeline'].includes(E.space.settings.layout)) E.ui.layout = 'stream';
  E.renderSpace();
  E.connect(id);
  E.markRead?.(id);
  const sum = E.summary?.(id); if (sum) sum.openedAt = new Date().toISOString();
  const focusPost = new URLSearchParams(location.search).get('post');
  if (focusPost && E.space.posts.some(p => p.id === focusPost)) setTimeout(() => E.openPost?.(focusPost), 200);
};
E.unmount = function () {
  E.disconnect();
  E.Canvas?.unmount?.();
  E.map?.destroy?.();
  E.map = null;
  E.resizeObs?.disconnect(); E.resizeObs = null;
  E.space = null; E.me = null; E.mounted = null;
};

// ======================= En-tête =======================
E.renderSpace = function (keepScroll = true) {
  const m = E.mounted;
  if (!m || !E.space) return;
  const body = m.el.querySelector('.esp-body');
  const scroll = keepScroll && body ? { top: body.scrollTop, left: body.scrollLeft } : null;
  const { style, cls } = E.spaceStyle();
  m.el.className = `esp ${cls} kind-${E.space.kind} view-${E.isBoard() ? E.layout() : 'canvas'} ${E.mode === 'guest' ? 'guest' : ''}`;
  m.el.setAttribute('style', style);
  m.el.innerHTML = `${E.headHTML()}<div class="esp-body"></div>${E.isBoard() && E.can('post') ? `<button class="fab" data-e="compose" title="Ajouter une publication (N)">${I.plus}</button>` : ''}<div class="esp-offline-banner">${I.alert}Connexion perdue — reconnexion…</div>`;
  if (E.isBoard()) E.renderBoard(); else E.Canvas.render(m.el.querySelector('.esp-body'));
  if (scroll) { const b = m.el.querySelector('.esp-body'); b.scrollTop = scroll.top; b.scrollLeft = scroll.left; }
  if (E.mode === 'app' && typeof renderSidebar === 'function') renderSidebar();
  document.title = `${E.space.title} — Cours Albert`;
};
E.headHTML = function () {
  const s = E.space;
  const edit = E.can('edit');
  const pending = E.can('moderate') ? (s.pending || 0) : 0;
  const lay = E.layout();
  return `<header class="esp-head">
    <div class="eh-left">
      ${E.mode === 'app' ? `<button class="btn icon ghost eh-back" data-act="go" data-to="accueil" title="Accueil">${I.chevL}</button>` : ''}
      <button class="eh-icon" data-e="${edit ? 'icon' : ''}" title="${edit ? 'Changer l’icône' : ''}">${esc(s.icon)}</button>
      <div class="eh-titles">
        <h1 ${edit ? 'data-e="rename" title="Renommer"' : ''}>${esc(s.title)}</h1>
        ${s.description ? `<p class="eh-desc" ${edit ? 'data-e="describe"' : ''}>${esc(s.description)}</p>` : edit ? '<p class="eh-desc add" data-e="describe">Ajouter une description</p>' : ''}
      </div>
    </div>
    <div class="eh-right">
      <div class="presence" data-e="presence">${E.presenceHTML()}</div>
      ${E.isBoard() ? `<div class="eh-search">${I.search}<input type="search" placeholder="Rechercher" value="${attr(E.ui.search)}" data-e-search></div>` : ''}
      ${E.isBoard() ? `<button class="btn icon ${E.ui.section || E.ui.author || E.ui.status ? 'on' : ''}" data-e="filter" title="Filtrer">${I.filter}</button>` : ''}
      ${E.isBoard() && (edit || E.mode === 'guest') ? `<button class="btn eh-layout" data-e="layout" title="Disposition">${I[E.LAYOUTS.find(l => l.id === lay)?.icon || 'wall']}<span>${esc(E.LAYOUTS.find(l => l.id === lay)?.label || '')}</span>${I.chevD}</button>` : ''}
      ${pending ? `<button class="btn warn-btn" data-e="moderation">${I.shield}${pending} à valider</button>` : ''}
      ${E.isBoard() && E.can('edit') && !['map', 'free'].includes(lay) ? `<button class="btn icon ${E.Ink?.on ? 'on' : ''}" data-e="ink" title="Dessiner et écrire sur le tableau (D)">${I.pen}</button>` : ''}
      ${E.mode === 'app' && E.state?.ai?.enabled ? `<button class="btn icon" data-e="assistant" title="Ranger cet espace avec l’assistant IA">${I.sparkles}</button>` : ''}
      <button class="btn icon" data-e="present" title="Présenter (P)">${I.present}</button>
      ${E.can('share') ? `<button class="btn primary" data-e="share" title="Partager">${I.share}<span>Partager</span></button>` : ''}
      ${edit ? `<button class="btn icon" data-e="settings" title="Réglages de l’espace">${I.settings}</button>` : ''}
      ${E.mode === 'guest' ? `<button class="btn eh-me" data-e="me" title="Votre nom">${avatar(E.me?.name || 'Vous', E.me?.id, 22)}<span>${esc(E.me?.name || 'Vous')}</span></button>` : ''}
      ${E.can('edit') || E.can('moderate') || E.can('share') ? `<button class="btn icon" data-e="more" title="Plus d’actions">${I.more}</button>` : ''}
    </div>
  </header>`;
};
E.presenceHTML = function () {
  const people = E.presence.filter(p => p.id !== E.me?.id);
  if (!people.length) return '';
  return `${people.slice(0, 5).map(p => avatar(p.name, p.id, 26)).join('')}${people.length > 5 ? `<span class="more">+${people.length - 5}</span>` : ''}`;
};
E.on('presence', () => { const el = E.mounted?.el.querySelector('.presence'); if (el) el.innerHTML = E.presenceHTML(); });

// ======================= Publications visibles et ordre =======================
const collatorFR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
E.reactionScore = p => { const r = p.reactions || {}; return (r.like || 0) + (r.up || 0) - (r.down || 0) + (r.stars || 0) * (r.starsCount || 0) / 5 + Object.values(r.emoji || {}).reduce((a, b) => a + b, 0) + Object.values(r.fieldVotes || {}).reduce((a, b) => a + b, 0); };
E.sortList = function (list, sort = E.space.settings.sort) {
  const by = (fn, dir = 1) => [...list].sort((a, b) => dir * fn(a, b) || a.order - b.order);
  if (sort === 'newest') return by((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === 'oldest') return by((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (sort === 'title') return by((a, b) => collatorFR.compare(a.title || MD.plain(a.body), b.title || MD.plain(b.body)));
  if (sort === 'reactions') return by((a, b) => E.reactionScore(b) - E.reactionScore(a));
  if (sort === 'date') return by((a, b) => (a.eventDate || '9999').localeCompare(b.eventDate || '9999'));
  if (sort?.startsWith('field:')) {
    const f = E.field(sort.slice(6));
    if (f) return by((a, b) => { const va = a.fields?.[f.id], vb = b.fields?.[f.id]; if (va == null) return vb == null ? 0 : 1; if (vb == null) return -1; return typeof va === 'number' ? va - vb : collatorFR.compare(fieldText(f, va), fieldText(f, vb)); });
  }
  return by((a, b) => a.order - b.order);
};
E.visiblePosts = function () {
  const q = normalize(E.ui.search);
  return E.space.posts.filter(p => {
    if (E.ui.section && p.sectionId !== E.ui.section) return false;
    if (E.ui.author && p.author?.id !== E.ui.author) return false;
    if (E.ui.status === 'pending' && p.status !== 'pending') return false;
    if (E.ui.status === 'scheduled' && !(p.publishAt && Date.parse(p.publishAt) > Date.now())) return false;
    if (E.ui.status === 'mine' && !p.mine) return false;
    if (q && !normalize(`${p.title} ${p.body} ${p.author?.name} ${(p.attachments || []).map(a => a.name || a.preview?.title || '').join(' ')} ${Object.values(p.fields || {}).join(' ')} ${p.location?.label || ''}`).includes(q)) return false;
    return true;
  });
};
E.grouped = function (list) {
  const sorted = E.sortList(list);
  if (!E.space.settings.sections && E.layout() !== 'columns') return [{ section: null, posts: sorted }];
  return E.space.sections.map(s => ({ section: s, posts: sorted.filter(p => p.sectionId === s.id) }));
};
const fieldText = (f, v) => {
  if (v == null) return '';
  if (f.type === 'select') return f.options?.find(o => o.id === v)?.label || '';
  if (f.type === 'multiselect') return (v || []).map(id => f.options?.find(o => o.id === id)?.label).filter(Boolean).join(', ');
  if (f.type === 'date') return localDate(v + 'T12:00:00', { day: 'numeric', month: 'short', year: 'numeric' });
  if (f.type === 'score') return `${String(v).replace('.', ',')}/${f.max || 20}`;
  if (f.type === 'rating') return '★'.repeat(v) + '☆'.repeat(5 - v);
  return String(v);
};
E.fieldText = fieldText;

// ======================= Carte d’une publication =======================
E.attachmentsHTML = function (post, { full = false } = {}) {
  const atts = post.attachments || [];
  if (!atts.length) return '';
  const imgs = atts.filter(a => ['image', 'drawing', 'svg'].includes(a.kind));
  const others = atts.filter(a => !['image', 'drawing', 'svg'].includes(a.kind));
  let html = '';
  if (imgs.length === 1 || (full && imgs.length)) {
    html += imgs.map(a => `<button class="pm-img" data-e="lightbox" data-att="${attr(a.id)}" ${a.w && a.h ? `style="aspect-ratio:${a.w}/${a.h}"` : ''}><img src="${attr(E.mediaUrl(a.file))}" alt="${attr(a.name || '')}" loading="lazy" ${a.w ? `width="${a.w}" height="${a.h}"` : ''}></button>`).join('');
  } else if (imgs.length > 1) {
    const shown = imgs.slice(0, 4);
    html += `<div class="pm-gallery n${shown.length}">${shown.map((a, i) => `<button data-e="lightbox" data-att="${attr(a.id)}"><img src="${attr(E.mediaUrl(a.file))}" alt="" loading="lazy">${i === 3 && imgs.length > 4 ? `<span>+${imgs.length - 4}</span>` : ''}</button>`).join('')}</div>`;
  }
  for (const a of others) {
    if (a.kind === 'video') html += `<video class="pm-video" src="${attr(E.mediaUrl(a.file))}" controls playsinline preload="metadata"></video>`;
    else if (a.kind === 'audio') html += `<div class="pm-audio">${I.mic}<audio src="${attr(E.mediaUrl(a.file))}" controls preload="none"></audio></div>`;
    else if (a.kind === 'embed' && a.embed && full) html += `<div class="pm-embed"><iframe src="${attr(a.embed)}" title="${attr(a.preview?.title || 'Vidéo')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`;
    else if (a.kind === 'link' || a.kind === 'embed') {
      const p = a.preview || {};
      html += `<a class="pm-link ${a.embed ? 'video' : ''}" href="${attr(a.url)}" target="_blank" rel="noopener noreferrer" data-e="${a.embed ? 'play' : 'url'}" data-att="${attr(a.id)}">${p.image ? `<span class="pl-img" style="background-image:url('${attr(E.mediaUrl(p.image))}')">${a.embed ? `<i>${I.play}</i>` : ''}</span>` : ''}<span class="pl-text"><b>${esc(p.title || a.url)}</b>${p.description && full ? `<span>${esc(p.description)}</span>` : ''}<small>${I.link}${esc(p.site || (() => { try { return new URL(a.url).hostname; } catch { return ''; } })())}</small></span></a>`;
    } else if (a.kind === 'local') { const nm = a.name || a.path?.split('/').pop() || ''; html += `<button class="pm-file pm-filecard ft-${E.fileType(nm).fam}" data-thumb-box data-e="local" data-att="${attr(a.id)}" title="${attr(nm)}"><span class="thumb-frame"><img data-thumb src="${attr(E.thumbUrl(a.id))}" alt="" loading="lazy" draggable="false"></span><span class="pm-file-line">${E.fileBadge(nm)}<span class="pm-file-name"><b>${esc(nm)}</b><small>Support de cours</small></span></span></button>`; }
    else { const nm = a.name || a.file || ''; html += `<button class="pm-file pm-filecard ft-${E.fileType(nm).fam}" data-thumb-box data-e="file" data-att="${attr(a.id)}" title="${attr(nm)}"><span class="thumb-frame"><img data-thumb src="${attr(E.thumbUrl(a.id))}" alt="" loading="lazy" draggable="false"></span><span class="pm-file-line">${E.fileBadge(nm)}<span class="pm-file-name"><b>${esc(nm)}</b><small>${esc(sizeLabel(a.size) || 'Fichier')}</small></span>${I.download}</span></button>`; }
  }
  return `<div class="pm ${full ? 'full' : ''}">${html}</div>`;
};
E.pollHTML = function (post, { cardId, objectId } = {}) {
  const p = post.poll;
  if (!p) return '';
  const total = Math.max(1, Object.values(p.counts || {}).reduce((a, b) => a + b, 0));
  const voted = (p.mine || []).length > 0;
  const canVote = (E.can('react') || E.can('post')) && !p.closed;
  return `<div class="poll" ${cardId ? `data-card="${attr(cardId)}" data-obj="${attr(objectId)}"` : `data-post="${attr(post.id)}"`}>
    ${p.question ? `<b class="poll-q">${esc(p.question)}</b>` : ''}
    ${p.options.map(o => { const n = p.counts?.[o.id] || 0; const mine = (p.mine || []).includes(o.id); const pc = Math.round(n / total * 100); return `<button class="poll-opt ${mine ? 'mine' : ''}" ${canVote ? `data-e="vote" data-opt="${attr(o.id)}"` : 'disabled'}><span class="po-bar" style="width:${voted || p.closed ? pc : 0}%"></span><span class="po-label">${p.multiple ? `<i class="po-box">${mine ? I.check : ''}</i>` : `<i class="po-dot"></i>`}${esc(o.text)}</span>${voted || p.closed ? `<span class="po-n">${pc} %</span>` : ''}</button>`; }).join('')}
    <small class="poll-meta">${plural(p.voters || 0, 'vote')}${p.multiple ? ' · plusieurs réponses possibles' : ''}${p.closed ? ' · sondage clos' : ''}</small>
  </div>`;
};
E.fieldsHTML = function (post, { full = false } = {}) {
  const out = [];
  for (const f of E.space.fields) {
    const v = post.fields?.[f.id];
    if (f.type === 'vote') { const n = post.reactions?.fieldVotes?.[f.id] || 0; const mine = (post.reactions?.mine?.fieldVotes || []).includes(f.id); out.push(`<button class="pf-vote ${mine ? 'on' : ''}" data-e="fieldvote" data-field="${attr(f.id)}" ${E.can('react') ? '' : 'disabled'} title="${attr(f.name)}">${I.up}${esc(f.name)} <b>${n}</b></button>`); continue; }
    if (v == null || v === '') continue;
    if (f.type === 'button' || f.type === 'url') { out.push(`<a class="pf-btn ${f.type}" href="${attr(v)}" target="_blank" rel="noopener noreferrer" data-e="url">${f.type === 'button' ? esc(f.label || f.name) : `${I.link}${esc(full ? v : (() => { try { return new URL(v).hostname; } catch { return v; } })())}`}</a>`); continue; }
    if (f.type === 'select') { const o = f.options?.find(x => x.id === v); if (o) out.push(`<span class="pf-chip" style="${o.color ? `--fc:${o.color}` : ''}" title="${attr(f.name)}">${esc(o.label)}</span>`); continue; }
    if (f.type === 'multiselect') { for (const id of v) { const o = f.options?.find(x => x.id === id); if (o) out.push(`<span class="pf-chip" style="${o.color ? `--fc:${o.color}` : ''}" title="${attr(f.name)}">${esc(o.label)}</span>`); } continue; }
    if (f.type === 'rating') { out.push(`<span class="pf-rating" title="${attr(f.name)}">${'★'.repeat(v)}<i>${'★'.repeat(5 - v)}</i></span>`); continue; }
    if (f.type === 'email') { out.push(`<a class="pf-kv" href="mailto:${attr(v)}" data-e="url"><i>${esc(f.name)}</i>${esc(v)}</a>`); continue; }
    out.push(`<span class="pf-kv"><i>${esc(f.name)}</i>${esc(fieldText(f, v))}</span>`);
  }
  return out.length ? `<div class="pf">${out.join('')}</div>` : '';
};
E.reactionsHTML = function (post, { full = false } = {}) {
  const type = E.space.settings.reactions;
  const r = post.reactions || {};
  const mine = r.mine || {};
  const can = E.can('react');
  const dis = can ? '' : 'disabled';
  if (type === 'like') return `<button class="rx like ${mine.like ? 'on' : ''}" data-e="react" data-type="like" ${dis} title="J’aime">${mine.like ? I.heartFill : I.heart}${r.like ? `<span>${r.like}</span>` : ''}</button>`;
  if (type === 'vote') return `<span class="rx-vote"><button class="rx ${mine.vote === 1 ? 'on' : ''}" data-e="react" data-type="vote" data-value="1" ${dis} title="Pour">${I.up}<span>${r.up || 0}</span></button><button class="rx ${mine.vote === -1 ? 'on down' : ''}" data-e="react" data-type="vote" data-value="-1" ${dis} title="Contre">${I.down}${full || r.down ? `<span>${r.down || 0}</span>` : ''}</button></span>`;
  if (type === 'stars') {
    const v = mine.stars || 0;
    return `<span class="rx-stars" title="${r.stars ? `Moyenne ${String(r.stars).replace('.', ',')} sur ${plural(r.starsCount, 'note')}` : 'Pas encore de note'}">${[1, 2, 3, 4, 5].map(n => `<button class="${n <= v ? 'on' : n <= Math.round(r.stars || 0) ? 'avg' : ''}" data-e="react" data-type="stars" data-value="${n}" ${dis}>${n <= v ? I.starFill : I.star}</button>`).join('')}${r.starsCount ? `<span>${String(r.stars).replace('.', ',')}</span>` : ''}</span>`;
  }
  if (type === 'grade') return `<button class="rx grade ${mine.grade != null ? 'on' : ''}" data-e="grade" ${dis} title="Noter sur 20">${I.hash}${r.grade != null ? `<span>${String(r.grade).replace('.', ',')}/20${full ? ` · ${plural(r.gradeCount, 'note')}` : ''}</span>` : '<span>Noter</span>'}</button>`;
  if (type === 'emoji') {
    const list = Object.entries(r.emoji || {}).sort((a, b) => b[1] - a[1]);
    return `<span class="rx-emoji">${list.slice(0, full ? 30 : 3).map(([e, n]) => `<button class="${(mine.emoji || []).includes(e) ? 'on' : ''}" data-e="react" data-type="emoji" data-value="${attr(e)}" ${dis}>${e}<span>${n}</span></button>`).join('')}${can ? `<button class="add" data-e="emoji" title="Réagir">${I.smile}</button>` : ''}</span>`;
  }
  return '';
};
E.postHTML = function (post, { extraClass = '', style = '' } = {}) {
  const s = E.space.settings;
  const scheduled = post.publishAt && Date.parse(post.publishAt) > Date.now();
  const dark = post.color && E.isDark(post.color);
  const comments = (post.comments || []).length;
  const canMenu = post.mine || E.can('moderate') || E.can('edit') || E.can('post');
  const rx = E.reactionsHTML(post);
  return `<article class="post ${post.color ? 'colored' : ''} ${dark ? 'dark' : ''} ${post.status !== 'published' ? 'st-' + post.status : ''} ${scheduled ? 'scheduled' : ''} ${extraClass}" data-post="${attr(post.id)}" tabindex="0" style="${post.color ? `--pc:${post.color};` : ''}${style}">
    ${post.status === 'pending' ? `<div class="post-flag">${I.shield}En attente de validation${post.flag?.reason ? ` · ${esc(post.flag.reason)}` : ''}${E.can('moderate') ? `<span class="grow"></span><button class="btn sm" data-e="approve">${I.check}Valider</button><button class="btn sm ghost" data-e="reject">Refuser</button>` : ''}</div>` : ''}
    ${post.status === 'rejected' ? `<div class="post-flag rejected">${I.close}Refusée</div>` : ''}
    ${scheduled ? `<div class="post-flag sched">${I.clock}Programmée pour ${esc(localDate(post.publishAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</div>` : ''}
    ${E.attachmentsHTML(post)}
    ${(main => main.trim() ? `<div class="post-main">${main}</div>` : '')([
      post.title ? `<h3>${esc(post.title)}</h3>` : '',
      post.body ? `<div class="post-text md">${MD.post(post.body)}</div>` : '',
      E.pollHTML(post),
      post.location ? `<div class="post-loc">${I.pin}${esc(post.location.label || `${post.location.lat.toFixed(3)}, ${post.location.lng.toFixed(3)}`)}</div>` : '',
      post.eventDate && (E.layout() !== 'timeline') ? `<div class="post-loc">${I.calendar}${esc(localDate(post.eventDate + 'T12:00:00', { day: 'numeric', month: 'long', year: 'numeric' }))}</div>` : '',
      E.fieldsHTML(post),
    ].join(''))}
    ${(s.showAuthor || s.showDate || rx || s.comments) ? `<footer class="post-foot">
      ${s.showAuthor && post.author ? `${avatar(post.author.name, post.author.id, 20)}<span class="pa">${esc(post.author.name)}</span>` : ''}
      ${s.showDate ? `<span class="pd" title="${attr(localDate(post.createdAt, { dateStyle: 'full', timeStyle: 'short' }))}">${esc(ago(post.createdAt))}</span>` : ''}
      <span class="grow"></span>
      ${rx}
      ${s.comments ? `<button class="rx" data-e="open" title="Commentaires">${I.comment}${comments ? `<span>${comments}</span>` : ''}</button>` : ''}
    </footer>` : ''}
    ${canMenu ? `<button class="post-menu btn icon sm" data-e="postmenu" title="Actions">${I.more}</button>` : ''}
  </article>`;
};

// ======================= Dispositions =======================
E.renderBoard = function () {
  const el = E.mounted?.el.querySelector('.esp-body');
  if (!el) return;
  E.resizeObs?.disconnect(); E.resizeObs = null;
  if (E.map && E.layout() !== 'map') { E.map.destroy(); E.map = null; }
  const list = E.visiblePosts();
  const lay = E.layout();
  const empty = !E.space.posts.length;
  let html = '';
  if (lay === 'columns') html = E.layColumns(list);
  else if (lay === 'table') html = E.layTable(list);
  else if (lay === 'timeline') html = E.layTimeline(list);
  else if (lay === 'map') html = '<div class="lay-map"><div class="map-host"></div><aside class="map-side"></aside></div>';
  else if (lay === 'free') html = E.layFree(list);
  else html = E.layFlow(list, lay);
  el.innerHTML = html + (empty && lay !== 'columns' && lay !== 'map' ? E.emptyHTML() : '') + (list.length === 0 && !empty && E.ui.search ? `<div class="esp-noresult">${I.search}Aucune publication ne correspond à « ${esc(E.ui.search)} ».</div>` : '');
  if (lay === 'wall') E.masonryAll();
  if (lay === 'map') E.mountMap?.(el.querySelector('.lay-map'), list);
  if (lay === 'free') E.freeInit?.(el.querySelector('.lay-free'));
  if (lay === 'timeline') E.timelineInit(el);
};
E.emptyHTML = function () {
  return `<div class="esp-empty">${E.can('post') ? `<div class="ee-icon">${I.plus}</div><b>Cet espace est vide</b><span>Cliquez sur <b>+</b>, ou glissez des fichiers ici depuis le Finder.<br>Vous pouvez aussi coller une image ou un lien (⌘V).</span><button class="btn primary" data-e="compose">${I.plus}Ajouter une publication</button>` : '<b>Aucune publication pour l’instant</b><span>Les publications apparaîtront ici en direct.</span>'}</div>`;
};
E.sectionHead = function (section, count) {
  const edit = E.can('edit');
  return `<div class="sec-head" data-section="${attr(section.id)}"><h2 ${edit ? 'data-e="sec-rename" title="Renommer"' : ''}>${esc(section.title)}</h2><span class="n">${count}</span>${edit ? `<button class="btn icon ghost sm" data-e="secmenu" title="Section">${I.more}</button>` : ''}${E.can('post') ? `<button class="btn icon ghost sm" data-e="compose" data-section="${attr(section.id)}" title="Ajouter dans cette section">${I.plus}</button>` : ''}</div>`;
};
E.layFlow = function (list, lay) {
  const groups = E.grouped(list);
  const cls = lay === 'grid' ? 'lay-grid' : lay === 'stream' ? 'lay-stream' : 'lay-wall';
  const listCls = lay === 'grid' ? 'grid-list' : lay === 'stream' ? 'stream-list' : 'masonry';
  return `<div class="${cls}">${groups.map(g => `${g.section ? `<section class="sec">${E.sectionHead(g.section, g.posts.length)}` : '<section class="sec nohead">'}<div class="${listCls}" data-list="${attr(g.section?.id || '')}">${g.posts.map(p => E.postHTML(p)).join('')}${!g.posts.length && g.section ? `<div class="sec-empty">${E.can('post') ? 'Glissez une publication ici ou cliquez sur +' : 'Vide'}</div>` : ''}</div></section>`).join('')}${E.can('edit') && E.space.settings.sections ? `<button class="sec-add" data-e="addsection">${I.plus}Ajouter une section</button>` : ''}</div>`;
};
E.layColumns = function (list) {
  const groups = E.grouped(list);
  return `<div class="lay-columns">${groups.map(g => `<section class="col" data-section="${attr(g.section.id)}" style="${g.section.color ? `--sc:${g.section.color}` : ''}">${E.sectionHead(g.section, g.posts.length)}<div class="col-list" data-list="${attr(g.section.id)}">${g.posts.map(p => E.postHTML(p)).join('')}</div>${E.can('post') ? `<button class="col-add" data-e="compose" data-section="${attr(g.section.id)}">${I.plus}Ajouter</button>` : ''}</section>`).join('')}${E.can('edit') ? `<button class="col-new" data-e="addsection">${I.plus}Nouvelle colonne</button>` : ''}</div>`;
};
E.layTable = function (list) {
  const fields = E.space.fields;
  const ts = E.ui.tableSort;
  let rows = E.sortList(list);
  if (ts) {
    const val = p => ts.key === 'title' ? (p.title || MD.plain(p.body)) : ts.key === 'author' ? p.author?.name || '' : ts.key === 'date' ? p.createdAt : ts.key === 'section' ? (E.section(p.sectionId)?.title || '') : ts.key === 'reactions' ? E.reactionScore(p) : ts.key === 'comments' ? (p.comments || []).length : (() => { const f = E.field(ts.key); const v = p.fields?.[ts.key]; return f && typeof v !== 'number' ? fieldText(f, v) : v ?? ''; })();
    rows = [...rows].sort((a, b) => { const va = val(a), vb = val(b); return ts.dir * (typeof va === 'number' && typeof vb === 'number' ? va - vb : collatorFR.compare(String(va), String(vb))); });
  }
  const th = (key, label, cls = '') => `<th class="${cls}" data-e="tsort" data-key="${attr(key)}">${esc(label)}${ts?.key === key ? (ts.dir > 0 ? I.chevU : I.chevD) : ''}</th>`;
  const showSec = E.space.sections.length > 1;
  return `<div class="lay-table"><div class="tbl-wrap"><table class="tbl">
    <thead><tr>${th('title', 'Titre', 'c-title')}${showSec ? th('section', 'Section') : ''}${fields.map(f => th(f.id, f.name)).join('')}${E.space.settings.showAuthor ? th('author', 'Auteur') : ''}${th('date', 'Créée')}${E.space.settings.reactions !== 'none' ? th('reactions', 'Réactions') : ''}${th('comments', '💬')}</tr></thead>
    <tbody>${rows.map(p => `<tr data-post="${attr(p.id)}" class="${p.status !== 'published' ? 'st-' + p.status : ''}">
      <td class="c-title"><div class="tt">${(p.attachments || []).find(a => a.kind === 'image') ? `<img src="${attr(E.mediaUrl(p.attachments.find(a => a.kind === 'image').file))}" alt="">` : ''}<div><b ${p.mine || E.can('moderate') ? 'data-e="cell" data-key="title"' : ''}>${esc(p.title || MD.plain(p.body).slice(0, 80) || 'Sans titre')}</b>${p.title && p.body ? `<span>${esc(MD.plain(p.body).slice(0, 110))}</span>` : ''}</div></div></td>
      ${showSec ? `<td>${esc(E.section(p.sectionId)?.title || '')}</td>` : ''}
      ${fields.map(f => `<td ${f.type !== 'vote' && (p.mine || E.can('moderate')) ? `data-e="cell" data-key="${attr(f.id)}"` : ''} class="f-${f.type}">${f.type === 'vote' ? `<button class="pf-vote ${(p.reactions?.mine?.fieldVotes || []).includes(f.id) ? 'on' : ''}" data-e="fieldvote" data-field="${attr(f.id)}">${I.up}<b>${p.reactions?.fieldVotes?.[f.id] || 0}</b></button>` : f.type === 'url' || f.type === 'button' ? (p.fields?.[f.id] ? `<a href="${attr(p.fields[f.id])}" target="_blank" rel="noopener" data-e="url">${I.link}Lien</a>` : '') : f.type === 'select' || f.type === 'multiselect' ? (E.fieldsHTML({ ...p, fields: { [f.id]: p.fields?.[f.id] } }, {}).replace(/<\/?div[^>]*>/g, '')) : esc(fieldText(f, p.fields?.[f.id]))}</td>`).join('')}
      ${E.space.settings.showAuthor ? `<td class="c-author">${avatar(p.author?.name, p.author?.id, 18)}${esc(p.author?.name || '')}</td>` : ''}
      <td class="c-date">${esc(localDate(p.createdAt, { day: 'numeric', month: 'short' }))}</td>
      ${E.space.settings.reactions !== 'none' ? `<td class="c-rx">${E.reactionsHTML(p)}</td>` : ''}
      <td class="c-com">${(p.comments || []).length || ''}</td>
    </tr>`).join('')}</tbody></table></div>
    ${E.can('post') ? `<button class="tbl-add" data-e="compose">${I.plus}Nouvelle ligne</button>` : ''}</div>`;
};
E.layTimeline = function (list) {
  const sorted = E.sortList(list, E.space.settings.sort === 'manual' ? 'manual' : E.space.settings.sort);
  const n = sorted.length + (E.can('post') ? 1 : 0);
  return `<div class="lay-timeline"><div class="tl-track" data-list="" style="grid-template-columns:repeat(${Math.max(1, n)}, var(--tw, 270px))">
    <div class="tl-line" style="grid-column:1 / span ${Math.max(1, n)}"></div>
    ${sorted.map((p, i) => `<div class="tl-card ${i % 2 ? 'down' : 'up'}" style="grid-column:${i + 1}">${E.postHTML(p)}</div><div class="tl-mid" style="grid-column:${i + 1}"><span class="tl-dot"></span><span class="tl-when">${p.eventDate ? esc(localDate(p.eventDate + 'T12:00:00', { day: 'numeric', month: 'short', year: 'numeric' })) : `${i + 1}`}</span></div>`).join('')}
    ${E.can('post') ? `<div class="tl-mid" style="grid-column:${n}"><button class="tl-add" data-e="compose" title="Ajouter une étape">${I.plus}</button></div>` : ''}
  </div></div>`;
};
E.timelineInit = function (el) {
  const host = el.querySelector('.lay-timeline');
  if (!host) return;
  host.addEventListener('wheel', ev => { if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && !ev.target.closest('.post-text')) { host.scrollLeft += ev.deltaY; ev.preventDefault(); } }, { passive: false });
};

// ---------- Mur (maçonnerie) ----------
E.masonry = function (list) {
  const cards = [...list.children].filter(c => c.classList.contains('post'));
  if (!cards.length) { list.style.height = ''; return; }
  const width = list.clientWidth;
  const size = { s: 230, m: 290, l: 380 }[E.space?.theme?.size || 'm'] * (E.viewZ ? E.viewZ() : 1);
  const gap = 16;
  const cols = Math.max(1, Math.floor((width + gap) / (size + gap)));
  const colW = (width - gap * (cols - 1)) / cols;
  const heights = new Array(cols).fill(0);
  for (const c of cards) c.style.width = `${colW}px`;
  for (const c of cards) {
    const i = heights.indexOf(Math.min(...heights));
    c.style.transform = `translate(${i * (colW + gap)}px, ${heights[i]}px)`;
    heights[i] += c.offsetHeight + gap;
  }
  list.style.height = `${Math.max(...heights) - gap}px`;
  list.classList.add('laid');
};
E.masonryAll = function () {
  const lists = E.mounted?.el.querySelectorAll('.masonry') || [];
  const run = () => lists.forEach(l => E.masonry(l));
  run();
  let frame = 0;
  E.resizeObs = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(run); });
  lists.forEach(l => { E.resizeObs.observe(l); [...l.children].forEach(c => E.resizeObs.observe(c)); });
  for (const img of E.mounted?.el.querySelectorAll('.masonry img') || []) if (!img.complete) img.addEventListener('load', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(run); }, { once: true });
};

// ======================= Mises à jour en direct =======================
E.refreshPost = function (post, before) {
  if (!E.isBoard() || !E.mounted) return;
  const el = E.mounted.el;
  const moved = !before || before.sectionId !== post.sectionId || before.order !== post.order || before.eventDate !== post.eventDate || before.status !== post.status || (before.pos?.x !== post.pos?.x || before.pos?.y !== post.pos?.y) || before.title !== post.title;
  const lay = E.layout();
  const visible = E.visiblePosts().some(p => p.id === post.id);
  const node = el.querySelector(`.esp-body [data-post="${CSS.escape(post.id)}"]`);
  const sortSensitive = E.space.settings.sort !== 'manual' && E.space.settings.sort !== 'newest' && E.space.settings.sort !== 'oldest';
  if (node && visible && !moved && !sortSensitive && lay !== 'map' && lay !== 'table') {
    const tmp = document.createElement('div');
    tmp.innerHTML = E.postHTML(post);
    const fresh = tmp.firstElementChild;
    if (lay === 'free') { fresh.style.cssText = node.style.cssText; }
    if (lay === 'wall') { fresh.style.width = node.style.width; fresh.style.transform = node.style.transform; }
    node.replaceWith(fresh);
    if (lay === 'wall') { E.resizeObs?.observe(fresh); const list = fresh.closest('.masonry'); if (list) E.masonry(list); }
    if (lay === 'free') E.freeLinks?.();
  } else {
    E.renderBoard();
    if (!before) { const n = el.querySelector(`.esp-body [data-post="${CSS.escape(post.id)}"]`); n?.classList.add('post-new'); }
  }
  E.refreshOpenPost?.(post);
  const head = el.querySelector('.esp-head');
  if (head && E.can('moderate')) { const fresh = document.createElement('div'); fresh.innerHTML = E.headHTML(); head.replaceWith(fresh.firstElementChild); }
};
E.on('post', ({ post, before }) => E.refreshPost(post, before));
E.on('removed', ({ id }) => { if (!E.isBoard()) return; E.renderBoard(); E.closeOpenPost?.(id); });
E.on('meta', () => { if (E.mounted && E.space) { E.renderSpace(); E.refreshOpenPost?.(); } });
E.on('space', () => { if (E.mounted && E.space) E.renderSpace(); });
E.on('revoked', () => { if (!E.mounted) return; E.mounted.el.className = 'esp esp-error'; E.mounted.el.innerHTML = `<div class="esp-msg">${I.alert}<h2>Accès retiré</h2><p>Cet espace n’est plus partagé avec vous.</p></div>`; });

// ======================= Glisser-déposer des publications =======================
E.canMove = post => (E.can('edit') || E.can('moderate') || (post?.mine && E.can('post')));
E.dragPost = function (ev, card) {
  const post = E.space.posts.find(p => p.id === card.dataset.post);
  if (!post || !E.canMove(post)) return;
  const lay = E.layout();
  if (lay === 'table' || lay === 'map') return;
  if (lay === 'free') return E.dragFree?.(ev, card, post);
  const manual = E.space.settings.sort === 'manual';
  if (!manual && lay !== 'columns') return;
  const marker = document.createElement('div');
  marker.className = 'drop-marker';
  let target = null;
  startDrag(ev, {
    ghost: () => card,
    onStart: () => { card.classList.add('drag-src'); document.body.appendChild(marker); },
    onMove: (x, y) => {
      marker.style.display = 'none';
      const under = document.elementFromPoint(x, y);
      const list = under?.closest('[data-list]') || under?.closest('.col, .sec')?.querySelector('[data-list]');
      target = null;
      if (!list || !E.mounted.el.contains(list)) return;
      const cards = [...list.querySelectorAll(':scope > .post, :scope > .tl-card > .post')].filter(c => c !== card);
      const horizontal = lay === 'wall' || lay === 'grid' || lay === 'timeline';
      let best = null, bestD = Infinity;
      for (const c of cards) { const r = c.getBoundingClientRect(); const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)); if (d < bestD) { bestD = d; best = c; } }
      let before = true;
      if (best) { const r = best.getBoundingClientRect(); before = horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2; }
      target = { section: list.dataset.list || null, ref: best?.dataset.post || null, before };
      if (!manual) { list.classList.add('drop-on'); setTimeout(() => list.classList.remove('drop-on'), 120); return; }
      const lr = list.getBoundingClientRect();
      if (best) {
        const r = best.getBoundingClientRect();
        if (horizontal) Object.assign(marker.style, { display: 'block', left: `${(before ? r.left : r.right) - 2}px`, top: `${r.top}px`, width: '4px', height: `${r.height}px` });
        else Object.assign(marker.style, { display: 'block', left: `${r.left}px`, top: `${(before ? r.top : r.bottom) - 2}px`, width: `${r.width}px`, height: '4px' });
      } else Object.assign(marker.style, { display: 'block', left: `${lr.left + 8}px`, top: `${lr.top + 8}px`, width: `${lr.width - 16}px`, height: '4px' });
    },
    onDrop: () => { marker.remove(); card.classList.remove('drag-src'); if (target) E.applyMove(post, target); },
    onCancel: () => { marker.remove(); card.classList.remove('drag-src'); },
  });
};
E.applyMove = async function (post, target) {
  const sectionId = E.space.settings.sections || E.layout() === 'columns' ? (target.section || post.sectionId) : post.sectionId;
  const siblings = E.sortList(E.space.posts.filter(p => p.sectionId === sectionId && p.id !== post.id), 'manual');
  let order;
  if (E.space.settings.sort !== 'manual' || !target.ref) order = siblings.length ? siblings[siblings.length - 1].order + 1 : 0;
  else {
    const i = siblings.findIndex(p => p.id === target.ref);
    const at = i < 0 ? siblings.length : target.before ? i : i + 1;
    const prev = siblings[at - 1], next = siblings[at];
    order = prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : 0;
  }
  if (sectionId === post.sectionId && order === post.order) return;
  const before = { ...post };
  Object.assign(post, { sectionId, order });
  E.refreshPost(post, before);
  try { await E.api('POST', `/spaces/${E.space.id}/posts/move`, { moves: [{ id: post.id, sectionId, order }] }); }
  catch (err) { Object.assign(post, { sectionId: before.sectionId, order: before.order }); E.renderBoard(); toast(err.message, 'error'); }
};

// ======================= Actions de l’en-tête et des cartes =======================
E.findPost = el => { const node = el.closest('[data-post]'); return node ? E.space?.posts.find(p => p.id === node.dataset.post) : null; };
E.react = async function (post, type, value, field) {
  try { const { post: fresh } = await E.api('POST', `/spaces/${E.space.id}/posts/${post.id}/react`, { type, value, field }); E.upsertPost(fresh); }
  catch (err) { toast(err.message, 'error'); }
};
E.vote = async function (post, optionId) {
  const p = post.poll;
  let options = p.multiple ? ((p.mine || []).includes(optionId) ? p.mine.filter(x => x !== optionId) : [...(p.mine || []), optionId]) : ((p.mine || [])[0] === optionId ? [] : [optionId]);
  try { const { post: fresh } = await E.api('POST', `/spaces/${E.space.id}/posts/${post.id}/vote`, { options }); E.upsertPost(fresh); }
  catch (err) { toast(err.message, 'error'); }
};
E.postMenu = function (anchor, post) {
  const items = [{ label: 'Ouvrir', icon: 'expand', act: () => E.openPost(post.id) }];
  if (post.mine || E.can('moderate')) items.push({ label: 'Modifier', icon: 'edit', hint: 'E', act: () => E.compose({ post }) });
  if (E.can('post')) items.push({ label: 'Dupliquer', icon: 'copy', act: async () => { const { post: copy } = await E.api('POST', `/spaces/${E.space.id}/posts/${post.id}/duplicate`); E.upsertPost(copy); } });
  if (E.canMove(post) && E.space.sections.length > 1) {
    items.push({ sep: true }, { header: 'Déplacer vers' });
    for (const s of E.space.sections) items.push({ label: s.title, icon: 'chevR', checked: post.sectionId === s.id, act: () => E.applyMove(post, { section: s.id, ref: null, before: false }) });
  }
  if (post.mine || E.can('moderate')) {
    items.push({ sep: true }, { header: 'Couleur' });
    items.push({ label: 'Choisir une couleur…', icon: 'palette', act: () => E.colorMenu(anchor, post) });
  }
  if (E.can('moderate') && post.status !== 'published') items.push({ sep: true }, { label: 'Valider', icon: 'check', act: () => E.moderate(post, 'approve') }, { label: 'Refuser', icon: 'close', act: () => E.moderate(post, 'reject') });
  if (E.mode === 'app' && E.space.sharing?.visibility !== 'private') items.push({ sep: true }, { label: 'Copier le lien de la publication', icon: 'link', act: () => E.copyPostLink?.(post) });
  if (post.mine || E.can('moderate')) items.push({ sep: true }, { label: 'Supprimer', icon: 'trash', danger: true, act: () => E.deletePost(post) });
  UI.menu(anchor, items, { align: 'right' });
};
E.colorMenu = function (anchor, post) {
  UI.closeMenu();
  const el = document.createElement('div');
  el.className = 'ctx-menu color-pop';
  el.innerHTML = `<div class="swatches">${E.CARD_COLORS.map(c => `<button data-c="${c || ''}" class="${(post.color || null) === c ? 'on' : ''}" style="background:${c || 'var(--card)'}" title="${c ? c : 'Par défaut'}">${c ? '' : I.close}</button>`).join('')}</div>`;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = `${clamp(r.right - el.offsetWidth, 8, innerWidth - el.offsetWidth - 8)}px`; el.style.top = `${clamp(r.bottom + 4, 8, innerHeight - el.offsetHeight - 8)}px`;
  el.addEventListener('click', async e => { const b = e.target.closest('[data-c]'); if (!b) return; UI.closeMenu(); try { const { post: fresh } = await E.api('PATCH', `/spaces/${E.space.id}/posts/${post.id}`, { color: b.dataset.c || null }); E.upsertPost(fresh); } catch (err) { toast(err.message, 'error'); } });
  UI.menuEl = el;
  setTimeout(() => document.addEventListener('pointerdown', UI.menuAway, true), 0);
};
E.deletePost = async function (post) {
  if (!await UI.confirm(`Supprimer « ${post.title || MD.plain(post.body).slice(0, 40) || 'cette publication'} » ?`, { ok: 'Supprimer', danger: true })) return;
  try { await E.api('DELETE', `/spaces/${E.space.id}/posts/${post.id}`); E.removePost(post.id); toast('Publication supprimée'); }
  catch (err) { toast(err.message, 'error'); }
};
E.moderate = async function (post, decision) {
  try { const { post: fresh } = await E.api('POST', `/spaces/${E.space.id}/posts/${post.id}/moderate`, { decision }); E.space.pending = Math.max(0, (E.space.pending || 1) - 1); E.upsertPost(fresh); toast(decision === 'approve' ? 'Publication validée' : 'Publication refusée'); }
  catch (err) { toast(err.message, 'error'); }
};
E.patchMeta = async function (patch) {
  try { const { space } = await E.api('PATCH', `/spaces/${E.space.id}`, patch); Object.assign(E.space, space, { posts: E.space.posts, cards: E.space.cards, pending: E.space.pending }); E.renderSpace(); const sum = E.summary?.(E.space.id); if (sum) Object.assign(sum, { title: space.title, icon: space.icon, theme: space.theme, layout: space.settings.layout }); return space; }
  catch (err) { toast(err.message, 'error'); throw err; }
};
E.layoutMenu = function (anchor) {
  const edit = E.can('edit');
  UI.menu(anchor, [
    { header: edit ? 'Disposition de l’espace' : 'Afficher en' },
    ...E.LAYOUTS.map(l => ({ label: l.label, icon: l.icon, checked: E.layout() === l.id, act: () => { if (edit) { E.ui.layout = null; E.patchMeta({ settings: { layout: l.id, ...(l.id === 'columns' ? { sections: true } : {}), ...(l.id === 'timeline' && E.space.posts.some(p => p.eventDate) ? { sort: 'date' } : {}) } }); } else { E.ui.layout = l.id; E.renderSpace(); } } })),
  ]);
};
E.filterMenu = function (anchor) {
  const authors = [...new Map(E.space.posts.map(p => [p.author?.id, p.author])).values()].filter(Boolean).slice(0, 30);
  const items = [{ label: 'Tout afficher', icon: 'eye', checked: !E.ui.section && !E.ui.author && !E.ui.status, act: () => { E.ui.section = ''; E.ui.author = ''; E.ui.status = ''; E.renderSpace(); } }];
  if (E.space.sections.length > 1) { items.push({ sep: true }, { header: 'Section' }); for (const s of E.space.sections) items.push({ label: s.title, icon: 'columns', checked: E.ui.section === s.id, act: () => { E.ui.section = E.ui.section === s.id ? '' : s.id; E.renderSpace(); } }); }
  if (authors.length > 1 && E.space.settings.attribution !== 'anonymous') { items.push({ sep: true }, { header: 'Auteur' }); for (const a of authors) items.push({ label: a.name, icon: 'user', checked: E.ui.author === a.id, act: () => { E.ui.author = E.ui.author === a.id ? '' : a.id; E.renderSpace(); } }); }
  items.push({ sep: true }, { header: 'Statut' }, { label: 'Mes publications', icon: 'user', checked: E.ui.status === 'mine', act: () => { E.ui.status = E.ui.status === 'mine' ? '' : 'mine'; E.renderSpace(); } });
  if (E.can('moderate')) items.push({ label: 'En attente de validation', icon: 'shield', checked: E.ui.status === 'pending', act: () => { E.ui.status = E.ui.status === 'pending' ? '' : 'pending'; E.renderSpace(); } }, { label: 'Programmées', icon: 'clock', checked: E.ui.status === 'scheduled', act: () => { E.ui.status = E.ui.status === 'scheduled' ? '' : 'scheduled'; E.renderSpace(); } });
  UI.menu(anchor, items, { align: 'right' });
};
E.sectionMenu = function (anchor, sectionId) {
  const s = E.section(sectionId);
  if (!s) return;
  const i = E.space.sections.indexOf(s);
  const n = E.space.posts.filter(p => p.sectionId === sectionId).length;
  UI.menu(anchor, [
    { label: 'Renommer…', icon: 'edit', act: () => E.renameSection(sectionId) },
    { label: 'Déplacer avant', icon: 'chevL', disabled: i === 0, act: () => { const list = [...E.space.sections]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; E.patchMeta({ sections: list }); } },
    { label: 'Déplacer après', icon: 'chevR', disabled: i === E.space.sections.length - 1, act: () => { const list = [...E.space.sections]; [list[i + 1], list[i]] = [list[i], list[i + 1]]; E.patchMeta({ sections: list }); } },
    { label: 'Couleur…', icon: 'palette', act: () => { E.colorMenu(anchor, { color: s.color, id: '__section' }); const pop = UI.menuEl; pop.onclick = null; pop.addEventListener('click', ev => { const b = ev.target.closest('[data-c]'); if (b) { ev.stopImmediatePropagation(); UI.closeMenu(); E.patchMeta({ sections: E.space.sections.map(x => x.id === sectionId ? { ...x, color: b.dataset.c || null } : x) }); } }, true); } },
    { sep: true },
    { label: 'Supprimer la section', icon: 'trash', danger: true, disabled: E.space.sections.length <= 1, act: async () => { if (!await UI.confirm(n ? `Supprimer « ${s.title} » ? Ses ${plural(n, 'publication')} iront dans « ${E.space.sections.find(x => x.id !== sectionId).title} ».` : `Supprimer « ${s.title} » ?`, { ok: 'Supprimer', danger: true })) return; await E.patchMeta({ sections: E.space.sections.filter(x => x.id !== sectionId) }); E.reload(); } },
  ], { align: 'right' });
};
E.renameSection = async function (sectionId) {
  const s = E.section(sectionId);
  const t = await UI.prompt('Nom de la section', s.title, { ok: 'Renommer' });
  if (t && t.trim()) E.patchMeta({ sections: E.space.sections.map(x => x.id === sectionId ? { ...x, title: t.trim() } : x) });
};
E.addSection = async function () {
  const t = await UI.prompt('Nouvelle section', '', { placeholder: E.layout() === 'columns' ? 'Ex. À faire, Semaine 2…' : 'Ex. Recherche, Résultats…', ok: 'Ajouter' });
  if (!t || !t.trim()) return;
  await E.patchMeta({ sections: [...E.space.sections, { title: t.trim() }], ...(E.space.settings.sections ? {} : { settings: { sections: true } }) });
};
E.moreMenu = function (anchor) {
  const items = [];
  if (E.mode === 'app' && E.space) {
    E.spaceMenu(anchor, E.space.id, { inSpace: true });
    return;
  }
  if (E.can('edit') || E.can('moderate')) items.push({ label: 'Exporter en Excel', icon: 'table', act: () => E.download(E.space.id, 'xlsx') }, { label: 'Exporter en CSV', icon: 'fileText', act: () => E.download(E.space.id, 'csv') }, { label: 'Télécharger tous les fichiers', icon: 'download', act: () => E.download(E.space.id, 'zip') });
  items.push({ label: 'Imprimer / PDF', icon: 'file', act: () => E.printSpace?.() });
  UI.menu(anchor, items, { align: 'right' });
};
if (!E.download) E.download = function (id, ext) { const a = document.createElement('a'); a.href = `${E.base}/api/spaces/${encodeURIComponent(id)}/export.${ext}?${E.authQuery()}`; a.download = ''; document.body.appendChild(a); a.click(); a.remove(); };

// ======================= Délégation des événements =======================
document.addEventListener('click', async e => {
  const root = E.mounted?.el;
  if (!root || !root.contains(e.target) || !E.space) return;
  const b = e.target.closest('[data-e]');
  const post = E.findPost(e.target);
  if (b) {
    const a = b.dataset.e;
    if (a === 'url' || a === 'play') {
      if (a === 'play' && post) { e.preventDefault(); return E.openPost(post.id); }
      if (E.mode === 'app' && window.call) { e.preventDefault(); call('openURL', { url: b.href }).catch(err => toast(err.message, 'error')); }
      e.stopPropagation(); return;
    }
    e.preventDefault(); e.stopPropagation();
    switch (a) {
      case 'compose': return E.compose({ sectionId: b.dataset.section || null });
      case 'open': return post && E.openPost(post.id);
      case 'postmenu': return post && E.postMenu(b, post);
      case 'react': return post && E.react(post, b.dataset.type, b.dataset.value != null ? (b.dataset.type === 'emoji' ? b.dataset.value : +b.dataset.value) : undefined);
      case 'fieldvote': return post && E.react(post, 'fieldVote', undefined, b.dataset.field);
      case 'emoji': return post && emojiPicker(b, em => E.react(post, 'emoji', em));
      case 'grade': return post && E.gradeDialog?.(post);
      case 'vote': return post && E.vote(post, b.dataset.opt);
      case 'approve': return post && E.moderate(post, 'approve');
      case 'reject': return post && E.moderate(post, 'reject');
      case 'lightbox': return post && E.lightbox?.(post, b.dataset.att);
      case 'file': case 'local': return post && E.openAttachment?.(post, b.dataset.att);
      case 'ink': return E.Ink?.toggle();
      case 'assistant': return window.Assistant?.openFor?.(E.space);
      case 'layout': return E.layoutMenu(b);
      case 'filter': return E.filterMenu(b);
      case 'present': return E.present?.();
      case 'share': return E.shareDialog?.();
      case 'settings': return E.settingsPanel?.();
      case 'moderation': E.ui.status = E.ui.status === 'pending' ? '' : 'pending'; return E.renderSpace();
      case 'more': return E.moreMenu(b);
      case 'me': return E.changeName?.();
      case 'icon': return emojiPicker(b, icon => E.patchMeta({ icon }));
      case 'rename': { const t = await UI.prompt('Titre de l’espace', E.space.title, { ok: 'Renommer' }); if (t && t.trim()) E.patchMeta({ title: t.trim() }); return; }
      case 'describe': { const t = await UI.prompt('Description', E.space.description, { multiline: true, ok: 'Enregistrer', placeholder: 'À quoi sert cet espace ? Consignes pour les participants…' }); if (t !== null) E.patchMeta({ description: t.trim() }); return; }
      case 'secmenu': return E.sectionMenu(b, b.closest('[data-section]').dataset.section);
      case 'sec-rename': return E.renameSection(b.closest('[data-section]').dataset.section);
      case 'addsection': return E.addSection();
      case 'tsort': { const k = b.dataset.key; E.ui.tableSort = E.ui.tableSort?.key === k ? (E.ui.tableSort.dir > 0 ? { key: k, dir: -1 } : null) : { key: k, dir: 1 }; return E.renderBoard(); }
      case 'cell': return post && E.editCell?.(b, post, b.dataset.key);
      case 'presence': return;
      default: if (E.handleAction) return E.handleAction(a, b, e);
    }
    return;
  }
  if (post && !e.target.closest('a, button, audio, video, input, textarea, select, .poll, iframe')) E.openPost(post.id);
});
document.addEventListener('dblclick', e => {
  const root = E.mounted?.el;
  if (!root || !root.contains(e.target) || !E.isBoard()) return;
  const post = E.findPost(e.target);
  if (post && (post.mine || E.can('moderate')) && !e.target.closest('button, a, input, textarea, .poll')) { UI.closeTop(); E.compose({ post }); }
});
document.addEventListener('pointerdown', e => {
  const root = E.mounted?.el;
  if (!root || !E.isBoard() || e.button !== 0 || !root.contains(e.target)) return;
  const card = e.target.closest('.esp-body .post');
  if (!card || e.target.closest('button, a, audio, video, input, textarea, select, .poll, iframe, .post-text a')) return;
  E.dragPost(e, card);
});
document.addEventListener('input', e => {
  if (e.target.matches?.('[data-e-search]')) { E.ui.search = e.target.value; E.renderBoard(); }
});
document.addEventListener('keydown', e => {
  if (!E.mounted || !E.space || UI.stack.length || UI.menuEl) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (typing) return;
  if (E.isBoard() && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.key === 'n' && E.can('post')) { e.preventDefault(); E.compose({}); }
    else if (e.key === 'p') { e.preventDefault(); E.present?.(); }
    else if (e.key === '/') { e.preventDefault(); E.mounted.el.querySelector('[data-e-search]')?.focus(); }
    else if (e.key === 'e') { const post = E.findPost(document.activeElement || document.body); if (post && (post.mine || E.can('moderate'))) { e.preventDefault(); E.compose({ post }); } }
    else if (e.key === 'Enter') { const post = E.findPost(document.activeElement || document.body); if (post) { e.preventDefault(); E.openPost(post.id); } }
  }
});
// Coller une image ou un lien, ou déposer des fichiers dans le tableau : nouvelle publication.
document.addEventListener('paste', e => {
  if (!E.mounted || !E.isBoard() || !E.can('post') || UI.stack.length) return;
  if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  const files = E.filesFrom(e.clipboardData);
  const url = files.length ? '' : E.urlFrom(e.clipboardData);
  const text = !files.length && !url ? e.clipboardData.getData('text/plain') : '';
  if (!files.length && !url && !text.trim()) return;
  e.preventDefault();
  E.compose({ files, url, text });
});
document.addEventListener('dragover', e => {
  if (!E.mounted || !E.isBoard() || !E.can('post') || UI.stack.length) return;
  if (![...(e.dataTransfer?.types || [])].some(t => t === 'Files' || t === 'text/uri-list')) return;
  e.preventDefault();
  E.mounted.el.classList.add('drop-target');
  clearTimeout(E.dropTimer); E.dropTimer = setTimeout(() => E.mounted?.el.classList.remove('drop-target'), 150);
});
document.addEventListener('drop', e => {
  if (!E.mounted || !E.isBoard() || !E.can('post') || UI.stack.length) return;
  const files = E.filesFrom(e.dataTransfer);
  const url = files.length ? '' : E.urlFrom(e.dataTransfer);
  if (!files.length && !url) return;
  e.preventDefault();
  E.mounted.el.classList.remove('drop-target');
  const list = e.target.closest?.('[data-list]');
  E.compose({ files, url, sectionId: list?.dataset.list || null });
});

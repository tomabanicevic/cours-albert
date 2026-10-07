/* Cours Albert 3 — accueil des espaces : création, modèles, dossiers, favoris, archives, corbeille. */
'use strict';

E.dash = { filter: 'all', folder: '', query: '' };
// Nouveautés non lues par espace (publications et commentaires des participants), comme les canaux de Slack.
E.unread = (() => { try { return JSON.parse(localStorage.getItem('ca-unread') || '{}') || {}; } catch { return {}; } })();
E.saveUnread = () => { try { localStorage.setItem('ca-unread', JSON.stringify(E.unread)); } catch {} };
E.markRead = id => { if (E.unread[id]) { delete E.unread[id]; E.saveUnread(); if (typeof renderSidebar === 'function') renderSidebar(); } };

E.loadState = async function () {
  E.state = await E.api('GET', '/state');
  E.available = true;
  return E.state;
};
E.listenOwner = function () {
  if (E.ownerES || !E.token) return;
  const es = new EventSource(`${E.base}/api/events?${E.authQuery()}`);
  E.ownerES = es;
  es.addEventListener('summary', ev => {
    const { summary } = JSON.parse(ev.data);
    if (!E.state) return;
    const i = E.state.spaces.findIndex(s => s.id === summary.id);
    if (i >= 0) E.state.spaces[i] = summary; else E.state.spaces.unshift(summary);
    E.emit('summaries');
  });
  es.addEventListener('removed', ev => { const { id } = JSON.parse(ev.data); if (E.state) E.state.spaces = E.state.spaces.filter(s => s.id !== id); E.emit('summaries'); });
  es.addEventListener('activity', ev => {
    const a = JSON.parse(ev.data);
    E.emit('activity', a);
    if (E.space?.id === a.spaceId && document.hasFocus()) return;
    if (E.space?.id !== a.spaceId) { E.unread[a.spaceId] = (E.unread[a.spaceId] || 0) + 1; E.saveUnread(); if (typeof renderSidebar === 'function') renderSidebar(); if (S.route === 'accueil') E.refreshSummaries(); }
    const what = a.kind === 'comment' ? 'a commenté' : a.kind === 'pending' ? 'attend une validation' : 'a publié';
    toast(`${a.author} ${what} dans « ${a.space} »${a.text ? ` : ${a.text}` : ''}`);
    if (window.call && !document.hasFocus()) call('notify', { title: a.space, body: `${a.author} ${what}${a.text ? ` : ${a.text}` : ''}`, route: `e/${a.spaceId}` }).catch(() => {});
  });
};
E.summary = id => E.state?.spaces.find(s => s.id === id) || null;
E.refreshSummaries = debounce(() => { if (S.route === 'accueil' || S.route === 'modeles') renderMain(false); renderSidebar(); }, 150);
E.on('summaries', () => E.refreshSummaries());

// ======================= Création =======================
E.create = async function (payload) {
  const { summary, space } = await E.api('POST', '/spaces', payload);
  const i = E.state.spaces.findIndex(s => s.id === summary.id);
  if (i < 0) E.state.spaces.unshift(summary);
  go(`e/${space.id}`);
  return space;
};
E.createBlank = kind => E.create(kind === 'canvas'
  ? { kind: 'canvas', title: 'Espace libre sans titre', theme: { wallpaper: 'color:#eef1f6' } }
  : { kind: 'board', title: 'Tableau sans titre', settings: { layout: 'wall' } }).catch(err => toast(err.message, 'error'));
E.fromTemplate = async function (id) {
  const t = TEMPLATES.get(id);
  if (!t) return;
  await E.create({ kind: t.kind, ...JSON.parse(JSON.stringify(t.payload)), folder: E.dash.folder || null }).catch(err => toast(err.message, 'error'));
};
E.importFile = function () {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.coursalbert,.zip,application/zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    toast('Import en cours…');
    try {
      const { summary } = await E.api('POST', '/import', file);
      E.state.spaces.unshift(summary);
      toast(`« ${summary.title} » importé`);
      go(`e/${summary.id}`);
    } catch (err) { toast(err.message, 'error'); }
  };
  input.click();
};
E.join = async function () {
  const url = await UI.prompt('Rejoindre un espace partagé', '', { placeholder: 'http://192.168.1.20:47822/s/…?k=…', ok: 'Rejoindre', message: 'Collez le lien reçu (l’espace doit être partagé sur le même réseau Wi-Fi).' });
  if (!url) return;
  let u;
  try { u = new URL(url.trim()); if (!/^https?:$/.test(u.protocol) || !/^\/s\/[a-z0-9_-]+\/?$/i.test(u.pathname)) throw new Error(); }
  catch { toast('Ce lien n’est pas un lien de partage Cours Albert.', 'error'); return; }
  const joined = [{ url: u.href, title: 'Espace partagé', icon: '🔗', openedAt: new Date().toISOString() }, ...(E.state.prefs.joined || []).filter(j => j.url !== u.href)].slice(0, 50);
  await E.savePrefs({ joined });
  go(`j/${encodeURIComponent(u.href)}`);
};
E.savePrefs = async function (patch) {
  const r = await E.api('POST', '/prefs', patch);
  E.state.prefs = r.prefs;
  if (r.lan) E.state.lan = r.lan;
  return r;
};
E.templateGallery = function () {
  const mine = (E.state?.spaces || []).filter(s => s.isTemplate && !s.trashedAt);
  const tile = t => `<button class="tpl" data-tpl="${attr(t.id)}"><span class="tpl-ic">${esc(t.icon)}</span><b>${esc(t.title)}</b><span>${esc(t.desc)}</span></button>`;
  const box = UI.modal(`<div class="sheet-head"><h2>Choisir un modèle</h2><button class="btn icon ghost" data-close>${I.close}</button></div>
    <div class="tpl-body">
      <h3>${I.wall} Tableaux</h3><div class="tpl-grid">${TEMPLATES.boards.map(tile).join('')}</div>
      <h3>${I.canvas} Espaces libres</h3><div class="tpl-grid">${TEMPLATES.canvases.map(tile).join('')}</div>
      ${mine.length ? `<h3>${I.template} Mes modèles</h3><div class="tpl-grid">${mine.map(s => `<button class="tpl" data-mine="${attr(s.id)}"><span class="tpl-ic">${esc(s.icon)}</span><b>${esc(s.title)}</b><span>${esc(s.description || E.kindLabel(s.kind))}</span></button>`).join('')}</div>` : ''}
    </div>`, { cls: 'sheet wide', label: 'Modèles' });
  box.addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) return UI.close(box);
    const t = e.target.closest('[data-tpl]');
    if (t) { UI.close(box); return E.fromTemplate(t.dataset.tpl); }
    const m = e.target.closest('[data-mine]');
    if (m) {
      UI.close(box);
      try { const { summary } = await E.api('POST', `/spaces/${m.dataset.mine}/duplicate`, { title: E.summary(m.dataset.mine)?.title }); E.state.spaces.unshift(summary); await E.api('PATCH', `/spaces/${summary.id}`, { isTemplate: false }); go(`e/${summary.id}`); }
      catch (err) { toast(err.message, 'error'); }
    }
  });
};
E.newMenu = function (anchor) {
  UI.menu(anchor, [
    { label: 'Nouveau tableau', icon: 'wall', hint: '⌘N', act: () => E.createBlank('board') },
    { label: 'Nouvel espace libre', icon: 'canvas', hint: '⇧⌘N', act: () => E.createBlank('canvas') },
    { label: 'À partir d’un modèle…', icon: 'template', act: () => E.templateGallery() },
    { sep: true },
    { label: 'Importer une sauvegarde…', icon: 'upload', act: () => E.importFile() },
    { label: 'Rejoindre avec un lien…', icon: 'link', act: () => E.join() },
  ]);
};

// ======================= Actions sur un espace =======================
E.patchSpace = async function (id, patch) {
  const { space } = await E.api('PATCH', `/spaces/${id}`, patch);
  const sum = E.summary(id);
  if (sum) Object.assign(sum, { title: space.title, icon: space.icon, favorite: space.favorite, archived: space.archived, trashedAt: space.trashedAt, folder: space.folder, isTemplate: space.isTemplate, theme: space.theme });
  if (E.space?.id === id) Object.assign(E.space, space, { posts: E.space.posts, cards: E.space.cards });
  E.emit('summaries');
  return space;
};
E.spaceMenu = function (anchor, id, { inSpace = false } = {}) {
  const s = E.summary(id) || (E.space?.id === id ? E.space : null);
  if (!s) return;
  const folders = E.state?.prefs?.folders || [];
  const items = [];
  if (!inSpace) items.push({ label: 'Ouvrir', icon: 'external', act: () => go(`e/${id}`) });
  items.push(
    { label: 'Présenter', icon: 'present', act: () => { go(`e/${id}`); setTimeout(() => E.present?.(), 400); } },
    { label: 'Partager…', icon: 'share', act: () => { if (E.space?.id !== id) go(`e/${id}`); setTimeout(() => E.shareDialog?.(), E.space?.id === id ? 0 : 500); } },
    { label: 'Renommer…', icon: 'edit', act: async () => { const t = await UI.prompt('Renommer', s.title, { ok: 'Renommer' }); if (t && t.trim()) await E.patchSpace(id, { title: t.trim() }); } },
    { label: s.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: s.favorite ? 'starFill' : 'star', act: () => E.patchSpace(id, { favorite: !s.favorite }) },
    { label: 'Dupliquer', icon: 'copy', act: async () => { const { summary } = await E.api('POST', `/spaces/${id}/duplicate`, {}); E.state.spaces.unshift(summary); E.emit('summaries'); toast(`« ${summary.title} » créé`); } },
    { label: 'Enregistrer comme modèle', icon: 'template', act: async () => { const { summary } = await E.api('POST', `/spaces/${id}/duplicate`, { template: true }); E.state.spaces.unshift(summary); E.emit('summaries'); toast('Modèle enregistré : il apparaît dans « Mes modèles ».'); } },
  );
  if (folders.length || true) {
    items.push({ sep: true }, { header: 'Dossier' });
    items.push({ label: 'Aucun dossier', icon: 'folder', checked: !s.folder, act: () => E.patchSpace(id, { folder: null }) });
    for (const f of folders) items.push({ label: f.name, icon: 'folder', checked: s.folder === f.id, act: () => E.patchSpace(id, { folder: f.id }) });
    items.push({ label: 'Nouveau dossier…', icon: 'folderPlus', act: async () => { const f = await E.newFolder(); if (f) await E.patchSpace(id, { folder: f.id }); } });
  }
  items.push({ sep: true }, { header: 'Exporter' });
  items.push(
    { label: 'Excel (.xlsx)', icon: 'table', act: () => E.download(id, 'xlsx') },
    { label: 'CSV', icon: 'fileText', act: () => E.download(id, 'csv') },
    { label: 'Tous les fichiers (.zip)', icon: 'download', act: () => E.download(id, 'zip') },
    { label: 'Sauvegarde complète (.coursalbert)', icon: 'archive', act: () => E.download(id, 'cae') },
  );
  items.push({ sep: true });
  if (s.trashedAt) items.push({ label: 'Restaurer', icon: 'restore', act: () => E.patchSpace(id, { trashed: false }) }, { label: 'Supprimer définitivement…', icon: 'trash', danger: true, act: () => E.destroy(id) });
  else {
    items.push({ label: s.archived ? 'Désarchiver' : 'Archiver', icon: 'archive', act: () => E.patchSpace(id, { archived: !s.archived }) });
    items.push({ label: 'Mettre à la corbeille', icon: 'trash', danger: true, act: async () => { await E.patchSpace(id, { trashed: true }); toast('Espace mis à la corbeille', ''); if (E.space?.id === id) go('accueil'); } });
  }
  UI.menu(anchor, items, { align: inSpace ? 'right' : 'left' });
};
E.destroy = async function (id) {
  const s = E.summary(id);
  if (!await UI.confirm(`« ${s?.title || 'Cet espace'} » et tous ses fichiers seront supprimés de ce Mac. Cette action est définitive.`, { title: 'Supprimer définitivement ?', ok: 'Supprimer', danger: true })) return;
  try { await E.api('DELETE', `/spaces/${id}`); E.state.spaces = E.state.spaces.filter(x => x.id !== id); E.emit('summaries'); toast('Espace supprimé'); }
  catch (err) { toast(err.message, 'error'); }
};
E.download = async function (id, ext) {
  const url = `${E.base}/api/spaces/${encodeURIComponent(id)}/export.${ext}?${E.authQuery()}`;
  if (window.call && E.mode === 'app') {
    try { const saved = await call('saveURL', { url, suggested: `${(E.summary(id)?.title || E.space?.title || 'Espace').replace(/[/:\\]/g, '-')}.${ext === 'cae' ? 'coursalbert' : ext}` }); if (typeof saved === 'string') toast(`Enregistré : ${saved.split('/').pop()}`); }
    catch (err) { toast(err.message, 'error'); }
  } else {
    const a = document.createElement('a'); a.href = url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  }
};
E.newFolder = async function () {
  const name = await UI.prompt('Nouveau dossier', '', { placeholder: 'Ex. Projet BDD, Cours de maths…', ok: 'Créer' });
  if (!name || !name.trim()) return null;
  const folder = { id: `d_${randomId(6)}`, name: name.trim(), color: AVATAR_COLORS[(E.state.prefs.folders || []).length % AVATAR_COLORS.length] };
  await E.savePrefs({ folders: [...(E.state.prefs.folders || []), folder] });
  E.emit('summaries');
  return folder;
};
E.folderMenu = function (anchor, id) {
  const f = (E.state.prefs.folders || []).find(x => x.id === id);
  if (!f) return;
  UI.menu(anchor, [
    { label: 'Renommer…', icon: 'edit', act: async () => { const n = await UI.prompt('Renommer le dossier', f.name); if (n && n.trim()) { await E.savePrefs({ folders: E.state.prefs.folders.map(x => x.id === id ? { ...x, name: n.trim() } : x) }); E.emit('summaries'); } } },
    { label: 'Supprimer le dossier', icon: 'trash', danger: true, act: async () => { if (!await UI.confirm(`Supprimer le dossier « ${f.name} » ? Ses espaces ne sont pas supprimés.`, { ok: 'Supprimer', danger: true })) return; await E.savePrefs({ folders: E.state.prefs.folders.filter(x => x.id !== id) }); for (const s of E.state.spaces) if (s.folder === id) s.folder = null; if (E.dash.folder === id) E.dash.folder = ''; E.emit('summaries'); } },
  ]);
};

// ======================= Affichage =======================
function spaceThumb(s) {
  const wp = E.wallpaper(s.theme, s.id);
  let inner = '';
  if (s.kind === 'canvas') {
    inner = `<div class="th-canvas">${(s.objects || []).slice(0, 24).map(o => { const st = o.style || {}; const bg = o.type === 'sticky' ? (st.fill || '#fef08a') : ['rect', 'ellipse', 'diamond', 'hexagon', 'triangle', 'star'].includes(o.type) ? (st.fill && st.fill !== 'none' ? st.fill : 'transparent') : o.type === 'text' ? 'transparent' : 'rgba(148,163,184,.35)'; return `<i class="${o.type === 'ellipse' ? 'round' : ''} ${o.type === 'text' ? 'txt' : ''}" style="left:${(o.x / 1600) * 100}%;top:${(o.y / 900) * 100}%;width:${Math.max(1.5, (o.w / 1600) * 100)}%;height:${Math.max(1.5, (o.h / 900) * 100)}%;background:${bg}"></i>`; }).join('')}</div>`;
  } else {
    const thumbs = (s.thumbs || []).slice(0, 4);
    inner = thumbs.length ? `<div class="th-posts">${thumbs.map(t => t.image ? `<i class="img" style="background-image:url('${attr(E.mediaUrl(t.image, s.id))}')"></i>` : `<i style="${t.color ? `background:${t.color}` : ''}"><span>${esc(t.title)}</span></i>`).join('')}</div>` : `<div class="th-empty">${I[E.LAYOUTS.find(l => l.id === s.layout)?.icon || 'wall']}</div>`;
  }
  return `<div class="th ${wp.dark ? 'dark' : ''}" style="${attr(wp.css)}">${inner}</div>`;
}
function spaceCard(s) {
  return `<article class="space-card" data-open="${attr(s.id)}" tabindex="0">
    ${spaceThumb(s)}
    <div class="sc-info"><span class="sc-icon">${esc(s.icon)}</span><div class="grow"><b title="${attr(s.title)}">${esc(s.title)}</b><span>${esc(E.kindLabel(s.kind))} · ${s.kind === 'canvas' ? plural(s.cards, 'carte') : plural(s.posts, 'publication')} · ${esc(ago(s.updatedAt))}</span></div>
      <button class="btn icon ghost sc-star ${s.favorite ? 'on' : ''}" data-star="${attr(s.id)}" title="${s.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${s.favorite ? I.starFill : I.star}</button>
      <button class="btn icon ghost" data-smenu="${attr(s.id)}" title="Actions">${I.more}</button></div>
    <div class="sc-badges">${E.unread[s.id] ? `<span class="chip new">${plural(E.unread[s.id], 'nouveauté')}</span>` : ''}${s.shared ? `<span class="chip ok">${I.share}Partagé</span>` : ''}${s.pending ? `<span class="chip warn">${s.pending} à valider</span>` : ''}${s.isTemplate ? '<span class="chip">Modèle</span>' : ''}${s.archived ? '<span class="chip">Archivé</span>' : ''}</div>
  </article>`;
}
function albertFolderCard() {
  const has = typeof S !== 'undefined' && S.env && S.env.hasConfig;
  let line1 = 'Cours, emploi du temps, examens et présence d’Albert School.', line2 = '';
  if (has && S.data) {
    try {
      const next = D.current() || D.next();
      if (next) line1 = `${D.current() === next ? 'En cours' : 'Prochain cours'} : ${next.title} · ${dayKey(next.start) === dayKey(now()) ? time(next.start) : dayShort(next.start) + ' ' + time(next.start)}${next.room ? ' · ' + next.room : ''}`;
      const x = D.upcomingExams()[0];
      if (x) line2 = `Prochain examen : ${x.name} · ${x.code} — ${jLabel(x.start).text}`;
    } catch {}
  }
  return `<button class="albert-folder" data-act="go" data-to="${has ? 'today' : 'bienvenue'}">
    <span class="af-icon">${I.folderOpen}</span>
    <div class="grow"><b>Albert School</b><span>${esc(line1)}</span>${line2 ? `<span>${esc(line2)}</span>` : ''}</div>
    <span class="af-go">${has ? 'Ouvrir' : 'Configurer'}${I.chevR}</span>
  </button>`;
}
E.renderDashboard = function (main) {
  const q = E.dash.query;
  const focus = document.activeElement?.dataset?.dashSearch !== undefined ? document.activeElement.selectionStart : null;
  if (!E.available) {
    main.innerHTML = `<div class="page"><header class="page-head"><div class="titles"><h1>Mes espaces</h1></div></header>${albertFolderCard()}<div class="card">${emptyBigE('alert', E.error || 'Le serveur des espaces n’a pas démarré.', `<button class="btn primary" data-esp="retry">${I.sync}Réessayer</button>`)}</div></div>`;
    return;
  }
  const all = E.state.spaces;
  const folders = E.state.prefs.folders || [];
  const filters = [['all', 'Tous', 'home'], ['recent', 'Récents', 'clock'], ['favorites', 'Favoris', 'star'], ['shared', 'Partagés', 'share'], ['joined', 'Partagés avec moi', 'link'], ['templates', 'Mes modèles', 'template'], ['archived', 'Archives', 'archive'], ['trash', 'Corbeille', 'trash']];
  let list = all.filter(s => !s.trashedAt);
  const f = E.dash.filter;
  if (f === 'all') list = list.filter(s => !s.archived && !s.isTemplate);
  if (f === 'recent') list = [...list.filter(s => !s.archived && !s.isTemplate)].sort((a, b) => (b.openedAt || b.updatedAt).localeCompare(a.openedAt || a.updatedAt)).slice(0, 12);
  if (f === 'favorites') list = list.filter(s => s.favorite);
  if (f === 'shared') list = list.filter(s => s.shared);
  if (f === 'templates') list = list.filter(s => s.isTemplate);
  if (f === 'archived') list = list.filter(s => s.archived);
  if (f === 'trash') list = all.filter(s => s.trashedAt);
  if (E.dash.folder && f !== 'trash') list = list.filter(s => s.folder === E.dash.folder);
  if (q) { const n = normalize(q); list = list.filter(s => normalize(`${s.title} ${s.description}`).includes(n)); }
  const joined = E.state.prefs.joined || [];
  const counts = { favorites: all.filter(s => s.favorite && !s.trashedAt).length, trash: all.filter(s => s.trashedAt).length, shared: all.filter(s => s.shared && !s.trashedAt).length, joined: joined.length, templates: all.filter(s => s.isTemplate && !s.trashedAt).length, archived: all.filter(s => s.archived && !s.trashedAt).length };
  const hour = new Date().getHours();
  const hello = `${hour < 5 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir'}${E.state.ownerName && E.state.ownerName !== 'Moi' ? ` ${E.state.ownerName}` : ''}`;
  const empty = f === 'trash' ? 'La corbeille est vide.' : f === 'joined' ? '' : q ? 'Aucun espace ne correspond à la recherche.' : all.length ? 'Aucun espace ici.' : '';
  main.innerHTML = `<div class="page dash fade-in">
    <header class="page-head"><div class="titles"><div class="eyebrow">${esc(capFirst(localDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long' })))}</div><h1>${esc(hello)}</h1><div class="subtitle">Créez un espace, ajoutez n’importe quel contenu, invitez d’autres personnes.</div></div>
      <div class="head-actions"><div class="search-box">${I.search}<input class="input" type="search" placeholder="Rechercher un espace" value="${attr(q)}" data-dash-search></div><button class="btn primary" data-esp="new">${I.plus}Nouveau</button></div></header>
    <div class="create-row">
      <button class="create-tile" data-esp="blank-board"><span class="ct-ic" style="--c:#4f46e5">${I.wall}</span><b>Tableau</b><span>Publications en mur, colonnes, grille, tableau, chronologie, carte…</span></button>
      <button class="create-tile" data-esp="blank-canvas"><span class="ct-ic" style="--c:#0d9488">${I.canvas}</span><b>Espace libre</b><span>Tableau blanc en cartes : dessin, notes, formes, liens interactifs.</span></button>
      <button class="create-tile" data-esp="templates"><span class="ct-ic" style="--c:#ea580c">${I.template}</span><b>Modèles</b><span>Brainstorming, Kanban, portfolio, quiz, storyboard, leçon…</span></button>
      <button class="create-tile" data-esp="import"><span class="ct-ic" style="--c:#64748b">${I.upload}</span><b>Importer</b><span>Rouvrir une sauvegarde .coursalbert reçue ou exportée.</span></button>
    </div>
    ${albertFolderCard()}
    <div class="dash-filters">${filters.map(([id, label, icon]) => (id === 'joined' && !joined.length) || (['templates', 'archived', 'shared'].includes(id) && !counts[id]) ? '' : `<button class="filter-chip ${f === id ? 'on' : ''}" data-dfilter="${id}">${I[icon]}${esc(label)}${counts[id] ? `<span class="n">${counts[id]}</span>` : ''}</button>`).join('')}
      <span class="sep"></span>
      ${folders.map(fd => `<button class="filter-chip folder ${E.dash.folder === fd.id ? 'on' : ''}" data-dfolder="${attr(fd.id)}" style="--fc:${attr(fd.color)}"><i></i>${esc(fd.name)}<span class="n">${all.filter(s => s.folder === fd.id && !s.trashedAt).length}</span></button>`).join('')}
      <button class="filter-chip ghost" data-esp="new-folder">${I.folderPlus}Dossier</button></div>
    ${f === 'joined' ? `<div class="joined-list">${joined.map((j, i) => `<div class="row-item clickable" data-joined="${i}"><span class="sc-icon">${esc(j.icon || '🔗')}</span><div class="grow"><b>${esc(j.title || j.url)}</b><span>${esc(j.url)}</span></div><button class="btn sm ghost" data-unjoin="${i}" title="Retirer">${I.close}</button></div>`).join('') || '<div class="empty">Aucun espace rejoint.</div>'}<button class="btn" data-esp="join" style="margin-top:12px">${I.link}Rejoindre avec un lien…</button></div>`
      : list.length ? `<div class="space-grid">${list.map(spaceCard).join('')}</div>` : `<div class="card">${emptyBigE(f === 'trash' ? 'trash' : 'wall', empty || 'Aucun espace pour l’instant. Commencez par un tableau ou un modèle.', f === 'all' && !q ? `<button class="btn primary" data-esp="blank-board">${I.plus}Créer un tableau</button>` : '')}</div>`}
    ${f === 'trash' && list.length ? '<p class="muted" style="margin-top:12px;font-size:12.5px">Les espaces de la corbeille restent sur ce Mac jusqu’à leur suppression définitive.</p>' : ''}
  </div>`;
  if (focus !== null) { const inp = main.querySelector('[data-dash-search]'); if (inp) { inp.focus(); inp.setSelectionRange(focus, focus); } }
};
function emptyBigE(icon, text, action = '') { return `<div class="empty big">${I[icon] || ''}${esc(text)}${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`; }

E.renderJoined = function (main, encoded) {
  let url;
  try { url = decodeURIComponent(encoded); new URL(url); } catch { go('accueil'); return; }
  const j = (E.state?.prefs?.joined || []).find(x => x.url === url);
  main.innerHTML = `<div class="joined-view"><div class="jv-bar"><button class="btn sm" data-act="go" data-to="accueil">${I.chevL}Accueil</button><span class="grow">${esc(j?.title || url)}</span><button class="btn sm" data-joined-browser="${attr(url)}">${I.external}Ouvrir dans le navigateur</button></div><iframe src="${attr(url)}" title="Espace partagé" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads" allow="camera; microphone; display-capture; clipboard-write"></iframe></div>`;
};

// ======================= Événements de l’accueil =======================
document.addEventListener('click', async e => {
  const t = e.target;
  const btn = t.closest('[data-esp]');
  if (btn && !t.closest('.esp')) {
    const a = btn.dataset.esp;
    if (a === 'new') return E.newMenu(btn);
    if (a === 'blank-board') return E.createBlank('board');
    if (a === 'blank-canvas') return E.createBlank('canvas');
    if (a === 'templates') return E.templateGallery();
    if (a === 'import') return E.importFile();
    if (a === 'join') return E.join();
    if (a === 'new-folder') return E.newFolder().catch(err => toast(err.message, 'error'));
    if (a === 'retry') { try { await E.loadState(); E.listenOwner(); renderMain(false); renderSidebar(); } catch (err) { E.error = err.message; renderMain(false); } return; }
  }
  const star = t.closest('[data-star]');
  if (star) { e.stopPropagation(); const s = E.summary(star.dataset.star); if (s) E.patchSpace(s.id, { favorite: !s.favorite }).catch(err => toast(err.message, 'error')); return; }
  const sm = t.closest('[data-smenu]');
  if (sm) { e.stopPropagation(); return E.spaceMenu(sm, sm.dataset.smenu); }
  const open = t.closest('[data-open]');
  if (open && !t.closest('button')) { const s = E.summary(open.dataset.open); if (s?.trashedAt) { toast('Restaurez d’abord l’espace depuis la corbeille.'); return; } return go(`e/${open.dataset.open}`); }
  const df = t.closest('[data-dfilter]');
  if (df) { E.dash.filter = df.dataset.dfilter; return renderMain(false); }
  const dfo = t.closest('[data-dfolder]');
  if (dfo) { E.dash.folder = E.dash.folder === dfo.dataset.dfolder ? '' : dfo.dataset.dfolder; return renderMain(false); }
  const jn = t.closest('[data-joined]');
  if (jn && !t.closest('[data-unjoin]')) { const j = E.state.prefs.joined[+jn.dataset.joined]; if (j) go(`j/${encodeURIComponent(j.url)}`); return; }
  const uj = t.closest('[data-unjoin]');
  if (uj) { const joined = E.state.prefs.joined.filter((_, i) => i !== +uj.dataset.unjoin); await E.savePrefs({ joined }).catch(err => toast(err.message, 'error')); return renderMain(false); }
  const jb = t.closest('[data-joined-browser]');
  if (jb) { call('openURL', { url: jb.dataset.joinedBrowser }).catch(err => toast(err.message, 'error')); }
});
document.addEventListener('contextmenu', e => {
  const card = e.target.closest('[data-open]');
  if (card && E.summary(card.dataset.open)) { e.preventDefault(); E.spaceMenu(null, card.dataset.open); const m = UI.menuEl; if (m) { m.style.left = `${Math.min(e.clientX, innerWidth - m.offsetWidth - 8)}px`; m.style.top = `${Math.min(e.clientY, innerHeight - m.offsetHeight - 8)}px`; } return; }
  const fold = e.target.closest('[data-dfolder]');
  if (fold) { e.preventDefault(); E.folderMenu(fold, fold.dataset.dfolder); }
});
document.addEventListener('input', e => {
  if (e.target.dataset?.dashSearch !== undefined) { E.dash.query = e.target.value; renderMain(false); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList?.contains('space-card')) go(`e/${e.target.dataset.open}`);
});

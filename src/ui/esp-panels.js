/* Cours Albert 3 — réglages d’un espace, partage (lien, QR code, rôles), présentation, impression et export. */
'use strict';

// ======================= Réglages de l’espace =======================
E.settingsPanel = function (tab) {
  if (!E.space || !E.can('edit')) return;
  const box = UI.modal('<div class="sp"></div>', { cls: 'drawer-right', label: 'Réglages de l’espace', onClose: () => { if (E.panel?.box === box) E.panel = null; } });
  E.panel = { box, tab: tab || 'look' };
  E.renderSettings();
};
E.renderSettings = function () {
  const p = E.panel;
  if (!p || !E.space) return;
  const s = E.space, st = s.settings, th = s.theme;
  const board = s.kind === 'board';
  const tabs = board ? [['look', 'Apparence', 'palette'], ['layout', 'Disposition', 'wall'], ['posts', 'Publications', 'comment'], ['fields', 'Champs', 'list'], ['advanced', 'Avancé', 'settings']] : [['look', 'Apparence', 'palette'], ['canvas', 'Participation', 'users'], ['advanced', 'Avancé', 'settings']];
  const seg = (key, value, options, scope = 'settings') => `<div class="segmented wrap">${options.map(([v, l]) => `<button type="button" class="${value === v ? 'on' : ''}" data-set="${scope}.${key}" data-v="${attr(v)}">${esc(l)}</button>`).join('')}</div>`;
  const sw = (key, on, scope = 'settings') => `<label class="switch"><input type="checkbox" data-set-check="${scope}.${key}" ${on ? 'checked' : ''}><span></span></label>`;
  const row = (title, sub, control) => `<div class="set-row"><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${control}</div>`;
  let body = '';
  if (p.tab === 'look') {
    const wp = th.wallpaper || '';
    body = `
      <section><h3>Identité</h3>
        <div class="sp-ident"><button class="eh-icon big" data-sp="icon" title="Icône">${esc(s.icon)}</button><div class="grow"><input class="input" value="${attr(s.title)}" data-sp-text="title" placeholder="Titre"><textarea class="input" rows="2" data-sp-text="description" placeholder="Description, consignes…">${esc(s.description)}</textarea></div></div></section>
      <section><h3>Fond</h3>
        <div class="wp-grid">${Object.keys(E.GRADIENTS).map(g => `<button class="wp ${wp === `gradient:${g}` ? 'on' : ''}" data-wp="gradient:${g}" style="background:${E.GRADIENTS[g]}" title="${esc(g)}"></button>`).join('')}</div>
        <div class="wp-grid">${E.COLORS.map(c => `<button class="wp ${wp === `color:${c}` ? 'on' : ''}" data-wp="color:${c}" style="background:${c}"></button>`).join('')}</div>
        <div class="wp-grid">${E.PATTERNS.map(pt => `<button class="wp ${wp.startsWith(`pattern:${pt}`) ? 'on' : ''}" data-wp="pattern:${pt}:${(wp.match(/^pattern:[a-z]+:(#[0-9a-f]+)$/i) || [])[1] || '#f8fafc'}" style="${attr(E.wallpaper({ wallpaper: `pattern:${pt}:${(wp.match(/^pattern:[a-z]+:(#[0-9a-f]+)$/i) || [])[1] || '#f8fafc'}` }).css)}" title="Motif ${pt}"></button>`).join('')}<button class="wp upload ${wp.startsWith('image:') ? 'on' : ''}" data-sp="wp-image" title="Image de fond" ${wp.startsWith('image:') ? `style="background:url('${attr(E.mediaUrl(wp.slice(6)))}') center/cover"` : ''}>${wp.startsWith('image:') ? '' : I.image}</button></div></section>
      <section><h3>Couleur d’accent</h3><div class="wp-grid small">${['#4f46e5', '#2563eb', '#0891b2', '#0d9488', '#16a34a', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#0f172a', '#64748b'].map(c => `<button class="wp round ${th.accent === c ? 'on' : ''}" data-set="theme.accent" data-v="${c}" style="background:${c}"></button>`).join('')}</div></section>
      <section><h3>Police</h3>${seg('font', th.font, Object.entries(E.FONTS), 'theme')}</section>
      ${board ? `<section><h3>Cartes</h3>${row('Style', '', seg('cards', th.cards, [['light', 'Clair'], ['dark', 'Sombre'], ['glass', 'Verre'], ['color', 'Coloré']], 'theme'))}${row('Taille', '', seg('size', th.size, [['s', 'Petites'], ['m', 'Moyennes'], ['l', 'Grandes']], 'theme'))}</section>` : ''}`;
  } else if (p.tab === 'layout') {
    body = `<section><h3>Disposition</h3><div class="lay-pick">${E.LAYOUTS.map(l => `<button class="${st.layout === l.id ? 'on' : ''}" data-set="settings.layout" data-v="${l.id}">${I[l.icon]}<b>${esc(l.label)}</b><span>${esc(l.desc)}</span></button>`).join('')}</div></section>
      <section><h3>Organisation</h3>
        ${row('Sections', st.layout === 'columns' ? 'Toujours actives en colonnes : une colonne par section.' : 'Regroupe les publications par grande catégorie.', st.layout === 'columns' ? '<span class="chip ok">Actives</span>' : sw('sections', st.sections))}
        ${st.sections || st.layout === 'columns' ? `<div class="sec-edit">${s.sections.map((x, i) => `<div class="sec-line" data-sec="${attr(x.id)}"><span class="grip">${I.grip}</span><input class="input sm" value="${attr(x.title)}" data-sec-title><button class="btn icon sm ghost" data-sp="sec-up" ${i ? '' : 'disabled'}>${I.chevU}</button><button class="btn icon sm ghost" data-sp="sec-del" ${s.sections.length > 1 ? '' : 'disabled'}>${I.trash}</button></div>`).join('')}<button class="btn sm" data-sp="sec-add">${I.plus}Ajouter une section</button></div>` : ''}
        ${row('Ordre des publications', '', `<select class="select" data-set-select="settings.sort">${[['manual', 'Manuel (glisser-déposer)'], ['newest', 'Plus récentes d’abord'], ['oldest', 'Plus anciennes d’abord'], ['title', 'Par titre (A→Z, 1→10)'], ['reactions', 'Les plus appréciées'], ['date', 'Par date d’événement'], ...s.fields.filter(f => f.type !== 'vote').map(f => [`field:${f.id}`, `Par « ${f.name} »`])].map(([v, l]) => `<option value="${attr(v)}" ${st.sort === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
        ${row('Nouvelles publications', 'Où elles apparaissent en ordre manuel.', seg('newPosts', st.newPosts, [['start', 'En premier'], ['end', 'À la fin']]))}
        ${row('Afficher l’auteur', '', sw('showAuthor', st.showAuthor))}
        ${row('Afficher la date', '', sw('showDate', st.showDate))}
      </section>
      ${E.me?.aiSort ? `<section><h3>Tri par IA (facultatif)</h3>${row('Ranger les publications en sections', 'L’IA propose des sections et y range les publications. Vous validez avant tout changement.', `<button class="btn sm" data-sp="ai-organize">${I.sparkles}Proposer</button>`)}</section>` : ''}`;
  } else if (p.tab === 'posts') {
    body = `<section><h3>Réactions</h3><div class="rx-pick">${Object.entries(E.REACTIONS).map(([v, l]) => `<button class="${st.reactions === v ? 'on' : ''}" data-set="settings.reactions" data-v="${v}">${I[{ none: 'close', like: 'heart', vote: 'up', stars: 'star', grade: 'hash', emoji: 'smile' }[v]]}<span>${esc(l)}</span></button>`).join('')}</div></section>
      <section><h3>Échanges</h3>${row('Commentaires', 'Une discussion sous chaque publication.', sw('comments', st.comments))}${row('Anonymat', 'Masque le nom des auteurs aux autres participants.', seg('attribution', st.attribution, [['names', 'Noms visibles'], ['anonymous', 'Anonyme']]))}</section>
      <section><h3>Modération</h3>${seg('moderation', st.moderation, [['none', 'Aucune'], ['approval', 'Validation avant publication'], ['auto', 'Automatique']])}
        <p class="muted small">${st.moderation === 'approval' ? 'Les publications des participants restent invisibles jusqu’à ce que vous les validiez (bouton « à valider » en haut).' : st.moderation === 'auto' ? 'Les textes contenant des insultes ou des mots inappropriés sont mis de côté pour validation ; les commentaires sont bloqués.' : 'Les publications apparaissent immédiatement.'}</p></section>`;
  } else if (p.tab === 'fields') {
    body = `<section><h3>Champs personnalisés</h3><p class="muted small">Les informations demandées à chaque publication : elles transforment le tableau en petite base de données (et deviennent des colonnes en disposition Tableau).</p>
      <div class="field-list">${s.fields.map((f, i) => `<div class="field-line" data-fid="${attr(f.id)}"><span class="fl-ic">${I[E.FIELD_ICONS[f.type]] || ''}</span><div class="grow"><b>${esc(f.name)}${f.required ? ' <i class="req">*</i>' : ''}</b><span>${esc(E.FIELD_TYPES[f.type])}${f.options?.length ? ` · ${f.options.map(o => o.label).join(', ')}` : ''}</span></div><button class="btn icon sm ghost" data-sp="field-up" ${i ? '' : 'disabled'} title="Monter">${I.chevU}</button><button class="btn icon sm ghost" data-sp="field-edit" title="Modifier">${I.edit}</button><button class="btn icon sm ghost" data-sp="field-del" title="Supprimer">${I.trash}</button></div>`).join('') || '<p class="muted">Aucun champ pour l’instant.</p>'}</div>
      <button class="btn" data-sp="field-add">${I.plus}Ajouter un champ</button></section>`;
  } else if (p.tab === 'canvas') {
    body = `<section><h3>Mode des participants</h3>${seg('canvasMode', st.canvasMode, [['edit', 'Création : ils modifient les cartes'], ['interact', 'Interaction : ils utilisent l’activité']])}
      <p class="muted small">${st.canvasMode === 'interact' ? 'Les objets sont figés pour les participants : ils cliquent sur les liens interactifs et votent aux sondages.' : 'Les participants peuvent ajouter, déplacer et modifier les objets (vous restez maître de tout).'}</p>
      ${st.canvasMode === 'interact' ? row('Notes et dessins des participants', 'Ils peuvent tout de même ajouter des notes et dessiner.', sw('participantsCanAdd', st.participantsCanAdd)) : ''}</section>
      <section><h3>Travail en groupes</h3>${row('Cartes réservées par groupe', 'Chaque équipe ne voit que sa carte (et les cartes communes).', sw('groupWork', st.groupWork))}
      ${st.groupWork ? `<div class="sec-edit">${s.groups.map(g => `<div class="sec-line" data-gid="${attr(g.id)}"><span class="gdot" style="background:${attr(g.color)}"></span><input class="input sm" value="${attr(g.name)}" data-group-name><button class="btn icon sm ghost" data-sp="group-del">${I.trash}</button></div>`).join('')}<button class="btn sm" data-sp="group-add">${I.plus}Ajouter un groupe</button></div><p class="muted small">Attribuez une carte à un groupe depuis le menu de la carte. Vous pouvez aussi créer un lien de partage par groupe.</p>` : ''}</section>`;
  } else {
    body = `<section><h3>Copies et modèles</h3>
      <div class="sp-actions"><button class="btn" data-sp="duplicate">${I.copy}Dupliquer l’espace</button><button class="btn" data-sp="template">${I.template}Enregistrer comme modèle</button></div></section>
      <section><h3>Exporter</h3><div class="sp-actions">
        <button class="btn" data-sp="export" data-ext="xlsx">${I.table}Excel</button><button class="btn" data-sp="export" data-ext="csv">${I.fileText}CSV</button><button class="btn" data-sp="export" data-ext="zip">${I.download}Fichiers (.zip)</button>
        <button class="btn" data-sp="pdf">${I.file}PDF</button><button class="btn" data-sp="png">${I.image}Image</button><button class="btn" data-sp="export" data-ext="cae">${I.archive}Sauvegarde</button></div>
        <p class="muted small">Excel contient plusieurs feuilles : publications, commentaires, réactions, sondages, participants.</p></section>
      ${E.can('share') ? `<section><h3>Rangement</h3><div class="sp-actions"><button class="btn" data-sp="archive">${I.archive}${s.archived ? 'Désarchiver' : 'Archiver'}</button><button class="btn danger" data-sp="trash">${I.trash}Mettre à la corbeille</button></div></section>` : ''}`;
  }
  p.box.querySelector('.sp').innerHTML = `<div class="sheet-head"><h2>Réglages de l’espace</h2><button class="btn icon ghost" data-sp="close">${I.close}</button></div>
    <nav class="sp-tabs">${tabs.map(([id, l, ic]) => `<button class="${p.tab === id ? 'on' : ''}" data-sp-tab="${id}">${I[ic]}${esc(l)}</button>`).join('')}</nav>
    <div class="sp-body">${body}</div>`;
};
E.setPath = async function (path, value) {
  const [scope, key] = path.split('.');
  const patch = { [scope]: { [key]: value } };
  if (scope === 'settings' && key === 'layout' && value === 'columns') patch.settings.sections = true;
  await E.patchMeta(patch).catch(() => {});
  E.renderSettings();
};
E.saveText = debounce((key, value) => E.patchMeta({ [key]: value }).catch(() => {}), 700);
E.fieldEditor = function (field) {
  return new Promise(resolve => {
    const f = field ? JSON.parse(JSON.stringify(field)) : { name: '', type: 'text', required: false, options: [] };
    let done = false;
    const box = UI.modal('<form class="dlg fe"></form>', { cls: 'small', onClose: () => { if (!done) resolve(null); } });
    const draw = () => {
      const opts = f.type === 'select' || f.type === 'multiselect';
      box.querySelector('.fe').innerHTML = `<h2>${field ? 'Modifier le champ' : 'Nouveau champ'}</h2>
        <label class="lbl">Nom<input class="input" value="${attr(f.name)}" data-fe="name" placeholder="Ex. Catégorie, Date, Note…" autofocus></label>
        <label class="lbl">Type<select class="select" data-fe="type">${Object.entries(E.FIELD_TYPES).map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        ${opts ? `<div class="lbl">Choix possibles<div class="fe-opts">${(f.options || []).map((o, i) => `<div class="fe-opt"><button type="button" class="swatch" data-fe-color="${i}" style="background:${o.color || 'var(--bg-soft)'}"></button><input class="input sm" value="${attr(o.label)}" data-fe-opt="${i}"><button type="button" class="btn icon sm ghost" data-fe-del="${i}">${I.close}</button></div>`).join('')}<button type="button" class="btn sm" data-fe-add>${I.plus}Ajouter un choix</button></div></div>` : ''}
        ${f.type === 'score' ? `<label class="lbl">Note maximale<input class="input" type="number" min="1" max="1000" value="${attr(f.max || 20)}" data-fe="max"></label>` : ''}
        ${f.type === 'button' ? `<label class="lbl">Texte du bouton<input class="input" value="${attr(f.label || 'Ouvrir')}" data-fe="label"></label>` : ''}
        ${f.type !== 'vote' ? `<label class="mini-check"><input type="checkbox" data-fe="required" ${f.required ? 'checked' : ''}>Obligatoire</label>` : '<p class="muted small">Chaque participant peut ajouter +1 à une publication.</p>'}
        <div class="dlg-actions"><button type="button" class="btn" data-fe-cancel>Annuler</button><button class="btn primary">${field ? 'Enregistrer' : 'Ajouter'}</button></div>`;
    };
    draw();
    const palette = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', null];
    box.addEventListener('input', e => {
      const k = e.target.dataset.fe;
      if (k === 'name') f.name = e.target.value;
      if (k === 'max') f.max = +e.target.value;
      if (k === 'label') f.label = e.target.value;
      if (e.target.dataset.feOpt !== undefined) f.options[+e.target.dataset.feOpt].label = e.target.value;
    });
    box.addEventListener('change', e => {
      if (e.target.dataset.fe === 'type') { f.type = e.target.value; if ((f.type === 'select' || f.type === 'multiselect') && !f.options?.length) f.options = [{ id: `o_${randomId(5)}`, label: 'Choix 1' }, { id: `o_${randomId(5)}`, label: 'Choix 2' }]; draw(); }
      if (e.target.dataset.fe === 'required') f.required = e.target.checked;
    });
    box.addEventListener('click', e => {
      if (e.target.closest('[data-fe-cancel]')) return UI.close(box);
      if (e.target.closest('[data-fe-add]')) { f.options.push({ id: `o_${randomId(5)}`, label: `Choix ${f.options.length + 1}` }); draw(); box.querySelectorAll('[data-fe-opt]')[f.options.length - 1]?.select(); }
      const del = e.target.closest('[data-fe-del]'); if (del) { f.options.splice(+del.dataset.feDel, 1); draw(); }
      const col = e.target.closest('[data-fe-color]'); if (col) { const o = f.options[+col.dataset.feColor]; o.color = palette[(palette.indexOf(o.color ?? null) + 1) % palette.length]; draw(); }
    });
    box.querySelector('.fe').addEventListener('submit', e => { e.preventDefault(); if (!f.name.trim()) { toast('Donnez un nom au champ.', 'error'); return; } done = true; resolve({ ...f, name: f.name.trim(), options: (f.options || []).filter(o => o.label.trim()) }); UI.close(box); });
  });
};
E.aiOrganize = async function () {
  toast('L’IA réfléchit au rangement…');
  let result;
  try { ({ result } = await E.api('POST', `/spaces/${E.space.id}/ai`, { task: 'organize' })); }
  catch (err) { toast(err.message, 'error'); return; }
  const known = new Set(E.space.posts.map(p => p.id));
  const sections = (result.sections || []).map(s => ({ title: String(s.title || 'Section').slice(0, 80), postIds: (s.postIds || []).filter(id => known.has(id)) })).filter(s => s.postIds.length);
  if (!sections.length) { toast('L’IA n’a rien proposé d’exploitable.', 'error'); return; }
  const ok = await UI.confirm(sections.map(s => `${s.title} (${s.postIds.length})`).join(' · '), { title: 'Ranger ainsi ?', ok: 'Appliquer' });
  if (!ok) return;
  const existing = new Map(E.space.sections.map(s => [normalize(s.title), s]));
  const next = sections.map(s => existing.get(normalize(s.title)) || { id: `s_${randomId(8)}`, title: s.title });
  try {
    const { space } = await E.api('PATCH', `/spaces/${E.space.id}`, { sections: next, settings: { sections: true } });
    const ids = space.sections.map(x => x.id);
    const moves = sections.flatMap((s, i) => s.postIds.map((id, k) => ({ id, sectionId: ids[i], order: k })));
    await E.api('POST', `/spaces/${E.space.id}/posts/move`, { moves });
    await E.reload();
    toast('Publications rangées');
  } catch (err) { toast(err.message, 'error'); }
};
document.addEventListener('click', async e => {
  const p = E.panel;
  if (!p || !p.box.contains(e.target)) return;
  const tab = e.target.closest('[data-sp-tab]');
  if (tab) { p.tab = tab.dataset.spTab; return E.renderSettings(); }
  const set = e.target.closest('[data-set]');
  if (set) return E.setPath(set.dataset.set, set.dataset.v);
  const wp = e.target.closest('[data-wp]');
  if (wp) return E.setPath('theme.wallpaper', wp.dataset.wp);
  const b = e.target.closest('[data-sp]');
  if (!b) return;
  const a = b.dataset.sp, s = E.space;
  switch (a) {
    case 'close': return UI.close(p.box);
    case 'icon': return emojiPicker(b, icon => E.patchMeta({ icon }).then(() => E.renderSettings()));
    case 'wp-image': { const [f] = await E.pickFiles('image/*', { multiple: false }); if (!f) return; try { const att = await E.upload(f); await E.setPath('theme.wallpaper', `image:${att.file}`); } catch (err) { toast(err.message, 'error'); } return; }
    case 'sec-add': await E.patchMeta({ sections: [...s.sections, { title: `Section ${s.sections.length + 1}` }] }); return E.renderSettings();
    case 'sec-up': { const id = b.closest('[data-sec]').dataset.sec; const i = s.sections.findIndex(x => x.id === id); const list = [...s.sections]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; await E.patchMeta({ sections: list }); return E.renderSettings(); }
    case 'sec-del': { const id = b.closest('[data-sec]').dataset.sec; const n = s.posts.filter(x => x.sectionId === id).length; if (n && !await UI.confirm(`Ses ${plural(n, 'publication')} iront dans une autre section.`, { title: 'Supprimer la section ?', ok: 'Supprimer', danger: true })) return; await E.patchMeta({ sections: s.sections.filter(x => x.id !== id) }); await E.reload(); return E.renderSettings(); }
    case 'field-add': { const f = await E.fieldEditor(null); if (f) { await E.patchMeta({ fields: [...s.fields, f] }); E.renderSettings(); } return; }
    case 'field-edit': { const id = b.closest('[data-fid]').dataset.fid; const f = await E.fieldEditor(s.fields.find(x => x.id === id)); if (f) { await E.patchMeta({ fields: s.fields.map(x => x.id === id ? f : x) }); E.renderSettings(); } return; }
    case 'field-del': { const id = b.closest('[data-fid]').dataset.fid; const f = s.fields.find(x => x.id === id); if (!await UI.confirm(`Les valeurs de « ${f.name} » seront effacées de toutes les publications.`, { title: 'Supprimer le champ ?', ok: 'Supprimer', danger: true })) return; await E.patchMeta({ fields: s.fields.filter(x => x.id !== id) }); await E.reload(); return E.renderSettings(); }
    case 'field-up': { const id = b.closest('[data-fid]').dataset.fid; const i = s.fields.findIndex(x => x.id === id); const list = [...s.fields]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; await E.patchMeta({ fields: list }); return E.renderSettings(); }
    case 'group-add': { const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4']; await E.patchMeta({ groups: [...s.groups, { name: `Groupe ${String.fromCharCode(65 + s.groups.length)}`, color: colors[s.groups.length % colors.length] }] }); return E.renderSettings(); }
    case 'group-del': { const id = b.closest('[data-gid]').dataset.gid; await E.patchMeta({ groups: s.groups.filter(g => g.id !== id) }); return E.renderSettings(); }
    case 'ai-organize': UI.close(p.box); return E.aiOrganize();
    case 'duplicate': { const { summary } = await E.api('POST', `/spaces/${s.id}/duplicate`, {}); E.state?.spaces.unshift(summary); toast(`« ${summary.title} » créé`); return; }
    case 'template': { await E.api('POST', `/spaces/${s.id}/duplicate`, { template: true }).then(r => E.state?.spaces.unshift(r.summary)); toast('Modèle enregistré dans « Mes modèles ».'); return; }
    case 'export': return E.download(s.id, b.dataset.ext);
    case 'pdf': UI.close(p.box); return E.printSpace('pdf');
    case 'png': UI.close(p.box); return E.printSpace('png');
    case 'archive': await E.patchSpace(s.id, { archived: !s.archived }); return E.renderSettings();
    case 'trash': if (!await UI.confirm('L’espace ira dans la corbeille de l’accueil (récupérable).', { title: 'Mettre à la corbeille ?', ok: 'Corbeille', danger: true })) return; await E.patchSpace(s.id, { trashed: true }); UI.close(p.box); go('accueil'); return;
  }
});
document.addEventListener('change', e => {
  const p = E.panel;
  if (!p || !p.box.contains(e.target)) return;
  if (e.target.dataset.setCheck) return E.setPath(e.target.dataset.setCheck, e.target.checked);
  if (e.target.dataset.setSelect) return E.setPath(e.target.dataset.setSelect, e.target.value);
});
document.addEventListener('input', e => {
  const p = E.panel;
  if (!p || !p.box.contains(e.target)) return;
  if (e.target.dataset.spText) return E.saveText(e.target.dataset.spText, e.target.value);
  if (e.target.matches('[data-sec-title]')) { const id = e.target.closest('[data-sec]').dataset.sec; E.saveSections(E.space.sections.map(x => x.id === id ? { ...x, title: e.target.value || 'Section' } : x)); }
  if (e.target.matches('[data-group-name]')) { const id = e.target.closest('[data-gid]').dataset.gid; E.saveGroups(E.space.groups.map(g => g.id === id ? { ...g, name: e.target.value || 'Groupe' } : g)); }
});
E.saveSections = debounce(sections => E.patchMeta({ sections }).catch(() => {}), 600);
E.saveGroups = debounce(groups => E.patchMeta({ groups }).catch(() => {}), 600);

// ======================= Partage =======================
E.shareUrl = function (link, address) {
  const lan = E.lan || E.state?.lan;
  if (!lan?.port || !link) return '';
  const host = address || lan.addresses?.[0]?.address || lan.hostname;
  return `http://${host}:${lan.port}/s/${E.space.id}${link === 'public' ? '' : `?k=${encodeURIComponent(link.key)}`}`;
};
E.qrSVG = function (text, size = 220) {
  if (!window.qrcode || !text) return '';
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }).replace('<svg ', `<svg width="${size}" height="${size}" `);
};
E.shareDialog = async function () {
  if (!E.space || !E.can('share')) return;
  try { E.lan = await E.api('GET', '/lan'); } catch {}
  const box = UI.modal('<div class="share"></div>', { cls: 'sheet share-sheet', label: 'Partager', onClose: () => { if (E.share?.box === box) E.share = null; } });
  E.share = { box, address: E.lan?.addresses?.[0]?.address || '', qrFor: null };
  E.renderShare();
};
E.renderShare = function () {
  const sh = E.share;
  if (!sh || !E.space) return;
  const s = E.space, cfg = s.sharing || { visibility: 'private', links: [] };
  const vis = cfg.visibility;
  const lan = E.lan || {};
  const links = (cfg.links || []).filter(l => !l.disabled || true);
  const main = links.find(l => !l.disabled && !l.invite && !l.asOwner && l.role === cfg.defaultRole) || links.find(l => !l.disabled && !l.invite && !l.asOwner);
  const mainUrl = vis === 'public' && !main ? E.shareUrl('public', sh.address) : main ? E.shareUrl(main, sh.address) : '';
  const qrUrl = sh.qrFor ? E.shareUrl(links.find(l => l.id === sh.qrFor), sh.address) : mainUrl;
  const roleSelect = (value, attrs) => `<select class="select sm" ${attrs}>${['viewer', 'commenter', 'contributor', 'moderator', 'admin', 'submitter'].map(r => `<option value="${r}" ${value === r ? 'selected' : ''}>${esc(E.ROLE_LABELS[r])}</option>`).join('')}</select>`;
  const visOpts = [['private', 'Privé', 'lock', 'Vous seul, sur ce Mac.'], ['invited', 'Sur invitation', 'user', 'Seulement les personnes à qui vous donnez une invitation nominative.'], ['link', 'Avec le lien', 'link', 'Toute personne qui a le lien ou scanne le QR code.'], ['public', 'Public', 'globe', 'Listé sur la page des espaces publics de ce Mac, sans lien.']];
  sh.box.querySelector('.share').innerHTML = `<div class="sheet-head"><h2>${I.share}Partager « ${esc(s.title)} »</h2><button class="btn icon ghost" data-sh="close">${I.close}</button></div>
    <div class="sh-body">
      <div class="vis-pick">${visOpts.map(([v, l, ic, d]) => `<button class="${vis === v ? 'on' : ''}" data-sh-vis="${v}">${I[ic]}<b>${esc(l)}</b><span>${esc(d)}</span></button>`).join('')}</div>
      ${vis === 'private' ? `<div class="callout">${I.info}<div>L’espace n’est visible que dans cette app. Choisissez « Avec le lien » pour inviter d’autres personnes : ils pourront consulter, publier ou commenter <b>en direct</b> depuis leur ordinateur ou leur téléphone, sans compte.</div></div>` : `
      ${!lan.enabled ? `<div class="banner warn">${I.alert}<div class="grow">Le partage sur le réseau local est arrêté.</div><button class="btn sm primary" data-sh="lan-on">Activer</button></div>` : ''}
      ${lan.enabled && !lan.addresses?.length ? `<div class="banner warn">${I.alert}<div class="grow">Ce Mac n’est connecté à aucun réseau. Connectez-vous au Wi-Fi pour partager.</div></div>` : ''}
      <div class="sh-main">
        <div class="sh-qr" title="QR code à scanner">${qrUrl ? E.qrSVG(qrUrl, 200) : ''}<button class="btn sm" data-sh="qr-big">${I.expand}Afficher en grand</button></div>
        <div class="grow">
          <div class="lbl">Lien ${sh.qrFor ? `de « ${esc(links.find(l => l.id === sh.qrFor)?.label || 'partage')} »` : 'principal'}</div>
          <div class="sh-url"><input class="input" readonly value="${attr(qrUrl)}" data-sh-url><button class="btn primary" data-sh="copy" data-url="${attr(qrUrl)}">${I.copy}Copier</button></div>
          ${lan.addresses?.length > 1 ? `<label class="lbl">Réseau<select class="select sm" data-sh-addr>${lan.addresses.map(a => `<option value="${attr(a.address)}" ${sh.address === a.address ? 'selected' : ''}>${esc(a.address)} (${esc(a.name)})</option>`).join('')}<option value="${attr(lan.hostname)}" ${sh.address === lan.hostname ? 'selected' : ''}>${esc(lan.hostname)} (Bonjour)</option></select></label>` : ''}
          ${main && !sh.qrFor ? `<div class="sh-role">Les personnes qui ont ce lien peuvent : ${roleSelect(main.role, `data-sh-role="${attr(main.id)}"`)}</div><p class="muted small">${esc(E.ROLE_HELP[main.role] || '')}</p>` : ''}
          ${sh.qrFor ? `<button class="btn sm ghost" data-sh="qr-main">${I.chevL}Revenir au lien principal</button>` : ''}
          <p class="muted small">${I.info} Les participants doivent être sur le <b>même réseau Wi-Fi</b> que ce Mac, et Cours Albert doit rester ouvert. Sans compte : ils choisissent simplement un nom.</p>
        </div>
      </div>
      <h3>Liens et invitations</h3>
      <div class="sh-links">${links.length ? links.map(l => `<div class="sh-link ${l.disabled ? 'off' : ''}" data-link="${attr(l.id)}">
          <span class="sl-ic">${I[l.asOwner ? 'phone' : l.invite ? 'user' : l.role === 'submitter' ? 'send' : 'link']}</span>
          <div class="grow"><b>${esc(l.label || (l.asOwner ? 'Mon téléphone' : l.invite ? 'Invitation' : 'Lien'))}</b><span>${esc(E.ROLE_LABELS[l.role])}${l.group ? ` · ${esc(s.groups.find(g => g.id === l.group)?.name || '')}` : ''}${l.disabled ? ' · désactivé' : ''}</span></div>
          ${l.asOwner ? '' : roleSelect(l.role, `data-sh-role="${attr(l.id)}"`)}
          <button class="btn icon sm ghost" data-sh="qr" title="QR code">${I.qr}</button><button class="btn icon sm ghost" data-sh="copy-link" title="Copier">${I.copy}</button><button class="btn icon sm ghost" data-sh="link-menu" title="Plus">${I.more}</button></div>`).join('') : '<p class="muted">Aucun lien.</p>'}</div>
      <div class="sh-add">
        <button class="btn sm" data-sh="add-link">${I.link}Nouveau lien</button>
        <button class="btn sm" data-sh="add-invite">${I.user}Invitation nominative</button>
        <button class="btn sm" data-sh="add-form">${I.send}Formulaire de dépôt</button>
        <button class="btn sm" data-sh="add-me" title="Pour publier depuis votre téléphone en votre nom (photos, brouillons)">${I.phone}Mon téléphone</button>
        ${s.groups?.length ? `<button class="btn sm" data-sh="add-groups">${I.group}Un lien par groupe</button>` : ''}
      </div>
      <details class="sh-embed"><summary>Intégrer dans une page web</summary><textarea class="input mono" rows="3" readonly>${esc(mainUrl ? `<iframe src="${mainUrl}${mainUrl.includes('?') ? '&' : '?'}embed=1" width="100%" height="640" style="border:0;border-radius:12px" allow="camera; microphone"></iframe>` : '')}</textarea></details>
      <div class="sh-foot"><label class="mini-check"><input type="checkbox" data-sh-name ${cfg.requireName ? 'checked' : ''}>Demander un nom aux participants</label><span class="grow"></span><button class="btn sm ghost" data-sh="copy-file">${I.archive}Envoyer une copie (.coursalbert)</button></div>`}
    </div>`;
};
E.updateSharing = async function (patch) {
  try {
    const r = await E.api('POST', `/spaces/${E.space.id}/sharing`, patch);
    E.space.sharing = r.sharing;
    if (r.lan) { E.lan = r.lan; if (E.state) E.state.lan = r.lan; }
    if (!E.share?.address && E.lan?.addresses?.length && E.share) E.share.address = E.lan.addresses[0].address;
    const sum = E.summary?.(E.space.id); if (sum) { sum.shared = r.sharing.visibility !== 'private'; sum.visibility = r.sharing.visibility; }
    E.renderShare();
  } catch (err) { toast(err.message, 'error'); }
};
E.bigQR = function (url) {
  const box = UI.modal(`<div class="qr-big"><h1>${esc(E.space.icon)} ${esc(E.space.title)}</h1><div class="qr-img">${E.qrSVG(url, 420)}</div><p class="qr-url">${esc(url)}</p><p class="muted">Scannez avec l’appareil photo de votre téléphone · même réseau Wi-Fi</p><button class="btn" data-qrb>Fermer</button></div>`, { cls: 'qr-modal' });
  box.addEventListener('click', e => { if (e.target.closest('[data-qrb]')) UI.close(box); });
};
document.addEventListener('click', async e => {
  const sh = E.share;
  if (!sh || !sh.box.contains(e.target)) return;
  const vis = e.target.closest('[data-sh-vis]');
  if (vis) return E.updateSharing({ visibility: vis.dataset.shVis });
  const b = e.target.closest('[data-sh]');
  if (!b) return;
  const a = b.dataset.sh;
  const linkEl = b.closest('[data-link]');
  const link = linkEl ? E.space.sharing.links.find(l => l.id === linkEl.dataset.link) : null;
  switch (a) {
    case 'close': return UI.close(sh.box);
    case 'lan-on': try { const r = await E.api('POST', '/prefs', { lan: true }); E.lan = r.lan; if (E.state) E.state.lan = r.lan; sh.address = r.lan.addresses?.[0]?.address || ''; E.renderShare(); } catch (err) { toast(err.message, 'error'); } return;
    case 'copy': return copyText(b.dataset.url || sh.box.querySelector('[data-sh-url]').value, 'Lien copié');
    case 'qr-big': return E.bigQR(sh.box.querySelector('[data-sh-url]').value);
    case 'qr': sh.qrFor = link.id; return E.renderShare();
    case 'qr-main': sh.qrFor = null; return E.renderShare();
    case 'copy-link': return copyText(E.shareUrl(link, sh.address), 'Lien copié');
    case 'add-link': return E.updateSharing({ addLink: { role: 'contributor', label: `Lien ${E.space.sharing.links.length + 1}` } });
    case 'add-invite': { const name = await UI.prompt('Invitation nominative', '', { placeholder: 'Nom de la personne', ok: 'Créer l’invitation', message: 'La personne recevra un lien personnel ; son nom sera déjà renseigné.' }); if (name && name.trim()) await E.updateSharing({ addLink: { role: 'contributor', label: name.trim(), invite: true } }); return; }
    case 'add-form': return E.updateSharing({ addLink: { role: 'submitter', label: 'Formulaire de dépôt' } });
    case 'add-me': await E.updateSharing({ addLink: { role: 'admin', label: 'Mon téléphone', asOwner: true } }); { const me = E.space.sharing.links.filter(l => l.asOwner).pop(); if (me) { sh.qrFor = me.id; E.renderShare(); toast('Scannez ce QR code avec votre téléphone : vous y publierez en votre nom.'); } } return;
    case 'add-groups': for (const g of E.space.groups) if (!E.space.sharing.links.some(l => l.group === g.id)) await E.updateSharing({ addLink: { role: 'contributor', label: g.name, group: g.id } }); return;
    case 'copy-file': return E.download(E.space.id, 'cae');
    case 'link-menu': return UI.menu(b, [
      { label: 'Renommer…', icon: 'edit', act: async () => { const t = await UI.prompt('Nom du lien', link.label); if (t !== null) E.updateSharing({ updateLink: { id: link.id, label: t.trim() } }); } },
      ...(E.space.groups?.length ? [{ header: 'Groupe' }, { label: 'Aucun groupe', checked: !link.group, act: () => E.updateSharing({ updateLink: { id: link.id, group: null } }) }, ...E.space.groups.map(g => ({ label: g.name, icon: 'group', checked: link.group === g.id, act: () => E.updateSharing({ updateLink: { id: link.id, group: g.id } }) }))] : []),
      { sep: true },
      { label: link.disabled ? 'Réactiver' : 'Désactiver', icon: link.disabled ? 'check' : 'eyeOff', act: () => E.updateSharing({ updateLink: { id: link.id, disabled: !link.disabled } }) },
      { label: 'Générer une nouvelle adresse', icon: 'sync', act: async () => { if (await UI.confirm('L’ancienne adresse cessera de fonctionner.', { title: 'Nouvelle adresse ?', ok: 'Générer' })) E.updateSharing({ regenerate: link.id }); } },
      { label: 'Supprimer', icon: 'trash', danger: true, act: () => E.updateSharing({ removeLink: link.id }) },
    ], { align: 'right' });
  }
});
document.addEventListener('change', e => {
  const sh = E.share;
  if (!sh || !sh.box.contains(e.target)) return;
  if (e.target.dataset.shRole) E.updateSharing({ updateLink: { id: e.target.dataset.shRole, role: e.target.value } }).then(() => { const l = E.space.sharing.links.find(x => x.id === e.target.dataset.shRole); if (l && !l.invite && !l.asOwner) E.updateSharing({ defaultRole: e.target.value }); });
  if (e.target.matches('[data-sh-addr]')) { sh.address = e.target.value; E.renderShare(); }
  if (e.target.matches('[data-sh-name]')) E.updateSharing({ requireName: e.target.checked });
});
E.copyPostLink = function (post) {
  const link = (E.space.sharing?.links || []).find(l => !l.disabled && !l.invite && !l.asOwner);
  const url = link ? E.shareUrl(link) : '';
  if (!url) { toast('Partagez d’abord l’espace avec un lien.'); return; }
  copyText(`${url}&post=${post.id}`, 'Lien de la publication copié');
};

// ======================= Présentation =======================
E.present = function (start = 0) {
  if (!E.space) return;
  if (!E.isBoard()) return E.Canvas?.present?.();
  const s = E.space;
  const slides = [{ type: 'title' }];
  for (const g of E.grouped(E.visiblePosts())) {
    if (g.section && E.space.settings.sections && g.posts.length) slides.push({ type: 'section', section: g.section, count: g.posts.length });
    for (const p of g.posts) slides.push({ type: 'post', id: p.id });
  }
  let i = clamp(start, 0, slides.length - 1);
  const { style, cls } = E.spaceStyle();
  const el = document.createElement('div');
  el.className = `esp-present ${cls}`;
  el.setAttribute('style', style);
  document.body.appendChild(el);
  document.body.classList.add('presenting');
  const shareLink = (s.sharing?.links || []).find(l => !l.disabled && !l.invite && !l.asOwner);
  const joinUrl = s.sharing?.visibility !== 'private' && shareLink ? E.shareUrl(shareLink) : '';
  const draw = () => {
    const sl = slides[i];
    let inner = '';
    if (sl.type === 'title') inner = `<div class="pr-title"><div class="pr-icon">${esc(s.icon)}</div><h1>${esc(s.title)}</h1>${s.description ? `<p>${esc(s.description)}</p>` : ''}<span>${plural(slides.filter(x => x.type === 'post').length, 'publication')}</span>${joinUrl ? `<div class="pr-join">${E.qrSVG(joinUrl, 150)}<span>Participez : scannez le QR code</span></div>` : ''}</div>`;
    else if (sl.type === 'section') inner = `<div class="pr-title"><h1>${esc(sl.section.title)}</h1><span>${plural(sl.count, 'publication')}</span></div>`;
    else {
      const p = s.posts.find(x => x.id === sl.id);
      if (!p) { inner = '<div class="pr-title"><h1>Publication supprimée</h1></div>'; }
      else {
        const media = (p.attachments || []).find(a => ['image', 'drawing', 'svg', 'video', 'embed'].includes(a.kind));
        const mediaHTML = !media ? '' : media.kind === 'video' ? `<video src="${attr(E.mediaUrl(media.file))}" controls playsinline></video>` : media.kind === 'embed' ? `<iframe src="${attr(media.embed)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>` : `<img src="${attr(E.mediaUrl(media.file))}" alt="">`;
        inner = `<div class="pr-post ${mediaHTML ? 'has-media' : ''}" style="${p.color ? `--pc:${p.color}` : ''}">${mediaHTML ? `<div class="pr-media">${mediaHTML}</div>` : ''}<div class="pr-text">${p.title ? `<h1>${esc(p.title)}</h1>` : ''}${p.body ? `<div class="md">${MD.post(p.body)}</div>` : ''}${E.pollHTML(p)}${E.fieldsHTML(p, { full: true })}${s.settings.showAuthor ? `<div class="pr-author">${avatar(p.author?.name, p.author?.id, 28)}${esc(p.author?.name || '')}</div>` : ''}</div></div>`;
      }
    }
    el.innerHTML = `<div class="pr-stage">${inner}</div><div class="pr-bar"><button data-pr="prev" ${i ? '' : 'disabled'}>${I.chevL}</button><span>${i + 1} / ${slides.length}</span><button data-pr="next" ${i < slides.length - 1 ? '' : 'disabled'}>${I.chevR}</button>${joinUrl ? `<button data-pr="qr" title="QR code (Q)">${I.qr}</button>` : ''}<button data-pr="full" title="Plein écran (F)">${I.fullscreen}</button><button data-pr="close" title="Quitter (Échap)">${I.close}</button></div><div class="pr-progress"><i style="width:${(i + 1) / slides.length * 100}%"></i></div>`;
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); el.remove(); document.body.classList.remove('presenting'); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); E.presentEl = null; };
  const onKey = e => {
    if (UI.stack.length) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); if (i < slides.length - 1) { i++; draw(); } }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); if (i) { i--; draw(); } }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Home') { i = 0; draw(); } else if (e.key === 'End') { i = slides.length - 1; draw(); }
    else if (e.key.toLowerCase() === 'q' && joinUrl) E.bigQR(joinUrl);
    else if (e.key.toLowerCase() === 'f') el.requestFullscreen?.().catch(() => {});
  };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-pr]');
    if (b) { const a = b.dataset.pr; if (a === 'prev' && i) i--; else if (a === 'next' && i < slides.length - 1) i++; else if (a === 'close') return close(); else if (a === 'qr') return E.bigQR(joinUrl); else if (a === 'full') return el.requestFullscreen?.().catch(() => {}); draw(); return; }
    if (e.target.closest('a, button, video, iframe, .poll')) return;
    if (e.clientX > innerWidth / 2) { if (i < slides.length - 1) { i++; draw(); } } else if (i) { i--; draw(); }
  });
  E.presentEl = el;
  draw();
};

// ======================= Impression, PDF et image =======================
E.printSpace = async function (format = 'pdf') {
  if (!E.space) return;
  const s = E.space;
  const view = document.createElement('div');
  view.className = 'print-view';
  const { style, cls } = E.spaceStyle();
  if (s.kind === 'board') {
    view.innerHTML = `<div class="pv ${cls}" style="${attr(style)}"><header><span class="pv-icon">${esc(s.icon)}</span><div><h1>${esc(s.title)}</h1>${s.description ? `<p>${esc(s.description)}</p>` : ''}<small>${esc(s.owner?.name || '')} · ${esc(localDate(new Date(), { dateStyle: 'long' }))} · ${plural(s.posts.length, 'publication')}</small></div></header>
      ${E.grouped(E.visiblePosts()).map(g => `${g.section && E.space.settings.sections ? `<h2 class="pv-sec">${esc(g.section.title)}</h2>` : ''}<div class="pv-grid">${g.posts.map(p => E.postHTML(p)).join('')}</div>`).join('')}</div>`;
  } else view.innerHTML = E.Canvas?.printHTML?.() || '';
  document.body.appendChild(view);
  document.body.classList.add('printing');
  await Promise.all([...view.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 4000); })));
  await new Promise(r => setTimeout(r, 120));
  try {
    if (window.call && E.mode === 'app') { const saved = await call(format === 'png' ? 'exportImage' : 'exportPDF', { suggested: `${s.title.replace(/[/:\\]/g, '-')}.${format}` }); if (typeof saved === 'string') toast(`Enregistré : ${saved.split('/').pop()}`); }
    else window.print();
  } catch (err) { toast(err.message, 'error'); }
  finally { document.body.classList.remove('printing'); view.remove(); }
};

// ======================= Invités : nom =======================
E.changeName = async function () {
  const name = await UI.prompt('Votre nom', E.name || '', { placeholder: 'Prénom ou pseudo', ok: 'Enregistrer', message: 'Il apparaît sur vos publications et commentaires.' });
  if (!name || !name.trim()) return;
  E.name = name.trim().slice(0, 80);
  try { localStorage.setItem('ca-name', E.name); } catch {}
  try { const { me } = await E.api('POST', `/spaces/${E.space.id}/join`, { name: E.name, group: E.group || undefined }); E.me = me; E.renderSpace(); } catch (err) { toast(err.message, 'error'); }
};

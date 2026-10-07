/* Cours Albert 3.1 — dossiers de notes : on ajoute un dossier (du vault ou d’ailleurs), on écrit, c’est enregistré. */
'use strict';

const Notes = (() => {
  const N = { key: '', data: null, loading: false, error: '' };
  const folders = () => E.state?.notes || [];
  const route = () => { const p = S.param || ''; const i = p.indexOf('/'); return { id: i < 0 ? p : p.slice(0, i), sub: i < 0 ? '' : p.slice(i + 1).replace(/^\/+|\/+$/g, '') }; };
  const enc = s => s.split('/').map(encodeURIComponent).join('/');
  const when = ms => { try { return relative(new Date(ms).toISOString()); } catch { return ''; } };

  async function load(force = false) {
    const { id, sub } = route();
    const key = `${id}|${sub}`;
    if (!id || (!force && N.key === key && (N.data || N.loading))) return;
    N.key = key; N.loading = true; N.error = '';
    try { N.data = await E.api('GET', `/notes/list?folder=${encodeURIComponent(id)}&sub=${encodeURIComponent(sub)}`); }
    catch (err) { N.data = null; N.error = err.message; }
    N.loading = false;
    if (S.route === 'notes' && N.key === key) renderMain(false);
  }
  function overview() {
    const list = folders();
    return `${pageHead('', 'Notes', 'Des dossiers où l’on écrit, tout simplement : chaque note est un fichier Markdown, lisible dans Obsidian.', `<button class="btn primary" data-nf="add">${I.folderPlus}Ajouter un dossier de notes</button>`)}
      ${list.length ? `<div class="nf-folders">${list.map(f => `<button class="nf-folder" data-act="go" data-to="notes/${attr(f.id)}">${I.folder}<span><b>${esc(f.name)}</b><small>${esc(f.path)}</small></span></button>`).join('')}</div>`
        : `<section class="card nf-empty-card"><div class="as-setup-icon">${I.edit}</div><h2>Aucun dossier de notes</h2><p class="muted">Créez un dossier (dans votre vault s’il est configuré) ou choisissez un dossier existant du Mac. Les notes Wispr Flow peuvent aussi y arriver.</p><button class="btn primary" data-nf="add">${I.folderPlus}Ajouter un dossier</button></section>`}`;
  }
  function view() {
    const { id, sub } = route();
    if (!id) return overview();
    const folder = folders().find(f => f.id === id);
    if (!folder) return `${pageHead('', 'Notes', '')}<div class="callout">${I.alert}<div>Ce dossier de notes n’est plus dans la liste. <button class="btn sm" data-act="go" data-to="notes">Voir les dossiers</button></div></div>`;
    if (N.key !== `${id}|${sub}` || (!N.data && !N.error)) setTimeout(() => load(), 0);
    const d = N.key === `${id}|${sub}` ? N.data : null;
    const parts = sub ? sub.split('/') : [];
    const crumbs = [`<button data-act="go" data-to="notes/${attr(id)}">${esc(folder.name)}</button>`, ...parts.map((p, i) => `<button data-act="go" data-to="notes/${attr(id)}/${attr(enc(parts.slice(0, i + 1).join('/')))}">${esc(p)}</button>`)].join(`<span>${I.chevR}</span>`);
    const actions = `<button class="btn" data-nf="mkdir">${I.folderPlus}Dossier</button><button class="btn primary" data-nf="new">${I.plus}Nouvelle note</button><button class="btn icon" data-nf="more" title="Plus">${I.more}</button>`;
    let body;
    if (N.error && N.key === `${id}|${sub}`) body = `<div class="callout">${I.alert}<div>${esc(N.error)}</div></div>`;
    else if (!d) body = '<p class="muted">Chargement…</p>';
    else {
      const notes = d.files.filter(f => f.note), others = d.files.filter(f => !f.note);
      body = `<div class="nf-grid">
        ${d.dirs.map(x => `<button class="nf-dir" data-act="go" data-to="notes/${attr(id)}/${attr(enc([...parts, x.name].join('/')))}">${I.folder}<span><b>${esc(x.name)}</b><small>${plural(x.count, 'élément')}</small></span></button>`).join('')}
        ${notes.map(f => `<button class="nf-note" data-nf="open" data-path="${attr(f.path)}"><b>${esc(f.title || f.name)}</b>${f.excerpt ? `<p>${esc(f.excerpt)}</p>` : '<p class="muted">Note vide</p>'}<small>${esc(when(f.mtime))}</small></button>`).join('')}
        ${others.map(f => `<button class="nf-file" data-thumb-box data-nf="open" data-path="${attr(f.path)}"><span class="thumb-frame"><img data-thumb src="${attr(E.pathThumbUrl(f.path, 240))}" alt="" loading="lazy" draggable="false"></span><span class="nf-file-line">${E.fileBadge(f.name)}<span><b>${esc(f.name)}</b><small>${esc(sizeLabel(f.size))} · ${esc(when(f.mtime))}</small></span></span></button>`).join('')}
      </div>${!d.dirs.length && !d.files.length ? '<p class="muted nf-none">Dossier vide : écrivez la première note ci-dessus.</p>' : ''}`;
    }
    return `${pageHead('', folder.name, `<span class="nf-crumbs">${crumbs}</span>`, actions)}
      <form class="nf-quick" data-nf="quick"><textarea data-nf-quick rows="2" placeholder="Écrire une note… La première ligne devient le titre. (⌘⏎ pour enregistrer)"></textarea><div class="nf-quick-row"><span class="muted">Dictée : utilisez Wispr Flow ou la dictée du Mac directement ici.</span><button class="btn primary sm" type="submit">${I.check}Enregistrer</button></div></form>
      ${body}`;
  }
  function mounted(main) {
    const ta = main.querySelector('[data-nf-quick]');
    if (!ta) return;
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(360, Math.max(56, ta.scrollHeight))}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); quick(ta.value); } });
  }
  async function quick(text) {
    const value = String(text || '').trim();
    if (!value) return;
    const { id, sub } = route();
    const [first, ...rest] = value.split('\n');
    const title = first.replace(/^#+\s*/, '').trim().slice(0, 100) || 'Note';
    try {
      await E.api('POST', '/notes/new', { folder: id, sub, title, text: `# ${title}\n\n${rest.join('\n').trim()}\n` });
      toast('Note enregistrée');
      N.key = ''; await load(true);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function create() {
    const { id, sub } = route();
    const title = await UI.prompt('Nouvelle note', '', { placeholder: 'Titre de la note', ok: 'Créer et écrire' });
    if (title == null) return;
    try {
      const r = await E.api('POST', '/notes/new', { folder: id, sub, title });
      TextViewer.open(r.path, { edit: true, onClose: () => { N.key = ''; load(true); } });
      N.key = ''; load(true);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function mkdir() {
    const { id, sub } = route();
    const name = await UI.prompt('Nouveau dossier', '', { placeholder: 'Nom du dossier', ok: 'Créer' });
    if (!name) return;
    try { await E.api('POST', '/notes/mkdir', { folder: id, sub, name }); N.key = ''; load(true); }
    catch (err) { toast(err.message, 'error'); }
  }
  function open(path) {
    if (TextViewer.isText({ path })) return TextViewer.open(path, { onClose: () => { N.key = ''; load(true); } });
    if (window.call) call('open', { path }).catch(err => toast(err.message, 'error'));
    else window.open(E.rawUrl(path), '_blank');
  }
  async function addFolder() {
    const vault = E.state?.vault;
    const box = UI.modal(`<form class="dlg" data-nfa="form">
        <h2>Ajouter un dossier de notes</h2>
        <p>${vault ? 'Un nouveau dossier est créé à la racine de votre vault Obsidian.' : 'Un nouveau dossier est créé dans le dossier de Cours Albert.'} Vous pouvez aussi choisir un dossier qui existe déjà.</p>
        <label class="lbl">Nom du nouveau dossier<input class="input" data-nfa="name" placeholder="Ex. 05 Notes perso" autofocus></label>
        <div class="dlg-actions"><button type="button" class="btn" data-nfa="pick">${I.folder}Dossier existant…</button><span style="flex:1"></span><button type="button" class="btn" data-nfa="cancel">Annuler</button><button class="btn primary" type="submit">Créer</button></div>
      </form>`, { cls: 'small', label: 'Ajouter un dossier de notes' });
    const done = async body => {
      try {
        const r = await E.api('POST', '/notes/folders', body);
        if (E.state) E.state.notes = r.folders;
        UI.close(box); renderSidebar(); go(`notes/${r.folder.id}`);
      } catch (err) { toast(err.message, 'error'); }
    };
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-nfa]');
      if (!b) return;
      if (b.dataset.nfa === 'cancel') return UI.close(box);
      if (b.dataset.nfa === 'pick') {
        if (!window.call) return toast('Disponible dans l’app sur le Mac.');
        try { const p = await call('chooseFolder', { purpose: 'notes' }); const dir = Array.isArray(p) ? p[0] : p; if (dir) done({ path: dir }); }
        catch (err) { toast(err.message, 'error'); }
      }
    });
    box.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const name = box.querySelector('[data-nfa="name"]').value.trim(); if (!name) return toast('Donnez un nom au dossier.'); done({ name }); });
  }
  function moreMenu(b) {
    const { id } = route();
    const f = folders().find(x => x.id === id);
    if (!f) return;
    const items = [];
    if (window.call) items.push({ label: 'Afficher dans le Finder', icon: 'folder', act: () => call('reveal', { path: f.path }) });
    if (window.call && E.state?.vault && f.path.startsWith(E.state.vault)) items.push({ label: 'Ouvrir dans Obsidian', icon: 'obsidian', act: () => call('openObsidian', { path: f.path }) });
    if (E.state?.ai?.enabled) items.push({ label: 'Ranger avec l’assistant', icon: 'sparkles', act: () => { Assistant.state.context = `L’étudiant regardait le dossier de notes « ${f.name} » (${f.path}).`; Assistant.state.draft = 'Range ce dossier de notes : '; go('assistant'); } });
    items.push({ sep: true }, { label: 'Retirer de la liste', icon: 'eyeOff', act: async () => {
      if (!await UI.confirm(`Retirer « ${f.name} » de la liste ? Le dossier et ses notes restent sur le Mac.`, { ok: 'Retirer' })) return;
      try { const r = await E.api('POST', '/notes/folders/remove', { id }); if (E.state) E.state.notes = r.folders; renderSidebar(); go('notes'); } catch (err) { toast(err.message, 'error'); }
    } });
    UI.menu(b, items, { align: 'right' });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-nf], [data-act="notes-add"]');
    if (!b) return;
    if (b.dataset.act === 'notes-add') { e.preventDefault(); return addFolder(); }
    if (S.route !== 'notes' && b.dataset.nf !== 'add') return;
    const a = b.dataset.nf;
    if (a === 'quick') return;
    e.preventDefault();
    if (a === 'add') return addFolder();
    if (a === 'new') return create();
    if (a === 'mkdir') return mkdir();
    if (a === 'open') return open(b.dataset.path);
    if (a === 'more') return moreMenu(b);
  });
  document.addEventListener('submit', e => { if (e.target.matches?.('[data-nf="quick"]')) { e.preventDefault(); quick(e.target.querySelector('[data-nf-quick]').value); } });
  return { view, mounted, load, addFolder };
})();
window.Notes = Notes;

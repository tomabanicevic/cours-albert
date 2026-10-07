/* Cours Albert 3 — espaces : client du serveur local, temps réel et éléments communs (app et invités). */
'use strict';

const E = {
  mode: 'app', base: '', token: '', key: '', uid: '', name: '', group: '', origin: randomId(10), lanPort: null,
  state: null, space: null, me: null, draft: null, people: [], presence: [], lan: null,
  es: null, ownerES: null, mounted: null, available: false, error: '',
  ui: { search: '', section: '', author: '', status: '', sort: null, layout: null, zoom: 1, cardIndex: 0 },
  hooks: { space: [], post: [], removed: [], meta: [], presence: [], cards: [], objects: [] },
};

// ======================= Connexion au serveur =======================
E.headers = function (json = true) {
  const h = { 'X-Origin': E.origin };
  if (json) h['Content-Type'] = 'application/json';
  if (E.token) h['X-Token'] = E.token;
  if (E.key) { h['X-Key'] = E.key; h['X-User'] = E.uid; h['X-Name'] = encodeURIComponent(E.name || ''); if (E.group) h['X-Group'] = E.group; }
  return h;
};
E.authQuery = function () {
  if (E.token) return `t=${encodeURIComponent(E.token)}`;
  return `k=${encodeURIComponent(E.key)}&u=${encodeURIComponent(E.uid)}&n=${encodeURIComponent(E.name || '')}${E.group ? `&g=${encodeURIComponent(E.group)}` : ''}`;
};
E.api = async function (method, path, body, { raw = false, signal } = {}) {
  let res;
  try {
    res = await fetch(`${E.base}/api${path}`, { method, headers: E.headers(body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)), body: body === undefined ? undefined : body instanceof Blob || body instanceof ArrayBuffer ? body : JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error(E.mode === 'guest' ? 'Connexion perdue avec l’espace. Vérifiez que vous êtes sur le même réseau Wi-Fi.' : 'Le serveur des espaces ne répond pas. Relancez Cours Albert.');
  }
  if (raw) { if (!res.ok) throw new Error(`Erreur ${res.status}`); return res; }
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) { const err = new Error(data.error || `Erreur ${res.status}`); err.status = res.status; throw err; }
  return data;
};
E.mediaUrl = (file, spaceId = E.space?.id, extra = '') => file ? `${E.base}/media/${encodeURIComponent(spaceId)}/${encodeURIComponent(file)}?${E.authQuery()}${extra}` : '';
E.localUrl = (attId, spaceId = E.space?.id, extra = '') => `${E.base}/local/${encodeURIComponent(spaceId)}/${encodeURIComponent(attId)}?${E.authQuery()}${extra}`;
E.rawUrl = path => `${E.base}/raw?path=${encodeURIComponent(path)}&${E.authQuery()}`;
/** Aperçu miniature (Quick Look) d’une pièce jointe ou d’un objet fichier ; d’un fichier du Mac pour le propriétaire. */
E.thumbUrl = (id, spaceId = E.space?.id, size = 480) => `${E.base}/thumb/${encodeURIComponent(spaceId)}/${encodeURIComponent(id)}?${E.authQuery()}&s=${size}`;
E.pathThumbUrl = (path, size = 480) => `${E.base}/thumb?path=${encodeURIComponent(path)}&${E.authQuery()}&s=${size}`;
// Pas d’aperçu possible (fichier sans Quick Look, invité sur un autre appareil…) : on garde la carte de fichier simple.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.hasAttribute('data-thumb')) return;
  const holder = img.closest('[data-thumb-box]');
  img.closest('.thumb-frame')?.remove();
  holder?.classList.add('no-thumb');
}, true);
/** Envoie un fichier dans l’espace courant, avec progression. Renvoie la pièce jointe enregistrée. */
E.upload = function (file, { name, onProgress, spaceId = E.space?.id, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${E.base}/api/spaces/${encodeURIComponent(spaceId)}/media?name=${encodeURIComponent(name || file.name || 'fichier')}`);
    const h = E.headers(false);
    for (const [k, v] of Object.entries(h)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => { let data = {}; try { data = JSON.parse(xhr.responseText); } catch {} if (xhr.status >= 200 && xhr.status < 300) resolve(data.attachment); else reject(new Error(data.error || `Envoi impossible (${xhr.status})`)); };
    xhr.onerror = () => reject(new Error('Envoi interrompu : vérifiez la connexion.'));
    xhr.onabort = () => reject(Object.assign(new Error('Envoi annulé'), { name: 'AbortError' }));
    if (signal) signal.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
};

// ======================= Temps réel =======================
E.connect = function (spaceId) {
  E.disconnect();
  let first = true;
  const es = new EventSource(`${E.base}/api/spaces/${encodeURIComponent(spaceId)}/events?${E.authQuery()}`);
  E.es = es;
  const on = (type, fn) => es.addEventListener(type, ev => { if (E.es !== es) return; let d = {}; try { d = JSON.parse(ev.data); } catch { return; } try { fn(d); } catch (e) { console.error(e); } });
  on('hello', d => {
    E.setOnline(true);
    if (d.me) E.me = d.me;
    if (!first) E.reload(); // reconnexion : on recharge pour ne rien manquer
    first = false;
  });
  on('meta', d => {
    if (!E.space || d.origin === E.origin) { if (d.me) E.me = d.me; return; }
    const keep = { posts: E.space.posts, cards: E.space.cards, pending: E.space.pending };
    E.space = Object.assign({}, d.space, keep);
    if (d.me) E.me = d.me;
    E.emit('meta');
  });
  on('post', d => {
    if (!E.space) return;
    if (typeof d.pending === 'number') E.space.pending = d.pending;
    if (d.origin === E.origin) return;
    E.upsertPost(d.post, true);
  });
  on('post-removed', d => {
    if (!E.space) return;
    if (typeof d.pending === 'number') E.space.pending = d.pending;
    if (d.origin === E.origin) return;
    E.removePost(d.id, true);
  });
  on('card', d => { if (!E.space || d.origin === E.origin) return; E.upsertCard(d.card, d.index); });
  on('card-removed', d => { if (!E.space || d.origin === E.origin) return; E.space.cards = E.space.cards.filter(c => c.id !== d.id); E.emit('cards'); });
  on('cards-order', d => { if (!E.space || d.origin === E.origin) return; const by = new Map(E.space.cards.map(c => [c.id, c])); E.space.cards = d.ids.map(id => by.get(id)).filter(Boolean); E.emit('cards'); });
  on('objects', d => {
    if (!E.space || d.origin === E.origin) return;
    let card = E.space.cards.find(c => c.id === d.cardId);
    if (!card && d.cardId === 'ink') { card = { id: 'ink', title: 'Calque', objects: [] }; E.space.cards.push(card); }
    if (!card) return;
    for (const o of d.objects || []) { const i = card.objects.findIndex(x => x.id === o.id); if (i >= 0) card.objects[i] = o; else card.objects.push(o); }
    if (d.removed?.length) card.objects = card.objects.filter(o => !d.removed.includes(o.id));
    E.emit('objects', d);
  });
  on('presence', d => { E.presence = d.people || []; E.emit('presence'); });
  on('revoked', () => { E.disconnect(); E.emit('revoked'); });
  on('removed', () => { E.disconnect(); E.emit('removed'); });
  es.onerror = () => { if (E.es === es) E.setOnline(false); };
};
E.disconnect = function () { if (E.es) { E.es.close(); E.es = null; } E.presence = []; };
E.online = true;
E.setOnline = function (v) {
  clearTimeout(E.offlineTimer);
  if (!v) { E.offlineTimer = setTimeout(() => { E.online = false; document.body.classList.add('esp-offline'); E.emit('online'); }, 3000); return; }
  if (!E.online) { E.online = true; document.body.classList.remove('esp-offline'); E.emit('online'); }
};
E.on = function (type, fn) { (E.hooks[type] ||= []).push(fn); return () => { E.hooks[type] = E.hooks[type].filter(f => f !== fn); }; };
E.emit = function (type, data) { for (const fn of [...(E.hooks[type] || [])]) { try { fn(data); } catch (e) { console.error(e); } } };

// ======================= Données de l’espace courant =======================
E.upsertPost = function (post, remote = false) {
  if (!E.space || !post) return;
  const i = E.space.posts.findIndex(p => p.id === post.id);
  const before = i >= 0 ? E.space.posts[i] : null;
  if (i >= 0) E.space.posts[i] = post; else E.space.posts.push(post);
  E.emit('post', { post, before, remote });
};
E.removePost = function (id, remote = false) {
  if (!E.space) return;
  const before = E.space.posts.find(p => p.id === id);
  E.space.posts = E.space.posts.filter(p => p.id !== id);
  E.space.connections = (E.space.connections || []).filter(c => c.from !== id && c.to !== id);
  if (before) E.emit('removed', { id, before, remote });
};
E.upsertCard = function (card, index) {
  const i = E.space.cards.findIndex(c => c.id === card.id);
  if (i >= 0) E.space.cards[i] = card;
  else if (typeof index === 'number') E.space.cards.splice(index, 0, card);
  else E.space.cards.push(card);
  E.emit('cards');
};
E.reload = async function () {
  if (!E.space) return;
  try {
    const data = await E.api('GET', `/spaces/${E.space.id}`);
    E.space = data.space; E.me = data.me; E.people = data.people || E.people;
    E.emit('space');
  } catch (e) { if (e.status === 403 || e.status === 404) E.emit('revoked'); }
};
E.can = right => !!E.me?.rights?.[right];
E.section = id => E.space?.sections.find(s => s.id === id) || null;
E.field = id => E.space?.fields.find(f => f.id === id) || null;

// ======================= Présentation : fonds, polices, dispositions =======================
E.GRADIENTS = {
  aurore: 'linear-gradient(135deg,#c7d2fe 0%,#fbcfe8 52%,#fde68a 100%)',
  ocean: 'linear-gradient(135deg,#a5f3fc 0%,#93c5fd 50%,#c4b5fd 100%)',
  foret: 'linear-gradient(135deg,#bbf7d0 0%,#99f6e4 50%,#bae6fd 100%)',
  peche: 'linear-gradient(135deg,#fed7aa 0%,#fecaca 50%,#fbcfe8 100%)',
  lavande: 'linear-gradient(135deg,#e9d5ff 0%,#c7d2fe 100%)',
  menthe: 'linear-gradient(160deg,#d1fae5 0%,#e0f2fe 100%)',
  sable: 'linear-gradient(160deg,#fef3c7 0%,#fde68a 40%,#fed7aa 100%)',
  nuit: 'linear-gradient(135deg,#1e1b4b 0%,#312e81 50%,#4c1d95 100%)',
  minuit: 'linear-gradient(160deg,#0f172a 0%,#1e293b 100%)',
  coucher: 'linear-gradient(135deg,#f97316 0%,#db2777 55%,#7c3aed 100%)',
  albert: 'linear-gradient(135deg,#0b2045 0%,#1256ba 100%)',
  craie: 'linear-gradient(160deg,#1f3a2e 0%,#2d4b3c 100%)',
};
E.COLORS = ['#f8fafc', '#fef9c3', '#fde68a', '#fecaca', '#fbcfe8', '#e9d5ff', '#c7d2fe', '#bfdbfe', '#a5f3fc', '#bbf7d0', '#d9f99d', '#e7e5e4', '#1f2937', '#312e81', '#14532d', '#7f1d1d'];
E.CARD_COLORS = [null, '#fef3c7', '#fee2e2', '#fce7f3', '#ede9fe', '#dbeafe', '#cffafe', '#dcfce7', '#ecfccb', '#f5f5f4', '#1f2937'];
E.PATTERNS = ['points', 'grille', 'lignes', 'papier'];
E.isDark = hex => { const m = /^#([0-9a-f]{6})/i.exec(hex || ''); if (!m) return false; const n = parseInt(m[1], 16); return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) < 140; };
E.wallpaper = function (theme, spaceId = E.space?.id) {
  const w = theme?.wallpaper || 'gradient:aurore';
  const [type, value, extra] = w.split(':');
  if (type === 'color') return { css: `background:${value}`, dark: E.isDark(value) };
  if (type === 'gradient') return { css: `background:${E.GRADIENTS[value] || E.GRADIENTS.aurore}`, dark: ['nuit', 'minuit', 'coucher', 'albert', 'craie'].includes(value) };
  if (type === 'pattern') {
    const base = extra || '#f8fafc';
    const ink = E.isDark(base) ? 'rgba(255,255,255,.14)' : 'rgba(15,23,42,.12)';
    const img = { points: `radial-gradient(${ink} 1.2px, transparent 1.3px) 0 0/22px 22px`, grille: `linear-gradient(${ink} 1px, transparent 1px) 0 0/26px 26px, linear-gradient(90deg, ${ink} 1px, transparent 1px) 0 0/26px 26px`, lignes: `linear-gradient(${ink} 1px, transparent 1px) 0 0/100% 28px`, papier: `linear-gradient(90deg, transparent 54px, rgba(239,68,68,.35) 54px, rgba(239,68,68,.35) 56px, transparent 56px) 0 0/100% 100%, linear-gradient(${ink} 1px, transparent 1px) 0 0/100% 28px` }[value] || '';
    return { css: `background:${img ? img + ',' : ''}${base}`, dark: E.isDark(base) };
  }
  if (type === 'image') return { css: `background:#1f2937 url("${E.mediaUrl(value, spaceId)}") center/cover fixed`, dark: true, image: true };
  return { css: `background:${E.GRADIENTS.aurore}`, dark: false };
};
E.FONTS = { system: 'Système', serif: 'Élégante', mono: 'Code', rounded: 'Arrondie', hand: 'Manuscrite' };
E.LAYOUTS = [
  { id: 'wall', label: 'Mur', icon: 'wall', desc: 'Cartes épinglées en briques, pour les idées et les images.' },
  { id: 'columns', label: 'Colonnes', icon: 'columns', desc: 'Une colonne par section, à la façon d’un Kanban.' },
  { id: 'grid', label: 'Grille', icon: 'grid', desc: 'Cartes alignées en rangées régulières.' },
  { id: 'stream', label: 'Flux', icon: 'stream', desc: 'Les publications les unes sous les autres, comme un blog.' },
  { id: 'table', label: 'Tableau', icon: 'table', desc: 'Une ligne par publication, une colonne par information.' },
  { id: 'timeline', label: 'Chronologie', icon: 'timeline', desc: 'Les publications sur une frise horizontale.' },
  { id: 'map', label: 'Carte', icon: 'map', desc: 'Chaque publication épinglée à un lieu du monde.' },
  { id: 'free', label: 'Libre', icon: 'free', desc: 'Déplacez et reliez les cartes où vous voulez.' },
];
E.REACTIONS = { none: 'Aucune', like: 'J’aime', vote: 'Votes pour / contre', stars: 'Étoiles (1 à 5)', grade: 'Note sur 20', emoji: 'Émojis' };
E.ROLE_LABELS = { viewer: 'Lecture seule', commenter: 'Commenter', submitter: 'Déposer (formulaire)', contributor: 'Publier', moderator: 'Modérer', admin: 'Administrer', owner: 'Propriétaire' };
E.ROLE_HELP = {
  viewer: 'Peut consulter l’espace.', commenter: 'Peut consulter, commenter et réagir.', submitter: 'Peut seulement envoyer des publications, sans voir celles des autres.',
  contributor: 'Peut publier, commenter et réagir.', moderator: 'Peut aussi valider, modifier et supprimer les publications des autres.', admin: 'Presque tous les droits du propriétaire (réglages, structure).',
};
E.FIELD_TYPES = { text: 'Texte', number: 'Nombre', date: 'Date', email: 'Adresse e-mail', phone: 'Téléphone', url: 'Lien (URL)', select: 'Choix unique', multiselect: 'Choix multiple', user: 'Personne responsable', button: 'Bouton (lien)', vote: 'Vote (+1)', score: 'Score', rating: 'Étoiles' };
E.FIELD_ICONS = { text: 'text', number: 'hash', date: 'calendar', email: 'at', phone: 'phone', url: 'link', select: 'chevD', multiselect: 'list', user: 'user', button: 'external', vote: 'up', score: 'hash', rating: 'star' };
E.kindLabel = k => k === 'canvas' ? 'Espace libre' : 'Tableau';
// Type d’un fichier d’après son extension : libellé court et famille de couleur (badges colorés des cartes de fichiers).
E.FILE_TYPES = [
  [/^pdf$/, 'pdf'], [/^(docx?|odt|rtf|pages)$/, 'doc'], [/^(xlsx?|xlsm|ods|numbers|csv|tsv)$/, 'xls'], [/^(pptx?|odp|key)$/, 'ppt'],
  [/^(md|markdown|txt|text)$/, 'txt'], [/^(png|jpe?g|gif|webp|heic|heif|svg|tiff?|bmp)$/, 'img'], [/^(mp4|mov|m4v|webm|avi|mkv)$/, 'vid'],
  [/^(mp3|m4a|wav|aac|flac|ogg)$/, 'aud'], [/^(zip|rar|7z|tar|gz|tgz)$/, 'zip'], [/^(py|ipynb|js|mjs|ts|json|html?|css|r|sql|java|c|cpp|h|swift|sh|tex)$/, 'code'],
];
E.fileType = function (name = '') {
  const base = String(name || '').split('/').pop();
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase().slice(0, 8) : '';
  const fam = (E.FILE_TYPES.find(([re]) => re.test(ext)) || [null, 'other'])[1];
  return { ext, fam, label: ext ? (ext === 'markdown' ? 'MD' : ext.toUpperCase().slice(0, 4)) : 'FICH' };
};
E.fileBadge = name => { const t = E.fileType(name); return `<i class="ft-badge ft-${t.fam}">${esc(t.label)}</i>`; };

E.spaceStyle = function (space = E.space) {
  const wp = E.wallpaper(space.theme, space.id);
  return { style: `${wp.css};--accent:${space.theme.accent || '#4f46e5'}`, cls: `${wp.dark ? 'wp-dark' : 'wp-light'} font-${space.theme.font || 'system'} cards-${space.theme.cards || 'light'} size-${space.theme.size || 'm'}` };
};

// ======================= Lecture des fichiers déposés =======================
/** Fichiers d’un événement de dépôt ou de collage (images collées incluses). */
E.filesFrom = function (dt) {
  const out = [];
  if (!dt) return out;
  if (dt.files && dt.files.length) for (const f of dt.files) out.push(f);
  else if (dt.items) for (const it of dt.items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) out.push(f); }
  return out;
};
E.urlFrom = function (dt) {
  const text = dt?.getData?.('text/uri-list') || dt?.getData?.('text/plain') || '';
  const m = text.trim().match(/^https?:\/\/\S+$/i);
  return m ? m[0] : '';
};

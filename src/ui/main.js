/* Cours Albert 2 — synchronisation, réglages, recherche, événements et démarrage */
'use strict';

// ======================= Synchronisation =======================
function viewSync() {
  const st = syncState();
  const sync = (S.data && S.data.sync) || {};
  const p = S.progress;
  const busy = p && p.running;
  const s = S.settings || {};
  const hero = `<section class="card" style="margin-bottom:16px"><div class="sync-hero">
      <div class="big-dot ${st.cls}">${busy ? I.sync : st.cls === 'error' || st.cls === 'warn' ? I.alert : I.check}</div>
      <div style="flex:1;min-width:0"><h2 style="font-size:18px">${esc(st.title)}</h2>
        <div class="soft">${busy ? esc(p.label || 'Préparation…') + (p.total > 1 ? ` · ${p.current}/${p.total}` : '') : sync.finished ? `Dernier passage le ${esc(fmt(sync.finished, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}` : 'Aucune synchronisation pour le moment.'}</div>
        ${busy ? `<div class="bar" style="margin-top:10px;max-width:420px"><i style="width:${p.pct || 2}%"></i></div>` : ''}
        ${!busy && sync.automatic ? `<div class="muted" style="font-size:12px;margin-top:4px">Vérification automatique chaque heure quand le Mac est allumé.</div>` : ''}</div>
      <div class="head-actions">${busy ? '' : `<button class="btn" data-act="sync" data-mode="full" title="Relit tout le semestre sur Inside et tous les supports">Tout revérifier</button><button class="btn primary" data-act="sync">${I.sync}Synchroniser</button>`}</div>
    </div></section>`;
  const org = sync.organization || {};
  const mirror = sync.mirror;
  const stats = `<div class="stat-grid" style="margin-bottom:16px">
    <div class="card stat"><b>${sync.added ?? 0}</b><span>fichiers ajoutés</span></div>
    <div class="card stat"><b>${sync.updated ?? 0}</b><span>fichiers mis à jour</span></div>
    <div class="card stat"><b>${org.courses ?? D.courses.length}</b><span>cours rangés</span></div>
    <div class="card stat"><b>${org.unclassified ?? (S.data ? S.data.unclassified.length : 0)}</b><span>supports à classer</span></div></div>`;
  const inside = sync.inside || {};
  const insideStatus = inside.connected === false ? '<span class="chip danger">À reconnecter</span>' : inside.offline ? '<span class="chip warn">Hors ligne</span>' : inside.connected ? '<span class="chip ok">Connecté</span>' : '<span class="chip">Non vérifié</span>';
  const drives = (s.driveFolders || []);
  const sources = `<section class="card span-6"><div class="card-head"><h2>Sources</h2></div>
    <div class="source"><div class="ico">${I.globe}</div><div class="grow"><b>Inside Albert</b><span>Planning, examens, présence, supports · ${inside.checked ? 'lu ' + esc(relative(inside.checked)) : 'jamais lu'}</span></div>${insideStatus}<button class="btn sm" data-act="sync" data-mode="login">${inside.connected === false ? 'Se reconnecter' : 'Ouvrir la session'}</button></div>
    <div class="source"><div class="ico">${I.drive}</div><div class="grow"><b>Google Drive</b><span>${drives.length ? esc(drives.map(d => d.split('/').pop()).join(', ')) : 'Aucun dossier choisi'}</span></div>${sync.drive ? '<span class="chip ok">Connecté</span>' : '<span class="chip warn">À vérifier</span>'}</div>
    <div class="source"><div class="ico">${I.sync}</div><div class="grow"><b>Mon Drive / Cours Albert</b><span>${mirror ? `${mirror.uploaded} envoyé(s), ${mirror.downloaded} reçu(s), ${mirror.conflicts} conflit(s)` : 'Échange dans les deux sens non configuré'}</span></div></div>
    <div class="source"><div class="ico">${I.desktop}</div><div class="grow"><b>Bureau</b><span class="path">${esc(s.desktopCourses || '—')}</span></div></div>
  </section>`;
  const errors = sync.errors || [], warnings = sync.warnings || [];
  const problems = `<section class="card span-6"><div class="card-head"><h2>À vérifier</h2>${S.data ? `<button class="btn sm ghost link" data-act="open" data-path="${attr(S.data.library.report)}">Ouvrir le rapport</button>` : ''}</div>
    ${errors.length ? `<ul class="problems selectable">${errors.slice(0, 12).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : '<div class="empty">Aucun problème lors du dernier passage.</div>'}
    ${warnings.length ? `<h3 style="margin-top:12px">Remarques</h3><ul class="problems selectable">${warnings.slice(0, 8).map(e => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</section>`;
  const log = `<section class="card span-12"><div class="card-head"><h2>Journal</h2><button class="btn sm ghost link" data-act="refresh-log">Actualiser</button></div><div class="log">${esc(S.lastLog || 'Le journal apparaît après une synchronisation lancée depuis l’app.')}</div></section>`;
  return pageHead('', 'Synchronisation', 'Inside Albert, Google Drive et le Bureau, rangés par cours.') + alertsHtml(a => a.cls === 'danger') + hero + stats + `<div class="grid">${sources}${problems}${log}</div>`;
}
function onProgress(p) {
  const was = S.progress && S.progress.running;
  S.progress = p;
  if (p && p.running) S.syncing = true;
  renderSidebar();
  if (S.route === 'sync') renderMain(false);
  if (was && p && !p.running) S.syncing = false;
}
function onSyncDone(m) {
  S.syncing = false;
  S.progress = { running: false };
  if (m.data) S.data = m.data;
  if (m.log) S.lastLog = m.log;
  render();
  const r = m.result || {};
  if (m.code === 2) toast('Une synchronisation automatique est déjà en cours. Elle se termine d’elle-même.');
  else if (r.errors && r.errors.length) toast(`Synchronisation terminée · ${plural(r.errors.length, 'point')} à vérifier`, 'error');
  else toast(`Synchronisation terminée${r.added ? ` · ${plural(r.added, 'nouveau fichier', 'nouveaux fichiers')}` : ''}`);
}
async function startSync(mode) {
  if (S.progress && S.progress.running) { go('sync'); return; }
  S.progress = { running: true, pct: 1, label: mode === 'login' ? 'Ouverture de Chrome…' : 'Préparation…', phase: mode === 'login' ? 'login' : 'start' };
  renderSidebar(); if (S.route === 'sync') renderMain(false);
  if (mode === 'login') toast('Une fenêtre Chrome s’ouvre : connectez-vous à Inside Albert, puis laissez-la se fermer.');
  try { await call('sync', { mode: mode || 'normal' }); }
  catch (e) { S.progress = { running: false }; render(); toast(e.message, 'error'); }
}

// ======================= Réglages =======================
// Réglages › IA : fournisseur au choix (Claude, ChatGPT, Gemini, Mistral, DeepSeek, Grok, Groq, OpenRouter, Ollama, autre API compatible OpenAI).
function aiCard(ai, row) {
  if (!ai) return '';
  const providers = ai.providers || [{ id: 'anthropic', label: 'Claude (Anthropic)', short: 'Claude', console: 'console.anthropic.com', keyHint: 'sk-ant-…' }];
  const p = providers.find(x => x.id === (ai.provider || 'anthropic')) || providers[0];
  const claude = p.id === 'anthropic';
  const fixedModels = claude && !ai.freeModel;
  const chip = ai.enabled ? `<span class="chip ok" style="margin-left:auto">Activé · ${esc(ai.providerShort || p.short)}${ai.model ? ` · ${esc(ai.model)}` : ''}</span>` : '<span class="chip" style="margin-left:auto">Désactivé</span>';
  const consoleLink = p.console ? `<a href="#" data-act="url" data-url="https://${attr(p.console)}">${esc(p.console)}</a>` : '';
  const keyText = p.noKey
    ? `<b>Rien ne quitte ce Mac.</b> Ollama fait tourner les modèles sur votre ordinateur, sans clé : installez-le (${consoleLink}), téléchargez un modèle qui sait utiliser des outils (par ex. <code>qwen3</code> ou <code>llama3.1</code>), puis cliquez sur « Liste ».`
    : `<b>Votre clé reste la vôtre.</b> Chaque personne entre sa propre clé ${esc(p.short)}${consoleLink ? ` (créée sur ${consoleLink})` : ''}. Elle est enregistrée uniquement sur ce Mac, dans le dossier de l’app, et n’est jamais incluse dans l’application, le DMG, les espaces partagés ni les sauvegardes. Vous pouvez enregistrer une clé par fournisseur et passer de l’un à l’autre.`;
  const modelControl = fixedModels
    ? `<select class="select" data-ai-model>${(ai.models || []).map(m => `<option value="${attr(m.id)}" ${ai.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>`
    : `<div style="display:flex;gap:6px"><input class="input" data-ai-model list="ai-models-list" value="${attr(ai.model || '')}" placeholder="nom du modèle" style="width:200px" autocomplete="off" spellcheck="false"><datalist id="ai-models-list">${(ai.models || []).map(m => `<option value="${attr(m.id)}"></option>`).join('')}</datalist><button class="btn sm" data-act="ai-models" title="Charger les modèles proposés par l’API">Liste</button></div>`;
  return `<section class="card"><div class="card-head"><h2>IA : assistant et tri <span class="muted" style="font-weight:500">(facultatif)</span></h2>${chip}</div>
      <p class="muted" style="font-size:12.5px;margin:-4px 0 6px">Sert à ranger : l’<b>assistant IA</b> organise vos cours dans le vault, vos dossiers de notes et vos espaces (sans jamais rien supprimer, chaque demande s’annule d’un clic), et le tri propose un cours aux fichiers « À classer » et des sections aux publications. Le tri par règles (TD1 avant TD2…) fonctionne toujours sans IA.</p>
      ${row('Fournisseur', 'Claude est recommandé ; toutes les autres API sont acceptées : ChatGPT, Gemini, Mistral, DeepSeek, Grok, Groq, OpenRouter, Ollama, ou n’importe quelle API compatible OpenAI.', `<select class="select" data-ai-provider>${providers.map(x => `<option value="${attr(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.label)}${x.configured ? ' ✓' : ''}</option>`).join('')}</select>`)}
      <div class="callout" style="margin:6px 0 4px">${I.lock}<div>${keyText}</div></div>
      ${row('Adresse de l’API', p.id === 'custom' ? 'Adresse « compatible OpenAI » (se termine souvent par /v1) : LM Studio, Together, Fireworks, Azure, un serveur de l’école…' : p.id === 'ollama' ? 'Par défaut : Ollama sur ce Mac (http://127.0.0.1:11434/v1).' : `Officielle : ${esc(p.defaultURL)}. Modifiable pour passer par une passerelle ou un proxy compatible${claude ? ' Anthropic (LiteLLM, proxy d’entreprise…)' : ''} ; videz le champ pour revenir à l’adresse officielle.${ai.customURL ? ' <b>Adresse personnalisée active</b> (clé et modèle propres à cette adresse).' : ''}`, `<input class="input" data-ai-url value="${attr(ai.baseURL || '')}" placeholder="${attr(p.defaultURL || 'https://…/v1')}" style="width:240px" autocomplete="off" spellcheck="false">`)}
      ${p.noKey ? '' : row(`Votre clé API ${esc(p.short)}${p.optionalKey || (claude && ai.customURL) ? ' <span class="muted" style="font-weight:400">(si l’API en demande une)</span>' : ''}`, ai.key ? `Enregistrée sur ce Mac : ${esc(ai.key)}` : 'Aucune clé enregistrée sur ce Mac.', `<input class="input" type="password" data-ai-key placeholder="${attr(p.keyHint || 'clé API')}" style="width:200px" autocomplete="off" spellcheck="false">`)}
      ${row('Modèle', fixedModels ? '' : 'L’assistant a besoin d’un modèle qui sait utiliser des outils (« function calling »). « Liste » charge les modèles de votre compte.', modelControl)}
      <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:10px">${ai.key ? `<button class="btn sm ghost" data-act="ai-forget">Effacer la clé</button>` : ''}${ai.configured ? `<button class="btn sm" data-act="ai-toggle" data-on="${ai.enabled ? '0' : '1'}">${ai.enabled ? 'Désactiver' : 'Activer'}</button>` : ''}<button class="btn sm primary" data-act="ai-save">Enregistrer</button></div>
    </section>`;
}

function viewSettings() {
  if (!S.draft) S.draft = JSON.parse(JSON.stringify(S.settings || {}));
  const d = S.draft, n = d.notifications || (d.notifications = {});
  const env = S.env || {};
  const sw = (key, on, obj = 'root') => `<label class="switch"><input type="checkbox" data-setting="${obj}:${key}" ${on ? 'checked' : ''}><span></span></label>`;
  const row = (title, sub, control) => `<div class="set-row"><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ''}</div>${control}</div>`;
  const dirty = JSON.stringify(d) !== JSON.stringify(S.settings || {});
  const st = (typeof E !== 'undefined' && E.state) || null;
  const lan = st && st.lan;
  const ai = st && st.ai;
  const spacesCards = !st ? `<section class="card"><div class="card-head"><h2>Espaces</h2></div><div class="banner warn">${I.alert}<div class="grow">${esc(E.error || 'Le serveur des espaces n’a pas démarré.')}</div></div></section>` : `
    <section class="card"><div class="card-head"><h2>Espaces</h2></div>
      ${row('Votre nom', 'Affiché sur vos publications et dans les espaces partagés.', `<div style="display:flex;gap:6px"><input class="input" data-esp-name value="${attr(st.prefs.ownerName || '')}" placeholder="Ex. Camille" style="width:170px"><button class="btn sm" data-act="esp-name">Enregistrer</button></div>`)}
      ${row('Partage sur le réseau local', lan && lan.enabled ? `Actif · ${lan.addresses && lan.addresses.length ? esc(lan.addresses.map(a => a.address).join(', ')) : 'aucun réseau'} · port ${lan.port}` : 'Permet aux personnes sur le même Wi-Fi d’ouvrir vos espaces partagés (lien ou QR code).', `<label class="switch"><input type="checkbox" data-act="esp-lan" data-on="${lan && lan.enabled ? '0' : '1'}" ${lan && lan.enabled ? 'checked' : ''}><span></span></label>`)}
      ${row('Dossier des espaces', 'Vos tableaux et leurs fichiers, sur ce Mac (sauvegardés par Time Machine).', `<button class="btn sm" data-act="esp-reveal">Afficher</button>`)}
    </section>
    ${aiCard(ai, row)}
    ${typeof Connexions !== 'undefined' ? Connexions.wisprCard() : ''}`;
  return pageHead('', 'Réglages', `Cours Albert ${esc(env.version || '3.3.2')} · vos choix restent sur ce Mac`, `<button class="btn" data-act="settings-reset" ${dirty ? '' : 'disabled'}>Annuler</button><button class="btn primary" data-act="settings-save" ${dirty ? '' : 'disabled'}>Enregistrer</button>`) + `<div class="settings">
    ${spacesCards}
    <div class="settings-sep">${I.folder}Albert School</div>
    <section class="card"><div class="card-head"><h2>Bibliothèque de cours</h2></div>
      ${row('Dossier principal', `<span class="path">${esc(d.vaultCourses || '—')}</span>`, `<button class="btn sm" data-act="choose" data-target="vaultCourses">Choisir…</button>`)}
      ${row('Utiliser mon vault Obsidian', 'Ajoute des pages d’accueil, un tableau de bord et une carte des cours dans le vault.', sw('vaultEnabled', d.vaultEnabled))}
      ${row('Dossier sur le Bureau', `<span class="path">${esc(d.desktopCourses || '—')}</span>`, `<button class="btn sm" data-act="choose" data-target="desktopCourses">Choisir…</button>`)}
      ${row('Année de début du cursus', 'Sert à lire le planning du bon semestre.', `<select class="select" data-setting-select="academicYearStart">${[2024, 2025, 2026, 2027, 2028].map(y => `<option ${+d.academicYearStart === y ? 'selected' : ''}>${y}</option>`).join('')}</select>`)}
    </section>
    <section class="card"><div class="card-head"><h2>Google Drive</h2><button class="btn sm" data-act="choose" data-target="driveFolders" style="margin-left:auto">Ajouter un dossier…</button></div>
      <div class="muted" style="font-size:12.5px">Dossiers de cours visibles dans « Mon Drive » (Google Drive pour ordinateur). L’app échange aussi le dossier « Cours » avec « Mon Drive/Cours Albert », dans les deux sens, sans jamais supprimer.</div>
      <div class="drive-list">${(d.driveFolders || []).map((p, i) => `<div>${I.folder}<span class="path">${esc(p)}</span><button class="btn sm icon ghost" data-act="drive-remove" data-index="${i}" title="Retirer">${I.close}</button></div>`).join('') || '<div><span class="muted">Aucun dossier Drive.</span></div>'}</div>
    </section>
    <section class="card"><div class="card-head"><h2>Automatisation</h2></div>
      ${row('Vérifier automatiquement chaque heure', 'Même quand l’app est fermée, tant que le Mac est allumé.', sw('automatic', d.automatic !== false))}
      ${row('Prochain cours dans la barre des menus', 'Affiche l’heure et la salle du prochain cours en haut de l’écran.', sw('menubar', d.menubar !== false))}
      ${row('Ouvrir à la connexion', 'Lance Cours Albert discrètement dans la barre des menus au démarrage du Mac.', sw('launchAtLogin', !!d.launchAtLogin))}
    </section>
    <section class="card"><div class="card-head"><h2>Notifications</h2>${env.notifications === 'denied' ? '<span class="chip warn" style="margin-left:auto">Refusées dans Réglages Système</span>' : env.notifications === 'authorized' ? '<span class="chip ok" style="margin-left:auto">Autorisées</span>' : `<button class="btn sm" data-act="notif-permission" style="margin-left:auto">${I.bell}Autoriser</button>`}</div>
      ${row('Rappel avant chaque cours', 'Avec la salle, même si l’app est fermée.', `<select class="select" data-setting-select="notifications.classReminder">${[[0, 'Désactivé'], [5, '5 min avant'], [10, '10 min avant'], [15, '15 min avant'], [30, '30 min avant']].map(([v, l]) => `<option value="${v}" ${+(n.classReminder ?? 10) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${row('Rappels d’examen', 'La veille à 19 h et une heure avant.', sw('examReminder', n.examReminder !== false, 'notifications'))}
      ${row('Nouveaux supports', 'Quand un enseignant publie un fichier.', sw('materials', n.materials !== false, 'notifications'))}
      ${row('Examens ajoutés ou déplacés', '', sw('exams', n.exams !== false, 'notifications'))}
      ${row('Absences enregistrées', '', sw('absences', n.absences !== false, 'notifications'))}
      ${row('Changements de salle ou d’horaire', 'Pour les 7 prochains jours.', sw('changes', n.changes !== false, 'notifications'))}
    </section>
    <section class="card"><div class="card-head"><h2>Avancé</h2></div>
      ${row('Réinstaller l’application et l’agent horaire', 'À utiliser après une mise à jour ou un déplacement de l’app.', `<button class="btn sm" data-act="install">Réinstaller</button>`)}
      ${row('Session Inside', 'Ouvre Chrome pour vous reconnecter si la session a expiré.', `<button class="btn sm" data-act="sync" data-mode="login">Se reconnecter</button>`)}
      ${row('Guide de démarrage', '', `<button class="btn sm" data-act="guide">Ouvrir</button>`)}
      ${row('Dossier de l’app', 'Configuration, journal et état (à ne pas partager).', `<button class="btn sm" data-act="support">Afficher</button>`)}
    </section></div>`;
}
async function saveSettings() {
  try {
    const result = await call('saveSettings', { settings: S.draft });
    S.settings = (result && result.settings) || JSON.parse(JSON.stringify(S.draft));
    S.draft = null;
    if (result && result.env) Object.assign(S.env, result.env);
    toast('Réglages enregistrés');
    render();
  } catch (e) { toast(e.message, 'error'); }
}

// ======================= Bienvenue =======================
function viewWelcome() {
  if (!S.draft) S.draft = JSON.parse(JSON.stringify(S.settings || {}));
  const d = S.draft;
  return `<div class="welcome fade-in"><img src="icon.png" alt=""><h1>Bienvenue dans Cours Albert</h1>
    <p class="subtitle">Vos cours, votre emploi du temps, vos examens et votre présence d’Albert School, rangés et à jour sur votre Mac.</p>
    <div class="steps">
      <div class="card"><div class="n">1</div><b>Choisissez vos dossiers</b><span>Une bibliothèque de cours (ou votre vault Obsidian) et un dossier sur le Bureau.</span></div>
      <div class="card"><div class="n">2</div><b>Connectez Inside</b><span>Une fenêtre Chrome s’ouvre une seule fois pour vous connecter avec Google.</span></div>
      <div class="card"><div class="n">3</div><b>C’est prêt</b><span>L’app se met à jour chaque heure, même fermée. Aucun compte n’est partagé.</span></div>
    </div>
    <section class="card" style="text-align:left">
      <div class="set-row"><div class="grow"><b>Bibliothèque de cours</b><span class="path">${esc(d.vaultCourses || '')}</span></div><button class="btn sm" data-act="choose" data-target="vaultCourses">Choisir…</button></div>
      <div class="set-row"><div class="grow"><b>C’est un dossier de mon vault Obsidian</b><span>Ajoute pages d’accueil, tableau de bord et carte des cours (facultatif).</span></div><label class="switch"><input type="checkbox" data-setting="root:vaultEnabled" ${d.vaultEnabled ? 'checked' : ''}><span></span></label></div>
      <div class="set-row"><div class="grow"><b>Dossier sur le Bureau</b><span class="path">${esc(d.desktopCourses || '')}</span></div><button class="btn sm" data-act="choose" data-target="desktopCourses">Choisir…</button></div>
      <div class="set-row"><div class="grow"><b>Dossiers Google Drive (facultatif)</b><span>${(d.driveFolders || []).length ? esc(d.driveFolders.map(p => p.split('/').pop()).join(', ')) : 'Ajoutez les dossiers de cours de « Mon Drive »'}</span></div><button class="btn sm" data-act="choose" data-target="driveFolders">Ajouter…</button></div>
    </section>
    <div style="margin-top:22px;display:flex;gap:10px;justify-content:center"><button class="btn" data-act="guide">Guide de démarrage</button><button class="btn primary" data-act="welcome-go" style="height:36px;padding:0 20px">Installer et connecter Inside</button></div></div>`;
}

// ======================= Recherche (⌘K) =======================
function searchIndex() {
  const items = [];
  const pages = [['accueil', 'Accueil des espaces', 'home'], ['today', 'Aujourd’hui', 'today'], ['planning', 'Emploi du temps', 'calendar'], ['examens', 'Examens', 'exam'], ['absences', 'Présence et absences', 'attendance'], ['cours', 'Tous les cours', 'courses'], ['sync', 'Synchronisation', 'sync'], ['reglages', 'Réglages', 'settings']];
  for (const [r, l, i] of pages) items.push({ group: 'Pages', title: l, sub: '', icon: i, act: () => go(r) });
  if (E.available) {
    items.push({ group: 'Actions', title: 'Nouveau tableau', sub: 'Mur, colonnes, grille, chronologie, carte…', icon: 'wall', act: () => E.createBlank('board') });
    items.push({ group: 'Actions', title: 'Nouvel espace libre', sub: 'Tableau blanc en cartes', icon: 'canvas', act: () => E.createBlank('canvas') });
    items.push({ group: 'Actions', title: 'Choisir un modèle', sub: 'Brainstorming, Kanban, quiz, portfolio…', icon: 'template', act: () => E.templateGallery() });
    for (const sp of E.state.spaces.filter(x => !x.trashedAt)) items.push({ group: 'Espaces', title: `${sp.icon} ${sp.title}`, sub: `${E.kindLabel(sp.kind)} · ${ago(sp.updatedAt)}`, icon: sp.kind === 'canvas' ? 'canvas' : 'wall', act: () => go(`e/${sp.id}`) });
    if (E.space && E.space.kind === 'board') for (const p of E.space.posts) items.push({ group: 'Dans cet espace', title: p.title || MD.plain(p.body).slice(0, 80) || 'Publication', sub: p.author ? p.author.name : '', icon: 'comment', act: () => E.openPost(p.id) });
  }
  for (const c of D.courses) for (const n of c.notes || []) items.push({ group: 'Notes', title: n.title || n.name, sub: `${c.code} · ${n.folder}`, icon: 'fileText', act: () => (TextViewer.canUse() && TextViewer.isText(n) ? TextViewer.open(n.path) : call('open', { path: n.path }).catch(err => toast(err.message, 'error'))) });
  items.push({ group: 'Actions', title: 'Synchroniser maintenant', sub: 'Inside, Drive et Bureau', icon: 'sync', act: () => startSync('normal') });
  items.push({ group: 'Actions', title: 'Exporter l’emploi du temps vers Calendrier', sub: 'Fichier .ics', icon: 'download', act: () => call('openICS').catch(e => toast(e.message, 'error')) });
  for (const c of D.courses) items.push({ group: 'Cours', title: `${c.code} — ${c.title}`, sub: c.teacher, icon: 'courses', act: () => go(`cours/${c.id}`) });
  for (const x of D.upcomingExams()) items.push({ group: 'Examens', title: `${x.name} · ${x.code}`, sub: `${dayShort(x.start)} ${time(x.start)} · ${x.courseTitle}`, icon: 'exam', act: () => { S.examCourse = x.code; go('examens'); } });
  const t = now().getTime();
  for (const e of D.schedule.filter(e => Date.parse(e.start) > t && Date.parse(e.start) < t + 21 * DAY)) items.push({ group: 'Séances', title: `${e.title}${e.code ? ' · ' + e.code : ''}`, sub: `${dayShort(e.start)} ${time(e.start)}${e.room ? ' · ' + e.room : ''}`, icon: 'calendar', act: () => { S.week = mondayOf(dayKey(e.start)); go('planning'); setTimeout(() => openDrawer(e.id), 50); } });
  const openFile = f => () => (TextViewer.canUse() && TextViewer.isText(f) ? TextViewer.open(f.path) : call('open', { path: f.path }).catch(err => toast(err.message, 'error')));
  for (const c of D.courses) for (const f of c.files) items.push({ group: 'Fichiers', title: f.name, sub: `${c.code} · ${f.section}`, icon: 'file', act: openFile(f) });
  for (const f of (S.data && S.data.unclassified) || []) items.push({ group: 'Fichiers', title: f.name, sub: 'À classer', icon: 'file', act: openFile(f) });
  return items;
}
function openSearch() { S.search = { q: '', sel: 0, items: searchIndex() }; renderOverlay(); setTimeout(() => { const i = $('#palette-input'); if (i) i.focus(); }, 10); }
function searchResults() {
  const s = S.search;
  const words = normalize(s.q).split(/\s+/).filter(Boolean);
  let list = s.items;
  if (words.length) list = list.map(it => { const hay = normalize(`${it.title} ${it.sub} ${it.group}`); const ok = words.every(w => hay.includes(w)); return ok ? { it, score: (normalize(it.title).startsWith(words[0]) ? 0 : 1) + (it.group === 'Fichiers' ? 0.5 : 0) } : null; }).filter(Boolean).sort((a, b) => a.score - b.score).map(x => x.it);
  else list = list.filter(it => it.group === 'Pages' || it.group === 'Actions' || it.group === 'Espaces').slice(0, 16);
  return list.slice(0, 40);
}
function paletteHtml() {
  const results = searchResults();
  S.search.results = results;
  if (S.search.sel >= results.length) S.search.sel = Math.max(0, results.length - 1);
  let group = '';
  const rows = results.map((r, i) => { const g = r.group !== group ? `<div class="group">${esc(r.group)}</div>` : ''; group = r.group; return `${g}<div class="res ${i === S.search.sel ? 'sel' : ''}" data-act="search-pick" data-index="${i}">${I[r.icon] || ''}<div class="grow"><b>${esc(r.title)}</b>${r.sub ? `<span>${esc(r.sub)}</span>` : ''}</div></div>`; }).join('');
  return `<div class="palette-back" data-act="search-close"><div class="palette" data-stop>
    <div class="field">${I.search}<input id="palette-input" placeholder="Espace, cours, note, fichier, examen…" value="${attr(S.search.q)}" autocomplete="off" spellcheck="false"></div>
    <div class="results">${rows || '<div class="empty" style="padding:18px">Aucun résultat.</div>'}</div>
    <div class="hint"><span>↑↓ naviguer</span><span>↩︎ ouvrir</span><span>esc fermer</span></div></div></div>`;
}
function refreshPalette() {
  const back = $('.palette-back'); if (!back) return;
  const results = back.querySelector('.results');
  const tmp = document.createElement('div'); tmp.innerHTML = paletteHtml();
  results.replaceWith(tmp.querySelector('.results'));
  const sel = back.querySelector('.res.sel'); if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function pickSearch(i) { const r = S.search && S.search.results && S.search.results[i]; S.search = null; renderOverlay(); if (r) r.act(); }

// ======================= Rendu =======================
function renderMain(resetScroll) {
  const main = $('#main');
  const spacesRoute = S.route === 'e' || S.route === 'j';
  document.body.classList.toggle('esp-route', spacesRoute);
  document.body.classList.remove('onboarding');
  if (S.route === 'e') { E.mount(main, S.param); return; }
  if (E.mounted) E.unmount();
  if (!spacesRoute && document.title !== 'Cours Albert') document.title = 'Cours Albert';
  if (S.route === 'j') { E.renderJoined(main, S.param); return; }
  if (S.route === 'accueil') { const scroll = main.scrollTop; E.renderDashboard(main); main.scrollTop = resetScroll ? 0 : scroll; return; }
  const scroll = main.scrollTop;
  let html;
  if (!S.env.hasConfig && (ALBERT_ROUTES.includes(S.route))) html = viewWelcome();
  else switch (S.route) {
    case 'planning': html = viewPlanning(); break;
    case 'examens': html = viewExams(); break;
    case 'absences': html = viewAttendance(); break;
    case 'cours': html = viewCourses(); break;
    case 'sync': html = viewSync(); break;
    case 'reglages': html = viewSettings(); break;
    case 'assistant': html = Assistant.view(); break;
    case 'notes': html = Notes.view(); break;
    default: html = viewToday();
  }
  main.innerHTML = `<div class="page ${S.route === 'assistant' ? 'page-assistant' : S.route === 'notes' ? 'page-notes' : ''}">${html}</div>`;
  main.scrollTop = resetScroll ? 0 : scroll;
  if (S.route === 'assistant') Assistant.mounted(main);
  else if (S.route === 'notes') Notes.mounted(main);
}
function renderOverlay() {
  const o = $('#overlay');
  let html = '';
  if (S.drawer) { const e = D.schedule.find(x => x.id === S.drawer); if (e) html += eventDrawer(e); }
  if (S.search) html += paletteHtml();
  o.innerHTML = html;
}
function render(resetScroll = false) {
  if (!S.ready) return;
  if (S.route !== 'reglages' && S.route !== 'bienvenue') S.draft = null;
  renderSidebar();
  renderMain(resetScroll);
  renderOverlay();
}
function openDrawer(id) { S.drawer = id; renderOverlay(); }

// ======================= Événements =======================
function setDraft(path, value) {
  const [obj, key] = path.includes(':') ? path.split(':') : ['root', path];
  const target = obj === 'root' ? S.draft : (S.draft[obj] || (S.draft[obj] = {}));
  target[key] = value;
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.closest('[data-stop]') && el.dataset.act === 'search-close') return;
  const act = el.dataset.act;
  if (el.tagName === 'A') e.preventDefault();
  const safe = p => p.catch(err => toast(err.message, 'error'));
  switch (act) {
    case 'go': go(el.dataset.to); break;
    case 'sync': startSync(el.dataset.mode); break;
    case 'search': openSearch(); break;
    case 'search-close': if (e.target === el) { S.search = null; renderOverlay(); } break;
    case 'search-pick': pickSearch(+el.dataset.index); break;
    case 'open': { const path = el.dataset.path; if (TextViewer.canUse() && TextViewer.isText({ path })) TextViewer.open(path); else safe(call('open', { path })); break; }
    case 'new-space': if (E.available) E.newMenu(el); else toast(E.error || 'Le serveur des espaces n’a pas démarré.', 'error'); break;
    case 'albert-folder': { const open = !el.closest('.nav-folder').classList.contains('open'); try { localStorage.setItem('ca-albert-open', open ? '1' : '0'); } catch {} if (!open && ALBERT_ROUTES.includes(S.route)) go('accueil'); else renderSidebar(); break; }
    case 'file-menu': e.stopPropagation(); fileMenu(el, el.dataset.key); break;
    case 'assign': { e.stopPropagation(); const over = clsFiles(); over[el.dataset.key] = Object.assign({}, over[el.dataset.key], { course: el.dataset.course }); saveClassementSoon(); renderMain(false); toast(`Rangé dans ${(D.course(el.dataset.course) || {}).code || 'le cours'}`); break; }
    case 'assign-menu': e.stopPropagation(); assignMenu(el, el.dataset.key, el.dataset.unit); break;
    case 'assign-all': { const over = clsFiles(); let n = 0; for (const f of (S.data && S.data.unclassified) || []) { const sg = f.suggestion; const k = clsKey(f); if (sg && sg.courseId && sg.confidence >= 0.6 && D.course(sg.courseId) && !(over[k] && over[k].course)) { over[k] = Object.assign({}, over[k], { course: sg.courseId }); n++; } } saveClassementSoon(); renderMain(false); toast(`${plural(n, 'fichier rangé', 'fichiers rangés')} — modifiable avec « Ranger… »`); break; }
    case 'ai-classify': aiClassify(); break;
    case 'courseview': S.courseView = el.dataset.view; renderMain(false); break;
    case 'sort-auto': { const c = D.course(el.dataset.course); if (c) resetManual(courseMaterials(c)); break; }
    case 'sort-auto-notes': { const c = D.course(el.dataset.course); if (c) resetManual(c.notes || []); break; }
    case 'revision-board': revisionBoard(el.dataset.course); break;
    case 'reset-course-order': S.classement.courses = {}; saveClassementSoon(); renderMain(false); break;
    case 'esp-reveal': if (S.env.spaces && S.env.spaces.folder) safe(call('reveal', { path: S.env.spaces.folder })); break;
    case 'esp-lan': try { const r = await E.api('POST', '/prefs', { lan: el.dataset.on === '1' }); E.state.lan = r.lan; E.state.prefs = r.prefs; renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'esp-name': try { const name = $('[data-esp-name]').value.trim(); await E.savePrefs({ ownerName: name }); E.state.ownerName = name || 'Moi'; toast('Nom enregistré'); renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'ai-save': try { const patch = {}; const pv = $('[data-ai-provider]'); if (pv) patch.provider = pv.value; const k = $('[data-ai-key]'); const key = k ? k.value.trim() : ''; if (key && !key.includes('…')) patch.apiKey = key; const u = $('[data-ai-url]'); if (u) patch.baseURL = u.value.trim(); const mo = $('[data-ai-model]'); if (mo) patch.model = mo.value.trim(); E.state.ai = await E.api('POST', '/ai/config', patch); toast(E.state.ai.enabled ? `IA activée : ${E.state.ai.providerShort} · ${E.state.ai.model}` : 'Réglages de l’IA enregistrés'); renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'ai-models': try { const u = $('[data-ai-url]'); if (u && u.value.trim() !== (E.state.ai.baseURL || '')) E.state.ai = await E.api('POST', '/ai/config', { baseURL: u.value.trim() }); const r = await E.api('GET', '/ai/models'); E.state.ai = r.status; toast(r.models.length ? `${r.models.length} modèle(s) disponible(s) : choisissez dans la liste du champ « Modèle ».` : 'L’API n’a renvoyé aucun modèle.'); renderMain(false); const mo = $('[data-ai-model]'); if (mo) mo.focus(); } catch (err) { toast(err.message, 'error'); } break;
    case 'ai-toggle': try { E.state.ai = await E.api('POST', '/ai/config', { enabled: el.dataset.on === '1' }); renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'ai-forget': try { E.state.ai = await E.api('POST', '/ai/config', { apiKey: '', enabled: false }); toast('Clé effacée'); renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'reveal': e.stopPropagation(); safe(call('reveal', { path: el.dataset.path })); break;
    case 'reveal-folder': safe(call('open', { path: el.dataset.path })); break;
    case 'url': safe(call('openURL', { url: el.dataset.url })); break;
    case 'obsidian': safe(call('openObsidian', { path: el.dataset.path || '' })); break;
    case 'ics': safe(call('openICS')); break;
    case 'guide': safe(call('openGuide')); break;
    case 'support': safe(call('openSupport')); break;
    case 'refresh-log': try { S.lastLog = await call('readLog'); renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'event': openDrawer(el.dataset.id); break;
    case 'close': S.drawer = null; renderOverlay(); break;
    case 'week': S.week = +el.dataset.dir === 0 ? mondayOf(dayKey(now())) : addDays(S.week || mondayOf(dayKey(now())), 7 * +el.dataset.dir); if (+el.dataset.dir === 0) S.planMode = S.planMode; renderMain(false); break;
    case 'planmode': S.planMode = el.dataset.mode; renderMain(false); break;
    case 'examfilter': S.examFilter = el.dataset.value; renderMain(false); break;
    case 'unit': S.unitFilter = el.dataset.unit; renderMain(false); break;
    case 'settings-save': saveSettings(); break;
    case 'settings-reset': S.draft = null; renderMain(false); break;
    case 'drive-remove': S.draft.driveFolders.splice(+el.dataset.index, 1); renderMain(false); break;
    case 'notif-permission': try { const r = await call('requestNotifications'); S.env.notifications = r; renderMain(false); } catch (err) { toast(err.message, 'error'); } break;
    case 'install': try { await call('install'); toast('Application et agent horaire réinstallés'); } catch (err) { toast(err.message, 'error'); } break;
    case 'choose': {
      try {
        const target = el.dataset.target;
        const path = await call('chooseFolder', { purpose: target, multiple: target === 'driveFolders' });
        if (!path || (Array.isArray(path) && !path.length)) break;
        if (!S.draft) S.draft = JSON.parse(JSON.stringify(S.settings || {}));
        if (target === 'driveFolders') { S.draft.driveFolders = [...new Set([...(S.draft.driveFolders || []), ...[].concat(path)])]; }
        else { S.draft[target] = path; if (target === 'vaultCourses') S.draft.vaultEnabled = /\/Vault\//i.test(path) || S.draft.vaultEnabled; }
        renderMain(false);
      } catch (err) { toast(err.message, 'error'); }
      break;
    }
    case 'welcome-go': {
      try {
        const result = await call('saveSettings', { settings: S.draft, install: true });
        S.settings = (result && result.settings) || S.draft; S.draft = null; S.env.hasConfig = true;
        if (result && result.env) Object.assign(S.env, result.env);
        go('today'); startSync('login');
      } catch (err) { toast(err.message, 'error'); }
      break;
    }
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.setting) { setDraft(t.dataset.setting, t.checked); renderMain(false); }
  else if (t.dataset.settingSelect) { const [a, b] = t.dataset.settingSelect.split('.'); if (b) setDraft(`${a}:${b}`, +t.value); else S.draft[a] = +t.value; renderMain(false); }
  else if (t.dataset.change === 'examcourse') { S.examCourse = t.value; renderMain(false); }
  else if ('aiProvider' in t.dataset) { E.api('POST', '/ai/config', { provider: t.value }).then(r => { E.state.ai = r; renderMain(false); }, err => toast(err.message, 'error')); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'palette-input') { S.search.q = t.value; S.search.sel = 0; refreshPalette(); }
  else if (t.dataset.input === 'coursequery') { S.courseQuery = t.value; const pos = t.selectionStart; renderMain(false); const i = document.querySelector('[data-input="coursequery"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
});
document.addEventListener('keydown', e => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); S.search ? (S.search = null, renderOverlay()) : openSearch(); return; }
  if (S.search) {
    if (e.key === 'Escape') { S.search = null; renderOverlay(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); S.search.sel = Math.min(S.search.sel + 1, (S.search.results || []).length - 1); refreshPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.search.sel = Math.max(S.search.sel - 1, 0); refreshPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickSearch(S.search.sel); }
    return;
  }
  if (e.key === 'Escape' && S.drawer) { S.drawer = null; renderOverlay(); return; }
  if (S.route === 'planning' && !meta && !/INPUT|SELECT/.test(document.activeElement.tagName)) {
    if (e.key === 'ArrowLeft') { S.week = addDays(S.week, -7); renderMain(false); }
    if (e.key === 'ArrowRight') { S.week = addDays(S.week, 7); renderMain(false); }
    if (e.key.toLowerCase() === 't') { S.week = mondayOf(dayKey(now())); renderMain(false); }
  }
});

document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || S.route !== 'cours') return;
  const row = e.target.closest('.cf-row');
  if (row && !e.target.closest('.acts')) { dragCourseFile(e, row); return; }
  const card = e.target.closest('.course-card[data-course-id]');
  if (card) dragCourseCard(e, card);
});

// ======================= Démarrage =======================
function boot() {
  const raw = location.hash.replace(/^#\/?/, '');
  const i = raw.indexOf('/');
  if (S.env.vibrancy) document.body.classList.add('vibrancy');
  spacesAuth();
  route_((i < 0 ? raw : raw.slice(0, i)) || 'accueil', i < 0 ? '' : raw.slice(i + 1));
  clearInterval(S.timer);
  S.timer = setInterval(() => {
    if (document.body.classList.contains('dragging') || UI.stack.length) return;
    if (!S.search && !S.drawer && ['today', 'planning', 'cours'].includes(S.route) && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) renderMain(false);
    renderSidebar();
  }, 30000);
  connectSpaces();
}
function spacesAuth() {
  const sp = S.env.spaces;
  E.mode = 'app';
  if (sp && sp.token) { E.token = sp.token; E.base = sp.base || ''; }
}
/** Connexion au serveur local des espaces (lancé par l’app). */
async function connectSpaces() {
  const sp = S.env.spaces;
  if (!sp || !sp.token) { E.available = false; E.error = sp && sp.error ? sp.error : 'Le serveur des espaces n’a pas démarré. Relancez Cours Albert.'; if (S.route === 'accueil') renderMain(false); return; }
  spacesAuth();
  try {
    await E.loadState();
    // Après un redémarrage du serveur, le flux des nouveautés repart sur la bonne adresse.
    if (E.ownerES) { E.ownerES.close(); E.ownerES = null; }
    E.listenOwner();
    E.error = '';
  } catch (err) { E.available = false; E.error = err.message; }
  renderSidebar();
  if (['accueil', 'e', 'j'].includes(S.route) || S.route === 'reglages') render(false);
}
/** Attend la connexion au serveur des espaces (fichiers ouverts depuis le Finder au lancement, commandes de menu). */
async function waitSpaces(ms = 10000) {
  const t0 = Date.now();
  while (!E.available && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 200));
  return E.available;
}
async function openTextFromFinder(path) {
  if (!path) return;
  if (!await waitSpaces()) { toast(E.error || 'Le lecteur de fichiers n’est pas encore prêt. Réessayez dans un instant.', 'error'); return; }
  try { await E.api('POST', '/files/allow', { path }); TextViewer.open(path); } catch (err) { toast(err.message, 'error'); }
}
async function importSpaceFromFinder(path) {
  if (!path) return;
  if (!await waitSpaces()) { toast(E.error || 'Le serveur des espaces n’a pas démarré.', 'error'); return; }
  try { await E.api('POST', '/files/allow', { path }); const { summary } = await E.api('POST', `/import?path=${encodeURIComponent(path)}`); E.state.spaces.unshift(summary); toast(`« ${summary.title} » importé`); go(`e/${summary.id}`); }
  catch (err) { toast(err.message, 'error'); }
}
async function runCommand(name) {
  if (!await waitSpaces()) { toast(E.error || 'Le serveur des espaces n’a pas démarré.', 'error'); return; }
  if (name === 'new-board') E.createBlank('board');
  else if (name === 'new-canvas') E.createBlank('canvas');
  else if (name === 'templates') E.templateGallery();
  else if (name === 'import') E.importFile();
  else if (name === 'join') E.join();
  else if (name === 'present' && E.space) E.present();
  else if (name === 'share' && E.space) E.shareDialog();
}

// ======================= Mode démonstration (navigateur) =======================
const Mock = {
  async call(action, payload) {
    await new Promise(r => setTimeout(r, 60));
    switch (action) {
      case 'ready': return null;
      case 'sync': {
        let pct = 0;
        const labels = ['Accueil et nouveautés', 'Emploi du temps', 'Examens', 'Présence', 'Supports MAT11-1', 'Rangement des cours'];
        const timer = setInterval(() => {
          pct += 9;
          if (pct >= 100) { clearInterval(timer); window.CoursAlbert.receive({ type: 'syncDone', result: { added: 1, errors: [] }, data: S.data }); return; }
          window.CoursAlbert.receive({ type: 'progress', progress: { running: true, pct, label: labels[Math.min(labels.length - 1, Math.floor(pct / 17))], current: 1, total: 3 } });
        }, 250);
        return true;
      }
      case 'chooseFolder': return payload.purpose === 'driveFolders' ? ['/Users/etudiant/Library/CloudStorage/GoogleDrive-prenom.nom@albertschool.com/My Drive/Nouveau dossier'] : '/Users/etudiant/Documents/Cours Albert';
      case 'saveClassement': try { localStorage.setItem('ca-classement', JSON.stringify(payload.data)); } catch {} return true;
      case 'saveSettings': return { settings: payload.settings };
      case 'readLog': return 'Cours Albert : 0 ajoutés, 0 mis à jour, 0 problème(s).';
      case 'requestNotifications': return 'authorized';
      default: toast(`Démo : ${action}${payload && (payload.path || payload.url) ? ' → ' + (payload.path || payload.url).split('/').slice(-2).join('/') : ''}`); return true;
    }
  },
  async boot() {
    const q = new URLSearchParams(location.search);
    if (q.get('now')) { S.fakeNow = Date.parse(q.get('now')); S.fakeStart = Date.now(); }
    let data = null;
    if (!q.has('nodata')) { try { data = await (await fetch('demo-data.json')).json(); } catch { data = null; } }
    const settings = { vaultCourses: '/Users/etudiant/Documents/Vault/Bachelor', vaultEnabled: true, desktopCourses: '/Users/etudiant/Desktop/Cours Albert', driveFolders: ['/Users/etudiant/Library/CloudStorage/GoogleDrive-prenom.nom@albertschool.com/My Drive/DAT12-1', '/Users/etudiant/Library/CloudStorage/GoogleDrive-prenom.nom@albertschool.com/My Drive/marketing'], academicYearStart: 2026, automatic: true, menubar: true, launchAtLogin: false, notifications: { classReminder: 10, examReminder: true, materials: true, exams: true, absences: true, changes: true } };
    let classement = null;
    try { classement = JSON.parse(localStorage.getItem('ca-classement') || 'null'); } catch {}
    window.CoursAlbert.receive({ type: 'init', data, classement: classement || { files: {}, courses: {} }, settings: q.has('noconfig') ? { vaultCourses: '/Users/eleve/Documents/Cours Albert', desktopCourses: '/Users/eleve/Desktop/Cours Albert', driveFolders: [] } : settings, env: { version: '3.3.2', hasConfig: !q.has('noconfig'), vibrancy: false, notifications: 'notDetermined', spaces: { token: q.get('token') || 'dev', base: '', folder: '/tmp/Espaces' } }, progress: q.has('progress') ? { running: true, pct: 46, label: 'Supports BUS13-1', current: 3, total: 9 } : null, log: '' });
  },
};
if (native) call('ready').catch(() => {}); else Mock.boot();

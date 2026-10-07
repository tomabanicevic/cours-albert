/* Cours Albert 2 — vues */
'use strict';

// ======================= Barre latérale =======================
function renderSidebar() {
  const d = S.data;
  const has = !!S.env.hasConfig;
  const soon = has ? D.upcomingExams().filter(x => dayDiff(dayKey(now()), dayKey(x.start)) <= 7).length : 0;
  const below = has && d && d.attendance && d.attendance.units.some(u => u.below);
  const fresh = has ? D.courses.reduce((s, c) => s + c.newCount, 0) : 0;
  let open = false;
  try { open = localStorage.getItem('ca-albert-open') === '1'; } catch {}
  if (ALBERT_ROUTES.includes(S.route)) open = true;
  const item = (route, icon, label, extra = '') => `<button class="nav-item ${S.route === route ? 'active' : ''}" data-act="go" data-to="${route}">${I[icon]}<span>${label}</span>${extra}</button>`;
  const spaces = ((typeof E !== 'undefined' && E.state && E.state.spaces) || []).filter(s => !s.trashedAt && !s.archived && !s.isTemplate);
  const unread = id => (typeof E !== 'undefined' && E.unread && E.unread[id]) || 0;
  const spaceItem = s => `<button class="nav-item ${S.route === 'e' && S.param === s.id ? 'active' : ''} ${unread(s.id) ? 'unread' : ''}" data-act="go" data-to="e/${attr(s.id)}" title="${attr(s.title)}"><span class="emo">${esc(s.icon)}</span><span>${esc(s.title)}</span>${s.pending ? `<span class="pill warn" title="À valider">${s.pending}</span>` : unread(s.id) ? `<span class="pill" title="Nouveautés">${unread(s.id)}</span>` : ''}</button>`;
  const favs = spaces.filter(s => s.favorite).slice(0, 8);
  const recents = spaces.filter(s => !s.favorite).sort((a, b) => (unread(b.id) ? 1 : 0) - (unread(a.id) ? 1 : 0) || (b.openedAt || b.updatedAt).localeCompare(a.openedAt || a.updatedAt)).slice(0, 5);
  const st = has ? syncState() : null;
  $('#sidebar').innerHTML = `
    <div class="brand"><img src="icon.png" alt=""><div><b>Cours Albert</b><span>Espaces et cours</span></div></div>
    ${item('accueil', 'home', 'Accueil', spaces.length ? `<span class="count">${spaces.length}</span>` : '')}
    <button class="nav-item" data-act="new-space">${I.plus}<span>Nouvel espace</span><span class="count">⌘N</span></button>
    ${favs.length ? `<div class="nav-label">Favoris</div>${favs.map(spaceItem).join('')}` : ''}
    ${recents.length ? `<div class="nav-label">Récents</div>${recents.map(spaceItem).join('')}` : ''}
    <div class="nav-label nav-label-act">Notes<button class="btn icon sm ghost" data-act="notes-add" title="Ajouter un dossier de notes">${I.plus}</button></div>
    ${((typeof E !== 'undefined' && E.state && E.state.notes) || []).map(f => `<button class="nav-item ${S.route === 'notes' && String(S.param || '').split('/')[0] === f.id ? 'active' : ''}" data-act="go" data-to="notes/${attr(f.id)}" title="${attr(f.path)}">${I.edit}<span>${esc(f.name)}</span></button>`).join('') || `<button class="nav-item muted-item" data-act="notes-add">${I.folderPlus}<span>Ajouter un dossier</span></button>`}
    <div class="nav-folder ${open ? 'open' : ''}">
      <button class="nav-item folder-head" data-act="albert-folder" title="${open ? 'Replier' : 'Déplier'} Albert School">${open ? I.folderOpen : I.folder}<span>Albert School</span>${!open && (soon || below || fresh || (st && st.cls === 'error')) ? '<span class="dot" title="Du nouveau"></span>' : ''}${I.chevR.replace('<svg ', '<svg class="chev" ')}</button>
      <div class="folder-body">
        ${has ? `${item('today', 'today', 'Aujourd’hui')}
        ${item('planning', 'calendar', 'Emploi du temps')}
        ${item('examens', 'exam', 'Examens', soon ? `<span class="pill warn">${soon}</span>` : '')}
        ${item('absences', 'attendance', 'Présence', below ? '<span class="dot" title="Sous le seuil"></span>' : '')}
        ${item('cours', 'courses', 'Cours', fresh ? `<span class="pill">${fresh}</span>` : `<span class="count">${D.courses.length || ''}</span>`)}
        ${item('sync', 'sync', 'Synchronisation')}
        ${syncWidget()}` : item('bienvenue', 'spark', 'Configurer')}
      </div>
    </div>
    <div class="nav-label">Outils</div>
    ${item('assistant', 'sparkles', 'Assistant IA', typeof Assistant !== 'undefined' && Assistant.state.busy ? '<span class="dot" title="Au travail"></span>' : '')}
    <button class="nav-item" data-act="search">${I.search}<span>Rechercher</span><span class="count">⌘K</span></button>
    ${item('reglages', 'settings', 'Réglages')}
    <div class="spacer"></div>`;
}
function semesterLabel() {
  const s = S.data && S.data.semester;
  return s ? `Bachelor 1 · Semestre ${s.code.slice(1)}` : 'Albert School';
}
function syncState() {
  const p = S.progress;
  if (p && p.running) return { cls: 'busy', title: p.phase === 'login' ? 'Connexion à Inside…' : 'Synchronisation…', sub: p.label || '', pct: p.pct || 0 };
  const sync = S.data && S.data.sync;
  if (!sync || !sync.finished) return { cls: 'warn', title: 'Jamais synchronisé', sub: 'Lancez une première synchronisation.' };
  if (sync.inside && sync.inside.connected === false) return { cls: 'error', title: 'Inside à reconnecter', sub: `Dernier passage ${relative(sync.finished)}` };
  if (sync.inside && sync.inside.offline) return { cls: 'warn', title: 'Hors ligne', sub: `Dernier passage ${relative(sync.finished)}` };
  if (sync.errors && sync.errors.length) return { cls: 'warn', title: `À jour · ${plural(sync.errors.length, 'point')} à vérifier`, sub: relative(sync.finished) };
  return { cls: '', title: 'À jour', sub: `Synchronisé ${relative(sync.finished)}` };
}
function syncWidget() {
  const st = syncState();
  return `<div class="sync-widget">
    <div class="row"><span class="status-dot ${st.cls}"></span><b>${esc(st.title)}</b></div>
    ${st.cls === 'busy' ? `<div class="bar"><i style="width:${st.pct}%"></i></div>` : ''}
    <div class="sub">${esc(st.sub)}</div>
    ${st.cls === 'busy' ? '' : `<button class="btn sm" data-act="sync">${I.sync}Synchroniser</button>`}
  </div>`;
}

// ======================= Éléments communs =======================
function pageHead(eyebrow, title, subtitle, actions = '') {
  return `<header class="page-head"><div class="titles">${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h1>${esc(title)}</h1>${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}</div><div class="head-actions">${actions}</div></header>`;
}
function alertsHtml(filter) {
  return D.alerts().filter(a => !filter || filter(a)).map(a => `<div class="banner ${a.cls}">${I[a.icon]}<div class="grow">${a.html}</div>${a.action || ''}</div>`).join('');
}
const codeChip = code => code ? `<span class="chip code ${unitClass(code)}">${esc(code)}</span>` : '';
function fileIcon(f) { const e = fileExt(f); return `<span class="fileicon ft-${esc(f.kind)}">${esc(e.slice(0, 4))}</span>`; }
function fileRow(f, sub) {
  return `<div class="file-row" data-act="open" data-path="${attr(f.path)}" title="${attr(f.name)}">
    ${fileIcon(f)}
    <div class="grow"><b>${esc(f.name)}</b><span>${sub != null ? sub : `${sizeLabel(f.size)}${f.rel && f.rel.includes('/') ? ' · ' + esc(f.rel.split('/').slice(0, -1).join(' / ')) : ''}`}</span></div>
    ${f.isNew ? '<span class="chip new">Nouveau</span>' : ''}
    <div class="acts"><button class="btn sm icon ghost" data-act="reveal" data-path="${attr(f.path)}" title="Afficher dans le Finder">${I.folder}</button></div>
  </div>`;
}
function emptyBig(icon, text, action = '') { return `<div class="empty big">${I[icon]}${esc(text)}${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`; }
function noData() {
  return `<div class="card">${emptyBig('sync', 'Les données Inside ne sont pas encore chargées. Lancez une synchronisation : l’app lira votre planning, vos examens et votre présence.', '<button class="btn primary" data-act="sync">Synchroniser maintenant</button>')}</div>`;
}

// ======================= Aujourd’hui =======================
function viewToday() {
  const t = now();
  const name = (S.data && S.data.student && S.data.student.firstName) || '';
  const hour = parts(t).h;
  const hello = hour < 5 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';
  const actions = `<button class="btn" data-act="search">${I.search}Rechercher<span class="kbd">⌘K</span></button>`;
  let html = pageHead(cap(dayLong(t)), `${hello}${name ? ' ' + name : ''}`, '', actions) + alertsHtml();
  if (!S.data || !D.schedule.length) return html + noData();

  const current = D.current();
  const next = D.next();
  const focus = current || next;
  const todayKey = dayKey(t);
  let hero;
  if (focus) {
    const c = D.course(focus.courseId);
    const live = focus === current;
    const total = Date.parse(focus.end) - Date.parse(focus.start);
    const done = live ? Math.min(100, Math.round((t - Date.parse(focus.start)) / total * 100)) : 0;
    const when = live ? `Fin ${relative(focus.end).replace('dans', 'dans')}` : relative(focus.start);
    const dayLabel = dayKey(focus.start) === todayKey ? '' : `${dayShort(focus.start)} · `;
    hero = `<section class="card hero span-7 ${unitClass(focus.code)}">
      <div class="kicker">${live ? '<span class="live"></span>En cours' : dayKey(focus.start) === todayKey ? 'Prochain cours' : dayDiff(todayKey, dayKey(focus.start)) === 1 ? 'Prochain cours · demain' : 'Prochain cours'}</div>
      <div class="big"><b>${live ? time(focus.end) : time(focus.start)}</b><span>${esc(live ? 'fin' : dayKey(focus.start) === todayKey ? relative(focus.start) : dayShort(focus.start))}</span></div>
      <div class="title">${esc(focus.title)}</div>
      <div class="meta">${codeChip(focus.code)}<span>${I.clock}${dayLabel}${time(focus.start)} – ${time(focus.end)}</span>${focus.room ? `<span>${I.pin}${esc(focus.room)}</span>` : ''}${focus.teacher ? `<span>${I.user}${esc(focus.teacher)}</span>` : ''}</div>
      ${live ? `<div class="progress"><i style="width:${done}%"></i></div>` : ''}
      <div class="foot">
        ${c ? `<button class="btn sm" data-act="go" data-to="cours/${attr(c.id)}">${I.courses}Supports du cours</button><button class="btn sm" data-act="reveal-folder" data-path="${attr(c.folder)}">${I.folder}Dossier</button>` : ''}
        ${focus.courseId ? `<button class="btn sm" data-act="url" data-url="https://inside.albertschool.com/courses/${attr(focus.courseId)}">${I.external}Inside</button>` : ''}
        <span class="muted" style="margin-left:auto;color:rgba(255,255,255,.8);font-size:12px">${live ? esc(when) : ''}</span>
      </div>
    </section>`;
  } else hero = `<section class="card hero calm span-7"><div class="kicker">Planning</div><div class="title">Aucun cours à venir dans le planning synchronisé.</div><div class="foot"><button class="btn sm" data-act="go" data-to="planning">${I.calendar}Ouvrir l’emploi du temps</button></div></section>`;

  // Journée (aujourd’hui, ou demain / prochain jour de cours quand la journée est finie)
  let key = todayKey, label = 'Aujourd’hui';
  let events = D.eventsOn(key);
  if (!events.some(e => Date.parse(e.end) > t)) {
    const upcoming = D.schedule.find(e => Date.parse(e.start) > t && dayKey(e.start) !== todayKey);
    if (upcoming) { key = dayKey(upcoming.start); events = D.eventsOn(key); label = dayDiff(todayKey, key) === 1 ? 'Demain' : dayLong(upcoming.start); }
  }
  const timeline = events.length ? `<div class="timeline">${events.map(e => {
    const state = Date.parse(e.end) <= t ? 'past' : Date.parse(e.start) <= t ? 'now' : '';
    return `<div class="tl-item ${state} ${e.kind === 'exam' ? 'exam' : ''} ${unitClass(e.code)}" data-act="event" data-id="${attr(e.id)}">
      <div class="time">${time(e.start)}<small>${e.deadline ? 'échéance' : time(e.end)}</small></div><div class="rail"></div>
      <div class="what"><b>${e.kind === 'exam' ? 'Examen · ' : ''}${esc(e.title)}</b><span>${[e.code, e.room, e.teacher].filter(Boolean).map(esc).join(' · ')}</span></div>
      ${e.kind === 'exam' ? '<span class="chip exam">Examen</span>' : state === 'now' ? '<span class="chip new">En cours</span>' : ''}
    </div>`; }).join('')}</div>` : '<div class="empty">Pas de cours prévu.</div>';

  const exams = D.upcomingExams().slice(0, 4);
  const examList = exams.length ? `<div class="list">${exams.map(x => { const j = jLabel(x.start); const p = parts(x.start); return `<div class="row-item clickable" data-act="go" data-to="examens">
      <div class="datebox ${unitClass(x.code)}"><small>${fmt(x.start, { month: 'short' }).replace('.', '')}</small><b>${p.d}</b></div>
      <div class="grow"><b>${esc(x.name)}</b><span>${esc(x.code)} · ${esc(x.courseTitle)} · ${time(x.start)}</span></div>
      <span class="countdown ${j.cls}">${j.text}</span></div>`; }).join('')}</div>` : '<div class="empty">Aucun examen à venir.</div>';

  const units = (S.data.attendance && S.data.attendance.units || []).filter(u => u.total > 0);
  const attendance = units.length ? `<div class="unit-bars">${units.map(unitBar).join('')}</div>` : '<div class="empty">Pas encore de données de présence.</div>';

  const recent = D.recentFiles().slice(0, 5);
  const files = recent.length ? `<div class="list">${recent.map(f => fileRow(Object.assign({}, f, { isNew: false }), `${esc(f.course.code)} · ${esc(f.course.title)}`)).join('')}</div>` : '<div class="empty">Aucun nouveau support cette semaine.</div>';

  const news = ((S.data.news) || []).slice(0, 6);
  const newsHtml = news.length ? news.map(n => `<div class="news-item ${unitClass(n.code)}" ${n.url ? `data-act="url" data-url="https://inside.albertschool.com${attr(n.url)}"` : ''}><i></i><div style="min-width:0"><b>${esc(n.title)}</b><span>${esc([n.code ? `${n.code} — ${n.courseTitle}` : '', n.kind === 'material' ? 'Nouveau support' : n.author].filter(Boolean).join(' · '))}</span></div><time>${n.date ? esc(relative(n.date)) : ''}</time></div>`).join('') : '<div class="empty">Rien de nouveau.</div>';

  return html + `<div class="grid fade-in">
    ${hero}
    <section class="card span-5"><div class="card-head"><h2>${esc(label.charAt(0).toUpperCase() + label.slice(1))}</h2><a class="link" href="#" data-act="go" data-to="planning">Semaine</a></div>${timeline}</section>
    <section class="card span-4"><div class="card-head"><h2>Prochains examens</h2><a class="link" href="#" data-act="go" data-to="examens">Tout voir</a></div>${examList}</section>
    <section class="card span-4"><div class="card-head"><h2>Présence</h2><a class="link" href="#" data-act="go" data-to="absences">Détail</a></div>${attendance}</section>
    <section class="card span-4"><div class="card-head"><h2>Nouveaux supports</h2><a class="link" href="#" data-act="go" data-to="cours">Cours</a></div>${files}</section>
    <section class="card span-12"><div class="card-head"><h2>Sur Inside</h2><span class="muted" style="font-size:12px">Actualités et annonces de vos cours</span></div>${newsHtml}</section>
  </div>`;
}
function unitBar(u) {
  const rate = u.rate == null ? 0 : u.rate;
  const note = u.total ? `${marginText(u.margin)} ce semestre${S.data.attendance.coverageComplete ? '' : ' (estimation)'}` : 'Aucune séance comptée';
  return `<div class="unit-bar ${u.below ? 'below' : ''} ${unitClass(u.code)}"><div class="top"><span class="chip code ${unitClass(u.code)}">${esc(u.code)}</span><b>${esc(u.name)}</b><span class="val">${pct(u.rate)}</span></div>
    <div class="track"><i style="width:${Math.round(rate * 100)}%"></i><span class="th" style="left:85%"></span></div><div class="note">${u.attended}/${u.total} séances · ${esc(note)}</div></div>`;
}

function marginText(m) { return m > 0 ? plural(m, 'absence encore possible', 'absences encore possibles') : m === 0 ? 'Plus aucune absence possible' : `Limite dépassée de ${plural(-m, 'séance')}`; }
const modeLabel = m => ({ PAPER: 'sur papier', ONLINE: 'en ligne', COMPUTER: 'sur ordinateur', ORAL: 'oral' }[String(m).toUpperCase()] || String(m).toLowerCase());
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

// ======================= Emploi du temps =======================
function viewPlanning() {
  const todayKey = dayKey(now());
  if (!S.week) S.week = mondayOf(todayKey);
  const weekEnd = addDays(S.week, 6);
  const rangeLabel = `${fmt(keyToDate(S.week, 12), { day: 'numeric', month: S.week.slice(5, 7) === weekEnd.slice(5, 7) ? undefined : 'long' })} – ${fmt(keyToDate(weekEnd, 12), { day: 'numeric', month: 'long', year: 'numeric' })}`;
  const toolbar = `<div class="toolbar">
    <button class="btn icon" data-act="week" data-dir="-1" title="Semaine précédente">${I.chevL}</button>
    <button class="btn" data-act="week" data-dir="0">Aujourd’hui</button>
    <button class="btn icon" data-act="week" data-dir="1" title="Semaine suivante">${I.chevR}</button>
    <span class="range">${S.planMode === 'week' ? esc(rangeLabel) : 'Les 30 prochains jours'}</span>
    <span class="grow"></span>
    <div class="segmented"><button class="${S.planMode === 'week' ? 'on' : ''}" data-act="planmode" data-mode="week">Semaine</button><button class="${S.planMode === 'list' ? 'on' : ''}" data-act="planmode" data-mode="list">Liste</button></div>
    <button class="btn" data-act="ics" title="Ouvrir le calendrier .ics dans Calendrier">${I.download}Exporter vers Calendrier</button>
  </div>`;
  const count = D.classes().filter(e => e.start >= keyToDate(S.week).toISOString() && e.start < keyToDate(addDays(S.week, 7)).toISOString()).length;
  let html = pageHead('', 'Emploi du temps', S.data ? `${plural(count, 'séance')} cette semaine · source : Inside → My schedule` : '') + toolbar;
  if (!S.data || !D.schedule.length) return html + noData();
  return html + (S.planMode === 'week' ? weekGrid(todayKey) : agenda(todayKey));
}
function layoutDay(events) {
  const cols = [];
  const placed = events.map(e => ({ e, s: Date.parse(e.start), f: Math.max(Date.parse(e.end), Date.parse(e.start) + 30 * 60000) }));
  placed.sort((a, b) => a.s - b.s || b.f - a.f);
  const groups = [];
  let group = [], groupEnd = 0;
  for (const p of placed) {
    if (group.length && p.s >= groupEnd) { groups.push(group); group = []; groupEnd = 0; }
    group.push(p); groupEnd = Math.max(groupEnd, p.f);
  }
  if (group.length) groups.push(group);
  for (const g of groups) {
    const lanes = [];
    for (const p of g) { let i = lanes.findIndex(end => end <= p.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = p.f; p.lane = i; }
    for (const p of g) p.lanes = lanes.length;
  }
  return placed;
}
function weekGrid(todayKey) {
  const days = [...Array(7)].map((_, i) => addDays(S.week, i));
  const byDay = Object.fromEntries(days.map(k => [k, D.eventsOn(k)]));
  const visible = days.filter((k, i) => i < 5 || byDay[k].length);
  const all = visible.flatMap(k => byDay[k]);
  const coverage = S.data.coverage;
  const outside = coverage && (keyToDate(S.week) > new Date(coverage.to) || keyToDate(addDays(S.week, 7)) < new Date(coverage.from));
  let minH = 8, maxH = 19;
  for (const e of all) { minH = Math.min(minH, Math.floor(minutesOfDay(e.start) / 60)); maxH = Math.max(maxH, Math.ceil(minutesOfDay(e.end) / 60)); }
  const PX = 52;
  const height = (maxH - minH) * PX;
  const tpl = `56px repeat(${visible.length}, minmax(0, 1fr))`;
  const t = now();
  const head = `<div class="week-head" style="grid-template-columns:${tpl}"><div></div>${visible.map(k => `<div class="${k === todayKey ? 'today' : ''}">${esc(fmt(keyToDate(k, 12), { weekday: 'short' }))}<b>${+k.slice(8)}</b></div>`).join('')}</div>`;
  const hours = [...Array(maxH - minH + 1)].map((_, i) => `<span style="top:${i * PX}px">${String(minH + i).padStart(2, '0')}:00</span>`).join('');
  const lines = [...Array(maxH - minH)].map((_, i) => `<div class="hline" style="top:${i * PX}px"></div><div class="hline half" style="top:${i * PX + PX / 2}px"></div>`).join('');
  const cols = visible.map(k => {
    const placed = layoutDay(byDay[k]);
    const evs = placed.map(p => {
      const e = p.e;
      const top = (minutesOfDay(e.start) - minH * 60) / 60 * PX;
      const h = Math.max(24, (p.f - p.s) / 3600000 * PX - 2);
      const width = 100 / p.lanes;
      const past = Date.parse(e.end) < t.getTime();
      return `<div class="ev ${unitClass(e.code)} ${e.kind === 'exam' ? 'exam' : ''} ${past ? 'past' : ''} ${e.deadline ? 'deadline' : ''}" style="top:${top}px;height:${h}px;left:calc(${p.lane * width}% + 3px);width:calc(${width}% - 6px);right:auto" data-act="event" data-id="${attr(e.id)}" title="${attr(e.title)}">
        <b>${e.kind === 'exam' ? '⚑ ' : ''}${esc(e.title)}</b>${h > 34 ? `<span>${e.deadline ? 'Échéance ' + time(e.start) : `${time(e.start)} – ${time(e.end)}`}</span>` : ''}${h > 52 && (e.room || e.code) ? `<span>${esc([e.code, e.room].filter(Boolean).join(' · '))}</span>` : ''}
      </div>`;
    }).join('');
    const nowLine = k === todayKey && minutesOfDay(t) >= minH * 60 && minutesOfDay(t) <= maxH * 60 ? `<div class="now-line" style="top:${(minutesOfDay(t) - minH * 60) / 60 * PX}px"></div>` : '';
    return `<div class="day-col ${k === todayKey ? 'today' : ''}" style="height:${height}px">${lines}${evs}${nowLine}</div>`;
  }).join('');
  const body = all.length || !outside
    ? `<div class="week-body" style="grid-template-columns:${tpl}"><div class="hours" style="height:${height}px">${hours}</div>${cols}</div>`
    : `<div class="week-empty">Cette semaine n’a pas encore été lue sur Inside. La synchronisation quotidienne complète la totalité du semestre.</div>`;
  return `<div class="week fade-in">${head}${body}</div>`;
}
function agenda(todayKey) {
  const t = now().getTime();
  const end = t + 30 * DAY;
  const events = D.schedule.filter(e => Date.parse(e.end) >= t && Date.parse(e.start) <= end);
  if (!events.length) return `<div class="card">${emptyBig('calendar', 'Aucune séance dans les 30 prochains jours.')}</div>`;
  const groups = new Map();
  for (const e of events) { const k = dayKey(e.start); groups.set(k, [...(groups.get(k) || []), e]); }
  return `<div class="fade-in">${[...groups].map(([k, list]) => `<div class="agenda-day"><h3 class="${k === todayKey ? 'today' : ''}">${k === todayKey ? 'Aujourd’hui · ' : dayDiff(todayKey, k) === 1 ? 'Demain · ' : ''}${esc(dayLong(keyToDate(k, 12)))}</h3>
    <div class="card" style="padding:6px 8px"><div class="timeline">${list.map(e => `<div class="tl-item ${e.kind === 'exam' ? 'exam' : ''} ${unitClass(e.code)}" data-act="event" data-id="${attr(e.id)}"><div class="time">${time(e.start)}<small>${e.deadline ? 'échéance' : time(e.end)}</small></div><div class="rail"></div><div class="what"><b>${e.kind === 'exam' ? 'Examen · ' : ''}${esc(e.title)}</b><span>${[e.code, e.room, e.teacher].filter(Boolean).map(esc).join(' · ')}</span></div>${e.kind === 'exam' ? '<span class="chip exam">Examen</span>' : ''}</div>`).join('')}</div></div></div>`).join('')}</div>`;
}
function eventDrawer(e) {
  const c = D.course(e.courseId) || D.courseByCode(e.code);
  const exam = e.kind === 'exam' ? D.exams.find(x => x.id === e.examId || x.start === e.start) : null;
  const next = c ? D.nextExamFor(c.code) : null;
  return `<div class="drawer-backdrop" data-act="close"></div><aside class="drawer ${unitClass(e.code)}">
    <button class="btn icon ghost close" data-act="close" title="Fermer">${I.close}</button>
    ${e.kind === 'exam' ? '<span class="chip exam">Examen</span> ' : ''}${codeChip(e.code)}
    <h2>${esc(e.title)}</h2>
    ${(c ? c.title : e.courseTitle) && (c ? c.title : e.courseTitle) !== e.title ? `<div class="soft">${esc(c ? c.title : e.courseTitle)}</div>` : ''}
    <dl>
      <dt>${I.calendar}</dt><dd>${esc(dayLong(e.start))}</dd>
      <dt>${I.clock}</dt><dd>${e.deadline ? `Échéance à ${time(e.start)}` : `${time(e.start)} – ${time(e.end)}`} <span class="muted">· ${esc(relative(e.start))}</span></dd>
      ${e.room ? `<dt>${I.pin}</dt><dd>${esc(e.room)}</dd>` : ''}
      ${e.teacher ? `<dt>${I.user}</dt><dd>${esc(e.teacher)}</dd>` : ''}
      ${exam ? `<dt>${I.exam}</dt><dd>${exam.durationMin ? `${exam.durationMin} min · ` : ''}coefficient ${exam.coeff ?? '—'}${exam.mode ? ` · ${esc(modeLabel(exam.mode))}` : ''}</dd>` : ''}
      ${!exam && next ? `<dt>${I.exam}</dt><dd>Prochaine évaluation : <b>${esc(next.name)}</b>, ${esc(dayShort(next.start))} <span class="countdown ${jLabel(next.start).cls}">${jLabel(next.start).text}</span></dd>` : ''}
    </dl>
    <div class="actions">
      ${c ? `<button class="btn" data-act="go" data-to="cours/${attr(c.id)}">${I.courses}Supports du cours</button><button class="btn" data-act="reveal-folder" data-path="${attr(c.folder)}">${I.folder}Ouvrir le dossier</button>` : ''}
      <button class="btn" data-act="url" data-url="${e.kind === 'exam' ? 'https://inside.albertschool.com/me/grades' : `https://inside.albertschool.com/courses/${attr(e.courseId || '')}`}">${I.external}Voir sur Inside</button>
    </div>
  </aside>`;
}

// ======================= Examens =======================
function viewExams() {
  const all = D.exams;
  const t = now().getTime();
  const upcoming = D.upcomingExams();
  const in30 = upcoming.filter(x => Date.parse(x.start) - t <= 30 * DAY).length;
  let html = pageHead('', 'Examens', all.length ? `${plural(in30, 'examen')} dans les 30 prochains jours · ${plural(all.length, 'épreuve')} ce semestre` : '', `<button class="btn" data-act="url" data-url="https://inside.albertschool.com/me/grades">${I.external}Inside</button>`);
  if (!all.length) return html + noData();
  const next = upcoming[0];
  if (next) {
    const d = dayDiff(dayKey(now()), dayKey(next.start));
    const c = D.courseByCode(next.code);
    const syllabus = c && c.files.find(f => f.section === 'Syllabus' && f.kind === 'pdf');
    html += `<section class="card exam-hero ${unitClass(next.code)}" style="margin-bottom:18px">
      <div class="j"><div><b>${d <= 0 ? 'J' : d}</b><small>${d <= 0 ? 'aujourd’hui' : d === 1 ? 'jour' : 'jours'}</small></div></div>
      <div><div class="eyebrow" style="text-transform:none">Prochain examen · ${esc(dayLong(next.start))} à ${time(next.start)}</div><div class="t">${esc(next.name)} — ${esc(next.courseTitle)}</div>
        <div class="soft">${codeChip(next.code)} ${next.durationMin ? `${next.durationMin} min · ` : ''}coefficient ${next.coeff ?? '—'}${next.mode ? ` · ${esc(modeLabel(next.mode))}` : ''}${next.seb ? ` · ${esc(next.seb)}` : ''}</div></div>
      <div style="display:grid;gap:8px">${c ? `<button class="btn" data-act="go" data-to="cours/${attr(c.id)}">${I.courses}Réviser les supports</button>` : ''}${syllabus ? `<button class="btn" data-act="open" data-path="${attr(syllabus.path)}">${I.file}Syllabus</button>` : ''}</div>
    </section>`;
  }
  const courseOptions = [...new Set(all.map(x => x.code))].sort().map(code => `<option value="${attr(code)}" ${S.examCourse === code ? 'selected' : ''}>${esc(code)} — ${esc((D.courseByCode(code) || {}).title || '')}</option>`).join('');
  html += `<div class="toolbar"><div class="segmented">${[['upcoming', 'À venir'], ['past', 'Passés'], ['all', 'Tous']].map(([k, l]) => `<button class="${S.examFilter === k ? 'on' : ''}" data-act="examfilter" data-value="${k}">${l}</button>`).join('')}</div>
    <select class="select" data-change="examcourse"><option value="">Tous les cours</option>${courseOptions}</select></div>`;
  let list = all.filter(x => S.examFilter === 'all' || (S.examFilter === 'past' ? Date.parse(x.end) < t : Date.parse(x.end) >= t));
  if (S.examCourse) list = list.filter(x => x.code === S.examCourse);
  if (S.examFilter === 'past') list = [...list].reverse();
  const months = new Map();
  for (const x of list) { const k = fmt(x.start, { month: 'long', year: 'numeric' }); months.set(k, [...(months.get(k) || []), x]); }
  const rows = list.length ? [...months].map(([m, xs]) => `<div class="month">${esc(m)}</div><div class="card flush">${xs.map(x => {
    const j = jLabel(x.start); const p = parts(x.start); const past = Date.parse(x.end) < t;
    return `<div class="exam-row ${past ? 'past' : ''}">
      <div class="datebox ${unitClass(x.code)}"><small>${esc(fmt(x.start, { weekday: 'short' }).replace('.', ''))}</small><b>${p.d}</b></div>
      <div class="name"><b>${esc(x.name)}</b><span>${codeChip(x.code)} ${esc(x.courseTitle)}</span></div>
      <div class="when">${time(x.start)}${x.durationMin ? ` · ${x.durationMin} min` : Date.parse(x.end) === Date.parse(x.start) ? ' · échéance' : ''}</div>
      <div>${past ? '<span class="countdown">Passé</span>' : `<span class="countdown ${j.cls}">${j.text}</span>`}</div>
      <div class="coef">${x.coeff ?? '—'}<small>coeff.</small></div>
    </div>`; }).join('')}</div>`).join('') : `<div class="card">${emptyBig('exam', 'Aucun examen pour ce filtre.')}</div>`;

  const weights = D.courses.filter(c => c.grading && c.grading.length).map(c => `<div class="weight ${unitClass(c.code)}"><div class="top">${codeChip(c.code)}<span>${esc(c.title)}</span></div>
    <div class="stack">${c.grading.map(g => `<i class="${/^CC/i.test(g.kind) ? 'cc' : /BTS/i.test(g.kind) ? 'bts' : ''}" style="flex:${g.weight || 1}" title="${attr(`${g.component} · ${g.kind} · ${g.weight}%${g.duration ? ' · ' + g.duration : ''}`)}">${g.weight}%</i>`).join('')}</div></div>`).join('');
  const grades = S.data.grades && S.data.grades.rows && S.data.grades.rows.length
    ? `<section class="card span-12"><div class="card-head"><h2>Notes publiées</h2></div><table class="table"><thead><tr>${S.data.grades.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${S.data.grades.rows.map(r => `<tr>${S.data.grades.headers.map(h => `<td>${esc((r[h] || []).join(' '))}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`
    : '';
  return html + `<div class="grid"><div class="span-8">${rows}</div>
    <aside class="span-4"><section class="card"><div class="card-head"><h2>Pondération par cours</h2></div><p class="muted" style="margin:-4px 0 14px;font-size:12px">Contrôles continus (clair) et examen final (foncé), d’après les syllabus.</p><div class="weights">${weights || '<div class="empty">Syllabus non disponibles.</div>'}</div></section></aside>${grades}</div>`;
}

// ======================= Présence =======================
function ring(rate, below) {
  const r = 34, c = 2 * Math.PI * r, v = rate == null ? 0 : rate;
  return `<div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="${r}" fill="none" stroke="rgba(127,127,140,.18)" stroke-width="8"/>${v > 0 ? `<circle cx="42" cy="42" r="${r}" fill="none" stroke="${below ? 'var(--danger)' : 'var(--u)'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c * v} ${c}"/>` : ''}<circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--text-2)" stroke-width="8" stroke-dasharray="1.2 ${c}" stroke-dashoffset="${-c * 0.85}" opacity=".6"/></svg><div class="v">${rate == null ? '—' : Math.round(v * 100) + '%'}</div></div>`;
}
function viewAttendance() {
  const a = S.data && S.data.attendance;
  let html = pageHead('', 'Présence', 'Validation : 85 % de présence par unité d’enseignement, toutes séances du semestre confondues', `<button class="btn" data-act="url" data-url="https://inside.albertschool.com/me/attendance">${I.external}Inside</button><button class="btn" data-act="url" data-url="https://edusign.app/student/home">${I.external}Edusign</button>`);
  if (!a || (!a.courses.length && !a.units.length)) return html + noData();
  html += alertsHtml(x => x.cls === 'warn');
  html += `<div class="gauges">${a.units.map(u => `<section class="card gauge-card ${unitClass(u.code)}">${ring(u.total ? u.rate : null, u.below)}<div class="info"><b>${esc(u.name)}</b><div class="soft">${u.total ? `${u.attended}/${u.total} séances · ${plural(u.absences, 'absence')}` : 'Aucune séance comptée'}</div>
    ${u.total ? (u.below ? `<span class="chip danger">Sous le seuil</span>` : `<span class="chip ok">Validé à ce jour</span>`) : '<span class="chip">En attente</span>'}
    ${u.total ? `<div class="muted" style="font-size:11.5px;margin-top:6px">${esc(marginText(u.margin))} · ~${u.plannedTotal} séances au semestre${a.coverageComplete ? '' : '*'}</div>` : ''}</div></section>`).join('')}</div>`;
  html += `<div class="callout" style="margin-bottom:18px">${I.info}<div>Une unité (MAT11, DAT12, BUS13, HUM14) est jugée en entier : toutes les séances de tous ses cours sont additionnées sur le semestre, et c’est ce total qui doit atteindre 85 %. La « marge » estime combien d’absences restent possibles jusqu’à la fin du semestre${a.coverageComplete ? '' : ' (*estimation tant que le planning complet du semestre n’est pas encore lu)'}. La présence n’est qu’un critère : réussir tous les cours d’une unité peut compenser un manque.</div></div>`;
  const courses = a.courses.map(r => `<tr class="${unitClass(r.code)}"><td>${codeChip(r.code)}</td><td>${esc(r.title)}</td><td class="r num">${r.attended}/${r.total}</td><td><div class="rate"><div class="bar"><i style="width:${Math.round((r.rate || 0) * 100)}%;${r.rate < 0.85 ? 'background:var(--danger)' : ''}"></i></div><span class="num" style="${r.rate < 0.85 ? 'color:var(--danger);font-weight:650' : ''}">${pct(r.rate)}</span></div></td><td class="r">${r.courseId ? `<button class="btn sm ghost" data-act="url" data-url="https://inside.albertschool.com/courses/${attr(r.courseId)}/attendance">Détail</button>` : ''}</td></tr>`).join('');
  const absences = a.absences.length ? a.absences.map(x => `<div class="row-item"><div class="datebox ${unitClass(x.code)}"><small>${esc(fmt(x.start, { month: 'short' }).replace('.', ''))}</small><b>${parts(x.start).d}</b></div><div class="grow"><b>${esc(x.title)}</b><span>${esc(x.code)} · ${esc(cap(dayLong(x.start)))} · ${time(x.start)}–${time(x.end)}</span></div><span class="status ${esc(x.status)}">${esc(x.statusLabel || 'Absent')}</span></div>`).join('') : '<div class="empty">Aucune absence enregistrée. 👏</div>';
  return html + `<div class="grid"><section class="card flush span-8"><div class="card-head"><h2>Par cours</h2></div><table class="table" style="margin-top:6px"><thead><tr><th>Code</th><th>Cours</th><th class="r">Présent</th><th>Taux</th><th></th></tr></thead><tbody>${courses}</tbody></table></section>
    <section class="card span-4"><div class="card-head"><h2>Mes absences</h2><span class="muted" style="margin-left:auto;font-size:12px">${a.checked ? 'lu ' + esc(relative(a.checked)) : ''}</span></div><div class="list">${absences}</div></section>
    ${a.other && a.other.length ? `<section class="card span-12"><div class="card-head"><h2>Séances hors cours</h2></div><div class="list">${a.other.map(o => `<div class="row-item"><div class="grow"><b>${esc(o.label || 'Séance')}</b><span>${esc(dayLong(o.start))} · ${time(o.start)}</span></div><span class="status ${esc(o.status)}">${esc(o.statusLabel)}</span></div>`).join('')}</div></section>` : ''}</div>`;
}

// ======================= Cours : tri automatique et manuel des supports =======================
const CATS_FALLBACK = [['cours', 'Cours et slides'], ['td', 'TD, TP et exercices'], ['controles', 'Contrôles et examens'], ['projets', 'Projets et devoirs'], ['lectures', 'Lectures et ressources'], ['donnees', 'Données et code'], ['infos', 'Infos du cours'], ['autres', 'Autres fichiers']].map(([id, label]) => ({ id, label }));
const CATS = () => (S.data && S.data.categories && S.data.categories.length ? S.data.categories : CATS_FALLBACK);
const CAT_ICONS = { cours: 'book', td: 'pen', controles: 'exam', projets: 'send', lectures: 'fileText', donnees: 'table', infos: 'info', autres: 'file' };
const collFR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const clsFiles = () => (S.classement.files ||= {});
function clsKey(f) {
  const lib = S.data && S.data.library;
  if (f.source === 'vault' && lib && lib.vault && f.path.startsWith(lib.vault + '/')) return 'vault:' + f.path.slice(lib.vault.length + 1);
  if (lib && lib.root && f.path.startsWith(lib.root + '/')) return f.path.slice(lib.root.length + 1);
  return f.path;
}
const saveClassementSoon = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => call('saveClassement', { data: S.classement }).catch(e => toast(e.message, 'error')), 300); }; })();
function compareAutoUI(a, b) {
  const ra = a.rank == null ? null : a.rank, rb = b.rank == null ? null : b.rank;
  if ((ra == null) !== (rb == null)) return ra == null ? 1 : -1;
  if (ra != null && ra !== rb) return ra - rb;
  if (!!a.solution !== !!b.solution) return a.solution ? 1 : -1;
  return collFR.compare(a.title || a.name, b.title || b.name) || collFR.compare(a.name, b.name);
}
/** Regroupe par catégorie (choix manuels d’abord, puis ordre automatique : TD1, corrigé TD1, TD2…). */
function groupByCategory(files) {
  const over = clsFiles();
  const groups = new Map(CATS().map(c => [c.id, []]));
  for (const f of files) {
    const o = over[clsKey(f)] || {};
    const cat = groups.has(o.category) ? o.category : (groups.has(f.category) ? f.category : 'autres');
    groups.get(cat).push(Object.assign({}, f, { category: cat, manual: typeof o.order === 'number' ? o.order : null }));
  }
  return CATS().map(c => {
    const list = groups.get(c.id);
    const auto = [...list].sort(compareAutoUI);
    const idx = new Map(auto.map((f, i) => [f, i]));
    list.sort((a, b) => ((a.manual != null ? a.manual : idx.get(a)) - (b.manual != null ? b.manual : idx.get(b))) || idx.get(a) - idx.get(b));
    return { id: c.id, label: c.label, files: list };
  }).filter(g => g.files.length);
}
/** Supports d’un cours, y compris ceux rangés à la main depuis « À classer » ou depuis un autre cours. */
function courseMaterials(c) {
  const over = clsFiles();
  const own = c.files.filter(f => { const o = over[clsKey(f)]; return !(o && o.course && o.course !== c.id && D.course(o.course)); });
  const moved = [];
  for (const other of D.courses) if (other.id !== c.id) for (const f of other.files) { const o = over[clsKey(f)]; if (o && o.course === c.id) moved.push(Object.assign({}, f, { movedFrom: other.code })); }
  for (const f of (S.data && S.data.unclassified) || []) { const o = over[clsKey(f)]; if (o && o.course === c.id) moved.push(Object.assign({}, f, { movedFrom: 'À classer' })); }
  return [...own, ...moved];
}
function catFileRow(f, { kind = 'file' } = {}) {
  const key = clsKey(f);
  const sub = [f.solution ? 'corrigé' : '', f.movedFrom ? `rangé depuis ${f.movedFrom}` : '', kind === 'note' ? (f.rel.includes('/') ? f.rel.split('/').slice(0, -1).join(' / ') : 'Note') : (f.section && !['Materials'].includes(f.section) ? ({ Overview: 'Présentation', Syllabus: 'Syllabus', Textbook: 'Manuel', Drive: 'Google Drive', Bureau: 'Bureau' }[f.section] || f.section) : ''), sizeLabel(f.size)].filter(Boolean).join(' · ');
  return `<div class="file-row cf-row" data-act="open" data-path="${attr(f.path)}" data-key="${attr(key)}" title="${attr(f.name)}">
    <span class="grip" title="Glisser pour réordonner">${I.grip}</span>
    ${fileIcon(f)}
    <div class="grow"><b>${esc(f.title || f.name)}</b><span>${esc(sub)}</span></div>
    ${f.isNew ? '<span class="chip new">Nouveau</span>' : ''}
    <div class="acts"><button class="btn sm icon ghost" data-act="file-menu" data-key="${attr(key)}" title="Ranger…">${I.more}</button><button class="btn sm icon ghost" data-act="reveal" data-path="${attr(f.path)}" title="Afficher dans le Finder">${I.folder}</button></div>
  </div>`;
}
function categoryGroupsHTML(files, opts = {}) {
  const groups = groupByCategory(files);
  if (!groups.length) return '<div class="empty">Aucun support pour le moment.</div>';
  return groups.map(g => `<div class="file-group cat-group" data-cat="${g.id}"><div class="section-title">${I[CAT_ICONS[g.id]] || ''}<h3>${esc(g.label)}</h3><span class="muted">${g.files.length}</span></div><div class="cat-list" data-cat-list="${g.id}">${g.files.map(f => catFileRow(f, opts)).join('')}</div></div>`).join('');
}
function hasManual(files) { const over = clsFiles(); return files.some(f => { const o = over[clsKey(f)]; return o && (typeof o.order === 'number' || o.category); }); }
function resetManual(files) { const over = clsFiles(); for (const f of files) { const o = over[clsKey(f)]; if (o) { delete o.order; delete o.category; if (!o.course) delete over[clsKey(f)]; } } saveClassementSoon(); renderMain(false); toast('Ordre automatique rétabli'); }
function courseSort(list, unit) {
  const order = (S.classement.courses || {})[unit];
  if (!order || !order.length) return list;
  const pos = new Map(order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (pos.has(a.id) ? pos.get(a.id) : 999) - (pos.has(b.id) ? pos.get(b.id) : 999) || a.code.localeCompare(b.code, 'fr', { numeric: true }));
}
function viewCourses() {
  if (S.param) return viewCourse(D.course(S.param));
  const courses = D.courses;
  const files = courses.reduce((s, c) => s + c.fileCount, 0);
  const notes = courses.reduce((s, c) => s + ((c.notes && c.notes.length) || 0), 0);
  let html = pageHead('', 'Cours', courses.length ? `${plural(courses.length, 'cours')} · ${plural(files, 'support')}${notes ? ` · ${plural(notes, 'note')} du vault` : ''} · ${esc(semesterLabel())}` : '', `<button class="btn" data-act="reveal-folder" data-path="${attr(S.data ? S.data.library.courses : '')}">${I.folder}Ouvrir dans le Finder</button>${S.settings && S.settings.vaultEnabled ? `<button class="btn" data-act="obsidian">${I.obsidian}Obsidian</button>` : ''}`);
  if (!courses.length) return html + noData();
  const units = S.data.units.filter(u => courses.some(c => c.unit === u.code));
  html += `<div class="filters"><input class="input search" type="search" placeholder="Filtrer les cours" value="${attr(S.courseQuery)}" data-input="coursequery">
    <button class="filter-chip ${S.unitFilter ? '' : 'on'}" data-act="unit" data-unit="">Tous</button>
    ${units.map(u => `<button class="filter-chip ${unitClass(u.code)} ${S.unitFilter === u.code ? 'on' : ''}" data-act="unit" data-unit="${u.code}"><i></i>${esc(u.name)}</button>`).join('')}
    ${Object.keys(S.classement.courses || {}).length ? `<button class="filter-chip ghost" data-act="reset-course-order" title="Revenir à l’ordre des codes">${I.sort}Ordre automatique</button>` : ''}</div>`;
  const q = normalize(S.courseQuery);
  html += units.filter(u => !S.unitFilter || S.unitFilter === u.code).map(u => {
    const list = courseSort(courses.filter(c => c.unit === u.code && (!q || normalize(`${c.code} ${c.title} ${c.teacher}`).includes(q))), u.code);
    if (!list.length) return '';
    return `<div class="unit-title ${unitClass(u.code)}"><i></i><h2>${esc(u.name)}</h2><span class="muted">${esc(u.code)} · ${plural(list.length, 'cours')}</span></div><div class="course-grid" data-unit="${u.code}">${list.map(courseCard).join('')}</div>`;
  }).join('');
  const over = clsFiles();
  const un = ((S.data.unclassified) || []).filter(f => { const o = over[clsKey(f)]; return !(o && o.course && D.course(o.course)); });
  if (un.length && !S.unitFilter && !q) {
    const ready = un.filter(f => f.suggestion && f.suggestion.courseId && f.suggestion.confidence >= 0.6 && D.course(f.suggestion.courseId));
    const ai = typeof E !== 'undefined' && E.state && E.state.ai && E.state.ai.enabled;
    html += `<div class="unit-title"><i style="background:var(--text-3)"></i><h2>À classer</h2><span class="muted">${plural(un.length, 'support')} dont le cours n’a pas été identifié avec certitude</span><span class="grow"></span>${ready.length ? `<button class="btn sm primary" data-act="assign-all">${I.check}Ranger les ${ready.length} suggestions</button>` : ''}${ai ? `<button class="btn sm" data-act="ai-classify">${I.sparkles}Trier avec l’IA</button>` : ''}</div>
    <section class="card"><div class="list">${un.slice(0, 80).map(f => { const sg = f.suggestion || {}; const c = sg.courseId && D.course(sg.courseId); const unit = !c && sg.unit && S.data.units.find(x => x.code === sg.unit); return `<div class="file-row" data-act="open" data-path="${attr(f.path)}" title="${attr(f.name)}">${fileIcon(f)}<div class="grow"><b>${esc(f.title || f.name)}</b><span>${sizeLabel(f.size)} · ${esc(f.rel.split('/').slice(0, -1).join(' / '))}</span></div>
      ${c ? `<button class="sugg ${unitClass(c.code)}" data-act="assign" data-key="${attr(clsKey(f))}" data-course="${attr(c.id)}" title="${attr(sg.reason || '')}">${I.chevR}${esc(c.code)} · ${esc(c.title)}<b>Ranger</b></button>` : unit ? `<span class="sugg-unit">${esc(unit.name)} ?</span>` : ''}
      <button class="btn sm" data-act="assign-menu" data-key="${attr(clsKey(f))}" data-unit="${attr(sg.unit || '')}">${c ? 'Autre…' : 'Ranger…'}</button></div>`; }).join('')}</div>
      ${un.length > 80 ? `<p class="muted">… et ${un.length - 80} autres dans le Finder.</p>` : ''}</section>`;
  }
  return html;
}
function courseCard(c) {
  const next = D.nextFor(c.id), exam = D.nextExamFor(c.code), att = D.attendanceFor(c.code);
  const j = exam ? jLabel(exam.start) : null;
  const n = courseMaterials(c).length;
  return `<article class="card course-card ${unitClass(c.code)}" data-act="go" data-to="cours/${attr(c.id)}" data-course-id="${attr(c.id)}">
    ${codeChip(c.code)}${c.newCount ? ` <span class="chip new">${c.newCount} nouveau${c.newCount > 1 ? 'x' : ''}</span>` : ''}
    <h3>${esc(c.title)}</h3><div class="teacher">${esc(c.teacher || 'Enseignant non indiqué')}</div>
    <div class="facts">
      <div>${I.calendar}${next ? `${esc(dayShort(next.start))} · ${time(next.start)}${next.room ? ' · ' + esc(next.room) : ''}` : '<span class="muted">Pas de séance à venir</span>'}</div>
      <div>${I.exam}${exam ? `${esc(exam.name)} · ${esc(dateShort(exam.start))} <span class="countdown ${j.cls}">${j.text}</span>` : '<span class="muted">Aucune évaluation à venir</span>'}</div>
    </div>
    <div class="foot"><span>${plural(n, 'support')}${c.notes && c.notes.length ? ` · ${plural(c.notes.length, 'note')}` : ''}</span><span class="grow"></span>${att ? `<span class="${att.rate < 0.85 ? 'status absent' : ''}">Présence ${pct(att.rate)}</span>` : ''}</div>
  </article>`;
}
function viewCourse(c) {
  if (!c) return pageHead('', 'Cours introuvable', '') + '<button class="btn" data-act="go" data-to="cours">Retour aux cours</button>';
  const att = D.attendanceFor(c.code);
  const upcoming = D.classes().filter(e => e.courseId === c.id && Date.parse(e.end) >= now().getTime()).slice(0, 5);
  const exams = D.exams.filter(x => x.code === c.code);
  const materials = courseMaterials(c);
  const t = now().getTime();
  let files;
  if (S.courseView === 'sources') {
    const sections = ['Materials', 'Overview', 'Syllabus', 'Textbook', 'Drive', 'Bureau'];
    const labels = { Materials: 'Supports de cours', Overview: 'Présentation', Syllabus: 'Syllabus', Textbook: 'Manuel', Drive: 'Google Drive', Bureau: 'Bureau' };
    const groups = sections.map(s => [s, materials.filter(f => f.section === s)]).filter(([, fs]) => fs.length);
    const others = materials.filter(f => !sections.includes(f.section));
    files = groups.length || others.length ? groups.map(([s, fs]) => `<div class="file-group"><div class="section-title"><h3>${labels[s]}</h3><span class="muted">${fs.length}</span></div>${fs.map(f => fileRow(f)).join('')}</div>`).join('') + (others.length ? `<div class="file-group"><div class="section-title"><h3>Rangés ici</h3><span class="muted">${others.length}</span></div>${others.map(f => fileRow(f)).join('')}</div>` : '') : '<div class="empty">Aucun support pour le moment.</div>';
  } else files = categoryGroupsHTML(materials);
  const notes = c.notes || [];
  return `<button class="back" data-act="go" data-to="cours">${I.chevL}Cours</button>
    <div class="course-head ${unitClass(c.code)}"><div class="badge"><small>${esc(c.code.slice(0, 3))}</small><b>${esc(c.code.slice(3))}</b></div>
      <div style="flex:1;min-width:0"><div class="eyebrow" style="text-transform:none">${esc(c.code)} · ${esc((S.data.units.find(u => u.code === c.unit) || {}).name || '')} · Semestre ${esc(c.semester.slice(1))}</div><h1>${esc(c.title)}</h1><div class="subtitle">${esc(c.teacher || '')}</div></div>
      <div class="head-actions"><button class="btn" data-act="revision-board" data-course="${attr(c.id)}" title="Un tableau avec tous les supports et vos notes, rangés par catégorie">${I.wall}Tableau de révision</button><button class="btn" data-act="reveal-folder" data-path="${attr(c.folder)}">${I.folder}Dossier</button>${S.settings && S.settings.vaultEnabled ? `<button class="btn" data-act="obsidian" data-path="${attr(c.folder + '/Accueil.md')}">${I.obsidian}Obsidian</button>` : ''}<button class="btn primary" data-act="url" data-url="${attr(c.url)}">${I.external}Inside</button></div></div>
    <div class="grid">
      <div class="span-8" style="display:grid;gap:16px;align-content:start">
        <section class="card"><div class="card-head"><h2>Supports</h2><span class="muted" style="font-size:12px">${plural(materials.length, 'fichier')}</span><span class="grow"></span>
          ${S.courseView !== 'sources' && hasManual(materials) ? `<button class="btn sm ghost" data-act="sort-auto" data-course="${attr(c.id)}" title="Oublier l’ordre manuel">${I.sort}Trier automatiquement</button>` : ''}
          <div class="segmented"><button class="${S.courseView !== 'sources' ? 'on' : ''}" data-act="courseview" data-view="categories">Catégories</button><button class="${S.courseView === 'sources' ? 'on' : ''}" data-act="courseview" data-view="sources">Sources</button></div></div>
          ${S.courseView !== 'sources' ? '<p class="muted" style="margin:-4px 0 10px;font-size:12px">Rangés automatiquement (TD1 avant TD2, corrigé juste après son sujet). Glissez un fichier pour changer son ordre ou sa catégorie.</p>' : ''}
          <div class="cat-groups" data-course="${attr(c.id)}">${files}</div></section>
        ${notes.length ? `<section class="card"><div class="card-head"><h2>${I.obsidian} Mes notes</h2><span class="muted" style="font-size:12px">${esc(notes[0].folder)} · ${plural(notes.length, 'note')}</span><span class="grow"></span>${hasManual(notes) ? `<button class="btn sm ghost" data-act="sort-auto-notes" data-course="${attr(c.id)}">${I.sort}Trier automatiquement</button>` : ''}</div><div class="cat-groups" data-course="${attr(c.id)}" data-notes="1">${categoryGroupsHTML(notes, { kind: 'note' })}</div></section>` : ''}
      </div>
      <aside class="span-4" style="display:grid;gap:16px;align-content:start">
        <section class="card"><div class="card-head"><h2>Prochaines séances</h2></div>${upcoming.length ? `<div class="list">${upcoming.map(e => `<div class="row-item clickable" data-act="event" data-id="${attr(e.id)}"><div class="datebox ${unitClass(c.code)}"><small>${esc(fmt(e.start, { weekday: 'short' }).replace('.', ''))}</small><b>${parts(e.start).d}</b></div><div class="grow"><b>${time(e.start)} – ${time(e.end)}</b><span>${esc(e.room || '')}</span></div></div>`).join('')}</div>` : '<div class="empty">Aucune séance à venir.</div>'}</section>
        <section class="card ${unitClass(c.code)}"><div class="card-head"><h2>Évaluations</h2></div>
          ${c.grading && c.grading.length ? `<div class="stack" style="margin-bottom:12px">${c.grading.map(g => `<i class="${/^CC/i.test(g.kind) ? 'cc' : /BTS/i.test(g.kind) ? 'bts' : ''}" style="flex:${g.weight || 1}">${g.weight}%</i>`).join('')}</div>` : ''}
          ${exams.length ? `<div class="list">${exams.map(x => { const past = Date.parse(x.end) < t; const j = jLabel(x.start); return `<div class="row-item" style="${past ? 'opacity:.5' : ''}"><div class="grow"><b>${esc(x.name)}</b><span>${esc(dayShort(x.start))} · ${time(x.start)}${x.durationMin ? ` · ${x.durationMin} min` : ''} · coeff. ${x.coeff == null ? '—' : x.coeff}</span></div>${past ? '' : `<span class="countdown ${j.cls}">${j.text}</span>`}</div>`; }).join('')}</div>` : '<div class="empty">Aucun examen daté.</div>'}</section>
        ${att ? `<section class="card"><div class="card-head"><h2>Présence</h2><span class="${att.rate < 0.85 ? 'status absent' : 'status present'}" style="margin-left:auto">${pct(att.rate)}</span></div><div class="soft" style="margin-bottom:8px">${att.attended}/${att.total} séances</div>${(att.sessions || []).slice(0, 8).map(s => `<div class="row-item"><div class="grow"><b style="font-weight:500">${esc(dayShort(s.start))} · ${time(s.start)}</b></div><span class="status ${esc(s.status)}">${esc(s.statusLabel)}</span></div>`).join('')}</section>` : ''}
      </aside>
    </div>`;
}
/** Menu « Ranger… » d’un fichier : catégorie, cours, ordre automatique. */
function fileMenu(anchor, key) {
  const over = clsFiles();
  const o = over[key] || {};
  const all = [...D.courses.flatMap(c => [...c.files, ...(c.notes || [])]), ...((S.data && S.data.unclassified) || [])];
  const f = all.find(x => clsKey(x) === key);
  const isNote = f && f.source === 'vault';
  const items = [{ header: 'Catégorie' }, ...CATS().map(c => ({ label: c.label, icon: CAT_ICONS[c.id], checked: (o.category || (f && f.category)) === c.id, act: () => { over[key] = Object.assign({}, over[key], { category: c.id }); delete over[key].order; saveClassementSoon(); renderMain(false); } }))];
  if (!isNote) {
    items.push({ sep: true }, { header: 'Cours' });
    for (const c of D.courses) items.push({ label: `${c.code} · ${c.title}`, icon: 'courses', checked: o.course === c.id, act: () => { over[key] = Object.assign({}, over[key], { course: c.id }); saveClassementSoon(); renderMain(false); toast(`Rangé dans ${c.code}`); } });
    if (o.course) items.push({ label: 'Remettre à sa place d’origine', icon: 'restore', act: () => { delete over[key].course; if (!Object.keys(over[key]).length) delete over[key]; saveClassementSoon(); renderMain(false); } });
  }
  if (o.category || typeof o.order === 'number') items.push({ sep: true }, { label: 'Ordre et catégorie automatiques', icon: 'sort', act: () => { delete over[key].category; delete over[key].order; if (!Object.keys(over[key]).length) delete over[key]; saveClassementSoon(); renderMain(false); } });
  if (f && TextViewer.isText(f)) items.push({ sep: true }, { label: 'Ouvrir dans Cours Albert', icon: 'fileText', act: () => TextViewer.open(f.path) }, { label: 'Ouvrir avec l’app par défaut', icon: 'external', act: () => call('open', { path: f.path }).catch(e => toast(e.message, 'error')) });
  UI.menu(anchor, items, { align: 'right' });
}
function assignMenu(anchor, key, unit) {
  const over = clsFiles();
  const list = [...D.courses].sort((a, b) => (a.unit === unit ? -1 : 0) - (b.unit === unit ? -1 : 0) || a.code.localeCompare(b.code, 'fr', { numeric: true }));
  UI.menu(anchor, [{ header: 'Ranger dans le cours' }, ...list.map(c => ({ label: `${c.code} · ${c.title}`, icon: 'courses', act: () => { over[key] = Object.assign({}, over[key], { course: c.id }); saveClassementSoon(); renderMain(false); toast(`Rangé dans ${c.code} (le fichier reste aussi dans « À classer » sur le disque)`); } }))], { align: 'right' });
}
/** Glisser-déposer d’un support : réordonne dans sa catégorie ou le change de catégorie. */
function dragCourseFile(ev, row) {
  const list0 = row.closest('[data-cat-list]');
  const groupsEl = row.closest('.cat-groups');
  if (!list0 || !groupsEl) return;
  const marker = document.createElement('div');
  marker.className = 'drop-marker';
  let target = null;
  startDrag(ev, {
    ghost: () => row,
    onStart: () => { row.classList.add('drag-src'); document.body.appendChild(marker); },
    onMove: (x, y) => {
      marker.style.display = 'none'; target = null;
      const el = document.elementFromPoint(x, y);
      const group = el && el.closest('.cat-group');
      if (!group || !groupsEl.contains(group)) return;
      const list = group.querySelector('[data-cat-list]');
      const rows = [...list.querySelectorAll('.cf-row')].filter(r => r !== row);
      let ref = null, before = true;
      for (const r of rows) { const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) { ref = r; before = true; break; } ref = r; before = false; }
      target = { cat: list.dataset.catList, ref: ref && ref.dataset.key, before };
      const lr = list.getBoundingClientRect();
      const b = ref ? ref.getBoundingClientRect() : null;
      Object.assign(marker.style, { display: 'block', left: `${lr.left}px`, width: `${lr.width}px`, height: '3px', top: `${b ? (before ? b.top : b.bottom) - 1.5 : lr.top}px` });
    },
    onDrop: () => {
      marker.remove(); row.classList.remove('drag-src');
      if (!target) return;
      const list = groupsEl.querySelector(`[data-cat-list="${target.cat}"]`);
      const keys = [...list.querySelectorAll('.cf-row')].map(r => r.dataset.key).filter(k => k !== row.dataset.key);
      let at = target.ref ? keys.indexOf(target.ref) + (target.before ? 0 : 1) : keys.length;
      if (at < 0) at = keys.length;
      keys.splice(at, 0, row.dataset.key);
      const over = clsFiles();
      keys.forEach((k, i) => { over[k] = Object.assign({}, over[k], { order: i }); });
      over[row.dataset.key].category = target.cat;
      saveClassementSoon();
      renderMain(false);
    },
    onCancel: () => { marker.remove(); row.classList.remove('drag-src'); },
  });
}
/** Ordre manuel des cours dans une matière (glisser une carte de cours). */
function dragCourseCard(ev, card) {
  const grid = card.closest('.course-grid');
  if (!grid) return;
  const marker = document.createElement('div');
  marker.className = 'drop-marker';
  let target = null;
  startDrag(ev, {
    ghost: () => card,
    onStart: () => { card.classList.add('drag-src'); document.body.appendChild(marker); },
    onMove: (x, y) => {
      marker.style.display = 'none'; target = null;
      const cards = [...grid.querySelectorAll('[data-course-id]')].filter(c => c !== card);
      let best = null, bd = Infinity;
      for (const c of cards) { const r = c.getBoundingClientRect(); const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)); if (d < bd) { bd = d; best = c; } }
      if (!best) return;
      const r = best.getBoundingClientRect();
      const before = x < r.left + r.width / 2;
      target = { id: best.dataset.courseId, before };
      Object.assign(marker.style, { display: 'block', left: `${(before ? r.left : r.right) - 2}px`, top: `${r.top}px`, width: '4px', height: `${r.height}px` });
    },
    onDrop: () => {
      marker.remove(); card.classList.remove('drag-src');
      if (!target) return;
      const ids = [...grid.querySelectorAll('[data-course-id]')].map(c => c.dataset.courseId).filter(id => id !== card.dataset.courseId);
      const at = ids.indexOf(target.id) + (target.before ? 0 : 1);
      ids.splice(at, 0, card.dataset.courseId);
      (S.classement.courses ||= {})[grid.dataset.unit] = ids;
      saveClassementSoon(); renderMain(false);
    },
    onCancel: () => { marker.remove(); card.classList.remove('drag-src'); },
  });
}
/** Crée un tableau de révision : une section par catégorie, une publication par support ou par note. */
async function revisionBoard(courseId) {
  const c = D.course(courseId);
  if (!c || typeof E === 'undefined' || !E.available) { toast('Le serveur des espaces n’est pas disponible.', 'error'); return; }
  const groups = groupByCategory(courseMaterials(c));
  const noteGroups = groupByCategory(c.notes || []);
  const sections = [];
  const posts = [];
  for (const g of groups) { const id = `s_${g.id}`; sections.push({ id, title: g.label }); g.files.forEach((f, i) => posts.push({ title: f.title || f.name, body: '', sectionId: id, order: i, attachments: [{ kind: 'local', path: f.path, name: f.name }] })); }
  if (noteGroups.length) { sections.push({ id: 's_notes', title: 'Mes notes' }); noteGroups.flatMap(g => g.files).forEach((f, i) => posts.push({ title: f.title || f.name, body: '', sectionId: 's_notes', order: i, attachments: [{ kind: 'local', path: f.path, name: f.name }] })); }
  if (!posts.length) { toast('Ce cours n’a encore aucun support.'); return; }
  try { await E.create({ kind: 'board', title: `Révisions ${c.code} — ${c.title}`, icon: '🧠', description: `Supports de ${c.code} rangés par catégorie. Ajoutez vos questions, fiches et exercices.`, theme: { wallpaper: 'gradient:ocean', accent: '#1d4ed8' }, settings: { layout: 'columns', sections: true, reactions: 'stars' }, sections, posts }); toast('Tableau de révision créé'); }
  catch (e) { toast(e.message, 'error'); }
}
async function aiClassify() {
  const over = clsFiles();
  const un = ((S.data && S.data.unclassified) || []).filter(f => { const o = over[clsKey(f)]; return !(o && o.course); }).slice(0, 150);
  if (!un.length) return;
  toast('L’IA trie les fichiers…');
  try {
    const { result } = await E.api('POST', '/ai/classify', { files: un.map(f => ({ id: clsKey(f), name: f.name, folder: f.rel.split('/').slice(0, -1).join(' / ') })), courses: D.courses.map(c => ({ code: c.code, title: c.title, keywords: (c.keywords || []).slice(0, 25).join(', ') })), categories: CATS().map(c => ({ id: c.id, label: c.label })) });
    let n = 0;
    for (const r of result.files || []) {
      const c = D.courseByCode(String(r.course || '').toUpperCase());
      if (!c || !un.some(f => clsKey(f) === r.id)) continue;
      over[r.id] = Object.assign({}, over[r.id], { course: c.id }, CATS().some(x => x.id === r.category) ? { category: r.category } : {});
      n++;
    }
    saveClassementSoon(); renderMain(false);
    toast(n ? `${plural(n, 'fichier rangé', 'fichiers rangés')} par l’IA (modifiable avec « Ranger… »)` : 'L’IA n’a pas trouvé de cours sûr pour ces fichiers.');
  } catch (e) { toast(e.message, 'error'); }
}

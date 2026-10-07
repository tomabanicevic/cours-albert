/* Cours Albert 2 — interface (WKWebView sur macOS, navigateur pour le développement). */
'use strict';

// ======================= Pont avec l’app native =======================
const native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.coursAlbert;
if (native) document.documentElement.classList.add('native');
const pending = new Map();
let seq = 0;
// Actions qui attendent un choix de l’utilisateur (dossier, enregistrement) : pas de délai d’attente court.
const USER_DIALOGS = new Set(['chooseFolder', 'saveURL', 'exportPDF', 'exportImage']);
function call(action, payload = {}) {
  if (!native) return Mock.call(action, payload);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    native.postMessage(Object.assign({ id, action }, payload));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('Pas de réponse de l’application.')); } }, USER_DIALOGS.has(action) ? 3600000 : 120000);
  });
}
window.CoursAlbert = {
  receive(message) {
    const m = typeof message === 'string' ? JSON.parse(message) : message;
    switch (m.type) {
      case 'reply': { const p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || 'Erreur')); break; }
      case 'init': Object.assign(S, { data: m.data || null, settings: m.settings || null, env: m.env || {}, progress: m.progress || null, lastLog: m.log || '', classement: m.classement || S.classement || { files: {}, courses: {} } }); S.ready = true; boot(); break;
      case 'spaces': if (m.spaces) { S.env.spaces = m.spaces; connectSpaces(); } break;
      case 'openText': openTextFromFinder(m.path); break;
      case 'importSpace': importSpaceFromFinder(m.path); break;
      case 'command': runCommand(m.name); break;
      case 'data': S.data = m.data; render(); break;
      case 'settings': S.settings = m.settings; if (m.env) S.env = Object.assign(S.env, m.env); render(); break;
      case 'progress': onProgress(m.progress); break;
      case 'syncDone': onSyncDone(m); break;
      case 'navigate': go(m.route); break;
      case 'search': openSearch(); break;
      case 'toast': toast(m.text, m.kind); break;
      case 'log': S.lastLog = m.log || ''; if (S.route === 'sync') render(); break;
    }
  },
};

// ======================= État =======================
const S = {
  ready: false, data: null, settings: null, draft: null, env: {}, progress: null, lastLog: '', classement: { files: {}, courses: {} },
  route: 'accueil', param: null, week: null, planMode: 'week', examFilter: 'upcoming', examCourse: '',
  unitFilter: '', courseQuery: '', drawer: null, search: null, syncing: false, courseView: 'categories',
};
const TZ = 'Europe/Paris';
const DAY = 86400000;
const now = () => (S.fakeNow ? new Date(S.fakeNow + (Date.now() - S.fakeStart)) : new Date());

// ======================= Outils =======================
const unitClass = code => 'u-' + (/^(MAT11|DAT12|BUS13|HUM14)/.exec(String(code || '').toUpperCase()) || [null, 'NONE'])[1];
function fmt(date, options) { return new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: TZ }, options)).format(new Date(date)); }
const time = d => fmt(d, { hour: '2-digit', minute: '2-digit' });
const dayLong = d => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
const dayShort = d => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
const dateShort = d => fmt(d, { day: 'numeric', month: 'short' });
function parts(d) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(d))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
}
const dayKey = d => { const p = parts(d); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
function tzOffset(ms) { const p = parts(ms); return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60000) * 60000) / 60000); }
function parisDate(y, m, d, h = 0, min = 0) { const guess = Date.UTC(y, m - 1, d, h, min); let t = guess - tzOffset(guess) * 60000; t = guess - tzOffset(t) * 60000; return new Date(t); }
const keyToDate = (key, h = 0) => { const [y, m, d] = key.split('-').map(Number); return parisDate(y, m, d, h); };
function addDays(key, n) { const [y, m, d] = key.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
function mondayOf(key) { const p = parts(keyToDate(key, 12)); return addDays(key, -p.wd); }
function dayDiff(fromKey, toKey) { return Math.round((Date.UTC(...toKey.split('-').map((v, i) => i === 1 ? v - 1 : +v)) - Date.UTC(...fromKey.split('-').map((v, i) => i === 1 ? v - 1 : +v))) / DAY); }
const minutesOfDay = d => { const p = parts(d); return p.h * 60 + p.min; };
function relative(iso) {
  const diff = Date.parse(iso) - now().getTime();
  const abs = Math.abs(diff), mins = Math.round(abs / 60000);
  const future = diff >= 0;
  if (mins < 1) return 'maintenant';
  if (mins < 60) return future ? `dans ${mins} min` : `il y a ${mins} min`;
  const hours = Math.floor(mins / 60), rest = mins % 60;
  if (hours < 24 && dayKey(iso) === dayKey(now())) return future ? `dans ${hours} h${rest ? ' ' + String(rest).padStart(2, '0') : ''}` : `il y a ${hours} h`;
  const days = dayDiff(dayKey(now()), dayKey(iso));
  if (days === 1) return `demain ${time(iso)}`;
  if (days === -1) return `hier ${time(iso)}`;
  return future ? `dans ${days} jours` : `il y a ${-days} jours`;
}
function jLabel(iso) {
  const d = dayDiff(dayKey(now()), dayKey(iso));
  if (d < 0) return { text: 'Passé', cls: '' };
  if (d === 0) return { text: 'Aujourd’hui', cls: 'hot' };
  if (d === 1) return { text: 'Demain', cls: 'hot' };
  return { text: `J-${d}`, cls: d <= 3 ? 'hot' : d <= 10 ? 'soon' : '' };
}
const pct = r => r == null ? '—' : `${Math.round(r * 1000) / 10}`.replace('.', ',') + ' %';
function fileExt(f) { const k = f.kind || ''; return { gdoc: 'doc', gsheet: 'sheet', gslides: 'slides' }[k] || (k.length > 4 ? 'file' : k); }

// ======================= Données dérivées =======================
const D = {
  get courses() { return (S.data && S.data.courses) || []; },
  get schedule() { return (S.data && S.data.schedule) || []; },
  get exams() { return (S.data && S.data.exams) || []; },
  course(id) { return this.courses.find(c => c.id === id) || null; },
  courseByCode(code) { return this.courses.find(c => c.code === code) || null; },
  upcomingExams() { const t = now().getTime(); return this.exams.filter(x => Date.parse(x.end) >= t); },
  eventsOn(key) { return this.schedule.filter(e => dayKey(e.start) === key).sort((a, b) => a.start.localeCompare(b.start)); },
  classes() { return this.schedule.filter(e => e.kind !== 'exam'); },
  current() { const t = now().getTime(); return this.classes().find(e => Date.parse(e.start) <= t && Date.parse(e.end) > t) || null; },
  next() { const t = now().getTime(); return this.classes().find(e => Date.parse(e.start) > t) || null; },
  nextFor(courseId) { const t = now().getTime(); return this.classes().find(e => e.courseId === courseId && Date.parse(e.start) > t) || null; },
  nextExamFor(code) { const t = now().getTime(); return this.exams.find(x => x.code === code && Date.parse(x.end) >= t) || null; },
  recentFiles() { return this.courses.flatMap(c => c.files.filter(f => f.isNew).map(f => Object.assign({ course: c }, f))).sort((a, b) => b.seen.localeCompare(a.seen)); },
  attendanceFor(code) { const a = S.data && S.data.attendance; return a && a.courses ? a.courses.find(r => r.code === code) || null : null; },
  alerts() {
    const out = [];
    const sync = S.data && S.data.sync;
    if (sync && sync.inside && sync.inside.connected === false) out.push({ cls: 'danger', icon: 'alert', html: '<b>Session Inside expirée.</b> Reconnectez-vous pour mettre à jour le planning, les examens et la présence.', action: '<button class="btn sm primary" data-act="sync" data-mode="login">Se reconnecter</button>' });
    const units = (S.data && S.data.attendance && S.data.attendance.units) || [];
    for (const u of units.filter(u => u.below)) out.push({ cls: 'warn', icon: 'alert', html: `<b>${esc(u.code)} ${esc(u.name)} : ${pct(u.rate)} de présence</b>, sous le seuil de 85 %. ${u.margin > 0 ? `Encore ${plural(u.margin, 'absence possible', 'absences possibles')} d’ici la fin du semestre` : u.margin === 0 ? 'Plus aucune absence possible d’ici la fin du semestre' : `Limite dépassée de ${plural(-u.margin, 'séance')}`}${S.data.attendance.coverageComplete ? '.' : ' (estimation).'}`, action: '<button class="btn sm" data-act="go" data-to="absences">Voir le détail</button>' });
    return out;
  },
};

// ======================= Navigation =======================
const ALBERT_ROUTES = ['today', 'planning', 'examens', 'absences', 'cours', 'sync', 'bienvenue'];
const ROUTES = ['accueil', 'e', 'j', ...ALBERT_ROUTES, 'reglages', 'assistant', 'notes'];
function go(route) {
  const raw = String(route || 'accueil').replace(/^#\/?/, '');
  const i = raw.indexOf('/');
  const name = i < 0 ? raw : raw.slice(0, i), param = i < 0 ? '' : raw.slice(i + 1);
  const hash = `#/${name}${param ? '/' + param : ''}`;
  if (location.hash !== hash) history.pushState(null, '', hash);
  route_(name, param);
}
function route_(name, param) {
  S.route = ROUTES.includes(name) ? name : 'accueil';
  S.param = param ? safeDecode(param) : null;
  S.drawer = null;
  if (ALBERT_ROUTES.includes(S.route) && S.route !== 'bienvenue') try { localStorage.setItem('ca-albert-open', '1'); } catch {}
  render(true);
}
function safeDecode(v) { try { return decodeURIComponent(v); } catch { return v; } }
window.addEventListener('popstate', () => { const raw = location.hash.replace(/^#\/?/, ''); const i = raw.indexOf('/'); route_((i < 0 ? raw : raw.slice(0, i)) || 'accueil', i < 0 ? '' : raw.slice(i + 1)); });

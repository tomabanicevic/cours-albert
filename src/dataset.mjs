// Construit data.json (interface), le calendrier .ics, le tableau de bord Obsidian et les notifications.
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeName, sha, readJson, writeAtomic, exists } from './util.mjs';
import { UNITS, unitOf, gradingFromSyllabus, parisDay, parisToISO } from './parse.mjs';
import { classifyFile, suggestCourse, CATEGORIES } from './classify.mjs';

export const SECTIONS = ['Materials', 'Overview', 'Syllabus', 'Textbook', 'Drive', 'Bureau'];
export const THRESHOLD = 0.85;
const DAY = 86400_000;
const GENERATED = new Set(['Accueil.md', 'Accueil des cours.md', 'Vue des cours.canvas', 'À LIRE.md', 'Tableau de bord Albert.md']);
export const isGeneratedNote = rel => GENERATED.has(path.basename(rel));

async function walk(dir, rel = '') {
  const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || /\.tmp-\d+/.test(entry.name)) continue;
    const r = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...await walk(dir, r));
    else if (entry.isFile()) out.push(r);
  }
  return out;
}
const shortTitle = full => String(full || '').replace(/^(MAT|DAT|BUS|HUM)\d{2}-\d+\s*[—–-]\s*/i, '').trim() || String(full || '');
const fileKind = name => {
  const ext = path.extname(name).toLowerCase().slice(1);
  if (name.endsWith('.gdoc.md')) return 'gdoc';
  if (name.endsWith('.gsheet.md')) return 'gsheet';
  if (name.endsWith('.gslides.md')) return 'gslides';
  return ext || 'file';
};
export function currentSemester(now, academicYearStart) {
  const y = academicYearStart;
  const s1End = Date.parse(parisToISO(y + 1, 0, 31, 23, 59));
  return now.getTime() <= s1End
    ? { code: 'S1', start: parisToISO(y, 7, 25), end: parisToISO(y + 1, 0, 31, 23, 59) }
    : { code: 'S2', start: parisToISO(y + 1, 1, 1), end: parisToISO(y + 1, 6, 31, 23, 59) };
}

async function courseFiles(folder, seen, now, firstRun) {
  const files = [];
  for (const rel of await walk(folder)) {
    if (path.basename(rel) === 'Accueil.md') continue;
    const [section] = rel.split(path.sep);
    if (!SECTIONS.includes(section)) continue;
    const full = path.join(folder, rel);
    const st = await fs.stat(full).catch(() => null);
    if (!st) continue;
    if (!seen[full]) seen[full] = firstRun ? '2000-01-01T00:00:00.000Z' : now.toISOString();
    const parts = rel.split(path.sep);
    files.push({
      name: path.basename(rel), section, rel: parts.slice(1).join('/'), path: full,
      size: st.size, mtime: st.mtime.toISOString(), seen: seen[full], kind: fileKind(rel),
      isNew: now.getTime() - Date.parse(seen[full]) < 7 * DAY,
      ...classifyFile(path.basename(rel), { section, kind: fileKind(rel), folders: parts.slice(1, -1) }),
    });
  }
  const order = s => SECTIONS.indexOf(s);
  return files.sort((a, b) => order(a.section) - order(b.section) || a.rel.localeCompare(b.rel, 'fr'));
}

// ---------- Notes de l’étudiant dans le vault ----------
const SKIP_DIRS = new Set(['90_Meta', 'Attachments', 'Imports', 'Mails', 'node_modules', 'Ressources synchronisées', 'Templates', 'Backups', 'Copies locales', '40_Archive']);
const CODE_DIR = /^((?:MAT|DAT|BUS|HUM)\d{2}-\d+)(?![0-9])/i;
async function vaultRootOf(folder) {
  for (let dir = path.resolve(folder); dir !== path.dirname(dir); dir = path.dirname(dir)) if (await exists(path.join(dir, '.obsidian'))) return dir;
  return null;
}
async function frontmatter(file) {
  const fh = await fs.open(file, 'r').catch(() => null);
  if (!fh) return {};
  try {
    const buf = Buffer.alloc(2048);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const m = buf.subarray(0, bytesRead).toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const out = {};
    if (m) for (const row of m[1].split(/\r?\n/)) { const k = row.match(/^([A-Za-z_][\w-]*):\s*(.*)$/); if (k) out[k[1].toLowerCase()] = k[2].trim().replace(/^["']|["']$/g, ''); }
    return out;
  } finally { await fh.close(); }
}
/** Notes rangées dans le vault dans un dossier qui porte le code du cours (ex. « 01 Maths/MAT11-1 — Foundations »). */
export async function vaultNotes(vaultRoot, libraryRoot) {
  const byCode = new Map();
  if (!vaultRoot) return byCode;
  const library = path.resolve(libraryRoot);
  const dirs = [];
  async function find(dir, depth) {
    if (depth > 3) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (full === library || full.startsWith(library + path.sep)) continue;
      const code = e.name.match(CODE_DIR)?.[1]?.toUpperCase();
      if (code) dirs.push([code, full]); else await find(full, depth + 1);
    }
  }
  await find(vaultRoot, 0);
  for (const [code, dir] of dirs) {
    for (const rel of (await walk(dir)).slice(0, 400)) {
      const full = path.join(dir, rel);
      const st = await fs.stat(full).catch(() => null);
      if (!st) continue;
      const name = path.basename(rel), parts = rel.split(path.sep);
      const fm = /\.md$/i.test(name) ? await frontmatter(full) : {};
      const chapter = fm.chapitre !== undefined && fm.chapitre !== '' && Number.isFinite(Number(fm.chapitre)) ? Number(fm.chapitre) : undefined;
      const cls = classifyFile(name, { kind: fileKind(rel), folders: parts.slice(0, -1), type: ['cours', 'exercice', 'projet'].includes(fm.type) ? fm.type : undefined, rank: chapter });
      const home = parts.length === 1 && name.toUpperCase().startsWith(code);
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push({
        name, rel: parts.join('/'), path: full, size: st.size, mtime: st.mtime.toISOString(), kind: fileKind(rel), source: 'vault',
        folder: path.relative(vaultRoot, dir).split(path.sep).join('/'), ...cls, ...(home ? { category: 'infos', rank: 0, title: 'Page du cours' } : {}),
      });
    }
  }
  return byCode;
}
/** Mots-clés par cours (90_Meta/Rangement/cours.json du vault), pour proposer un cours aux fichiers non classés. */
async function courseKeywords(vaultRoot) {
  if (!vaultRoot) return {};
  const rules = await readJson(path.join(vaultRoot, '90_Meta', 'Rangement', 'cours.json'), null);
  const out = {};
  for (const [code, c] of Object.entries(rules?.cours || {})) if (Array.isArray(c?.mots)) out[code.toUpperCase()] = c.mots.filter(w => typeof w === 'string').slice(0, 80);
  return out;
}

function attendanceView(state, schedule, semester, now) {
  const att = state.attendance || { summary: [], sessions: {}, other: [] };
  const byCode = new Map((att.summary || []).map(r => [r.code, r]));
  const units = [];
  for (const unit of Object.keys(UNITS)) {
    const rows = (att.summary || []).filter(r => r.unit === unit);
    const planned = schedule.filter(e => e.kind === 'cours' && e.unit === unit && Date.parse(e.start) > now.getTime() && Date.parse(e.start) <= Date.parse(semester.end));
    if (!rows.length && !planned.length) continue;
    const attended = rows.reduce((s, r) => s + r.attended, 0);
    const total = rows.reduce((s, r) => s + r.total, 0);
    const pending = rows.reduce((s, r) => s + (r.pending || 0), 0);
    const absences = Math.max(0, total - attended - pending);
    const plannedTotal = total + planned.length;
    const allowed = Math.floor(plannedTotal * (1 - THRESHOLD) + 1e-9);
    units.push({
      ...UNITS[unit], attended, total, pending, absences,
      rate: total ? attended / total : null,
      below: total > 0 && attended / total < THRESHOLD,
      remainingSessions: planned.length, plannedTotal, allowedAbsences: allowed, margin: allowed - absences,
    });
  }
  const absences = [];
  for (const row of att.summary || []) {
    for (const s of (att.sessions || {})[row.courseId] || []) {
      if (['absent', 'late', 'excused'].includes(s.status)) absences.push({ ...s, code: row.code, title: row.title, courseId: row.courseId, unit: row.unit });
    }
  }
  absences.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return {
    threshold: THRESHOLD, checked: att.checked || null, units,
    courses: (att.summary || []).map(r => ({ ...r, sessions: (att.sessions || {})[r.courseId] || [] })),
    absences, other: att.other || [],
    coverageComplete: !!state.scheduleCoverage?.to && Date.parse(state.scheduleCoverage.to) >= Date.parse(semester.end) - 7 * DAY,
    byCode: Object.fromEntries(byCode),
  };
}

function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m); }
function icsDate(iso) { return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function fold(line) { const out = []; let rest = line; while (Buffer.byteLength(rest) > 74) { let cut = 74; while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--; out.push(rest.slice(0, cut)); rest = ' ' + rest.slice(cut); } out.push(rest); return out.join('\r\n'); }
export function buildICS(schedule, exams, stamp) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cours Albert//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Albert School', 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  const add = (uid, start, end, summary, location, description) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}@cours-albert`, `DTSTAMP:${icsDate(stamp)}`, `DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end > start ? end : new Date(Date.parse(start) + 30 * 60000).toISOString())}`, fold(`SUMMARY:${icsEscape(summary)}`));
    if (location) lines.push(fold(`LOCATION:${icsEscape(location)}`));
    if (description) lines.push(fold(`DESCRIPTION:${icsEscape(description)}`));
    lines.push('END:VEVENT');
  };
  for (const e of schedule) if (e.kind !== 'exam') add(sha(Buffer.from(e.id)).slice(0, 24), e.start, e.end, `${e.code ? e.code + ' · ' : ''}${e.title}`, e.room, e.teacher);
  for (const x of exams) add(sha(Buffer.from('exam|' + x.id)).slice(0, 24), x.start, x.end, `Examen · ${x.name} · ${x.code}`, '', `${x.courseTitle}${x.coeff != null ? ` — coefficient ${x.coeff}` : ''}${x.durationMin ? ` — ${x.durationMin} min` : ''}`);
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const fmtDay = iso => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const pct = r => r == null ? '—' : `${(r * 100).toFixed(r === 1 ? 0 : 1).replace('.', ',')} %`;

/** Lignes ajoutées à la page Accueil.md d’un cours (dates absolues, pas de « dans 3 jours »). */
export function courseNoteExtras(state, code, now = new Date()) {
  const lines = [];
  const today = parisDay(now.toISOString());
  const exams = (state.exams || []).filter(x => x.code === code && parisDay(x.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  if (exams.length) {
    lines.push('## Évaluations à venir', '', '| Date | Épreuve | Durée | Coeff. |', '| --- | --- | --- | --- |');
    for (const x of exams) lines.push(`| ${fmtDay(x.start)} · ${fmtTime(x.start)} | ${x.name} | ${x.durationMin ? x.durationMin + ' min' : '—'} | ${x.coeff ?? '—'} |`);
    lines.push('');
  }
  const row = (state.attendance?.summary || []).find(r => r.code === code);
  if (row) {
    lines.push('## Présence', '', `${row.attended}/${row.total} séances · ${pct(row.rate)}${row.rate != null && row.rate < THRESHOLD ? ' — **sous le seuil de 85 %**' : ''}`, '');
    const missed = ((state.attendance.sessions || {})[row.courseId] || []).filter(s => s.status === 'absent');
    if (missed.length) { for (const s of missed) lines.push(`- Absence le ${fmtDay(s.start)} à ${fmtTime(s.start)}`); lines.push(''); }
  }
  return lines;
}

function dashboardNote(data) {
  const now = new Date(data.generatedAt);
  const lines = ['---', 'type: tableau-de-bord', 'tags: [albert-school, cours-albert]', '---', '', '# Tableau de bord Albert', '', '> Page générée par l’application Cours Albert. Modifiez-la librement : l’app cessera alors de la mettre à jour.', ''];
  const upcoming = data.exams.filter(x => Date.parse(x.end) >= now.getTime()).slice(0, 12);
  lines.push('## Prochains examens', '');
  if (!upcoming.length) lines.push('Aucun examen à venir.', '');
  else {
    lines.push('| Date | Épreuve | Cours | Durée | Coeff. |', '| --- | --- | --- | --- | --- |');
    for (const x of upcoming) lines.push(`| ${fmtDay(x.start)} · ${fmtTime(x.start)} | ${x.name} | ${x.code} — ${x.courseTitle} | ${x.durationMin ? x.durationMin + ' min' : '—'} | ${x.coeff ?? '—'} |`);
    lines.push('');
  }
  lines.push('## Présence (seuil 85 % par unité)', '');
  if (!data.attendance.units.length) lines.push('Pas encore de données de présence.', '');
  else {
    lines.push('| Unité | Présent | Taux | Absences possibles d’ici la fin du semestre |', '| --- | --- | --- | --- |');
    for (const u of data.attendance.units) lines.push(u.total
      ? `| ${u.code} ${u.name} | ${u.attended}/${u.total} | ${pct(u.rate)}${u.below ? ' ⚠︎' : ''} | ${u.margin >= 0 ? u.margin : `dépassé de ${-u.margin}`}${data.attendance.coverageComplete ? '' : ' (estimation)'} |`
      : `| ${u.code} ${u.name} | — | — | pas encore de séance comptée |`);
    lines.push('');
  }
  if (data.attendance.absences.length) {
    lines.push('### Absences', '');
    for (const a of data.attendance.absences) lines.push(`- ${fmtDay(a.start)} ${fmtTime(a.start)} — ${a.code} ${a.title}${a.status !== 'absent' ? ` (${a.statusLabel})` : ''}`);
    lines.push('');
  }
  lines.push(`Données Inside du ${new Date(data.sync.inside?.checked || data.generatedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' })}.`, '');
  return lines.join('\n');
}

function diffNotifications(prev, next, prefs = {}, at = new Date()) {
  if (!prev?.version) return [];
  const on = key => prefs[key] !== false;
  const out = [];
  const now = at.getTime();
  if (on('exams')) {
    const before = new Map((prev.exams || []).map(x => [x.id, x]));
    for (const x of next.exams) {
      const old = before.get(x.id);
      if (Date.parse(x.end) < now) continue;
      if (!old) out.push({ title: `Nouvel examen · ${x.code}`, body: `${x.name} — ${fmtDay(x.start)} à ${fmtTime(x.start)}`, route: 'examens' });
      else if (old.start !== x.start) out.push({ title: `Examen déplacé · ${x.code}`, body: `${x.name} : ${fmtDay(x.start)} à ${fmtTime(x.start)} (avant : ${fmtDay(old.start)} ${fmtTime(old.start)})`, route: 'examens' });
    }
  }
  if (on('absences')) {
    const before = new Set((prev.attendance?.absences || []).map(a => `${a.courseId}|${a.start}`));
    for (const a of next.attendance.absences) {
      if (before.has(`${a.courseId}|${a.start}`)) continue;
      const unit = next.attendance.units.find(u => u.code === a.unit);
      out.push({ title: `Absence enregistrée · ${a.code}`, body: `${fmtDay(a.start)} ${fmtTime(a.start)}${unit?.rate != null ? ` — ${unit.code} à ${pct(unit.rate)}` : ''}`, route: 'absences' });
    }
  }
  if (on('materials')) {
    const before = new Set((prev.courses || []).flatMap(c => (c.files || []).map(f => f.path)));
    const counts = new Map();
    for (const c of next.courses) for (const f of c.files) if (f.isNew && !before.has(f.path)) counts.set(c, [...(counts.get(c) || []), f]);
    for (const [c, files] of counts) out.push({ title: `${files.length > 1 ? `${files.length} nouveaux supports` : 'Nouveau support'} · ${c.code}`, body: files.slice(0, 3).map(f => f.name).join(', '), route: `cours/${c.id}` });
  }
  if (on('changes')) {
    const next7 = now + 7 * DAY;
    const after = new Map(next.schedule.map(e => [e.id, e]));
    const covered = e => Date.parse(e.start) > now && Date.parse(e.start) < next7 && e.kind === 'cours';
    for (const e of (prev.schedule || []).filter(covered)) {
      const same = after.get(e.id);
      if (same) { if (same.room && e.room && same.room !== e.room) out.push({ title: `Changement de salle · ${e.code}`, body: `${fmtDay(e.start)} ${fmtTime(e.start)} : ${same.room} (au lieu de ${e.room})`, route: 'planning' }); continue; }
      const moved = next.schedule.find(n => n.courseId === e.courseId && parisDay(n.start) === parisDay(e.start) && !(prev.schedule || []).some(p => p.id === n.id));
      out.push(moved
        ? { title: `Horaire modifié · ${e.code}`, body: `${fmtDay(e.start)} : ${fmtTime(moved.start)}–${fmtTime(moved.end)} (au lieu de ${fmtTime(e.start)})`, route: 'planning' }
        : { title: `Séance retirée du planning · ${e.code}`, body: `${e.title} — ${fmtDay(e.start)} à ${fmtTime(e.start)}`, route: 'planning' });
    }
  }
  if (on('grades') && (next.grades?.rows?.length || 0) > (prev.grades?.rows?.length || 0)) out.push({ title: 'Nouvelle note publiée', body: 'Ouvrez Cours Albert pour la consulter.', route: 'examens' });
  return out.slice(0, 8);
}

export async function buildDataset({ config, state, report, supportDir, now = new Date(), writeNotes = true }) {
  const libraryRoot = config.vaultCourses;
  const courseRoot = path.join(libraryRoot, 'Cours');
  const semester = currentSemester(now, config.academicYearStart || now.getFullYear());
  const firstRun = !state.fileSeen;
  const seen = state.fileSeen ||= {};

  const vaultRoot = await vaultRootOf(libraryRoot).catch(() => null);
  const notesByCode = await vaultNotes(vaultRoot, libraryRoot).catch(() => new Map());
  const keywords = await courseKeywords(vaultRoot).catch(() => ({}));
  const courses = [];
  for (const [id, c] of Object.entries(state.courses || {})) {
    if (!c?.title) continue;
    const code = String(c.code || '').toUpperCase();
    const folder = path.join(courseRoot, c.semester === 'S2' ? 'S2' : 'S1', safeName(c.title));
    const files = await courseFiles(folder, seen, now, firstRun);
    const syllabus = files.find(f => f.section === 'Syllabus' && f.name === 'syllabus.md');
    const grading = syllabus ? gradingFromSyllabus(await fs.readFile(syllabus.path, 'utf8').catch(() => '')) : [];
    const notes = notesByCode.get(code) || [];
    courses.push({
      id, code, unit: unitOf(code), title: shortTitle(c.title), fullTitle: c.title, semester: c.semester || 'S1',
      teacher: c.teacher || '', url: c.url, folder, files, grading, notes, keywords: keywords[code] || [],
      fileCount: files.length, newCount: files.filter(f => f.isNew).length,
    });
  }
  courses.sort((a, b) => a.code.localeCompare(b.code, 'fr', { numeric: true }));
  const courseRefs = courses.map(c => ({ id: c.id, code: c.code, title: c.title, unit: c.unit, keywords: c.keywords }));
  const unclassified = [];
  for (const rel of await walk(path.join(courseRoot, 'À classer'))) {
    const full = path.join(courseRoot, 'À classer', rel);
    const st = await fs.stat(full).catch(() => null);
    const parts = rel.split(path.sep);
    if (st) unclassified.push({
      name: path.basename(rel), rel: parts.join('/'), path: full, size: st.size, mtime: st.mtime.toISOString(), kind: fileKind(rel),
      ...classifyFile(path.basename(rel), { kind: fileKind(rel), folders: parts.slice(0, -1) }), suggestion: suggestCourse(parts.slice(1).join('/'), courseRefs),
    });
  }
  for (const key of Object.keys(seen)) if (!(await exists(key))) delete seen[key];

  const byStart = new Map((state.exams || []).map(x => [x.start, x]));
  const schedule = Object.values(state.schedule || {}).map(e => {
    if (e.kind !== 'exam') return e;
    const exam = byStart.get(e.start);
    return exam ? { ...e, code: exam.code, unit: exam.unit, courseTitle: exam.courseTitle, examId: exam.id } : e;
  }).sort((a, b) => a.start.localeCompare(b.start));
  const courseByCode = new Map(courses.map(c => [c.code, c]));
  const exams = (state.exams || []).map(x => ({ ...x, courseId: courseByCode.get(x.code)?.id || null })).sort((a, b) => a.start.localeCompare(b.start));

  const lastRun = await readJson(path.join(supportDir, 'last-run.json'), null);
  const data = {
    version: 2,
    generatedAt: now.toISOString(),
    student: { firstName: state.student?.firstName || '' },
    semester,
    library: { root: libraryRoot, courses: courseRoot, vault: vaultRoot, report: path.join(libraryRoot, 'Ressources synchronisées', 'État de la synchronisation.md'), ics: path.join(libraryRoot, 'Emploi du temps Albert.ics'), dashboard: path.join(courseRoot, 'Tableau de bord Albert.md') },
    units: Object.values(UNITS), categories: CATEGORIES,
    courses, unclassified, schedule, exams,
    grades: state.grades || { headers: [], rows: [] },
    attendance: attendanceView(state, schedule, semester, now),
    news: (state.news || []).slice(0, 30),
    coverage: state.scheduleCoverage || null,
    sync: {
      started: report?.started || lastRun?.started || null,
      finished: report?.finished || lastRun?.finished || null,
      added: report?.added ?? lastRun?.added ?? 0, updated: report?.updated ?? lastRun?.updated ?? 0,
      errors: report?.errors || lastRun?.errors || [], warnings: report?.warnings || lastRun?.warnings || [],
      inside: { connected: report?.insideConnected ?? lastRun?.insideConnected ?? null, offline: !!(report?.offline ?? lastRun?.offline), checked: state.scheduleChecked || null },
      drive: report?.driveConnected ?? lastRun?.driveConnected ?? false,
      mirror: report?.driveMirror || lastRun?.driveMirror || null,
      organization: report?.organization || lastRun?.organization || null,
      automatic: config.automatic !== false,
    },
  };

  const previous = await readJson(path.join(supportDir, 'data.json'), null);
  if (report) report.notifications = diffNotifications(previous, data, config.notifications || {}, now);
  await writeAtomic(path.join(supportDir, 'data.json'), JSON.stringify(data));
  if (schedule.length || exams.length) await writeAtomic(data.library.ics, buildICS(schedule, exams, now.toISOString()));
  if (writeNotes && await isInVault(libraryRoot)) await generatedWrite(data.library.dashboard, dashboardNote(data), state);
  return data;
}

async function isInVault(folder) {
  for (let dir = path.resolve(folder); dir !== path.dirname(dir); dir = path.dirname(dir)) if (await exists(path.join(dir, '.obsidian'))) return true;
  return false;
}
/** N’écrase jamais une note générée que l’étudiant a modifiée. */
export async function generatedWrite(file, content, state) {
  const bytes = Buffer.from(content), current = await fs.readFile(file).catch(() => null);
  const generated = state.generatedFiles ||= {};
  if (current && current.equals(bytes)) { generated[file] = sha(bytes); return true; }
  if (current && sha(current) !== generated[file]) return false;
  await writeAtomic(file, bytes);
  generated[file] = sha(bytes);
  return true;
}

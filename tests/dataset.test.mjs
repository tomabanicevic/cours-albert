// Test hors ligne de la couche de données (et génération des données de démonstration de l’interface).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scheduleItem, examRow, attendanceRow, attendanceSession, newsItem } from '../src/parse.mjs';
import { buildDataset, buildICS } from '../src/dataset.mjs';
import { organizeCourses } from '../src/organize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, 'fixtures');
const sample = JSON.parse(await fs.readFile(path.join(fixtures, 'inside-sample.json'), 'utf8'));
const now = new Date(sample.now);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-data-'));
try {
  const vault = path.join(tmp, 'Vault');
  const library = path.join(vault, '20_Areas', 'Bachelor-BDAI');
  const courseRoot = path.join(library, 'Cours');
  const support = path.join(tmp, 'support');
  await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
  await fs.mkdir(support, { recursive: true });
  for (const line of (await fs.readFile(path.join(fixtures, 'filelist.tsv'), 'utf8')).trim().split('\n')) {
    const [rel, size] = line.split('\t');
    const file = path.join(courseRoot, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, ''); await fs.truncate(file, Number(size));
  }
  const courses = JSON.parse(await fs.readFile(path.join(fixtures, 'courses.json'), 'utf8'));
  for (const line of (await fs.readFile(path.join(fixtures, 'grading.tsv'), 'utf8')).trim().split('\n')) {
    const [code, rows] = line.split('\t');
    const course = Object.values(courses).find(c => c.code === code);
    const table = rows.split(';').map(r => `| ${r.split('|').map((v, i) => i === 1 ? v + '%' : v).join(' | ')} |`).join('\n');
    const file = path.join(courseRoot, 'S1', course.title, 'Syllabus', 'syllabus.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `# ${course.title}\n\n## Grading breakdown\n\n| Component | Weight | Kind | Duration |\n| --- | --- | --- | --- |\n${table}\n\n## Other\n`);
  }
  const schedule = Object.fromEntries(sample.schedule.map(scheduleItem).filter(Boolean).map(e => [e.id, e]));
  for (const e of Object.values(schedule)) if (e.courseId && courses[e.courseId]) courses[e.courseId].teacher ||= e.teacher;
  const summary = sample.attendance.summary.map(c => ({ ...attendanceRow(c), courseId: c.href.match(/courses\/([0-9a-f-]{36})/)[1], pending: 0 }));
  const sessions = Object.fromEntries(Object.entries(sample.attendance.sessions).map(([id, rows]) => [id, rows.map(([w, s]) => attendanceSession(w, s))]));
  const state = {
    files: {}, courses, schedule, student: { firstName: sample.student },
    exams: sample.exams.map(examRow).filter(Boolean),
    attendance: { summary, sessions, other: [], checked: sample.now },
    news: sample.news.map(n => newsItem({ ...n, now: sample.now })).filter(Boolean),
    scheduleCoverage: { from: '2026-09-07T00:00:00.000Z', to: '2026-10-07T00:00:00.000Z' },
    scheduleChecked: sample.now,
  };
  const config = { vaultCourses: library, academicYearStart: 2026, automatic: true };
  const report = { started: sample.now, finished: sample.now, added: 0, updated: 0, errors: [], warnings: [], insideConnected: true, driveConnected: true };

  await organizeCourses({ libraryRoot: library, sourceRoot: path.join(library, 'Ressources synchronisées'), state, report });
  let data = await buildDataset({ config, state, report, supportDir: support, now });
  assert.equal(data.courses.length, 14);
  assert.equal(data.courses.every(c => c.newCount === 0), true, 'premier passage : rien n’est « nouveau »');
  const dat121 = data.courses.find(c => c.code === 'DAT12-1');
  assert.equal(dat121.grading.length, 2);
  assert.equal(dat121.teacher, 'Inès Moreau');
  assert.equal(data.unclassified.length, 13);
  assert.equal(data.exams.length, 32);
  assert.equal(data.exams.find(x => x.name === 'MCQ' && x.code === 'DAT12-1').courseId, '218fa0ff-af78-4ebf-a6bf-1bfa58cd72fe');
  const examEvent = data.schedule.find(e => e.kind === 'exam' && e.start === '2026-09-28T09:05:00.000Z');
  assert.equal(examEvent.code, 'DAT12-1', 'examen du planning relié à son cours');
  const dat = data.attendance.units.find(u => u.code === 'DAT12');
  assert.deepEqual([dat.attended, dat.total, dat.below, dat.absences], [4, 5, true, 1]);
  assert.ok(dat.remainingSessions > 0 && dat.plannedTotal === dat.total + dat.remainingSessions);
  assert.equal(dat.allowedAbsences, Math.floor(dat.plannedTotal * 0.15 + 1e-9));
  assert.equal(data.attendance.absences.length, 1);
  assert.equal(data.attendance.absences[0].code, 'DAT12-1');
  assert.equal(data.attendance.coverageComplete, false);
  assert.deepEqual(report.notifications, [], 'pas de notification au premier passage');
  const ics = await fs.readFile(data.library.ics, 'utf8');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('DTSTART:20260924T060000Z') && ics.includes('SUMMARY:Examen · MCQ · DAT12-1'));
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75), 'lignes .ics repliées');
  const dashboard = await fs.readFile(data.library.dashboard, 'utf8');
  assert.ok(dashboard.includes('## Prochains examens') && dashboard.includes('DAT12 Data'));
  const note = await fs.readFile(path.join(courseRoot, 'S1', 'DAT12-1 — Introduction to Data with Spreadsheet', 'Accueil.md'), 'utf8');
  assert.ok(note.includes('## Évaluations à venir') && note.includes('## Présence') && note.includes('sous le seuil'), note);
  const index = await fs.readFile(path.join(courseRoot, 'Accueil des cours.md'), 'utf8');
  assert.ok(index.includes('Tableau de bord Albert.md'));

  // Deuxième passage : nouveaux supports, examen déplacé, absence, changement de salle.
  const fresh = ['TD3 -- MAT11-1.pdf'];
  for (const name of fresh) await fs.writeFile(path.join(courseRoot, 'S1', 'MAT11-1 — Foundations', 'Materials', name), 'pdf');
  for (const name of ['Gorillas.pdf', 'The IKEA effect.pdf', 'When choice is demovating.pdf', 'Pas vu - pas pris.pdf']) await fs.writeFile(path.join(courseRoot, 'S1', 'BUS13-1 — Marketing Fundamentals', 'Materials', name), 'pdf');
  const moved = state.exams.find(x => x.name === 'Project 1');
  moved.start = moved.end = '2026-10-02T12:00:00.000Z';
  state.attendance.sessions['340a6d3d-c577-46fe-8399-3982462ac46f'] = [attendanceSession('Sept 24, 2026 · 10:20 AM–11:50 AM', 'Absent')];
  const tomorrow = Object.values(state.schedule).find(e => e.code === 'BUS13-2' && e.start.startsWith('2026-09-25'));
  tomorrow.room = 'SQUARE Room';
  data = await buildDataset({ config, state, report, supportDir: support, now: new Date(now.getTime() + 30 * 60000) });
  const titles = report.notifications.map(n => n.title);
  assert.ok(titles.includes('Examen déplacé · BUS13-5'), titles.join(' / '));
  assert.ok(titles.includes('Absence enregistrée · MAT11-1'), titles.join(' / '));
  assert.ok(titles.includes('4 nouveaux supports · BUS13-1'), titles.join(' / '));
  assert.ok(titles.includes('Nouveau support · MAT11-1'), titles.join(' / '));
  assert.ok(titles.includes('Changement de salle · BUS13-2'), titles.join(' / '));
  assert.equal(data.courses.find(c => c.code === 'BUS13-1').newCount, 4);

  // Données de démonstration pour développer l’interface dans un navigateur.
  moved.start = moved.end = '2026-10-02T09:00:00.000Z';
  tomorrow.room = 'CIRCLE Room';
  delete state.attendance.sessions['340a6d3d-c577-46fe-8399-3982462ac46f'];
  data = await buildDataset({ config, state, report, supportDir: support, now: new Date(now.getTime() + 60 * 60000) });
  const real = '/Users/etudiant/Documents/Vault';
  const demo = JSON.stringify(data).split(vault).join(real);
  await fs.writeFile(path.join(here, '..', 'src', 'ui', 'demo-data.json'), demo);
  assert.equal(buildICS([], [], sample.now).includes('END:VCALENDAR'), true);
  console.log(`OK : données de l’app (${data.courses.length} cours, ${data.schedule.length} séances, ${data.exams.length} examens), notes Obsidian, .ics et notifications.`);
} finally {
  if (process.env.KEEP) console.log(tmp); else await fs.rm(tmp, { recursive: true, force: true });
}

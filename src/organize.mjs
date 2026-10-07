import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { courseNoteExtras } from './dataset.mjs';
import { classifyFile, groupFiles } from './classify.mjs';

const groups = ['Inside Albert', 'Google Drive', 'Bureau', 'Bureau BAC 1'];
const categories = ['Overview', 'Materials', 'Syllabus', 'Textbook', 'Drive', 'Bureau'];

function safeName(value) {
  return String(value).normalize('NFC').replace(/[\x00-\x1f/\\:]/g, '_').replace(/^\.+$/, '_').trim().slice(0, 180) || 'Sans nom';
}
function normalized(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, file);
}
async function filesUnder(dir, relative = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = path.join(relative, entry.name), full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full, rel));
    else if (entry.isFile()) out.push({ rel, full });
  }
  return out;
}
function knownCourses(state) {
  return Object.entries(state.courses || {}).filter(([, c]) => c?.title).map(([id, c]) => ({
    id, title: safeName(c.title),
    code: String(c.code || c.title.match(/^(MAT|DAT|BUS|HUM)\d{2}-\d+/i)?.[0] || '').toUpperCase(),
    semester: c.semester === 'S2' ? 'S2' : 'S1',
    titleWords: normalized(c.title.replace(/^(MAT|DAT|BUS|HUM)\d{2}-\d+\s*/i, '')),
  }));
}
function matchCourse(rel, courses) {
  const code = rel.match(/(?:^|[^A-Z0-9])((?:MAT|DAT|BUS|HUM)\d{2}-\d+)(?=$|[^0-9])/i)?.[1]?.toUpperCase();
  if (code) return courses.find(c => c.code === code) || null;
  const folder = normalized(rel.split(path.sep)[0]);
  const aliases = { marketing: 'BUS13-1', finance: 'BUS13-3', 'bdd synchrone': 'BUS13-5' };
  if (aliases[folder]) return courses.find(c => c.code === aliases[folder]) || null;
  if (folder.length >= 5) {
    const matches = courses.filter(c => c.titleWords && (` ${c.titleWords} `).includes(` ${folder} `));
    if (matches.length === 1) return matches[0];
  }
  return null;
}
function destinationFor(group, rel, courses, courseRoot) {
  const parts = rel.split(path.sep).map(safeName);
  if (group === 'Inside Albert' && parts.length >= 3 && ['S1', 'S2'].includes(parts[0])) {
    const [semester, title, ...rest] = parts;
    const filename = rest[rest.length - 1].toLowerCase();
    const section = rest[0] === 'Materials' ? 'Materials' : filename.startsWith('overview.') ? 'Overview' : filename.startsWith('syllabus.') ? 'Syllabus' : filename.startsWith('textbook.') ? 'Textbook' : 'Materials';
    const tail = rest[0] === 'Materials' ? rest.slice(1) : rest;
    return { dest: path.join(courseRoot, semester, title, section, ...tail), classified: true };
  }
  if (group === 'Google Drive') {
    const course = matchCourse(rel, courses);
    if (course) return { dest: path.join(courseRoot, course.semester, course.title, 'Drive', ...parts), classified: true };
    return { dest: path.join(courseRoot, 'À classer', 'Google Drive', ...parts), classified: false };
  }
  const course = matchCourse(rel, courses);
  if (course) return { dest: path.join(courseRoot, course.semester, course.title, 'Bureau', ...parts), classified: true };
  return { dest: path.join(courseRoot, 'À classer', 'Bureau', ...parts), classified: false };
}
async function copySafe(key, src, dest, organized, stats, report) {
  const bytes = await fs.readFile(src), incoming = hash(bytes), old = organized[key];
  const originalDest = dest;
  if (await exists(dest)) {
    const current = hash(await fs.readFile(dest));
    if (current === incoming) { stats.unchanged++; organized[key] = { path: dest, hash: incoming }; return; }
    if (!old || old.path !== dest || current !== old.hash) {
      const ext = path.extname(dest), stem = ext ? dest.slice(0, -ext.length) : dest;
      dest = `${stem} — source ${incoming.slice(0, 8)}${ext}`;
      if (await exists(dest)) {
        if (hash(await fs.readFile(dest)) === incoming) { stats.unchanged++; organized[key] = { path: dest, hash: incoming }; return; }
        report.errors.push(`Rangement : ${path.basename(dest)} a été modifié localement. Le fichier source est resté dans Ressources synchronisées.`);
        return;
      }
      report.errors.push(`Rangement : modification locale conservée dans ${path.basename(originalDest)} ; nouvelle version rangée séparément.`);
    } else stats.updated++;
  } else stats.added++;
  await atomicWrite(dest, bytes);
  organized[key] = { path: dest, hash: incoming };
}

async function generatedWrite(file, content, state) {
  const bytes = Buffer.from(content), current = await fs.readFile(file).catch(() => null);
  const generated = state.generatedFiles ||= {};
  if (current && current.equals(bytes)) { generated[file] = hash(bytes); return true; }
  if (current && hash(current) !== generated[file]) return false;
  if (!current || !current.equals(bytes)) await atomicWrite(file, bytes);
  generated[file] = hash(bytes);
  return true;
}
async function vaultRootFor(libraryRoot) {
  for (let folder = path.resolve(libraryRoot); folder !== path.dirname(folder); folder = path.dirname(folder)) {
    if (await exists(path.join(folder, '.obsidian'))) return folder;
  }
  return null;
}
/** Supports de chaque cours, rangés par catégorie et dans l’ordre (automatique ou choisi dans l’app). */
async function sortedCourseFiles({ libraryRoot, courseRoot, courses, overrides }) {
  const key = full => path.relative(libraryRoot, full).split(path.sep).join('/');
  const byCourse = new Map(courses.map(c => [c.id, []]));
  for (const course of courses) {
    const folder = path.join(courseRoot, course.semester, course.title);
    for (const section of categories) for (const f of await filesUnder(path.join(folder, section))) {
      if (f.rel === 'Accueil.md') continue;
      const parts = f.rel.split(path.sep);
      const target = overrides[key(f.full)]?.course;
      const owner = target && byCourse.has(target) ? target : course.id;
      byCourse.get(owner).push({ name: parts[parts.length - 1], path: f.full, key: key(f.full), kind: path.extname(f.full).slice(1).toLowerCase(), ...classifyFile(parts[parts.length - 1], { section, folders: parts.slice(0, -1) }) });
    }
  }
  for (const f of await filesUnder(path.join(courseRoot, 'À classer'))) {
    const target = overrides[key(f.full)]?.course;
    if (!target || !byCourse.has(target)) continue;
    const parts = f.rel.split(path.sep);
    byCourse.get(target).push({ name: parts[parts.length - 1], path: f.full, key: key(f.full), kind: path.extname(f.full).slice(1).toLowerCase(), ...classifyFile(parts[parts.length - 1], { folders: parts.slice(0, -1) }) });
  }
  return new Map([...byCourse].map(([id, files]) => [id, groupFiles(files, overrides, f => f.key)]));
}

async function makeObsidianView({ libraryRoot, courseRoot, courses, state, report, overrides = {} }) {
  const index = ['# Mes cours Albert School', '', '## Semestre 1', ''];
  for (const course of courses.filter(c => c.semester === 'S1')) index.push(`- [${course.title}](<./S1/${course.title}/Accueil.md>)`);
  index.push('', '## Semestre 2', '');
  for (const course of courses.filter(c => c.semester === 'S2')) index.push(`- [${course.title}](<./S2/${course.title}/Accueil.md>)`);
  index.push('', '[Supports à classer](<./À classer>)', '');
  index.splice(1, 0, '', '[Tableau de bord : examens, présence et absences](<./Tableau de bord Albert.md>)');
  await generatedWrite(path.join(courseRoot, 'Accueil des cours.md'), index.join('\n'), state);
  const sorted = await sortedCourseFiles({ libraryRoot, courseRoot, courses, overrides });
  for (const course of courses) {
    const folder = path.join(courseRoot, course.semester, course.title);
    const lines = [`# ${course.title}`, '', `Semestre ${course.semester.slice(1)} · Albert School`, '', ...courseNoteExtras(state, course.code)];
    const groups = sorted.get(course.id) || [];
    if (!groups.length) lines.push('Aucun support pour le moment.', '');
    for (const group of groups) {
      lines.push(`## ${group.label}`, '');
      const titles = group.files.map(f => f.title || f.name);
      for (const f of group.files) {
        const label = (f.title || f.name) + (titles.filter(t => t === (f.title || f.name)).length > 1 && f.kind ? ` (${f.kind.toUpperCase()})` : '');
        lines.push(`- [${label.replaceAll('[', '\\[').replaceAll(']', '\\]')}](<${path.relative(folder, f.path).split(path.sep).join('/')}>)`);
      }
      lines.push('');
    }
    lines.push('*Ordre et catégories réglables dans l’app Cours Albert (Albert School › Cours).*', '');
    await generatedWrite(path.join(folder, 'Accueil.md'), lines.join('\n'), state);
  }
  const vaultRoot = await vaultRootFor(libraryRoot);
  if (vaultRoot) {
    const nodes = courses.map((course, i) => ({ id: `course-${hash(Buffer.from(course.title)).slice(0, 16)}`, type: 'file', file: path.relative(vaultRoot, path.join(courseRoot, course.semester, course.title, 'Accueil.md')).split(path.sep).join('/'), x: 80 + (i % 3) * 390, y: 100 + Math.floor(i / 3) * 300, width: 340, height: 240 }));
    nodes.unshift({ id: 'tableau-de-bord', type: 'file', file: path.relative(vaultRoot, path.join(courseRoot, 'Tableau de bord Albert.md')).split(path.sep).join('/'), x: 80, y: -520, width: 1120, height: 560, color: '5' });
    await generatedWrite(path.join(courseRoot, 'Vue des cours.canvas'), JSON.stringify({ nodes, edges: [] }, null, 2), state);
  }
  report.visualView = { home: path.join(courseRoot, 'Accueil des cours.md'), canvas: vaultRoot ? path.join(courseRoot, 'Vue des cours.canvas') : null };
}

export async function organizeCourses({ libraryRoot, sourceRoot, state, report, overrides = {} }) {
  const courseRoot = path.join(libraryRoot, 'Cours');
  const courses = knownCourses(state);
  const stats = { courses: courses.length, added: 0, updated: 0, unchanged: 0, unclassified: 0 };
  await fs.mkdir(path.join(courseRoot, 'S1'), { recursive: true });
  await fs.mkdir(path.join(courseRoot, 'S2'), { recursive: true });
  await fs.mkdir(path.join(courseRoot, 'À classer'), { recursive: true });
  for (const course of courses) {
    for (const category of categories) await fs.mkdir(path.join(courseRoot, course.semester, course.title, category), { recursive: true });
  }
  const guide = path.join(courseRoot, 'À LIRE.md');
  if (!await exists(guide)) await atomicWrite(guide, Buffer.from('# Mes cours Albert School\n\nChaque cours a son dossier. Les supports dont le cours n’est pas identifiable sans risque sont dans « À classer ». Les fichiers d’origine restent dans « Ressources synchronisées ».\n'));
  const organized = state.organizedFiles ||= {};
  for (const group of groups) {
    const groupRoot = path.join(sourceRoot, group);
    for (const { rel, full } of await filesUnder(groupRoot)) {
      const { dest, classified } = destinationFor(group, rel, courses, courseRoot);
      if (!classified) stats.unclassified++;
      try { await copySafe(`${group}:${rel}`, full, dest, organized, stats, report); }
      catch (error) { report.errors.push(`Rangement ${rel}: ${String(error?.message || error).slice(0, 180)}`); }
    }
  }
  await makeObsidianView({ libraryRoot, courseRoot, courses, state, report, overrides });
  report.organization = stats;
  return stats;
}

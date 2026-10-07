// Moteur Cours Albert 2 : sources locales, Drive, Inside Albert, rangement, miroir et données de l’app.
import fs from 'node:fs/promises';
import path from 'node:path';
import { organizeCourses } from './organize.mjs';
import { findDriveMirror, syncDriveMirror } from './mirror.mjs';
import { buildDataset, isGeneratedNote } from './dataset.mjs';
import { safeName, sha, readJson, exists, writeAtomic, fmtErr, humanError, online } from './util.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const configArg = args.indexOf('--config');
const configPath = configArg >= 0 ? args[configArg + 1] : path.join(process.env.HOME, 'Library/Application Support/Cours Albert Sync/config.json');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const supportDir = path.dirname(configPath);
const interactive = flag('--interactive');
const localOnly = flag('--local-only');
const dataOnly = flag('--data-only');
const full = flag('--full');
const sourceRoot = path.join(config.vaultCourses, 'Ressources synchronisées');
const statePath = path.join(supportDir, 'state.json');
const lockPath = path.join(supportDir, '.running');
const progressPath = path.join(supportDir, 'progress.json');
const reportPath = path.join(sourceRoot, 'État de la synchronisation.md');
const state = await readJson(statePath, { files: {}, courses: {}, lastFullScan: null });
state.files ||= {}; state.courses ||= {};
const report = {
  started: new Date().toISOString(), mode: interactive ? 'manuel' : 'automatique', added: 0, updated: 0, unchanged: 0,
  errors: [], warnings: [], sourceCounts: { bureau: 0, drive: 0, inside: 0 }, insideConnected: null, driveConnected: false, offline: false,
};
let lock;

// ---------- Progression lisible par l’app ----------
const RANGES = [[/Chrome|Connectez/i, 0, 3], [/Accueil/i, 3, 6], [/Emploi du temps/i, 6, 25], [/Examens/i, 25, 32], [/Présence/i, 32, 45], [/Supports/i, 45, 100]];
let lastProgressWrite = 0;
async function progress({ phase, label, current = 0, total = 1 }) {
  const frac = total ? Math.min(1, current / total) : 0;
  let pct;
  if (phase === 'bureau') pct = 2 + 3 * frac;
  else if (phase === 'drive') pct = 5 + 7 * frac;
  else if (phase === 'inside' || phase === 'login') {
    const [, a, b] = RANGES.find(([re]) => re.test(label)) || [null, 0, 100];
    pct = 12 + 0.72 * (a + (b - a) * frac);
  } else if (phase === 'organize') pct = 85;
  else if (phase === 'mirror') pct = 91;
  else if (phase === 'data') pct = 97;
  else pct = 0;
  const now = Date.now();
  if (now - lastProgressWrite < 250 && phase !== 'login') return;
  lastProgressWrite = now;
  await writeAtomic(progressPath, JSON.stringify({ running: true, pid: process.pid, started: report.started, mode: report.mode, phase, label, current, total, pct: Math.round(pct) })).catch(() => {});
}

async function lockRun() {
  try { lock = await fs.open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); return true; }
  catch {
    const st = await fs.stat(lockPath).catch(() => null);
    const pid = Number(await fs.readFile(lockPath, 'utf8').catch(() => '0'));
    let alive = false; try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
    if (st && (!alive || Date.now() - st.mtimeMs > 2 * 3600_000)) { await fs.unlink(lockPath).catch(() => {}); return lockRun(); }
    return false;
  }
}

// ---------- Copie prudente des sources ----------
async function putBuffer(key, dest, bytes, source) {
  const incomingHash = sha(bytes), old = state.files[key];
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const stamp = () => new Date().toISOString();
  if (old && old.hash === incomingHash && await exists(old.path)) { old.seen = stamp(); report.unchanged++; return; }
  if (old && old.path !== dest && await exists(old.path)) {
    const previousHash = sha(await fs.readFile(old.path));
    if (previousHash === incomingHash) { old.hash = incomingHash; old.seen = stamp(); report.unchanged++; return; }
    if (previousHash === old.hash) {
      await writeAtomic(old.path, bytes);
      state.files[key] = { ...old, path: old.path, hash: incomingHash, source, seen: stamp() };
      report.updated++; report.sourceCounts[source]++; return;
    }
  }
  if (await exists(dest)) {
    const localHash = sha(await fs.readFile(dest));
    if (localHash === incomingHash) { state.files[key] = { ...old, path: dest, hash: incomingHash, source, seen: stamp() }; report.unchanged++; return; }
    if (old && localHash !== old.hash) {
      const ext = path.extname(dest), stem = dest.slice(0, -ext.length || undefined);
      dest = `${stem} — nouvelle version ${stamp().slice(0, 10)} ${incomingHash.slice(0, 8)}${ext}`;
      if (await exists(dest)) {
        if (sha(await fs.readFile(dest)) === incomingHash) { state.files[key] = { ...old, path: dest, hash: incomingHash, source, seen: stamp() }; report.unchanged++; return; }
        throw new Error(`Le fichier de nouvelle version ${path.basename(dest)} a aussi été modifié localement.`);
      }
      report.warnings.push(`Modification locale conservée : ${path.basename(old.path || dest)}. La nouvelle version est enregistrée à côté.`);
    } else report.updated++;
  } else report.added++;
  await writeAtomic(dest, bytes);
  state.files[key] = { ...old, path: dest, hash: incomingHash, source, seen: stamp() };
  report.sourceCounts[source]++;
}
async function walk(dir, relative = '', followDriveLinks = false) {
  let entries; try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { report.errors.push(`Dossier illisible « ${path.basename(dir)} » : ${fmtErr(e)}`); return []; }
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'Ressources du vault' || /\.tmp-\d+/.test(entry.name)) continue;
    if (dir === config.vaultCourses && (entry.name === 'Cours' || entry.name.endsWith('.ics'))) continue;
    const rel = path.join(relative, entry.name), fullPath = path.join(dir, entry.name);
    let linkedDirectory = false;
    if (followDriveLinks && entry.isSymbolicLink()) {
      const target = await fs.realpath(fullPath).catch(() => '');
      linkedDirectory = target.includes(`${path.sep}.shortcut-targets-by-id${path.sep}`) && (await fs.stat(fullPath).catch(() => null))?.isDirectory();
    }
    if (entry.isDirectory() || linkedDirectory) out.push(...await walk(fullPath, rel, followDriveLinks));
    else if (entry.isFile()) out.push({ full: fullPath, rel });
  }
  return out;
}
async function importBureau() {
  if (!config.desktopCourses || !await exists(config.desktopCourses)) return;
  const existing = new Set();
  for (const { full: f } of await walk(config.vaultCourses)) {
    if (f.startsWith(sourceRoot)) continue;
    try { existing.add(sha(await fs.readFile(f))); } catch {}
  }
  const files = await walk(config.desktopCourses);
  let i = 0;
  for (const { full: f, rel } of files) {
    await progress({ phase: 'bureau', label: 'Bureau', current: ++i, total: files.length });
    try {
      const bytes = await fs.readFile(f);
      if (existing.has(sha(bytes))) { report.unchanged++; continue; }
      await putBuffer(`bureau:${rel}`, path.join(sourceRoot, 'Bureau', ...rel.split(path.sep).map(s => safeName(s))), bytes, 'bureau');
    } catch (e) { report.errors.push(`Bureau « ${rel} » : ${fmtErr(e)}`); }
  }
}
function driveLink(ext, obj) {
  const id = obj.doc_id || obj.id; if (!id) return null;
  const kind = ext === '.gsheet' ? 'spreadsheets' : ext === '.gslides' ? 'presentation' : 'document';
  return `https://docs.google.com/${kind}/d/${encodeURIComponent(id)}/edit`;
}
async function importDrive() {
  const folders = new Set(Array.isArray(config.driveFolders) ? config.driveFolders : []);
  const mirror = findDriveMirror(config);
  if (mirror) {
    const driveRoot = path.dirname(mirror);
    for (const entry of await fs.readdir(driveRoot, { withFileTypes: true }).catch(() => [])) {
      if (entry.name === path.basename(mirror)) continue;
      const code = entry.name.match(/(?:MAT|DAT|BUS|HUM)\d{2}-\d+/i)?.[0]?.toUpperCase();
      if (!code || !Object.values(state.courses).some(course => course.code === code)) continue;
      const folder = path.join(driveRoot, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && (await fs.stat(folder).catch(() => null))?.isDirectory())) folders.add(folder);
    }
  }
  let i = 0;
  for (const folder of folders) {
    await progress({ phase: 'drive', label: 'Google Drive', current: ++i, total: folders.size });
    if (mirror && path.resolve(folder) === mirror) continue;
    if (!await exists(folder)) { report.errors.push(`Dossier Drive absent : « ${path.basename(folder)} ». Vérifiez que Google Drive pour ordinateur est ouvert.`); continue; }
    report.driveConnected = true;
    for (const { full: f, rel } of await walk(folder, '', true)) {
      try {
        const ext = path.extname(rel).toLowerCase(), clean = path.join(safeName(path.basename(folder)), ...rel.split(path.sep).map(s => safeName(s)));
        if (['.gdoc', '.gsheet', '.gslides'].includes(ext)) {
          const obj = JSON.parse(await fs.readFile(f, 'utf8'));
          const link = driveLink(ext, obj); if (!link) continue;
          await putBuffer(`drive:${clean}`, path.join(sourceRoot, 'Google Drive', clean + '.md'), Buffer.from(`# ${path.basename(rel, ext)}\n\n[Ouvrir dans Google Drive](${link})\n\nSource : Google Drive.\n`), 'drive');
        } else await putBuffer(`drive:${clean}`, path.join(sourceRoot, 'Google Drive', clean), await fs.readFile(f), 'drive');
      } catch (e) { report.errors.push(`Drive « ${path.basename(folder)}/${rel} » : ${fmtErr(e)}`); }
    }
  }
}

async function syncInside() {
  const base = config.insideBase || 'https://inside.albertschool.com';
  if (!await online(base)) {
    report.offline = true;
    report.warnings.push('Pas de connexion internet : Inside Albert sera vérifié au prochain passage.');
    return;
  }
  const { runInside } = await import('./inside.mjs');
  await runInside({ config, state, report, interactive, full, sourceRoot, putBuffer, progress: p => progress(p) });
}

// ---------- Rapport ----------
const fr = iso => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'long', timeStyle: 'short' }) : '—';
async function writeReport(data) {
  report.finished = new Date().toISOString();
  report.errors = [...new Set(report.errors.map(humanError))];
  report.warnings = [...new Set(report.warnings)];
  const upcoming = data?.exams?.filter(x => Date.parse(x.end) > Date.now()).length ?? 0;
  const inside = report.offline ? 'hors ligne (vérification reportée)' : report.insideConnected === null ? 'non vérifié' : report.insideConnected ? 'connecté' : 'à reconnecter';
  const lines = [
    '---', 'type: suivi', 'tags: [albert-school, synchronisation]', '---', '',
    '# Synchronisation des cours Albert School', '',
    `Dernier passage : **${fr(report.finished)}** (${report.mode}, ${Math.max(1, Math.round((Date.parse(report.finished) - Date.parse(report.started)) / 1000))} s)`, '',
    '## Résumé', '',
    `- Inside Albert : **${inside}**`,
    `- Google Drive : **${report.driveConnected ? 'connecté' : 'à vérifier'}**`,
    `- Fichiers ajoutés : **${report.added}** · mis à jour : **${report.updated}** · déjà présents : **${report.unchanged}**`,
    `- Cours rangés : **${report.organization?.courses ?? 0}** · supports à classer : **${report.organization?.unclassified ?? 0}**`,
    `- Emploi du temps : **${data?.schedule?.length ?? 0}** séances connues · examens à venir : **${upcoming}**`,
    `- Drive dans les deux sens : **${report.driveMirror ? `${report.driveMirror.uploaded} envoyé(s), ${report.driveMirror.downloaded} reçu(s), ${report.driveMirror.conflicts} conflit(s)` : 'non configuré'}**`, '',
    '## Problèmes à vérifier', '', ...(report.errors.length ? report.errors.map(e => `- ${e}`) : ['Aucun problème détecté.']), '',
    ...(report.warnings.length ? ['## Remarques', '', ...report.warnings.map(w => `- ${w}`), ''] : []),
    'Ouvrez l’application Cours Albert pour voir le planning, les examens et la présence. Les originaux sont conservés dans « Ressources synchronisées ».', '',
  ];
  await writeAtomic(reportPath, lines.join('\n'));
  await writeAtomic(path.join(supportDir, 'last-run.json'), JSON.stringify(report, null, 2));
}

try {
  if (!await lockRun()) {
    if (dataOnly) process.exit(0);
    console.log('Une synchronisation est déjà en cours.');
    process.exitCode = 2;
  } else if (dataOnly) {
    await buildDataset({ config, state, report: null, supportDir, writeNotes: false });
    await writeAtomic(statePath, JSON.stringify(state, null, 2));
  } else {
    await progress({ phase: 'start', label: 'Préparation' });
    await fs.mkdir(sourceRoot, { recursive: true });
    await importBureau();
    await importDrive();
    if (!localOnly) await syncInside().catch(e => report.errors.push(`Inside Albert : ${humanError(fmtErr(e))}`));
    await writeAtomic(statePath, JSON.stringify(state, null, 2));
    await progress({ phase: 'organize', label: 'Rangement des cours' });
    const classement = await readJson(path.join(supportDir, 'classement.json'), {});
    await organizeCourses({ libraryRoot: config.vaultCourses, sourceRoot, state, report, overrides: classement?.files || {} }).catch(e => report.errors.push(`Rangement : ${fmtErr(e)}`));
    const mirrorRoot = findDriveMirror(config);
    if (mirrorRoot) {
      await progress({ phase: 'mirror', label: 'Google Drive dans les deux sens' });
      await syncDriveMirror({ courseRoot: path.join(config.vaultCourses, 'Cours'), mirrorRoot, state, report, exclude: isGeneratedNote }).catch(e => report.errors.push(`Drive dans les deux sens : ${fmtErr(e)}`));
    }
    await progress({ phase: 'data', label: 'Mise à jour de l’app' });
    report.finished = new Date().toISOString();
    const data = await buildDataset({ config, state, report, supportDir }).catch(e => { report.errors.push(`Données de l’app : ${fmtErr(e)}`); return null; });
    await writeReport(data);
    await writeAtomic(statePath, JSON.stringify(state, null, 2));
    console.log(`Cours Albert : ${report.added} ajoutés, ${report.updated} mis à jour, ${report.errors.length} problème(s), ${report.notifications?.length || 0} notification(s).`);
  }
} catch (e) {
  report.errors.push(fmtErr(e));
  if (lock) await writeReport(null).catch(() => {});
  console.error(fmtErr(e));
  process.exitCode = 1;
} finally {
  if (lock) {
    await writeAtomic(progressPath, JSON.stringify({ running: false, finished: new Date().toISOString(), pct: 100 })).catch(() => {});
    await lock.close(); await fs.unlink(lockPath).catch(() => {});
  }
}

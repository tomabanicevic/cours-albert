import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function bytes(file) { return fs.readFile(file).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error)); }
async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
async function list(root, relative = '', exclude = () => false) {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  const names = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) names.push(...await list(root, rel, exclude));
    else if (entry.isFile() && !/\.(gdoc|gsheet|gslides)$/i.test(entry.name) && !/\.tmp-\d+/.test(entry.name) && !exclude(rel)) names.push(rel);
  }
  return names;
}
function conflictName(rel, origin, content) {
  const ext = path.extname(rel), stem = ext ? rel.slice(0, -ext.length) : rel;
  return `${stem} — conflit ${origin} ${hash(content).slice(0, 8)}${ext}`;
}
function isWithin(parent, child) { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }

export function findDriveMirror(config) {
  if (config.driveMirrorFolder) return path.resolve(config.driveMirrorFolder);
  for (const folder of config.driveFolders || []) {
    const marker = `${path.sep}My Drive${path.sep}`;
    const i = folder.indexOf(marker);
    if (i >= 0) return path.join(folder.slice(0, i + marker.length - 1), 'Cours Albert');
  }
  return null;
}

export async function syncDriveMirror({ courseRoot, mirrorRoot, state, report, exclude = () => false }) {
  if (!mirrorRoot) return null;
  const local = path.resolve(courseRoot), remote = path.resolve(mirrorRoot);
  if (isWithin(local, remote) || isWithin(remote, local)) throw new Error('Le dossier Drive de synchronisation doit être séparé des cours locaux.');
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(remote, { recursive: true });
  const previous = state.driveMirror ||= {};
  const stats = { uploaded: 0, downloaded: 0, conflicts: 0, unchanged: 0, folder: remote };
  const names = new Set([...await list(local, '', exclude), ...await list(remote, '', exclude)]);
  for (const rel of [...names].sort()) {
    try {
      const localPath = path.join(local, rel), remotePath = path.join(remote, rel);
      const [localBytes, remoteBytes] = await Promise.all([bytes(localPath), bytes(remotePath)]);
      const a = localBytes && hash(localBytes), b = remoteBytes && hash(remoteBytes);
      const before = previous[rel];
      if (a && b && a === b) { previous[rel] = { local: a, remote: b }; stats.unchanged++; continue; }
      if (!a && b) { await write(localPath, remoteBytes); previous[rel] = { local: b, remote: b }; stats.downloaded++; continue; }
      if (a && !b) { await write(remotePath, localBytes); previous[rel] = { local: a, remote: a }; stats.uploaded++; continue; }
      if (!a && !b) continue;
      const localChanged = !before || a !== before.local;
      const remoteChanged = !before || b !== before.remote;
      if (localChanged && !remoteChanged) { await write(remotePath, localBytes); previous[rel] = { local: a, remote: a }; stats.uploaded++; }
      else if (!localChanged && remoteChanged) { await write(localPath, remoteBytes); previous[rel] = { local: b, remote: b }; stats.downloaded++; }
      else if (!localChanged && !remoteChanged) stats.unchanged++;
      else {
        const localConflict = path.join(local, conflictName(rel, 'Drive', remoteBytes));
        const remoteConflict = path.join(remote, conflictName(rel, 'local', localBytes));
        if (!await bytes(localConflict)) { await write(localConflict, remoteBytes); stats.downloaded++; }
        if (!await bytes(remoteConflict)) { await write(remoteConflict, localBytes); stats.uploaded++; }
        previous[rel] = { local: a, remote: b };
        stats.conflicts++;
        report.errors.push(`Deux versions de « ${path.basename(rel)} » ont été conservées avec le mot « conflit ».`);
      }
    } catch (error) { report.errors.push(`Drive bidirectionnel ${rel}: ${String(error?.message || error).slice(0, 180)}`); }
  }
  report.driveMirror = stats;
  return stats;
}

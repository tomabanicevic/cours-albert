import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncDriveMirror, findDriveMirror } from '../src/mirror.mjs';
import { organizeCourses } from '../src/organize.mjs';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-test-'));
try {
  const root = path.join(tmp, 'vault');
  const sourceRoot = path.join(root, 'Ressources synchronisées');
  const courseRoot = path.join(root, 'Cours');
  const mirrorRoot = path.join(tmp, 'My Drive', 'Cours Albert');
  const course = 'BUS13-1 — Marketing Fundamentals';
  await fs.mkdir(path.join(root, '.obsidian'), { recursive: true });
  await fs.mkdir(path.join(sourceRoot, 'Inside Albert', 'S1', course), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'Inside Albert', 'S1', course, 'overview.md'), 'overview');
  await fs.mkdir(path.join(sourceRoot, 'Google Drive', 'marketing'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'Google Drive', 'marketing', 'support.pdf'), 'PDF');
  await fs.mkdir(path.join(sourceRoot, 'Google Drive', 'inconnu'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'Google Drive', 'inconnu', 'notes.txt'), 'notes');
  const state = { courses: { example: { title: course, code: 'BUS13-1', semester: 'S1' } } };
  const report = { errors: [] };

  await organizeCourses({ libraryRoot: root, sourceRoot, state, report });
  assert.equal(await fs.readFile(path.join(courseRoot, 'S1', course, 'Overview', 'overview.md'), 'utf8'), 'overview');
  assert.equal(await fs.readFile(path.join(courseRoot, 'S1', course, 'Drive', 'marketing', 'support.pdf'), 'utf8'), 'PDF');
  assert.equal(await fs.readFile(path.join(courseRoot, 'À classer', 'Google Drive', 'inconnu', 'notes.txt'), 'utf8'), 'notes');
  const canvas = JSON.parse(await fs.readFile(path.join(courseRoot, 'Vue des cours.canvas'), 'utf8'));
  assert.equal(canvas.nodes.length, 2, 'tableau de bord + un cours');
  assert.ok(canvas.nodes.every(node => node.type === 'file'));
  assert.ok(canvas.nodes.some(node => node.file.endsWith(`${course}/Accueil.md`)));
  await organizeCourses({ libraryRoot: root, sourceRoot, state, report });
  assert.equal(report.organization.added, 0, 'Un nouveau passage ne crée pas de doublons');
  assert.equal(findDriveMirror({ driveFolders: [path.join(tmp, 'My Drive', 'marketing')] }), mirrorRoot);

  await syncDriveMirror({ courseRoot, mirrorRoot, state, report });
  const local = path.join(courseRoot, 'S1', course, 'Overview', 'overview.md');
  const remote = path.join(mirrorRoot, 'S1', course, 'Overview', 'overview.md');
  assert.equal(await fs.readFile(remote, 'utf8'), 'overview');
  await fs.writeFile(remote, 'changement Drive');
  await syncDriveMirror({ courseRoot, mirrorRoot, state, report });
  assert.equal(await fs.readFile(local, 'utf8'), 'changement Drive');
  await fs.writeFile(local, 'changement local');
  await syncDriveMirror({ courseRoot, mirrorRoot, state, report });
  assert.equal(await fs.readFile(remote, 'utf8'), 'changement local');
  await fs.writeFile(local, 'conflit local');
  await fs.writeFile(remote, 'conflit Drive');
  await syncDriveMirror({ courseRoot, mirrorRoot, state, report });
  assert.equal(report.driveMirror.conflicts, 1);
  assert.ok((await fs.readdir(path.dirname(local))).some(name => name.includes('conflit Drive')));
  assert.ok((await fs.readdir(path.dirname(remote))).some(name => name.includes('conflit local')));
  await syncDriveMirror({ courseRoot, mirrorRoot, state, report });
  assert.equal(report.driveMirror.conflicts, 0, 'Un nouveau passage ne recrée pas le conflit');
  console.log('OK : classement, absence de doublons, Canvas, Drive dans les deux sens et conflits.');
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

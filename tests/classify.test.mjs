// Test du tri automatique des supports (noms réels des cours du S1).
import assert from 'node:assert/strict';
import { classifyFile, rankOf, groupFiles, displayTitle, suggestCourse, compareAuto } from '../src/classify.mjs';

const order = (names, hints = {}) => groupFiles(names.map(name => ({ name, path: name, ...classifyFile(name, hints) })));
const flat = groups => Object.fromEntries(groups.map(g => [g.category, g.files.map(f => f.name)]));

// Rangs naturels
assert.equal(rankOf('TD1 -- MAT11-1.pdf'), 1);
assert.equal(rankOf('TD10 -- MAT11-1.pdf'), 10);
assert.equal(rankOf('TD2 + Quelques solutions -- MAT11-1.pdf'), 2);
assert.equal(rankOf('Solution CC1 -- MAT11-1.pdf'), 1);
assert.equal(rankOf('Albert School - L1.S1 Finance 2026-27 - Session 2.pdf'), 2, 'Ni l’année ni L1.S1 ne comptent');
assert.equal(rankOf('2026_ALBERT_Marketing_3_MarketResearch.pdf'), 3);
assert.equal(rankOf('[4] Combinatoire & Probabilités.pdf'), 4);
assert.equal(rankOf('Slides cours 1 - intro.pdf'), 1);
assert.equal(rankOf('HUM14-2_JRoux_Session_1.pdf'), 1);
assert.equal(rankOf('Ch3 — Inequalities, Absolute Value & Distance.md'), 3);
assert.equal(rankOf('Workbook — Chapitre 2.md'), 2);
assert.equal(rankOf('The end of theory (2008).pdf'), null);
assert.equal(rankOf('Notes de cours -- Claire Martin -- MAT11-1.pdf'), null);
assert.equal(displayTitle('TD1 + Quelques solutions -- MAT11-1.pdf'), 'TD1 + Quelques solutions');
assert.equal(displayTitle('data 12 week1.gsheet.md'), 'data 12 week1');

// MAT11-1 : TD1 avant TD2 (corrigé juste après son sujet), contrôles à part, notes de cours d’abord
const mat = flat(order(['TD3 -- MAT11-1.pdf', 'Solution CC1 -- MAT11-1.pdf', 'TD2 + Quelques solutions -- MAT11-1.pdf', 'TD1 -- MAT11-1.pdf', 'Notes de cours.pdf', 'TD10 -- MAT11-1.pdf',
  'TD1 + Quelques solutions -- MAT11-1.pdf', 'CC1 -- MAT11-1.pdf', 'TD2 -- MAT11-1.pdf', 'Les Dix Commandements Mathématiques.pdf', 'TD4 -- MAT11-1.pdf', 'Notes de cours -- Claire Martin -- MAT11-1.pdf'], { section: 'Materials' }));
assert.deepEqual(mat.td, ['TD1 -- MAT11-1.pdf', 'TD1 + Quelques solutions -- MAT11-1.pdf', 'TD2 -- MAT11-1.pdf', 'TD2 + Quelques solutions -- MAT11-1.pdf', 'TD3 -- MAT11-1.pdf', 'TD4 -- MAT11-1.pdf', 'TD10 -- MAT11-1.pdf']);
assert.deepEqual(mat.controles, ['CC1 -- MAT11-1.pdf', 'Solution CC1 -- MAT11-1.pdf']);
assert.deepEqual(mat.cours, ['Notes de cours.pdf', 'Notes de cours -- Claire Martin -- MAT11-1.pdf']);
assert.deepEqual(mat.lectures, ['Les Dix Commandements Mathématiques.pdf']);

// Marketing : séances numérotées dans l’ordre, articles à part
const mk = flat(order(['2026_ALBERT_Marketing_3_MarketResearch.pdf', 'The IKEA effect.pdf', 'Slides cours 1 - intro.pdf', '2026_ALBERT_Marketing_2_ConsumerBehaviour_version_student.pdf', 'Gorillas.pdf'], { section: 'Materials' }));
assert.deepEqual(mk.cours, ['Slides cours 1 - intro.pdf', '2026_ALBERT_Marketing_2_ConsumerBehaviour_version_student.pdf', '2026_ALBERT_Marketing_3_MarketResearch.pdf']);
assert.deepEqual(mk.lectures, ['Gorillas.pdf', 'The IKEA effect.pdf']);

// Autres catégories
assert.equal(classifyFile('syllabus.pdf', { section: 'Syllabus' }).category, 'infos');
assert.equal(classifyFile('lbb_analytics.xlsx').category, 'donnees');
assert.equal(classifyFile('data 12 week1.gsheet.md', { kind: 'gsheet' }).category, 'donnees');
assert.equal(classifyFile('python1.py').category, 'donnees');
assert.equal(classifyFile('Team 21 - Reverse brief (FR).pdf').category, 'projets');
assert.equal(classifyFile('MOCK TEST.pdf').category, 'controles');
assert.equal(classifyFile('DAT12-1-cours-revision-qcm.pdf').category, 'controles');
assert.equal(classifyFile('Workbook — Chapitre 1.md', { type: 'exercice' }).category, 'td');
assert.ok(classifyFile('Solutions — Chapitre 1.md', { type: 'exercice' }).solution);
assert.equal(classifyFile('[3] Résolution d\'équations de 2nd degré.pdf').category, 'cours', '« de 2 » n’est pas un contrôle');

// Vault : cours, workbook puis corrigé, chapitre par chapitre
const notes = groupFiles(['Solutions — Chapitre 2.md', 'Workbook — Chapitre 1.md', 'Solutions — Chapitre 1.md', 'Workbook — Chapitre 2.md'].map(name => ({ name, path: name, ...classifyFile(name, { type: 'exercice' }) })));
assert.deepEqual(notes[0].files.map(f => f.name), ['Workbook — Chapitre 1.md', 'Solutions — Chapitre 1.md', 'Workbook — Chapitre 2.md', 'Solutions — Chapitre 2.md']);

// Choix manuels : ils passent avant le tri automatique
const files = ['TD1.pdf', 'TD2.pdf', 'TD3.pdf'].map(name => ({ name, path: name, ...classifyFile(name) }));
let g = groupFiles(files, { 'TD3.pdf': { order: -1 } });
assert.deepEqual(g[0].files.map(f => f.name), ['TD3.pdf', 'TD1.pdf', 'TD2.pdf']);
g = groupFiles(files, { 'TD2.pdf': { category: 'controles' } });
assert.deepEqual(g.map(x => x.category), ['td', 'controles']);
assert.ok(compareAuto({ name: 'b', title: 'b', rank: 1 }, { name: 'a', title: 'a', rank: null }) < 0, 'Les supports numérotés passent en premier');

// Fichiers « À classer » : cours suggéré
const courses = [
  { id: 'c1', code: 'MAT11-1', title: 'Foundations', unit: 'MAT11' }, { id: 'c3', code: 'MAT11-3', title: 'Linear Algebra I', unit: 'MAT11' },
  { id: 'd1', code: 'DAT12-1', title: 'Introduction to Data with Spreadsheet', unit: 'DAT12' }, { id: 'd2', code: 'DAT12-2', title: 'Programming in Python', unit: 'DAT12' },
  { id: 'b1', code: 'BUS13-1', title: 'Marketing Fundamentals', unit: 'BUS13', keywords: ['marketing', 'consumer', 'brand'] },
];
assert.equal(suggestCourse('Bureau/S 01/DATA S01/Programming with Python/python1.py', courses).courseId, 'd2');
assert.equal(suggestCourse('Google Drive/notes MAT11-3/td.pdf', courses).courseId, 'c3');
const prerentree = suggestCourse('Google Drive/A Strong Start to the Year/For french students/[5] Dérivées & Intégrales.pdf', courses);
assert.equal(prerentree.unit, 'MAT11'); assert.equal(prerentree.courseId, null);
assert.equal(suggestCourse('Bureau/divers/photo.jpg', courses).unit, null);
console.log('OK : tri automatique des supports (TD1 avant TD2, corrigés, catégories, choix manuels, suggestions de cours).');

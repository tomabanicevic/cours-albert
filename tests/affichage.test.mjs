// 3.3 : aperçus clairs des notes et fichiers texte (SVG sûr), cache des aperçus.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Thumbs, textPreviewSVG } from '../src/espaces/thumbs.mjs';

const svg = textPreviewSVG('Cours.md', '---\ntags: [x]\n---\n# Chapitre 1 <script>alert(1)</script>\n\n> [!abstract] Résumé\n> Les **preuves** & les [[Ch2 — Proof|quantificateurs]].\n- [ ] TD1\n- point\n');
assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
assert.ok(!/<script/i.test(svg), 'aucune balise script');
assert.match(svg, /Chapitre 1 &lt;script&gt;/);
assert.match(svg, /preuves &amp; les quantificateurs/);
assert.match(svg, /☐ TD1/);
assert.match(svg, /• point/);
assert.ok(!/tags: \[x\]/.test(svg), 'en-tête YAML retiré');
assert.match(textPreviewSVG('notes.csv', 'a;b\n1;2'), /ui-monospace/);
assert.match(textPreviewSVG('vide.txt', ''), />vide</, 'titre = nom du fichier');

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-affichage-'));
const md = path.join(root, 'Note.md');
await fs.writeFile(md, '# Ma note\nBonjour');
let made = 0;
const thumbs = new Thumbs({ dir: path.join(root, 'Apercus'), maker: async () => { made++; return false; } });
const out = await thumbs.get(md, 480);
assert.ok(out && out.endsWith('.svg'), 'aperçu SVG pour une note');
assert.match(await fs.readFile(out, 'utf8'), /Ma note/);
assert.equal(made, 0, 'Quick Look n’est pas utilisé pour le texte');
assert.equal(await thumbs.get(md, 240), out, 'même aperçu quelle que soit la taille');
await fs.writeFile(md, '# Autre titre\n');
const out2 = await thumbs.get(md, 480);
assert.notEqual(out2, out, 'nouvel aperçu après modification');
await fs.rm(root, { recursive: true, force: true });
console.log('affichage.test.mjs : OK (aperçus clairs des notes et fichiers texte)');

// Assistant IA : outils fichiers et espaces, protections, liens Obsidian, annulation — avec un faux client de l’API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/espaces/store.mjs';
import { Assistant, TOOLS } from '../src/espaces/agent.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-assistant-'));
const support = path.join(root, 'support'), vault = path.join(root, 'Vault');
const library = path.join(vault, '20_Areas', 'Bachelor-BDAI');
const put = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); };
const read = file => fs.readFile(file, 'utf8');
const exists = file => fs.access(file).then(() => true, () => false);

await put(path.join(vault, '.obsidian', 'app.json'), '{}');
await put(path.join(vault, 'CLAUDE.md'), '# Règles du vault\nLes cours sont rangés par matière.');
await put(path.join(vault, '00_Inbox', 'Note maths.md'), '# Quantificateurs\nPour tout x…');
await put(path.join(vault, 'Index.md'), 'Voir [[Note maths]] et [[00_Inbox/Note maths|la note]].');
await put(path.join(vault, '01 Maths', 'Maths — Hub.md'), '# Maths');
await put(path.join(vault, '20_Areas', 'Albert School', 'Mails', '02 Cours', 'mail.md'), 'mail');
await put(path.join(vault, '10_Projects', 'App', 'package.json'), '{}');
await put(path.join(vault, '10_Projects', 'App', 'notes.md'), 'code');
await put(path.join(library, 'Cours', 'S1', 'MAT11-1 — Foundations', 'Materials', 'TD1.pdf'), '%PDF-1.4 faux');
await put(path.join(support, 'data.json'), JSON.stringify({ courses: [{ id: 'mat111', code: 'MAT11-1', title: 'Foundations', fullTitle: 'MAT11-1 — Foundations', semester: 'S1', teacher: 'Claire Martin', folder: path.join(library, 'Cours', 'S1', 'MAT11-1 — Foundations'), fileCount: 1 }] }));
await put(path.join(support, 'Assistant', 'regles.json'), JSON.stringify({ proteges: ['20_Areas/*/Mails'], consignes: 'Notes de maths en français.' }));

const store = await new Store({ root: path.join(support, 'Espaces') }).load();
const viewer = { id: 'owner', name: 'Alex', role: 'owner', isOwner: true, group: null };
const ai = { status: () => ({ enabled: true, configured: true, model: 'claude-opus-5-5' }), config: { model: 'claude-opus-5-5', apiKey: 'sk-ant-test' } };

// Faux client : chaque réponse est calculée à partir des messages (pour réutiliser les identifiants renvoyés par les outils).
const calls = [];
let script = [];
const client = { beta: { messages: { create: async (req) => {
  calls.push(req);
  assert.ok(req.tools.length === TOOLS.length && req.system.includes('Règles du vault') && req.system.includes('Notes de maths en français'));
  const step = script.shift();
  assert.ok(step, 'appel en trop');
  const lastResults = req.messages[req.messages.length - 1].content;
  const content = step(Array.isArray(lastResults) ? lastResults.map(r => r.content).join('\n') : '');
  return { content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
} } } };
let n = 0;
const use = (name, input) => ({ type: 'tool_use', id: `tu_${++n}`, name, input });

const assistant = await new Assistant({ ai, store, supportDir: support, vault, libraries: [library, vault], ownerViewer: () => viewer, client }).load();
assert.deepEqual([...assistant.roots.keys()], ['vault', 'cours']);
assert.throws(() => assistant.resolve('vault/../secret.txt'), /en dehors/);
assert.throws(() => assistant.resolve('vault/.obsidian/app.json'), /cachés/);
assert.equal(assistant.resolve('cours/Cours/S1'), path.join(library, 'Cours', 'S1'));

let spaceId = null, postId = null;
script = [
  () => [{ type: 'text', text: 'Je regarde.' }, use('lister_dossier', { chemin: 'vault', profondeur: 2 }), use('lister_cours', {})],
  out => { assert.match(out, /📁 20_Areas\//); assert.match(out, /MAT11-1 — Foundations/); return [use('creer_dossier', { chemin: 'vault/01 Maths/MAT11-1 — Foundations' })]; },
  () => [use('deplacer', { source: 'vault/00_Inbox/Note maths.md', destination: 'vault/01 Maths/MAT11-1 — Foundations/Logique.md' })],
  out => { assert.match(out, /liens mis à jour dans 1 note/); return [
    use('deplacer', { source: 'cours/Cours/S1/MAT11-1 — Foundations/Materials/TD1.pdf', destination: 'vault/01 Maths/TD1.pdf' }),
    use('deplacer', { source: 'vault/10_Projects/App/notes.md', destination: 'vault/01 Maths/notes.md' }),
    use('deplacer', { source: 'vault/20_Areas/Albert School/Mails/02 Cours/mail.md', destination: 'vault/01 Maths/mail.md' }),
    use('deplacer', { source: 'vault/10_Projects', destination: 'vault/40_Archive/10_Projects' }),
    use('ecrire_note', { chemin: 'vault/01 Maths/Maths — Hub.md', contenu: 'écrasé ?' }),
    use('outil_inconnu', {}),
  ]; },
  out => {
    assert.match(out, /géré par l’app Cours Albert/);
    assert.match(out, /projet de code/);
    assert.match(out, /protégé/);
    assert.match(out, /existe déjà/);
    assert.match(out, /Outil inconnu/);
    return [use('creer_espace', { titre: 'MAT11-1 — Foundations', icone: '📐', sections: ['Cours', 'TD'] })];
  },
  out => { spaceId = out.match(/id (sp_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{6,})\)/)[1]; return [use('publier', { espace: spaceId, titre: 'TD1', section: 'TD', fichiers: ['cours/Cours/S1/MAT11-1 — Foundations/Materials/TD1.pdf'], texte: 'Premier TD' }), use('publier', { espace: spaceId, titre: 'Rappels', section: 'Fiches', texte: 'Nouvelle section' })]; },
  out => { postId = out.match(/id (p_[A-Za-z0-9]+)/)[1]; return [use('organiser_espace', { espace: spaceId, sections: [{ titre: 'Travaux dirigés', publications: [postId] }, { titre: 'TD', publications: [] }, { titre: 'Cours', publications: [] }] }), use('lire_espace', { espace: spaceId })]; },
  out => { assert.match(out, /## Travaux dirigés/); assert.match(out, /fichiers : cours\/Cours\/S1\/MAT11-1 — Foundations\/Materials\/TD1\.pdf/); return [use('ecrire_note', { chemin: 'vault/01 Maths/MAT11-1 — Foundations/Plan', contenu: '# Plan\n- [[Logique]]' }), use('ecrire_note', { chemin: 'vault/01 Maths/Maths — Hub.md', contenu: '- [[Plan]]', mode: 'ajouter' }), use('chercher', { requete: 'quantificateurs' })]; },
  out => { assert.match(out, /Logique\.md/); return [{ type: 'text', text: 'C’est rangé.' }]; },
];
const events = [];
for await (const e of assistant.chat({ message: 'Range mes cours de maths', context: 'L’étudiant regarde l’accueil.' })) events.push(e);
assert.equal(script.length, 0, 'toutes les étapes ont été jouées');
const done = events.at(-1);
assert.equal(done.type, 'done');
assert.ok(done.changes >= 8, `changements : ${done.changes}`);
assert.ok(events.some(e => e.type === 'action' && e.status === 'error'));
assert.ok(events.some(e => e.type === 'text' && e.text === 'C’est rangé.'));
assert.ok(calls[0].messages[0].content.includes('L’étudiant regarde l’accueil.'));

// Effets
const moved = path.join(vault, '01 Maths', 'MAT11-1 — Foundations', 'Logique.md');
assert.ok(await exists(moved) && !await exists(path.join(vault, '00_Inbox', 'Note maths.md')));
assert.equal(await read(path.join(vault, 'Index.md')), 'Voir [[Logique]] et [[01 Maths/MAT11-1 — Foundations/Logique|la note]].');
assert.ok(await exists(path.join(library, 'Cours', 'S1', 'MAT11-1 — Foundations', 'Materials', 'TD1.pdf')), 'la bibliothèque n’a pas bougé');
assert.ok(await exists(path.join(vault, '10_Projects', 'App', 'notes.md')));
assert.equal(await read(path.join(vault, '01 Maths', 'Maths — Hub.md')), '# Maths\n\n- [[Plan]]\n');
const space = store.spaces.get(spaceId);
assert.deepEqual(space.sections.map(s => s.title), ['Travaux dirigés', 'TD', 'Cours', 'Fiches']);
const td = space.posts.find(p => p.id === postId);
assert.equal(td.sectionId, space.sections[0].id);
assert.equal(td.attachments[0].kind, 'local');
assert.equal(td.attachments[0].path, path.join(library, 'Cours', 'S1', 'MAT11-1 — Foundations', 'Materials', 'TD1.pdf'));

// Conversation enregistrée, visible dans l’interface
const status = await assistant.status();
assert.equal(status.conversations.length, 1);
const view = await assistant.conversationView(done.conversation);
assert.equal(view.items[0].text, 'Range mes cours de maths');
assert.ok(view.items[1].parts.some(p => p.type === 'action' && p.changes));
assert.equal(view.runs[0].changes, done.changes);

// Annulation complète
const undo = await assistant.undo(done.run);
assert.ok(undo.restored >= 8, JSON.stringify(undo));
assert.deepEqual(undo.skipped, []);
assert.ok(await exists(path.join(vault, '00_Inbox', 'Note maths.md')) && !await exists(moved));
assert.equal(await read(path.join(vault, 'Index.md')), 'Voir [[Note maths]] et [[00_Inbox/Note maths|la note]].');
assert.equal(await exists(path.join(vault, '01 Maths', 'MAT11-1 — Foundations')), false, 'dossier créé par l’assistant retiré');
assert.equal(await read(path.join(vault, '01 Maths', 'Maths — Hub.md')), '# Maths');
assert.ok(store.spaces.get(spaceId).trashedAt, 'espace mis à la corbeille');
assert.equal(store.spaces.get(spaceId).posts.length, 0);
assert.equal((await assistant.undo(done.run)).already, true);

// Une note modifiée après coup n’est pas écrasée par l’annulation
script = [
  () => [use('ecrire_note', { chemin: 'vault/Brouillon.md', contenu: 'v1' })],
  () => [{ type: 'text', text: 'ok' }],
];
const ev2 = [];
for await (const e of assistant.chat({ message: 'Écris un brouillon', conversation: done.conversation })) ev2.push(e);
await fs.writeFile(path.join(vault, 'Brouillon.md'), 'modifié à la main');
const undo2 = await assistant.undo(ev2.at(-1).run);
assert.equal(undo2.restored, 0);
assert.equal(await read(path.join(vault, 'Brouillon.md')), 'modifié à la main');
assert.equal((await assistant.conversationView(done.conversation)).items.filter(i => i.role === 'user').length, 2);

// Clé absente : refus clair
const off = new Assistant({ ai: { status: () => ({ enabled: false }), config: {} }, store, supportDir: support, vault, libraries: [library], ownerViewer: () => viewer, client });
await assert.rejects(async () => { for await (const _ of off.chat({ message: 'x' })) {} }, /clé API/);

// Erreur de l’API : la conversation reste utilisable
script = [() => { throw Object.assign(new Error('panne'), { status: 500 }); }];
const ev3 = [];
for await (const e of assistant.chat({ message: 'encore', conversation: done.conversation })) ev3.push(e);
assert.ok(ev3.some(e => e.type === 'error'));
const saved = JSON.parse(await read(path.join(support, 'Assistant', 'conversations', `${done.conversation}.json`)));
assert.equal(saved.messages.at(-1).role, 'assistant');

// Blocs de réflexion (thinking) : seuls ceux de la demande en cours sont renvoyés à l’API ; une signature refusée déclenche un essai sans eux.
const seen = [];
let k = 0, refuse = false;
const thinkClient = { beta: { messages: { create: async req => {
  seen.push(JSON.stringify(req.messages));
  if (refuse) { refuse = false; throw Object.assign(new Error('400 messages.1.content.0: Invalid `signature` in `thinking` block'), { status: 400 }); }
  k++;
  if (k === 1) return { content: [{ type: 'thinking', thinking: 'a', signature: 'sig-1' }, { type: 'text', text: 'Bonjour.' }], stop_reason: 'end_turn' };
  if (k === 2) return { content: [{ type: 'thinking', thinking: 'b', signature: 'sig-2' }, { type: 'tool_use', id: 'tt_1', name: 'lister_cours', input: {} }], stop_reason: 'tool_use' };
  return { content: [{ type: 'text', text: 'Fini.' }], stop_reason: 'end_turn' };
} } } };
const a2 = await new Assistant({ ai, store, supportDir: support, vault, libraries: [library, vault], ownerViewer: () => viewer, client: thinkClient }).load();
let convId = null;
for await (const ev of a2.chat({ message: 'Salut' })) if (ev.type === 'done') convId = ev.conversation;
const ev4 = [];
for await (const ev of a2.chat({ conversation: convId, message: 'Range mes cours' })) ev4.push(ev);
assert.ok(!ev4.some(e => e.type === 'error'), JSON.stringify(ev4));
assert.ok(!seen[1].includes('sig-1'), 'réflexion de la demande précédente retirée');
assert.ok(seen[2].includes('sig-2') && !seen[2].includes('sig-1'), 'réflexion de la demande en cours gardée pendant les outils');
refuse = true; k = 0;
const ev5 = [];
for await (const ev of a2.chat({ conversation: convId, message: 'Encore' })) ev5.push(ev);
assert.ok(ev5.some(e => e.type === 'done') && !ev5.some(e => e.type === 'error'), 'nouvel essai sans réflexion après un refus de signature');

// Dossiers de l’Accueil (classement des espaces) : renommage, création, rangement par matière, annulation
await store.setPrefs({ folders: [{ id: 'd_maths1', name: 'Cours Maths', color: '#ef4444' }] });
const sp = {};
for (const [k, t] of [['m', 'Maths · MAT11-1 — Foundations'], ['d', 'Data · DAT12-1 — Intro'], ['b', 'Business · BUS13-1 — Finance'], ['b2', 'Business S01']]) sp[k] = (await store.create({ kind: 'board', title: t, sections: [{ title: 'Cours' }] })).id;
script = [
  () => [use('lister_espaces', {})],
  out => {
    assert.match(out, /Dossiers de l’Accueil : « Cours Maths »/);
    assert.match(out, /dossier : aucun/);
    return [
      use('renommer_dossier_accueil', { dossier: 'Cours Maths', nouveau_nom: 'Maths' }),
      use('creer_dossier_accueil', { nom: 'Data' }),
      use('ranger_espaces', { dossier: 'maths', espaces: [sp.m] }),
      use('ranger_espaces', { dossier: 'Data', espaces: [sp.d, 'inconnu'] }),
      use('ranger_espaces', { dossier: 'Business', espaces: [sp.b, sp.b2] }),
    ];
  },
  out => {
    assert.match(out, /renommé : « Cours Maths » → « Maths »/);
    assert.match(out, /Identifiants inconnus ignorés : inconnu/);
    assert.match(out, /dans « Business » \(dossier créé\)/);
    return [use('lister_espaces', {})];
  },
  out => {
    assert.match(out, /« Maths » \(d_maths1, 1 espace/);
    assert.match(out, /« Business » \(d_[A-Za-z0-9]+, 2 espace/);
    return [{ type: 'text', text: 'Accueil rangé par matière.' }];
  },
];
const ev6 = [];
for await (const e of assistant.chat({ message: 'Fais un dossier par matière dans l’accueil' })) ev6.push(e);
assert.equal(script.length, 0, 'étapes des dossiers jouées');
assert.ok(calls.at(-1).system.includes('dossier de l’Accueil'), 'les consignes expliquent les dossiers de l’Accueil');
const folderOf = id => store.prefs.folders.find(f => f.id === store.spaces.get(id).folder)?.name;
assert.deepEqual([folderOf(sp.m), folderOf(sp.d), folderOf(sp.b), folderOf(sp.b2)], ['Maths', 'Data', 'Business', 'Business']);
assert.deepEqual(store.prefs.folders.map(f => f.name), ['Maths', 'Data', 'Business']);
assert.equal(ev6.at(-1).changes, 7);
const undo6 = await assistant.undo(ev6.at(-1).run);
assert.deepEqual(undo6.skipped, []);
assert.deepEqual(store.prefs.folders.map(f => f.name), ['Cours Maths'], 'dossiers créés retirés, nom d’origine rendu');
assert.ok([sp.m, sp.d, sp.b, sp.b2].every(id => !store.spaces.get(id).folder), 'espaces sortis des dossiers');

await fs.rm(root, { recursive: true, force: true });
console.log('assistant.test.mjs : OK');

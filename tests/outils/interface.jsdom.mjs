// Test de l’interface dans jsdom (outil de développement, pas lancé par la compilation).
// Utilisation : npm install jsdom dans un dossier temporaire, copier ce fichier dedans, puis
//   node interface.jsdom.mjs "/chemin/vers/Cours Albert"
// Test de l’interface 3.1 dans jsdom contre le vrai serveur des espaces (mode développement).
import { JSDOM, VirtualConsole } from 'jsdom';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const APP = process.argv[2];
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ui31-'));
const vault = path.join(tmp, 'Vault'), lib = path.join(vault, '20_Areas', 'Bachelor-BDAI'), support = path.join(tmp, 'support');
await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
await fs.mkdir(path.join(lib, 'Cours', 'S1', 'MAT11-1 — Foundations', 'Materials'), { recursive: true });
await fs.writeFile(path.join(lib, 'Cours', 'S1', 'MAT11-1 — Foundations', 'Materials', 'TD1.pdf'), '%PDF');
await fs.mkdir(path.join(vault, '00_Inbox'), { recursive: true });
await fs.writeFile(path.join(vault, '00_Inbox', 'idée.md'), '# Idée\n\nmatrices');
const child = spawn(process.execPath, [path.join(APP, 'src/espaces/server.mjs'), '--dev', '--support', support, '--ui', path.join(APP, 'src/ui'), '--port', '0', '--lan-port', '0', '--allow', lib, '--vault', vault], { stdio: ['pipe', 'pipe', 'pipe'] });
let serverErr = '';
child.stderr.on('data', d => { serverErr += d; });
const ready = await new Promise((resolve, reject) => { let b = ''; child.stdout.on('data', d => { b += d; const i = b.indexOf('\n'); if (i >= 0) resolve(JSON.parse(b.slice(0, i))); }); setTimeout(() => reject(new Error('serveur')), 15000); });
const base = `http://127.0.0.1:${ready.port}`;
const api = async (m, p, body) => { const r = await fetch(base + '/api' + p, { method: m, headers: { 'X-Token': 'dev', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${JSON.stringify(d)}`); return d; };
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push(`jsdom: ${e.message} ${e.detail || ''}`));
vc.on('error', (...a) => errors.push(`console.error: ${a.map(String).join(' ')}`));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fakeChat = null;
const dom = await JSDOM.fromURL(`${base}/app/index.html?token=dev&now=2026-10-06T08:40:00Z#/accueil`, {
  runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w) {
    w.fetch = async (u, o) => { const url = new URL(u, w.location.href); if (fakeChat && url.pathname.startsWith('/api/assistant')) return fakeChat(url, o); if (fakeChat && url.pathname === '/api/state') { const r = await fetch(url, o); const j = await r.json(); j.ai = { ...j.ai, enabled: true, configured: true }; return new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } }); } return fetch(url, o); };
    w.EventSource = class { constructor() { this.listeners = {}; } addEventListener() {} close() {} };
    w.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    w.CSS = { escape: s => String(s).replace(/[^\w-]/g, c => `\\${c}`) };
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.Element.prototype.setPointerCapture = function () {};
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
    w.addEventListener('error', e => errors.push(`window: ${e.message} @ ${e.filename}:${e.lineno}`));
    w.addEventListener('unhandledrejection', e => errors.push(`rejet: ${e.reason?.stack || e.reason}`));
  },
});
const w = dom.window, d = w.document;
const until = async (fn, what, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return; } catch {} await sleep(50); } throw new Error(`Délai dépassé : ${what}\n${(d.querySelector("#main")?.innerHTML || "").replace(/<svg[\s\S]*?<\/svg>/g, "").slice(-1500)}`); };
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const go = r => w.eval(`go(${JSON.stringify(r)})`);
try {
  await until(() => w.eval('typeof S !== "undefined" && S.ready && E.available'), 'démarrage de l’app');
  // Barre latérale
  assert.match(d.querySelector('#sidebar').innerHTML, /Assistant IA/);
  assert.match(d.querySelector('#sidebar').innerHTML, /Notes/);
  // Notes : vue d’ensemble, création d’un dossier, note rapide, note avec éditeur
  go('notes');
  await until(() => /Ajouter un dossier de notes/.test(d.querySelector('#main').innerHTML), 'vue Notes');
  click(d.querySelector('[data-nf="add"]'));
  await until(() => d.querySelector('[data-nfa="name"]'), 'fenêtre d’ajout');
  d.querySelector('[data-nfa="name"]').value = '05 Notes perso';
  d.querySelector('[data-nfa="form"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => w.eval("S.route === 'notes' && !!S.param") && /Nouvelle note/.test(d.querySelector('#main').innerHTML) && /Dossier vide|nf-grid/.test(d.querySelector('#main').innerHTML), 'dossier ouvert');
  assert.ok(await fs.stat(path.join(vault, '05 Notes perso')).then(s => s.isDirectory()), 'dossier créé dans le vault');
  assert.match(d.querySelector('#sidebar').innerHTML, /05 Notes perso/);
  const ta = d.querySelector('[data-nf-quick]');
  ta.value = 'Cours du lundi\nLes matrices carrées.';
  d.querySelector('[data-nf="quick"]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => /Cours du lundi/.test(d.querySelector('#main').innerHTML), 'note rapide affichée');
  assert.equal(await fs.readFile(path.join(vault, '05 Notes perso', 'Cours du lundi.md'), 'utf8'), '# Cours du lundi\n\nLes matrices carrées.\n');
  click(d.querySelector('[data-nf="open"]'));
  await until(() => d.querySelector('.tv'), 'lecteur ouvert');
  click(d.querySelector('[data-tv="edit"]'));
  await until(() => d.querySelector('.tv-editor'), 'mode édition');
  const ed = d.querySelector('.tv-editor');
  ed.value += '\nAjout dicté avec Wispr.';
  ed.dispatchEvent(new w.Event('input', { bubbles: true }));
  await until(async () => /Ajout dicté/.test(await fs.readFile(path.join(vault, '05 Notes perso', 'Cours du lundi.md'), 'utf8')), 'enregistrement automatique', 6000);
  w.eval('UI.stack.slice().forEach(e => UI.close(e.box))');
  // Réglages : carte Wispr Flow et carte IA
  go('reglages');
  await until(() => /Wispr Flow/.test(d.querySelector('#main').innerHTML), 'carte Wispr');
  assert.match(d.querySelector('#main').innerHTML, /Se connecter à Wispr Flow/);
  assert.match(d.querySelector('#main').innerHTML, /IA : assistant et tri/);
  // Fournisseur d’IA au choix : liste, passage à Ollama (adresse, pas de clé), retour à Claude
  const prov = d.querySelector('[data-ai-provider]');
  assert.ok(d.querySelector('[data-ai-url]'), 'adresse de l’API modifiable pour Claude');
  assert.match(prov.options[0].textContent, /Claude.*recommandé/);
  assert.ok(prov && prov.options.length >= 9, 'liste des fournisseurs');
  assert.ok([...prov.options].some(o => /ChatGPT/.test(o.textContent)) && [...prov.options].some(o => /Gemini/.test(o.textContent)) && [...prov.options].some(o => /Mistral/.test(o.textContent)));
  prov.value = 'ollama'; prov.dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => d.querySelector('[data-ai-url]') && !d.querySelector('[data-ai-key]'), 'réglages Ollama', 15000);
  assert.match(d.querySelector('#main').innerHTML, /Rien ne quitte ce Mac/);
  d.querySelector('[data-ai-provider]').value = 'openai'; d.querySelector('[data-ai-provider]').dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => /Votre clé API OpenAI/.test(d.querySelector('#main').innerHTML) && d.querySelector('[data-ai-model]')?.tagName === 'INPUT', 'réglages OpenAI');
  assert.equal(d.querySelector('[data-ai-url]').value, 'https://api.openai.com/v1');
  d.querySelector('[data-ai-provider]').value = 'anthropic'; d.querySelector('[data-ai-provider]').dispatchEvent(new w.Event('change', { bubbles: true }));
  await until(() => d.querySelector('[data-ai-model]')?.tagName === 'SELECT', 'retour à Claude');
  // Assistant sans clé
  go('assistant');
  await until(() => /Choisissez votre IA/.test(d.querySelector('#main').innerHTML), 'assistant sans clé');
  // Assistant avec clé (API simulée)
  w.eval('E.state.ai.enabled = true; E.state.ai.configured = true');
  let undone = false;
  fakeChat = async (url, o) => {
    const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/api/assistant') return json({ enabled: true, model: 'claude-opus-5-5', vault: 'vault', conversations: [{ id: 'c_1', title: 'Range' }], rules: { consignes: '', proteges: [] } });
    if (url.pathname === '/api/assistant/conversation') return json({ id: 'c_1', title: 'Range', items: [{ role: 'user', text: 'Range 00_Inbox' }, { role: 'assistant', run: 'r_1', parts: [{ type: 'action', label: 'Regarde « vault/00_Inbox »', ok: true }, { type: 'action', label: 'Déplace « idée.md »', ok: true, changes: true }, { type: 'text', text: 'C’est rangé : **1 note** déplacée.' }] }], runs: [{ id: 'r_1', changes: 1, undone }] });
    if (url.pathname === '/api/assistant/undo') { undone = true; return json({ restored: 1, skipped: [] }); }
    if (url.pathname === '/api/assistant/chat') {
      const lines = [{ type: 'start', conversation: 'c_1', run: 'r_1', title: 'Range' }, { type: 'action', id: 't1', label: 'Regarde « vault/00_Inbox »', status: 'running' }, { type: 'action', id: 't1', label: 'Regarde « vault/00_Inbox »', status: 'ok', detail: 'vault/00_Inbox' }, { type: 'action', id: 't2', label: 'Déplace « idée.md »', status: 'ok' }, { type: 'text', text: 'C’est rangé : **1 note** déplacée.' }, { type: 'done', run: 'r_1', conversation: 'c_1', changes: 1 }];
      const enc = new TextEncoder();
      const stream = new ReadableStream({ async start(c) { for (const l of lines) { c.enqueue(enc.encode(JSON.stringify(l) + '\n')); await sleep(20); } c.close(); } });
      return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
    }
    return json({});
  };
  w.eval('Assistant.state.loaded = false; renderMain(true)');
  await until(() => d.querySelector('[data-as="input"]'), 'zone de saisie');
  assert.match(d.querySelector('#main').innerHTML, /Que veux-tu ranger/);
  d.querySelector('[data-as="input"]').value = 'Range 00_Inbox';
  d.querySelector('[data-as="input"]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await until(() => d.querySelector('[data-as="undo"]') && !w.eval('Assistant.state.busy'), 'réponse de l’assistant');
  const thread = d.querySelector('.as-thread').innerHTML;
  assert.match(thread, /Range 00_Inbox/); assert.match(thread, /Déplace/); assert.match(thread, /<strong>1 note<\/strong>/);

  w.eval('UI.confirm = async () => true');
  click(d.querySelector('[data-as="undo"]'));
  await until(() => /Changements annulés/.test(d.querySelector('.as-thread').innerHTML), 'annulation affichée');
  // Espaces : bouton crayon, dessin, texte, aperçus
  const { space } = await api('POST', '/spaces', { kind: 'board', title: 'Maths', sections: [{ title: 'TD' }] });
  await api('POST', `/spaces/${space.id}/posts`, { title: 'TD1', attachments: [{ kind: 'local', path: path.join(lib, 'Cours', 'S1', 'MAT11-1 — Foundations', 'Materials', 'TD1.pdf'), name: 'TD1.pdf' }] });
  go(`e/${space.id}`);
  await until(() => d.querySelector('.esp-head [data-e="ink"]'), 'bouton crayon');
  assert.ok(d.querySelector('.pm-filecard img[data-thumb]'), 'aperçu demandé pour la pièce jointe');
  assert.ok(d.querySelector('.esp-head [data-e="assistant"]'), 'bouton assistant dans l’espace');
  fakeChat = null;
  click(d.querySelector('.esp-head [data-e="ink"]'));
  await until(() => d.querySelector('.ink-layer.on') && d.querySelector('.ink-bar'), 'mode dessin');
  const layer = d.querySelector('.ink-layer.on');
  layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 });
  d.querySelector('.esp-body').getBoundingClientRect = layer.getBoundingClientRect;
  const pe = (type, x, y) => layer.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  pe('pointerdown', 10, 10); pe('pointermove', 40, 30); pe('pointermove', 80, 60); pe('pointerup', 80, 60);
  await until(async () => ((await api('GET', `/spaces/${space.id}`)).space.cards.find(c => c.id === 'ink')?.objects.length === 1), 'trait enregistré');
  click(d.querySelector('[data-ink-tool="text"]'));
  const layer2 = d.querySelector('.ink-layer.on');
  layer2.getBoundingClientRect = layer.getBoundingClientRect;
  layer2.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 200, clientY: 120, button: 0 }));
  await until(() => d.querySelector('.ink-editor'), 'éditeur de texte');
  const ie = d.querySelector('.ink-editor');
  ie.value = 'À revoir !';
  ie.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
  await until(async () => ((await api('GET', `/spaces/${space.id}`)).space.cards.find(c => c.id === 'ink')?.objects.some(o => o.type === 'text' && o.text === 'À revoir !')), 'texte enregistré');
  assert.ok(d.querySelector('.ink-text'), 'texte affiché sur le tableau');
  click(d.querySelector('[data-ink="undo"]'));
  await until(async () => ((await api('GET', `/spaces/${space.id}`)).space.cards.find(c => c.id === 'ink')?.objects.length === 1), 'annulation du texte');
  click(d.querySelector('[data-ink="done"]'));
  await until(() => !d.querySelector('.ink-layer.on') && !d.querySelector('.ink-bar'), 'fin du mode dessin');
  assert.ok(d.querySelector('.ink-layer path[data-obj]'), 'le trait reste visible');
  // 3.3 : badge de type, barre du bas (taille des cartes, aperçus), colonnes repliables
  assert.ok(d.querySelector('.pm-filecard.ft-pdf .ft-badge'), 'badge PDF coloré');
  assert.ok(d.querySelector('.esp-bar [data-v-size]'), 'curseur de taille en bas');
  w.eval(`E.patchMeta({ settings: { layout: 'columns', sections: true }, sections: [...E.space.sections, { id: 'sec_b', title: 'Cours' }] })`);
  await until(() => d.querySelectorAll('.lay-columns > .col').length === 2 && d.querySelector('[data-v-scroll]'), 'disposition en colonnes avec curseur de défilement');
  const size = d.querySelector('[data-v-size]');
  size.value = '80'; size.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(d.querySelector('.esp').style.getPropertyValue('--z'), '0.8', 'taille des cartes réduite');
  click(d.querySelector('[data-v="thumbs"]'));
  await until(() => d.querySelector('.esp.no-thumbs'), 'aperçus masqués');
  click(d.querySelector('.lay-columns > .col [data-v="fold"]'));
  await until(() => d.querySelector('.lay-columns > .col.folded'), 'colonne repliée');
  click(d.querySelector('.lay-columns > .col.folded h2'));
  await until(() => !d.querySelector('.lay-columns > .col.folded'), 'colonne dépliée par un clic');
  click(d.querySelector('[data-v="foldall"]'));
  await until(() => d.querySelectorAll('.lay-columns > .col.folded').length === 2, 'tout replié');
  w.eval('E.renderSpace()');
  assert.equal(d.querySelectorAll('.lay-columns > .col.folded').length, 2, 'repli gardé après un nouvel affichage');
  assert.equal(d.querySelector('.esp').style.getPropertyValue('--z'), '0.8', 'taille gardée après un nouvel affichage');
  w.eval(`E.patchMeta({ settings: { layout: 'wall', sections: true } })`);
  await until(() => d.querySelector('.lay-wall section.sec > .sec-head [data-v="fold"]'), 'flèche de repli des sections du mur');
  assert.equal(d.querySelectorAll('.lay-wall section.sec.folded').length, 2, 'sections repliées aussi dans le mur');
  click(d.querySelector('[data-v="foldall"]'));
  await until(() => !d.querySelector('.lay-wall section.sec.folded'), 'tout déplié dans le mur');
  click(d.querySelector('.lay-wall section.sec > .sec-head [data-v="fold"]'));
  await until(() => d.querySelectorAll('.lay-wall section.sec.folded').length === 1, 'une section du mur repliée');
  click(d.querySelector('[data-v="reset"]'));
  assert.equal(d.querySelector('.esp').style.getPropertyValue('--z'), '1');
  const real = errors.filter(e => !/Could not load (img|image|link|script)|Could not parse CSS|Not implemented: (HTMLMediaElement|window\.scrollTo|navigation)/.test(e));
  assert.deepEqual(real, [], 'aucune erreur JavaScript');
  console.log('ui.test.mjs : OK (barre latérale, notes, édition auto, réglages Wispr et IA, assistant, dessin et texte, aperçus, barre du bas, colonnes repliables)');
} catch (e) {
  console.error(e.stack || e.message);
  console.error('Erreurs JS :', errors.slice(0, 20).join('\n'));
  if (serverErr) console.error('Serveur :', serverErr.slice(-1500));
  process.exitCode = 1;
} finally {
  dom.window.close();
  child.kill();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

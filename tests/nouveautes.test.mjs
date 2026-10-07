// Version 3.1 : dossiers de notes, calque de dessin des tableaux, aperçus, connexion Wispr Flow (faux serveur OAuth + MCP).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Wispr, readRpc } from '../src/espaces/wispr.mjs';
import { Thumbs } from '../src/espaces/thumbs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-31-'));
const exists = f => fs.access(f).then(() => true, () => false);

// ---------- 1. Wispr Flow : autorisation et import, avec un faux serveur ----------
{
  const support = path.join(tmp, 'wispr-support'); await fs.mkdir(support, { recursive: true });
  const inbox = path.join(tmp, 'Inbox Wispr');
  const calls = [];
  let issuedCode = null, sessionSeen = false;
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const sse = (body, headers = {}) => new Response(`event: message\ndata: ${JSON.stringify(body)}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...headers } });
  const notes = [{ id: 'n1', title: 'Matrices', modified_at: '2026-10-06T10:00:00Z', created_at: '2026-10-06T09:00:00Z' }];
  async function fakeFetch(url, init = {}) {
    const u = new URL(url);
    calls.push(`${init.method || 'GET'} ${u.pathname}`);
    if (u.pathname === '/connect/mcp') {
      const auth = init.headers?.Authorization;
      if (!auth) return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer resource_metadata="https://api.example/.well-known/oauth-protected-resource/connect/mcp"' });
      assert.equal(auth, 'Bearer jeton-1');
      const msg = JSON.parse(init.body);
      if (msg.method === 'initialize') return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }, { 'Mcp-Session-Id': 'sess-1' });
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      sessionSeen ||= init.headers['Mcp-Session-Id'] === 'sess-1';
      const { name, arguments: args } = msg.params;
      const reply = data => sse({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } });
      if (name === 'get_account_info') return reply({ name: 'Alex Martin' });
      if (name === 'search_scratchpad_notes') return reply({ notes, count: notes.length, has_more: false });
      if (name === 'search_meetings') return reply({ meetings: [{ id: 'm1', title: 'Untitled note', start: '2026-09-29T08:22:39Z', modified_at: '2026-09-29T08:22:39Z', finalized: false, has_transcript: false }], has_more: false });
      if (name === 'get_scratchpad_note') return reply({ id: args.note_id, title: 'Matrices', content: args.view_content ? 'Une matrice carrée est inversible si son déterminant est non nul.' : 'Une matrice…' });
      throw new Error(`outil inattendu ${name}`);
    }
    if (u.pathname === '/.well-known/oauth-protected-resource/connect/mcp') return json(200, { resource: 'https://api.example/connect/mcp', authorization_servers: ['https://auth.example'], scopes_supported: ['read'] });
    if (u.host === 'auth.example' && u.pathname === '/.well-known/oauth-authorization-server') return json(200, { issuer: 'https://auth.example', authorization_endpoint: 'https://auth.example/authorize', token_endpoint: 'https://auth.example/token', registration_endpoint: 'https://auth.example/register' });
    if (u.pathname === '/register') { const b = JSON.parse(init.body); assert.deepEqual(b.redirect_uris, ['http://127.0.0.1:4000/api/wispr/callback']); assert.equal(b.token_endpoint_auth_method, 'none'); return json(201, { client_id: 'client-ca' }); }
    if (u.pathname === '/token') {
      const f = new URLSearchParams(init.body);
      assert.equal(f.get('client_id'), 'client-ca');
      if (f.get('grant_type') === 'authorization_code') { assert.equal(f.get('code'), issuedCode); assert.ok(f.get('code_verifier')?.length >= 43); assert.equal(f.get('resource'), 'https://api.example/connect/mcp'); return json(200, { access_token: 'jeton-1', refresh_token: 'r-1', expires_in: 3600 }); }
    }
    return json(404, { error: 'not found' });
  }
  const w = await new Wispr({ supportDir: support, url: 'https://api.example/connect/mcp', fetch: fakeFetch, target: async () => ({ dir: inbox, vault: null }) }).load();
  assert.equal(w.status().connected, false);
  const { url } = await w.startAuth('http://127.0.0.1:4000/api/wispr/callback');
  const au = new URL(url);
  assert.equal(au.origin + au.pathname, 'https://auth.example/authorize');
  assert.equal(au.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(au.searchParams.get('client_id'), 'client-ca');
  assert.equal(au.searchParams.get('resource'), 'https://api.example/connect/mcp');
  assert.equal(au.searchParams.get('scope'), 'read');
  await assert.rejects(w.finishAuth({ code: 'x', state: 'mauvais' }), /expirée ou inconnue/);
  const again = await w.startAuth('http://127.0.0.1:4000/api/wispr/callback');
  issuedCode = 'code-42';
  const st = await w.finishAuth({ code: issuedCode, state: new URL(again.url).searchParams.get('state') });
  assert.equal(st.connected, true);
  assert.equal(st.account, 'Alex Martin');
  assert.ok(sessionSeen, 'session MCP réutilisée');
  const mode = (await fs.stat(path.join(support, 'wispr.json'))).mode & 0o777;
  assert.equal(mode, 0o600, 'jetons privés');
  const r1 = await w.importNew();
  assert.equal(r1.notes, 1);
  assert.equal(r1.meetings, 0, 'réunion vide ignorée');
  const files = await fs.readdir(inbox);
  assert.equal(files.length, 1);
  const text = await fs.readFile(path.join(inbox, files[0]), 'utf8');
  assert.match(text, /wispr_id: "n1"/);
  assert.match(text, /déterminant/);
  await fs.appendFile(path.join(inbox, files[0]), 'Ma remarque perso\n');
  const r2 = await w.importNew();
  assert.equal(r2.imported, 0, 'rien de neuf');
  notes[0].modified_at = '2026-10-06T12:00:00Z';
  await w.importNew();
  const after = await fs.readFile(path.join(inbox, files[0]), 'utf8');
  assert.match(after, /Ma remarque perso/, 'les notes de l’étudiant hors de la zone Wispr sont gardées');
  assert.equal((await fs.readdir(inbox)).length, 1, 'mise à jour sur place, pas de doublon');
  const tools = w.extension().tools().map(t => t.name);
  assert.deepEqual(tools, ['wispr_chercher', 'wispr_lire', 'wispr_importer']);
  await w.disconnect();
  assert.equal(w.extension().tools().length, 0);
  const parsed = await readRpc(new Response('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 7);
  assert.equal(parsed.result.ok, 1);
}

// ---------- 2. Aperçus : cache et file d’attente ----------
{
  const dir = path.join(tmp, 'apercus');
  let made = 0;
  const t = new Thumbs({ dir, maker: async (file, out) => { made++; await fs.writeFile(out, 'png'); return true; } });
  const f = path.join(tmp, 'cours.pdf'); await fs.writeFile(f, '%PDF');
  const [a, b] = await Promise.all([t.get(f), t.get(f)]);
  assert.equal(a, b); assert.equal(made, 1, 'un seul aperçu calculé pour deux demandes');
  assert.equal(await t.get(f), a); assert.equal(made, 1, 'cache');
  assert.equal(await t.get(path.join(tmp, 'absent.pdf')), null);
}

// ---------- 3. Serveur : dossiers de notes, calque de dessin, aperçus ----------
const TOKEN = 'jeton-de-test-0123456789abcdef';
const support = path.join(tmp, 'support');
const library = path.join(tmp, 'Bibliotheque');
await fs.mkdir(library, { recursive: true });
await fs.writeFile(path.join(library, 'TD1.pdf'), '%PDF-1.4 test');
const child = spawn(process.execPath, [path.join(root, 'src/espaces/server.mjs'), '--support', support, '--ui', path.join(root, 'src/ui'), '--port', '0', '--lan-port', '0', '--allow', library], { env: { ...process.env, CA_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] });
const ready = await new Promise((resolve, reject) => {
  let buf = '';
  child.stdout.on('data', d => { buf += d; const nl = buf.indexOf('\n'); if (nl >= 0) resolve(JSON.parse(buf.slice(0, nl))); });
  child.on('exit', code => reject(new Error(`Le serveur s’est arrêté (code ${code})`)));
  setTimeout(() => reject(new Error('Le serveur n’a pas démarré.')), 15000);
});
const base = `http://127.0.0.1:${ready.port}`;
const owner = { 'X-Token': TOKEN };
async function api(method, url, body, headers = owner, expect) {
  const res = await fetch(base + url, { method, headers: { ...headers, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${url} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  else assert.ok(res.ok, `${method} ${url} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}
try {
  // Dossiers de notes
  await api('GET', '/api/notes', undefined, {}, 403);
  await api('POST', '/api/notes/folders', { path: '/' }, owner, 400);
  await api('POST', '/api/notes/folders', { path: os.homedir() }, owner, 400);
  const { folder } = await api('POST', '/api/notes/folders', { name: 'Brouillons' }, owner, 201);
  assert.equal(folder.path, path.join(support, 'Notes', 'Brouillons'));
  await api('POST', '/api/notes/folders', { name: 'Brouillons' }, owner, 409);
  const created = await api('POST', '/api/notes/new', { folder: folder.id, title: 'Idées projet' }, owner, 201);
  assert.equal(await fs.readFile(created.path, 'utf8'), '# Idées projet\n\n');
  const second = await api('POST', '/api/notes/new', { folder: folder.id, title: 'Idées projet' }, owner, 201);
  assert.equal(path.basename(second.path), 'Idées projet 2.md', 'jamais d’écrasement');
  await api('POST', '/api/notes/mkdir', { folder: folder.id, name: 'Maths' }, owner, 201);
  await api('POST', '/api/notes/new', { folder: folder.id, sub: 'Maths', title: 'Chapitre 1', text: '# Chapitre 1\n\nLes quantificateurs [[Idées projet|idées]].' }, owner, 201);
  const list = await api('GET', `/api/notes/list?folder=${folder.id}`);
  assert.deepEqual(list.dirs.map(d => d.name), ['Maths']);
  assert.equal(list.files.filter(f => f.note).length, 2);
  const sub = await api('GET', `/api/notes/list?folder=${folder.id}&sub=Maths`);
  assert.equal(sub.files[0].title, 'Chapitre 1');
  assert.match(sub.files[0].excerpt, /quantificateurs idées/);
  await api('GET', `/api/notes/list?folder=${folder.id}&sub=../..`).then(r => assert.equal(r.sub, ''), () => {});
  const file = await api('GET', `/api/file?path=${encodeURIComponent(created.path)}`);
  assert.equal(file.editable, true, 'les notes s’ouvrent et se modifient dans le lecteur');
  const state = await api('GET', '/api/state');
  assert.equal(state.notes.length, 1);
  assert.equal(state.wispr.connected, false);
  await api('POST', '/api/notes/folders/remove', { id: folder.id });
  assert.ok(await exists(created.path), 'retirer un dossier de la liste ne supprime rien');
  await api('GET', `/api/file?path=${encodeURIComponent(created.path)}`, undefined, owner, 403);

  // Calque de dessin et de texte sur un tableau
  const { space } = await api('POST', '/api/spaces', { kind: 'board', title: 'Maths', sections: [{ title: 'TD' }] }, owner, 201);
  const ink = await api('POST', `/api/spaces/${space.id}/cards/ink/objects`, { objects: [{ type: 'path', x: 10, y: 20, w: 100, h: 50, points: [[0, 0], [50, 25], [100, 50]], style: { stroke: '#ef4444', strokeWidth: 4 } }, { type: 'text', x: 300, y: 40, w: 200, h: 40, text: 'À revoir !' }] });
  assert.equal(ink.objects.length, 2);
  const full = await api('GET', `/api/spaces/${space.id}`);
  const layer = (full.space || full).cards.find(c => c.id === 'ink');
  assert.equal(layer.objects.length, 2);
  await api('POST', `/api/spaces/${space.id}/cards/ink/objects/delete`, { ids: [ink.objects[0].id] });
  const after = await api('GET', `/api/spaces/${space.id}`);
  assert.equal((after.space || after).cards.find(c => c.id === 'ink').objects.length, 1);
  await api('POST', `/api/spaces/${space.id}/cards/autre/objects`, { objects: [{ type: 'text', text: 'x' }] }, owner, 404);

  // Aperçus : pièce jointe locale (pas de Quick Look ici → 404 propre), accès refusé aux inconnus
  const post = await api('POST', `/api/spaces/${space.id}/posts`, { title: 'TD1', attachments: [{ kind: 'local', path: path.join(library, 'TD1.pdf'), name: 'TD1.pdf' }] }, owner, 201);
  const att = (post.post || post).attachments[0];
  const unknown = await fetch(`${base}/thumb/${space.id}/${att.id}`);
  assert.equal(unknown.status, 403);
  const own = await fetch(`${base}/thumb/${space.id}/${att.id}?t=${TOKEN}`);
  assert.equal(own.status, process.platform === 'darwin' ? own.status : 404);
  const outside = await fetch(`${base}/thumb?path=${encodeURIComponent('/etc/hosts')}&t=${TOKEN}`);
  assert.equal(outside.status, 403);

  // Wispr : statut, retour d’autorisation inconnu
  assert.equal((await api('GET', '/api/wispr')).connected, false);
  const cb = await fetch(`${base}/api/wispr/callback?code=a&state=b`);
  assert.equal(cb.status, 400);
  assert.match(await cb.text(), /Connexion impossible/);

  console.log('nouveautes.test.mjs : OK (Wispr Flow, aperçus, dossiers de notes, calque de dessin)');
} finally {
  child.stdin.end();
  await new Promise(r => setTimeout(r, 300));
  child.kill();
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

// Test du serveur des espaces : API, droits, invités, modération, temps réel, exports et sauvegardes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-espaces-'));
const TOKEN = 'jeton-de-test-0123456789abcdef';
const library = path.join(tmp, 'Bibliotheque');
await fs.mkdir(library, { recursive: true });
await fs.writeFile(path.join(library, 'TD1 -- MAT11-1.pdf'), '%PDF-1.4 test');

const child = spawn(process.execPath, [path.join(root, 'src/espaces/server.mjs'), '--support', tmp, '--ui', path.join(root, 'src/ui'), '--port', '0', '--lan-port', '0', '--allow', library], { env: { ...process.env, CA_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'inherit'] });
const ready = await new Promise((resolve, reject) => {
  let buf = '';
  child.stdout.on('data', d => { buf += d; const nl = buf.indexOf('\n'); if (nl >= 0) resolve(JSON.parse(buf.slice(0, nl))); });
  child.on('exit', code => reject(new Error(`Le serveur s’est arrêté (code ${code})`)));
  setTimeout(() => reject(new Error('Le serveur n’a pas démarré.')), 15000);
});
const base = `http://127.0.0.1:${ready.port}`;
const owner = { 'X-Token': TOKEN };
const guestA = (key, extra = {}) => ({ 'X-Key': key, 'X-User': 'invite-aaaaaaaa', 'X-Name': encodeURIComponent('Inès'), ...extra });
const guestB = key => ({ 'X-Key': key, 'X-User': 'invite-bbbbbbbb', 'X-Name': encodeURIComponent('Bastien') });
async function api(method, url, body, headers = owner, expect) {
  const res = await fetch(base + url, { method, headers: { ...headers, ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (expect !== undefined) assert.equal(res.status, expect, `${method} ${url} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  else assert.ok(res.ok, `${method} ${url} → ${res.status} ${type.includes('json') ? JSON.stringify(data) : ''}`);
  return { res, data };
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DAwMDAxMDAAAAVBAMBkmJXHwAAAABJRU5ErkJggg==', 'base64');

try {
  // Accès propriétaire et sécurité de base
  assert.equal(ready.ready, true);
  await api('GET', '/api/state', undefined, {}, 403);
  await api('GET', '/api/state', undefined, { 'X-Token': 'mauvais' }, 403);
  const hostAttack = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: ready.port, path: '/api/ping', headers: { Host: 'evil.example' } }, r => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(hostAttack, 403, 'Les hôtes inconnus sont refusés (rebinding DNS)');
  let { data } = await api('GET', '/api/state');
  assert.equal(data.spaces.length, 0);

  // Création d’un tableau avec champs et sections
  ({ data } = await api('POST', '/api/spaces', {
    kind: 'board', title: 'Brainstorm recyclage', icon: '♻️',
    fields: [{ id: 'f_note', name: 'Note', type: 'rating' }, { id: 'f_cat', name: 'Catégorie', type: 'select', options: [{ id: 'o_a', label: 'Idée' }, { id: 'o_b', label: 'Question' }] }, { id: 'f_vote', name: 'Votes', type: 'vote' }],
    sections: [{ id: 's_one', title: 'Idées' }, { id: 's_two', title: 'Questions' }],
    settings: { layout: 'columns', reactions: 'like' },
    posts: [{ title: 'Exemple', body: 'Un **exemple** de publication', sectionId: 's_one' }],
  }, owner, 201));
  const space = data.space;
  assert.equal(space.posts.length, 1);
  assert.equal(space.settings.layout, 'columns');
  assert.equal(space.sharing.visibility, 'private');
  const id = space.id;

  // Fichier joint (image) : dimensions détectées, lecture partielle
  ({ data } = await api('POST', `/api/spaces/${id}/media?name=${encodeURIComponent('photo test.png')}`, new Uint8Array(PNG), { ...owner, 'Content-Type': 'image/png' }, 201));
  const att = data.attachment;
  assert.equal(att.kind, 'image'); assert.equal(att.w, 2); assert.equal(att.h, 3);
  const ranged = await fetch(`${base}/media/${id}/${att.file}?t=${TOKEN}`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(ranged.status, 206); assert.equal(Buffer.from(await ranged.arrayBuffer()).length, 4);
  assert.equal((await fetch(`${base}/media/${id}/${att.file}`)).status, 403, 'Fichier refusé sans jeton ni clé');
  assert.equal((await fetch(`${base}/media/${id}/..%2Fspace.json?t=${TOKEN}`)).status, 404, 'Pas de traversée de dossier');

  ({ data } = await api('POST', `/api/spaces/${id}/posts`, { title: 'Photo', body: 'Avec image', sectionId: 's_one', attachments: [att], fields: { f_note: 4, f_cat: 'o_a', inconnu: 1 } }, owner, 201));
  const photo = data.post;
  assert.equal(photo.fields.f_note, 4); assert.equal(photo.fields.inconnu, undefined);
  await api('POST', `/api/spaces/${id}/posts`, { title: '' }, owner, 400);

  // Partage par lien : invités contributeurs
  await api('GET', `/api/spaces/${id}`, undefined, guestA('nimporte'), 403);
  ({ data } = await api('POST', `/api/spaces/${id}/sharing`, { visibility: 'link', startLan: false }));
  const key = data.sharing.links.find(l => l.role === 'contributor').key;
  ({ data } = await api('GET', `/api/spaces/${id}`, undefined, guestA(key)));
  assert.equal(data.me.role, 'contributor');
  assert.equal(data.space.sharing.links, undefined, 'Les invités ne voient pas les clés de partage');
  await api('GET', `/api/spaces/${id}`, undefined, { 'X-Key': key }, 400);
  await api('GET', '/api/state', undefined, guestA(key), 403);
  ({ data } = await api('POST', `/api/spaces/${id}/join`, { name: 'Inès' }, guestA(key)));
  assert.equal(data.me.name, 'Inès');

  // Temps réel : l’invité B reçoit la publication de A
  const ac = new AbortController();
  const events = [];
  const stream = fetch(`${base}/api/spaces/${id}/events?k=${key}&u=invite-bbbbbbbb`, { signal: ac.signal }).then(async res => {
    const reader = res.body.getReader();
    let text = '';
    for (;;) { const { done, value } = await reader.read(); if (done) break; text += Buffer.from(value).toString(); let i; while ((i = text.indexOf('\n\n')) >= 0) { const block = text.slice(0, i); text = text.slice(i + 2); const ev = block.match(/^event: (.+)$/m)?.[1]; const d = block.match(/^data: (.+)$/m)?.[1]; if (ev) events.push({ ev, data: JSON.parse(d) }); } }
  }).catch(() => {});
  await new Promise(r => setTimeout(r, 300));
  ({ data } = await api('POST', `/api/spaces/${id}/posts`, { title: 'Idée de Inès', body: 'Composteur collectif', sectionId: 's_one', poll: { question: 'On le fait ?', options: ['Oui', 'Non'] }, attachments: [{ kind: 'local', path: '/etc/passwd' }] }, guestA(key), 201));
  const inesPost = data.post;
  assert.equal(inesPost.author.name, 'Inès');
  assert.equal(inesPost.attachments.length, 0, 'Un invité ne peut pas joindre de fichier local');
  await new Promise(r => setTimeout(r, 400));
  assert.ok(events.some(e => e.ev === 'hello'), 'Événement de bienvenue');
  assert.ok(events.some(e => e.ev === 'post' && e.data.post.id === inesPost.id), 'Publication reçue en direct');
  assert.ok(events.some(e => e.ev === 'presence' && e.data.people.length >= 1), 'Présence diffusée');

  // Réactions, sondage, vote de champ, commentaires (votes anonymisés)
  ({ data } = await api('POST', `/api/spaces/${id}/posts/${inesPost.id}/react`, { type: 'like' }, guestB(key)));
  assert.equal(data.post.reactions.like, 1); assert.equal(data.post.reactions.mine.like, true);
  ({ data } = await api('POST', `/api/spaces/${id}/posts/${inesPost.id}/react`, { type: 'fieldVote', field: 'f_vote' }, guestB(key)));
  assert.equal(data.post.reactions.fieldVotes.f_vote, 1);
  const optionYes = inesPost.poll.options[0].id;
  ({ data } = await api('POST', `/api/spaces/${id}/posts/${inesPost.id}/vote`, { options: [optionYes] }, guestB(key)));
  assert.equal(data.post.poll.counts[optionYes], 1); assert.equal(data.post.poll.votes, undefined);
  ({ data } = await api('POST', `/api/spaces/${id}/posts/${inesPost.id}/comments`, { body: 'Bonne idée !' }, guestB(key), 201));
  assert.equal(data.post.comments.length, 1);
  await api('PATCH', `/api/spaces/${id}/posts/${inesPost.id}`, { title: 'Piratage' }, guestB(key), 403);
  await api('DELETE', `/api/spaces/${id}/posts/${inesPost.id}/comments/${data.post.comments[0].id}`, undefined, guestA(key), 403);

  // Modération : validation obligatoire
  await api('PATCH', `/api/spaces/${id}`, { settings: { moderation: 'approval' } });
  ({ data } = await api('POST', `/api/spaces/${id}/posts`, { title: 'En attente', body: 'À valider' }, guestA(key), 201));
  const pending = data.post;
  assert.equal(pending.status, 'pending');
  ({ data } = await api('GET', `/api/spaces/${id}`, undefined, guestB(key)));
  assert.ok(!data.space.posts.some(p => p.id === pending.id), 'Invisible pour les autres invités');
  ({ data } = await api('GET', `/api/spaces/${id}`, undefined, guestA(key)));
  assert.ok(data.space.posts.some(p => p.id === pending.id), 'Visible pour son auteur');
  ({ data } = await api('GET', `/api/spaces/${id}`));
  assert.equal(data.space.pending, 1);
  await api('POST', `/api/spaces/${id}/posts/${pending.id}/moderate`, { decision: 'approve' }, guestA(key), 403);
  await api('POST', `/api/spaces/${id}/posts/${pending.id}/moderate`, { decision: 'approve' });
  ({ data } = await api('GET', `/api/spaces/${id}`, undefined, guestB(key)));
  assert.ok(data.space.posts.some(p => p.id === pending.id), 'Visible après validation');
  await api('PATCH', `/api/spaces/${id}`, { settings: { moderation: 'auto' } });
  ({ data } = await api('POST', `/api/spaces/${id}/posts`, { title: 'Insulte', body: 'espèce de connard' }, guestA(key), 201));
  assert.equal(data.post.status, 'pending', 'Modération automatique');

  // Publication programmée : invisible pour les invités avant l’heure
  ({ data } = await api('POST', `/api/spaces/${id}/posts`, { title: 'Plus tard', body: 'Dévoilé demain', publishAt: new Date(Date.now() + 86400_000).toISOString() }, owner, 201));
  const later = data.post;
  ({ data } = await api('GET', `/api/spaces/${id}`, undefined, guestB(key)));
  assert.ok(!data.space.posts.some(p => p.id === later.id), 'Publication programmée masquée');

  // Brouillon
  await api('PUT', `/api/spaces/${id}/draft`, { draft: { title: 'Brouillon', body: 'en cours' } }, guestA(key));
  ({ data } = await api('GET', `/api/spaces/${id}/draft`, undefined, guestA(key)));
  assert.equal(data.draft.title, 'Brouillon');
  ({ data } = await api('GET', `/api/spaces/${id}/draft`, undefined, guestB(key)));
  assert.equal(data.draft, null, 'Les brouillons sont personnels');

  // Déplacement (glisser-déposer) et sections
  ({ data } = await api('POST', `/api/spaces/${id}/posts/move`, { moves: [{ id: photo.id, sectionId: 's_two', order: -5 }] }));
  assert.equal(data.posts[0].sectionId, 's_two');
  await api('PATCH', `/api/spaces/${id}`, { sections: [{ id: 's_two', title: 'Questions' }] });
  ({ data } = await api('GET', `/api/spaces/${id}`));
  assert.ok(data.space.posts.every(p => p.sectionId === 's_two'), 'Les publications d’une section supprimée sont gardées');

  // Fichier local joint par le propriétaire, servi seulement s’il est dans la bibliothèque
  ({ data } = await api('POST', `/api/spaces/${id}/posts`, { title: 'TD1', attachments: [{ kind: 'local', path: path.join(library, 'TD1 -- MAT11-1.pdf'), name: 'TD1 -- MAT11-1.pdf' }, { kind: 'local', path: '/etc/hosts', name: 'hosts' }] }, owner, 201));
  const [inside, outside] = data.post.attachments;
  assert.equal((await fetch(`${base}/local/${id}/${inside.id}?k=${key}`)).status, 200);
  assert.equal((await fetch(`${base}/local/${id}/${outside.id}?t=${TOKEN}`)).status, 403);

  // Exports
  let res = await fetch(`${base}/api/spaces/${id}/export.csv?t=${TOKEN}`);
  const csv = Buffer.from(await res.arrayBuffer()).toString('utf8');
  assert.ok(csv.startsWith('﻿Section;Titre;Texte'), 'CSV avec en-têtes');
  assert.ok(csv.includes('Composteur collectif'));
  res = await fetch(`${base}/api/spaces/${id}/export.xlsx?t=${TOKEN}`);
  const xlsx = Buffer.from(await res.arrayBuffer());
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
  assert.ok(xlsx.includes(Buffer.from('xl/worksheets/sheet3.xml')), 'Plusieurs feuilles (publications, commentaires, réactions…)');
  assert.equal((await fetch(`${base}/api/spaces/${id}/export.csv?k=${key}&u=invite-aaaaaaaa`)).status, 403, 'Export réservé');
  res = await fetch(`${base}/api/spaces/${id}/export.zip?t=${TOKEN}`);
  const zip = Buffer.from(await res.arrayBuffer());
  assert.ok(zip.includes(Buffer.from('photo test.png')), 'Archive des fichiers joints');
  res = await fetch(`${base}/api/spaces/${id}/export.cae?t=${TOKEN}`);
  const backup = new Uint8Array(await res.arrayBuffer());
  ({ data } = await api('POST', '/api/import', backup, { ...owner, 'Content-Type': 'application/zip' }, 201));
  assert.equal(data.summary.title, 'Brainstorm recyclage');
  const imported = data.summary.id;
  ({ data } = await api('GET', `/api/spaces/${imported}`));
  assert.equal(data.space.posts.length, (await api('GET', `/api/spaces/${id}`)).data.space.posts.length);
  assert.equal(data.space.sharing.visibility, 'private', 'Une sauvegarde importée n’est pas partagée');
  const importedImage = data.space.posts.flatMap(p => p.attachments).find(a => a.kind === 'image');
  assert.equal((await fetch(`${base}/media/${imported}/${importedImage.file}?t=${TOKEN}`)).status, 200, 'Fichiers restaurés');

  // Espace libre : cartes, objets, mode interaction
  ({ data } = await api('POST', '/api/spaces', { kind: 'canvas', title: 'Quiz', settings: { canvasMode: 'interact', participantsCanAdd: false } }, owner, 201));
  const canvas = data.space;
  const card = canvas.cards[0].id;
  ({ data } = await api('POST', `/api/spaces/${canvas.id}/cards`, { title: 'Bravo' }, owner, 201));
  const card2 = data.card.id;
  ({ data } = await api('POST', `/api/spaces/${canvas.id}/cards/${card}/objects`, { objects: [{ type: 'sticky', x: 10, y: 20, w: 200, h: 160, text: 'Question ?', action: { type: 'card', target: card2 } }, { type: 'poll', x: 300, y: 20, w: 300, h: 200, poll: { question: 'Choix', options: ['A', 'B'] } }, { type: 'nimporte' }] }));
  assert.equal(data.objects.length, 2);
  const pollObj = data.objects[1];
  ({ data } = await api('POST', `/api/spaces/${canvas.id}/sharing`, { visibility: 'link', startLan: false }));
  const ckey = data.sharing.links[0].key;
  await api('POST', `/api/spaces/${canvas.id}/cards/${card}/objects`, { objects: [{ type: 'text', text: 'tag' }] }, guestA(ckey), 403);
  ({ data } = await api('POST', `/api/spaces/${canvas.id}/cards/${card}/objects/${pollObj.id}/vote`, { options: [pollObj.poll.options[1].id] }, guestA(ckey)));
  assert.equal(data.object.poll.counts[pollObj.poll.options[1].id], 1);
  await api('DELETE', `/api/spaces/${canvas.id}/cards/${card2}`);
  ({ data } = await api('GET', `/api/spaces/${canvas.id}`));
  assert.equal(data.space.cards[0].objects[0].action, undefined, 'Lien vers une carte supprimée retiré');

  // Duplication, corbeille, suppression définitive
  ({ data } = await api('POST', `/api/spaces/${id}/duplicate`, { template: true }, owner, 201));
  assert.equal(data.summary.isTemplate, true);
  await api('DELETE', `/api/spaces/${imported}`, undefined, owner, 409);
  await api('PATCH', `/api/spaces/${imported}`, { trashed: true });
  await api('DELETE', `/api/spaces/${imported}`);
  await api('GET', `/api/spaces/${imported}`, undefined, owner, 404);
  ({ data } = await api('GET', '/api/state'));
  assert.equal(data.spaces.length, 3);

  // Révocation : un espace redevenu privé coupe les invités
  await api('POST', `/api/spaces/${id}/sharing`, { visibility: 'private' });
  await api('GET', `/api/spaces/${id}`, undefined, guestA(key), 403);
  ac.abort(); await stream;

  // Persistance : arrêt propre puis relecture du disque
  child.stdin.end();
  await new Promise(r => child.once('exit', r));
  const saved = JSON.parse(await fs.readFile(path.join(tmp, 'Espaces', id, 'space.json'), 'utf8'));
  assert.ok(saved.posts.length >= 6, 'Espace enregistré sur le disque');
  console.log(`OK : espaces (création, invités, temps réel, modération, brouillons, exports CSV/Excel/ZIP, sauvegarde, espace libre, sécurité).`);
} finally {
  if (child.exitCode === null) child.kill();
  await fs.rm(tmp, { recursive: true, force: true });
}

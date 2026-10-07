// Serveur local des espaces Cours Albert : API, temps réel (SSE), fichiers, partage sur le réseau local.
// Lancé par l’app : node espaces/server.mjs --support <dossier> --ui <dossier ui> [--port 47821] [--allow <dossier>]… ; jeton propriétaire dans CA_TOKEN.
import http from 'node:http';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store, HttpError, mimeOf } from './store.mjs';
import { resolveAccess, can, rights, spaceForViewer, metaForViewer, postForViewer, postVisible, cardVisible, cardForViewer, objectForViewer, spaceSummary, safeId, line, normalizeSpace, rid } from './model.mjs';
import { spaceSheets, toCSV, writeXLSX, writeFilesZip, writeBackup, readZip, zipEntryBuffer, extractZipEntry } from './exporter.mjs';
import { linkPreview, embedFor } from './preview.mjs';
import { AI } from './ai.mjs';
import { Assistant } from './agent.mjs';
import { Thumbs } from './thumbs.mjs';
import { Wispr } from './wispr.mjs';

const VERSION = '3.3.2';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback = null) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const DEV = args.includes('--dev');
const SUPPORT = path.resolve(arg('--support', path.join(os.homedir(), 'Library/Application Support/Cours Albert Sync')));
const UI = path.resolve(arg('--ui', path.join(here, '..', 'ui')));
const PREFERRED_PORT = Number(arg('--port', '47821'));
const PREFERRED_LAN_PORT = Number(arg('--lan-port', '47822'));
const ALLOWED_ROOTS = args.flatMap((a, i) => a === '--allow' && args[i + 1] ? [path.resolve(args[i + 1])] : []);
const VAULT = arg('--vault') ? path.resolve(arg('--vault')) : null;
if (VAULT && !ALLOWED_ROOTS.includes(VAULT)) ALLOWED_ROOTS.push(VAULT);
const sessionAllowed = new Set();
const TEXT_EXT = new Set(['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'py', 'js', 'mjs', 'ts', 'css', 'html', 'htm', 'xml', 'yaml', 'yml', 'tex', 'bib', 'r', 'sql', 'sh', 'ini', 'log', 'canvas', 'ipynb', 'swift', 'c', 'h', 'java', 'rb', 'go', 'rs']);
const OWNER_TOKEN = process.env.CA_TOKEN || (DEV ? 'dev' : crypto.randomBytes(24).toString('base64url'));
const LOG_FILE = path.join(SUPPORT, 'espaces.log');

// ---------- Journal ----------
let logBytes = 0;
function log(message) {
  const lineText = `${new Date().toISOString()} ${message}\n`;
  try {
    if (!logBytes) logBytes = fss.existsSync(LOG_FILE) ? fss.statSync(LOG_FILE).size : 0;
    if (logBytes > 2_000_000) { fss.renameSync(LOG_FILE, `${LOG_FILE}.1`); logBytes = 0; }
    fss.appendFileSync(LOG_FILE, lineText); logBytes += lineText.length;
  } catch {}
  if (DEV) process.stderr.write(lineText);
}
process.on('uncaughtException', e => log(`Erreur non gérée : ${e?.stack || e}`));
process.on('unhandledRejection', e => log(`Promesse rejetée : ${e?.stack || e}`));

await fs.mkdir(SUPPORT, { recursive: true });
const store = await new Store({ root: path.join(SUPPORT, 'Espaces'), log }).load();
const ai = await new AI({ supportDir: SUPPORT, log }).load();
// Aperçus des fichiers (Quick Look de macOS), mis en cache dans le dossier de données.
const thumbs = new Thumbs({ dir: path.join(SUPPORT, 'Apercus'), log });
thumbs.prune().catch(() => {});

// ---------- Dossiers de notes (choisis dans l’app : on y écrit des notes Markdown) ----------
function noteFolders() {
  const list = Array.isArray(store.prefs.noteFolders) ? store.prefs.noteFolders : [];
  return list.filter(f => f && typeof f.path === 'string' && path.isAbsolute(f.path)).map(f => ({ id: safeId(f.id) || `n_${rid(6)}`, name: line(f.name, 80) || path.basename(f.path), path: path.resolve(f.path) }));
}
function noteRoots() { return noteFolders().map(f => f.path); }
async function saveNoteFolders(list) { store.prefs.noteFolders = list.slice(0, 60); await store.savePrefs(); }
async function addNoteFolder(dir, name) {
  const abs = path.resolve(dir);
  const home = os.homedir();
  if (!path.isAbsolute(abs) || abs === '/' || abs === home || abs === path.dirname(home) || abs === SUPPORT || within(SUPPORT, [abs])) throw new HttpError(400, 'Choisissez un dossier précis (pas la racine du disque ni votre dossier personnel).');
  await fs.mkdir(abs, { recursive: true });
  if (!(await fs.stat(abs).catch(() => null))?.isDirectory()) throw new HttpError(400, 'Ce n’est pas un dossier.');
  const list = noteFolders();
  const found = list.find(f => f.path === abs);
  if (found) return found;
  const folder = { id: `n_${rid(8)}`, name: line(name, 80) || path.basename(abs), path: abs };
  await saveNoteFolders([...list, folder]);
  return folder;
}
const noteFolder = id => { const f = noteFolders().find(x => x.id === id); if (!f) throw new HttpError(404, 'Dossier de notes introuvable.'); return f; };

// ---------- Wispr Flow (connexion facultative, lecture seule) ----------
async function wisprTarget() {
  if (VAULT) return { dir: path.join(VAULT, '00_Inbox', 'Wispr'), vault: VAULT };
  const dir = path.join(SUPPORT, 'Notes', 'Wispr');
  await addNoteFolder(dir, 'Wispr Flow').catch(() => {});
  return { dir, vault: null };
}
const wispr = await new Wispr({ supportDir: SUPPORT, log, target: () => wisprTarget(), onImported: info => { vaultIndex = null; for (const c of ownerClients) sse(c, 'wispr', { ...info, status: wispr.status() }); } }).load();

// Assistant IA (même clé que le tri) : range les fichiers du vault, les dossiers de notes et les espaces ; jamais de suppression, tout est annulable.
const assistant = await new Assistant({ ai, store, supportDir: SUPPORT, vault: VAULT, libraries: ALLOWED_ROOTS, notes: () => noteFolders(), extensions: [wispr.extension()], ownerViewer: () => ownerViewer(), onSpace: s => ownerSummary(s), log }).load();

// ---------- Outils HTTP ----------
const sameToken = t => typeof t === 'string' && t.length === OWNER_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(OWNER_TOKEN));
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Token, X-Key, X-User, X-Name, X-Group, X-Origin, Range', 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Content-Range' };
function send(res, status, body, headers = {}) {
  if (res.headersSent) { try { res.end(); } catch {} return; }
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(json);
}
async function readJSON(req, limit = 4 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Requête trop volumineuse.'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON invalide.'); }
}
const disposition = (name, inline = false) => `${inline ? 'inline' : 'attachment'}; filename="${String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
const fileStamp = () => new Date().toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
const safeFileName = s => String(s || 'Espace').replace(/[\x00-\x1f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Espace';

// ---------- Limites de débit (invités) ----------
const buckets = new Map();
function limit(key, max, windowMs = 60_000) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Trop d’actions en peu de temps. Patientez un instant.');
  list.push(now); buckets.set(key, list);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some(t => now - t < 120_000)) buckets.delete(k); }, 60_000).unref();

// ---------- Identité ----------
function ownerViewer() { return { id: 'owner', name: store.ownerName(), role: 'owner', isOwner: true, group: null }; }
function isOwnerRequest(req, url, lan) { return !lan && sameToken(req.headers['x-token'] || url.searchParams.get('t')); }
function viewerFor(req, url, space, lan, { requireId = true } = {}) {
  if (isOwnerRequest(req, url, lan)) return ownerViewer();
  const key = req.headers['x-key'] || url.searchParams.get('k') || '';
  const access = resolveAccess(space, key);
  if (!access) return null;
  if (access.asOwner) return { id: 'owner', name: store.ownerName(), role: 'admin', asOwner: true, isOwner: false, group: null, key };
  let uid = safeId(req.headers['x-user'] || url.searchParams.get('u'));
  if (!uid || uid === 'owner' || uid === 'anon' || uid.length < 8) {
    if (requireId) throw new HttpError(400, 'Identifiant de participant manquant : rechargez la page.');
    uid = 'visiteur';
  }
  let name = '';
  try { name = decodeURIComponent(req.headers['x-name'] || url.searchParams.get('n') || ''); } catch {}
  const person = space.people[uid];
  const group = access.group || person?.group || safeId(req.headers['x-group'] || url.searchParams.get('g'));
  return { id: uid, name: line(name, 80) || person?.name || (access.invite ? access.label : '') || 'Anonyme', role: access.role, isOwner: false, group: space.groups.some(g => g.id === group) ? group : null, key, linkId: access.linkId };
}
const meFor = (viewer, space) => ({ id: viewer.id, name: viewer.name, role: viewer.isOwner ? 'owner' : viewer.role, rights: rights(viewer), group: viewer.group || null, asOwner: !!viewer.asOwner, aiSort: ai.status().enabled && (viewer.isOwner || (space.settings.guestAI && can(viewer, 'edit'))) });

// ---------- Temps réel ----------
const clients = new Map(); // spaceId -> Set<client>
const ownerClients = new Set();
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
const colorFor = id => COLORS[parseInt(crypto.createHash('md5').update(String(id)).digest('hex').slice(0, 6), 16) % COLORS.length];
function sse(client, event, data) {
  try { client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}
const presenceTimers = new Map();
function presence(spaceId) {
  clearTimeout(presenceTimers.get(spaceId));
  presenceTimers.set(spaceId, setTimeout(() => {
    presenceTimers.delete(spaceId);
    const set = clients.get(spaceId);
    if (!set) return;
    const people = new Map();
    for (const c of set) if (!people.has(c.viewer.id)) people.set(c.viewer.id, { id: c.viewer.id, name: c.viewer.name, color: c.viewer.id === 'owner' ? '#4f46e5' : colorFor(c.viewer.id), group: c.viewer.group || null, owner: c.viewer.id === 'owner' });
    const list = [...people.values()];
    for (const c of set) sse(c, 'presence', { people: list });
  }, 250));
}
const summaryTimers = new Map();
function ownerSummary(space, removed = false) {
  if (!ownerClients.size) return;
  clearTimeout(summaryTimers.get(space.id));
  summaryTimers.set(space.id, setTimeout(() => {
    summaryTimers.delete(space.id);
    for (const c of ownerClients) sse(c, removed ? 'removed' : 'summary', removed ? { id: space.id } : { summary: spaceSummary(space) });
  }, removed ? 0 : 600));
}
function refreshViewer(client, space) {
  if (client.viewer.isOwner) return true;
  const access = resolveAccess(space, client.viewer.key);
  if (!access) return false;
  if (access.asOwner) Object.assign(client.viewer, { role: 'admin', asOwner: true });
  else { client.viewer.role = access.role; if (access.group) client.viewer.group = access.group; }
  return true;
}
store.onEvent = (space, evt, origin) => {
  if (evt.type === 'space-removed') {
    for (const c of clients.get(space.id) || []) { sse(c, 'removed', {}); c.res.end(); }
    clients.delete(space.id);
    ownerSummary(space, true);
    return;
  }
  ownerSummary(space);
  if (evt.type === 'post' && !evt.quiet) {
    const post = space.posts.find(p => p.id === evt.id);
    if (post && post.author.id !== 'owner') for (const c of ownerClients) sse(c, 'activity', { spaceId: space.id, space: space.title, kind: post.status === 'pending' ? 'pending' : 'post', author: post.author.name, text: post.title || post.body.slice(0, 80) });
  }
  if (evt.type === 'post' && evt.comment) {
    const post = space.posts.find(p => p.id === evt.id);
    const comment = post?.comments.find(c => c.id === evt.comment);
    if (comment && comment.author.id !== 'owner') for (const c of ownerClients) sse(c, 'activity', { spaceId: space.id, space: space.title, kind: 'comment', author: comment.author.name, text: comment.body.slice(0, 80) });
  }
  const set = clients.get(space.id);
  if (!set) return;
  for (const c of [...set]) {
    if (!refreshViewer(c, space)) { sse(c, 'revoked', {}); c.res.end(); set.delete(c); continue; }
    const v = c.viewer;
    switch (evt.type) {
      case 'meta': case 'sharing':
        if (evt.type === 'sharing' && !can(v, 'share')) { sse(c, 'meta', { space: metaForViewer(space, v), me: meFor(v, space), origin }); break; }
        sse(c, 'meta', { space: metaForViewer(space, v), me: meFor(v, space), origin });
        break;
      case 'post': {
        const post = space.posts.find(p => p.id === evt.id);
        if (!post) break;
        if (postVisible(space, post, v)) sse(c, 'post', { post: postForViewer(space, post, v), origin, pending: can(v, 'moderate') ? space.posts.filter(p => p.status === 'pending').length : 0 });
        else sse(c, 'post-removed', { id: post.id, origin });
        break;
      }
      case 'post-removed': sse(c, 'post-removed', { id: evt.id, origin, pending: can(v, 'moderate') ? space.posts.filter(p => p.status === 'pending').length : 0 }); break;
      case 'card': {
        const card = space.cards.find(k => k.id === evt.id);
        if (!card) break;
        if (cardVisible(space, card, v)) sse(c, 'card', { card: cardForViewer(card, v), index: space.cards.indexOf(card), origin });
        else sse(c, 'card-removed', { id: card.id, origin });
        break;
      }
      case 'card-removed': sse(c, 'card-removed', { id: evt.id, origin }); break;
      case 'cards-order': sse(c, 'cards-order', { ids: space.cards.filter(k => cardVisible(space, k, v)).map(k => k.id), origin }); break;
      case 'objects': {
        const card = space.cards.find(k => k.id === evt.cardId);
        if (!card || !cardVisible(space, card, v)) break;
        const ids = new Set(evt.ids || []);
        sse(c, 'objects', { cardId: card.id, objects: card.objects.filter(o => ids.has(o.id)).map(o => objectForViewer(o, v)), removed: evt.removed || [], origin });
        break;
      }
    }
  }
};
setInterval(() => {
  for (const set of clients.values()) for (const c of set) try { c.res.write(': ping\n\n'); } catch {}
  for (const c of ownerClients) try { c.res.write(': ping\n\n'); } catch {}
}, 25_000).unref();
setInterval(() => {
  for (const [space, post] of store.dueScheduled()) store.onEvent?.(space, { type: 'post', id: post.id }, 'scheduler');
}, 15_000).unref();

// ---------- Réseau local ----------
let lanServer = null, lanPort = null;
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
    out.push({ name, address: a.address, primary: /^en[01]$/.test(name) });
  }
  return out.sort((a, b) => b.primary - a.primary || a.name.localeCompare(b.name));
}
function lanInfo() {
  return { enabled: !!lanServer, port: lanPort, addresses: lanAddresses(), hostname: os.hostname().replace(/\.local$/, '') + '.local' };
}
function listen(server, host, ports) {
  return new Promise((resolve, reject) => {
    const tryPort = i => {
      const port = ports[i];
      const onError = e => { server.off('listening', onListen); if ((e.code === 'EADDRINUSE' || e.code === 'EACCES') && i + 1 < ports.length) tryPort(i + 1); else reject(e); };
      const onListen = () => { server.off('error', onError); resolve(server.address().port); };
      server.once('error', onError);
      server.once('listening', onListen);
      server.listen(port, host);
    };
    tryPort(0);
  });
}
async function setLan(enabled) {
  if (enabled && !lanServer) {
    const server = http.createServer((req, res) => handle(req, res, true));
    server.headersTimeout = 30_000; server.requestTimeout = 0;
    try { lanPort = await listen(server, '0.0.0.0', [PREFERRED_LAN_PORT, PREFERRED_LAN_PORT + 10, PREFERRED_LAN_PORT + 20, 0]); lanServer = server; log(`Partage local actif sur le port ${lanPort}`); }
    catch (e) { log(`Partage local impossible : ${e.message}`); throw new HttpError(500, `Le partage sur le réseau local n’a pas démarré (${e.code || e.message}).`); }
  } else if (!enabled && lanServer) {
    const server = lanServer;
    lanServer = null; lanPort = null;
    for (const set of clients.values()) for (const c of [...set]) if (c.lan) { sse(c, 'revoked', {}); c.res.end(); set.delete(c); }
    server.close();
    server.closeAllConnections?.();
    log('Partage local arrêté');
  }
  return lanInfo();
}

// ---------- Fichiers statiques ----------
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
async function serveStatic(res, rel, { cache = false } = {}) {
  const file = path.resolve(UI, rel);
  if (!file.startsWith(UI + path.sep) && file !== UI) return send(res, 404, { error: 'Introuvable.' });
  if (path.basename(file) === 'demo-data.json' && !DEV) return send(res, 404, { error: 'Introuvable.' });
  const st = await fs.stat(file).catch(() => null);
  if (!st || !st.isFile()) return send(res, 404, { error: 'Introuvable.' });
  res.writeHead(200, { ...CORS, 'Content-Type': STATIC_TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache ? 'public, max-age=604800' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
  fss.createReadStream(file).pipe(res);
}
async function serveFile(req, res, file, { name, type, download = false }) {
  const st = await fs.stat(file).catch(() => null);
  if (!st || !st.isFile()) return send(res, 404, { error: 'Fichier introuvable.' });
  const mime = type || mimeOf(file);
  const headers = {
    ...CORS, 'Content-Type': /^(text\/html|application\/xhtml)/.test(mime) ? 'text/plain; charset=utf-8' : mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': disposition(name || path.basename(file), !download),
    ...(/svg|xml|html|javascript/.test(mime) ? { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" } : {}),
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && st.size > 0) {
    let start = range[1] === '' ? Math.max(0, st.size - Number(range[2])) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fss.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fss.createReadStream(file).pipe(res);
}
function within(file, roots) {
  const f = path.resolve(file);
  return roots.some(r => f === r || f.startsWith(r + path.sep));
}
const allowedFile = file => !!file && path.isAbsolute(file) && (within(file, ALLOWED_ROOTS) || within(file, noteRoots()) || sessionAllowed.has(path.resolve(file)));

/** Fichier dont on peut montrer l’aperçu : pièce jointe visible (publication, commentaire) ou objet fichier d’une carte. */
function thumbSource(space, id, viewer) {
  for (const post of space.posts) {
    if (!postVisible(space, post, viewer)) continue;
    for (const a of [...(post.attachments || []), ...(post.comments || []).map(c => c.attachment).filter(Boolean)]) {
      if (a.id !== id) continue;
      if (a.kind === 'local') return a.path && (within(a.path, ALLOWED_ROOTS) || within(a.path, noteRoots())) ? a.path : null;
      return a.file ? store.mediaPath(space.id, a.file) : null;
    }
  }
  for (const card of space.cards) {
    if (!cardVisible(space, card, viewer)) continue;
    const o = card.objects.find(x => x.id === id);
    if (o?.media) return store.mediaPath(space.id, o.media);
  }
  return null;
}

// ---------- Index du vault (liens [[…]] d’Obsidian) ----------
let vaultIndex = null, vaultIndexAt = 0;
async function buildVaultIndex() {
  if (!VAULT) return new Map();
  if (vaultIndex && Date.now() - vaultIndexAt < 60_000) return vaultIndex;
  const index = new Map();
  let count = 0;
  async function walk(dir, depth) {
    if (depth > 12 || count > 60_000) return;
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        count++;
        const key = e.name.toLowerCase();
        for (const k of new Set([key, key.replace(/\.md$/, '')])) { if (!index.has(k)) index.set(k, []); index.get(k).push(full); }
      }
    }
  }
  await walk(VAULT, 0);
  vaultIndex = index; vaultIndexAt = Date.now();
  return index;
}
async function resolveLink(name, from) {
  const clean = String(name || '').split('#')[0].split('|')[0].trim().replace(/^\/+/, '');
  if (!clean) return null;
  if (from) {
    const direct = path.resolve(path.dirname(from), clean);
    for (const candidate of [direct, `${direct}.md`]) if (allowedFile(candidate) && (await fs.stat(candidate).catch(() => null))?.isFile()) return candidate;
  }
  const index = await buildVaultIndex();
  const base = path.basename(clean).toLowerCase();
  const list = index.get(base) || index.get(base.replace(/\.md$/, '')) || [];
  const wanted = clean.toLowerCase().replace(/\.md$/, '');
  const matching = list.filter(p => p.toLowerCase().replace(/\.md$/, '').endsWith(wanted));
  const pool = matching.length ? matching : list;
  if (!pool.length) return null;
  const dir = from ? path.dirname(from) : VAULT;
  return pool.sort((a, b) => (b.startsWith(dir) - a.startsWith(dir)) || a.length - b.length)[0];
}
function lanDirectory() {
  const list = [...store.spaces.values()].filter(s => s.sharing.visibility === 'public' && !s.trashedAt && !s.archived);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Espaces publics — Cours Albert</title><style>
:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;margin:0;background:#f4f5fb;color:#111827}main{max-width:640px;margin:0 auto;padding:40px 18px}
h1{font-size:26px;margin:0 0 4px}p{color:#6b7280;margin:0 0 24px}a{display:flex;gap:14px;align-items:center;background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:10px;text-decoration:none;color:inherit;box-shadow:0 1px 3px #0001}
a span{font-size:28px}a b{display:block}a small{color:#6b7280}@media (prefers-color-scheme:dark){body{background:#18181b;color:#f4f4f5}a{background:#27272a}p,a small{color:#a1a1aa}}</style></head>
<body><main><h1>Espaces publics</h1><p>Partagés sur ce réseau avec Cours Albert.</p>${list.length ? list.map(s => `<a href="/s/${esc(s.id)}"><span>${esc(s.icon)}</span><div><b>${esc(s.title)}</b><small>${esc(s.description.slice(0, 120) || (s.kind === 'board' ? 'Tableau' : 'Espace libre'))}</small></div></a>`).join('') : '<p>Aucun espace public pour le moment.</p>'}</main></body></html>`;
}

// ---------- Routes ----------
async function handle(req, res, lan) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (!lan && !DEV) {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return send(res, 403, { error: 'Hôte refusé.' });
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (p === '/') { if (lan) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(lanDirectory()); } res.writeHead(302, { Location: '/app/index.html' }); return res.end(); }
      if (p === '/favicon.ico') return serveStatic(res, 'icon.png', { cache: true });
      if (p.startsWith('/app/')) { const rel = decodeURIComponent(p.slice(5)); if (lan && rel === 'index.html') return send(res, 404, { error: 'Introuvable.' }); return serveStatic(res, rel, { cache: rel.startsWith('vendor/') }); }
      const share = p.match(/^\/s\/([a-z0-9_-]{1,40})\/?$/i);
      if (share) return serveStatic(res, 'guest.html');
      const media = p.match(/^\/media\/([a-z0-9_-]{1,40})\/([^/]+)$/i);
      if (media) {
        const space = store.get(media[1]);
        const viewer = viewerFor(req, url, space, lan, { requireId: false });
        if (!viewer) return send(res, 403, { error: 'Accès refusé.' });
        const file = store.mediaPath(space.id, decodeURIComponent(media[2]));
        return serveFile(req, res, file, { name: url.searchParams.get('name') || undefined, download: url.searchParams.has('download') });
      }
      if (p === '/raw') {
        if (!isOwnerRequest(req, url, lan)) return send(res, 403, { error: 'Accès refusé.' });
        const file = url.searchParams.get('path') || '';
        if (!allowedFile(file)) return send(res, 403, { error: 'Ce fichier est en dehors des dossiers de Cours Albert.' });
        return serveFile(req, res, path.resolve(file), { download: url.searchParams.has('download') });
      }
      // Aperçu miniature d’un fichier joint (publication, commentaire ou objet d’espace libre)
      const th = p.match(/^\/thumb\/([a-z0-9_-]{1,40})\/([a-z0-9_-]{1,40})$/i);
      if (th) {
        const space = store.get(th[1]);
        const viewer = viewerFor(req, url, space, lan, { requireId: false });
        if (!viewer) return send(res, 403, { error: 'Accès refusé.' });
        const file = thumbSource(space, th[2], viewer);
        const png = file && await thumbs.get(file, Number(url.searchParams.get('s')) || 480);
        if (!png) return send(res, 404, { error: 'Pas d’aperçu.' });
        return serveFile(req, res, png, { type: png.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
      }
      if (p === '/thumb') {
        if (!isOwnerRequest(req, url, lan)) return send(res, 403, { error: 'Accès refusé.' });
        const file = url.searchParams.get('path') || '';
        if (!allowedFile(file)) return send(res, 403, { error: 'Ce fichier est en dehors des dossiers de Cours Albert.' });
        const png = await thumbs.get(path.resolve(file), Number(url.searchParams.get('s')) || 480);
        if (!png) return send(res, 404, { error: 'Pas d’aperçu.' });
        return serveFile(req, res, png, { type: png.endsWith('.svg') ? 'image/svg+xml' : 'image/png' });
      }
      const local = p.match(/^\/local\/([a-z0-9_-]{1,40})\/([a-z0-9_-]{1,40})$/i);
      if (local) {
        const space = store.get(local[1]);
        const viewer = viewerFor(req, url, space, lan, { requireId: false });
        if (!viewer) return send(res, 403, { error: 'Accès refusé.' });
        const { post, att } = store.localAttachment(space.id, local[2]);
        if (!postVisible(space, post, viewer)) return send(res, 403, { error: 'Accès refusé.' });
        if (!within(att.path, ALLOWED_ROOTS) && !within(att.path, noteRoots())) return send(res, 403, { error: 'Ce fichier est en dehors de la bibliothèque de cours.' });
        return serveFile(req, res, att.path, { name: path.basename(att.path), download: url.searchParams.has('download') });
      }
    }
    if (!p.startsWith('/api/')) return send(res, 404, { error: 'Introuvable.' });
    return await api(req, res, url, lan);
  } catch (e) {
    const status = e instanceof HttpError || (e?.status >= 400 && e?.status < 600) ? e.status : 500;
    if (status >= 500) log(`${req.method} ${p} : ${e?.stack || e}`);
    if (!res.headersSent) send(res, status, { error: status >= 500 && !(e instanceof HttpError) ? 'Erreur interne du serveur des espaces.' : e.message });
    else try { res.end(); } catch {}
  }
}

async function api(req, res, url, lan) {
  const p = url.pathname.slice(4); // sans /api
  const m = req.method;
  const owner = isOwnerRequest(req, url, lan);
  const origin = String(req.headers['x-origin'] || (owner ? 'owner-app' : '')).slice(0, 40);
  const requireOwner = () => { if (!owner) throw new HttpError(403, 'Réservé au propriétaire.'); };

  // --- Propriétaire : état général, préférences, création ---
  if (p === '/ping') return send(res, 200, { ok: true, version: VERSION, lan: !!lan });
  if (p === '/state' && m === 'GET') { requireOwner(); return send(res, 200, { version: VERSION, prefs: store.prefs, ownerName: store.ownerName(), spaces: store.list(), lan: lanInfo(), ai: ai.status(), wispr: wispr.status(), notes: noteFolders(), thumbs: thumbs.available(), vault: VAULT }); }
  if (p === '/events' && m === 'GET') {
    requireOwner();
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const client = { res, viewer: ownerViewer() };
    ownerClients.add(client);
    req.on('close', () => ownerClients.delete(client));
    return;
  }
  if (p === '/prefs' && m === 'POST') {
    requireOwner();
    const body = await readJSON(req);
    await store.setPrefs(body);
    if ('lan' in body) await setLan(!!body.lan);
    return send(res, 200, { prefs: store.prefs, lan: lanInfo() });
  }
  if (p === '/lan' && m === 'GET') { requireOwner(); return send(res, 200, lanInfo()); }
  if (p === '/files/allow' && m === 'POST') {
    requireOwner();
    const body = await readJSON(req);
    if (typeof body.path === 'string' && path.isAbsolute(body.path)) sessionAllowed.add(path.resolve(body.path));
    return send(res, 200, { ok: true });
  }
  if (p === '/file' && m === 'GET') {
    requireOwner();
    const file = path.resolve(url.searchParams.get('path') || '/');
    if (!allowedFile(file)) throw new HttpError(403, 'Ce fichier est en dehors des dossiers de Cours Albert.');
    const st = await fs.stat(file).catch(() => null);
    if (!st || !st.isFile()) throw new HttpError(404, 'Fichier introuvable.');
    if (st.size > 8 * 1024 * 1024) throw new HttpError(413, 'Fichier trop volumineux pour être affiché (plus de 8 Mo).');
    const buf = await fs.readFile(file);
    if (buf.subarray(0, 8192).includes(0)) throw new HttpError(415, 'Ce fichier n’est pas un fichier texte.');
    let text = buf.toString('utf8');
    if (text.includes('�')) text = buf.toString('latin1');
    return send(res, 200, { path: file, name: path.basename(file), text, size: st.size, mtime: st.mtimeMs, editable: TEXT_EXT.has(path.extname(file).slice(1).toLowerCase()), vault: VAULT && within(file, [VAULT]) ? VAULT : null });
  }
  if (p === '/file' && m === 'PUT') {
    requireOwner();
    const body = await readJSON(req, 16 * 1024 * 1024);
    const file = path.resolve(String(body.path || '/'));
    if (!allowedFile(file)) throw new HttpError(403, 'Ce fichier est en dehors des dossiers de Cours Albert.');
    if (!TEXT_EXT.has(path.extname(file).slice(1).toLowerCase())) throw new HttpError(415, 'Seuls les fichiers texte peuvent être modifiés ici.');
    if (typeof body.text !== 'string') throw new HttpError(400, 'Texte manquant.');
    const st = await fs.stat(file).catch(() => null);
    if (st && !body.force && typeof body.mtime === 'number' && Math.abs(st.mtimeMs - body.mtime) > 1) throw new HttpError(409, 'Le fichier a été modifié ailleurs (Obsidian ?) depuis son ouverture.');
    const temp = `${file}.tmp-${process.pid}-${rid(6)}`;
    try { await fs.writeFile(temp, body.text, 'utf8'); await fs.rename(temp, file); }
    finally { await fs.unlink(temp).catch(() => {}); }
    vaultIndex = null;
    const after = await fs.stat(file);
    return send(res, 200, { mtime: after.mtimeMs, size: after.size });
  }
  if (p === '/vault/resolve' && m === 'GET') {
    requireOwner();
    const found = await resolveLink(url.searchParams.get('name'), url.searchParams.get('from'));
    if (!found) throw new HttpError(404, 'Note introuvable dans le vault.');
    return send(res, 200, { path: found });
  }
  if (p === '/ai' && m === 'GET') { requireOwner(); return send(res, 200, ai.status()); }
  if (p === '/ai/config' && m === 'POST') { requireOwner(); return send(res, 200, await ai.setConfig(await readJSON(req))); }
  if (p === '/ai/models' && m === 'GET') { requireOwner(); const models = await ai.listModels(); return send(res, 200, { models, status: ai.status() }); }
  if (p === '/ai/classify' && m === 'POST') {
    requireOwner();
    const body = await readJSON(req);
    return send(res, 200, { result: await ai.run('classify', { files: body.files, courses: body.courses, categories: body.categories }) });
  }
  // --- Dossiers de notes ---
  if (p === '/notes' && m === 'GET') { requireOwner(); return send(res, 200, { folders: noteFolders(), vault: VAULT }); }
  if (p === '/notes/folders' && m === 'POST') {
    requireOwner();
    const body = await readJSON(req);
    let dir = typeof body.path === 'string' && path.isAbsolute(body.path) ? body.path : null;
    if (!dir) {
      const name = line(body.name, 80).replace(/[\/:*?"<>|]/g, ' ').trim();
      if (!name) throw new HttpError(400, 'Donnez un nom au dossier.');
      dir = path.join(VAULT || path.join(SUPPORT, 'Notes'), name);
      if (await fs.stat(dir).catch(() => null)) throw new HttpError(409, `Un dossier « ${name} » existe déjà : choisissez-le avec « Dossier existant… » ou donnez un autre nom.`);
    }
    const folder = await addNoteFolder(dir, body.name);
    return send(res, 201, { folder, folders: noteFolders() });
  }
  if (p === '/notes/folders/remove' && m === 'POST') {
    requireOwner();
    const body = await readJSON(req);
    await saveNoteFolders(noteFolders().filter(f => f.id !== body.id));
    return send(res, 200, { folders: noteFolders() });
  }
  if (p === '/notes/list' && m === 'GET') {
    requireOwner();
    const folder = noteFolder(url.searchParams.get('folder'));
    const sub = String(url.searchParams.get('sub') || '').split('/').filter(x => x && x !== '..' && !x.startsWith('.')).join('/');
    const dir = path.join(folder.path, sub);
    if (!within(dir, [folder.path])) throw new HttpError(400, 'Chemin invalide.');
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => { throw new HttpError(404, 'Dossier introuvable (déplacé ou renommé ?).'); });
    const dirs = [], files = [];
    for (const e of entries.slice(0, 2000)) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { dirs.push({ name: e.name, count: (await fs.readdir(full).catch(() => [])).filter(n => !n.startsWith('.')).length }); continue; }
      if (!e.isFile()) continue;
      const st = await fs.stat(full).catch(() => null);
      if (!st) continue;
      const item = { name: e.name, path: full, size: st.size, mtime: st.mtimeMs, note: /\.(md|markdown|txt)$/i.test(e.name) };
      if (item.note && st.size < 2 * 1024 ** 2) {
        const head = (await fs.readFile(full, 'utf8').catch(() => '')).slice(0, 6000).replace(/^---\n[\s\S]*?\n---\n?/, '');
        item.title = head.match(/^#\s+(.+)$/m)?.[1]?.trim() || e.name.replace(/\.(md|markdown|txt)$/i, '');
        item.excerpt = head.split('\n').map(l => l.trim()).filter(l => l && !/^(#|>|<!--|---|```|\|)/.test(l)).join(' ').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m0, a, b) => b || a).replace(/[*_`]/g, '').slice(0, 220);
      }
      files.push(item);
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    files.sort((a, b) => (b.note - a.note) || b.mtime - a.mtime);
    return send(res, 200, { folder, sub, dirs, files: files.slice(0, 800) });
  }
  if ((p === '/notes/new' || p === '/notes/mkdir') && m === 'POST') {
    requireOwner();
    const body = await readJSON(req);
    const folder = noteFolder(body.folder);
    const sub = String(body.sub || '').split('/').filter(x => x && x !== '..' && !x.startsWith('.')).join('/');
    const base = line(body.title || body.name, 120).replace(/[\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim() || (p === '/notes/new' ? `Note du ${new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }).replace(/\//g, '-')}` : 'Nouveau dossier');
    const dir = path.join(folder.path, sub);
    if (!within(dir, [folder.path])) throw new HttpError(400, 'Chemin invalide.');
    await fs.mkdir(dir, { recursive: true });
    if (p === '/notes/mkdir') {
      let target = path.join(dir, base);
      for (let i = 2; await fs.stat(target).catch(() => null); i++) target = path.join(dir, `${base} ${i}`);
      await fs.mkdir(target);
      return send(res, 201, { name: path.basename(target) });
    }
    let file = path.join(dir, `${base}.md`);
    for (let i = 2; await fs.stat(file).catch(() => null); i++) file = path.join(dir, `${base} ${i}.md`);
    const title = path.basename(file, '.md');
    await fs.writeFile(file, typeof body.text === 'string' ? body.text : `# ${title}\n\n`, { flag: 'wx' });
    vaultIndex = null;
    return send(res, 201, { path: file, name: path.basename(file) });
  }
  // --- Wispr Flow ---
  if (p === '/wispr' && m === 'GET') { requireOwner(); return send(res, 200, wispr.status()); }
  if (p === '/wispr/connect' && m === 'POST') { requireOwner(); if (lan) throw new HttpError(403, 'Réservé à ce Mac.'); return send(res, 200, await wispr.startAuth(`http://127.0.0.1:${port}/api/wispr/callback`)); }
  if (p === '/wispr/disconnect' && m === 'POST') { requireOwner(); return send(res, 200, await wispr.disconnect()); }
  if (p === '/wispr/auto' && m === 'POST') { requireOwner(); const body = await readJSON(req); return send(res, 200, await wispr.setAuto(!!body.on)); }
  if (p === '/wispr/import' && m === 'POST') { requireOwner(); const body = await readJSON(req); const r = await wispr.importNew({ force: !!body.force }); return send(res, 200, { ...r, status: wispr.status() }); }
  if (p === '/wispr/callback' && m === 'GET') {
    if (lan) throw new HttpError(403, 'Réservé à ce Mac.');
    let ok = true, message = 'Wispr Flow est connecté à Cours Albert. Vous pouvez fermer cet onglet et revenir dans l’app.';
    try { await wispr.finishAuth({ code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') }); }
    catch (e) { ok = false; message = e.message; }
    for (const c of ownerClients) sse(c, 'wispr', { status: wispr.status() });
    if (ok) setTimeout(() => wispr.importNew().catch(e => { wispr.lastError = e.message; log(`Wispr : ${e.message}`); }), 1500);
    const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
    return res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wispr Flow — Cours Albert</title><style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0}main{max-width:440px;padding:24px;text-align:center}h1{font-size:22px}</style></head><body><main><h1>${ok ? '✅ Connexion réussie' : '⚠️ Connexion impossible'}</h1><p>${esc(message)}</p></main></body></html>`);
  }
  // --- Assistant IA (propriétaire seulement) ---
  if (p === '/assistant' && m === 'GET') { requireOwner(); return send(res, 200, await assistant.status()); }
  if (p === '/assistant/conversation' && m === 'GET') { requireOwner(); return send(res, 200, await assistant.conversationView(url.searchParams.get('id'))); }
  if (p === '/assistant/rules' && m === 'POST') { requireOwner(); return send(res, 200, { rules: await assistant.saveRules(await readJSON(req)) }); }
  if (p === '/assistant/stop' && m === 'POST') { requireOwner(); assistant.stop(); return send(res, 200, { ok: true }); }
  if (p === '/assistant/undo' && m === 'POST') { requireOwner(); const body = await readJSON(req); return send(res, 200, await assistant.undo(String(body.run || ''))); }
  if (p === '/assistant/chat' && m === 'POST') {
    requireOwner();
    const body = await readJSON(req, 1024 * 1024);
    assistant.ensureReady();
    // Réponse en flux (une ligne JSON par événement) ; fermer la fenêtre arrête la demande.
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no' });
    res.on('close', () => { if (!res.writableFinished) assistant.stop(); });
    try {
      for await (const evt of assistant.chat({ conversation: body.conversation, message: body.message, context: body.context })) res.write(`${JSON.stringify(evt)}\n`);
    } catch (e) { res.write(`${JSON.stringify({ type: 'error', message: e.message })}\n`); }
    return res.end();
  }
  if (p === '/spaces' && m === 'POST') {
    requireOwner();
    const space = await store.create(await readJSON(req, 16 * 1024 * 1024));
    ownerSummary(space);
    return send(res, 201, { space: spaceForViewer(space, ownerViewer()), summary: spaceSummary(space) });
  }
  if (p === '/import' && m === 'POST') {
    requireOwner();
    const localFile = url.searchParams.get('path');
    const own = !localFile;
    const temp = own ? path.join(SUPPORT, `import-${rid(8)}.zip`) : path.resolve(localFile);
    if (!own && !allowedFile(temp)) throw new HttpError(403, 'Ce fichier est en dehors des dossiers autorisés.');
    try {
      if (own) {
        const out = fss.createWriteStream(temp);
        try {
          let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 ** 3) throw new HttpError(413, 'Archive trop volumineuse.'); if (!out.write(chunk)) await new Promise(r => out.once('drain', r)); }
          await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
        } catch (e) { out.destroy(); throw e; }
      } else req.resume();
      const entries = await readZip(temp).catch(() => { throw new HttpError(400, 'Ce fichier n’est pas une sauvegarde d’espace Cours Albert.'); });
      const json = entries.find(e => e.name === 'espace.json');
      if (!json) throw new HttpError(400, 'Ce fichier n’est pas une sauvegarde d’espace Cours Albert.');
      const raw = JSON.parse((await zipEntryBuffer(temp, json)).toString('utf8'));
      const id = rid(10);
      const space = normalizeSpace({ ...raw, id, folder: null, favorite: false, archived: false, trashedAt: null, sharing: {}, drafts: {}, openedAt: new Date().toISOString() });
      space.owner = { name: store.ownerName() };
      await fs.mkdir(store.mediaDir(id), { recursive: true });
      for (const e of entries) {
        const name = e.name.startsWith('media/') ? e.name.slice(6) : null;
        if (!name || name.includes('/') || !/^[a-z0-9][a-z0-9._-]{0,180}$/i.test(name)) continue;
        await extractZipEntry(temp, e, path.join(store.mediaDir(id), name));
      }
      store.spaces.set(id, space);
      for (const post of space.posts) store.announced.add(post.id);
      await store.save(id);
      ownerSummary(space);
      return send(res, 201, { summary: spaceSummary(space) });
    } finally { if (own) await fs.unlink(temp).catch(() => {}); }
  }

  // --- Espace ---
  const sm = p.match(/^\/spaces\/([a-z0-9_-]{1,40})(\/.*)?$/i);
  if (!sm) return send(res, 404, { error: 'Introuvable.' });
  const space = store.get(sm[1]);
  const rest = sm[2] || '';
  const viewer = viewerFor(req, url, space, lan);
  if (!viewer) throw new HttpError(lan && space.sharing.visibility === 'private' ? 404 : 403, space.sharing.visibility === 'private' ? 'Cet espace n’est pas partagé.' : 'Ce lien de partage n’est plus valide.');
  const guestKey = `${viewer.id}|${req.socket.remoteAddress}`;
  const guest = !viewer.isOwner;

  if (rest === '' && m === 'GET') {
    if (viewer.isOwner) store.opened(space.id);
    return send(res, 200, {
      space: spaceForViewer(space, viewer), me: meFor(viewer, space), draft: can(viewer, 'post') ? store.getDraft(space.id, viewer) : null,
      people: can(viewer, 'edit') ? Object.entries(space.people).map(([id, x]) => ({ id, name: x.name, group: x.group })).slice(0, 500) : [],
      lan: viewer.isOwner ? lanInfo() : undefined,
    });
  }
  if (rest === '' && m === 'PATCH') { const s = store.updateMeta(space.id, await readJSON(req), viewer, origin); return send(res, 200, { space: metaForViewer(s, viewer) }); }
  if (rest === '' && m === 'DELETE') { requireOwner(); await store.destroy(space.id); return send(res, 200, { ok: true }); }
  if (rest === '/duplicate' && m === 'POST') { requireOwner(); const body = await readJSON(req); const copy = await store.duplicate(space.id, body); ownerSummary(copy); return send(res, 201, { summary: spaceSummary(copy) }); }
  if (rest === '/join' && m === 'POST') {
    const body = await readJSON(req);
    store.join(space, viewer, body);
    if (guest && body.name) viewer.name = line(body.name, 80) || viewer.name;
    if (guest && space.groups.some(g => g.id === body.group) && !space.sharing.links.find(l => l.id === viewer.linkId)?.group) viewer.group = body.group;
    return send(res, 200, { me: meFor(viewer, space) });
  }
  if (rest === '/events' && m === 'GET') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const client = { res, viewer, lan };
    if (!clients.has(space.id)) clients.set(space.id, new Set());
    clients.get(space.id).add(client);
    sse(client, 'hello', { rev: space.rev, me: meFor(viewer, space) });
    presence(space.id);
    req.on('close', () => { clients.get(space.id)?.delete(client); presence(space.id); });
    return;
  }
  if (rest === '/sharing' && m === 'POST') {
    const body = await readJSON(req);
    store.updateSharing(space.id, body, viewer, origin);
    if (body.visibility && body.visibility !== 'private') store.ensureDefaultLink(space);
    if (body.visibility && body.visibility !== 'private' && !lanServer && body.startLan !== false) { await setLan(true); await store.setPrefs({ lan: true }); }
    return send(res, 200, { sharing: space.sharing, lan: lanInfo() });
  }
  if (rest === '/draft' && m === 'GET') return send(res, 200, { draft: store.getDraft(space.id, viewer) });
  if (rest === '/draft' && m === 'PUT') { if (guest) limit(`draft|${guestKey}`, 120); const body = await readJSON(req); return send(res, 200, { draft: store.saveDraft(space.id, body.draft || null, viewer) }); }
  if (rest === '/media' && m === 'POST') {
    if (!can(viewer, 'post') && !can(viewer, 'comment') && !can(viewer, 'edit')) throw new HttpError(403, 'Vous ne pouvez pas envoyer de fichier ici.');
    if (guest) limit(`upload|${guestKey}`, 40);
    const name = (url.searchParams.get('name') || 'fichier').slice(0, 200);
    const att = await store.saveMedia(space.id, req, { name, mime: req.headers['content-type'], limit: guest ? 300 * 1024 ** 2 : 2 * 1024 ** 3 });
    return send(res, 201, { attachment: att });
  }
  if (rest === '/preview' && m === 'POST') {
    if (!can(viewer, 'post') && !can(viewer, 'edit')) throw new HttpError(403, 'Vous ne pouvez pas publier ici.');
    if (guest) limit(`preview|${guestKey}`, 20);
    const body = await readJSON(req);
    const target = String(body.url || '').trim();
    let u;
    try { u = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`); } catch { throw new HttpError(400, 'Adresse web invalide.'); }
    try {
      const preview = await linkPreview(u.href, { saveImage: (buf, name, type) => store.saveBuffer(space.id, buf, { name, mime: type, limit: 8 * 1024 ** 2 }).then(a => a.file) });
      return send(res, 200, { preview });
    } catch (e) {
      return send(res, 200, { preview: { url: u.href, title: u.hostname.replace(/^www\./, ''), description: '', site: u.hostname.replace(/^www\./, ''), image: null, embed: embedFor(u.href), error: e.message } });
    }
  }
  if (rest === '/ai' && m === 'POST') {
    if (!(viewer.isOwner || (space.settings.guestAI && can(viewer, 'edit')))) throw new HttpError(403, 'Le tri par IA est réservé au propriétaire.');
    const body = await readJSON(req);
    if (body.task !== 'organize') throw new HttpError(400, 'Tâche inconnue.');
    const posts = space.posts.filter(x => postVisible(space, x, viewer)).map(x => ({ id: x.id, title: x.title, body: x.body.slice(0, 400) }));
    const result = await ai.run('organize', { posts, sections: space.sections.map(s => s.title) });
    return send(res, 200, { result });
  }
  if (/^\/export\.(csv|xlsx|zip|cae)$/.test(rest) && m === 'GET') {
    if (!can(viewer, 'edit') && !can(viewer, 'moderate')) throw new HttpError(403, 'Export réservé aux animateurs de l’espace.');
    const ext = rest.split('.').pop();
    const base = `${safeFileName(space.title)} — ${fileStamp()}`;
    const mediaUrl = f => `media/${f}`;
    if (ext === 'csv') {
      const csv = toCSV(spaceSheets(space, { mediaUrl })[0]);
      return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition(`${base}.csv`) });
    }
    const types = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', cae: 'application/zip' };
    const name = ext === 'zip' ? `${base} — fichiers.zip` : ext === 'cae' ? `${safeFileName(space.title)}.coursalbert` : `${base}.xlsx`;
    res.writeHead(200, { ...CORS, 'Content-Type': types[ext], 'Content-Disposition': disposition(name), 'Cache-Control': 'no-store' });
    if (ext === 'xlsx') await writeXLSX(res, spaceSheets(space, { mediaUrl }), space.title);
    else if (ext === 'zip') await writeFilesZip(res, space, store.mediaDir(space.id));
    else await writeBackup(res, space, store.mediaDir(space.id));
    return res.end();
  }

  // --- Publications ---
  if (rest === '/posts' && m === 'POST') {
    if (guest) limit(`post|${guestKey}`, 30);
    const body = await readJSON(req);
    if (!viewer.isOwner && !viewer.asOwner && Array.isArray(body.attachments)) body.attachments = body.attachments.filter(a => a?.kind !== 'local');
    const post = store.createPost(space.id, body, viewer, origin);
    return send(res, 201, { post: postForViewer(space, post, viewer) });
  }
  if (rest === '/posts/move' && m === 'POST') { const body = await readJSON(req); const moved = store.movePosts(space.id, body.moves, viewer, origin); return send(res, 200, { posts: moved.map(x => postForViewer(space, x, viewer)) }); }
  if (rest === '/connections' && m === 'POST') { const body = await readJSON(req); return send(res, 200, { connections: store.setConnections(space.id, body.connections, viewer, origin) }); }
  const pm = rest.match(/^\/posts\/([a-z0-9_-]{1,40})(\/.*)?$/i);
  if (pm) {
    const pid = pm[1], sub = pm[2] || '';
    if (sub === '' && m === 'PATCH') {
      if (guest) limit(`edit|${guestKey}`, 120);
      const body = await readJSON(req);
      if (!viewer.isOwner && !viewer.asOwner && Array.isArray(body.attachments)) {
        const existing = new Set((store.post(space, pid).attachments || []).filter(a => a.kind === 'local').map(a => a.id));
        body.attachments = body.attachments.filter(a => a?.kind !== 'local' || existing.has(a.id));
      }
      const post = store.updatePost(space.id, pid, body, viewer, origin);
      return send(res, 200, { post: postForViewer(space, post, viewer) });
    }
    if (sub === '' && m === 'DELETE') { store.deletePost(space.id, pid, viewer, origin); return send(res, 200, { ok: true }); }
    if (sub === '/duplicate' && m === 'POST') { const post = store.duplicatePost(space.id, pid, viewer, origin); return send(res, 201, { post: postForViewer(space, post, viewer) }); }
    if (sub === '/moderate' && m === 'POST') { const body = await readJSON(req); const post = store.moderate(space.id, pid, body.decision, viewer, origin); return send(res, 200, { post: postForViewer(space, post, viewer) }); }
    if (sub === '/react' && m === 'POST') { if (guest) limit(`react|${guestKey}`, 200); const post = store.react(space.id, pid, await readJSON(req), viewer, origin); return send(res, 200, { post: postForViewer(space, post, viewer) }); }
    if (sub === '/vote' && m === 'POST') { if (guest) limit(`react|${guestKey}`, 200); const body = await readJSON(req); const post = store.votePoll(space.id, pid, body.options, viewer, origin); return send(res, 200, { post: postForViewer(space, post, viewer) }); }
    if (sub === '/comments' && m === 'POST') { if (guest) limit(`comment|${guestKey}`, 30); const post = store.addComment(space.id, pid, await readJSON(req), viewer, origin); return send(res, 201, { post: postForViewer(space, post, viewer) }); }
    const cm = sub.match(/^\/comments\/([a-z0-9_-]{1,40})$/i);
    if (cm && m === 'DELETE') { const post = store.deleteComment(space.id, pid, cm[1], viewer, origin); return send(res, 200, { post: postForViewer(space, post, viewer) }); }
  }

  // --- Espace libre ---
  if (rest === '/cards' && m === 'POST') { const card = store.addCard(space.id, await readJSON(req, 16 * 1024 * 1024), viewer, origin); return send(res, 201, { card: cardForViewer(card, viewer), index: space.cards.indexOf(card) }); }
  if (rest === '/cards/order' && m === 'POST') { const body = await readJSON(req); store.reorderCards(space.id, body.ids, viewer, origin); return send(res, 200, { ids: space.cards.map(c => c.id) }); }
  const km = rest.match(/^\/cards\/([a-z0-9_-]{1,40})(\/.*)?$/i);
  if (km) {
    const cid = km[1], sub = km[2] || '';
    if (sub === '' && m === 'PATCH') { const card = store.updateCard(space.id, cid, await readJSON(req), viewer, origin); return send(res, 200, { card: cardForViewer(card, viewer) }); }
    if (sub === '' && m === 'DELETE') { store.deleteCard(space.id, cid, viewer, origin); return send(res, 200, { ok: true }); }
    if (sub === '/duplicate' && m === 'POST') { const card = store.duplicateCard(space.id, cid, viewer, origin); return send(res, 201, { card: cardForViewer(card, viewer), index: space.cards.indexOf(card) }); }
    if (sub === '/objects' && m === 'POST') {
      if (guest) limit(`draw|${guestKey}`, 1200);
      const body = await readJSON(req, 8 * 1024 * 1024);
      const saved = store.upsertObjects(space.id, cid, body.objects, viewer, origin);
      return send(res, 200, { objects: saved.map(o => objectForViewer(o, viewer)) });
    }
    if (sub === '/objects/delete' && m === 'POST') { const body = await readJSON(req); return send(res, 200, { removed: store.removeObjects(space.id, cid, body.ids, viewer, origin) }); }
    const om = sub.match(/^\/objects\/([a-z0-9_-]{1,40})\/vote$/i);
    if (om && m === 'POST') { if (guest) limit(`react|${guestKey}`, 200); const body = await readJSON(req); const obj = store.voteObjectPoll(space.id, cid, om[1], body.options, viewer, origin); return send(res, 200, { object: objectForViewer(obj, viewer) }); }
  }
  return send(res, 404, { error: 'Introuvable.' });
}

// ---------- Démarrage ----------
const server = http.createServer((req, res) => handle(req, res, false));
server.headersTimeout = 30_000;
server.requestTimeout = 0;
const port = await listen(server, '127.0.0.1', [PREFERRED_PORT, PREFERRED_PORT + 2, PREFERRED_PORT + 4, PREFERRED_PORT + 6, 0]).catch(e => { log(`Démarrage impossible : ${e.message}`); process.exit(3); });
if (store.prefs.lan && store.list().some(s => s.shared)) await setLan(true).catch(() => {});
log(`Serveur des espaces prêt sur 127.0.0.1:${port} (${store.spaces.size} espace(s))`);
// Import automatique des notes Wispr Flow (toutes les 30 minutes, si connecté et activé)
const wisprTick = () => { if (wispr.connected() && wispr.status().autoImport) wispr.importNew().catch(e => { wispr.lastError = e.message; log(`Wispr : ${e.message}`); }); };
setTimeout(wisprTick, 90_000).unref();
setInterval(wisprTick, 30 * 60_000).unref();
process.stdout.write(JSON.stringify({ ready: true, port, lanPort, version: VERSION }) + '\n');

let stopping = false;
async function stop(reason) {
  if (stopping) return;
  stopping = true;
  log(`Arrêt du serveur des espaces (${reason})`);
  for (const set of clients.values()) for (const c of set) try { c.res.end(); } catch {}
  for (const c of ownerClients) try { c.res.end(); } catch {}
  server.close(); lanServer?.close();
  await store.flush().catch(e => log(`Enregistrement final : ${e.message}`));
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
if (!DEV && !process.stdin.isTTY) { process.stdin.on('end', () => stop('application fermée')); process.stdin.on('error', () => stop('application fermée')); process.stdin.resume(); }

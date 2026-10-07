// Espaces Cours Albert : stockage sur disque (un dossier par espace) et opérations.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  rid, newKey, newSpace, newCard, normalizeSpace, normalizeTheme, normalizeSettings, normalizeField, normalizeSharing, cleanPostInput, cleanObject,
  missingRequired, moderationFlag, can, safeId, line, str, num, bool, oneOf, color, iso, mediaFile, spaceSummary, ROLES, VISIBILITY, LIMITS, EMOJI_REACTIONS, KINDS,
} from './model.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogv: 'video/ogg',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', weba: 'audio/webm', opus: 'audio/opus', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8', json: 'application/json',
  zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', key: 'application/vnd.apple.keynote', pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers',
  py: 'text/x-python; charset=utf-8', ipynb: 'application/x-ipynb+json', html: 'text/plain; charset=utf-8', htm: 'text/plain; charset=utf-8', rtf: 'application/rtf',
};
export const mimeOf = name => MIME[path.extname(String(name)).slice(1).toLowerCase()] || 'application/octet-stream';
export function kindOf(mime, name) {
  const m = String(mime || mimeOf(name)).toLowerCase();
  if (m === 'image/svg+xml') return 'svg';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'file';
}
export function asciiName(name, fallback = 'fichier') {
  const ext = path.extname(String(name || '')).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 10);
  const stem = path.basename(String(name || ''), path.extname(String(name || ''))).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${stem || fallback}${ext}`;
}
/** Dimensions d’une image (PNG, JPEG, GIF, WebP) à partir de ses premiers octets. */
export function imageSize(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return null;
}

async function writeAtomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  try { await fs.writeFile(temp, data); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
const clone = v => JSON.parse(JSON.stringify(v));

export class Store {
  constructor({ root, log = () => {} }) {
    this.root = root;
    this.log = log;
    this.spaces = new Map();
    this.timers = new Map();
    this.saving = new Map();
    this.announced = new Set();
    this.onEvent = null;
    this.prefs = { ownerName: '', folders: [], joined: [], lan: false, recentTemplates: [] };
  }
  dir(id) { return path.join(this.root, id); }
  mediaDir(id) { return path.join(this.dir(id), 'media'); }
  get prefsFile() { return path.join(this.root, 'preferences.json'); }

  async load() {
    await fs.mkdir(this.root, { recursive: true });
    try { this.prefs = { ...this.prefs, ...JSON.parse(await fs.readFile(this.prefsFile, 'utf8')) }; } catch {}
    this.prefs.folders = (Array.isArray(this.prefs.folders) ? this.prefs.folders : []).map(f => ({ id: safeId(f?.id) || `d_${rid(6)}`, name: line(f?.name, 80) || 'Dossier', color: color(f?.color) || '#64748b' }));
    this.prefs.joined = (Array.isArray(this.prefs.joined) ? this.prefs.joined : []).slice(0, 100);
    for (const entry of await fs.readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      const file = path.join(this.root, entry.name, 'space.json');
      let raw = null;
      for (const candidate of [file, `${file}.bak`]) {
        try { raw = JSON.parse(await fs.readFile(candidate, 'utf8')); break; }
        catch (e) { if (e.code !== 'ENOENT') this.log(`Espace ${entry.name} illisible (${path.basename(candidate)}) : ${e.message}`); }
      }
      if (!raw) continue;
      try {
        const space = normalizeSpace({ ...raw, id: entry.name });
        this.spaces.set(space.id, space);
        for (const p of space.posts) if (!p.publishAt || Date.parse(p.publishAt) <= Date.now()) this.announced.add(p.id);
      } catch (e) { this.log(`Espace ${entry.name} ignoré : ${e.message}`); }
    }
    return this;
  }
  async savePrefs() { await writeAtomic(this.prefsFile, JSON.stringify(this.prefs, null, 2)); }
  setPrefs(patch = {}) {
    if ('ownerName' in patch) this.prefs.ownerName = line(patch.ownerName, 80);
    if ('lan' in patch) this.prefs.lan = bool(patch.lan);
    if (Array.isArray(patch.folders)) this.prefs.folders = patch.folders.slice(0, 100).map(f => ({ id: safeId(f?.id) || `d_${rid(6)}`, name: line(f?.name, 80) || 'Dossier', color: color(f?.color) || '#64748b' }));
    if (Array.isArray(patch.joined)) this.prefs.joined = patch.joined.slice(0, 100).map(j => ({ url: str(j?.url, 600), title: line(j?.title, 200), icon: line(j?.icon, 16), openedAt: iso(j?.openedAt) || new Date().toISOString() })).filter(j => /^https?:\/\//.test(j.url));
    const folderIds = new Set(this.prefs.folders.map(f => f.id));
    for (const s of this.spaces.values()) if (s.folder && !folderIds.has(s.folder)) { s.folder = null; this.schedule(s); }
    return this.savePrefs().then(() => this.prefs);
  }
  ownerName() { return this.prefs.ownerName || 'Moi'; }

  // ---------- Écriture ----------
  schedule(space) {
    clearTimeout(this.timers.get(space.id));
    this.timers.set(space.id, setTimeout(() => this.save(space.id).catch(e => this.log(`Enregistrement ${space.id} : ${e.message}`)), 250));
  }
  async save(id) {
    this.timers.delete(id);
    const space = this.spaces.get(id);
    if (!space) return;
    const previous = this.saving.get(id) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      const file = path.join(this.dir(id), 'space.json');
      await fs.mkdir(this.dir(id), { recursive: true });
      await fs.copyFile(file, `${file}.bak`).catch(() => {});
      await writeAtomic(file, JSON.stringify(space));
    });
    this.saving.set(id, job);
    return job;
  }
  async flush() {
    const ids = [...this.timers.keys()];
    for (const id of ids) clearTimeout(this.timers.get(id));
    await Promise.all(ids.map(id => this.save(id).catch(() => {})));
    await Promise.all([...this.saving.values()].map(p => p.catch(() => {})));
  }
  touch(space, event, origin) {
    space.rev++;
    space.updatedAt = new Date().toISOString();
    this.schedule(space);
    if (event && this.onEvent) { try { this.onEvent(space, event, origin); } catch (e) { this.log(`Diffusion : ${e.message}`); } }
  }

  // ---------- Espaces ----------
  get(id) {
    const s = this.spaces.get(id);
    if (!s) fail(404, 'Espace introuvable.');
    return s;
  }
  list() { return [...this.spaces.values()].map(spaceSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }

  /** Crée un espace vide ou à partir d’un modèle complet (sections, champs, publications, cartes). */
  async create(input = {}) {
    const kind = oneOf(input.kind, KINDS, 'board');
    const base = newSpace({ kind, title: input.title, description: input.description, icon: input.icon, owner: this.ownerName() });
    const raw = { ...base };
    if (input.theme) raw.theme = { ...base.theme, ...input.theme };
    if (input.settings) raw.settings = { ...base.settings, ...input.settings };
    if (Array.isArray(input.fields)) raw.fields = input.fields;
    if (Array.isArray(input.sections) && input.sections.length) raw.sections = input.sections;
    if (Array.isArray(input.groups)) raw.groups = input.groups;
    if (Array.isArray(input.cards) && input.cards.length) raw.cards = input.cards;
    if (input.folder) raw.folder = safeId(input.folder);
    const now = Date.now();
    raw.posts = (Array.isArray(input.posts) ? input.posts : []).map((p, i) => ({
      ...p, id: safeId(p.id) || `p_${rid(10)}`, order: num(p.order, -1e12, 1e12, i + 1), status: 'published',
      author: p.author?.name ? { id: safeId(p.author.id, 'owner'), name: p.author.name } : { id: 'owner', name: this.ownerName() },
      createdAt: new Date(now + i).toISOString(), updatedAt: new Date(now + i).toISOString(), reactions: {}, comments: [],
    }));
    raw.connections = Array.isArray(input.connections) ? input.connections : [];
    const space = normalizeSpace(raw);
    space.sharing = normalizeSharing({});
    this.spaces.set(space.id, space);
    for (const p of space.posts) this.announced.add(p.id);
    await this.save(space.id);
    return space;
  }
  async duplicate(id, { title, template = false } = {}) {
    const src = this.get(id);
    const copy = clone(src);
    copy.id = rid(10);
    copy.title = line(title, LIMITS.title) || (template ? src.title : `Copie de ${src.title}`).slice(0, LIMITS.title);
    copy.createdAt = copy.updatedAt = copy.openedAt = new Date().toISOString();
    copy.rev = 1; copy.sharing = normalizeSharing({}); copy.drafts = {}; copy.people = {}; copy.favorite = false; copy.archived = false; copy.trashedAt = null; copy.isTemplate = !!template;
    copy.owner = { name: this.ownerName() };
    if (template) for (const p of copy.posts) { p.reactions = {}; p.fieldVotes = {}; p.comments = []; if (p.poll) p.poll.votes = {}; }
    const space = normalizeSpace(copy);
    await fs.mkdir(this.mediaDir(space.id), { recursive: true });
    await fs.cp(this.mediaDir(id), this.mediaDir(space.id), { recursive: true }).catch(e => { if (e.code !== 'ENOENT') throw e; });
    this.spaces.set(space.id, space);
    for (const p of space.posts) this.announced.add(p.id);
    await this.save(space.id);
    return space;
  }
  /** Suppression définitive : seulement depuis la corbeille. */
  async destroy(id) {
    const space = this.get(id);
    if (!space.trashedAt) fail(409, 'Mettez d’abord l’espace dans la corbeille.');
    clearTimeout(this.timers.get(id)); this.timers.delete(id);
    await (this.saving.get(id) || Promise.resolve()).catch(() => {});
    this.spaces.delete(id);
    await fs.rm(this.dir(id), { recursive: true, force: true });
    if (this.onEvent) this.onEvent(space, { type: 'space-removed' });
  }
  updateMeta(id, patch = {}, viewer, origin) {
    const space = this.get(id);
    const owner = can(viewer, 'share');
    if (!can(viewer, 'edit')) fail(403, 'Vous ne pouvez pas modifier cet espace.');
    if ('title' in patch) space.title = line(patch.title, LIMITS.title) || space.title;
    if ('description' in patch) space.description = str(patch.description, 2000);
    if ('icon' in patch) space.icon = line(patch.icon, 16) || space.icon;
    if (patch.theme) space.theme = normalizeTheme({ ...space.theme, ...patch.theme }, space.kind);
    if (Array.isArray(patch.fields)) {
      space.fields = patch.fields.slice(0, 60).map(normalizeField);
      const ids = new Set(space.fields.map(f => f.id));
      for (const p of space.posts) for (const k of Object.keys(p.fields || {})) if (!ids.has(k)) delete p.fields[k];
    }
    if (patch.settings) space.settings = normalizeSettings({ ...space.settings, ...patch.settings }, space.kind, space.fields);
    if (Array.isArray(patch.sections)) this.setSections(space, patch.sections);
    if (Array.isArray(patch.groups)) space.groups = patch.groups.slice(0, 60).map(g => ({ id: safeId(g?.id) || `g_${rid(6)}`, name: line(g?.name, 80) || 'Groupe', color: color(g?.color) || '#6366f1' }));
    if (owner) {
      if ('folder' in patch) space.folder = this.prefs.folders.some(f => f.id === patch.folder) ? patch.folder : null;
      if ('favorite' in patch) space.favorite = bool(patch.favorite);
      if ('archived' in patch) space.archived = bool(patch.archived);
      if ('isTemplate' in patch) space.isTemplate = bool(patch.isTemplate);
      if ('trashed' in patch) space.trashedAt = bool(patch.trashed) ? new Date().toISOString() : null;
      if ('ownerLabel' in patch) space.owner.name = line(patch.ownerLabel, 80) || space.owner.name;
    }
    this.touch(space, { type: 'meta' }, origin);
    if (Array.isArray(patch.sections)) for (const p of space.posts) this.emitPost(space, p, origin, true);
    return space;
  }
  opened(id) { const s = this.get(id); s.openedAt = new Date().toISOString(); this.schedule(s); }
  setSections(space, sections) {
    const old = new Map(space.sections.map(s => [s.id, s]));
    const next = sections.slice(0, 200).map(s => ({ id: safeId(s?.id) && old.has(s.id) ? s.id : `s_${rid(8)}`, title: line(s?.title, 120) || 'Section', color: color(s?.color) }));
    if (space.kind === 'board' && !next.length) next.push({ id: `s_${rid(8)}`, title: 'Général' });
    const ids = new Set(next.map(s => s.id));
    const fallback = next[0]?.id || null;
    for (const p of space.posts) if (!ids.has(p.sectionId)) p.sectionId = fallback;
    space.sections = next;
  }
  emitPost(space, post, origin, quiet = false) {
    if (!this.onEvent) return;
    try { this.onEvent(space, { type: 'post', id: post.id, quiet }, origin); } catch (e) { this.log(`Diffusion : ${e.message}`); }
  }

  // ---------- Partage ----------
  updateSharing(id, patch = {}, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'share')) fail(403, 'Seul le propriétaire gère le partage.');
    const sh = space.sharing;
    if ('visibility' in patch) sh.visibility = oneOf(patch.visibility, VISIBILITY, sh.visibility);
    if ('defaultRole' in patch) sh.defaultRole = oneOf(patch.defaultRole, ROLES, sh.defaultRole);
    if ('publicRole' in patch) sh.publicRole = oneOf(patch.publicRole, ['viewer', 'commenter', 'contributor', 'submitter'], sh.publicRole);
    if ('requireName' in patch) sh.requireName = bool(patch.requireName);
    if (patch.addLink) {
      const l = patch.addLink;
      const role = oneOf(l.role, ROLES, sh.defaultRole);
      sh.links.push({ id: `l_${rid(8)}`, key: newKey(), role, label: line(l.label, 120), createdAt: new Date().toISOString(), disabled: false, asOwner: !!l.asOwner && role === 'admin', invite: bool(l.invite), group: space.groups.some(g => g.id === l.group) ? l.group : null });
    }
    if (patch.updateLink) {
      const link = sh.links.find(x => x.id === patch.updateLink.id);
      if (link) {
        if ('role' in patch.updateLink) { link.role = oneOf(patch.updateLink.role, ROLES, link.role); if (link.role !== 'admin') link.asOwner = false; }
        if ('label' in patch.updateLink) link.label = line(patch.updateLink.label, 120);
        if ('disabled' in patch.updateLink) link.disabled = bool(patch.updateLink.disabled);
        if ('group' in patch.updateLink) link.group = space.groups.some(g => g.id === patch.updateLink.group) ? patch.updateLink.group : null;
      }
    }
    if (patch.removeLink) sh.links = sh.links.filter(x => x.id !== patch.removeLink);
    if (patch.regenerate) { const link = sh.links.find(x => x.id === patch.regenerate); if (link) link.key = newKey(); }
    this.touch(space, { type: 'sharing' }, origin);
    return space;
  }
  ensureDefaultLink(space) {
    if (!space.sharing.links.some(l => !l.disabled && !l.invite && !l.asOwner && l.role === space.sharing.defaultRole)) {
      space.sharing.links.push({ id: `l_${rid(8)}`, key: newKey(), role: space.sharing.defaultRole, label: 'Lien principal', createdAt: new Date().toISOString(), disabled: false, asOwner: false, invite: false, group: null });
      this.touch(space, { type: 'sharing' });
    }
  }
  join(space, viewer, { name, group } = {}) {
    if (viewer.isOwner || viewer.asOwner) return;
    const prev = space.people[viewer.id] || {};
    const g = space.groups.some(x => x.id === group) ? group : (prev.group || null);
    space.people[viewer.id] = { name: line(name, LIMITS.name) || prev.name || 'Anonyme', group: g, firstSeen: prev.firstSeen || new Date().toISOString(), lastSeen: new Date().toISOString(), role: viewer.role };
    if (Object.keys(space.people).length > 2000) {
      const oldest = Object.entries(space.people).sort((a, b) => a[1].lastSeen.localeCompare(b[1].lastSeen)).slice(0, 200);
      for (const [k] of oldest) delete space.people[k];
    }
    this.schedule(space);
  }

  // ---------- Publications ----------
  post(space, postId) {
    const p = space.posts.find(x => x.id === postId);
    if (!p) fail(404, 'Publication introuvable.');
    return p;
  }
  createPost(id, input = {}, viewer, origin) {
    const space = this.get(id);
    if (space.kind !== 'board') fail(400, 'Les publications sont réservées aux tableaux.');
    if (!can(viewer, 'post')) fail(403, 'Vous ne pouvez pas publier dans cet espace.');
    if (space.posts.length >= LIMITS.posts) fail(409, 'Cet espace contient déjà trop de publications.');
    const clean = cleanPostInput({ fields: {}, ...input }, space);
    const sectionId = clean.sectionId || space.sections[0]?.id || null;
    const siblings = space.posts.filter(p => p.sectionId === sectionId).map(p => p.order);
    const order = clean.order ?? (space.settings.newPosts === 'start' ? (siblings.length ? Math.min(...siblings) - 1 : 0) : (siblings.length ? Math.max(...siblings) + 1 : 0));
    const now = new Date().toISOString();
    const post = {
      id: `p_${rid(10)}`, order, sectionId, author: { id: viewer.id, name: viewer.name || 'Anonyme' }, createdAt: now, updatedAt: now,
      title: clean.title || '', body: clean.body || '', color: clean.color || null, attachments: clean.attachments || [], poll: clean.poll || null,
      location: clean.location || null, eventDate: clean.eventDate || null, publishAt: clean.publishAt || null, pos: clean.pos || null, fields: clean.fields || {},
      status: 'published', reactions: {}, fieldVotes: {}, comments: [],
    };
    if (!post.title && !post.body.trim() && !post.attachments.length && !post.poll && !post.location) fail(400, 'La publication est vide : ajoutez un titre, un texte ou un fichier.');
    const missing = missingRequired(space, post);
    if (missing.length) fail(400, `Champ obligatoire : ${missing.join(', ')}.`);
    if (!can(viewer, 'moderate')) {
      if (space.settings.moderation === 'approval') post.status = 'pending';
      else if (space.settings.moderation === 'auto') {
        const flag = moderationFlag(`${post.title} ${post.body} ${post.poll?.question || ''} ${(post.poll?.options || []).map(o => o.text).join(' ')}`);
        if (flag) { post.status = 'pending'; post.flag = flag; }
      }
    }
    space.posts.push(post);
    if (!post.publishAt) this.announced.add(post.id);
    delete space.drafts[viewer.id];
    this.touch(space, { type: 'post', id: post.id }, origin);
    return post;
  }
  updatePost(id, postId, input = {}, viewer, origin) {
    const space = this.get(id);
    const post = this.post(space, postId);
    const own = post.author.id === viewer.id;
    const layoutOnly = Object.keys(input).every(k => ['sectionId', 'order', 'pos'].includes(k));
    if (!(can(viewer, 'moderate') || (own && can(viewer, 'post')) || (layoutOnly && can(viewer, 'edit')))) fail(403, 'Vous ne pouvez pas modifier cette publication.');
    const clean = cleanPostInput(input, space, post);
    Object.assign(post, clean);
    if (!layoutOnly) {
      post.updatedAt = new Date().toISOString();
      const missing = missingRequired(space, post);
      if (missing.length && ('fields' in input)) fail(400, `Champ obligatoire : ${missing.join(', ')}.`);
      if (!can(viewer, 'moderate') && space.settings.moderation === 'auto' && post.status === 'published') {
        const flag = moderationFlag(`${post.title} ${post.body}`);
        if (flag) { post.status = 'pending'; post.flag = flag; }
      }
      if ('publishAt' in clean && clean.publishAt) this.announced.delete(post.id);
    }
    this.touch(space, { type: 'post', id: post.id }, origin);
    return post;
  }
  /** Déplacement groupé (glisser-déposer) : [{id, sectionId, order, pos}] */
  movePosts(id, moves = [], viewer, origin) {
    const space = this.get(id);
    const out = [];
    for (const m of (Array.isArray(moves) ? moves : []).slice(0, 500)) {
      const post = space.posts.find(p => p.id === m?.id);
      if (!post) continue;
      if (!(can(viewer, 'edit') || can(viewer, 'moderate') || (post.author.id === viewer.id && can(viewer, 'post')))) continue;
      const clean = cleanPostInput({ ...(m.sectionId !== undefined ? { sectionId: m.sectionId } : {}), ...(m.order !== undefined ? { order: m.order } : {}), ...(m.pos !== undefined ? { pos: m.pos } : {}) }, space, post);
      Object.assign(post, clean);
      out.push(post);
    }
    if (!out.length) return [];
    space.rev++; space.updatedAt = new Date().toISOString(); this.schedule(space);
    for (const p of out) this.emitPost(space, p, origin, true);
    return out;
  }
  deletePost(id, postId, viewer, origin) {
    const space = this.get(id);
    const post = this.post(space, postId);
    if (!(can(viewer, 'moderate') || (post.author.id === viewer.id && can(viewer, 'post')))) fail(403, 'Vous ne pouvez pas supprimer cette publication.');
    space.posts = space.posts.filter(p => p.id !== postId);
    space.connections = space.connections.filter(c => c.from !== postId && c.to !== postId);
    this.touch(space, { type: 'post-removed', id: postId }, origin);
  }
  duplicatePost(id, postId, viewer, origin) {
    const space = this.get(id);
    const src = this.post(space, postId);
    if (!can(viewer, 'post')) fail(403, 'Vous ne pouvez pas publier dans cet espace.');
    const copy = clone(src);
    Object.assign(copy, { id: `p_${rid(10)}`, order: src.order + 0.5, author: { id: viewer.id, name: viewer.name || 'Anonyme' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), reactions: {}, fieldVotes: {}, comments: [], status: can(viewer, 'moderate') ? 'published' : src.status });
    if (copy.poll) copy.poll.votes = {};
    if (copy.pos) copy.pos = { x: copy.pos.x + 30, y: copy.pos.y + 30 };
    space.posts.push(copy);
    this.announced.add(copy.id);
    this.touch(space, { type: 'post', id: copy.id }, origin);
    return copy;
  }
  moderate(id, postId, decision, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'moderate')) fail(403, 'Réservé aux modérateurs.');
    const post = this.post(space, postId);
    post.status = decision === 'approve' ? 'published' : 'rejected';
    delete post.flag;
    this.touch(space, { type: 'post', id: post.id }, origin);
    return post;
  }
  react(id, postId, input = {}, viewer, origin) {
    const space = this.get(id);
    const post = this.post(space, postId);
    if (!can(viewer, 'react')) fail(403, 'Vous ne pouvez pas réagir dans cet espace.');
    const r = post.reactions ||= {};
    const type = input.type;
    if (type === 'like') { r.like ||= {}; if (r.like[viewer.id]) delete r.like[viewer.id]; else r.like[viewer.id] = true; }
    else if (type === 'vote') { r.vote ||= {}; const v = Math.sign(num(input.value, -1, 1, 0)); if (!v || r.vote[viewer.id] === v) delete r.vote[viewer.id]; else r.vote[viewer.id] = v; }
    else if (type === 'stars') { r.stars ||= {}; const v = Math.round(num(input.value, 0, 5, 0)); if (!v || r.stars[viewer.id] === v) delete r.stars[viewer.id]; else r.stars[viewer.id] = v; }
    else if (type === 'grade') { r.grade ||= {}; const v = num(input.value, 0, 100); if (v == null) delete r.grade[viewer.id]; else r.grade[viewer.id] = v; }
    else if (type === 'emoji') {
      const e = line(input.value, 16); if (!e || (!EMOJI_REACTIONS.includes(e) && !/^\p{Extended_Pictographic}/u.test(e))) fail(400, 'Réaction inconnue.');
      r.emoji ||= {}; const who = r.emoji[e] ||= {}; if (who[viewer.id]) delete who[viewer.id]; else who[viewer.id] = true;
      if (!Object.keys(who).length) delete r.emoji[e];
      if (Object.keys(r.emoji).length > 24) fail(409, 'Trop de réactions différentes.');
    } else if (type === 'fieldVote') {
      const field = space.fields.find(f => f.id === input.field && f.type === 'vote'); if (!field) fail(400, 'Champ de vote inconnu.');
      const who = (post.fieldVotes ||= {})[field.id] ||= {}; if (who[viewer.id]) delete who[viewer.id]; else who[viewer.id] = true;
    } else fail(400, 'Réaction inconnue.');
    this.touch(space, { type: 'post', id: post.id, quiet: true }, origin);
    return post;
  }
  votePoll(id, postId, optionIds, viewer, origin) {
    const space = this.get(id);
    const post = this.post(space, postId);
    if (!post.poll) fail(400, 'Pas de sondage dans cette publication.');
    if (!can(viewer, 'react') && !can(viewer, 'post')) fail(403, 'Vous ne pouvez pas voter.');
    if (post.poll.closed) fail(409, 'Le sondage est clos.');
    const valid = new Set(post.poll.options.map(o => o.id));
    let list = (Array.isArray(optionIds) ? optionIds : [optionIds]).filter(x => valid.has(x));
    if (!post.poll.multiple) list = list.slice(0, 1);
    post.poll.votes ||= {};
    if (list.length) post.poll.votes[viewer.id] = [...new Set(list)]; else delete post.poll.votes[viewer.id];
    this.touch(space, { type: 'post', id: post.id, quiet: true }, origin);
    return post;
  }
  addComment(id, postId, input = {}, viewer, origin) {
    const space = this.get(id);
    const post = this.post(space, postId);
    if (!space.settings.comments && !can(viewer, 'moderate')) fail(403, 'Les commentaires sont désactivés.');
    if (!can(viewer, 'comment')) fail(403, 'Vous ne pouvez pas commenter.');
    const body = str(input.body, LIMITS.comment).trim();
    const attachment = input.attachment ? cleanPostInput({ attachments: [input.attachment] }, space).attachments[0] || null : null;
    if (!body && !attachment) fail(400, 'Le commentaire est vide.');
    if (post.comments.length >= LIMITS.comments) fail(409, 'Trop de commentaires sur cette publication.');
    const flagged = space.settings.moderation === 'auto' && !can(viewer, 'moderate') && moderationFlag(body);
    if (flagged) fail(400, 'Ce commentaire contient un mot interdit par la modération.');
    const comment = { id: `c_${rid(10)}`, author: { id: viewer.id, name: viewer.name || 'Anonyme' }, createdAt: new Date().toISOString(), body, attachment };
    post.comments.push(comment);
    this.touch(space, { type: 'post', id: post.id, quiet: true, comment: comment.id }, origin);
    return post;
  }
  deleteComment(id, postId, commentId, viewer, origin) {
    const space = this.get(id);
    const post = this.post(space, postId);
    const c = post.comments.find(x => x.id === commentId);
    if (!c) fail(404, 'Commentaire introuvable.');
    if (!(can(viewer, 'moderate') || c.author.id === viewer.id)) fail(403, 'Vous ne pouvez pas supprimer ce commentaire.');
    post.comments = post.comments.filter(x => x.id !== commentId);
    this.touch(space, { type: 'post', id: post.id, quiet: true }, origin);
    return post;
  }
  setConnections(id, connections, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'edit') && !can(viewer, 'moderate')) fail(403, 'Vous ne pouvez pas relier les publications.');
    const ids = new Set(space.posts.map(p => p.id));
    space.connections = (Array.isArray(connections) ? connections : []).slice(0, 2000).filter(c => ids.has(c?.from) && ids.has(c?.to) && c.from !== c.to)
      .map(c => ({ id: safeId(c.id) || `l_${rid(8)}`, from: c.from, to: c.to, label: line(c.label, 120) }));
    this.touch(space, { type: 'meta' }, origin);
    return space.connections;
  }

  // ---------- Brouillons ----------
  getDraft(id, viewer) { return this.get(id).drafts[viewer.id] || null; }
  saveDraft(id, input, viewer) {
    const space = this.get(id);
    if (!can(viewer, 'post')) fail(403, 'Vous ne pouvez pas publier dans cet espace.');
    if (!input) { delete space.drafts[viewer.id]; this.schedule(space); return null; }
    const clean = cleanPostInput({ fields: {}, ...input }, space);
    const draft = { ...clean, editing: safeId(input.editing), updatedAt: new Date().toISOString() };
    space.drafts[viewer.id] = draft;
    this.schedule(space);
    return draft;
  }

  // ---------- Espace libre (cartes et objets) ----------
  card(space, cardId) {
    let c = space.cards.find(x => x.id === cardId);
    // Calque de dessin et de texte d’un tableau : créé au premier trait.
    if (!c && cardId === 'ink' && space.kind === 'board') { c = { id: 'ink', title: 'Calque', groupId: null, background: null, objects: [] }; space.cards.push(c); }
    if (!c) fail(404, 'Carte introuvable.');
    return c;
  }
  canDraw(space, card, viewer) {
    if (can(viewer, 'edit')) return true;
    if (!can(viewer, 'post')) return false;
    if (space.settings.groupWork && card.groupId && card.groupId !== viewer.group) return false;
    return space.settings.canvasMode === 'edit' || space.settings.participantsCanAdd;
  }
  addCard(id, input = {}, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'edit')) fail(403, 'Seuls les animateurs ajoutent des cartes.');
    if (space.cards.length >= LIMITS.cards) fail(409, 'Trop de cartes.');
    const card = newCard(input);
    if (input.groupId && !space.groups.some(g => g.id === input.groupId)) card.groupId = null;
    if (Array.isArray(input.objects)) card.objects = input.objects.slice(0, LIMITS.objects).map(o => cleanObject({ ...o, id: undefined }, card)).filter(Boolean);
    const at = num(input.index, 0, space.cards.length, space.cards.length);
    space.cards.splice(at, 0, card);
    this.touch(space, { type: 'card', id: card.id }, origin);
    this.touch(space, { type: 'cards-order' }, origin);
    return card;
  }
  updateCard(id, cardId, input = {}, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'edit')) fail(403, 'Seuls les animateurs modifient les cartes.');
    const card = this.card(space, cardId);
    if ('title' in input) card.title = line(input.title, 120) || card.title;
    if ('groupId' in input) card.groupId = space.groups.some(g => g.id === input.groupId) ? input.groupId : null;
    if ('background' in input) card.background = color(input.background);
    this.touch(space, { type: 'card', id: card.id }, origin);
    return card;
  }
  duplicateCard(id, cardId, viewer, origin) {
    const space = this.get(id);
    const src = this.card(space, cardId);
    return this.addCard(id, { title: `${src.title} (copie)`, groupId: src.groupId, background: src.background, objects: clone(src.objects), index: space.cards.indexOf(src) + 1 }, viewer, origin);
  }
  deleteCard(id, cardId, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'edit')) fail(403, 'Seuls les animateurs suppriment des cartes.');
    this.card(space, cardId);
    if (space.cards.length <= 1) fail(409, 'Un espace libre garde au moins une carte.');
    space.cards = space.cards.filter(c => c.id !== cardId);
    for (const c of space.cards) for (const o of c.objects) if (o.action?.type === 'card' && o.action.target === cardId) delete o.action;
    this.touch(space, { type: 'card-removed', id: cardId }, origin);
  }
  reorderCards(id, ids, viewer, origin) {
    const space = this.get(id);
    if (!can(viewer, 'edit')) fail(403, 'Seuls les animateurs réorganisent les cartes.');
    const byId = new Map(space.cards.map(c => [c.id, c]));
    const next = (Array.isArray(ids) ? ids : []).map(x => byId.get(x)).filter(Boolean);
    for (const c of space.cards) if (!next.includes(c)) next.push(c);
    space.cards = next;
    this.touch(space, { type: 'cards-order' }, origin);
  }
  /** Ajoute ou modifie des objets ; renvoie la version enregistrée de chaque objet. */
  upsertObjects(id, cardId, objects = [], viewer, origin) {
    const space = this.get(id);
    const card = this.card(space, cardId);
    if (!this.canDraw(space, card, viewer)) fail(403, 'Vous ne pouvez pas modifier cette carte.');
    const saved = [];
    for (const raw of (Array.isArray(objects) ? objects : []).slice(0, 500)) {
      const existing = card.objects.find(o => o.id === raw?.id);
      if (existing && !can(viewer, 'edit') && existing.author?.id !== viewer.id) continue;
      if (existing?.locked && !can(viewer, 'edit') && raw.locked !== false) continue;
      const obj = cleanObject({ ...(existing || {}), ...raw, poll: raw.poll || existing?.poll, author: existing?.author || { id: viewer.id, name: viewer.name } }, card);
      if (!obj) continue;
      if (existing) {
        for (const k of Object.keys(existing)) delete existing[k];
        Object.assign(existing, obj);
        saved.push(existing);
      } else {
        if (card.objects.length >= LIMITS.objects) fail(409, 'Cette carte contient trop d’objets.');
        card.objects.push(obj);
        saved.push(obj);
      }
    }
    if (saved.length) { space.rev++; space.updatedAt = new Date().toISOString(); this.schedule(space); this.onEvent?.(space, { type: 'objects', cardId, ids: saved.map(o => o.id) }, origin); }
    return saved;
  }
  removeObjects(id, cardId, ids = [], viewer, origin) {
    const space = this.get(id);
    const card = this.card(space, cardId);
    if (!this.canDraw(space, card, viewer)) fail(403, 'Vous ne pouvez pas modifier cette carte.');
    const set = new Set((Array.isArray(ids) ? ids : []).filter(x => typeof x === 'string'));
    const removed = [];
    card.objects = card.objects.filter(o => {
      if (!set.has(o.id)) return true;
      if (!can(viewer, 'edit') && (o.author?.id !== viewer.id || o.locked)) return true;
      removed.push(o.id); return false;
    });
    for (const o of card.objects) for (const end of ['from', 'to']) if (o[end] && removed.includes(o[end].id)) delete o[end];
    if (removed.length) { space.rev++; space.updatedAt = new Date().toISOString(); this.schedule(space); this.onEvent?.(space, { type: 'objects', cardId, ids: [], removed }, origin); }
    return removed;
  }
  voteObjectPoll(id, cardId, objectId, optionIds, viewer, origin) {
    const space = this.get(id);
    const card = this.card(space, cardId);
    const obj = card.objects.find(o => o.id === objectId && o.type === 'poll');
    if (!obj) fail(404, 'Sondage introuvable.');
    if (!can(viewer, 'react') && !can(viewer, 'post')) fail(403, 'Vous ne pouvez pas voter.');
    if (obj.poll.closed) fail(409, 'Le sondage est clos.');
    const valid = new Set(obj.poll.options.map(o => o.id));
    let list = (Array.isArray(optionIds) ? optionIds : [optionIds]).filter(x => valid.has(x));
    if (!obj.poll.multiple) list = list.slice(0, 1);
    obj.poll.votes ||= {};
    if (list.length) obj.poll.votes[viewer.id] = [...new Set(list)]; else delete obj.poll.votes[viewer.id];
    space.rev++; this.schedule(space);
    this.onEvent?.(space, { type: 'objects', cardId, ids: [obj.id] }, origin);
    return obj;
  }

  // ---------- Fichiers ----------
  /** Enregistre un flux (envoi de fichier) dans le dossier media de l’espace. */
  async saveMedia(id, stream, { name, mime, limit = 1024 ** 3 } = {}) {
    const space = this.get(id);
    await fs.mkdir(this.mediaDir(id), { recursive: true });
    const clean = asciiName(name);
    const file = `${rid(8)}-${clean}`;
    const target = path.join(this.mediaDir(id), file);
    const temp = `${target}.part`;
    let size = 0;
    let head = Buffer.alloc(0);
    const out = fss.createWriteStream(temp);
    try {
      await pipeline(stream, async function* (source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > limit) throw new HttpError(413, `Fichier trop volumineux (maximum ${Math.round(limit / 1024 ** 2)} Mo).`);
          if (head.length < 65536) head = Buffer.concat([head, chunk.subarray(0, 65536 - head.length)]);
          yield chunk;
        }
      }, out);
      if (!size) throw new HttpError(400, 'Fichier vide.');
      await fs.rename(temp, target);
    } catch (e) { await fs.unlink(temp).catch(() => {}); throw e; }
    const type = (mime && mime !== 'application/octet-stream' ? String(mime).split(';')[0].trim().toLowerCase() : '') || mimeOf(name);
    const att = { id: `a_${rid(8)}`, kind: kindOf(type, name), file, name: line(name, 200) || clean, mime: type, size };
    if (att.kind === 'image') { const dim = imageSize(head); if (dim?.w && dim?.h) { att.w = dim.w; att.h = dim.h; } }
    if (att.kind === 'svg' && !/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head.toString('utf8'))) { await fs.unlink(target).catch(() => {}); fail(400, 'Fichier SVG invalide.'); }
    space.updatedAt = new Date().toISOString();
    return att;
  }
  async saveBuffer(id, buffer, opts) {
    const { Readable } = await import('node:stream');
    return this.saveMedia(id, Readable.from([buffer]), opts);
  }
  mediaPath(id, file) {
    this.get(id);
    const f = mediaFile(file);
    if (!f) fail(404, 'Fichier introuvable.');
    return path.join(this.mediaDir(id), f);
  }
  /** Chemins locaux (supports de cours) référencés par une publication : servis seulement s’ils sont attachés. */
  localAttachment(id, attId) {
    const space = this.get(id);
    for (const p of space.posts) for (const a of p.attachments || []) if (a.id === attId && a.kind === 'local' && a.path) return { post: p, att: a };
    fail(404, 'Fichier introuvable.');
  }

  /** Publications programmées devenues visibles depuis le dernier passage. */
  dueScheduled() {
    const out = [];
    const now = Date.now();
    for (const space of this.spaces.values()) for (const p of space.posts) {
      if (this.announced.has(p.id)) continue;
      if (!p.publishAt || Date.parse(p.publishAt) <= now) { this.announced.add(p.id); out.push([space, p]); }
    }
    return out;
  }
}

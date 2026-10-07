// Espaces Cours Albert : modèle de données, validation des entrées et droits (fonctions pures, testées hors ligne).
import crypto from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export function rid(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export const newKey = () => crypto.randomBytes(18).toString('base64url');

export const KINDS = ['board', 'canvas'];
export const LAYOUTS = ['wall', 'columns', 'grid', 'table', 'stream', 'timeline', 'map', 'free'];
export const SORTS = ['manual', 'newest', 'oldest', 'title', 'reactions', 'date'];
export const REACTIONS = ['none', 'like', 'vote', 'stars', 'grade', 'emoji'];
export const MODERATION = ['none', 'approval', 'auto'];
export const VISIBILITY = ['private', 'invited', 'link', 'public'];
export const ROLES = ['viewer', 'commenter', 'submitter', 'contributor', 'moderator', 'admin'];
export const FIELD_TYPES = ['text', 'number', 'date', 'email', 'phone', 'url', 'select', 'multiselect', 'user', 'button', 'vote', 'score', 'rating'];
export const FONTS = ['system', 'serif', 'mono', 'rounded', 'hand'];
export const CARD_STYLES = ['light', 'dark', 'glass', 'color'];
export const SIZES = ['s', 'm', 'l'];
export const ATTACHMENT_KINDS = ['image', 'video', 'audio', 'file', 'link', 'drawing', 'embed', 'svg', 'local'];
export const OBJECT_TYPES = ['text', 'sticky', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'hexagon', 'line', 'arrow', 'path', 'image', 'video', 'audio', 'file', 'link', 'sticker', 'poll', 'embed', 'frame'];
export const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '🎉', '💡', '🔥', '👏'];
export const LIMITS = { title: 300, body: 40000, comment: 8000, name: 80, label: 200, url: 2000, posts: 5000, objects: 4000, cards: 200, comments: 2000 };

// ---------- Petites validations ----------
export const str = (v, max = 1000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\u0000/g, '').slice(0, max);
export const line = (v, max = 300) => str(v, max * 2).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
export const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
export const bool = (v, fallback = false) => (typeof v === 'boolean' ? v : v === 1 || v === 'true' ? true : v === 0 || v === 'false' ? false : fallback);
export function num(v, min = -Infinity, max = Infinity, fallback = null) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
export function iso(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
}
export function dateOnly(v) {
  const s = str(v, 40).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T12:00:00Z'))) return s;
  const t = iso(s);
  return t ? t.slice(0, 10) : null;
}
export function httpUrl(v) {
  const s = str(v, LIMITS.url).trim();
  if (!s) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : '';
  } catch { return ''; }
}
export const color = v => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
export const safeId = (v, fallback = null) => (typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v) ? v : fallback);
export const mediaFile = v => (typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,180}$/i.test(v) && !v.includes('..') ? v : null);

// ---------- Valeurs par défaut ----------
export function defaultTheme(kind = 'board') {
  return { wallpaper: kind === 'canvas' ? 'color:#eef1f6' : 'gradient:aurore', accent: '#4f46e5', font: 'system', cards: 'light', size: 'm' };
}
export function defaultSettings(kind = 'board') {
  return {
    layout: 'wall', sections: false, showAuthor: true, showDate: true, sort: 'manual', newPosts: 'end',
    reactions: 'like', comments: true, moderation: 'none', attribution: 'names', guestAI: false,
    canvasMode: 'edit', participantsCanAdd: true, groupWork: false, aspect: kind === 'canvas' ? '16:9' : null,
  };
}
export function defaultSharing() {
  return { visibility: 'private', defaultRole: 'contributor', publicRole: 'viewer', links: [], requireName: true };
}

export function newSpace({ kind = 'board', title, description, icon, owner } = {}) {
  const now = new Date().toISOString();
  const k = oneOf(kind, KINDS, 'board');
  const space = {
    v: 1, id: rid(10), kind: k, rev: 1,
    title: line(title, LIMITS.title) || (k === 'canvas' ? 'Espace libre sans titre' : 'Tableau sans titre'),
    description: str(description, 2000), icon: line(icon, 16) || (k === 'canvas' ? '🎨' : '📌'),
    createdAt: now, updatedAt: now, owner: { name: line(owner, LIMITS.name) || 'Moi' },
    folder: null, favorite: false, archived: false, trashedAt: null, isTemplate: false, openedAt: now,
    theme: defaultTheme(k), settings: defaultSettings(k), fields: [], sections: [], posts: [], connections: [],
    groups: [], cards: [], sharing: defaultSharing(), drafts: {}, people: {},
  };
  if (k === 'board') space.sections.push({ id: `s_${rid(8)}`, title: 'Général' });
  if (k === 'canvas') space.cards.push(newCard({ title: 'Carte 1' }));
  return space;
}
export function newCard(input = {}) {
  return { id: `k_${rid(8)}`, title: line(input.title, 120) || 'Nouvelle carte', groupId: safeId(input.groupId), background: color(input.background) || null, objects: [] };
}

// ---------- Normalisation (chargement disque et entrées du propriétaire) ----------
export function normalizeTheme(t = {}, kind = 'board') {
  const d = defaultTheme(kind);
  const wallpaper = typeof t.wallpaper === 'string' && /^(color:#[0-9a-f]{3,8}|gradient:[a-z0-9-]{1,30}|pattern:[a-z0-9-]{1,30}(:#[0-9a-f]{3,8})?|image:[a-z0-9][a-z0-9._-]{0,180})$/i.test(t.wallpaper) ? t.wallpaper : d.wallpaper;
  return { wallpaper, accent: color(t.accent) || d.accent, font: oneOf(t.font, FONTS, d.font), cards: oneOf(t.cards, CARD_STYLES, d.cards), size: oneOf(t.size, SIZES, d.size) };
}
export function normalizeSettings(s = {}, kind = 'board', fields = []) {
  const d = defaultSettings(kind);
  const sort = typeof s.sort === 'string' && (SORTS.includes(s.sort) || (s.sort.startsWith('field:') && fields.some(f => `field:${f.id}` === s.sort))) ? s.sort : d.sort;
  return {
    layout: oneOf(s.layout, LAYOUTS, d.layout), sections: bool(s.sections, d.sections), showAuthor: bool(s.showAuthor, d.showAuthor), showDate: bool(s.showDate, d.showDate),
    sort, newPosts: oneOf(s.newPosts, ['start', 'end'], d.newPosts), reactions: oneOf(s.reactions, REACTIONS, d.reactions), comments: bool(s.comments, d.comments),
    moderation: oneOf(s.moderation, MODERATION, d.moderation), attribution: oneOf(s.attribution, ['names', 'anonymous'], d.attribution), guestAI: bool(s.guestAI, d.guestAI),
    canvasMode: oneOf(s.canvasMode, ['edit', 'interact'], d.canvasMode), participantsCanAdd: bool(s.participantsCanAdd, d.participantsCanAdd), groupWork: bool(s.groupWork, d.groupWork),
    aspect: kind === 'canvas' ? oneOf(s.aspect, ['16:9', '4:3', '1:1', 'a4'], '16:9') : null,
  };
}
export function normalizeField(f = {}) {
  const type = oneOf(f.type, FIELD_TYPES, 'text');
  const field = { id: safeId(f.id) || `f_${rid(8)}`, name: line(f.name, 80) || 'Champ', type, required: bool(f.required) };
  if (type === 'select' || type === 'multiselect') {
    const seen = new Set();
    field.options = (Array.isArray(f.options) ? f.options : []).slice(0, 60).map(o => ({ id: safeId(o?.id) || `o_${rid(6)}`, label: line(o?.label ?? o, 80), color: color(o?.color) }))
      .filter(o => o.label && !seen.has(o.id) && seen.add(o.id));
  }
  if (type === 'score') field.max = num(f.max, 1, 1000, 20);
  if (type === 'button') field.label = line(f.label, 60) || 'Ouvrir';
  if (f.placeholder) field.placeholder = line(f.placeholder, 120);
  return field;
}
export function normalizeSharing(s = {}) {
  const d = defaultSharing();
  const links = (Array.isArray(s.links) ? s.links : []).slice(0, 200).map(l => ({
    id: safeId(l?.id) || `l_${rid(8)}`, key: typeof l?.key === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(l.key) ? l.key : newKey(),
    role: oneOf(l?.role, ROLES, 'contributor'), label: line(l?.label, 120), createdAt: iso(l?.createdAt) || new Date().toISOString(),
    disabled: bool(l?.disabled), asOwner: bool(l?.asOwner) && l?.role === 'admin', invite: bool(l?.invite), group: safeId(l?.group),
  }));
  return { visibility: oneOf(s.visibility, VISIBILITY, d.visibility), defaultRole: oneOf(s.defaultRole, ROLES, d.defaultRole), publicRole: oneOf(s.publicRole, ['viewer', 'commenter', 'contributor', 'submitter'], d.publicRole), links, requireName: bool(s.requireName, d.requireName) };
}

export function normalizeAttachment(a = {}) {
  const kind = oneOf(a.kind, ATTACHMENT_KINDS, 'file');
  const out = { id: safeId(a.id) || `a_${rid(8)}`, kind, name: line(a.name, 200) };
  const file = mediaFile(a.file);
  if (file) out.file = file;
  if (a.mime) out.mime = line(a.mime, 100);
  if (num(a.size, 0) != null) out.size = num(a.size, 0);
  if (num(a.w, 1, 100000) != null) out.w = num(a.w, 1, 100000);
  if (num(a.h, 1, 100000) != null) out.h = num(a.h, 1, 100000);
  if (num(a.duration, 0, 86400) != null) out.duration = num(a.duration, 0, 86400);
  if (kind === 'link' || kind === 'embed') {
    out.url = httpUrl(a.url);
    if (!out.url) return null;
    if (a.embed && /^https:\/\/(www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|www\.youtube\.com\/embed\/)[A-Za-z0-9_?=&.-]+$/.test(a.embed)) out.embed = a.embed;
    if (a.preview && typeof a.preview === 'object') out.preview = { title: line(a.preview.title, 300), description: str(a.preview.description, 600), site: line(a.preview.site, 120), image: mediaFile(a.preview.image) };
  }
  if (kind === 'local') {
    if (typeof a.path !== 'string' || !a.path.startsWith('/')) return null;
    out.path = str(a.path, 2000);
  }
  if (['image', 'video', 'audio', 'file', 'drawing', 'svg'].includes(kind) && !out.file) return null;
  return out;
}

const cleanPoll = (p, existing) => {
  if (!p || typeof p !== 'object') return null;
  const options = (Array.isArray(p.options) ? p.options : []).slice(0, 20).map(o => ({ id: safeId(o?.id) || `o_${rid(6)}`, text: line(o?.text ?? o, 200) })).filter(o => o.text);
  if (options.length < 2) return null;
  const ids = new Set(options.map(o => o.id));
  const votes = {};
  for (const [uid, v] of Object.entries(existing?.votes || {})) { const kept = (Array.isArray(v) ? v : []).filter(x => ids.has(x)); if (kept.length) votes[uid] = kept; }
  return { question: line(p.question, 300), options, multiple: bool(p.multiple), closed: bool(p.closed), anonymous: bool(p.anonymous, true), votes };
};

export function cleanFieldValue(field, v) {
  if (v == null || v === '') return null;
  switch (field.type) {
    case 'text': case 'user': return str(v, 2000).trim() || null;
    case 'number': return num(v);
    case 'score': return num(v, 0, field.max || 20);
    case 'rating': return num(v, 0, 5) == null ? null : Math.round(num(v, 0, 5));
    case 'date': return dateOnly(v);
    case 'email': { const s = line(v, 200); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; }
    case 'phone': { const s = line(v, 40); return /^[0-9+().\s-]{3,40}$/.test(s) ? s : null; }
    case 'url': case 'button': return httpUrl(v) || null;
    case 'select': return (field.options || []).some(o => o.id === v) ? v : null;
    case 'multiselect': { const ids = new Set((field.options || []).map(o => o.id)); const list = (Array.isArray(v) ? v : [v]).filter(x => ids.has(x)); return list.length ? [...new Set(list)] : null; }
    case 'vote': return null; // les votes passent par /react
    default: return null;
  }
}

/** Entrée d’une publication (création ou modification) → champs autorisés et propres. */
export function cleanPostInput(input = {}, space, existing = null) {
  const out = {};
  if ('title' in input) out.title = line(input.title, LIMITS.title);
  if ('body' in input) out.body = str(input.body, LIMITS.body);
  if ('color' in input) out.color = color(input.color);
  if ('sectionId' in input) out.sectionId = space.sections.some(s => s.id === input.sectionId) ? input.sectionId : (space.sections[0]?.id || null);
  if ('attachments' in input) out.attachments = (Array.isArray(input.attachments) ? input.attachments : []).slice(0, 30).map(normalizeAttachment).filter(Boolean);
  if ('poll' in input) out.poll = input.poll ? cleanPoll(input.poll, existing?.poll) : null;
  if ('location' in input) {
    const l = input.location;
    out.location = l && num(l.lat, -90, 90) != null && num(l.lng, -180, 180) != null ? { lat: num(l.lat, -90, 90), lng: num(l.lng, -180, 180), label: line(l.label, 200) } : null;
  }
  if ('eventDate' in input) out.eventDate = dateOnly(input.eventDate);
  if ('publishAt' in input) { const t = iso(input.publishAt); out.publishAt = t && Date.parse(t) > Date.now() - 60_000 ? t : null; }
  if ('pos' in input) out.pos = input.pos && num(input.pos.x) != null && num(input.pos.y) != null ? { x: num(input.pos.x, -50000, 50000), y: num(input.pos.y, -50000, 50000) } : null;
  if ('order' in input && num(input.order) != null) out.order = num(input.order, -1e12, 1e12);
  if ('fields' in input && input.fields && typeof input.fields === 'object') {
    const ids = new Set(space.fields.map(f => f.id));
    const values = Object.fromEntries(Object.entries(existing?.fields || {}).filter(([k]) => ids.has(k)));
    for (const f of space.fields) if (f.id in input.fields) { const v = cleanFieldValue(f, input.fields[f.id]); if (v == null) delete values[f.id]; else values[f.id] = v; }
    out.fields = values;
  }
  return out;
}
export function missingRequired(space, post) {
  return space.fields.filter(f => f.required && f.type !== 'vote' && (post.fields?.[f.id] == null || post.fields[f.id] === '')).map(f => f.name);
}

// ---------- Objets de l’espace libre ----------
const cleanStyle = (s = {}) => {
  const out = {};
  for (const k of ['fill', 'stroke', 'color']) { const c = s[k] === 'none' ? 'none' : color(s[k]); if (c) out[k] = c; }
  for (const [k, min, max] of [['strokeWidth', 0, 60], ['fontSize', 6, 400], ['opacity', 0.05, 1], ['radius', 0, 400]]) { const n = num(s[k], min, max); if (n != null) out[k] = n; }
  if (s.dash) out.dash = oneOf(s.dash, ['solid', 'dashed', 'dotted'], 'solid');
  if (s.align) out.align = oneOf(s.align, ['left', 'center', 'right'], 'left');
  if (s.weight) out.weight = oneOf(s.weight, ['normal', 'bold'], 'normal');
  if (s.font) out.font = oneOf(s.font, FONTS, 'system');
  if (s.italic != null) out.italic = bool(s.italic);
  if (s.head) out.head = oneOf(s.head, ['none', 'end', 'both'], 'end');
  return out;
};
export function cleanObject(o = {}, card) {
  const type = oneOf(o.type, OBJECT_TYPES, null);
  if (!type) return null;
  const obj = {
    id: safeId(o.id) || `o_${rid(10)}`, type,
    x: num(o.x, -20000, 20000, 0), y: num(o.y, -20000, 20000, 0), w: num(o.w, 1, 20000, 160), h: num(o.h, 1, 20000, 100),
    rot: num(o.rot, -360, 360, 0), z: num(o.z, -1e9, 1e9, 0), locked: bool(o.locked), style: cleanStyle(o.style || {}),
  };
  if (o.author && typeof o.author === 'object') obj.author = { id: safeId(o.author.id, 'anon'), name: line(o.author.name, LIMITS.name) };
  if (['text', 'sticky', 'rect', 'ellipse', 'triangle', 'diamond', 'star', 'hexagon', 'link', 'frame', 'file'].includes(type) && o.text != null) obj.text = str(o.text, 20000);
  if (type === 'path' || type === 'line' || type === 'arrow') {
    obj.points = (Array.isArray(o.points) ? o.points : []).slice(0, 6000).map(p => [num(p?.[0], -20000, 20000, 0), num(p?.[1], -20000, 20000, 0)]);
    if (obj.points.length < 2 && type !== 'path') return null;
    if (o.highlighter) obj.highlighter = true;
  }
  if (type === 'line' || type === 'arrow') {
    for (const end of ['from', 'to']) if (o[end] && typeof o[end] === 'object' && safeId(o[end].id)) obj[end] = { id: o[end].id, side: oneOf(o[end].side, ['auto', 'top', 'right', 'bottom', 'left'], 'auto') };
  }
  if (['image', 'video', 'audio', 'file'].includes(type)) { obj.media = mediaFile(o.media); obj.name = line(o.name, 200); obj.mime = line(o.mime, 100); if (!obj.media) return null; }
  if (type === 'link' || type === 'embed') { obj.url = httpUrl(o.url); if (!obj.url) return null; if (o.embed && /^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//.test(o.embed)) obj.embed = o.embed; if (o.preview) obj.preview = { title: line(o.preview.title, 300), site: line(o.preview.site, 120), image: mediaFile(o.preview.image) }; }
  if (type === 'sticker') obj.emoji = line(o.emoji, 16) || '⭐️';
  if (type === 'poll') { obj.poll = cleanPoll(o.poll, card?.objects?.find(x => x.id === obj.id)?.poll); if (!obj.poll) return null; }
  if (o.action && typeof o.action === 'object') {
    if (o.action.type === 'card' && safeId(o.action.target)) obj.action = { type: 'card', target: o.action.target };
    else if (o.action.type === 'url' && httpUrl(o.action.target)) obj.action = { type: 'url', target: httpUrl(o.action.target) };
    else if (o.action.type === 'next' || o.action.type === 'prev') obj.action = { type: o.action.type };
  }
  return obj;
}

// ---------- Droits ----------
const RIGHTS = {
  viewer: ['view'],
  commenter: ['view', 'comment', 'react'],
  submitter: ['post'],
  contributor: ['view', 'comment', 'react', 'post'],
  moderator: ['view', 'comment', 'react', 'post', 'moderate'],
  admin: ['view', 'comment', 'react', 'post', 'moderate', 'edit'],
  owner: ['view', 'comment', 'react', 'post', 'moderate', 'edit', 'share', 'delete'],
};
export function can(viewer, right) {
  if (!viewer) return false;
  return (RIGHTS[viewer.isOwner ? 'owner' : viewer.role] || []).includes(right);
}
export function rights(viewer) {
  return Object.fromEntries(['view', 'comment', 'react', 'post', 'moderate', 'edit', 'share', 'delete'].map(r => [r, can(viewer, r)]));
}
/** Résout l’accès d’un invité à partir d’une clé de partage. */
export function resolveAccess(space, key) {
  if (!space || space.trashedAt) return null;
  const sh = space.sharing;
  if (sh.visibility === 'private') return null;
  if (key) {
    const link = sh.links.find(l => !l.disabled && l.key === key);
    if (link && (sh.visibility !== 'invited' || link.invite || link.role === 'admin' || link.asOwner)) return { role: link.role, linkId: link.id, asOwner: link.asOwner, label: link.label, invite: link.invite, group: link.group || null };
  }
  if (sh.visibility === 'public') return { role: sh.publicRole, linkId: 'public', asOwner: false, label: '' };
  return null;
}

export function postVisible(space, post, viewer) {
  if (can(viewer, 'moderate')) return true;
  if (post.author?.id && post.author.id === viewer.id) return true;
  if (!can(viewer, 'view')) return false; // déposants : seulement leurs envois
  if (post.status !== 'published') return false;
  if (post.publishAt && Date.parse(post.publishAt) > Date.now()) return false;
  return true;
}
export function cardVisible(space, card, viewer) {
  if (can(viewer, 'edit') || !space.settings.groupWork || !card.groupId) return true;
  return !!viewer.group && viewer.group === card.groupId;
}

function reactionSummary(post, viewer, space) {
  const r = post.reactions || {};
  const out = { mine: {} };
  const count = m => Object.keys(m || {}).length;
  out.like = count(r.like); if (r.like?.[viewer.id]) out.mine.like = true;
  const votes = Object.values(r.vote || {});
  out.up = votes.filter(v => v > 0).length; out.down = votes.filter(v => v < 0).length; if (r.vote?.[viewer.id]) out.mine.vote = r.vote[viewer.id];
  const stars = Object.values(r.stars || {});
  out.stars = stars.length ? Math.round(stars.reduce((a, b) => a + b, 0) / stars.length * 10) / 10 : null; out.starsCount = stars.length; if (r.stars?.[viewer.id]) out.mine.stars = r.stars[viewer.id];
  const grades = Object.values(r.grade || {});
  out.grade = grades.length ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length * 10) / 10 : null; out.gradeCount = grades.length; if (r.grade?.[viewer.id] != null) out.mine.grade = r.grade[viewer.id];
  out.emoji = {};
  for (const [e, who] of Object.entries(r.emoji || {})) { const n = count(who); if (n) out.emoji[e] = n; if (who?.[viewer.id]) (out.mine.emoji ||= []).push(e); }
  out.fieldVotes = {};
  for (const f of space.fields.filter(f => f.type === 'vote')) { const who = post.fieldVotes?.[f.id] || {}; out.fieldVotes[f.id] = count(who); if (who[viewer.id]) (out.mine.fieldVotes ||= []).push(f.id); }
  return out;
}
export function pollView(poll, viewer, full = false) {
  if (!poll) return null;
  const counts = Object.fromEntries(poll.options.map(o => [o.id, 0]));
  let voters = 0;
  for (const v of Object.values(poll.votes || {})) { voters++; for (const id of v) if (id in counts) counts[id]++; }
  const out = { question: poll.question, options: poll.options, multiple: poll.multiple, closed: poll.closed, anonymous: poll.anonymous, counts, voters, mine: poll.votes?.[viewer.id] || [] };
  if (full && !poll.anonymous) out.votes = poll.votes;
  return out;
}

/** Publication telle qu’un participant la voit (votes anonymisés, réactions agrégées). */
export function postForViewer(space, post, viewer) {
  const full = can(viewer, 'moderate');
  const anonymous = space.settings.attribution === 'anonymous' && !full && post.author?.id !== viewer.id;
  const out = { ...post, reactions: reactionSummary(post, viewer, space), poll: pollView(post.poll, viewer, full), mine: post.author?.id === viewer.id };
  delete out.fieldVotes;
  if (anonymous) out.author = { id: 'anon', name: 'Anonyme' };
  out.comments = (post.comments || []).map(c => ({ ...c, mine: c.author?.id === viewer.id, author: space.settings.attribution === 'anonymous' && !full && c.author?.id !== viewer.id ? { id: 'anon', name: 'Anonyme' } : c.author }));
  if (!full) delete out.flag;
  return out;
}
export function objectForViewer(obj, viewer) {
  return obj.type === 'poll' ? { ...obj, poll: pollView(obj.poll, viewer, can(viewer, 'moderate')) } : obj;
}
export function cardForViewer(card, viewer) {
  return { ...card, objects: card.objects.map(o => objectForViewer(o, viewer)) };
}
export function metaForViewer(space, viewer) {
  const { posts, cards, drafts, people, sharing, connections, ...meta } = space;
  const out = { ...meta, connections };
  out.sharing = can(viewer, 'share') ? sharing : { visibility: sharing.visibility, requireName: sharing.requireName };
  out.groups = space.groups;
  if (!can(viewer, 'edit')) { delete out.folder; delete out.favorite; delete out.isTemplate; }
  return out;
}
export function spaceForViewer(space, viewer) {
  const out = metaForViewer(space, viewer);
  out.posts = space.posts.filter(p => postVisible(space, p, viewer)).map(p => postForViewer(space, p, viewer));
  out.cards = space.cards.filter(c => cardVisible(space, c, viewer)).map(c => cardForViewer(c, viewer));
  out.pending = can(viewer, 'moderate') ? space.posts.filter(p => p.status === 'pending').length : 0;
  return out;
}
export function spaceSummary(space) {
  const visible = space.posts.filter(p => p.status === 'published');
  const thumbs = [];
  for (const p of visible) {
    const img = (p.attachments || []).find(a => a.kind === 'image' || a.kind === 'drawing' || a.kind === 'svg');
    thumbs.push({ title: p.title || (p.body || '').slice(0, 60), image: img?.file || null, color: p.color || null });
    if (thumbs.length >= 6) break;
  }
  return {
    id: space.id, kind: space.kind, title: space.title, description: space.description.slice(0, 200), icon: space.icon,
    createdAt: space.createdAt, updatedAt: space.updatedAt, openedAt: space.openedAt, folder: space.folder, favorite: space.favorite,
    archived: space.archived, trashedAt: space.trashedAt, isTemplate: space.isTemplate, theme: space.theme, layout: space.settings.layout,
    posts: visible.length, cards: space.cards.length, pending: space.posts.filter(p => p.status === 'pending').length,
    comments: space.posts.reduce((n, p) => n + (p.comments?.length || 0), 0), shared: space.sharing.visibility !== 'private', visibility: space.sharing.visibility,
    thumbs, objects: space.kind === 'canvas' ? (space.cards[0]?.objects || []).slice(0, 40) : [],
  };
}

/** Recharge un espace lu sur disque en complétant les champs manquants (versions futures, fichiers abîmés). */
export function normalizeSpace(raw) {
  if (!raw || typeof raw !== 'object' || !safeId(raw.id)) throw new Error('Espace invalide');
  const kind = oneOf(raw.kind, KINDS, 'board');
  const base = newSpace({ kind });
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).slice(0, 60).map(normalizeField);
  const s = {
    ...base, ...raw, kind, v: 1, rev: num(raw.rev, 0, Number.MAX_SAFE_INTEGER, 1),
    title: line(raw.title, LIMITS.title) || base.title, description: str(raw.description, 2000), icon: line(raw.icon, 16) || base.icon,
    createdAt: iso(raw.createdAt) || base.createdAt, updatedAt: iso(raw.updatedAt) || base.updatedAt, openedAt: iso(raw.openedAt) || iso(raw.updatedAt) || base.openedAt,
    owner: { name: line(raw.owner?.name, LIMITS.name) || 'Moi' }, folder: safeId(raw.folder), favorite: bool(raw.favorite), archived: bool(raw.archived),
    trashedAt: iso(raw.trashedAt), isTemplate: bool(raw.isTemplate), theme: normalizeTheme(raw.theme, kind), fields,
    settings: normalizeSettings(raw.settings, kind, fields), sharing: normalizeSharing(raw.sharing),
    sections: (Array.isArray(raw.sections) ? raw.sections : []).slice(0, 200).map(x => ({ id: safeId(x?.id) || `s_${rid(8)}`, title: line(x?.title, 120) || 'Section', color: color(x?.color) })),
    groups: (Array.isArray(raw.groups) ? raw.groups : []).slice(0, 60).map(g => ({ id: safeId(g?.id) || `g_${rid(6)}`, name: line(g?.name, 80) || 'Groupe', color: color(g?.color) || '#6366f1' })),
    drafts: raw.drafts && typeof raw.drafts === 'object' ? raw.drafts : {}, people: raw.people && typeof raw.people === 'object' ? raw.people : {},
  };
  if (kind === 'board' && !s.sections.length) s.sections = base.sections;
  const sectionIds = new Set(s.sections.map(x => x.id));
  s.posts = (Array.isArray(raw.posts) ? raw.posts : []).slice(0, LIMITS.posts).filter(p => p && safeId(p.id)).map((p, i) => {
    const clean = cleanPostInput(p, s, p);
    return {
      id: p.id, order: num(p.order, -1e12, 1e12, i), sectionId: sectionIds.has(p.sectionId) ? p.sectionId : (s.sections[0]?.id || null),
      author: { id: safeId(p.author?.id, 'owner'), name: line(p.author?.name, LIMITS.name) || 'Anonyme' },
      createdAt: iso(p.createdAt) || s.createdAt, updatedAt: iso(p.updatedAt) || iso(p.createdAt) || s.createdAt,
      title: clean.title || '', body: clean.body || '', color: clean.color || null, attachments: clean.attachments || [], poll: clean.poll || null,
      location: clean.location || null, eventDate: clean.eventDate || null, publishAt: iso(p.publishAt), pos: clean.pos || null, fields: clean.fields || {},
      status: oneOf(p.status, ['published', 'pending', 'rejected'], 'published'), flag: p.flag && typeof p.flag === 'object' ? { reason: line(p.flag.reason, 200) } : undefined,
      reactions: p.reactions && typeof p.reactions === 'object' ? p.reactions : {}, fieldVotes: p.fieldVotes && typeof p.fieldVotes === 'object' ? p.fieldVotes : {},
      comments: (Array.isArray(p.comments) ? p.comments : []).slice(0, LIMITS.comments).filter(c => c && safeId(c.id)).map(c => ({
        id: c.id, author: { id: safeId(c.author?.id, 'anon'), name: line(c.author?.name, LIMITS.name) || 'Anonyme' }, createdAt: iso(c.createdAt) || s.createdAt,
        body: str(c.body, LIMITS.comment), attachment: c.attachment ? normalizeAttachment(c.attachment) : null,
      })),
    };
  });
  const postIds = new Set(s.posts.map(p => p.id));
  s.connections = (Array.isArray(raw.connections) ? raw.connections : []).filter(c => c && postIds.has(c.from) && postIds.has(c.to)).map(c => ({ id: safeId(c.id) || `l_${rid(8)}`, from: c.from, to: c.to, label: line(c.label, 120) }));
  s.cards = (Array.isArray(raw.cards) ? raw.cards : []).slice(0, LIMITS.cards).filter(c => c && safeId(c.id)).map(c => {
    const card = { id: c.id, title: line(c.title, 120) || 'Carte', groupId: safeId(c.groupId), background: color(c.background), objects: [] };
    card.objects = (Array.isArray(c.objects) ? c.objects : []).slice(0, LIMITS.objects).map(o => cleanObject(o, c)).filter(Boolean);
    return card;
  });
  if (kind === 'canvas' && !s.cards.length) s.cards = base.cards;
  return s;
}

// ---------- Modération automatique ----------
const BAD_WORDS = [
  'connard', 'connasse', 'salope', 'pute', 'enculé', 'encule', 'fdp', 'ntm', 'nique ta', 'pédé', 'tapette', 'bougnoule', 'youpin', 'couilles', 'branleur', 'ta gueule', 'suicide toi',
  'fuck', 'fucking', 'motherfucker', 'bitch', 'cunt', 'pussy', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'kill yourself', 'kys', 'porn', 'porno', 'nudes',
];
const BAD_RE = new RegExp(`(^|[^a-zà-ÿ0-9])(${BAD_WORDS.map(w => w.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^a-z0-9])`, 'i');
export function moderationFlag(text) {
  const t = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const m = t.match(BAD_RE);
  return m ? { reason: `Mot signalé : « ${m[2]} »` } : null;
}

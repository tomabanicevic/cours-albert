// Exports des espaces : CSV, Excel (.xlsx), archive des fichiers (.zip) et sauvegarde complète (.cae).
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

// ---------- ZIP ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf, prev = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf, prev) >>> 0;
  let c = (prev ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(date = new Date()) {
  const d = new Date(date);
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    date: (((Math.max(1980, d.getFullYear()) - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}
/** Écrit une archive ZIP dans un flux (fichiers lus deux fois : CRC puis contenu, sans tout charger en mémoire). */
export class ZipWriter {
  constructor(out) { this.out = out; this.entries = []; this.offset = 0; this.names = new Set(); }
  write(buf) {
    this.offset += buf.length;
    return new Promise((resolve, reject) => {
      if (this.out.destroyed) return reject(new Error('Téléchargement interrompu.'));
      this.out.write(buf) ? resolve() : this.out.once('drain', resolve);
    });
  }
  unique(name) {
    let clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(s => s.replace(/[\x00-\x1f:*?"<>|]/g, '_').replace(/^\.+$/, '_').slice(0, 120) || '_').join('/');
    if (!this.names.has(clean)) { this.names.add(clean); return clean; }
    const ext = path.posix.extname(clean), stem = clean.slice(0, clean.length - ext.length);
    for (let i = 2; ; i++) { const c = `${stem} (${i})${ext}`; if (!this.names.has(c)) { this.names.add(c); return c; } }
  }
  async header(name, { crc, csize, size, method, date }) {
    const nameBuf = Buffer.from(name, 'utf8');
    const { time, date: d } = dosTime(date);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(d, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(csize, 18); h.writeUInt32LE(size, 22);
    h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    const offset = this.offset;
    await this.write(Buffer.concat([h, nameBuf]));
    this.entries.push({ nameBuf, crc, csize, size, method, time, date: d, offset });
  }
  async addBuffer(name, data, { date, deflate = true } = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const packed = deflate ? zlib.deflateRawSync(buf, { level: 6 }) : buf;
    const useDeflate = deflate && packed.length < buf.length;
    await this.header(this.unique(name), { crc: crc32(buf), csize: useDeflate ? packed.length : buf.length, size: buf.length, method: useDeflate ? 8 : 0, date });
    await this.write(useDeflate ? packed : buf);
  }
  async addFile(name, file, { date } = {}) {
    const st = await fs.stat(file);
    if (st.size >= 0xffffffff) throw new Error(`${path.basename(file)} dépasse 4 Go.`);
    let crc = 0;
    for await (const chunk of fss.createReadStream(file)) crc = crc32(chunk, crc);
    await this.header(this.unique(name), { crc, csize: st.size, size: st.size, method: 0, date: date || st.mtime });
    for await (const chunk of fss.createReadStream(file)) await this.write(chunk);
  }
  async finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(e.offset, 42);
      await this.write(Buffer.concat([c, e.nameBuf]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12); end.writeUInt32LE(start, 16);
    await this.write(end);
  }
}
/** Lit le répertoire central d’une archive ZIP (méthodes stockée et deflate). */
export async function readZip(file) {
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Archive ZIP invalide.');
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    for (let i = 0, p = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive ZIP abîmée.');
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), local = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nlen);
      entries.push({ name, method, csize, size: usize, local });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  } finally { await fh.close(); }
}
async function dataOffset(file, entry) {
  const fh = await fs.open(file, 'r');
  try { const h = Buffer.alloc(30); await fh.read(h, 0, 30, entry.local); return entry.local + 30 + h.readUInt16LE(26) + h.readUInt16LE(28); }
  finally { await fh.close(); }
}
export async function zipEntryBuffer(file, entry, max = 64 * 1024 ** 2) {
  if (entry.size > max) throw new Error(`${entry.name} est trop volumineux.`);
  const start = await dataOffset(file, entry);
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(entry.csize);
    await fh.read(buf, 0, entry.csize, start);
    if (entry.method === 0) return buf;
    if (entry.method === 8) return zlib.inflateRawSync(buf);
    throw new Error(`Compression non prise en charge (${entry.method}).`);
  } finally { await fh.close(); }
}
export async function extractZipEntry(file, entry, dest) {
  const start = await dataOffset(file, entry);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`Compression non prise en charge (${entry.method}).`);
  const input = entry.csize ? fss.createReadStream(file, { start, end: start + entry.csize - 1 }) : fss.createReadStream(file, { start, end: start - 1 });
  await pipeline(input, ...(entry.method === 8 ? [zlib.createInflateRaw()] : []), fss.createWriteStream(dest));
}

// ---------- Tableaux ----------
const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const STATUS = { published: 'Publiée', pending: 'En attente de validation', rejected: 'Refusée' };
export function fieldText(field, value) {
  if (value == null) return '';
  if (field.type === 'select') return field.options?.find(o => o.id === value)?.label || '';
  if (field.type === 'multiselect') return (value || []).map(id => field.options?.find(o => o.id === id)?.label).filter(Boolean).join(', ');
  if (field.type === 'rating') return '★'.repeat(value) + '☆'.repeat(Math.max(0, 5 - value));
  if (field.type === 'score') return `${value}/${field.max || 20}`;
  return String(value);
}
const plainBody = s => String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
const personName = (space, id, fallback) => id === 'owner' ? space.owner.name : space.people?.[id]?.name || fallback || id;

/** Feuilles de calcul d’un espace (une liste de lignes par feuille). */
export function spaceSheets(space, { mediaUrl = f => f } = {}) {
  const sections = new Map(space.sections.map(s => [s.id, s.title]));
  const sheets = [];
  if (space.kind === 'board') {
    const posts = [...space.posts].sort((a, b) => (space.sections.findIndex(s => s.id === a.sectionId) - space.sections.findIndex(s => s.id === b.sectionId)) || a.order - b.order);
    const head = ['Section', 'Titre', 'Texte', 'Auteur', 'Créée le', 'Modifiée le', 'Statut', 'Programmée pour', 'Date', 'Lieu', 'Latitude', 'Longitude',
      ...space.fields.map(f => f.name), 'Pièces jointes', 'Sondage', 'J’aime', 'Votes pour', 'Votes contre', 'Note moyenne (étoiles)', 'Nombre de notes', 'Note moyenne', 'Réactions', 'Commentaires', 'Identifiant'];
    const rows = posts.map(p => {
      const r = p.reactions || {};
      const votes = Object.values(r.vote || {});
      const stars = Object.values(r.stars || {});
      const grades = Object.values(r.grade || {});
      const avg = list => list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length * 100) / 100 : '';
      return [
        sections.get(p.sectionId) || '', p.title, plainBody(p.body), p.author?.name || '', fmtDate(p.createdAt), fmtDate(p.updatedAt), STATUS[p.status] || p.status,
        p.publishAt ? fmtDate(p.publishAt) : '', p.eventDate || '', p.location?.label || '', p.location ? p.location.lat : '', p.location ? p.location.lng : '',
        ...space.fields.map(f => f.type === 'vote' ? Object.keys(p.fieldVotes?.[f.id] || {}).length : (f.type === 'number' || f.type === 'score') && p.fields?.[f.id] != null ? p.fields[f.id] : fieldText(f, p.fields?.[f.id])),
        (p.attachments || []).map(a => a.kind === 'link' || a.kind === 'embed' ? a.url : a.kind === 'local' ? a.path : `${a.name || a.file} (${mediaUrl(a.file)})`).join('\n'),
        p.poll ? p.poll.question : '', Object.keys(r.like || {}).length, votes.filter(v => v > 0).length, votes.filter(v => v < 0).length, avg(stars), stars.length, avg(grades),
        Object.entries(r.emoji || {}).map(([e, who]) => `${e} ${Object.keys(who).length}`).join(' '), (p.comments || []).length, p.id,
      ];
    });
    sheets.push({ name: 'Publications', head, rows, widths: [18, 30, 60, 18, 17, 17, 14, 17, 12, 20, 10, 10, ...space.fields.map(() => 18), 40, 30, 8, 8, 8, 10, 10, 10, 16, 12, 14] });
    sheets.push({
      name: 'Commentaires', head: ['Publication', 'Auteur', 'Date', 'Commentaire', 'Pièce jointe', 'Identifiant de la publication'],
      rows: posts.flatMap(p => (p.comments || []).map(c => [p.title || plainBody(p.body).slice(0, 60), c.author?.name || '', fmtDate(c.createdAt), c.body, c.attachment ? (c.attachment.name || c.attachment.file) : '', p.id])),
      widths: [30, 18, 17, 60, 24, 16],
    });
    const reactions = [];
    for (const p of posts) {
      const title = p.title || plainBody(p.body).slice(0, 60);
      const r = p.reactions || {};
      for (const id of Object.keys(r.like || {})) reactions.push([title, 'J’aime', personName(space, id), 1]);
      for (const [id, v] of Object.entries(r.vote || {})) reactions.push([title, 'Vote', personName(space, id), v]);
      for (const [id, v] of Object.entries(r.stars || {})) reactions.push([title, 'Étoiles', personName(space, id), v]);
      for (const [id, v] of Object.entries(r.grade || {})) reactions.push([title, 'Note', personName(space, id), v]);
      for (const [e, who] of Object.entries(r.emoji || {})) for (const id of Object.keys(who)) reactions.push([title, `Émoji ${e}`, personName(space, id), 1]);
      for (const f of space.fields.filter(f => f.type === 'vote')) for (const id of Object.keys(p.fieldVotes?.[f.id] || {})) reactions.push([title, f.name, personName(space, id), 1]);
    }
    sheets.push({ name: 'Réactions', head: ['Publication', 'Type', 'Participant', 'Valeur'], rows: reactions, widths: [30, 14, 22, 8] });
    const polls = [];
    for (const p of posts) if (p.poll) for (const o of p.poll.options) polls.push([p.title || p.poll.question, p.poll.question, o.text, Object.values(p.poll.votes || {}).filter(v => v.includes(o.id)).length]);
    if (polls.length) sheets.push({ name: 'Sondages', head: ['Publication', 'Question', 'Réponse', 'Votes'], rows: polls, widths: [30, 40, 30, 8] });
  } else {
    sheets.push({ name: 'Cartes', head: ['N°', 'Carte', 'Groupe', 'Objets'], rows: space.cards.map((c, i) => [i + 1, c.title, space.groups.find(g => g.id === c.groupId)?.name || '', c.objects.length]), widths: [5, 30, 18, 8] });
    const typeNames = { text: 'Texte', sticky: 'Note', rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', diamond: 'Losange', star: 'Étoile', hexagon: 'Hexagone', line: 'Ligne', arrow: 'Flèche', path: 'Dessin', image: 'Image', video: 'Vidéo', audio: 'Audio', file: 'Fichier', link: 'Lien', sticker: 'Autocollant', poll: 'Sondage', embed: 'Média web', frame: 'Cadre' };
    sheets.push({
      name: 'Objets', head: ['Carte', 'Type', 'Texte', 'Auteur', 'Lien interactif', 'X', 'Y', 'Largeur', 'Hauteur'],
      rows: space.cards.flatMap(c => c.objects.map(o => [c.title, typeNames[o.type] || o.type, o.text || o.name || o.url || o.emoji || o.poll?.question || '', o.author?.name || '', o.action ? (o.action.type === 'card' ? `→ ${space.cards.find(k => k.id === o.action.target)?.title || 'carte'}` : o.action.target || o.action.type) : '', Math.round(o.x), Math.round(o.y), Math.round(o.w), Math.round(o.h)])),
      widths: [24, 12, 50, 18, 24, 8, 8, 8, 8],
    });
    const polls = [];
    for (const c of space.cards) for (const o of c.objects) if (o.type === 'poll') for (const opt of o.poll.options) polls.push([c.title, o.poll.question, opt.text, Object.values(o.poll.votes || {}).filter(v => v.includes(opt.id)).length]);
    if (polls.length) sheets.push({ name: 'Sondages', head: ['Carte', 'Question', 'Réponse', 'Votes'], rows: polls, widths: [24, 40, 30, 8] });
  }
  const people = Object.entries(space.people || {});
  if (people.length) sheets.push({ name: 'Participants', head: ['Nom', 'Rôle', 'Groupe', 'Première visite', 'Dernière visite'], rows: people.map(([, p]) => [p.name, p.role || '', space.groups.find(g => g.id === p.group)?.name || '', fmtDate(p.firstSeen), fmtDate(p.lastSeen)]), widths: [24, 14, 16, 17, 17] });
  sheets.push({
    name: 'Informations', head: ['Information', 'Valeur'], widths: [26, 70],
    rows: [['Titre', space.title], ['Description', space.description], ['Type', space.kind === 'board' ? 'Tableau' : 'Espace libre'], ['Propriétaire', space.owner.name],
      ['Créé le', fmtDate(space.createdAt)], ['Modifié le', fmtDate(space.updatedAt)], ['Publications', space.posts.length], ['Cartes', space.cards.length],
      ['Sections', space.sections.map(s => s.title).join(', ')], ['Champs', space.fields.map(f => f.name).join(', ')], ['Exporté le', fmtDate(new Date().toISOString())], ['Application', 'Cours Albert']],
  });
  return sheets;
}

export function toCSV(sheet) {
  const cell = v => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [sheet.head, ...sheet.rows].map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const xml = s => String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXML(sheet) {
  const rows = [sheet.head, ...sheet.rows];
  const width = Math.max(1, ...rows.map(r => r.length));
  const cols = `<cols>${Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${sheet.widths?.[i] || 16}" customWidth="1"/>`).join('')}</cols>`;
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`, style = ri === 0 ? ' s="1"' : ' s="2"';
    if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
    if (v == null || v === '') return `<c r="${ref}"${style}/>`;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(String(v).slice(0, 32000))}</t></is></c>`;
  }).join('')}</row>`).join('');
  const last = `${colName(width - 1)}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
}
export async function writeXLSX(out, sheets, title = 'Export') {
  const zip = new ZipWriter(out);
  const names = [];
  for (const s of sheets) {
    let n = String(s.name).replace(/[\[\]:*?/\\]/g, ' ').slice(0, 31) || 'Feuille';
    while (names.includes(n)) n = `${n.slice(0, 28)} ${names.length}`;
    names.push(n);
  }
  await zip.addBuffer('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  await zip.addBuffer('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  await zip.addBuffer('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Cours Albert</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
  await zip.addBuffer('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Cours Albert</Application></Properties>`);
  await zip.addBuffer('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  await zip.addBuffer('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  await zip.addBuffer('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>`);
  for (let i = 0; i < sheets.length; i++) await zip.addBuffer(`xl/worksheets/sheet${i + 1}.xml`, sheetXML(sheets[i]));
  await zip.finish();
}

const safeTitle = s => String(s || 'Sans titre').replace(/[\x00-\x1f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sans titre';
/** Archive des fichiers joints, rangés par section puis par publication. */
export async function writeFilesZip(out, space, mediaDir, readme = '') {
  const zip = new ZipWriter(out);
  let count = 0;
  const add = async (folder, a) => {
    if (a.kind === 'local' && a.path) { await zip.addFile(`${folder}/${path.basename(a.path)}`, a.path).then(() => count++).catch(() => {}); return; }
    if (!a.file) return;
    const ext = path.extname(a.file);
    let name = safeTitle(a.name || a.file);
    if (ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
    await zip.addFile(`${folder}/${name}`, path.join(mediaDir, a.file)).then(() => count++).catch(() => {});
  };
  if (space.kind === 'board') {
    const sections = new Map(space.sections.map((s, i) => [s.id, `${String(i + 1).padStart(2, '0')} ${safeTitle(s.title)}`]));
    for (const p of [...space.posts].sort((a, b) => a.order - b.order)) {
      const folder = `${space.sections.length > 1 ? sections.get(p.sectionId) + '/' : ''}${safeTitle(p.title || p.body?.slice(0, 40) || p.id)}`;
      for (const a of p.attachments || []) await add(folder, a);
      for (const c of p.comments || []) if (c.attachment) await add(`${folder}/Commentaires`, c.attachment);
    }
  } else {
    for (const [i, c] of space.cards.entries()) for (const o of c.objects) if (o.media) await add(`${String(i + 1).padStart(2, '0')} ${safeTitle(c.title)}`, { file: o.media, name: o.name || o.media });
  }
  await zip.addBuffer('Lisez-moi.txt', readme || `${space.title}\n\n${count} fichier(s) exporté(s) par Cours Albert le ${fmtDate(new Date().toISOString())}.\n`);
  await zip.finish();
  return count;
}

/** Sauvegarde complète d’un espace (données + fichiers), réimportable dans Cours Albert. */
export async function writeBackup(out, space, mediaDir) {
  const zip = new ZipWriter(out);
  const copy = JSON.parse(JSON.stringify(space));
  copy.drafts = {};
  copy.sharing = { visibility: 'private', links: [] };
  await zip.addBuffer('espace.json', JSON.stringify(copy, null, 1));
  for (const name of await fs.readdir(mediaDir).catch(() => [])) {
    if (name.startsWith('.') || name.endsWith('.part')) continue;
    await zip.addFile(`media/${name}`, path.join(mediaDir, name));
  }
  await zip.addBuffer('Lisez-moi.txt', `Sauvegarde de l’espace « ${space.title} » créée par Cours Albert.\nPour la rouvrir : Cours Albert › Accueil › Importer.\n`);
  await zip.finish();
}

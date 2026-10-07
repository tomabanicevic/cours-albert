// Aperçus miniatures des fichiers (PDF, Word, PowerPoint, Keynote, images…) grâce à Quick Look de macOS (qlmanage).
// Mis en cache dans le dossier de données ; sans macOS (tests, développement), aucun aperçu n’est produit.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const QLMANAGE = '/usr/bin/qlmanage';
// Notes et fichiers texte : aperçu dessiné par l’app (fond clair, titre et premières lignes) au lieu de Quick Look, qui les rend sombres.
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.text', '.csv', '.tsv', '.json', '.log']);
const ACCENT = { '.csv': '#1d9a5b', '.tsv': '#1d9a5b', '.json': '#475569', '.log': '#475569' };
const xml = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/** Aperçu SVG d’un fichier texte : titre (premier titre Markdown ou nom du fichier) et premières lignes, sans mise en forme. */
export function textPreviewSVG(name, raw) {
  const ext = path.extname(name).toLowerCase();
  const md = ext === '.md' || ext === '.markdown';
  const mono = !md && ext !== '.txt' && ext !== '.text';
  let text = String(raw || '').replace(/\r\n?/g, '\n');
  if (md) text = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '').replace(/```[^\n]*\n/g, '');
  let title = '';
  const body = [];
  for (let line of text.split('\n')) {
    line = line.replace(/\t/g, '  ').trimEnd();
    if (md) {
      const h = line.match(/^#{1,6}\s+(.*)/);
      if (h && !title && !body.some(l => l.trim())) { title = h[1].replace(/[*_`]/g, ''); continue; }
      line = line.replace(/^#{1,6}\s+/, '').replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, a, b) => b || a)
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|\*|_|`|~~)/g, '').replace(/^>\s?(\[![^\]]+\][+-]?\s*)?/, '▏ ').replace(/^(\s*)[-*+]\s+\[( |x)\]\s+/i, (m, sp, x) => `${sp}${x.trim() ? '☑' : '☐'} `).replace(/^(\s*)[-*+]\s+/, '$1• ').replace(/<[^>]+>/g, '').replace(/^\|?\s*:?-{3,}.*$/, '');
    }
    if (!line.trim() && (!body.length || !body[body.length - 1].trim())) continue;
    body.push(line);
    if (body.length > 60) break;
  }
  if (!title) title = path.basename(name, ext);
  const W = mono ? 52 : 50, rows = [];
  for (const l of body) {
    if (!l.trim()) { rows.push(''); continue; }
    let s = l;
    while (s.length > W && rows.length < 30) { let cut = s.lastIndexOf(' ', W); if (cut < 24) cut = W; rows.push(s.slice(0, cut)); s = s.slice(cut).trimStart(); }
    rows.push(s);
    if (rows.length >= 30) break;
  }
  const accent = ACCENT[ext] || '#7c5cf0';
  const top = 82, lh = 18, max = Math.floor((360 - top) / lh);
  const font = mono ? "ui-monospace,'SF Mono',Menlo,monospace" : "-apple-system,'SF Pro Text','Helvetica Neue',Arial,sans-serif";
  const lines = rows.slice(0, max).map((l, i) => `<text x="30" y="${top + i * lh}">${xml(l.slice(0, 70))}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#ffffff"/><rect width="480" height="5" fill="${accent}"/>`
    + `<text x="30" y="48" font-family="-apple-system,'SF Pro Display','Helvetica Neue',Arial,sans-serif" font-size="23" font-weight="700" fill="#111827">${xml(title.length > 32 ? `${title.slice(0, 31)}…` : title)}</text>`
    + `<rect x="30" y="60" width="46" height="3" rx="1.5" fill="${accent}"/>`
    + `<g font-family="${font}" font-size="${mono ? 12.5 : 14}" fill="#4b5563">${lines}</g></svg>`;
}
const MAX_CACHE_FILES = 3000;

export class Thumbs {
  constructor({ dir, log = () => {}, maker = null }) {
    this.dir = dir;
    this.log = log;
    this.maker = maker;          // fonction de remplacement (tests) : (file, out, size) => Promise<boolean>
    this.pending = new Map();
    this.failed = new Map();
    this.running = 0;
    this.waiting = [];
  }
  available() { return !!this.maker || process.platform === 'darwin'; }
  async get(file, size = 480) {
    const st = await fs.stat(file).catch(() => null);
    const text = TEXT_EXT.has(path.extname(file).toLowerCase());
    if (!st || !st.isFile() || (!text && !this.available())) return null;
    const px = [240, 480, 960].reduce((a, b) => Math.abs(b - size) < Math.abs(a - size) ? b : a);
    const key = crypto.createHash('sha256').update(`${file}|${st.mtimeMs}|${st.size}|${text ? 'texte-1' : px}`).digest('hex').slice(0, 32);
    const out = path.join(this.dir, `${key}.${text ? 'svg' : 'png'}`);
    if (await fs.stat(out).then(() => true, () => false)) return out;
    const failedAt = this.failed.get(key);
    if (failedAt && Date.now() - failedAt < 10 * 60_000) return null;
    if (this.pending.has(key)) return this.pending.get(key);
    const job = (text ? this.makeText(file, out) : this.limit(() => this.make(file, out, px))).then(ok => {
      this.pending.delete(key);
      if (!ok) { this.failed.set(key, Date.now()); return null; }
      return out;
    });
    this.pending.set(key, job);
    return job;
  }
  async limit(fn) {
    if (this.running >= 2) await new Promise(resolve => this.waiting.push(resolve));
    this.running++;
    try { return await fn(); }
    finally { this.running--; this.waiting.shift()?.(); }
  }
  async makeText(file, out) {
    try {
      const fh = await fs.open(file, 'r');
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0).finally(() => fh.close());
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(out, textPreviewSVG(path.basename(file), buf.subarray(0, bytesRead).toString('utf8').replace(/\uFFFD+$/, '')));
      return true;
    } catch (e) {
      this.log(`Aperçu texte impossible pour ${path.basename(file)} : ${e.message}`);
      return false;
    }
  }
  async make(file, out, size) {
    await fs.mkdir(this.dir, { recursive: true });
    if (this.maker) return this.maker(file, out, size);
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-apercu-'));
    try {
      const ok = await new Promise(resolve => execFile(QLMANAGE, ['-t', '-s', String(size), '-o', tmp, file], { timeout: 25_000 }, e => resolve(!e)));
      const produced = (await fs.readdir(tmp).catch(() => [])).find(n => n.toLowerCase().endsWith('.png'));
      if (!ok || !produced) return false;
      await fs.copyFile(path.join(tmp, produced), out);
      return true;
    } catch (e) {
      this.log(`Aperçu impossible pour ${path.basename(file)} : ${e.message}`);
      return false;
    } finally {
      await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }
  /** Garde le cache sous MAX_CACHE_FILES aperçus (les plus anciens partent en premier). */
  async prune() {
    const names = (await fs.readdir(this.dir).catch(() => [])).filter(n => /\.(png|svg)$/.test(n));
    if (names.length <= MAX_CACHE_FILES) return;
    const stats = await Promise.all(names.map(async n => ({ n, t: (await fs.stat(path.join(this.dir, n)).catch(() => null))?.mtimeMs || 0 })));
    for (const { n } of stats.sort((a, b) => a.t - b.t).slice(0, names.length - MAX_CACHE_FILES)) await fs.unlink(path.join(this.dir, n)).catch(() => {});
  }
}

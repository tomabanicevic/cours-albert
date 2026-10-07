// Assistant IA de Cours Albert : range les cours dans les fichiers (vault Obsidian, notes) et dans les espaces de travail.
// Utilise la clé API enregistrée dans Réglages (ia.json, partagée avec le tri par IA) : Claude ou une API compatible OpenAI (voir llm.mjs).
// Aucun outil de suppression. Chaque changement est inscrit au journal (Assistant/journal.json) et peut être annulé.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { mimeOf } from './store.mjs';

let sdk = null;
const loadSDK = async () => (sdk ??= (await import('@anthropic-ai/sdk')).default);

const MAX_STEPS = 40;
const MAX_RESULT = 20_000;
const MAX_HISTORY_CHARS = 350_000;
const READ_EXT = new Set(['md', 'markdown', 'txt', 'text', 'csv', 'tsv', 'json', 'canvas', 'yaml', 'yml', 'tex', 'bib', 'py', 'r', 'sql', 'html', 'htm', 'xml', 'ipynb', 'ics']);
const WRITE_EXT = new Set(['md', 'markdown', 'txt']);
const OFFICE_EXT = new Set(['docx', 'doc', 'rtf', 'odt', 'pages']);
const CODE_MARKERS = ['package.json', '.git', 'build.sh', 'Package.swift', 'Cargo.toml', 'pyproject.toml'];
const SKIP_DIRS = new Set(['node_modules', '__pycache__']);

const err = (message, status = 400) => Object.assign(new Error(message), { status });
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} caractères coupés)` : s; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const exists = p => fs.access(p).then(() => true, () => false);
const rid = (n = 10) => crypto.randomBytes(n * 2).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, n);
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const within = (f, r) => f === r || f.startsWith(r + path.sep);
const extOf = f => path.extname(f).slice(1).toLowerCase();
const sizeLabel = n => n < 1024 ? `${n} o` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} Ko` : `${(n / 1024 ** 2).toFixed(1)} Mo`;
const byName = (a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

// ---------------------------------------------------------------- outils proposés au modèle
const S = { type: 'string' };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const TOOLS = [
  { name: 'lister_dossier', description: 'Liste le contenu d’un dossier (sous-dossiers puis fichiers, avec leur taille). Les dossiers en lecture seule sont signalés.',
    input_schema: obj({ chemin: { ...S, description: 'Ex. « vault », « vault/01 Maths », « cours/Cours/S1 ».' }, profondeur: { type: 'integer', minimum: 1, maximum: 3, description: '1 par défaut.' } }, ['chemin']) },
  { name: 'lire_fichier', description: 'Lit un fichier texte (Markdown, CSV, JSON…) ou un document Word/RTF. Pour un PDF ou une image, renvoie seulement le nom, la taille et la date.',
    input_schema: obj({ chemin: S, debut: { type: 'integer', minimum: 0, description: 'Caractère de départ (pour les longs fichiers).' }, longueur: { type: 'integer', minimum: 200, maximum: 40000 } }, ['chemin']) },
  { name: 'chercher', description: 'Cherche des fichiers par nom et, pour les notes, par contenu. Insensible aux accents et à la casse.',
    input_schema: obj({ requete: S, dans: { ...S, description: 'Dossier où chercher (par défaut tout le vault).' }, contenu: { type: 'boolean', description: 'Chercher aussi dans le texte des notes (vrai par défaut).' } }, ['requete']) },
  { name: 'lister_cours', description: 'Liste les cours connus de l’app (code, titre, semestre, enseignant, dossier des supports) et, s’il existe, le dossier du cours dans le vault.', input_schema: obj({}) },
  { name: 'creer_dossier', description: 'Crée un dossier (et ses parents) dans le vault.', input_schema: obj({ chemin: S }, ['chemin']) },
  { name: 'deplacer', description: 'Déplace ou renomme un fichier ou un dossier du vault. Ne remplace jamais un fichier existant. Si la destination est un dossier existant, l’élément va dedans. Les liens [[…]] d’Obsidian vers les notes déplacées sont mis à jour.',
    input_schema: obj({ source: S, destination: S, mettre_a_jour_liens: { type: 'boolean', description: 'Vrai par défaut.' } }, ['source', 'destination']) },
  { name: 'ecrire_note', description: 'Écrit une note Markdown (.md) ou texte (.txt) dans le vault. Modes : « creer » (refuse si la note existe), « ajouter » (à la fin d’une note), « remplacer » (réécrit une note existante ; à éviter sauf demande explicite).',
    input_schema: obj({ chemin: S, contenu: S, mode: { type: 'string', enum: ['creer', 'ajouter', 'remplacer'] } }, ['chemin', 'contenu']) },
  { name: 'lister_espaces', description: 'Liste les espaces de l’app (tableaux et espaces libres) avec leur identifiant et leur dossier de l’Accueil, ainsi que les dossiers de l’Accueil existants.', input_schema: obj({}) },
  { name: 'creer_dossier_accueil', description: 'Crée un dossier de l’Accueil : une pastille de couleur qui classe les espaces sur l’écran d’accueil de l’app (par exemple un dossier par matière). Ce n’est pas un dossier de fichiers. Un dossier du même nom est réutilisé.',
    input_schema: obj({ nom: S, couleur: { ...S, description: 'Facultatif : couleur hexadécimale, par exemple #22c55e.' } }, ['nom']) },
  { name: 'ranger_espaces', description: 'Range des espaces dans un dossier de l’Accueil (nom ou identifiant ; créé s’il n’existe pas). Avec un dossier vide (""), les espaces sortent de leur dossier.',
    input_schema: obj({ dossier: S, espaces: { type: 'array', items: S, description: 'Identifiants des espaces (voir lister_espaces).' } }, ['dossier', 'espaces']) },
  { name: 'renommer_dossier_accueil', description: 'Renomme un dossier de l’Accueil.', input_schema: obj({ dossier: { ...S, description: 'Nom ou identifiant actuel.' }, nouveau_nom: S }, ['dossier', 'nouveau_nom']) },
  { name: 'lire_espace', description: 'Montre un espace : sections, publications (identifiant, titre, début du texte, fichiers joints).', input_schema: obj({ espace: { ...S, description: 'Identifiant de l’espace.' } }, ['espace']) },
  { name: 'creer_espace', description: 'Crée un tableau (espace de travail) avec des sections, par exemple un tableau par cours avec « Cours », « TD », « Corrigés », « Examens ».',
    input_schema: obj({ titre: S, description: S, icone: { ...S, description: 'Un émoji.' }, sections: { type: 'array', items: S } }, ['titre']) },
  { name: 'publier', description: 'Ajoute une publication dans un tableau : titre, texte Markdown, fichiers joints (chemins du vault ou de la bibliothèque, ils restent à leur place) et lien web facultatif. Une section absente est créée.',
    input_schema: obj({ espace: S, titre: S, texte: S, section: { ...S, description: 'Titre ou identifiant de la section.' }, fichiers: { type: 'array', items: S }, lien: S }, ['espace', 'titre']) },
  { name: 'organiser_espace', description: 'Range un tableau : liste ordonnée des sections (titre) et, pour chacune, les identifiants de publications dans l’ordre voulu. Une section existante de même titre est réutilisée ; les sections non citées restent à la fin.',
    input_schema: obj({ espace: S, sections: { type: 'array', items: obj({ titre: S, publications: { type: 'array', items: S } }, ['titre', 'publications']) } }, ['espace', 'sections']) },
  { name: 'lancer_rangement', description: 'Lance le script de rangement automatique du vault (90_Meta/Rangement/ranger_cours.py) s’il existe : crée les dossiers des nouveaux cours, met à jour les liens générés, range les notes Wispr Flow. Non annulable depuis l’assistant.', input_schema: obj({}) },
];

const LABELS = {
  lister_dossier: i => `Regarde « ${i.chemin || 'vault'} »`,
  lire_fichier: i => `Lit « ${path.basename(String(i.chemin || ''))} »`,
  chercher: i => `Cherche « ${i.requete || ''} »`,
  lister_cours: () => 'Consulte la liste des cours',
  creer_dossier: i => `Crée le dossier « ${i.chemin || ''} »`,
  deplacer: i => `Déplace « ${i.source || ''} » → « ${i.destination || ''} »`,
  ecrire_note: i => `${i.mode === 'ajouter' ? 'Complète' : i.mode === 'remplacer' ? 'Réécrit' : 'Écrit'} la note « ${path.basename(String(i.chemin || ''))} »`,
  lister_espaces: () => 'Consulte les espaces',
  creer_dossier_accueil: i => `Crée le dossier « ${i.nom || ''} » dans l’Accueil`,
  ranger_espaces: i => i.dossier ? `Range ${(i.espaces || []).length} espace(s) dans « ${i.dossier} »` : `Sort ${(i.espaces || []).length} espace(s) de leur dossier`,
  renommer_dossier_accueil: i => `Renomme le dossier « ${i.dossier || ''} » en « ${i.nouveau_nom || ''} »`,
  lire_espace: () => 'Ouvre un espace',
  creer_espace: i => `Crée l’espace « ${i.titre || ''} »`,
  publier: i => `Publie « ${i.titre || ''} »${i.section ? ` dans « ${i.section} »` : ''}`,
  organiser_espace: i => `Range un espace en ${(i.sections || []).length} sections`,
  lancer_rangement: () => 'Lance le rangement automatique du vault',
};
export const describeTool = (name, input = {}) => { try { return (LABELS[name] || (() => name))(input); } catch { return name; } };
const MUTATING = new Set(['creer_dossier', 'deplacer', 'ecrire_note', 'creer_espace', 'publier', 'organiser_espace', 'lancer_rangement', 'creer_dossier_accueil', 'ranger_espaces', 'renommer_dossier_accueil']);
const FOLDER_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
const cleanName = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

const LINK_RE = /(!?\[\[)([^\]|#\n]+)((?:#[^\]|\n]*)?(?:\|[^\]\n]*)?\]\])/g;

export class Assistant {
  constructor({ ai, store, supportDir, vault = null, libraries = [], notes = () => [], extensions = [], ownerViewer, onSpace = () => {}, log = () => {}, client = null, platform = process.platform }) {
    this.ai = ai;
    this.store = store;
    this.supportDir = supportDir;
    this.dir = path.join(supportDir, 'Assistant');
    this.vault = vault ? path.resolve(vault) : null;
    this.libraries = [...new Set(libraries.map(l => path.resolve(l)))].filter(l => l !== this.vault);
    this.notesSource = typeof notes === 'function' ? notes : () => notes;
    this.extensions = extensions;
    this.syncRoots();
    this.viewer = typeof ownerViewer === 'function' ? ownerViewer : () => ownerViewer;
    this.onSpace = onSpace;
    this.log = log;
    this.client = client;
    this.platform = platform;
    this.runs = [];
    this.active = null;
    this.controller = null;
    this.rules = { proteges: [], consignes: '' };
    this.vaultInstructions = '';
    this.codeCache = new Map();
    this.vaultProteges = [];
  }

  async load() {
    await fs.mkdir(path.join(this.dir, 'conversations'), { recursive: true });
    try { this.runs = JSON.parse(await fs.readFile(path.join(this.dir, 'journal.json'), 'utf8')).runs || []; } catch { this.runs = []; }
    await this.loadRules();
    return this;
  }
  async loadRules() {
    try {
      const r = JSON.parse(await fs.readFile(path.join(this.dir, 'regles.json'), 'utf8'));
      this.rules = { proteges: Array.isArray(r.proteges) ? r.proteges.map(String).slice(0, 200) : [], consignes: String(r.consignes || '').slice(0, 6000) };
    } catch { this.rules = { proteges: [], consignes: '' }; }
    return this.rules;
  }
  async saveRules(patch = {}) {
    if (typeof patch.consignes === 'string') this.rules.consignes = patch.consignes.slice(0, 6000);
    if (Array.isArray(patch.proteges)) this.rules.proteges = patch.proteges.map(s => String(s).trim().replace(/^\/+|\/+$/g, '')).filter(Boolean).slice(0, 200);
    await writePrivate(path.join(this.dir, 'regles.json'), JSON.stringify(this.rules, null, 2));
    return this.rules;
  }
  async saveJournal() {
    this.runs = this.runs.slice(-30);
    await writePrivate(path.join(this.dir, 'journal.json'), JSON.stringify({ runs: this.runs }));
  }

  // ------------------------------------------------------------ chemins et protections
  /** Racines : vault, bibliothèques de l’app (lecture seule) et dossiers de notes ajoutés dans l’app (modifiables). */
  syncRoots() {
    this.roots = new Map();
    if (this.vault) this.roots.set('vault', this.vault);
    this.libraries.forEach((l, i) => this.roots.set(i ? `cours${i + 1}` : 'cours', l));
    this.noteRoots = [];
    for (const f of this.notesSource() || []) {
      const abs = path.resolve(String(f?.path || ''));
      if (!path.isAbsolute(abs) || abs === '/' || [...this.roots.values()].some(r => within(abs, r))) continue;
      let alias = `notes-${norm(f.name || path.basename(abs)).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dossier'}`;
      for (let i = 2; this.roots.has(alias); i++) alias = `${alias.replace(/-\d+$/, '')}-${i}`;
      this.roots.set(alias, abs);
      this.noteRoots.push(abs);
    }
    return this.roots;
  }
  rootOf(abs) {
    let best = null;
    for (const r of this.roots.values()) if (within(abs, r) && (!best || r.length > best.length)) best = r;
    return best;
  }
  /** Chemin lisible par le modèle, avec la racine la plus précise (« cours/… » pour la bibliothèque, même dans le vault). */
  display(abs) {
    let best = null, alias = null;
    for (const [a, r] of this.roots) if (within(abs, r) && (!best || r.length > best.length)) { best = r; alias = a; }
    if (!best) return abs;
    return [alias, path.relative(best, abs)].filter(Boolean).join('/').split(path.sep).join('/');
  }
  resolve(input) {
    let p = String(input ?? '').trim().replace(/\\/g, '/');
    if (!p) throw err('Chemin vide.');
    let abs;
    if (path.isAbsolute(p) && this.rootOf(path.resolve(p))) abs = path.resolve(p);
    else {
      p = p.replace(/^\.?\/+/, '');
      const [head, ...rest] = p.split('/');
      const root = this.roots.get(head);
      if (root) abs = path.resolve(root, rest.join('/'));
      else {
        const base = this.vault || this.libraries[0];
        if (!base) throw err('Aucun dossier de cours n’est configuré dans l’app.');
        abs = path.resolve(base, p);
      }
    }
    const root = this.rootOf(abs);
    if (!root) throw err('Ce chemin est en dehors des dossiers de Cours Albert.');
    if (path.relative(root, abs).split(path.sep).some(s => s.startsWith('.'))) throw err('Les dossiers et fichiers cachés (.obsidian, .git…) ne sont pas accessibles.');
    return abs;
  }
  vaultRel(abs) { return this.vault && within(abs, this.vault) ? path.relative(this.vault, abs).split(path.sep).join('/') : null; }
  protectedRule(rel, { ancestors = false } = {}) {
    if (rel == null) return null;
    const segs = rel ? rel.split('/') : [];
    for (const raw of [...(this.rules.proteges || []), ...(this.vaultProteges || [])]) {
      const pat = String(raw).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (!pat.length) continue;
      const match = (a, b) => b === '*' || norm(a) === norm(b);
      const n = Math.min(segs.length, pat.length);
      let ok = true;
      for (let i = 0; i < n; i++) if (!match(segs[i], pat[i])) { ok = false; break; }
      if (!ok) continue;
      if (segs.length >= pat.length) return raw;            // dans un dossier protégé
      if (ancestors) return raw;                             // dossier qui contient un dossier protégé
    }
    return null;
  }
  readOnlyReason(abs) {
    for (const lib of this.libraries) if (within(abs, lib)) return 'géré par l’app Cours Albert';
    const rule = this.protectedRule(this.vaultRel(abs));
    return rule ? `protégé (${rule})` : null;
  }
  async inCodeProject(abs) {
    const root = this.rootOf(abs);
    for (let dir = abs; root && within(dir, root) && dir !== root; dir = path.dirname(dir)) if (await this.isCodeDir(dir)) return true;
    return false;
  }
  async isCodeDir(dir) {
    if (!this.codeCache.has(dir)) {
      let found = false;
      for (const m of CODE_MARKERS) if (await exists(path.join(dir, m))) { found = true; break; }
      this.codeCache.set(dir, found);
    }
    return this.codeCache.get(dir);
  }
  async containsCode(dir, depth = 3) {
    let budget = 3000;
    const walk = async (d, left) => {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (--budget < 0) return false;
        if (CODE_MARKERS.includes(e.name)) return true;
        if (e.isDirectory() && left > 0 && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && await walk(path.join(d, e.name), left - 1)) return true;
      }
      return false;
    };
    return walk(dir, depth);
  }
  async assertWritable(abs, { moving = false } = {}) {
    if (!this.rootOf(abs)) throw err('En dehors des dossiers de Cours Albert.');
    const inNotes = this.noteRoots.some(r => within(abs, r));
    if (!inNotes && (!this.vault || !within(abs, this.vault))) throw err(`« ${this.display(abs)} » est en lecture seule : l’assistant ne modifie que le vault et les dossiers de notes.`);
    if (abs === this.vault || this.noteRoots.includes(abs)) throw err('Impossible de déplacer ou renommer un dossier racine.');
    for (const lib of this.libraries) {
      if (within(abs, lib) || (moving && within(lib, abs))) throw err(`« ${this.display(abs)} » est géré par l’app Cours Albert (synchronisation) : lecture seule. Présente ces supports dans un espace (outil publier) ou avec des liens [[…]] dans une note.`);
    }
    const rule = this.protectedRule(this.vaultRel(abs), { ancestors: moving });
    if (rule) throw err(`« ${this.display(abs)} » est protégé (règle « ${rule} ») : une autre automatisation y écrit. Lecture seule.`);
    this.codeCache.clear();
    if (await this.inCodeProject(abs)) throw err(`« ${this.display(abs)} » fait partie d’un projet de code : lecture seule.`);
    if (moving && (await fs.stat(abs).catch(() => null))?.isDirectory() && await this.containsCode(abs)) throw err(`« ${this.display(abs)} » contient un projet de code : il reste à sa place.`);
  }
  async mkdirs(dir, run) {
    let first = null;
    for (let d = dir; !(await exists(d)); d = path.dirname(d)) first = d;
    if (!first) return;
    await fs.mkdir(dir, { recursive: true });
    run.ops.push({ op: 'mkdir', path: first });
  }

  // ------------------------------------------------------------ outils fichiers
  async lister_dossier({ chemin = 'vault', profondeur = 1 }) {
    const abs = this.resolve(chemin);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw err(`« ${chemin} » n’existe pas.`);
    if (!st.isDirectory()) throw err(`« ${chemin} » est un fichier, pas un dossier.`);
    const lines = [];
    let count = 0;
    const walk = async (dir, depth, indent) => {
      const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(e => !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
        .sort((a, b) => (b.isDirectory() - a.isDirectory()) || byName(a.name, b.name));
      for (const e of entries) {
        if (count++ >= 400) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          const ro = this.readOnlyReason(full);
          lines.push(`${indent}📁 ${e.name}/${ro ? ` [lecture seule : ${ro}]` : ''}`);
          if (depth > 1) await walk(full, depth - 1, `${indent}  `);
        } else {
          const s = await fs.stat(full).catch(() => null);
          lines.push(`${indent}${e.name}${s ? ` (${sizeLabel(s.size)})` : ''}`);
        }
      }
    };
    await walk(abs, Math.min(3, Math.max(1, profondeur | 0 || 1)), '');
    const ro = this.readOnlyReason(abs);
    return `${this.display(abs)}/${ro ? ` [lecture seule : ${ro}]` : ''}\n${lines.join('\n') || '(dossier vide)'}${count > 400 ? '\n… (liste coupée à 400 éléments)' : ''}`;
  }
  async lire_fichier({ chemin, debut = 0, longueur = 15000 }) {
    const abs = this.resolve(chemin);
    const st = await fs.stat(abs).catch(() => null);
    if (!st) throw err(`« ${chemin} » n’existe pas.`);
    if (st.isDirectory()) throw err(`« ${chemin} » est un dossier : utilise lister_dossier.`);
    const head = `${this.display(abs)} — ${sizeLabel(st.size)} — modifié le ${new Date(st.mtimeMs).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`;
    const ext = extOf(abs);
    let text = null;
    if (READ_EXT.has(ext) && st.size <= 8 * 1024 ** 2) {
      const buf = await fs.readFile(abs);
      if (!buf.subarray(0, 8192).includes(0)) text = buf.toString('utf8');
    } else if (OFFICE_EXT.has(ext) && this.platform === 'darwin' && st.size <= 30 * 1024 ** 2) {
      text = await runCommand('/usr/bin/textutil', ['-convert', 'txt', '-stdout', abs], 30_000).catch(() => null);
    }
    if (text == null) return `${head}\nFichier ${ext.toUpperCase() || 'binaire'} : contenu non lisible ici. Déduis son sujet de son nom et de son dossier.`;
    const start = Math.max(0, debut | 0), len = Math.min(40000, Math.max(200, longueur | 0 || 15000));
    const part = text.slice(start, start + len);
    return `${head}\n\n${part}${start + len < text.length ? `\n\n… (suite à partir du caractère ${start + len} sur ${text.length})` : ''}`;
  }
  async chercher({ requete, dans, contenu = true }) {
    const q = norm(requete);
    if (q.length < 2) throw err('Requête trop courte.');
    const base = this.resolve(dans || (this.vault ? 'vault' : 'cours'));
    const out = [];
    let files = 0;
    const walk = async dir => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (out.length >= 40 || files > 20000) return;
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (norm(e.name).includes(q)) out.push(`📁 ${this.display(full)}/`); await walk(full); continue; }
        files++;
        if (norm(e.name).includes(q)) { out.push(`- ${this.display(full)}`); continue; }
        if (contenu && ['md', 'markdown', 'txt'].includes(extOf(e.name))) {
          const st = await fs.stat(full).catch(() => null);
          if (!st || st.size > 512 * 1024) continue;
          const text = await fs.readFile(full, 'utf8').catch(() => '');
          const i = norm(text).indexOf(q);
          if (i >= 0) out.push(`- ${this.display(full)} — « ${text.slice(Math.max(0, i - 60), i + 100).replace(/\s+/g, ' ').trim()} »`);
        }
      }
    };
    await walk(base);
    return out.length ? `${out.length} résultat(s) pour « ${requete} » :\n${out.join('\n')}${out.length >= 40 ? '\n… (40 premiers résultats)' : ''}` : `Aucun résultat pour « ${requete} » dans ${this.display(base)}.`;
  }
  async courseFolders() {
    const found = new Map();
    if (!this.vault) return found;
    const walk = async (dir, depth) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (this.libraries.some(l => within(full, l))) continue;
        const m = e.name.match(/^([A-Z]{3}\d{2}-\d+) — /);
        if (m && !found.has(m[1])) found.set(m[1], full);
        else if (depth < 2) await walk(full, depth + 1);
      }
    };
    await walk(this.vault, 0);
    return found;
  }
  async courses() {
    let data = {};
    try { data = JSON.parse(await fs.readFile(path.join(this.supportDir, 'data.json'), 'utf8')); } catch {}
    return Array.isArray(data.courses) ? data.courses : [];
  }
  async lister_cours() {
    const list = await this.courses();
    const folders = await this.courseFolders();
    const lines = list.map(c => `- ${c.code} — ${c.fullTitle || c.title} (${c.semester || 'S1'}${c.teacher ? `, ${c.teacher}` : ''}, ${c.fileCount ?? (c.files || []).length} supports)${c.folder ? ` · supports : ${this.display(path.resolve(c.folder))}` : ''}${folders.has(c.code) ? ` · dossier du vault : ${this.display(folders.get(c.code))}` : ''}`);
    for (const [code, dir] of folders) if (!list.some(c => c.code === code)) lines.push(`- ${code} (seulement dans le vault) · ${this.display(dir)}`);
    return lines.length ? `${lines.length} cours :\n${lines.join('\n')}` : 'Aucun cours connu : la synchronisation Albert School n’a pas encore tourné.';
  }
  async creer_dossier({ chemin }, run) {
    const abs = this.resolve(chemin);
    await this.assertWritable(abs);
    if (await exists(abs)) return `Le dossier « ${this.display(abs)} » existe déjà.`;
    await this.mkdirs(abs, run);
    return `Dossier créé : ${this.display(abs)}`;
  }
  async deplacer({ source, destination, mettre_a_jour_liens = true }, run) {
    const src = this.resolve(source);
    const st = await fs.stat(src).catch(() => null);
    if (!st) throw err(`« ${source} » n’existe pas.`);
    await this.assertWritable(src, { moving: true });
    let dst = this.resolve(destination);
    if ((await fs.stat(dst).catch(() => null))?.isDirectory() || /\/$/.test(String(destination))) dst = path.join(dst, path.basename(src));
    if (dst === src) return 'Rien à faire : même emplacement.';
    if (within(dst, src)) throw err('Impossible de déplacer un dossier dans lui-même.');
    if (await exists(dst)) throw err(`« ${this.display(dst)} » existe déjà : choisis un autre nom (aucun fichier n’est jamais remplacé).`);
    await this.assertWritable(dst);
    await this.mkdirs(path.dirname(dst), run);
    await fs.rename(src, dst);
    run.ops.push({ op: 'move', from: src, to: dst });
    let edited = 0;
    if (mettre_a_jour_liens !== false && this.vault && within(src, this.vault) && within(dst, this.vault)) edited = await this.updateLinks(src, dst, st.isDirectory(), run);
    return `Déplacé : ${this.display(src)} → ${this.display(dst)}${edited ? ` · liens mis à jour dans ${edited} note(s)` : ''}`;
  }
  /** Réécrit les liens [[…]] du vault après un déplacement (chemins complets, et noms des notes renommées). */
  async updateLinks(src, dst, isDir, run) {
    const rel = p => path.relative(this.vault, p).split(path.sep).join('/');
    const paths = new Map(), names = new Map();
    const add = (oldAbs, newAbs) => {
      const o = rel(oldAbs), n = rel(newAbs);
      paths.set(o, n);
      if (/\.md$/i.test(o)) paths.set(o.replace(/\.md$/i, ''), n.replace(/\.md$/i, ''));
      const ob = path.basename(oldAbs), nb = path.basename(newAbs);
      if (ob !== nb) { names.set(ob, nb); if (/\.md$/i.test(ob)) names.set(ob.replace(/\.md$/i, ''), nb.replace(/\.md$/i, '')); }
    };
    if (isDir) {
      const walk = async d => { for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) { const f = path.join(d, e.name); if (e.isDirectory()) await walk(f); else add(path.join(src, path.relative(dst, f)), f); } };
      await walk(dst);
    } else add(src, dst);
    if (!paths.size && !names.size) return 0;
    let edited = 0;
    const walk = async dir => {
      for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!this.libraries.some(l => within(full, l)) && !(await this.isCodeDir(full))) await walk(full); continue; }
        if (!/\.(md|canvas)$/i.test(e.name)) continue;
        const before = await fs.readFile(full, 'utf8').catch(() => null);
        if (before == null || !before.includes('[[')) continue;
        const after = before.replace(LINK_RE, (m, open, target, tail) => {
          const t = target.trim();
          const next = paths.get(t) ?? names.get(t);
          return next ? open + next + tail : m;
        });
        if (after === before) continue;
        await fs.writeFile(full, after, 'utf8');
        run.ops.push({ op: 'edit', path: full, before, after: sha(after) });
        edited++;
      }
    };
    await walk(this.vault);
    return edited;
  }
  async ecrire_note({ chemin, contenu, mode = 'creer' }, run) {
    let abs = this.resolve(chemin);
    if (!extOf(abs)) abs += '.md';
    if (!WRITE_EXT.has(extOf(abs))) throw err('Seules les notes .md et .txt peuvent être écrites.');
    const text = String(contenu ?? '');
    if (text.length > 300_000) throw err('Note trop longue.');
    await this.assertWritable(abs);
    const current = await fs.readFile(abs, 'utf8').catch(() => null);
    if (mode === 'creer' && current != null) throw err(`« ${this.display(abs)} » existe déjà : utilise le mode « ajouter » ou un autre nom.`);
    if (mode === 'remplacer' && current == null) throw err(`« ${this.display(abs)} » n’existe pas.`);
    const next = mode === 'ajouter' && current != null ? `${current.replace(/\s*$/, '')}\n\n${text}\n` : text;
    await this.mkdirs(path.dirname(abs), run);
    await fs.writeFile(abs, next, 'utf8');
    run.ops.push({ op: 'write', path: abs, before: current, after: sha(next) });
    return `${current == null ? 'Note créée' : mode === 'ajouter' ? 'Note complétée' : 'Note réécrite'} : ${this.display(abs)}`;
  }
  async lancer_rangement(_, run) {
    if (!this.vault) throw err('Aucun vault configuré.');
    const script = path.join(this.vault, '90_Meta', 'Rangement', 'ranger_cours.py');
    if (!await exists(script)) return 'Ce vault n’a pas de script de rangement (90_Meta/Rangement/ranger_cours.py).';
    const out = await runCommand('python3', [script], 120_000, this.vault);
    run.ops.push({ op: 'note', text: 'Rangement automatique du vault lancé (non annulable ici).' });
    return clip(out.trim() || 'Rangement terminé : rien à changer.', 4000);
  }

  // ------------------------------------------------------------ outils espaces
  spaceOf(id) {
    const s = this.store.spaces.get(String(id || ''));
    if (!s || s.trashedAt) throw err(`Espace « ${id} » introuvable : utilise lister_espaces.`, 404);
    return s;
  }
  lister_espaces() {
    const folders = this.folders();
    const list = this.store.list().filter(s => !s.trashedAt);
    const nameOf = id => folders.find(f => f.id === id)?.name;
    const head = folders.length
      ? `Dossiers de l’Accueil : ${folders.map(f => `« ${f.name} » (${f.id}, ${list.filter(s => s.folder === f.id).length} espace(s))`).join(', ')}`
      : 'Aucun dossier de l’Accueil pour le moment.';
    if (!list.length) return `${head}\nAucun espace pour le moment.`;
    return `${head}\n\nEspaces :\n${list.map(s => `- ${s.id} · ${s.icon || ''} ${s.title} (${s.kind === 'canvas' ? 'espace libre' : 'tableau'}, ${s.posts ?? 0} publication(s)${s.archived ? ', archivé' : ''}${s.isTemplate ? ', modèle' : ''}) · dossier : ${nameOf(s.folder) || 'aucun'}`).join('\n')}`;
  }

  // ------------------------------------------------------------ dossiers de l’Accueil (classement des espaces, pas des fichiers)
  folders() { return Array.isArray(this.store.prefs?.folders) ? this.store.prefs.folders : []; }
  findFolder(ref) {
    const r = String(ref ?? '').trim();
    if (!r) return null;
    const list = this.folders();
    return list.find(f => f.id === r) || list.find(f => norm(f.name) === norm(r)) || null;
  }
  async addFolder(nom, couleur, run) {
    const name = cleanName(nom);
    if (!name) throw err('Nom de dossier manquant.');
    const found = this.findFolder(name);
    if (found) return { folder: found, created: false };
    const list = this.folders();
    const color = /^#[0-9a-f]{6}$/i.test(String(couleur || '')) ? String(couleur).toLowerCase() : FOLDER_COLORS[list.length % FOLDER_COLORS.length];
    const id = `d_${rid(6)}`;
    await this.store.setPrefs({ folders: [...list, { id, name, color }] });
    run.ops.push({ op: 'folder-create', id, name });
    return { folder: this.findFolder(id) || { id, name, color }, created: true };
  }
  async creer_dossier_accueil({ nom, couleur }, run) {
    const { folder, created } = await this.addFolder(nom, couleur, run);
    return created ? `Dossier de l’Accueil créé : « ${folder.name} » (id ${folder.id}).` : `Le dossier de l’Accueil « ${folder.name} » existe déjà (id ${folder.id}) : il sera réutilisé.`;
  }
  async ranger_espaces({ dossier, espaces = [] }, run) {
    const ids = [...new Set((Array.isArray(espaces) ? espaces : [espaces]).map(x => String(x ?? '').trim()).filter(Boolean))].slice(0, 300);
    if (!ids.length) throw err('Aucun espace à ranger : donne leurs identifiants (voir lister_espaces).');
    let folder = null, created = false;
    if (cleanName(dossier)) ({ folder, created } = this.findFolder(dossier) ? { folder: this.findFolder(dossier), created: false } : await this.addFolder(dossier, null, run));
    const target = folder?.id || null;
    const moved = [], already = [], unknown = [];
    for (const id of ids) {
      const s = this.store.spaces.get(id);
      if (!s || s.trashedAt) { unknown.push(id); continue; }
      const before = s.folder || null;
      if (before === target) { already.push(s.title); continue; }
      const updated = this.store.updateMeta(s.id, { folder: target }, this.viewer(), 'assistant');
      run.ops.push({ op: 'space-folder', id: s.id, before, after: target });
      this.onSpace(updated);
      moved.push(s.title);
    }
    const where = folder ? `dans « ${folder.name} »${created ? ' (dossier créé)' : ''}` : 'hors dossier';
    return [
      moved.length ? `${moved.length} espace(s) rangé(s) ${where} : ${moved.join(', ')}.` : `Aucun espace déplacé ${where}.`,
      already.length ? `Déjà à cette place : ${already.join(', ')}.` : '',
      unknown.length ? `Identifiants inconnus ignorés : ${unknown.join(', ')} (voir lister_espaces).` : '',
    ].filter(Boolean).join('\n');
  }
  async renommer_dossier_accueil({ dossier, nouveau_nom }, run) {
    const f = this.findFolder(dossier);
    if (!f) throw err(`Dossier de l’Accueil « ${dossier} » introuvable. Dossiers existants : ${this.folders().map(x => `« ${x.name} »`).join(', ') || 'aucun'}.`, 404);
    const name = cleanName(nouveau_nom);
    if (!name) throw err('Nouveau nom manquant.');
    const clash = this.findFolder(name);
    if (clash && clash.id !== f.id) throw err(`Un dossier « ${clash.name} » existe déjà : range plutôt les espaces dedans avec ranger_espaces.`);
    if (f.name === name) return 'Le dossier porte déjà ce nom.';
    const before = f.name;
    await this.store.setPrefs({ folders: this.folders().map(x => x.id === f.id ? { ...x, name } : x) });
    run.ops.push({ op: 'folder-rename', id: f.id, before, after: name });
    return `Dossier de l’Accueil renommé : « ${before} » → « ${name} ».`;
  }
  lire_espace({ espace }) {
    const s = this.spaceOf(espace);
    const lines = [`${s.icon || ''} ${s.title} (id ${s.id}, ${s.kind === 'canvas' ? 'espace libre' : 'tableau'})${s.description ? `\n${clip(s.description, 400)}` : ''}`];
    if (s.kind === 'board') {
      for (const sec of s.sections) {
        lines.push(`\n## ${sec.title} (section ${sec.id})`);
        const posts = s.posts.filter(p => p.sectionId === sec.id).sort((a, b) => a.order - b.order);
        if (!posts.length) lines.push('(vide)');
        for (const p of posts) {
          const files = (p.attachments || []).map(a => a.kind === 'local' ? this.display(a.path) : a.name || a.url || a.kind).filter(Boolean);
          lines.push(`- ${p.id} · ${p.title || '(sans titre)'}${p.body ? ` — ${clip(p.body.replace(/\s+/g, ' '), 160)}` : ''}${files.length ? ` · fichiers : ${files.join(', ')}` : ''}${p.status !== 'published' ? ` [${p.status}]` : ''}`);
        }
      }
      const orphans = s.posts.filter(p => !s.sections.some(x => x.id === p.sectionId));
      if (orphans.length) lines.push(`\nHors section : ${orphans.map(p => `${p.id} · ${p.title}`).join(' ; ')}`);
    } else {
      for (const c of s.cards || []) lines.push(`- Carte « ${c.title || 'sans titre'} » : ${(c.objects || []).length} objet(s)${(c.objects || []).filter(o => o.text).slice(0, 8).map(o => ` · « ${clip(o.text.replace(/\s+/g, ' '), 60)} »`).join('')}`);
    }
    return clip(lines.join('\n'), MAX_RESULT);
  }
  layoutOf(s) { return { sections: s.sections.map(x => ({ ...x })), posts: s.posts.map(p => ({ id: p.id, sectionId: p.sectionId, order: p.order })) }; }
  async creer_espace({ titre, description = '', icone = '📚', sections = [] }, run) {
    const t = String(titre || '').trim();
    if (!t) throw err('Titre manquant.');
    const space = await this.store.create({ kind: 'board', title: t, description: String(description || ''), icon: String(icone || '📚'),
      sections: (Array.isArray(sections) && sections.length ? sections : ['Général']).slice(0, 30).map(x => ({ id: `s_${rid(8)}`, title: String(x).slice(0, 120) })) });
    run.ops.push({ op: 'space-create', id: space.id, title: space.title });
    this.onSpace(space);
    return `Espace créé : ${space.icon} ${space.title} (id ${space.id}) · sections : ${space.sections.map(x => `${x.title} (${x.id})`).join(', ')}`;
  }
  findSection(s, ref) {
    if (!ref) return null;
    return s.sections.find(x => x.id === ref) || s.sections.find(x => norm(x.title) === norm(ref)) || null;
  }
  async publier({ espace, titre, texte = '', section, fichiers = [], lien }, run) {
    const s = this.spaceOf(espace);
    if (s.kind !== 'board') throw err('Les publications ne vont que dans les tableaux.');
    const attachments = [];
    for (const f of (Array.isArray(fichiers) ? fichiers : []).slice(0, 20)) {
      const abs = this.resolve(f);
      const st = await fs.stat(abs).catch(() => null);
      if (!st?.isFile()) throw err(`« ${f} » n’est pas un fichier existant.`);
      attachments.push({ kind: 'local', path: abs, name: path.basename(abs), size: st.size, mime: mimeOf(abs) });
    }
    if (lien) {
      if (!/^https?:\/\//i.test(String(lien))) throw err('Le lien doit commencer par http:// ou https://.');
      attachments.push({ kind: 'link', url: String(lien), name: String(lien) });
    }
    let sec = this.findSection(s, section);
    if (section && !sec) {
      const before = this.layoutOf(s);
      this.store.updateMeta(s.id, { sections: [...s.sections, { title: String(section).slice(0, 120) }] }, this.viewer(), 'assistant');
      run.ops.push({ op: 'layout', space: s.id, before });
      sec = s.sections[s.sections.length - 1];
    }
    const post = this.store.createPost(s.id, { title: String(titre || '').slice(0, 300), body: String(texte || ''), sectionId: sec?.id, attachments }, this.viewer(), 'assistant');
    run.ops.push({ op: 'post-create', space: s.id, post: post.id });
    return `Publié : « ${post.title} » (id ${post.id}) dans « ${s.title} »${sec ? ` › « ${sec.title} »` : ''}${attachments.length ? ` avec ${attachments.length} pièce(s) jointe(s)` : ''}`;
  }
  async organiser_espace({ espace, sections = [] }, run) {
    const s = this.spaceOf(espace);
    if (s.kind !== 'board') throw err('Seuls les tableaux se rangent en sections.');
    const plan = (Array.isArray(sections) ? sections : []).slice(0, 60).filter(x => String(x?.titre || '').trim());
    if (!plan.length) throw err('Aucune section dans le plan.');
    const before = this.layoutOf(s);
    const used = new Set();
    const next = plan.map(x => {
      const ex = s.sections.find(y => !used.has(y.id) && norm(y.title) === norm(x.titre));
      if (ex) used.add(ex.id);
      return ex ? { ...ex, title: String(x.titre).slice(0, 120) } : { title: String(x.titre).slice(0, 120) };
    });
    const kept = s.sections.filter(y => !used.has(y.id));
    this.store.updateMeta(s.id, { sections: [...next, ...kept] }, this.viewer(), 'assistant');
    const moves = [];
    const unknown = [];
    plan.forEach((x, i) => {
      const sectionId = s.sections[i].id;
      (Array.isArray(x.publications) ? x.publications : []).forEach((id, j) => {
        if (s.posts.some(p => p.id === id)) moves.push({ id, sectionId, order: j });
        else unknown.push(id);
      });
    });
    if (moves.length) this.store.movePosts(s.id, moves, this.viewer(), 'assistant');
    run.ops.push({ op: 'layout', space: s.id, before });
    return `Espace « ${s.title} » rangé : ${s.sections.map(x => `${x.title} (${s.posts.filter(p => p.sectionId === x.id).length})`).join(' · ')}${unknown.length ? ` · identifiants inconnus ignorés : ${unknown.join(', ')}` : ''}`;
  }

  // ------------------------------------------------------------ conversation
  async status() {
    this.syncRoots();
    const ai = this.ai.status();
    return { enabled: ai.enabled, configured: ai.configured, model: ai.model, provider: ai.providerShort || 'Claude', running: !!this.active, vault: this.vault ? this.display(this.vault) : null,
      roots: [...this.roots.keys()], conversations: await this.listConversations(), rules: this.rules };
  }
  convFile(id) { return path.join(this.dir, 'conversations', `${String(id).replace(/[^A-Za-z0-9_-]/g, '')}.json`); }
  async loadConversation(id) {
    if (!id) return null;
    try { return JSON.parse(await fs.readFile(this.convFile(id), 'utf8')); } catch { return null; }
  }
  async saveConversation(conv) { conv.updatedAt = new Date().toISOString(); await writePrivate(this.convFile(conv.id), JSON.stringify(conv)); }
  async listConversations() {
    const dir = path.join(this.dir, 'conversations');
    const out = [];
    for (const f of await fs.readdir(dir).catch(() => [])) {
      if (!f.endsWith('.json')) continue;
      try { const c = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt }); } catch {}
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 30);
  }
  async conversationView(id) {
    const c = await this.loadConversation(id);
    if (!c) throw err('Conversation introuvable.', 404);
    return { id: c.id, title: c.title, items: c.display || [], runs: this.runs.filter(r => r.conversation === c.id).map(r => ({ id: r.id, changes: r.ops.filter(o => o.op !== 'note').length, undone: !!r.undone })) };
  }
  toolList() { return [...TOOLS, ...this.extensions.flatMap(x => x.tools?.() || [])]; }
  extensionFor(name) { return TOOLS.some(t => t.name === name) ? null : this.extensions.find(x => (x.tools?.() || []).some(t => t.name === name)) || null; }
  ensureReady() {
    if (!this.ai.status().enabled) throw err('L’assistant utilise votre clé API (Claude, ChatGPT, Gemini, Mistral…) : ajoutez-la dans Réglages › IA.', 409);
    if (this.active) throw err('L’assistant travaille déjà : attendez la fin ou arrêtez-le.', 409);
  }
  stop() { this.controller?.abort(); }

  systemPrompt(context) {
    const owner = this.viewer()?.name || 'l’étudiant';
    const roots = [];
    if (this.vault) roots.push('- « vault/… » : le vault Obsidian. Tu peux y créer des dossiers et des notes, déplacer et renommer (sauf dossiers signalés en lecture seule).');
    this.libraries.forEach((l, i) => roots.push(`- « ${i ? `cours${i + 1}` : 'cours'}/… » : bibliothèque synchronisée par l’app (supports officiels d’Inside, de Drive et du Bureau)${this.vault && within(l, this.vault) ? `, visible aussi dans le vault sous « ${this.display(l)} »` : ''}. Lecture seule : ne déplace jamais ces fichiers ; pour les ranger, crée des publications qui les joignent dans un espace, ou des liens [[…]] dans des notes.`));
    for (const [alias, abs] of this.roots) if (this.noteRoots.includes(abs)) roots.push(`- « ${alias}/… » : dossier de notes ajouté dans l’app (${abs}). Modifiable comme le vault.`);
    if (!this.vault && !this.noteRoots.length) roots.push('- Pas de vault Obsidian ni de dossier de notes : tu ne peux pas écrire de fichiers, seulement ranger les espaces.');
    for (const x of this.extensions) { const t = x.prompt?.(); if (t) roots.push(`- ${t}`); }
    const date = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });
    return [
      `Tu es l’assistant IA intégré à Cours Albert, l’application macOS de cours de ${owner} (étudiant à Albert School). ${owner} te parle depuis la page « Assistant IA » de l’app. Ton travail : ranger et organiser ses cours, dans ses fichiers (vault Obsidian, notes) et dans les espaces de l’app, avec les outils fournis. Tu agis directement : ${owner} t’a autorisé à trier comme tu le juges bon, et chaque changement s’annule d’un clic. Tu n’es pas un assistant de programmation : tu ne lis ni ne modifies le code de l’app.`,
      `## L’app, page par page (barre latérale)
- **Accueil** : tous les espaces, en cartes. Filtres Tous, Récents, Favoris, Corbeille, puis les **dossiers de l’Accueil** : des pastilles de couleur qui classent les espaces (par exemple un dossier par matière). Outils : lister_espaces, creer_dossier_accueil, ranger_espaces, renommer_dossier_accueil.
- **Espaces** : un tableau (façon Padlet) a des sections (colonnes) qui contiennent des publications (titre, texte, fichiers joints, lien) ; un espace libre est un tableau blanc en cartes. Outils : creer_espace, lire_espace, publier, organiser_espace. Une publication joint des fichiers du vault ou de la bibliothèque sans les déplacer.
- **Récents** : les derniers espaces ouverts (rien à ranger).
- **Notes** : les dossiers de notes ajoutés dans l’app (racines « notes-… »).
- **Albert School** : Aujourd’hui, Emploi du temps, Examens, Présence, Cours (la bibliothèque synchronisée depuis Inside, Drive et le Bureau : racine « cours/… », lecture seule) et Synchronisation. Outil : lister_cours.
- **Outils** : Assistant IA (toi), Rechercher, Réglages (nom, fournisseur d’IA, Wispr Flow, bibliothèque de cours).
Tu ne peux pas : changer l’interface ou le code de l’app, modifier les réglages, supprimer quoi que ce soit, lire le texte d’un PDF ou d’une image (seulement son nom et sa taille). Dans ces cas, dis-le en une phrase et propose ce que tu peux faire à la place. Ne cherche pas la documentation ou le code de l’app dans le vault : tout ce qu’il faut savoir sur l’app est ici.`,
      `## Fichiers auxquels tu as accès\n${roots.join('\n')}`,
      `## Comprendre la demande
- « Dossier » a trois sens : 1) **dossier de l’Accueil**, qui classe les espaces sur l’écran d’accueil (ce n’est pas un dossier de fichiers) ; 2) dossier du vault, un vrai dossier de fichiers dans Obsidian ; 3) dossier de notes de l’app. Quand ${owner} parle de l’Accueil, des espaces, des tableaux, de « catégories » ou de ce qu’il voit en ouvrant l’app, c’est un dossier de l’Accueil.
- « Espace », « tableau », « padlet » : un espace de l’app. « Section », « colonne » : une section de tableau. « Carte », « post », « publication » : une publication.
- « Matière » ou « catégorie » : en général Maths, Data, Business, Humanités. Déduis la matière du code du cours (MAT…, DAT…, BUS…, HUM…) ou du début du titre de l’espace ; vérifie avec lister_cours si besoin.
- Ranger l’Accueil par matière : un dossier de l’Accueil par matière (réutilise un dossier existant au nom proche au lieu de créer un doublon), puis ranger_espaces pour chaque matière, en traitant tous les espaces d’un coup. Ne crée pas de nouveau tableau pour ça.
- Un espace dont ${owner} ne veut plus : tu ne peux pas le supprimer ; propose de le ranger dans un dossier de l’Accueil « Archive ».
- Si la demande reste ambiguë après avoir regardé, pose une seule question courte avec les options possibles.`,
      '## Règles\n- Aucun outil de suppression : ne supprime jamais rien ; ce qui est inutile va dans un dossier « Archive ».\n- Regarde avant d’agir (lister_espaces, lister_dossier, chercher, lister_cours, lire_espace) : ne devine pas un chemin ni un identifiant.\n- Garde les noms de cours exacts de l’app (« CODE — Titre ») ; dans le vault, en général une matière = un dossier, un cours = un sous-dossier.\n- Les liens [[…]] d’Obsidian sont mis à jour automatiquement quand tu déplaces une note.\n- Pas d’opérations inutiles : ne renomme pas sans raison et ne réécris pas le contenu d’une note sans demande (ajouter un lien ou une section est permis).\n- Si une demande touche beaucoup de fichiers d’une façon difficile à défaire, explique ton plan en quelques lignes et demande d’abord.\n- Réponds dans la langue de l’étudiant (français par défaut), court et direct, sans jargon. Termine par un résumé de 2 à 5 lignes : ce que tu as changé et où.',
      this.vaultInstructions ? `## Consignes écrites dans le vault\nCertaines parties s’adressent aux personnes qui développent l’app (code, compilation) : ignore-les.\n${this.vaultInstructions}` : '',
      this.rules.consignes ? `## Consignes de ${owner}\n${this.rules.consignes}` : '',
      this.rules.proteges?.length || this.vaultProteges?.length ? `## Dossiers protégés (lecture seule)\n${[...(this.rules.proteges || []), ...(this.vaultProteges || [])].map(p => `- vault/${p}`).join('\n')}` : '',
      `## Aujourd’hui\n${date}${context ? `\n${context}` : ''}`,
    ].filter(Boolean).join('\n\n');
  }
  async readVaultInstructions() {
    this.vaultInstructions = '';
    this.vaultProteges = [];
    if (!this.vault) return;
    for (const name of ['ASSISTANT.md', 'CLAUDE.md']) {
      const text = await fs.readFile(path.join(this.vault, name), 'utf8').catch(() => null);
      if (!text) continue;
      this.vaultInstructions = clip(text, 6000);
      // Section « Dossiers protégés » du fichier de consignes : chemins entre accents graves, appliqués comme des règles.
      const section = text.match(/^#{1,4}\s*Dossiers prot[ée]g[ée]s[^\n]*\n([\s\S]*?)(?=^#{1,4}\s|(?![\s\S]))/im)?.[1] || '';
      this.vaultProteges = [...section.matchAll(/`([^`\n]+)`/g)].map(m => m[1].trim().replace(/^vault\//, '').replace(/^\/+|\/+$/g, '')).filter(x => x && !x.includes('..')).slice(0, 100);
      return;
    }
  }
  /** Début de la demande en cours : dernier message de l’étudiant (pas un simple retour d’outils). */
  turnStart(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user' && (typeof m.content === 'string' || (Array.isArray(m.content) && !m.content.some(b => b?.type === 'tool_result')))) return i;
    }
    return 0;
  }
  /** Retire les anciens résultats d’outils trop longs — seulement avant la demande en cours, pour ne pas modifier ce que le modèle vient de voir. */
  compact(messages) {
    let size = JSON.stringify(messages).length;
    const start = this.turnStart(messages);
    for (let i = 0; i < start && size > MAX_HISTORY_CHARS; i++) {
      const m = messages[i];
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const b of m.content) if (b.type === 'tool_result' && typeof b.content === 'string' && b.content.length > 200) { size -= b.content.length; b.content = '[ancien résultat retiré pour gagner de la place]'; }
    }
    return messages;
  }
  /** Messages envoyés à l’API. Les blocs de réflexion (« thinking ») sont signés pour un échange précis : on ne renvoie que ceux
   *  de la demande en cours (nécessaires pendant les appels d’outils) et on retire ceux des demandes précédentes,
   *  sinon l’API refuse (« Invalid signature in thinking block »). `all` retire aussi ceux de la demande en cours. */
  forAPI(messages, { all = false } = {}) {
    const start = all ? messages.length : this.turnStart(messages);
    return messages.map((m, i) => {
      if (m.role !== 'assistant' || !Array.isArray(m.content) || i > start) return m;
      const content = m.content.filter(b => b?.type !== 'thinking' && b?.type !== 'redacted_thinking');
      if (content.length === m.content.length) return m;
      return { ...m, content: content.length ? content : [{ type: 'text', text: '…' }] };
    });
  }
  async createMessage(client, conv, system, signal) {
    try {
      const request = all => client.beta.messages.create({
        model: this.ai.current?.().model ?? this.ai.config.model, max_tokens: 16000,
        ...(this.ai.extras ? this.ai.extras() : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }),
        output_config: { effort: 'medium' },
        system, tools: this.toolList(), messages: this.forAPI(this.compact(conv.messages), { all }),
      }, { signal });
      try { return await request(false); }
      catch (e) {
        // Signature de réflexion refusée malgré tout (conversation ancienne, modèle de secours…) : une seconde tentative sans aucun bloc de réflexion.
        if (e?.status === 400 && /signature|thinking/i.test(String(e?.message || ''))) { this.log?.('Assistant : blocs de réflexion refusés, nouvel essai sans eux.'); return await request(true); }
        throw e;
      }
    } catch (e) {
      if (signal?.aborted || e?.name === 'AbortError' || e?.constructor?.name === 'APIUserAbortError') throw Object.assign(new Error('Arrêté.'), { aborted: true });
      const A = sdk ?? (this.ai.current?.().provider === 'anthropic' ? await loadSDK().catch(() => null) : null);
      if (A && e instanceof A.AuthenticationError) throw err('Clé API Claude refusée : vérifiez-la dans Réglages › IA.', 401);
      if (A && e instanceof A.PermissionDeniedError) throw err('Cette clé API n’a pas accès à ce modèle.', 403);
      if (A && e instanceof A.RateLimitError) throw err('Limite d’utilisation de l’API atteinte. Réessayez dans un moment.', 429);
      if (A && e instanceof A.BadRequestError) throw err(`Demande refusée par l’API : ${String(e.message).slice(0, 200)}`, 400);
      if (A && e instanceof A.APIConnectionError) throw err('Impossible de joindre l’API Claude : vérifiez la connexion internet.', 503);
      if (A && e instanceof A.APIError) throw err(`Erreur de l’API Claude (${e.status ?? '?'}).`, 502);
      throw e;
    }
  }

  /** Une demande de l’étudiant : boucle modèle ↔ outils. Émet des événements pour l’interface. */
  async *chat({ conversation, message, context } = {}) {
    this.ensureReady();
    this.syncRoots();
    const text = String(message || '').trim().slice(0, 20000);
    if (!text) throw err('Message vide.');
    const conv = (await this.loadConversation(conversation)) || { id: `c_${rid(12)}`, title: text.replace(/\s+/g, ' ').slice(0, 80), createdAt: new Date().toISOString(), messages: [], display: [] };
    const run = { id: `r_${rid(12)}`, conversation: conv.id, at: new Date().toISOString(), request: text.slice(0, 200), ops: [], undone: false };
    const ctx = typeof context === 'string' ? context.slice(0, 600) : '';
    this.active = run;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const shown = { role: 'assistant', run: run.id, parts: [] };
    try {
      await this.loadRules();
      await this.readVaultInstructions();
      conv.messages.push({ role: 'user', content: ctx ? `${text}\n\n(${ctx})` : text });
      conv.display.push({ role: 'user', text });
      conv.display.push(shown);
      yield { type: 'start', conversation: conv.id, title: conv.title, run: run.id };
      const client = this.client || (typeof this.ai.client === 'function' ? await this.ai.client({ timeout: 300_000 }) : new (await loadSDK())({ apiKey: this.ai.config.apiKey, timeout: 300_000, maxRetries: 2 }));
      const system = this.systemPrompt(ctx);
      for (let step = 0; ; step++) {
        if (step >= MAX_STEPS) { const msg = 'J’ai atteint la limite d’étapes pour une seule demande. Relancez-moi pour continuer.'; shown.parts.push({ type: 'text', text: msg }); yield { type: 'text', text: msg }; break; }
        const response = await this.createMessage(client, conv, system, signal);
        conv.messages.push({ role: 'assistant', content: response.content });
        const said = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
        if (said) { shown.parts.push({ type: 'text', text: said }); yield { type: 'text', text: said }; }
        const uses = response.content.filter(b => b.type === 'tool_use');
        if (response.stop_reason === 'refusal') { shown.parts.push({ type: 'error', text: 'L’IA a refusé cette demande.' }); yield { type: 'error', message: 'L’IA a refusé cette demande.' }; break; }
        if (!uses.length) { if (response.stop_reason === 'max_tokens') yield { type: 'error', message: 'Réponse trop longue, coupée.' }; break; }
        const results = [];
        for (const u of uses) {
          const ext = this.extensionFor(u.name);
          const label = ext?.label?.(u.name, u.input || {}) || describeTool(u.name, u.input || {});
          yield { type: 'action', id: u.id, tool: u.name, label, status: 'running' };
          let out, ok = true;
          try {
            if (signal.aborted) throw Object.assign(new Error('Arrêté.'), { aborted: true });
            const fn = TOOLS.some(t => t.name === u.name) && typeof this[u.name] === 'function' ? this[u.name] : null;
            if (fn) out = String(await fn.call(this, u.input || {}, run));
            else if (ext) out = String(await ext.run(u.name, u.input || {}, { run, assistant: this }));
            else throw err(`Outil inconnu : ${u.name}`);
          } catch (e) {
            if (e.aborted) throw e;
            ok = false; out = `Erreur : ${e.message}`;
          }
          const part = { type: 'action', tool: u.name, label, ok, detail: out.split('\n')[0].slice(0, 300), changes: (MUTATING.has(u.name) || !!ext?.mutating?.includes(u.name)) && ok };
          shown.parts.push(part);
          yield { type: 'action', id: u.id, tool: u.name, label, status: ok ? 'ok' : 'error', detail: part.detail, changes: part.changes };
          results.push({ type: 'tool_result', tool_use_id: u.id, content: clip(out, MAX_RESULT), ...(ok ? {} : { is_error: true }) });
        }
        conv.messages.push({ role: 'user', content: results });
      }
    } catch (e) {
      if (e.aborted) { shown.parts.push({ type: 'text', text: '(Arrêté.)' }); this.closeDangling(conv); yield { type: 'stopped' }; }
      else { this.log?.(`Assistant : ${e?.stack || e}`); shown.parts.push({ type: 'error', text: e.message }); this.closeDangling(conv); yield { type: 'error', message: e.message, status: e.status }; }
    } finally {
      this.active = null;
      this.controller = null;
      if (run.ops.length) { this.runs.push(run); await this.saveJournal().catch(e => this.log?.(`Journal de l’assistant : ${e.message}`)); }
      if (conv.messages.length) await this.saveConversation(conv).catch(e => this.log?.(`Conversation de l’assistant : ${e.message}`));
    }
    yield { type: 'done', run: run.id, conversation: conv.id, changes: run.ops.filter(o => o.op !== 'note').length };
  }
  /** Après une erreur : répond aux appels d’outil restés en suspens pour que la conversation reste valide. */
  closeDangling(conv) {
    const last = conv.messages[conv.messages.length - 1];
    if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some(b => b.type === 'tool_use')) {
      conv.messages.push({ role: 'user', content: last.content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Interrompu.', is_error: true })) });
    }
    if (conv.messages[conv.messages.length - 1]?.role === 'user') conv.messages.push({ role: 'assistant', content: [{ type: 'text', text: '(Interrompu.)' }] });
  }

  // ------------------------------------------------------------ annulation
  async undo(runId) {
    const run = this.runs.find(r => r.id === runId);
    if (!run) throw err('Rien à annuler pour cette demande.', 404);
    if (run.undone) return { restored: 0, skipped: [], already: true };
    if (this.active?.id === runId) throw err('Attendez la fin de la demande.', 409);
    const viewer = this.viewer();
    let restored = 0;
    const skipped = [];
    for (const op of [...run.ops].reverse()) {
      try {
        if (op.op === 'move') {
          if (await exists(op.to) && !await exists(op.from)) { await fs.mkdir(path.dirname(op.from), { recursive: true }); await fs.rename(op.to, op.from); restored++; }
          else skipped.push(`${this.display(op.to)} : déplacé ou recréé depuis`);
        } else if (op.op === 'mkdir') {
          try { await fs.rmdir(op.path); restored++; } catch (e) { if (e.code !== 'ENOENT') skipped.push(`${this.display(op.path)} : dossier non vide, gardé`); }
        } else if (op.op === 'write' || op.op === 'edit') {
          const cur = await fs.readFile(op.path).catch(() => null);
          if (cur && sha(cur) === op.after) {
            if (op.before == null) await fs.rm(op.path); else await fs.writeFile(op.path, op.before, 'utf8');
            restored++;
          } else skipped.push(`${this.display(op.path)} : modifié depuis, gardé tel quel`);
        } else if (op.op === 'post-create') {
          const s = this.store.spaces.get(op.space);
          if (s?.posts.some(p => p.id === op.post)) { this.store.deletePost(op.space, op.post, viewer, 'assistant'); restored++; }
        } else if (op.op === 'space-create') {
          if (this.store.spaces.get(op.id)) { const s = this.store.updateMeta(op.id, { trashed: true }, viewer, 'assistant'); this.onSpace(s); restored++; }
        } else if (op.op === 'space-folder') {
          const s = this.store.spaces.get(op.id);
          if (!s) continue;
          if ((s.folder || null) !== op.after) { skipped.push(`${s.title} : changé de dossier depuis, laissé tel quel`); continue; }
          const back = op.before && this.folders().some(f => f.id === op.before) ? op.before : null;
          this.onSpace(this.store.updateMeta(s.id, { folder: back }, viewer, 'assistant'));
          restored++;
        } else if (op.op === 'folder-create') {
          const list = this.folders();
          if (!list.some(f => f.id === op.id)) continue;
          if ([...this.store.spaces.values()].some(s => s.folder === op.id && !s.trashedAt)) { skipped.push(`Dossier « ${op.name} » : contient des espaces, gardé`); continue; }
          await this.store.setPrefs({ folders: list.filter(f => f.id !== op.id) });
          restored++;
        } else if (op.op === 'folder-rename') {
          const f = this.folders().find(x => x.id === op.id);
          if (!f) continue;
          if (f.name !== op.after) { skipped.push(`Dossier « ${f.name} » : renommé depuis, gardé`); continue; }
          await this.store.setPrefs({ folders: this.folders().map(x => x.id === op.id ? { ...x, name: op.before } : x) });
          restored++;
        } else if (op.op === 'layout') {
          const s = this.store.spaces.get(op.space);
          if (!s) continue;
          this.store.updateMeta(s.id, { sections: op.before.sections }, viewer, 'assistant');
          const moves = op.before.posts.filter(p => s.posts.some(x => x.id === p.id)).map(p => ({ id: p.id, sectionId: p.sectionId, order: p.order }));
          if (moves.length) this.store.movePosts(s.id, moves, viewer, 'assistant');
          restored++;
        }
      } catch (e) { skipped.push(`${op.op} : ${e.message}`); }
    }
    run.undone = true;
    await this.saveJournal();
    return { restored, skipped };
  }
}

async function writePrivate(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${rid(6)}`;
  try { await fs.writeFile(temp, text, { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}
function runCommand(cmd, args, timeout, cwd) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout, cwd, maxBuffer: 8 * 1024 * 1024 }, (e, stdout, stderr) => e ? reject(err(`${path.basename(cmd)} : ${String(stderr || e.message).slice(0, 300)}`)) : resolve(String(stdout))));
}

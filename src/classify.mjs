// Tri automatique des supports de cours : catégorie, rang naturel (TD1 avant TD2 avant TD10) et corrigés.
// Fonctions pures, testées hors ligne ; les choix manuels de l’étudiant (classement.json) passent toujours avant.
import path from 'node:path';

export const CATEGORIES = [
  { id: 'cours', label: 'Cours et slides' },
  { id: 'td', label: 'TD, TP et exercices' },
  { id: 'controles', label: 'Contrôles et examens' },
  { id: 'projets', label: 'Projets et devoirs' },
  { id: 'lectures', label: 'Lectures et ressources' },
  { id: 'donnees', label: 'Données et code' },
  { id: 'infos', label: 'Infos du cours' },
  { id: 'autres', label: 'Autres fichiers' },
];
export const CATEGORY_IDS = CATEGORIES.map(c => c.id);

export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const COURSE_CODE = /\b(?:MAT|DAT|BUS|HUM)\d{2}-\d+\b/gi;
const DATA_EXT = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'json', 'py', 'ipynb', 'sql', 'r', 'rmd', 'parquet', 'gsheet', 'db', 'sqlite', 'js', 'html', 'txt']);
const SLIDE_EXT = new Set(['pptx', 'ppt', 'key', 'gslides']);
const READ_EXT = new Set(['pdf', 'epub', 'docx', 'doc', 'gdoc', 'pages', 'rtf', 'odt', 'md']);

const RULES = [
  ['infos', /\b(syllabus|overview|textbook|handbook|programme du cours|plan de cours|course outline|guide du cours|presentation du cours|modalites|grading|calendrier)\b/],
  ['controles', /\b(cc|ds)\s*[-_.]?\s*\d+\b|\bcc\b|controle|partiel|examens?\b|exams?\b|midterm|final (exam|test)|examen final|\bquiz+\b|\bqcm\b|\bmcq\b|annales?|\bmock\b|\btests?\s*\d*\b|interro|revision/],
  ['td', /\btd\s*[-_.]?\s*\d*\b|\btp\s*[-_.]?\s*\d+\b|travaux (diriges|pratiques)|exercices?|\bexos?\b|worksheet|workbook|problem sets?|\bpsets?\s*\d*|\bps\s*\d+\b|feuilles?\s*(d.)?\s*(exercices?|td)?\s*\d*|serie\s*\d+|\blab\s*\d+|\bdrill/],
  ['projets', /projets?\b|projects?\b|assignments?|devoirs?|homework|\bdm\s*[-_.]?\s*\d+|rendu|livrable|\bbrief\b|case stud|etude de cas|\bcases?\s*\d+|pitch|rapport|report\b|deliverable|soutenance/],
  ['cours', /\bcours\b|lectures?\s*\d+|\bslides?\b|chapitres?|\bchap\s*\d+|\bch\s*\d+|sessions?\s*\d+|seances?\s*\d*|\bnotes?\b|lessons?|lecons?|module\s*\d+|week\s*\d+|semaine\s*\d+|\bintro(duction)?\b|polycopie|\bpoly\b|handout|\bdeck\b|keynote|support de cours|summary|resume|synthese|fiche/],
];
const SOLUTION = /\bsolutions?\b|\bcorriges?\b|\bcorrections?\b|\banswers?\b|\breponses\b|\bsolved\b|\bsoluce\b/;
const RANK_WORDS = 'td|tp|cc|ds|dm|sessions?|seances?|cours|chapitres?|chap|ch|lectures?|lessons?|lecons?|week|semaine|parts?|partie|module|units?|unite|exercices?|exos?|feuilles?|sheets?|quiz|qcm|mcq|tests?|series?|serie|slides?|deck|themes?|topics?|psets?|ps|labs?|cases?|workbook|annexe|step|etape|niveau|level';
const RANK_RE = new RegExp(`(?:^|[^a-z])(?:${RANK_WORDS})\\s*[-_.#:]?\\s*(?:n\\s*[°o.]?\\s*)?(\\d{1,3})(?:[._-](\\d{1,2}))?(?!\\d)`);

/** Nom lisible : sans extension, sans code de cours répété, séparateurs nettoyés. */
export function displayTitle(name) {
  let s = String(name || '').replace(/\.(gdoc|gsheet|gslides)\.md$/i, '').replace(/\.[a-z0-9]{1,6}$/i, '');
  s = s.replace(/\s*(--|—|–|-|_)\s*(MAT|DAT|BUS|HUM)\d{2}-\d+\s*$/i, '').replace(/^\s*(MAT|DAT|BUS|HUM)\d{2}-\d+\s*(--|—|–|-|_)\s*/i, '');
  s = s.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return s || String(name || '');
}

/** Rang naturel d’un support : numéro de TD, de séance, de chapitre… (null s’il n’y en a pas). */
export function rankOf(name) {
  let s = fold(displayTitle(name));
  s = s.replace(COURSE_CODE, ' ').replace(/\b(19|20)\d{2}(\s*[-/]\s*\d{2,4})?\b/g, ' ').replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
    .replace(/\b[lms]\d\b/g, ' ').replace(/\bl\d\s*\.\s*s\d\b/g, ' ').replace(/\bv\d+(\.\d+)*\b/g, ' ').replace(/\b\d+\s*(mo|ko|go|mb|kb|gb|px|min|h)\b/g, ' ');
  let m = s.match(RANK_RE);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 100 : 0);
  m = s.match(/^\s*[[(]\s*(\d{1,3})\s*[\])]/) || s.match(/^\s*(\d{1,3})\s*[-_.)\s]/);
  if (m) return Number(m[1]);
  m = s.match(/(?:^|[\s_-])(\d{1,3})(?=$|[\s_-])/);
  return m ? Number(m[1]) : null;
}

/**
 * Catégorie automatique d’un fichier.
 * @param {string} name nom du fichier
 * @param {{section?: string, folders?: string[], kind?: string, type?: string}} hints section Inside, dossiers parents, extension, type Obsidian
 */
export function classifyFile(name, hints = {}) {
  const ext = String(hints.kind || path.extname(String(name)).slice(1)).toLowerCase();
  const title = displayTitle(name);
  const text = fold(title);
  const folders = fold((hints.folders || []).join(' / '));
  const solution = SOLUTION.test(text);
  let category = null;
  const section = hints.section;
  if (section === 'Syllabus' || section === 'Overview' || section === 'Textbook') category = 'infos';
  else if (hints.type === 'exercice') category = 'td';
  else if (hints.type === 'cours') category = 'cours';
  else if (hints.type === 'projet') category = 'projets';
  if (!category) for (const [id, re] of RULES) {
    if (DATA_EXT.has(ext) && (id === 'cours' || id === 'infos')) continue;
    if (re.test(text)) { category = id; break; }
  }
  if (!category && solution) category = 'td';
  if (!category && DATA_EXT.has(ext)) category = 'donnees';
  if (!category) for (const [id, re] of RULES) if (id !== 'infos' && re.test(folders)) { category = id; break; }
  if (!category && SLIDE_EXT.has(ext)) category = 'cours';
  const infoRank = { Syllabus: 1, Overview: 2, Textbook: 3 }[section];
  const rank = hints.rank ?? infoRank ?? rankOf(name);
  if (!category && rank != null && (READ_EXT.has(ext) || SLIDE_EXT.has(ext))) category = 'cours';
  if (!category && READ_EXT.has(ext)) category = 'lectures';
  if (!category) category = 'autres';
  return { category, rank, solution, title };
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
/** Ordre automatique dans une catégorie : numérotés d’abord (TD1, TD1 corrigé, TD2…), puis ordre alphabétique naturel. */
export function compareAuto(a, b) {
  const ra = a.rank ?? null, rb = b.rank ?? null;
  if ((ra == null) !== (rb == null)) return ra == null ? 1 : -1;
  if (ra != null && ra !== rb) return ra - rb;
  if (!!a.solution !== !!b.solution) return a.solution ? 1 : -1;
  return collator.compare(a.title || a.name, b.title || b.name) || collator.compare(a.name, b.name);
}

/** Applique les choix manuels (catégorie, ordre) puis trie : renvoie [{category, label, files}] dans l’ordre des catégories. */
export function groupFiles(files, overrides = {}, keyOf = f => f.key || f.path) {
  const groups = new Map(CATEGORIES.map(c => [c.id, []]));
  for (const f of files) {
    const o = overrides[keyOf(f)] || {};
    const category = CATEGORY_IDS.includes(o.category) ? o.category : (f.category || 'autres');
    groups.get(category).push({ ...f, category, manualOrder: typeof o.order === 'number' ? o.order : null });
  }
  return CATEGORIES.map(c => {
    const list = groups.get(c.id);
    const auto = [...list].sort(compareAuto);
    const autoIndex = new Map(auto.map((f, i) => [f, i]));
    list.sort((a, b) => (a.manualOrder ?? autoIndex.get(a)) - (b.manualOrder ?? autoIndex.get(b)) || autoIndex.get(a) - autoIndex.get(b));
    return { category: c.id, label: c.label, files: list };
  }).filter(g => g.files.length);
}

// ---------- Cours probable d’un fichier « À classer » ----------
const STOP = new Set('a an and the of to in on for with by at from de des du la le les et en un une pour par sur dans au aux avec sans ou i ii iii iv v 1 2 3 introduction intro fundamentals foundations basics cours course students student for english french version'.split(' '));
const tokens = s => fold(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1 && !STOP.has(w));
export const UNIT_WORDS = {
  MAT11: ['math', 'maths', 'mathematique', 'mathematiques', 'mathematics', 'calcul', 'calculs', 'calculation', 'calculations', 'equation', 'equations', 'fraction', 'fractions', 'derivee', 'derivees', 'derivative', 'derivatives', 'integrale', 'integrales', 'integral', 'integrals', 'logarithme', 'logarithm', 'exponentielle', 'exponential', 'probabilite', 'probabilites', 'probability', 'combinatoire', 'combinatorics', 'algebre', 'algebra', 'matrice', 'matrix', 'vecteur', 'vector', 'statistique', 'statistiques', 'statistics', 'theoreme', 'preuve', 'proof', 'logique', 'logic', 'ensemble', 'ensembles', 'fonction', 'suite', 'limite', 'commandements'],
  DAT12: ['data', 'donnees', 'python', 'pandas', 'numpy', 'sql', 'excel', 'spreadsheet', 'spreadsheets', 'tableur', 'jupyter', 'notebook', 'dataframe', 'csv', 'programming', 'programmation', 'code', 'analytics', 'gsheet', 'sheets'],
  BUS13: ['business', 'marketing', 'finance', 'financial', 'comptabilite', 'accounting', 'bilan', 'economie', 'economics', 'microeconomie', 'microeconomics', 'entreprise', 'strategie', 'strategy', 'management', 'operations', 'supply', 'vente', 'sales', 'marche', 'market', 'bdd', 'synchrone', 'brief', 'consumer', 'brand'],
  HUM14: ['philosophie', 'philosophy', 'geopolitique', 'geopolitics', 'histoire', 'history', 'carriere', 'career', 'cv', 'linkedin', 'anglais', 'english', 'langue', 'language', 'ethique', 'ethics', 'workshop'],
};
/**
 * Propose un cours pour un fichier non classé.
 * @param {string} rel chemin relatif (dossiers + nom)
 * @param {{id, code, title, unit, keywords?: string[]}[]} courses
 * @returns {{courseId: string|null, unit: string|null, confidence: number, reason: string}}
 */
export function suggestCourse(rel, courses) {
  const parts = String(rel).split(/[\\/]/).filter(Boolean);
  const code = String(rel).match(/(?:^|[^A-Z0-9])((?:MAT|DAT|BUS|HUM)\d{2}-\d+)(?=$|[^0-9])/i)?.[1]?.toUpperCase();
  if (code) { const c = courses.find(x => x.code === code); if (c) return { courseId: c.id, unit: c.unit, confidence: 1, reason: `code ${code}` }; }
  let best = null;
  for (const c of courses) {
    const titleWords = new Set(tokens(c.title));
    if (!titleWords.size) continue;
    for (const seg of parts) {
      const words = tokens(seg.replace(/\.[a-z0-9]{1,6}$/i, ''));
      const common = words.filter(w => titleWords.has(w)).length;
      if (!common) continue;
      const score = common / Math.max(titleWords.size, Math.min(words.length, 6));
      if (common >= 2 || (common === 1 && titleWords.size === 1 && score >= 0.5)) {
        const value = Math.min(0.95, 0.55 + score / 2);
        if (!best || value > best.confidence) best = { courseId: c.id, unit: c.unit, confidence: value, reason: `dossier « ${seg} »` };
      }
    }
  }
  if (best) return best;
  const words = tokens(parts.join(' '));
  const blob = ` ${words.join(' ')} `;
  let kw = null;
  for (const c of courses) {
    const hits = (c.keywords || []).filter(k => k && blob.includes(` ${fold(k).trim()} `)).length;
    if (hits && (!kw || hits > kw.hits)) kw = { hits, c };
  }
  if (kw && kw.hits >= 2) return { courseId: kw.c.id, unit: kw.c.unit, confidence: Math.min(0.85, 0.5 + kw.hits * 0.1), reason: 'mots-clés du cours' };
  const units = Object.entries(UNIT_WORDS).map(([unit, list]) => [unit, words.filter(w => list.includes(w)).length]).sort((a, b) => b[1] - a[1]);
  if (units[0][1] > 0 && units[0][1] > (units[1]?.[1] || 0)) {
    const unit = units[0][0];
    const only = courses.filter(c => c.unit === unit);
    return { courseId: kw?.c.unit === unit ? kw.c.id : only.length === 1 ? only[0].id : null, unit, confidence: 0.4, reason: 'matière reconnue' };
  }
  return { courseId: null, unit: null, confidence: 0, reason: '' };
}

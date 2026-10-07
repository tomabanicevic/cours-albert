// Tri assisté par IA (facultatif) : ranger les publications d’un tableau en sections, proposer un cours aux fichiers « À classer ».
// Désactivé tant qu’aucune clé API n’est enregistrée ; le tri par règles fonctionne toujours sans IA.
// Fournisseur au choix : Claude (par défaut) ou une API compatible OpenAI (ChatGPT, Gemini, Mistral, DeepSeek, Grok, Groq, OpenRouter, Ollama…).
import fs from 'node:fs/promises';
import path from 'node:path';
import { CLAUDE_MODELS, PROVIDERS, providerById, checkKey, cleanBaseURL, OpenAICompatClient, pickModel, parseJSONText } from './llm.mjs';
// Le SDK n’est chargé qu’au premier appel à Claude : le serveur des espaces démarre sans lui.
let sdk = null;
const loadSDK = async () => (sdk ??= (await import('@anthropic-ai/sdk')).default);

export { CLAUDE_MODELS, PROVIDERS };
const DEFAULT_MODEL = 'claude-opus-5-5';
const SYSTEM = `Tu aides un étudiant à ranger ses contenus dans l’application Cours Albert. Tu réponds uniquement avec les données demandées, en français, sans inventer d’identifiants.`;

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const S = { type: 'string' };
const SCHEMAS = {
  organize: obj({ sections: { type: 'array', items: obj({ title: S, postIds: { type: 'array', items: S } }) } }),
  classify: obj({ files: { type: 'array', items: obj({ id: S, course: S, category: S }) } }),
};
const clip = (s, n) => String(s ?? '').slice(0, n);

/** Consigne d’une tâche ; la réponse suit le schéma JSON correspondant. */
export function buildPrompt(task, input = {}) {
  if (task === 'organize') {
    return `Range ces publications en 2 à 8 sections thématiques cohérentes${input.sections?.length ? ` (réutilise ces sections quand elles conviennent : ${input.sections.map(s => clip(s, 80)).join(' · ')})` : ''}.
Chaque identifiant doit apparaître exactement une fois. Titres de sections courts. Dans chaque section, ordonne les publications de façon logique (numéros croissants : TD1 avant TD2, chapitre 1 avant chapitre 2, du plus simple au plus avancé).

Publications :
${(input.posts || []).slice(0, 300).map(p => `- ${p.id} : ${clip(p.title, 150)} — ${clip(p.body, 300)}`).join('\n')}`;
  }
  if (task === 'classify') {
    return `Pour chaque fichier, choisis le cours le plus probable (code exact de la liste, ou chaîne vide si aucun ne convient vraiment) et la catégorie (identifiant exact de la liste).

Cours :
${(input.courses || []).slice(0, 60).map(c => `- ${clip(c.code, 20)} : ${clip(c.title, 120)}${c.keywords ? ` (mots-clés : ${clip(c.keywords, 300)})` : ''}`).join('\n')}

Catégories : ${(input.categories || []).map(c => `${c.id} (${c.label})`).join(' · ')}

Fichiers :
${(input.files || []).slice(0, 200).map(f => `- ${clip(f.id, 60)} : ${clip(f.name, 200)}${f.folder ? ` — dossier « ${clip(f.folder, 200)} »` : ''}`).join('\n')}`;
  }
  throw Object.assign(new Error('Tâche inconnue.'), { status: 400 });
}

export class AI {
  constructor({ supportDir, log = () => {}, fetch } = {}) {
    this.file = path.join(supportDir, 'ia.json');
    this.log = log;
    this.fetch = fetch;
    this.config = { enabled: false, provider: 'anthropic', keys: {}, models: { anthropic: DEFAULT_MODEL }, urls: {}, lists: {} };
    this.running = 0;
    this.history = [];
  }
  async load() {
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(this.file, 'utf8')); } catch {}
    const c = this.config;
    c.enabled = !!saved.enabled;
    c.provider = PROVIDERS.some(p => p.id === saved.provider) ? saved.provider : 'anthropic';
    for (const k of ['keys', 'models', 'urls', 'lists']) if (saved[k] && typeof saved[k] === 'object') c[k] = { ...c[k], ...saved[k] };
    // Ancien format (une seule clé Claude) : repris tel quel.
    if (saved.apiKey && !c.keys.anthropic) c.keys.anthropic = saved.apiKey;
    if (saved.model && CLAUDE_MODELS.some(m => m.id === saved.model) && !saved.models) c.models.anthropic = saved.model;
    if (!CLAUDE_MODELS.some(m => m.id === c.models.anthropic)) c.models.anthropic = DEFAULT_MODEL;
    return this;
  }
  async save() {
    const { enabled, provider, keys, models, urls, lists } = this.config;
    await fs.writeFile(this.file, JSON.stringify({ enabled, provider, keys, models, urls, lists }, null, 2), { mode: 0o600 });
    await fs.chmod(this.file, 0o600).catch(() => {});
  }
  /** Fournisseur, clé, modèle et adresse en cours. Adresse modifiable pour tous les fournisseurs ;
   *  une adresse autre que l’officielle a sa propre clé et son propre modèle (emplacement « fournisseur:custom »). */
  current(id = this.config.provider) {
    const p = providerById(id);
    const c = this.config;
    const url = c.urls[p.id] || '';
    const custom = !!(url && p.base && url !== p.base && !p.editableURL);
    const slot = custom ? `${p.id}:custom` : p.id;
    let model = c.models[slot] || (p.id === 'anthropic' ? DEFAULT_MODEL : '');
    if (p.id === 'anthropic' && !custom && !CLAUDE_MODELS.some(m => m.id === model)) model = DEFAULT_MODEL;
    return { provider: p.id, def: p, slot, custom, key: c.keys[slot] || '', model, baseURL: url || p.base || '', defaultURL: p.base || '' };
  }
  isConfigured(id) {
    const cur = this.current(id);
    if (cur.def.noKey || cur.def.optionalKey || (cur.custom && cur.provider === 'anthropic')) return !!(cur.baseURL && cur.model);
    return !!(cur.key && cur.model);
  }
  async setConfig(patch = {}) {
    const c = this.config;
    if (typeof patch.provider === 'string') {
      if (!PROVIDERS.some(p => p.id === patch.provider)) throw Object.assign(new Error('Fournisseur d’IA inconnu.'), { status: 400 });
      c.provider = patch.provider;
    }
    if (typeof patch.baseURL === 'string') {
      const def = providerById(c.provider);
      const url = cleanBaseURL(patch.baseURL);
      if (!url || (def.base && url === def.base.replace(/\/+$/, ''))) delete c.urls[def.id]; else c.urls[def.id] = url;
    }
    const cur = this.current();
    if (typeof patch.apiKey === 'string') {
      const key = checkKey(cur.provider, patch.apiKey.trim(), { custom: cur.custom });
      if (key) c.keys[cur.slot] = key; else delete c.keys[cur.slot];
      if (key && patch.enabled === undefined) c.enabled = true;
    }
    if (typeof patch.model === 'string') {
      const model = patch.model.trim().slice(0, 200);
      if (cur.provider === 'anthropic' && !cur.custom) { if (CLAUDE_MODELS.some(m => m.id === model)) c.models.anthropic = model; }
      else if (model && /^[\w.:/@+-]+$/.test(model)) c.models[cur.slot] = model;
      else if (model) throw Object.assign(new Error('Nom de modèle invalide.'), { status: 400 });
    }
    if (typeof patch.enabled === 'boolean') c.enabled = patch.enabled;
    // Pas encore de modèle choisi : on prend le meilleur de la liste de l’API (ou une suggestion).
    const now = this.current();
    if (now.provider !== 'anthropic' && !now.model && (now.key || now.def.noKey || now.def.optionalKey)) {
      const ids = await this.listModels().catch(e => { this.log(`Modèles ${now.def.short} : ${e.message}`); return []; });
      const pick = pickModel(now.provider, ids);
      if (pick) c.models[now.slot] = pick;
    }
    if (now.def.noKey && patch.provider && c.enabled === false && this.isConfigured()) c.enabled = true;
    await this.save();
    return this.status();
  }
  status() {
    const cur = this.current();
    const mask = k => k ? `${k.slice(0, Math.min(7, Math.max(3, k.length - 8)))}…${k.slice(-4)}` : '';
    const configured = this.isConfigured();
    const official = cur.provider === 'anthropic' && !cur.custom;
    const models = official ? CLAUDE_MODELS
      : [...new Set([cur.model, ...(this.config.lists[cur.slot] || []), ...(cur.def.suggest || []), ...(cur.provider === 'anthropic' ? CLAUDE_MODELS.map(m => m.id) : [])].filter(Boolean))].map(id => ({ id, label: id }));
    return {
      enabled: !!(this.config.enabled && configured), configured, provider: cur.provider, providerLabel: cur.def.label, providerShort: cur.def.short,
      model: cur.model, key: mask(cur.key), baseURL: cur.baseURL, defaultURL: cur.defaultURL, customURL: cur.custom, freeModel: !official, models,
      providers: PROVIDERS.map(p => ({ id: p.id, label: p.label, short: p.short, console: p.console || '', keyHint: p.keyHint || '', noKey: !!p.noKey, optionalKey: !!p.optionalKey, editableURL: !!p.editableURL, configured: this.isConfigured(p.id), defaultURL: p.base || '' })),
    };
  }
  /** Client avec l’interface `beta.messages.create` de l’API Anthropic, quel que soit le fournisseur. */
  async client({ timeout = 180_000 } = {}) {
    const cur = this.current();
    if (cur.provider === 'anthropic') {
      const Anthropic = await loadSDK();
      if (!cur.custom) return new Anthropic({ apiKey: cur.key, timeout, maxRetries: 2 });
      // Passerelle compatible Anthropic (LiteLLM, proxy d’entreprise…) : seulement les paramètres standard de l’API Messages.
      const gw = new Anthropic({ apiKey: cur.key || 'aucune-cle', baseURL: cur.baseURL.replace(/\/v1$/, ''), timeout, maxRetries: 2, fetch: this.fetch });
      const create = (params = {}, opts) => {
        const { betas, fallbacks, output_config, ...rest } = params;
        if (output_config?.format?.schema) rest.system = `${typeof rest.system === 'string' ? rest.system : ''}\n\nRéponds uniquement avec un objet JSON valide (sans texte autour) qui suit ce schéma JSON :\n${JSON.stringify(output_config.format.schema)}`;
        return gw.messages.create(rest, opts);
      };
      return { beta: { messages: { create } }, messages: { create }, models: gw.models };
    }
    return new OpenAICompatClient({ provider: cur.provider, baseURL: cur.baseURL, apiKey: cur.key, timeout, fetch: this.fetch });
  }
  /** Liste des modèles du fournisseur en cours (mise en cache dans ia.json). */
  async listModels() {
    const cur = this.current();
    let ids;
    if (cur.provider === 'anthropic') {
      if (!cur.custom) return CLAUDE_MODELS.map(m => m.id);
      ids = [];
      const client = await this.client({ timeout: 30_000 });
      for await (const m of client.models.list({ limit: 100 })) { if (m?.id) ids.push(String(m.id)); if (ids.length >= 1000) break; }
      ids = [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    } else {
      if (!cur.key && !cur.def.noKey && !cur.def.optionalKey) throw Object.assign(new Error(`Ajoutez d’abord votre clé ${cur.def.short}.`), { status: 409 });
      ids = await new OpenAICompatClient({ provider: cur.provider, baseURL: cur.baseURL, apiKey: cur.key, timeout: 30_000, fetch: this.fetch }).listModels();
    }
    this.config.lists[cur.slot] = ids.slice(0, 1000);
    await this.save();
    return ids;
  }
  /** Paramètres propres à l’API officielle de Claude (jamais envoyés aux autres API ni aux passerelles). */
  extras() {
    const cur = this.current();
    return cur.provider === 'anthropic' && !cur.custom ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {};
  }
  /** Exécute une tâche de tri ; renvoie l’objet décrit par SCHEMAS[task]. */
  async run(task, input = {}) {
    if (!SCHEMAS[task]) throw Object.assign(new Error('Tâche inconnue.'), { status: 400 });
    if (!this.status().enabled) throw Object.assign(new Error('Le tri par IA est désactivé. Ajoutez une clé API dans Réglages › IA.'), { status: 409 });
    const now = Date.now();
    this.history = this.history.filter(t => now - t < 60_000);
    if (this.history.length >= 20 || this.running >= 2) throw Object.assign(new Error('Trop de demandes de tri en même temps. Patientez un instant.'), { status: 429 });
    this.history.push(now);
    this.running++;
    const cur = this.current();
    try {
      const client = await this.client();
      let response;
      try {
        response = await client.beta.messages.create({
          model: cur.model,
          max_tokens: 16000,
          ...this.extras(),
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMAS[task] } },
          system: SYSTEM,
          messages: [{ role: 'user', content: buildPrompt(task, input) }],
        });
      } catch (e) {
        const A = sdk;
        if (cur.provider === 'anthropic' && A) {
          if (e instanceof A.AuthenticationError) throw Object.assign(new Error('Clé API Claude refusée : vérifiez-la dans Réglages › IA.'), { status: 401 });
          if (e instanceof A.PermissionDeniedError) throw Object.assign(new Error('Cette clé API n’a pas accès à ce modèle.'), { status: 403 });
          if (e instanceof A.RateLimitError) throw Object.assign(new Error('Limite d’utilisation de l’API atteinte. Réessayez dans un moment.'), { status: 429 });
          if (e instanceof A.BadRequestError) throw Object.assign(new Error(`Demande refusée par l’API : ${String(e.message).slice(0, 200)}`), { status: 400 });
          if (e instanceof A.APIConnectionError) throw Object.assign(new Error('Impossible de joindre l’API Claude : vérifiez la connexion internet.'), { status: 503 });
          if (e instanceof A.APIError) throw Object.assign(new Error(`Erreur de l’API Claude (${e.status ?? '?'}).`), { status: 502 });
        }
        throw e;
      }
      if (response.stop_reason === 'refusal') throw Object.assign(new Error('L’IA a refusé cette demande.'), { status: 422 });
      if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('Trop d’éléments à trier d’un coup.'), { status: 502 });
      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
      try { return parseJSONText(text); }
      catch { throw Object.assign(new Error('Réponse de l’IA illisible.'), { status: 502 }); }
    } finally { this.running--; }
  }
}

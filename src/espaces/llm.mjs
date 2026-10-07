// Fournisseurs d’IA : Claude (SDK Anthropic, recommandé ; adresse modifiable pour une passerelle compatible Anthropic) ou n’importe quelle API compatible OpenAI (ChatGPT, Gemini, Mistral, DeepSeek, Grok, Groq, OpenRouter, Ollama…).
// Pour les API compatibles OpenAI, un adaptateur imite `client.beta.messages.create` : le tri et l’assistant gardent le même format de messages
// (blocs text / tool_use / tool_result) quel que soit le fournisseur, et une conversation peut changer de fournisseur en cours de route.
import crypto from 'node:crypto';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recommandé)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (plus rapide)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (le plus économique)' },
];

// prefer : modèles choisis par défaut, dans l’ordre, quand la liste de l’API les contient (sinon le premier de la liste).
export const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic) — recommandé', short: 'Claude', base: 'https://api.anthropic.com', console: 'console.anthropic.com', keyHint: 'sk-ant-…', native: true },
  { id: 'openai', label: 'ChatGPT (OpenAI)', short: 'OpenAI', base: 'https://api.openai.com/v1', console: 'platform.openai.com', keyHint: 'sk-…', prefer: [/^gpt-\d+(\.\d+)?$/, /^gpt-\d/], suggest: ['gpt-5', 'gpt-5-mini'] },
  { id: 'gemini', label: 'Gemini (Google)', short: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', console: 'aistudio.google.com', keyHint: 'AIza…', prefer: [/^gemini-pro-latest$/, /^gemini-[\d.]+-pro$/, /^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/], suggest: ['gemini-pro-latest', 'gemini-flash-latest'] },
  { id: 'mistral', label: 'Mistral (Le Chat)', short: 'Mistral', base: 'https://api.mistral.ai/v1', console: 'console.mistral.ai', keyHint: 'clé Mistral', prefer: [/^mistral-large-latest$/, /^mistral-medium-latest$/], suggest: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest'] },
  { id: 'deepseek', label: 'DeepSeek', short: 'DeepSeek', base: 'https://api.deepseek.com/v1', console: 'platform.deepseek.com', keyHint: 'sk-…', prefer: [/^deepseek-chat$/], suggest: ['deepseek-chat'] },
  { id: 'xai', label: 'Grok (xAI)', short: 'Grok', base: 'https://api.x.ai/v1', console: 'console.x.ai', keyHint: 'xai-…', prefer: [/^grok-\d+(\.\d+)?(-latest)?$/, /^grok/], suggest: ['grok-4'] },
  { id: 'groq', label: 'Groq', short: 'Groq', base: 'https://api.groq.com/openai/v1', console: 'console.groq.com', keyHint: 'gsk_…', prefer: [/gpt-oss-120b/, /llama.*70b/], suggest: ['openai/gpt-oss-120b'] },
  { id: 'openrouter', label: 'OpenRouter (des centaines de modèles)', short: 'OpenRouter', base: 'https://openrouter.ai/api/v1', console: 'openrouter.ai/keys', keyHint: 'sk-or-…', prefer: [/^openrouter\/auto$/], suggest: ['openrouter/auto'] },
  { id: 'ollama', label: 'Ollama (modèles sur ce Mac, sans clé)', short: 'Ollama', base: 'http://127.0.0.1:11434/v1', console: 'ollama.com', noKey: true, editableURL: true, suggest: [] },
  { id: 'custom', label: 'Autre API compatible OpenAI', short: 'API', base: '', keyHint: 'clé (facultative)', optionalKey: true, editableURL: true, suggest: [] },
];
export const providerById = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

const err = (message, status = 400, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/i;

/** Adresse d’API acceptée : https partout, http seulement sur ce Mac ou le réseau local (la clé ne part jamais en clair sur internet). */
export function cleanBaseURL(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch { throw err('Adresse d’API invalide (exemple : https://exemple.com/v1).'); }
  if (u.username || u.password) throw err('L’adresse ne doit pas contenir d’identifiants : mettez la clé dans le champ « clé ».');
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOST.test(u.hostname))) throw err('Utilisez une adresse https (http seulement pour un serveur sur ce Mac ou le réseau local).');
  return u.toString().replace(/\/+$/, '');
}

/** Clé plausible pour ce fournisseur (vérification locale, sans appel réseau). */
export function checkKey(provider, key, { custom = false } = {}) {
  const p = providerById(provider);
  if (!key) return '';
  if (p.id === 'anthropic' && !custom && !/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) throw err('Cette clé ne ressemble pas à une clé API Anthropic (sk-ant-…). Pour une passerelle compatible, changez d’abord l’adresse de l’API.');
  if (!/^[\x21-\x7e]{8,400}$/.test(key)) throw err(`Cette clé ne ressemble pas à une clé API ${p.short} (pas d’espaces, au moins 8 caractères).`);
  return key;
}

// ——— Conversion des messages (format Anthropic ⇄ format OpenAI) ———

const textOf = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(b => typeof b === 'string' ? b : b?.type === 'text' ? b.text : '').join('') : '';
const safeId = id => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || `call_${crypto.randomBytes(9).toString('hex')}`;
// Mistral n’accepte que des identifiants d’appel de 9 caractères alphanumériques : on les dérive de façon stable.
const mistralId = id => /^[A-Za-z0-9]{9}$/.test(id) ? id : crypto.createHash('sha256').update(String(id)).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 9).padEnd(9, '0');

export function toOpenAIMessages(system, messages = [], provider = 'custom') {
  const fixId = provider === 'mistral' ? mistralId : safeId;
  const out = [];
  if (system) out.push({ role: 'system', content: textOf(system) });
  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') { out.push({ role: 'user', content: m.content }); continue; }
      const blocks = Array.isArray(m.content) ? m.content : [];
      for (const b of blocks) if (b?.type === 'tool_result') out.push({ role: 'tool', tool_call_id: fixId(b.tool_use_id), content: (b.is_error ? 'Erreur : ' : '') + (textOf(b.content) || '(vide)') });
      const text = blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content || []);
      const text = blocks.filter(b => b?.type === 'text').map(b => b.text).join('');
      const calls = blocks.filter(b => b?.type === 'tool_use').map(b => ({ id: fixId(b.id), type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      const msg = { role: 'assistant', content: text || (calls.length ? null : '…') };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
    }
  }
  return out;
}

// Gemini n’accepte qu’une partie de JSON Schema (pas d’additionalProperties, de default…) : on retire le reste.
const GEMINI_KEYS = new Set(['type', 'format', 'description', 'nullable', 'enum', 'maxItems', 'minItems', 'properties', 'required', 'items', 'minimum', 'maximum', 'anyOf', 'title']);
export function cleanSchema(schema, provider) {
  if (provider !== 'gemini' || !schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(s => cleanSchema(s, provider));
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (!GEMINI_KEYS.has(k)) continue;
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v || {}).map(([name, sub]) => [name, cleanSchema(sub, provider)]));
    else if (k === 'items' || k === 'anyOf') out[k] = cleanSchema(v, provider);
    else out[k] = v;
  }
  return out;
}

export function toOpenAITools(tools = [], provider = 'custom') {
  return tools.map(t => ({ type: 'function', function: { name: t.name, description: String(t.description || '').slice(0, 1024), parameters: cleanSchema(t.input_schema || { type: 'object', properties: {} }, provider) } }));
}

const STOP = { stop: 'end_turn', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' };

export function fromOpenAIResponse(data) {
  const choice = data?.choices?.[0];
  if (!choice) throw err(data?.error?.message ? `Réponse de l’API : ${String(data.error.message).slice(0, 200)}` : 'Réponse de l’API vide.', 502);
  const msg = choice.message || {};
  const content = [];
  const text = textOf(msg.content);
  if (text) content.push({ type: 'text', text });
  if (msg.refusal) content.push({ type: 'text', text: String(msg.refusal) });
  for (const c of msg.tool_calls || []) {
    if (c?.type && c.type !== 'function') continue;
    let input = {};
    const args = c?.function?.arguments;
    if (args && typeof args === 'object') input = args;
    else if (args) { try { input = JSON.parse(args); } catch { input = { _brut: String(args).slice(0, 2000) }; } }
    content.push({ type: 'tool_use', id: safeId(c.id), name: String(c?.function?.name || ''), input: input && typeof input === 'object' ? input : {} });
  }
  let stop = STOP[choice.finish_reason] || 'end_turn';
  if (content.some(b => b.type === 'tool_use')) stop = 'tool_use';
  if (msg.refusal && !text) stop = 'refusal';
  return { content, stop_reason: stop, model: data.model };
}

/** Texte JSON d’une réponse (tolère les blocs ```json et le texte autour). */
export function parseJSONText(text) {
  const s = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('JSON introuvable');
}

// ——— Client compatible OpenAI ———

export class OpenAICompatClient {
  constructor({ provider = 'custom', baseURL, apiKey = '', timeout = 180_000, fetch: f = globalThis.fetch } = {}) {
    this.provider = providerById(provider);
    this.baseURL = String(baseURL || this.provider.base || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeout = timeout;
    this.fetch = f;
    this.beta = { messages: { create: (params, opts) => this.create(params, opts) } };
    this.messages = this.beta.messages;
  }
  headers() {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    if (this.provider.id === 'openrouter') { h['HTTP-Referer'] = 'https://cours-albert.local'; h['X-Title'] = 'Cours Albert'; }
    return h;
  }
  async request(method, pathname, body, signal) {
    if (!this.baseURL) throw err('Indiquez l’adresse de l’API dans Réglages › IA.', 409);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new Error('timeout')), this.timeout);
    const onAbort = () => ctl.abort(signal.reason);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    let res;
    try {
      res = await this.fetch(`${this.baseURL}${pathname}`, { method, headers: this.headers(), body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('Arrêté.'), { aborted: true });
      if (ctl.signal.aborted) throw err(`${this.provider.short} n’a pas répondu à temps.`, 504);
      throw err(this.provider.id === 'ollama' ? 'Ollama ne répond pas : ouvrez l’app Ollama sur ce Mac.' : `Impossible de joindre l’API ${this.provider.short} : vérifiez la connexion internet${this.provider.editableURL ? ' et l’adresse' : ''}.`, 503);
    } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); }
    const raw = await res.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!res.ok) {
      const detail = String((Array.isArray(data) ? data[0] : data)?.error?.message || data?.message || data?.detail || raw || '').replace(/\s+/g, ' ').slice(0, 240);
      const name = this.provider.short;
      if (res.status === 401) throw err(`Clé API ${name} refusée : vérifiez-la dans Réglages › IA.`, 401, { detail });
      if (res.status === 403) throw err(`Cette clé ${name} n’a pas accès à ce modèle${detail ? ` (${detail})` : ''}.`, 403, { detail });
      if (res.status === 404) throw err(`Modèle ou adresse introuvable chez ${name}${detail ? ` : ${detail}` : ''}.`, 404, { detail });
      if (res.status === 429) throw err(`Limite d’utilisation de l’API ${name} atteinte (ou crédit épuisé). Réessayez dans un moment.`, 429, { detail });
      if (res.status === 400 || res.status === 422) throw err(`Demande refusée par l’API ${name} : ${detail}`, 400, { detail });
      throw err(`Erreur de l’API ${name} (${res.status}).`, 502, { detail });
    }
    if (data == null) throw err(`Réponse illisible de l’API ${this.provider.short}.`, 502);
    return data;
  }
  /** Même signature que l’API Anthropic : { model, system, messages, tools, output_config: { format } }. */
  async create(params = {}, { signal } = {}) {
    const format = params.output_config?.format;
    let system = textOf(params.system);
    if (format?.schema) system += `\n\nRéponds uniquement avec un objet JSON valide (sans texte autour) qui suit ce schéma JSON :\n${JSON.stringify(format.schema)}`;
    const body = { model: params.model, messages: toOpenAIMessages(system, params.messages, this.provider.id) };
    if (params.tools?.length) body.tools = toOpenAITools(params.tools, this.provider.id);
    // Sortie JSON : schéma strict si l’API le connaît, sinon « objet JSON », sinon simple consigne.
    const modes = format?.schema ? [{ type: 'json_schema', json_schema: { name: 'reponse', schema: cleanSchema(format.schema, this.provider.id), strict: this.provider.id !== 'gemini' } }, { type: 'json_object' }, null] : [null];
    let last;
    for (const mode of modes) {
      const req = mode ? { ...body, response_format: mode } : body;
      try { return fromOpenAIResponse(await this.request('POST', '/chat/completions', req, signal)); }
      catch (e) { last = e; if (!(mode && e.status === 400)) throw e; }
    }
    throw last;
  }
  /** Modèles proposés par l’API (sans les modèles d’images, de voix ou d’embeddings). */
  async listModels() {
    const data = await this.request('GET', '/models');
    const list = Array.isArray(data) ? data : data.data || data.models || [];
    const ids = list.map(m => String(m.id || m.name || m.model || '').replace(/^models\//, '')).filter(Boolean)
      .filter(id => !/(embed|tts|whisper|dall-e|davinci|babbage|moderation|transcri|audio|realtime|image|imagen|veo|aqa|rerank|search-preview|computer-use|sora|ocr|guard)/i.test(id));
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  }
}

/** Modèle par défaut parmi ceux que l’API propose. */
export function pickModel(provider, ids = []) {
  const p = providerById(provider);
  for (const re of p.prefer || []) {
    const hits = ids.filter(id => re.test(id));
    if (hits.length) return hits.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  }
  return ids[0] || p.suggest?.[0] || '';
}

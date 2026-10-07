// IA multi-fournisseurs : conversions de messages, réglages (ancienne clé Claude reprise), tri et assistant via une fausse API compatible OpenAI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AI } from '../src/espaces/ai.mjs';
import { Store } from '../src/espaces/store.mjs';
import { Assistant } from '../src/espaces/agent.mjs';
import { toOpenAIMessages, fromOpenAIResponse, cleanSchema, cleanBaseURL, checkKey, pickModel, parseJSONText, PROVIDERS } from '../src/espaces/llm.mjs';

// ——— Conversions ———
const conv = toOpenAIMessages('Système', [
  { role: 'user', content: 'Range mes notes' },
  { role: 'assistant', content: [{ type: 'text', text: 'Je regarde.' }, { type: 'tool_use', id: 'toolu_01AbC', name: 'lister_dossier', input: { chemin: 'vault' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01AbC', content: '01 Maths/' }, { type: 'text', text: 'et vite' }] },
]);
assert.deepEqual(conv.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'user']);
assert.equal(conv[2].tool_calls[0].id, 'toolu_01AbC');
assert.equal(JSON.parse(conv[2].tool_calls[0].function.arguments).chemin, 'vault');
assert.equal(conv[3].tool_call_id, 'toolu_01AbC');
const mi = toOpenAIMessages('', [{ role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01AbC', name: 'x', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01AbC', content: 'ok' }] }], 'mistral');
assert.match(mi[0].tool_calls[0].id, /^[A-Za-z0-9]{9}$/);
assert.equal(mi[0].tool_calls[0].id, mi[1].tool_call_id, 'identifiants Mistral cohérents');
const back = fromOpenAIResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'chercher', arguments: '{"requete":"TD1"}' } }] } }] });
assert.equal(back.stop_reason, 'tool_use');
assert.deepEqual(back.content, [{ type: 'tool_use', id: 'call_9', name: 'chercher', input: { requete: 'TD1' } }]);
assert.equal(fromOpenAIResponse({ choices: [{ finish_reason: 'stop', message: { content: 'Fini.' } }] }).stop_reason, 'end_turn');
const sch = cleanSchema({ type: 'object', additionalProperties: false, properties: { a: { type: 'integer', minimum: 1, default: 2 } }, required: ['a'] }, 'gemini');
assert.deepEqual(sch, { type: 'object', properties: { a: { type: 'integer', minimum: 1 } }, required: ['a'] });
assert.equal(cleanSchema({ additionalProperties: false }, 'openai').additionalProperties, false);
assert.equal(cleanBaseURL('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
assert.equal(cleanBaseURL('https://api.exemple.com/v1/chat/completions'), 'https://api.exemple.com/v1');
assert.throws(() => cleanBaseURL('http://api.exemple.com/v1'), /https/);
assert.throws(() => cleanBaseURL('https://moi:secret@exemple.com'), /identifiants/);
assert.throws(() => checkKey('anthropic', 'sk-proj-abc'), /Anthropic/);
assert.throws(() => checkKey('openai', 'sk abc def ghi'), /OpenAI/);
assert.equal(checkKey('gemini', 'AIzaSyD-exemple-123'), 'AIzaSyD-exemple-123');
assert.equal(pickModel('openai', ['gpt-4.1', 'gpt-5', 'gpt-5.1', 'gpt-5-mini', 'o3']), 'gpt-5.1');
assert.equal(pickModel('mistral', ['codestral-latest', 'mistral-large-latest']), 'mistral-large-latest');
assert.equal(pickModel('ollama', ['qwen3:8b']), 'qwen3:8b');
assert.deepEqual(parseJSONText('Voici :\n```json\n{"a":1}\n```'), { a: 1 });
assert.ok(PROVIDERS.length >= 9);

// ——— Fausse API compatible OpenAI ———
const calls = [];
let phase = 'classify';
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const b = body ? JSON.parse(body) : null;
  calls.push({ url: req.url, auth: req.headers.authorization || '', apiKey: req.headers['x-api-key'] || '', beta: req.headers['anthropic-beta'] || '', body: b });
  if (req.url.split('?')[0] === '/v1/messages') {
    // Passerelle compatible Anthropic : seulement les paramètres standard.
    assert.equal(b.output_config, undefined); assert.equal(b.betas, undefined); assert.equal(b.fallbacks, undefined);
    assert.match(String(b.system), /schéma JSON/);
    return json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: '{"files":[{"id":"f1","course":"DAT12-1","category":"cours"}]}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  }
  if (req.url.split('?')[0] === '/v1/models') return json(200, { data: [{ id: 'text-embedding-3' }, { id: 'modele-b' }, { id: 'modele-a' }] });
  if (req.url !== '/v1/chat/completions') return json(404, { error: { message: 'introuvable' } });
  if (phase === 'classify') {
    if (b.response_format?.type === 'json_schema') return json(400, { error: { message: 'response_format json_schema non pris en charge' } });
    assert.equal(b.response_format?.type, 'json_object');
    assert.match(b.messages[0].content, /schéma JSON/);
    return json(200, { choices: [{ finish_reason: 'stop', message: { content: '```json\n{"files":[{"id":"f1","course":"MAT11-1","category":"td"}]}\n```' } }] });
  }
  // Assistant : 1) appel d’outil, 2) réponse finale après avoir reçu le résultat de l’outil.
  assert.ok(Array.isArray(b.tools) && b.tools.some(t => t.function.name === 'lister_dossier'));
  const tool = b.messages.find(m => m.role === 'tool');
  if (!tool) return json(200, { choices: [{ finish_reason: 'tool_calls', message: { content: 'Je regarde le vault.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lister_dossier', arguments: '{"chemin":"vault"}' } }] } }] });
  assert.equal(tool.tool_call_id, 'call_1');
  assert.match(tool.content, /01 Maths/);
  return json(200, { choices: [{ finish_reason: 'stop', message: { content: 'Ton vault contient 01 Maths.' } }] });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/v1`;

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-ia-'));
const support = path.join(root, 'support'), vault = path.join(root, 'Vault');
await fs.mkdir(path.join(vault, '01 Maths'), { recursive: true });
await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
await fs.writeFile(path.join(vault, '.obsidian', 'app.json'), '{}');
await fs.mkdir(support, { recursive: true });
// Ancien réglage (3.1) : une seule clé Claude.
await fs.writeFile(path.join(support, 'ia.json'), JSON.stringify({ enabled: true, apiKey: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', model: 'claude-sonnet-5-5' }));
const ai = await new AI({ supportDir: support }).load();
let st = ai.status();
assert.equal(st.provider, 'anthropic');
assert.equal(st.enabled, true);
assert.equal(st.model, 'claude-sonnet-5-5');
assert.match(st.key, /^sk-ant-…|^sk-ant-/);

st = await ai.setConfig({ provider: 'custom', baseURL: base });
assert.equal(st.provider, 'custom');
assert.equal(st.model, 'modele-a', 'modèle choisi dans la liste de l’API (sans les embeddings)');
assert.equal(st.configured, true);
assert.equal(st.enabled, true);
assert.ok(st.models.some(m => m.id === 'modele-b'));
assert.equal(st.providers.find(p => p.id === 'anthropic').configured, true, 'la clé Claude est gardée');

const result = await ai.run('classify', { files: [{ id: 'f1', name: 'TD1 -- MAT11-1.pdf' }], courses: [{ code: 'MAT11-1', title: 'Foundations' }], categories: [{ id: 'td', label: 'TD' }] });
assert.deepEqual(result, { files: [{ id: 'f1', course: 'MAT11-1', category: 'td' }] });
assert.equal(calls.filter(c => c.url === '/v1/chat/completions').length, 2, 'json_schema refusé puis json_object');
assert.equal(calls.at(-1).auth, '', 'pas de clé envoyée quand il n’y en a pas');

st = await ai.setConfig({ apiKey: 'cle-locale-12345' });
phase = 'agent';
const store = await new Store({ root: path.join(support, 'Espaces') }).load();
const viewer = { id: 'owner', name: 'Alex', role: 'owner', isOwner: true, group: null };
const assistant = await new Assistant({ ai, store, supportDir: support, vault, libraries: [vault], ownerViewer: () => viewer }).load();
assert.equal((await assistant.status()).provider, 'API');
const events = [];
for await (const ev of assistant.chat({ message: 'Qu’y a-t-il dans mon vault ?' })) events.push(ev);
assert.ok(events.some(e => e.type === 'action' && e.status === 'ok' && e.tool === 'lister_dossier'), JSON.stringify(events));
assert.ok(events.some(e => e.type === 'text' && /01 Maths/.test(e.text)));
assert.equal(events.at(-1).type, 'done');
assert.equal(calls.at(-1).auth, 'Bearer cle-locale-12345');

// Adresse modifiable pour tous les fournisseurs : OpenAI vers un proxy, puis retour à l’adresse officielle.
st = await ai.setConfig({ provider: 'openai', baseURL: base });
assert.equal(st.baseURL, base); assert.equal(st.customURL, true);
st = await ai.setConfig({ baseURL: '' });
assert.equal(st.baseURL, 'https://api.openai.com/v1'); assert.equal(st.customURL, false);
await assert.rejects(ai.setConfig({ baseURL: 'http://exemple.com/v1' }), /https/);

// Claude par une passerelle compatible Anthropic : clé libre, modèle libre, aucun paramètre propre à l’API officielle.
st = await ai.setConfig({ provider: 'anthropic', baseURL: base, apiKey: 'cle-passerelle-123', model: 'mon-modele' });
assert.equal(st.customURL, true); assert.equal(st.freeModel, true); assert.equal(st.model, 'mon-modele'); assert.equal(st.configured, true);
const gw = await ai.run('classify', { files: [{ id: 'f1', name: 'cours.pdf' }], courses: [{ code: 'DAT12-1', title: 'Spreadsheet' }], categories: [{ id: 'cours', label: 'Cours' }] });
assert.equal(gw.files[0].course, 'DAT12-1');
const last = calls.filter(c => c.url.startsWith('/v1/messages')).at(-1);
assert.equal(last.apiKey, 'cle-passerelle-123'); assert.equal(last.beta, '');
assert.ok((await ai.listModels()).includes('modele-a'), 'liste des modèles de la passerelle');
// Retour à l’adresse officielle : la vraie clé Claude et le modèle choisi avant sont intacts.
st = await ai.setConfig({ baseURL: '' });
assert.equal(st.customURL, false); assert.equal(st.model, 'claude-sonnet-5-5'); assert.match(st.key, /^sk-ant/);
assert.equal(ai.extras().fallbacks, 'default');

// Retour à Claude : la clé et le modèle d’avant sont toujours là ; ia.json reste privé.
st = await ai.setConfig({ provider: 'anthropic' });
assert.equal(st.model, 'claude-sonnet-5-5');
assert.equal(st.enabled, true);
await assert.rejects(ai.setConfig({ provider: 'openai', apiKey: 'sk abc def ghi' }), /OpenAI/);
const saved = JSON.parse(await fs.readFile(path.join(support, 'ia.json'), 'utf8'));
assert.equal(saved.keys.custom, 'cle-locale-12345');
assert.equal(saved.keys['anthropic:custom'], 'cle-passerelle-123');
assert.equal(saved.urls.custom, base);
assert.equal(saved.apiKey, undefined, 'ancien champ remplacé');
assert.equal((await fs.stat(path.join(support, 'ia.json'))).mode & 0o777, 0o600);

server.close();
await fs.rm(root, { recursive: true, force: true });
console.log('fournisseurs.test.mjs : OK (Claude recommandé, adresse modifiable, passerelle Anthropic, ChatGPT, Gemini, Mistral, Ollama, API compatibles OpenAI)');

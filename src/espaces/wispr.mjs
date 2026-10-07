// Connexion à Wispr Flow (serveur MCP distant, autorisation OAuth avec PKCE et enregistrement dynamique du client).
// Lecture seule côté Wispr : notes (scratchpad) et réunions enregistrées. Les notes sont importées dans le vault
// (00_Inbox/Wispr, puis rangées par cours par le script du vault s’il existe) ou dans un dossier de notes de l’app.
// Jetons enregistrés dans wispr.json (0600) dans le dossier de données : jamais dans l’app ni le DMG.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';

export const WISPR_MCP = 'https://api.wisprflow.ai/connect/mcp';
const PROTOCOL = '2025-06-18';
const b64url = buf => Buffer.from(buf).toString('base64url');
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const exists = p => fs.stat(p).then(() => true, () => false);
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n… (tronqué)` : s; };
const safeName = s => String(s || '').normalize('NFC').replace(/[\\/:*?"<>|#^[\]\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Note Wispr';

/** Lit une réponse MCP : JSON simple ou flux SSE (on garde le message qui porte l’identifiant attendu). */
export async function readRpc(res, id) {
  const type = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!text.trim()) return null;
  if (type.includes('text/event-stream')) {
    let found = null;
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
      if (!data) continue;
      try { const msg = JSON.parse(data); if (id === undefined || msg.id === id) found = msg; } catch {}
    }
    return found;
  }
  try { return JSON.parse(text); } catch { throw err('Réponse illisible du serveur Wispr Flow.', 502); }
}
/** Texte et données d’un résultat d’outil MCP. */
export function toolPayload(result) {
  if (!result) return { text: '', data: null };
  const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  let data = result.structuredContent ?? null;
  if (data == null) { try { data = JSON.parse(text); } catch {} }
  return { text, data, isError: !!result.isError };
}

export class Wispr {
  /**
   * @param {object} o
   * @param {string} o.supportDir
   * @param {() => {dir: string, vault: string|null}} o.target   où importer les notes
   * @param {(info: object) => void} [o.onImported]
   * @param {typeof fetch} [o.fetch]
   */
  constructor({ supportDir, target, log = () => {}, onImported = () => {}, fetch: fetchImpl = globalThis.fetch, url = WISPR_MCP }) {
    Object.assign(this, { supportDir, target, log, onImported, fetch: fetchImpl, url });
    this.file = path.join(supportDir, 'wispr.json');
    this.data = { client: null, tokens: null, account: '', autoImport: true, lastImport: null, imported: {} };
    this.flow = null;
    this.session = null;
    this.importing = null;
    this.lastError = '';
  }
  async load() {
    try { this.data = { ...this.data, ...JSON.parse(await fs.readFile(this.file, 'utf8')) }; } catch {}
    this.data.imported ||= {};
    return this;
  }
  async save() {
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await fs.chmod(this.file, 0o600).catch(() => {});
  }
  connected() { return !!this.data.tokens?.access_token; }
  status() {
    return { connected: this.connected(), account: this.data.account || '', autoImport: this.data.autoImport !== false, lastImport: this.data.lastImport, imported: Object.keys(this.data.imported).length, waiting: !!this.flow, importing: !!this.importing, error: this.lastError || '' };
  }
  async setAuto(on) { this.data.autoImport = !!on; await this.save(); return this.status(); }
  async disconnect() { this.data.tokens = null; this.data.account = ''; this.session = null; this.flow = null; await this.save(); return this.status(); }

  // ---------- Autorisation ----------
  async json(url, init = {}) {
    const res = await this.fetch(url, { ...init, headers: { Accept: 'application/json', ...(init.headers || {}) } });
    const text = await res.text();
    let body = null; try { body = text ? JSON.parse(text) : null; } catch {}
    return { res, body, text };
  }
  async discover() {
    const mcp = new URL(this.url);
    let prmUrl = null;
    try {
      const probe = await this.fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL }, body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Cours Albert', version: '3.1' } } }) });
      const header = probe.headers.get('www-authenticate') || '';
      prmUrl = header.match(/resource_metadata="([^"]+)"/)?.[1] || null;
      await probe.text().catch(() => {});
    } catch (e) { throw err(`Wispr Flow injoignable : ${e.message}`, 503); }
    const prmCandidates = [prmUrl, `${mcp.origin}/.well-known/oauth-protected-resource${mcp.pathname}`, `${mcp.origin}/.well-known/oauth-protected-resource`].filter(Boolean);
    let prm = null;
    for (const u of prmCandidates) { const r = await this.json(u).catch(() => null); if (r?.res.ok && r.body?.authorization_servers?.length) { prm = r.body; break; } }
    const issuer = new URL(prm?.authorization_servers?.[0] || mcp.origin);
    const tail = issuer.pathname.replace(/\/$/, '');
    const asCandidates = [
      `${issuer.origin}/.well-known/oauth-authorization-server${tail}`, `${issuer.origin}/.well-known/openid-configuration${tail}`,
      `${issuer.origin}${tail}/.well-known/openid-configuration`, `${issuer.origin}/.well-known/oauth-authorization-server`,
    ];
    let as = null;
    for (const u of asCandidates) { const r = await this.json(u).catch(() => null); if (r?.res.ok && r.body?.authorization_endpoint && r.body?.token_endpoint) { as = r.body; break; } }
    if (!as) as = { authorization_endpoint: `${issuer.origin}/authorize`, token_endpoint: `${issuer.origin}/token`, registration_endpoint: `${issuer.origin}/register` };
    return { as, resource: prm?.resource || this.url, scopes: prm?.scopes_supported || as.scopes_supported || [] };
  }
  /** Prépare la connexion : renvoie l’adresse à ouvrir dans le navigateur. */
  async startAuth(redirectUri) {
    const meta = await this.discover();
    let client = this.data.client;
    if (!client || client.redirect_uri !== redirectUri || client.token_endpoint !== meta.as.token_endpoint) {
      if (!meta.as.registration_endpoint) throw err('Wispr Flow ne permet pas l’enregistrement automatique d’une application.', 502);
      const r = await this.json(meta.as.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Cours Albert', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native' }) });
      if (!r.res.ok || !r.body?.client_id) throw err(`Enregistrement refusé par Wispr Flow (${r.res.status}).`, 502);
      client = { client_id: r.body.client_id, client_secret: r.body.client_secret || null, redirect_uri: redirectUri, token_endpoint: meta.as.token_endpoint, auth_method: r.body.token_endpoint_auth_method || 'none' };
      this.data.client = client;
      await this.save();
    }
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(24));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const u = new URL(meta.as.authorization_endpoint);
    const params = { response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, resource: meta.resource };
    if (meta.scopes.length) params.scope = meta.scopes.join(' ');
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    this.flow = { state, verifier, redirectUri, resource: meta.resource, token_endpoint: meta.as.token_endpoint, at: Date.now() };
    this.lastError = '';
    return { url: u.href };
  }
  async tokenRequest(form) {
    const c = this.data.client;
    const body = new URLSearchParams({ ...form, client_id: c.client_id });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (c.client_secret) {
      if (c.auth_method === 'client_secret_basic') headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(c.client_id)}:${encodeURIComponent(c.client_secret)}`).toString('base64')}`;
      else body.set('client_secret', c.client_secret);
    }
    const r = await this.json(c.token_endpoint, { method: 'POST', headers, body: body.toString() });
    if (!r.res.ok || !r.body?.access_token) throw err(`Wispr Flow a refusé la connexion (${r.body?.error_description || r.body?.error || r.res.status}).`, r.res.status === 400 ? 401 : 502);
    const t = r.body;
    this.data.tokens = { access_token: t.access_token, refresh_token: t.refresh_token || this.data.tokens?.refresh_token || null, expires_at: t.expires_in ? Date.now() + (t.expires_in - 60) * 1000 : null, resource: form.resource || this.data.tokens?.resource || this.url };
    await this.save();
  }
  /** Retour du navigateur après l’autorisation. */
  async finishAuth({ code, state, error }) {
    const flow = this.flow;
    if (!flow || !state || state !== flow.state || Date.now() - flow.at > 15 * 60_000) throw err('Demande de connexion expirée ou inconnue : recommencez depuis Cours Albert.', 400);
    this.flow = null;
    if (error) { this.lastError = `Connexion refusée (${error}).`; throw err(this.lastError, 400); }
    if (!code) throw err('Code d’autorisation manquant.', 400);
    await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: flow.verifier, resource: flow.resource });
    this.session = null;
    try {
      const { data } = await this.tool('get_account_info', {});
      this.data.account = data?.name || '';
      await this.save();
    } catch (e) { this.log(`Wispr : compte illisible (${e.message})`); }
    return this.status();
  }
  async refresh() {
    if (!this.data.tokens?.refresh_token) throw err('Connexion Wispr Flow expirée : reconnectez-vous dans Réglages.', 401);
    try { await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.data.tokens.refresh_token, resource: this.data.tokens.resource }); }
    catch (e) { if (e.status === 401) { this.data.tokens = null; await this.save(); } throw e; }
  }

  // ---------- MCP ----------
  async rpc(method, params, { notify = false, retry = true } = {}) {
    if (!this.connected()) throw err('Wispr Flow n’est pas connecté.', 409);
    if (this.data.tokens.expires_at && Date.now() > this.data.tokens.expires_at) await this.refresh();
    const id = notify ? undefined : crypto.randomInt(1, 2 ** 31);
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.data.tokens.access_token}`, 'MCP-Protocol-Version': PROTOCOL };
    if (this.session && method !== 'initialize') headers['Mcp-Session-Id'] = this.session;
    const res = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...(notify ? {} : { id }), method, ...(params ? { params } : {}) }) });
    if (res.status === 401 && retry) { await res.text().catch(() => {}); await this.refresh(); this.session = null; return this.rpc(method, params, { notify, retry: false }); }
    if (res.status === 404 && this.session && retry) { await res.text().catch(() => {}); this.session = null; await this.init(); return this.rpc(method, params, { notify, retry: false }); }
    if (method === 'initialize') this.session = res.headers.get('mcp-session-id') || null;
    if (notify) { await res.text().catch(() => {}); return null; }
    if (!res.ok) { const t = await res.text().catch(() => ''); throw err(`Wispr Flow a répondu ${res.status}${t ? ` : ${t.slice(0, 160)}` : ''}.`, 502); }
    const msg = await readRpc(res, id);
    if (msg?.error) throw err(`Wispr Flow : ${msg.error.message || 'erreur'}`, 502);
    return msg?.result ?? null;
  }
  async init() {
    await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Cours Albert', version: '3.1' } });
    await this.rpc('notifications/initialized', null, { notify: true });
  }
  async tool(name, args = {}) {
    if (!this.session) await this.init();
    const out = toolPayload(await this.rpc('tools/call', { name, arguments: args }));
    if (out.isError) throw err(`Wispr Flow : ${out.text.slice(0, 200)}`, 502);
    return out;
  }
  /** Récupère toutes les pages d’une recherche. */
  async all(name, args, key, max = 300) {
    const items = [];
    let cursor;
    for (let i = 0; i < 20 && items.length < max; i++) {
      const { data } = await this.tool(name, { ...args, limit: 100, ...(cursor ? { cursor } : {}) });
      items.push(...(data?.[key] || []));
      if (!data?.has_more || !data?.next_cursor) break;
      cursor = data.next_cursor;
    }
    return items;
  }
  /** Lit un texte découpé en morceaux (contenu ou transcription), jusqu’à `max` caractères. */
  static joinChunks(chunks) { return chunks.join('').replace(/\n?\[[^\]\n]*(?:start_char|continu)[^\]\n]*\]\s*$/i, '').trim(); }
  async longText(name, idKey, id, field, viewKey, max = 200_000) {
    const parts = [];
    let start = 0;
    for (let i = 0; i < 12; i++) {
      const { data, text } = await this.tool(name, { [idKey]: id, [viewKey]: { start_char: start, char_limit: 40000 } });
      const value = data?.[field];
      const chunk = typeof value === 'string' ? value : value?.text ?? value?.content ?? (field === 'content' ? text : '');
      if (!chunk) break;
      parts.push(chunk);
      const next = Number(String(chunk).match(/start_char["=:\s]+(\d+)/i)?.[1] || data?.next_start_char || value?.next_start_char || 0);
      if (!next || next <= start || parts.join('').length > max) break;
      start = next;
    }
    return Wispr.joinChunks(parts);
  }
  async note(id) {
    const { data, text } = await this.tool('get_scratchpad_note', { note_id: id });
    const content = (await this.longText('get_scratchpad_note', 'note_id', id, 'content', 'view_content').catch(() => '')) || (typeof data?.content === 'string' ? data.content : text);
    return { ...(data?.note || data || {}), content };
  }
  async meeting(id) {
    const { data } = await this.tool('get_meeting', { meeting_id: id });
    const m = data?.meeting || data || {};
    const transcript = await this.longText('get_meeting', 'meeting_id', id, 'transcript', 'view_transcript').catch(() => '');
    return { ...m, content: typeof m.content === 'string' ? m.content : '', summary: typeof m.summary === 'string' ? m.summary : '', transcript };
  }

  // ---------- Import ----------
  async importNew({ force = false } = {}) {
    if (this.importing) return this.importing;
    this.importing = this.doImport({ force }).finally(() => { this.importing = null; });
    return this.importing;
  }
  async doImport({ force }) {
    const target = await this.target();
    if (!target?.dir) throw err('Aucun dossier où importer les notes Wispr.', 409);
    const since = !force && this.data.lastImport ? new Date(Date.parse(this.data.lastImport) - 2 * 3600_000).toISOString() : undefined;
    const startedAt = new Date().toISOString();
    const notes = await this.all('search_scratchpad_notes', since ? { since } : {}, 'notes');
    const meetings = await this.all('search_meetings', since ? { since } : {}, 'meetings');
    const items = [];
    for (const n of notes) {
      const id = n.id || n.note_id; if (!id) continue;
      const mod = n.modified_at || n.updated_at || n.created_at || '';
      if (this.data.imported[`note:${id}`]?.modified_at === mod && !force) continue;
      const full = await this.note(id).catch(e => { this.log(`Wispr note ${id} : ${e.message}`); return null; });
      if (!full || !String(full.content || '').trim()) continue;
      items.push({ source: 'wispr', kind: 'note', id, title: full.title || n.title || '', created_at: full.created_at || n.created_at, modified_at: mod, content: full.content, folders: (full.folders || n.folders || []).map(f => f?.name || f).filter(Boolean) });
    }
    for (const m of meetings) {
      const id = m.id || m.meeting_id; if (!id) continue;
      const mod = m.modified_at || m.updated_at || m.start || '';
      if (this.data.imported[`meeting:${id}`]?.modified_at === mod && !force) continue;
      const young = Date.now() - Date.parse(m.start || m.modified_at || 0) < 3 * 3600_000;
      if (!m.finalized && !m.has_transcript && !m.content_excerpt && young) continue; // réunion vide encore en cours : reprise au prochain passage
      const full = await this.meeting(id).catch(e => { this.log(`Wispr réunion ${id} : ${e.message}`); return null; });
      if (!full || !(full.content || full.summary || full.transcript)) continue;
      items.push({ source: 'wispr', kind: 'meeting', id, title: full.title || m.title || '', start: full.start || m.start, end: full.end || m.end, modified_at: mod, calendar_title: full.calendar_event?.title || full.calendar_title || '', folders: (full.folders || m.folders || []).map(f => f?.name || f).filter(Boolean), share_link: full.share_link || m.share_link || '', summary: full.summary, content: full.content, transcript: full.transcript });
    }
    const written = items.length ? await this.write(items, target) : [];
    for (const it of items) this.data.imported[`${it.kind}:${it.id}`] = { modified_at: it.modified_at, at: startedAt };
    this.data.lastImport = startedAt;
    this.lastError = '';
    await this.save();
    const info = { imported: items.length, notes: items.filter(i => i.kind === 'note').length, meetings: items.filter(i => i.kind === 'meeting').length, written, at: startedAt };
    this.onImported(info);
    return info;
  }
  /** Avec le script du vault (rangement par cours), sinon en notes Markdown dans le dossier d’import. */
  async write(items, target) {
    const script = target.vault && path.join(target.vault, '90_Meta', 'Rangement', 'ranger_cours.py');
    if (script && await exists(script)) {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cours-albert-wispr-'));
      try {
        await fs.writeFile(path.join(tmp, '0-etat.json'), JSON.stringify({ checked_at: new Date().toISOString(), sources: ['wispr'], items: [] }));
        for (const it of items) await fs.writeFile(path.join(tmp, `${String(it.id).replace(/[^\w-]/g, '_')}.json`), JSON.stringify(it));
        const out = await new Promise(resolve => execFile('python3', [script, '--ingest-dir', tmp], { cwd: target.vault, timeout: 180_000, maxBuffer: 8 * 1024 ** 2 }, (e, stdout, stderr) => resolve(e ? `ERREUR ${String(stderr || e.message).slice(-600)}` : stdout)));
        if (out.startsWith('ERREUR')) { this.log(`Wispr : rangement du vault en échec (${out}) ; import simple à la place`); }
        else return out.split('\n').filter(l => / → /.test(l)).map(l => l.trim()).slice(0, 50);
      } finally { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
    }
    await fs.mkdir(target.dir, { recursive: true });
    const out = [];
    for (const it of items) {
      const key = `${it.kind}:${it.id}`;
      const when = new Date(it.start || it.created_at || it.modified_at || Date.now());
      const stamp = Number.isNaN(when.getTime()) ? '' : when.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 16).replace(' ', ' ').replace(':', 'h');
      const title = it.title && !/^untitled/i.test(it.title) ? it.title : (it.calendar_title || (it.kind === 'meeting' ? 'Réunion Wispr' : 'Note Wispr'));
      const prev = this.data.imported[key]?.path;
      const file = prev && await exists(prev) ? prev : path.join(target.dir, `${safeName(`${stamp} — ${title}`)}.md`);
      const fm = ['---', 'type: note-wispr', 'source: wispr', `wispr_type: ${it.kind}`, `wispr_id: ${JSON.stringify(String(it.id))}`, `titre: ${JSON.stringify(title)}`, stamp ? `date: ${stamp.slice(0, 10)}` : '', it.share_link ? `lien: ${JSON.stringify(it.share_link)}` : '', it.folders?.length ? `dossiers_wispr: ${JSON.stringify(it.folders)}` : '', '---'].filter(Boolean).join('\n');
      const zone = [it.summary && `## Résumé\n\n${it.summary.trim()}`, it.content && `## Notes\n\n${String(it.content).trim()}`, it.transcript && `## Transcription\n\n> [!quote]- Transcription\n${String(it.transcript).trim().split('\n').map(l => `> ${l}`).join('\n')}`].filter(Boolean).join('\n\n');
      let text = `${fm}\n\n# ${title}\n\n<!-- wispr:debut -->\n${zone}\n<!-- wispr:fin -->\n\n## Mes notes\n\n`;
      const cur = await fs.readFile(file, 'utf8').catch(() => null);
      if (cur && cur.includes('<!-- wispr:debut -->') && cur.includes('<!-- wispr:fin -->')) text = cur.slice(0, cur.indexOf('<!-- wispr:debut -->')) + `<!-- wispr:debut -->\n${zone}\n` + cur.slice(cur.indexOf('<!-- wispr:fin -->'));
      await fs.writeFile(file, text);
      this.data.imported[key] = { ...(this.data.imported[key] || {}), path: file };
      out.push(`Wispr → ${path.basename(file)}`);
    }
    return out;
  }

  // ---------- Pour l’assistant ----------
  extension() {
    const S = { type: 'string' };
    const T = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: 'object', properties, required, additionalProperties: false } });
    const labels = { wispr_chercher: i => `Cherche dans Wispr Flow${i.requete ? ` « ${String(i.requete).slice(0, 60)} »` : ''}`, wispr_lire: i => `Lit ${i.type === 'note' ? 'une note' : 'une réunion'} Wispr Flow`, wispr_importer: () => 'Importe les notes Wispr Flow' };
    return {
      mutating: ['wispr_importer'],
      label: (name, input) => labels[name]?.(input || {}) || name,
      status: () => ({ name: 'Wispr Flow', connected: this.connected() }),
      prompt: () => this.connected() ? 'Wispr Flow est connecté (lecture seule) : tu peux chercher et lire les notes dictées et les réunions enregistrées, et lancer leur import dans le vault, où elles sont rangées par cours.' : '',
      tools: () => this.connected() ? [
        T('wispr_chercher', 'Cherche dans Wispr Flow : notes dictées et réunions enregistrées (titre, date, identifiant).', { requete: S, depuis: { type: 'string', description: 'date ISO (facultatif)' } }),
        T('wispr_lire', 'Lit une note ou une réunion Wispr Flow (résumé, notes, transcription).', { id: S, type: { type: 'string', enum: ['note', 'reunion'] } }, ['id', 'type']),
        T('wispr_importer', 'Importe maintenant les nouvelles notes et réunions Wispr Flow dans le vault (rangées par cours si le vault sait le faire). Non annulable, ne supprime rien.'),
      ] : [],
      run: async (name, input, { run }) => {
        if (name === 'wispr_chercher') {
          const args = { ...(input.requete ? { query: input.requete } : {}), ...(input.depuis ? { since: input.depuis } : {}), limit: 40 };
          const [n, m] = await Promise.all([this.tool('search_scratchpad_notes', args), this.tool('search_meetings', args)]);
          const notes = (n.data?.notes || []).map(x => `- note ${x.id} · ${x.title || 'Sans titre'} · ${x.modified_at || ''}`);
          const meets = (m.data?.meetings || []).map(x => `- reunion ${x.id} · ${x.title || 'Sans titre'} · ${x.start || ''}${x.has_transcript ? ' · transcription' : ''}`);
          return [...notes, ...meets].join('\n') || 'Rien trouvé dans Wispr Flow.';
        }
        if (name === 'wispr_lire') {
          const x = input.type === 'note' ? await this.note(input.id) : await this.meeting(input.id);
          return clip([`# ${x.title || 'Sans titre'}`, x.summary && `Résumé :\n${x.summary}`, x.content && `Notes :\n${x.content}`, x.transcript && `Transcription :\n${x.transcript}`].filter(Boolean).join('\n\n'), 40000);
        }
        if (name === 'wispr_importer') {
          const r = await this.importNew();
          run.ops.push({ op: 'note', text: 'Import Wispr Flow (non annulable)' });
          return `${r.imported} élément(s) importé(s)${r.written.length ? ` :\n${r.written.join('\n')}` : '.'}`;
        }
        throw err(`Outil inconnu : ${name}`);
      },
    };
  }
}

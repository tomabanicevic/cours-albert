/* Cours Albert 3.1 — Assistant IA : discussion, actions affichées en direct, annulation d’une demande. */
'use strict';

const Assistant = (() => {
  const A = { conv: null, items: [], runs: [], status: null, busy: false, run: null, context: '', draft: '', loaded: false, loading: false, error: '' };
  const SUGGESTIONS = [
    'Range mon dossier 00_Inbox dans les bons cours',
    'Crée un tableau par cours de maths avec Cours, TD, Corrigés et Examens, et publie les supports de l’app dedans',
    'Vérifie que chaque cours a sa page et ses liens, et dis-moi ce qui manque',
    'Regroupe mes notes Wispr Flow par matière',
  ];
  const enabled = () => !!(E.state?.ai?.enabled);
  const runOf = id => A.runs.find(r => r.id === id);

  async function load(id = A.conv) {
    if (!E.available) return;
    A.loading = true;
    try {
      A.status = await E.api('GET', '/assistant');
      if (id) {
        const c = await E.api('GET', `/assistant/conversation?id=${encodeURIComponent(id)}`);
        A.conv = c.id; A.items = c.items || []; A.runs = c.runs || [];
      }
      A.error = '';
    } catch (err) { A.error = err.message; }
    A.loading = false; A.loaded = true;
    if (S.route === 'assistant') paint();
  }

  // ---------- Affichage ----------
  function partsHTML(parts) {
    let html = '', actions = [];
    const flush = () => {
      if (!actions.length) return;
      const hidden = actions.length > 8 ? actions.length - 6 : 0;
      html += `<ul class="as-actions">${actions.map((p, i) => `<li class="${p.status === 'running' ? 'running' : p.ok === false || p.status === 'error' ? 'error' : 'ok'} ${hidden && i >= 3 && i < actions.length - 3 ? 'folded' : ''}" title="${attr(p.detail || '')}">${p.status === 'running' ? '<span class="spin"></span>' : p.ok === false || p.status === 'error' ? I.alert : I.check}<span>${esc(p.label || p.tool || '')}</span>${p.detail && (p.ok === false || p.status === 'error') ? `<small>${esc(p.detail)}</small>` : ''}</li>`).join('')}${hidden ? `<li class="more"><button class="btn sm ghost" data-as="unfold">${plural(hidden, 'autre action', 'autres actions')}</button></li>` : ''}</ul>`;
      actions = [];
    };
    for (const p of parts || []) {
      if (p.type === 'action') { actions.push(p); continue; }
      flush();
      if (p.type === 'text') html += `<div class="md as-text">${MD.render(p.text, { frontmatter: false, tasks: false })}</div>`;
      else if (p.type === 'error') html += `<div class="as-error">${I.alert}<span>${esc(p.text)}</span></div>`;
    }
    flush();
    return html;
  }
  function itemsHTML() {
    return A.items.map(it => {
      if (it.role === 'user') return `<div class="as-msg me"><div class="bubble">${esc(it.text).replace(/\n/g, '<br>')}</div></div>`;
      const run = runOf(it.run);
      const live = A.busy && A.run === it.run;
      const foot = run && run.changes ? `<div class="as-run ${run.undone ? 'undone' : ''}">${run.undone ? `${I.undo}<span>Changements annulés</span>` : `${I.check}<span>${plural(run.changes, 'changement')}</span><button class="btn sm" data-as="undo" data-run="${attr(run.id)}">${I.undo}Annuler ces changements</button>`}</div>` : '';
      return `<div class="as-msg ai"><div class="as-avatar">${I.sparkles}</div><div class="as-content">${partsHTML(it.parts)}${live && !(it.parts || []).length ? '<div class="as-typing"><i></i><i></i><i></i></div>' : ''}${live && (it.parts || []).length && it.parts[it.parts.length - 1].type !== 'action' ? '<div class="as-typing"><i></i><i></i><i></i></div>' : ''}${foot}</div></div>`;
    }).join('');
  }
  function view() {
    if (!A.loaded && !A.loading) setTimeout(() => load(), 0);
    const st = A.status;
    const convs = st?.conversations || [];
    const actions = `${convs.length ? `<button class="btn" data-as="history">${I.clock}Historique</button>` : ''}<button class="btn" data-as="rules" title="Consignes et dossiers protégés">${I.shield}Consignes</button><button class="btn primary" data-as="new" ${A.busy ? 'disabled' : ''}>${I.plus}Nouvelle conversation</button>`;
    const head = pageHead('', 'Assistant IA', 'Il range tes cours dans le vault, tes dossiers de notes et tes espaces. Rien n’est jamais supprimé, et chaque demande s’annule d’un clic.', enabled() ? actions : '');
    if (!E.available) return `${head}<div class="callout">${I.alert}<div>Le serveur des espaces ne répond pas : relancez Cours Albert.</div></div>`;
    if (!enabled()) return `${head}<section class="card as-setup"><div class="as-setup-icon">${I.sparkles}</div><h2>Choisissez votre IA</h2><p class="muted">L’assistant fonctionne avec votre propre clé : Claude, ChatGPT, Gemini, Mistral, DeepSeek, Grok, OpenRouter… ou un modèle local avec Ollama. Elle est enregistrée seulement sur ce Mac et sert aussi au tri par IA.</p><button class="btn primary" data-act="go" data-to="reglages">${I.settings}Ouvrir les réglages</button></section>`;
    const empty = !A.items.length;
    return `${head}<div class="as ${empty ? 'empty' : ''}">
      ${A.error ? `<div class="callout warn">${I.alert}<div>${esc(A.error)}</div></div>` : ''}
      <div class="as-thread">${empty ? `<div class="as-hello"><div class="as-avatar big">${I.sparkles}</div><h2>Que veux-tu ranger ?</h2><p class="muted">Demande en une phrase ; je regarde d’abord ce qui existe, puis je range. ${st?.vault ? `Vault : <b>${esc(st.vault)}</b>.` : 'Aucun vault Obsidian configuré : je peux ranger tes espaces et tes dossiers de notes.'}</p><div class="as-suggest">${SUGGESTIONS.map(t => `<button class="chip-btn" data-as="suggest">${esc(t)}</button>`).join('')}</div></div>` : itemsHTML()}</div>
      <form class="as-composer" data-as="form">
        ${A.context ? `<div class="as-context">${I.pin}<span>${esc(A.context.replace(/^L’étudiant regardait /, ''))}</span><button type="button" class="btn icon sm ghost" data-as="nocontext" title="Retirer">${I.close}</button></div>` : ''}
        <div class="as-row"><textarea data-as="input" rows="1" placeholder="Ex. « Range 00_Inbox par matière », « Fais un tableau du cours de finance avec ses supports »…" ${A.busy ? 'disabled' : ''}>${esc(A.draft)}</textarea>
        ${A.busy ? `<button type="button" class="btn danger-soft" data-as="stop">${I.stop}Arrêter</button>` : `<button type="submit" class="btn primary" data-as="send">${I.send}Envoyer</button>`}</div>
        <p class="as-foot">${esc([st?.provider, st?.model].filter(Boolean).join(' · '))} · ⏎ pour envoyer, ⇧⏎ pour aller à la ligne · ne supprime jamais rien</p>
      </form>
    </div>`;
  }
  function paint() {
    const main = document.getElementById('main');
    if (S.route !== 'assistant' || !main) return;
    const thread = main.querySelector('.as-thread');
    const input = main.querySelector('[data-as="input"]');
    if (input) A.draft = input.value;
    const nearBottom = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 140;
    const focused = document.activeElement === input;
    main.innerHTML = `<div class="page page-assistant">${view()}</div>`;
    mounted(main, { scroll: nearBottom, focus: focused });
  }
  function mounted(main, { scroll = true, focus = false } = {}) {
    const thread = main.querySelector('.as-thread');
    if (thread && scroll) thread.scrollTop = thread.scrollHeight;
    const input = main.querySelector('[data-as="input"]');
    if (input) {
      const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(220, input.scrollHeight)}px`; };
      grow();
      input.addEventListener('input', () => { A.draft = input.value; grow(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
      if (focus || (!A.busy && !A.items.length)) setTimeout(() => input.focus(), 30);
    }
  }

  // ---------- Envoi et flux ----------
  async function submit(text) {
    const value = String(text ?? document.querySelector('[data-as="input"]')?.value ?? '').trim();
    if (!value || A.busy) return;
    A.busy = true; A.draft = ''; A.error = '';
    const item = { role: 'assistant', run: null, parts: [] };
    A.items.push({ role: 'user', text: value }, item);
    paint();
    const handle = line => {
      if (!line.trim()) return;
      let ev; try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'start') { A.conv = ev.conversation; A.run = ev.run; item.run = ev.run; }
      else if (ev.type === 'text') item.parts.push({ type: 'text', text: ev.text });
      else if (ev.type === 'action') {
        const p = item.parts.find(x => x.type === 'action' && x.id === ev.id);
        if (p) Object.assign(p, { status: ev.status, ok: ev.status !== 'error', detail: ev.detail });
        else item.parts.push({ type: 'action', id: ev.id, label: ev.label, tool: ev.tool, status: ev.status, ok: ev.status !== 'error', detail: ev.detail });
      } else if (ev.type === 'error') item.parts.push({ type: 'error', text: ev.message });
      else if (ev.type === 'stopped') item.parts.push({ type: 'text', text: '_Arrêté._' });
      else if (ev.type === 'done') { if (ev.changes) A.runs.push({ id: ev.run, changes: ev.changes, undone: false }); }
      paint();
    };
    try {
      const res = await fetch(`${E.base}/api/assistant/chat`, { method: 'POST', headers: E.headers(), body: JSON.stringify({ conversation: A.conv || undefined, message: value, context: A.context || undefined }) });
      if (!res.ok) { let d = {}; try { d = await res.json(); } catch {} throw new Error(d.error || `Erreur ${res.status}`); }
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (!reader) (await res.text()).split('\n').forEach(handle);
      else {
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
        }
        if (buf.trim()) handle(buf);
      }
    } catch (err) {
      item.parts.push({ type: 'error', text: err.message === 'Failed to fetch' ? 'Le serveur des espaces ne répond pas. Relancez Cours Albert.' : err.message });
    }
    A.busy = false; A.run = null; A.context = '';
    const changes = runOf(item.run)?.changes || 0;
    if (changes) { toast(`${plural(changes, 'changement')} — annulable depuis l’assistant`); await afterChanges(); }
    if (S.route !== 'assistant' && window.call && !document.hasFocus()) call('notify', { title: 'Assistant IA', body: changes ? `Terminé : ${plural(changes, 'changement')}` : 'Réponse prête', route: 'assistant' }).catch(() => {});
    await load(A.conv);
  }
  async function afterChanges() {
    try { await E.loadState(); } catch {}
    if (typeof renderSidebar === 'function') renderSidebar();
  }
  async function undo(runId) {
    if (!await UI.confirm('Remettre tout comme avant cette demande ? Les fichiers déplacés reviennent, les notes et espaces créés sont retirés (un fichier modifié depuis par vous est gardé).', { title: 'Annuler les changements', ok: 'Annuler les changements' })) return;
    try {
      const r = await E.api('POST', '/assistant/undo', { run: runId });
      toast(r.already ? 'Déjà annulé' : `${plural(r.restored, 'changement annulé', 'changements annulés')}${r.skipped?.length ? ` · ${plural(r.skipped.length, 'élément gardé')} (modifié depuis)` : ''}`);
      await afterChanges();
      await load(A.conv);
    } catch (err) { toast(err.message, 'error'); }
  }
  function rulesDialog() {
    const r = A.status?.rules || { consignes: '', proteges: [] };
    const box = UI.modal(`<div class="dlg">
        <h2>Consignes de l’assistant</h2>
        <label class="lbl">Ce que l’assistant doit toujours respecter
          <textarea class="input" data-r="consignes" rows="5" placeholder="Ex. « Mes notes de maths sont en français, les autres en anglais. Un dossier par cours. »">${esc(r.consignes || '')}</textarea></label>
        <label class="lbl">Dossiers protégés du vault (lecture seule), un par ligne
          <textarea class="input mono" data-r="proteges" rows="5" placeholder="20_Areas/*/Mails">${esc((r.proteges || []).join('\n'))}</textarea></label>
        <p style="font-size:12px">Les dossiers de l’app Cours Albert, les dossiers cachés et les projets de code sont toujours protégés. L’assistant lit aussi CLAUDE.md ou ASSISTANT.md à la racine du vault.</p>
        <div class="dlg-actions"><button class="btn" data-m="close">Annuler</button><button class="btn primary" data-m="save">Enregistrer</button></div>
      </div>`, { label: 'Consignes de l’assistant' });
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      if (b.dataset.m === 'close') return UI.close(box);
      try {
        const { rules } = await E.api('POST', '/assistant/rules', { consignes: box.querySelector('[data-r="consignes"]').value, proteges: box.querySelector('[data-r="proteges"]').value.split('\n').map(s => s.trim()).filter(Boolean) });
        if (A.status) A.status.rules = rules;
        toast('Consignes enregistrées'); UI.close(box);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-as]');
    if (!b || S.route !== 'assistant') return;
    const act = b.dataset.as;
    if (act === 'input' || act === 'form') return;
    e.preventDefault();
    if (act === 'send') return submit();
    if (act === 'suggest') return submit(b.textContent);
    if (act === 'stop') { try { await E.api('POST', '/assistant/stop', {}); } catch (err) { toast(err.message, 'error'); } return; }
    if (act === 'undo') return undo(b.dataset.run);
    if (act === 'unfold') { b.closest('.as-actions')?.classList.add('unfolded'); b.closest('li')?.remove(); return; }
    if (act === 'nocontext') { A.context = ''; return paint(); }
    if (act === 'new') { A.conv = null; A.items = []; A.runs = []; A.context = ''; A.draft = ''; return paint(); }
    if (act === 'rules') return rulesDialog();
    if (act === 'history') {
      const convs = A.status?.conversations || [];
      return UI.menu(b, convs.map(c => ({ label: c.title || 'Conversation', icon: 'comment', checked: c.id === A.conv, act: () => load(c.id) })), { align: 'right' });
    }
  });
  document.addEventListener('submit', e => { if (e.target.matches?.('[data-as="form"]')) { e.preventDefault(); submit(); } });

  /** Ouvre l’assistant avec le contexte d’un espace (bouton ✨ dans l’en-tête d’un espace). */
  function openFor(space) {
    A.context = space ? `L’étudiant regardait l’espace « ${space.title} » (identifiant ${space.id}, ${space.kind === 'board' ? 'tableau' : 'espace libre'}).` : '';
    if (!A.items.length || !A.conv) A.draft = space ? 'Range cet espace : ' : '';
    go('assistant');
  }
  return { view, mounted, paint, openFor, load, state: A };
})();
window.Assistant = Assistant;

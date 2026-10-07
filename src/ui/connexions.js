/* Cours Albert 3.1 — connexion à Wispr Flow (réglages, import des notes, état en direct). */
'use strict';

const Connexions = (() => {
  const W = () => E.state?.wispr || null;
  const fmt = iso => { try { return relative(iso); } catch { return ''; } };
  function wisprCard() {
    if (!E.available) return '';
    const w = W() || {};
    const where = E.state?.vault ? 'dans le vault (00_Inbox › Wispr), puis rangées automatiquement dans le dossier du bon cours (code, horaire du cours, mots-clés)' : 'dans le dossier de notes « Wispr Flow » de l’app';
    const row = (t, d, c) => `<div class="set-row"><div class="grow"><b>${t}</b>${d ? `<span>${d}</span>` : ''}</div>${c || ''}</div>`;
    return `<section class="card"><div class="card-head"><h2>Wispr Flow <span class="muted" style="font-weight:500">(facultatif)</span></h2>${w.connected ? '<span class="chip ok" style="margin-left:auto">Connecté</span>' : w.waiting ? '<span class="chip warn" style="margin-left:auto">En attente du navigateur</span>' : '<span class="chip" style="margin-left:auto">Non connecté</span>'}</div>
      <p class="muted" style="font-size:12.5px;margin:-4px 0 6px">Vos notes dictées et vos réunions enregistrées dans Wispr Flow arrivent ${where}. L’assistant IA peut aussi les chercher et les lire. Lecture seule : rien n’est modifié dans Wispr Flow.</p>
      ${w.connected ? `
        ${row('Compte', esc(w.account || 'Wispr Flow'), '')}
        ${row('Dernier import', w.lastImport ? `${esc(fmt(w.lastImport))} · ${plural(w.imported || 0, 'note importée', 'notes importées')}` : 'Jamais', `<button class="btn sm" data-wf="import" ${w.importing ? 'disabled' : ''}>${I.download}${w.importing ? 'Import…' : 'Importer maintenant'}</button>`)}
        ${row('Import automatique', 'Toutes les 30 minutes, tant que Cours Albert est ouvert.', `<label class="switch"><input type="checkbox" data-wf="auto" ${w.autoImport ? 'checked' : ''}><span></span></label>`)}
        ${w.error ? `<div class="callout" style="margin-top:8px">${I.alert}<div>${esc(w.error)}</div></div>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:10px"><button class="btn sm ghost" data-wf="disconnect">Déconnecter</button></div>`
      : `<div class="callout" style="margin:6px 0 4px">${I.info}<div>Connexion dans votre navigateur avec <b>Google, Apple ou Microsoft</b> (la connexion par e-mail et mot de passe n’est pas acceptée par Wispr Flow pour les applications). Le jeton reste sur ce Mac, dans le dossier de l’app.${w.error ? `<br><b>${esc(w.error)}</b>` : ''}</div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;padding-top:10px"><button class="btn sm primary" data-wf="connect">${I.link}Se connecter à Wispr Flow</button></div>`}
    </section>`;
  }
  function refresh() { if (S.route === 'reglages') renderMain(false); }
  async function act(a, el) {
    try {
      if (a === 'connect') {
        const { url } = await E.api('POST', '/wispr/connect', {});
        if (E.state) E.state.wispr = { ...(E.state.wispr || {}), waiting: true, error: '' };
        refresh();
        if (window.call) await call('openURL', { url }); else window.open(url, '_blank');
        toast('Terminez la connexion dans le navigateur, puis revenez ici.');
      } else if (a === 'import') {
        if (E.state?.wispr) E.state.wispr.importing = true; refresh();
        const r = await E.api('POST', '/wispr/import', {});
        if (E.state) E.state.wispr = r.status;
        toast(r.imported ? `${plural(r.imported, 'note Wispr importée', 'notes Wispr importées')}` : 'Rien de nouveau dans Wispr Flow');
        refresh();
      } else if (a === 'auto') {
        if (E.state) E.state.wispr = await E.api('POST', '/wispr/auto', { on: el.checked });
      } else if (a === 'disconnect') {
        if (!await UI.confirm('Déconnecter Wispr Flow ? Les notes déjà importées restent dans vos dossiers.', { ok: 'Déconnecter' })) return;
        if (E.state) E.state.wispr = await E.api('POST', '/wispr/disconnect', {});
        refresh();
      }
    } catch (err) {
      if (E.state?.wispr) E.state.wispr.importing = false;
      toast(err.message, 'error'); refresh();
    }
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-wf]'); if (!b || b.dataset.wf === 'auto') return; e.preventDefault(); act(b.dataset.wf, b); });
  document.addEventListener('change', e => { const b = e.target.closest('[data-wf="auto"]'); if (b) act('auto', b); });

  // État en direct (connexion terminée dans le navigateur, import automatique)
  const listen = E.listenOwner;
  E.listenOwner = function (...args) {
    const out = listen.apply(this, args);
    const es = E.ownerES;
    if (es && !es.wisprBound) {
      es.wisprBound = true;
      es.addEventListener('wispr', ev => {
        const d = JSON.parse(ev.data);
        if (E.state && d.status) E.state.wispr = d.status;
        if (d.imported) toast(`Wispr Flow : ${plural(d.imported, 'note importée', 'notes importées')}`);
        else if (d.status?.connected && !d.imported && d.status.lastImport == null) toast('Wispr Flow est connecté');
        refresh();
        if (d.imported && S.route === 'notes') Notes.load(true);
      });
    }
    return out;
  };
  return { wisprCard };
})();
window.Connexions = Connexions;

/* Cours Albert 3 — page des invités : rejoindre un espace partagé depuis un lien ou un QR code, sans compte. */
'use strict';

(async function bootGuest() {
  E.mode = 'guest';
  const host = document.getElementById('app-guest');
  const id = (location.pathname.match(/^\/s\/([a-z0-9_-]{1,40})/i) || [])[1];
  const q = new URLSearchParams(location.search);
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  E.key = q.get('k') || '';
  E.uid = store.get('ca-uid') || `g${randomId(15)}`;
  store.set('ca-uid', E.uid);
  E.name = store.get('ca-name') || '';
  E.group = (id && store.get(`ca-group-${id}`)) || '';
  if (q.has('embed')) document.body.classList.add('embed');
  const fail = (title, text) => { host.innerHTML = `<div class="guest-gate"><div class="gate-card"><div class="gc-icon">🔒</div><h1>${esc(title)}</h1><p>${esc(text)}</p><button class="btn" onclick="location.reload()">${I.sync}Réessayer</button><div class="gate-foot">Cours Albert · espace partagé sur le réseau local</div></div></div>`; };
  if (!id) return fail('Lien incomplet', 'Ce lien ne correspond à aucun espace.');

  let data;
  try { data = await E.api('GET', `/spaces/${id}`); }
  catch (err) {
    if (err.status === 404) return fail('Espace introuvable', 'Cet espace n’existe plus ou n’est plus partagé.');
    if (err.status === 403) return fail('Lien expiré', 'Ce lien de partage n’est plus valide. Demandez un nouveau lien ou un nouveau QR code.');
    return fail('Connexion impossible', err.message);
  }
  const space = data.space;
  document.title = `${space.title} — Cours Albert`;
  const suggested = E.name || (data.me?.name && data.me.name !== 'Anonyme' ? data.me.name : '');
  const needName = space.sharing?.requireName !== false && !E.name;
  const needGroup = space.settings?.groupWork && space.groups?.length && !data.me?.group && !E.group;

  const enter = async () => {
    try { const r = await E.api('POST', `/spaces/${id}/join`, { name: E.name || suggested || undefined, group: E.group || undefined }); E.me = r.me; } catch {}
    host.innerHTML = '';
    await E.mount(host, id);
  };
  if (!needName && !needGroup) return enter();

  const { style, cls } = E.spaceStyle(space);
  host.innerHTML = `<div class="guest-gate ${cls}" style="${attr(style)}"><form class="gate-card">
    <div class="gc-icon">${esc(space.icon)}</div>
    <h1>${esc(space.title)}</h1>
    ${space.description ? `<p>${esc(space.description)}</p>` : ''}
    ${needName ? `<label class="lbl">Votre nom<input class="input" name="name" value="${attr(suggested)}" placeholder="Prénom ou pseudo" maxlength="80" autocomplete="nickname" autofocus></label>` : ''}
    ${needGroup ? `<div class="lbl">Votre groupe<div class="gate-groups">${space.groups.map(g => `<button type="button" data-g="${attr(g.id)}" style="--gc:${attr(g.color)}">${esc(g.name)}</button>`).join('')}</div></div>` : ''}
    <button class="btn primary" type="submit">Rejoindre l’espace</button>
    <div class="gate-foot">Aucun compte nécessaire · votre nom apparaît sur vos publications</div>
  </form></div>`;
  const form = host.querySelector('form');
  form.addEventListener('click', e => { const b = e.target.closest('[data-g]'); if (b) { E.group = b.dataset.g; form.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b)); } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (needName) {
      const name = form.name.value.trim();
      if (!name) { form.name.focus(); toast('Indiquez un nom pour rejoindre l’espace.', 'error'); return; }
      E.name = name.slice(0, 80);
      store.set('ca-name', E.name);
    }
    if (needGroup && !E.group) { toast('Choisissez votre groupe.', 'error'); return; }
    if (E.group) store.set(`ca-group-${id}`, E.group);
    enter();
  });
})();

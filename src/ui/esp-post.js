/* Cours Albert 3 — éditeur de publication, enregistrements, dessin, vue détaillée, commentaires, visionneuse. */
'use strict';

// ======================= Éditeur de publication =======================
E.compose = function ({ post = null, sectionId = null, files = [], url = '', text = '' } = {}) {
  if (!E.space || !E.can('post')) return;
  if (E.composer && document.body.contains(E.composer.box)) { UI.close(E.composer.box); }
  const s = E.space;
  const fromDraft = !post && E.draft && !files.length && !url && !text && !E.draft.editing;
  const base = post ? JSON.parse(JSON.stringify(post)) : fromDraft ? JSON.parse(JSON.stringify(E.draft)) : {};
  const c = {
    editing: post?.id || null,
    title: base.title || '', body: base.body || text || '', color: base.color || null,
    sectionId: base.sectionId || sectionId || (E.ui.section || s.sections[0]?.id || null),
    attachments: base.attachments || [], poll: base.poll ? { question: base.poll.question || '', multiple: !!base.poll.multiple, options: base.poll.options.map(o => ({ id: o.id, text: o.text })) } : null,
    location: base.location || null, eventDate: base.eventDate || '', publishAt: base.publishAt && Date.parse(base.publishAt) > Date.now() ? base.publishAt : '',
    fields: { ...(base.fields || {}) }, uploads: [], saving: false, draftState: fromDraft ? 'repris' : '',
  };
  const box = UI.modal('<form class="composer" autocomplete="off"></form>', { cls: 'sheet composer-sheet', label: 'Publication', beforeClose: () => E.composerLeave(c), onClose: () => { if (E.composer?.c === c) E.composer = null; } });
  E.composer = { box, c };
  E.renderComposer();
  box.querySelector('.cp-title')?.focus();
  if (fromDraft) toast('Brouillon repris là où vous l’aviez laissé.');
  for (const f of files) E.composerUpload(f);
  if (url) E.addLink(url);
};
E.composerLeave = async function (c) {
  if (c.uploads.length && !await UI.confirm('Des fichiers sont encore en cours d’envoi. Fermer quand même ?', { ok: 'Fermer', danger: true })) return false;
  if (!c.editing) E.saveDraft.flush?.(c);
  return true;
};
E.composerHasContent = c => !!(c.title.trim() || c.body.trim() || c.attachments.length || c.poll || c.location);
E.saveDraft = debounce(async c => {
  if (c.editing || !E.space || !E.can('post')) return;
  const draft = E.composerHasContent(c) ? { title: c.title, body: c.body, color: c.color, sectionId: c.sectionId, attachments: c.attachments, poll: c.poll && c.poll.options.filter(o => o.text.trim()).length >= 2 ? c.poll : null, location: c.location, eventDate: c.eventDate || null, fields: c.fields } : null;
  try { const r = await E.api('PUT', `/spaces/${E.space.id}/draft`, { draft }); E.draft = r.draft; c.draftState = draft ? 'enregistré' : ''; const el = E.composer?.box.querySelector('.cp-draft'); if (el) el.textContent = c.draftState ? `Brouillon ${c.draftState}` : ''; } catch {}
}, 900);
E.renderComposer = function () {
  const { box, c } = E.composer;
  const s = E.space;
  const form = box.querySelector('.composer');
  const lay = E.layout();
  const canSchedule = E.can('moderate') || E.can('edit');
  const showDate = lay === 'timeline' || s.settings.sort === 'date' || c.eventDate;
  const fieldInputs = s.fields.filter(f => f.type !== 'vote').map(f => E.fieldInput(f, c.fields[f.id])).join('');
  form.innerHTML = `
    <div class="cp-head"><h2>${c.editing ? 'Modifier la publication' : 'Nouvelle publication'}</h2><span class="cp-draft">${c.draftState ? `Brouillon ${esc(c.draftState)}` : ''}</span><button type="button" class="btn icon ghost" data-cp="close" title="Fermer">${I.close}</button></div>
    <div class="cp-body" data-cp-drop>
      <input class="cp-title" placeholder="Titre" maxlength="300" value="${attr(c.title)}" data-cp-input="title">
      <div class="cp-fmt">
        <button type="button" tabindex="-1" data-fmt="bold" title="Gras">${I.bold}</button><button type="button" tabindex="-1" data-fmt="italic" title="Italique">${I.italic}</button><button type="button" tabindex="-1" data-fmt="list" title="Liste">${I.list}</button><button type="button" tabindex="-1" data-fmt="math" title="Formule LaTeX">${I.sigma}</button><button type="button" tabindex="-1" data-fmt="link" title="Lien">${I.link}</button>
        <span class="grow"></span><span class="hint">Markdown léger · formules entre $…$</span>
      </div>
      <textarea class="cp-text" placeholder="Écrivez quelque chose… ou glissez des fichiers ici" data-cp-input="body" rows="4">${esc(c.body)}</textarea>
      <div class="cp-atts">${c.attachments.map((a, i) => E.composerAttHTML(a, i)).join('')}${c.uploads.map(u => `<div class="cp-att uploading">${I.upload}<span class="grow"><b>${esc(u.name)}</b><span class="bar"><i style="width:${Math.round(u.progress * 100)}%"></i></span></span><button type="button" class="btn icon sm ghost" data-cp="cancel-upload" data-id="${u.id}" title="Annuler">${I.close}</button></div>`).join('')}</div>
      ${c.poll ? `<div class="cp-poll"><div class="cp-poll-head">${I.poll}<b>Sondage</b><label class="mini-check"><input type="checkbox" data-cp-input="poll-multiple" ${c.poll.multiple ? 'checked' : ''}>Plusieurs réponses</label><button type="button" class="btn icon sm ghost" data-cp="poll-remove" title="Retirer le sondage">${I.trash}</button></div>
        <input class="input" placeholder="Question (facultatif)" value="${attr(c.poll.question)}" data-cp-input="poll-question">
        ${c.poll.options.map((o, i) => `<div class="cp-poll-opt"><span>${i + 1}</span><input class="input" placeholder="Réponse ${i + 1}" value="${attr(o.text)}" data-cp-input="poll-opt" data-i="${i}">${c.poll.options.length > 2 ? `<button type="button" class="btn icon sm ghost" data-cp="poll-del" data-i="${i}">${I.close}</button>` : ''}</div>`).join('')}
        ${c.poll.options.length < 12 ? `<button type="button" class="btn sm ghost" data-cp="poll-add">${I.plus}Ajouter une réponse</button>` : ''}</div>` : ''}
      ${c.location ? `<div class="cp-chip">${I.pin}<span>${esc(c.location.label || `${c.location.lat.toFixed(3)}, ${c.location.lng.toFixed(3)}`)}</span><button type="button" class="btn sm ghost" data-cp="location">Modifier</button><button type="button" class="btn icon sm ghost" data-cp="location-remove">${I.close}</button></div>` : ''}
      ${showDate ? `<label class="cp-row">${I.calendar}<span>Date de l’événement</span><input type="date" class="input" value="${attr(c.eventDate || '')}" data-cp-input="eventDate"></label>` : ''}
      ${c.publishAt !== '' || c.scheduling ? `<label class="cp-row">${I.clock}<span>Publier le</span><input type="datetime-local" class="input" value="${attr(c.publishAt ? toLocalInput(c.publishAt) : '')}" data-cp-input="publishAt"><button type="button" class="btn icon sm ghost" data-cp="unschedule" title="Publier maintenant">${I.close}</button></label>` : ''}
      ${fieldInputs ? `<div class="cp-fields">${fieldInputs}</div>` : ''}
    </div>
    <div class="cp-add">
      <button type="button" data-cp="file" title="Fichier, image, document">${I.attach}<span>Fichier</span></button>
      <button type="button" data-cp="photo" title="Prendre une photo">${I.camera}<span>Photo</span></button>
      <button type="button" data-cp="rec-video" title="Enregistrer une vidéo">${I.video}<span>Vidéo</span></button>
      <button type="button" data-cp="rec-audio" title="Enregistrer un message audio">${I.mic}<span>Audio</span></button>
      <button type="button" data-cp="rec-screen" title="Enregistrer l’écran">${I.screen}<span>Écran</span></button>
      <button type="button" data-cp="draw" title="Dessiner">${I.pen}<span>Dessin</span></button>
      <button type="button" data-cp="link" title="Lien web, vidéo YouTube…">${I.link}<span>Lien</span></button>
      <button type="button" data-cp="poll" title="Sondage" ${c.poll ? 'disabled' : ''}>${I.poll}<span>Sondage</span></button>
      <button type="button" data-cp="location" title="Lieu sur la carte">${I.pin}<span>Lieu</span></button>
      ${!showDate ? `<button type="button" data-cp="date" title="Date (chronologie)">${I.calendar}<span>Date</span></button>` : ''}
      ${canSchedule && !c.editing && c.publishAt === '' && !c.scheduling ? `<button type="button" data-cp="schedule" title="Programmer la publication">${I.clockPlus}<span>Programmer</span></button>` : ''}
    </div>
    <div class="cp-foot">
      ${s.sections.length > 1 ? `<label class="cp-sec">${I.columns}<select class="select" data-cp-input="sectionId">${s.sections.map(x => `<option value="${attr(x.id)}" ${x.id === c.sectionId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select></label>` : ''}
      <div class="cp-colors">${E.CARD_COLORS.map(col => `<button type="button" class="${(c.color || null) === col ? 'on' : ''}" data-cp="color" data-c="${col || ''}" style="background:${col || 'var(--card)'}" title="${col ? 'Couleur' : 'Sans couleur'}"></button>`).join('')}</div>
      <span class="grow"></span>
      ${E.space.settings.moderation === 'approval' && !E.can('moderate') ? `<span class="cp-note">${I.shield}Validée avant d’apparaître</span>` : ''}
      <button type="button" class="btn" data-cp="close">Annuler</button>
      <button type="submit" class="btn primary" ${c.saving ? 'disabled' : ''}>${c.saving ? 'Envoi…' : c.editing ? 'Enregistrer' : c.publishAt ? 'Programmer' : 'Publier'}</button>
    </div>`;
  const ta = form.querySelector('.cp-text');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(420, Math.max(96, ta.scrollHeight))}px`; };
  ta.addEventListener('input', grow); grow();
};
const toLocalInput = iso => { const d = new Date(iso); const pad = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
E.composerAttHTML = function (a, i) {
  const thumb = ['image', 'drawing', 'svg'].includes(a.kind) ? `<img src="${attr(E.mediaUrl(a.file))}" alt="">` : a.kind === 'video' ? I.video : a.kind === 'audio' ? I.mic : a.kind === 'link' || a.kind === 'embed' ? (a.preview?.image ? `<img src="${attr(E.mediaUrl(a.preview.image))}" alt="">` : I.link) : a.kind === 'local' ? I.fileText : I.file;
  const label = a.kind === 'link' || a.kind === 'embed' ? (a.preview?.title || a.url) : a.name || a.file;
  const sub = a.kind === 'link' || a.kind === 'embed' ? (a.embed ? 'Vidéo intégrée' : a.preview?.site || 'Lien') : a.kind === 'local' ? 'Support de cours' : [({ image: 'Image', drawing: 'Dessin', svg: 'Illustration', video: 'Vidéo', audio: 'Audio', file: 'Fichier' })[a.kind], sizeLabel(a.size)].filter(Boolean).join(' · ');
  return `<div class="cp-att"><span class="cp-thumb">${thumb}</span><span class="grow"><b>${esc(label)}</b><span>${esc(sub)}</span></span>${i > 0 ? `<button type="button" class="btn icon sm ghost" data-cp="att-up" data-i="${i}" title="Monter">${I.chevU}</button>` : ''}<button type="button" class="btn icon sm ghost" data-cp="att-del" data-i="${i}" title="Retirer">${I.close}</button></div>`;
};
E.fieldInput = function (f, v) {
  const id = `cpf-${f.id}`;
  const req = f.required ? '<i class="req" title="Obligatoire">*</i>' : '';
  const label = `<label for="${id}">${I[E.FIELD_ICONS[f.type]] || ''}${esc(f.name)}${req}</label>`;
  const val = v ?? '';
  switch (f.type) {
    case 'number': return `<div class="cpf">${label}<input id="${id}" class="input" type="number" step="any" value="${attr(val)}" data-field="${attr(f.id)}"></div>`;
    case 'score': return `<div class="cpf">${label}<div class="inline"><input id="${id}" class="input" type="number" min="0" max="${f.max || 20}" step="0.25" value="${attr(val)}" data-field="${attr(f.id)}"><span class="muted">/ ${f.max || 20}</span></div></div>`;
    case 'date': return `<div class="cpf">${label}<input id="${id}" class="input" type="date" value="${attr(val)}" data-field="${attr(f.id)}"></div>`;
    case 'email': return `<div class="cpf">${label}<input id="${id}" class="input" type="email" value="${attr(val)}" placeholder="nom@exemple.fr" data-field="${attr(f.id)}"></div>`;
    case 'phone': return `<div class="cpf">${label}<input id="${id}" class="input" type="tel" value="${attr(val)}" placeholder="06 12 34 56 78" data-field="${attr(f.id)}"></div>`;
    case 'url': case 'button': return `<div class="cpf">${label}<input id="${id}" class="input" type="url" value="${attr(val)}" placeholder="https://…" data-field="${attr(f.id)}"></div>`;
    case 'select': return `<div class="cpf">${label}<div class="chips-pick" data-field-select="${attr(f.id)}">${(f.options || []).map(o => `<button type="button" class="${v === o.id ? 'on' : ''}" data-opt="${attr(o.id)}" style="${o.color ? `--fc:${o.color}` : ''}">${esc(o.label)}</button>`).join('')}</div></div>`;
    case 'multiselect': return `<div class="cpf">${label}<div class="chips-pick multi" data-field-multi="${attr(f.id)}">${(f.options || []).map(o => `<button type="button" class="${(v || []).includes(o.id) ? 'on' : ''}" data-opt="${attr(o.id)}" style="${o.color ? `--fc:${o.color}` : ''}">${esc(o.label)}</button>`).join('')}</div></div>`;
    case 'rating': return `<div class="cpf">${label}<div class="stars-pick" data-field-rating="${attr(f.id)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${n <= (v || 0) ? 'on' : ''}">${n <= (v || 0) ? I.starFill : I.star}</button>`).join('')}</div></div>`;
    case 'user': return `<div class="cpf">${label}<input id="${id}" class="input" value="${attr(val)}" list="people-list" placeholder="Nom" data-field="${attr(f.id)}"><datalist id="people-list">${[...new Set([E.me?.name, ...E.people.map(p => p.name), ...E.space.posts.map(p => p.author?.name)].filter(Boolean))].map(n => `<option value="${attr(n)}">`).join('')}</datalist></div>`;
    default: return `<div class="cpf">${label}<input id="${id}" class="input" value="${attr(val)}" placeholder="${attr(f.placeholder || '')}" data-field="${attr(f.id)}"></div>`;
  }
};
E.composerUpload = async function (file, { kind } = {}) {
  const comp = E.composer;
  if (!comp) return;
  const c = comp.c;
  const u = { id: randomId(6), name: file.name || 'fichier', progress: 0, ctrl: new AbortController() };
  c.uploads.push(u);
  E.renderComposerAtts();
  try {
    const att = await E.upload(file, { name: file.name, onProgress: p => { u.progress = p; const bar = comp.box.querySelector(`[data-id="${u.id}"]`)?.closest('.cp-att')?.querySelector('.bar i'); if (bar) bar.style.width = `${Math.round(p * 100)}%`; }, signal: u.ctrl.signal });
    if (kind) att.kind = kind;
    c.attachments.push(att);
    E.saveDraft(c);
  } catch (err) { if (err.name !== 'AbortError') toast(err.message, 'error'); }
  c.uploads = c.uploads.filter(x => x !== u);
  if (E.composer?.c === c) E.renderComposerAtts();
};
E.renderComposerAtts = function () {
  const comp = E.composer;
  if (!comp) return;
  const host = comp.box.querySelector('.cp-atts');
  if (!host) return E.renderComposer();
  host.innerHTML = comp.c.attachments.map((a, i) => E.composerAttHTML(a, i)).join('') + comp.c.uploads.map(u => `<div class="cp-att uploading">${I.upload}<span class="grow"><b>${esc(u.name)}</b><span class="bar"><i style="width:${Math.round(u.progress * 100)}%"></i></span></span><button type="button" class="btn icon sm ghost" data-cp="cancel-upload" data-id="${u.id}" title="Annuler">${I.close}</button></div>`).join('');
};
E.addLink = async function (url) {
  const comp = E.composer;
  if (!comp) return;
  const c = comp.c;
  const u = { id: randomId(6), name: url, progress: 0.3, ctrl: new AbortController() };
  c.uploads.push(u); E.renderComposerAtts();
  try {
    const { preview } = await E.api('POST', `/spaces/${E.space.id}/preview`, { url });
    c.attachments.push({ id: `a_${randomId(8)}`, kind: preview.embed ? 'embed' : 'link', url: preview.url, embed: preview.embed || undefined, name: preview.title, preview: { title: preview.title, description: preview.description, site: preview.site, image: preview.image } });
    if (!c.title && preview.title && !c.body) c.title = preview.title.slice(0, 120);
    E.saveDraft(c);
  } catch (err) { toast(err.message, 'error'); }
  c.uploads = c.uploads.filter(x => x !== u);
  if (E.composer?.c === c) E.renderComposer();
};
E.pickFiles = function (accept, { capture = null, multiple = true } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = multiple;
    if (accept) input.accept = accept;
    if (capture) input.setAttribute('capture', capture);
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
};
E.submitComposer = async function () {
  const { box, c } = E.composer;
  if (c.saving) return;
  if (c.uploads.length) { toast('Patientez : des fichiers sont encore en cours d’envoi.'); return; }
  const payload = {
    title: c.title.trim(), body: c.body, color: c.color, sectionId: c.sectionId, attachments: c.attachments,
    poll: c.poll && c.poll.options.filter(o => o.text.trim()).length >= 2 ? { question: c.poll.question.trim(), multiple: c.poll.multiple, options: c.poll.options.filter(o => o.text.trim()).map(o => ({ id: o.id, text: o.text.trim() })) } : null,
    location: c.location, eventDate: c.eventDate || null, fields: c.fields,
  };
  if (c.poll && !payload.poll) { toast('Un sondage demande au moins deux réponses.', 'error'); return; }
  if (!c.editing && c.publishAt) payload.publishAt = new Date(c.publishAt).toISOString();
  const missing = E.space.fields.filter(f => f.required && f.type !== 'vote' && (c.fields[f.id] == null || c.fields[f.id] === '' || (Array.isArray(c.fields[f.id]) && !c.fields[f.id].length)));
  if (missing.length) { toast(`Champ obligatoire : ${missing.map(f => f.name).join(', ')}`, 'error'); return; }
  if (!E.composerHasContent(c)) { toast('Ajoutez un titre, un texte ou un fichier.', 'error'); return; }
  c.saving = true; E.renderComposer();
  try {
    const { post } = c.editing ? await E.api('PATCH', `/spaces/${E.space.id}/posts/${c.editing}`, payload) : await E.api('POST', `/spaces/${E.space.id}/posts`, payload);
    E.upsertPost(post);
    const wasEditing = !!c.editing;
    if (!wasEditing) { E.draft = null; E.saveDraft.cancel(); }
    c.editing = post.id;
    UI.close(box);
    if (post.status === 'pending') toast('Publication envoyée : elle apparaîtra après validation.');
    else if (!wasEditing && !(post.publishAt && Date.parse(post.publishAt) > Date.now())) toast('Publié');
    if (post.publishAt && Date.parse(post.publishAt) > Date.now()) toast(`Programmée pour ${localDate(post.publishAt, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`);
    setTimeout(() => { const n = E.mounted?.el.querySelector(`.esp-body [data-post="${CSS.escape(post.id)}"]`); n?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); n?.classList.add('post-new'); }, 60);
  } catch (err) { c.saving = false; if (E.composer?.c === c) E.renderComposer(); toast(err.message, 'error'); }
};
function wrapSelection(ta, before, after = before, placeholder = '') {
  const { selectionStart: a, selectionEnd: b, value } = ta;
  const sel = value.slice(a, b) || placeholder;
  ta.setRangeText(before + sel + after, a, b, 'end');
  if (!value.slice(a, b) && placeholder) { ta.selectionStart = a + before.length; ta.selectionEnd = a + before.length + placeholder.length; }
  ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
}
document.addEventListener('click', async e => {
  const comp = E.composer;
  if (!comp || !comp.box.contains(e.target)) return;
  const c = comp.c;
  const fmt = e.target.closest('[data-fmt]');
  if (fmt) {
    const ta = comp.box.querySelector('.cp-text');
    const k = fmt.dataset.fmt;
    if (k === 'bold') wrapSelection(ta, '**', '**', 'texte');
    if (k === 'italic') wrapSelection(ta, '*', '*', 'texte');
    if (k === 'math') wrapSelection(ta, '$', '$', 'x^2');
    if (k === 'list') { const p = ta.selectionStart; const start = ta.value.lastIndexOf('\n', p - 1) + 1; ta.setRangeText('- ', start, start, 'end'); ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    if (k === 'link') { const u = await UI.prompt('Adresse du lien', 'https://', { ok: 'Insérer' }); if (u) wrapSelection(ta, '[', `](${u})`, 'texte du lien'); }
    return;
  }
  const opt = e.target.closest('[data-field-select] [data-opt]');
  if (opt) { const id = opt.closest('[data-field-select]').dataset.fieldSelect; c.fields[id] = c.fields[id] === opt.dataset.opt ? null : opt.dataset.opt; opt.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.opt === c.fields[id])); return E.saveDraft(c); }
  const mopt = e.target.closest('[data-field-multi] [data-opt]');
  if (mopt) { const id = mopt.closest('[data-field-multi]').dataset.fieldMulti; const set = new Set(c.fields[id] || []); set.has(mopt.dataset.opt) ? set.delete(mopt.dataset.opt) : set.add(mopt.dataset.opt); c.fields[id] = [...set]; mopt.classList.toggle('on'); return E.saveDraft(c); }
  const star = e.target.closest('[data-field-rating] [data-n]');
  if (star) { const id = star.closest('[data-field-rating]').dataset.fieldRating; const n = +star.dataset.n; c.fields[id] = c.fields[id] === n ? null : n; star.parentElement.querySelectorAll('button').forEach(b => { const on = +b.dataset.n <= (c.fields[id] || 0); b.classList.toggle('on', on); b.innerHTML = on ? I.starFill : I.star; }); return E.saveDraft(c); }
  const b = e.target.closest('[data-cp]');
  if (!b) return;
  const a = b.dataset.cp;
  switch (a) {
    case 'close': return UI.dismiss(UI.stack.find(x => x.box === comp.box));
    case 'file': { const files = await E.pickFiles(''); for (const f of files) E.composerUpload(f); return; }
    case 'photo': return E.capturePhoto().then(f => f && E.composerUpload(f)).catch(err => toast(err.message, 'error'));
    case 'rec-video': return E.record('video').then(f => f && E.composerUpload(f)).catch(err => toast(err.message, 'error'));
    case 'rec-audio': return E.record('audio').then(f => f && E.composerUpload(f)).catch(err => toast(err.message, 'error'));
    case 'rec-screen': return E.record('screen').then(f => f && E.composerUpload(f)).catch(err => toast(err.message, 'error'));
    case 'draw': return E.drawPad().then(f => f && E.composerUpload(f, { kind: 'drawing' })).catch(err => toast(err.message, 'error'));
    case 'link': { const u = await UI.prompt('Ajouter un lien', '', { placeholder: 'https://… (page web, vidéo YouTube, document…)', ok: 'Ajouter' }); if (u && u.trim()) E.addLink(u.trim()); return; }
    case 'poll': c.poll = { question: '', multiple: false, options: [{ id: `o_${randomId(5)}`, text: '' }, { id: `o_${randomId(5)}`, text: '' }] }; E.renderComposer(); comp.box.querySelector('[data-cp-input="poll-question"]')?.focus(); return;
    case 'poll-add': c.poll.options.push({ id: `o_${randomId(5)}`, text: '' }); E.renderComposer(); comp.box.querySelectorAll('[data-cp-input="poll-opt"]')[c.poll.options.length - 1]?.focus(); return;
    case 'poll-del': c.poll.options.splice(+b.dataset.i, 1); return E.renderComposer();
    case 'poll-remove': c.poll = null; return E.renderComposer();
    case 'location': { const loc = await E.pickLocation?.(c.location); if (loc) { c.location = loc; E.renderComposer(); E.saveDraft(c); } return; }
    case 'location-remove': c.location = null; E.renderComposer(); return E.saveDraft(c);
    case 'date': c.eventDate = new Date().toISOString().slice(0, 10); return E.renderComposer();
    case 'schedule': c.scheduling = true; c.publishAt = new Date(Date.now() + 86400_000).toISOString(); return E.renderComposer();
    case 'unschedule': c.scheduling = false; c.publishAt = ''; return E.renderComposer();
    case 'color': c.color = b.dataset.c || null; comp.box.querySelectorAll('.cp-colors button').forEach(x => x.classList.toggle('on', (x.dataset.c || null) === c.color)); return E.saveDraft(c);
    case 'att-del': c.attachments.splice(+b.dataset.i, 1); E.renderComposerAtts(); return E.saveDraft(c);
    case 'att-up': { const i = +b.dataset.i; [c.attachments[i - 1], c.attachments[i]] = [c.attachments[i], c.attachments[i - 1]]; E.renderComposerAtts(); return E.saveDraft(c); }
    case 'cancel-upload': { const u = c.uploads.find(x => x.id === b.dataset.id); u?.ctrl.abort(); return; }
  }
});
document.addEventListener('input', e => {
  const comp = E.composer;
  if (!comp || !comp.box.contains(e.target)) return;
  const c = comp.c;
  const k = e.target.dataset.cpInput;
  if (k === 'title') c.title = e.target.value;
  else if (k === 'body') c.body = e.target.value;
  else if (k === 'poll-question') c.poll.question = e.target.value;
  else if (k === 'poll-opt') c.poll.options[+e.target.dataset.i].text = e.target.value;
  else if (k === 'poll-multiple') c.poll.multiple = e.target.checked;
  else if (k === 'eventDate') c.eventDate = e.target.value;
  else if (k === 'publishAt') c.publishAt = e.target.value ? new Date(e.target.value).toISOString() : '';
  else if (k === 'sectionId') c.sectionId = e.target.value;
  else if (e.target.dataset.field) { const f = E.field(e.target.dataset.field); const v = e.target.value; c.fields[f.id] = v === '' ? null : (f.type === 'number' || f.type === 'score') ? Number(v) : v; }
  else return;
  E.saveDraft(c);
});
document.addEventListener('change', e => {
  const comp = E.composer;
  if (comp && comp.box.contains(e.target) && e.target.dataset.cpInput === 'sectionId') { comp.c.sectionId = e.target.value; E.saveDraft(comp.c); }
});
document.addEventListener('submit', e => {
  if (E.composer && E.composer.box.contains(e.target)) { e.preventDefault(); E.submitComposer(); }
});
document.addEventListener('keydown', e => {
  if (E.composer && E.composer.box.contains(e.target) && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); E.submitComposer(); }
});
document.addEventListener('paste', e => {
  const comp = E.composer;
  if (!comp || !comp.box.contains(e.target)) return;
  const files = E.filesFrom(e.clipboardData);
  if (files.length) { e.preventDefault(); files.forEach(f => E.composerUpload(f)); return; }
  const url = E.urlFrom(e.clipboardData);
  if (url && e.target.classList.contains('cp-text') && !comp.c.body.trim()) { e.preventDefault(); E.addLink(url); }
});
document.addEventListener('dragover', e => { if (E.composer?.box.contains(e.target)) { e.preventDefault(); E.composer.box.classList.add('drop-target'); } });
document.addEventListener('dragleave', e => { if (E.composer?.box && !E.composer.box.contains(e.relatedTarget)) E.composer.box.classList.remove('drop-target'); });
document.addEventListener('drop', e => {
  const comp = E.composer;
  if (!comp || !comp.box.contains(e.target)) return;
  e.preventDefault(); e.stopPropagation();
  comp.box.classList.remove('drop-target');
  const files = E.filesFrom(e.dataTransfer);
  if (files.length) files.forEach(f => E.composerUpload(f));
  else { const url = E.urlFrom(e.dataTransfer); if (url) E.addLink(url); }
}, true);

// ======================= Photo, enregistrements audio, vidéo, écran =======================
const pickMime = kind => {
  const list = kind === 'audio' ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] : ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  return list.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
};
const canCapture = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
E.capturePhoto = async function () {
  if (!canCapture()) { const [f] = await E.pickFiles('image/*', { capture: 'environment', multiple: false }); return f || null; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }); }
  catch (err) { throw new Error(err.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorisez-le dans Réglages Système › Confidentialité › Caméra.' : 'Caméra indisponible.'); }
  return new Promise(resolve => {
    let done = false;
    const stop = () => stream.getTracks().forEach(t => t.stop());
    const box = UI.modal(`<div class="rec"><div class="rec-head"><b>${I.camera}Photo</b><button class="btn icon ghost" data-r="close">${I.close}</button></div><video class="rec-view mirror" autoplay playsinline muted></video><div class="rec-foot"><button class="rec-shutter" data-r="shoot" title="Prendre la photo"></button></div></div>`, { cls: 'rec-modal', onClose: () => { stop(); if (!done) resolve(null); } });
    box.querySelector('video').srcObject = stream;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'close') return UI.close(box);
      const v = box.querySelector('video');
      const cv = document.createElement('canvas');
      cv.width = v.videoWidth; cv.height = v.videoHeight;
      const ctx = cv.getContext('2d'); ctx.translate(cv.width, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0);
      cv.toBlob(blob => { done = true; resolve(new File([blob], `Photo ${new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-')}.jpg`, { type: 'image/jpeg' })); UI.close(box); }, 'image/jpeg', 0.9);
    });
  });
};
E.record = async function (kind) {
  if (kind !== 'screen' && !canCapture()) { const [f] = await E.pickFiles(kind === 'audio' ? 'audio/*' : 'video/*', { capture: kind === 'audio' ? 'user' : 'environment', multiple: false }); return f || null; }
  if (kind === 'screen' && !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia)) throw new Error('L’enregistrement d’écran n’est pas disponible ici. Utilisez ⌘⇧5 sur Mac, puis glissez la vidéo dans la publication.');
  let stream;
  try {
    if (kind === 'audio') stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    else if (kind === 'video') stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
    else {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      try { const mic = await navigator.mediaDevices.getUserMedia({ audio: true }); mic.getAudioTracks().forEach(t => stream.addTrack(t)); } catch {}
    }
  } catch (err) {
    if (err.name === 'NotAllowedError') throw new Error(kind === 'screen' ? 'Enregistrement de l’écran refusé. Autorisez Cours Albert dans Réglages Système › Confidentialité › Enregistrement de l’écran.' : `Accès ${kind === 'audio' ? 'au micro' : 'à la caméra'} refusé. Autorisez-le dans Réglages Système › Confidentialité.`);
    throw new Error(`${kind === 'audio' ? 'Micro' : kind === 'video' ? 'Caméra' : 'Partage d’écran'} indisponible (${err.message}).`);
  }
  const mime = pickMime(kind === 'audio' ? 'audio' : 'video');
  const label = { audio: 'Message audio', video: 'Vidéo', screen: 'Enregistrement d’écran' }[kind];
  return new Promise(resolve => {
    let recorder, chunks = [], started = 0, timer = null, finished = false, analyser = null, raf = 0, actx = null;
    const stopAll = () => { stream.getTracks().forEach(t => t.stop()); clearInterval(timer); cancelAnimationFrame(raf); actx?.close().catch(() => {}); };
    const box = UI.modal(`<div class="rec ${kind}"><div class="rec-head"><b>${I[kind === 'audio' ? 'mic' : kind === 'video' ? 'video' : 'screen']}${label}</b><span class="rec-time">00:00</span><button class="btn icon ghost" data-r="close">${I.close}</button></div>
      ${kind === 'audio' ? '<canvas class="rec-level" width="560" height="90"></canvas>' : `<video class="rec-view ${kind === 'video' ? 'mirror' : ''}" autoplay playsinline muted></video>`}
      <div class="rec-preview"></div>
      <div class="rec-foot"><button class="btn primary rec-go" data-r="start">${I.record}Démarrer</button></div></div>`, { cls: 'rec-modal', onClose: () => { if (recorder && recorder.state !== 'inactive') { finished = true; recorder.stop(); } stopAll(); if (!finished) resolve(null); } });
    const view = box.querySelector('video.rec-view');
    if (view) view.srcObject = stream;
    if (kind === 'audio') {
      try {
        actx = new AudioContext(); const src = actx.createMediaStreamSource(stream); analyser = actx.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
        const cv = box.querySelector('canvas'), g = cv.getContext('2d'), data = new Uint8Array(analyser.frequencyBinCount);
        const draw = () => { analyser.getByteTimeDomainData(data); g.clearRect(0, 0, cv.width, cv.height); g.strokeStyle = getComputedStyle(document.body).getPropertyValue('--accent') || '#4f46e5'; g.lineWidth = 3; g.beginPath(); data.forEach((v, i) => { const x = i / data.length * cv.width, y = v / 255 * cv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); raf = requestAnimationFrame(draw); };
        draw();
      } catch {}
    }
    stream.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (recorder && recorder.state === 'recording') recorder.stop(); }));
    const foot = box.querySelector('.rec-foot');
    const setFoot = html => { foot.innerHTML = html; };
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      const act = b.dataset.r;
      if (act === 'close') return UI.close(box);
      if (act === 'start') {
        chunks = [];
        try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
        catch (err) { toast(`Enregistrement impossible : ${err.message}`, 'error'); return; }
        recorder.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
        recorder.onstop = () => {
          clearInterval(timer);
          const type = recorder.mimeType || mime || (kind === 'audio' ? 'audio/webm' : 'video/webm');
          const blob = new Blob(chunks, { type });
          const ext = type.includes('mp4') ? (kind === 'audio' ? 'm4a' : 'mp4') : 'webm';
          const file = new File([blob], `${label} ${new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-')}.${ext}`, { type: type.split(';')[0] });
          if (finished) return;
          stopAll();
          const url = URL.createObjectURL(blob);
          box.querySelector('.rec-preview').innerHTML = kind === 'audio' ? `<audio src="${url}" controls></audio>` : `<video src="${url}" controls playsinline></video>`;
          if (view) view.style.display = 'none';
          box.querySelector('.rec-level')?.remove();
          setFoot(`<button class="btn" data-r="close">Annuler</button><button class="btn primary" data-r="use">${I.check}Ajouter</button>`);
          box._file = file;
        };
        recorder.start(1000);
        started = Date.now();
        timer = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); box.querySelector('.rec-time').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; if (s >= 3600) recorder.stop(); }, 250);
        box.classList.add('recording');
        setFoot(`<button class="btn danger-fill" data-r="stop">${I.stop}Arrêter</button>`);
      }
      if (act === 'stop' && recorder?.state === 'recording') { box.classList.remove('recording'); recorder.stop(); }
      if (act === 'use') { finished = true; resolve(box._file); UI.close(box); }
    });
  });
};

// ======================= Dessin =======================
E.drawPad = function ({ background = '#ffffff' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const W = 1400, H = 900;
    const colors = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
    const box = UI.modal(`<div class="draw"><div class="draw-head"><b>${I.pen}Dessin</b>
      <div class="draw-tools"><button class="on" data-d-tool="pen" title="Stylo">${I.pen}</button><button data-d-tool="marker" title="Surligneur">${I.marker}</button><button data-d-tool="eraser" title="Gomme">${I.eraser}</button>
      <span class="sep"></span>${colors.map((c, i) => `<button class="sw ${i === 0 ? 'on' : ''}" data-d-color="${c}" style="background:${c}"></button>`).join('')}
      <span class="sep"></span>${[3, 6, 12, 24].map((w, i) => `<button class="${i === 1 ? 'on' : ''}" data-d-size="${w}" title="Épaisseur"><i style="width:${Math.min(18, w)}px;height:${Math.min(18, w)}px"></i></button>`).join('')}
      <span class="sep"></span><button data-d="undo" title="Annuler (⌘Z)">${I.undo}</button><button data-d="clear" title="Tout effacer">${I.trash}</button></div>
      <button class="btn icon ghost" data-d="close">${I.close}</button></div>
      <div class="draw-stage"><canvas width="${W}" height="${H}"></canvas></div>
      <div class="draw-foot"><button class="btn" data-d="close">Annuler</button><button class="btn primary" data-d="use">${I.check}Ajouter le dessin</button></div></div>`, { cls: 'draw-modal', onClose: () => { if (!done) resolve(null); } });
    const cv = box.querySelector('canvas'), g = cv.getContext('2d');
    g.fillStyle = background; g.fillRect(0, 0, W, H); g.lineCap = 'round'; g.lineJoin = 'round';
    let tool = 'pen', color = colors[0], size = 6, history = [], drawing = false, last = null;
    const snap = () => { history.push(g.getImageData(0, 0, W, H)); if (history.length > 30) history.shift(); };
    const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height, p: e.pressure || 0.5 }; };
    cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); snap(); drawing = true; last = pos(e); stroke(last, last); });
    cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); stroke(last, p); last = p; });
    const end = () => { drawing = false; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    function stroke(a, b) {
      g.save();
      if (tool === 'eraser') { g.strokeStyle = background; g.lineWidth = size * 4; }
      else if (tool === 'marker') { g.globalAlpha = 0.35; g.strokeStyle = color; g.lineWidth = size * 3; g.globalCompositeOperation = 'multiply'; }
      else { g.strokeStyle = color; g.lineWidth = size * (0.6 + (b.p || 0.5) * 0.8); }
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.restore();
    }
    box.addEventListener('click', e => {
      const t = e.target.closest('[data-d-tool]'), c = e.target.closest('[data-d-color]'), s = e.target.closest('[data-d-size]'), d = e.target.closest('[data-d]');
      if (t) { tool = t.dataset.dTool; box.querySelectorAll('[data-d-tool]').forEach(x => x.classList.toggle('on', x === t)); }
      if (c) { color = c.dataset.dColor; if (tool === 'eraser') tool = 'pen'; box.querySelectorAll('[data-d-color]').forEach(x => x.classList.toggle('on', x === c)); box.querySelectorAll('[data-d-tool]').forEach(x => x.classList.toggle('on', x.dataset.dTool === tool)); }
      if (s) { size = +s.dataset.dSize; box.querySelectorAll('[data-d-size]').forEach(x => x.classList.toggle('on', x === s)); }
      if (d) {
        if (d.dataset.d === 'close') UI.close(box);
        if (d.dataset.d === 'undo' && history.length) g.putImageData(history.pop(), 0, 0);
        if (d.dataset.d === 'clear') { snap(); g.fillStyle = background; g.fillRect(0, 0, W, H); }
        if (d.dataset.d === 'use') cv.toBlob(blob => { done = true; resolve(new File([blob], `Dessin ${new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-')}.png`, { type: 'image/png' })); UI.close(box); }, 'image/png');
      }
    });
    box.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'z' && history.length) { e.preventDefault(); g.putImageData(history.pop(), 0, 0); } });
    box.tabIndex = -1; box.focus();
  });
};

// ======================= Vue détaillée et commentaires =======================
E.openPost = function (id) {
  const post = E.space?.posts.find(p => p.id === id);
  if (!post) return;
  E.closeOpenPost();
  const box = UI.modal('<div class="pd"></div>', { cls: 'sheet post-sheet', label: 'Publication', onClose: () => { if (E.detail?.box === box) E.detail = null; } });
  E.detail = { box, id, comment: '', attachment: null };
  E.renderDetail();
};
E.renderDetail = function () {
  const d = E.detail;
  if (!d) return;
  const post = E.space?.posts.find(p => p.id === d.id);
  if (!post) return UI.close(d.box);
  const s = E.space.settings;
  const sec = E.space.sections.length > 1 ? E.section(post.sectionId) : null;
  const scroll = d.box.querySelector('.pd-content')?.scrollTop || 0;
  const draft = d.box.querySelector('.pd-comment textarea')?.value ?? d.comment;
  const comments = post.comments || [];
  d.box.querySelector('.pd').innerHTML = `
    <div class="pd-content" style="${post.color ? `--pc:${post.color}` : ''}">
      <div class="pd-top">
        ${s.showAuthor ? `${avatar(post.author?.name, post.author?.id, 30)}<div class="pd-who"><b>${esc(post.author?.name || '')}</b><span title="${attr(localDate(post.createdAt, { dateStyle: 'full', timeStyle: 'short' }))}">${esc(ago(post.createdAt))}${post.updatedAt !== post.createdAt ? ' · modifiée' : ''}${sec ? ` · ${esc(sec.title)}` : ''}</span></div>` : `<div class="pd-who">${sec ? `<b>${esc(sec.title)}</b>` : ''}</div>`}
        <span class="grow"></span>
        ${post.mine || E.can('moderate') ? `<button class="btn sm" data-pd="edit">${I.edit}Modifier</button>` : ''}
        <button class="btn icon sm ghost" data-pd="menu" title="Actions">${I.more}</button>
        <button class="btn icon sm ghost" data-pd="close" title="Fermer">${I.close}</button>
      </div>
      ${post.status === 'pending' ? `<div class="post-flag">${I.shield}En attente de validation${E.can('moderate') ? `<span class="grow"></span><button class="btn sm" data-pd="approve">${I.check}Valider</button><button class="btn sm ghost" data-pd="reject">Refuser</button>` : ''}</div>` : ''}
      ${E.attachmentsHTML(post, { full: true })}
      ${post.title ? `<h2 class="pd-title">${esc(post.title)}</h2>` : ''}
      ${post.body ? `<div class="pd-text md">${MD.post(post.body)}</div>` : ''}
      ${E.pollHTML(post)}
      ${post.location ? `<div class="post-loc">${I.pin}${esc(post.location.label || '')} <a href="https://maps.apple.com/?ll=${post.location.lat},${post.location.lng}&q=${encodeURIComponent(post.location.label || 'Lieu')}" data-pd="maps" target="_blank" rel="noopener">Ouvrir dans Plans</a></div>` : ''}
      ${post.eventDate ? `<div class="post-loc">${I.calendar}${esc(localDate(post.eventDate + 'T12:00:00', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div>` : ''}
      ${E.fieldsHTML(post, { full: true })}
      ${s.reactions !== 'none' ? `<div class="pd-rx">${E.reactionsHTML(post, { full: true })}</div>` : ''}
      ${s.comments ? `<section class="pd-comments"><h3>${I.comment}${comments.length ? plural(comments.length, 'commentaire') : 'Commentaires'}</h3>
        ${comments.map(c => `<div class="cmt" data-cmt="${attr(c.id)}">${avatar(c.author?.name, c.author?.id, 26)}<div class="cmt-b"><div class="cmt-h"><b>${esc(c.author?.name || '')}</b><span>${esc(ago(c.createdAt))}</span>${c.mine || E.can('moderate') ? `<button class="btn icon sm ghost" data-pd="cdel" title="Supprimer">${I.trash}</button>` : ''}</div>${c.body ? `<div class="md">${MD.post(c.body)}</div>` : ''}${c.attachment ? E.attachmentsHTML({ attachments: [c.attachment] }, { full: true }) : ''}</div></div>`).join('') || '<p class="muted">Aucun commentaire pour l’instant.</p>'}
        ${E.can('comment') ? `<div class="pd-comment">${avatar(E.me?.name || 'Moi', E.me?.id, 26)}<div class="grow"><textarea class="input" rows="2" placeholder="Écrire un commentaire… (⌘↩ pour envoyer)">${esc(draft)}</textarea>${d.attachment ? `<div class="cp-att">${I.attach}<span class="grow"><b>${esc(d.attachment.name || 'Pièce jointe')}</b></span><button class="btn icon sm ghost" data-pd="catt-del">${I.close}</button></div>` : ''}<div class="pd-cbar"><button class="btn icon sm ghost" data-pd="cfile" title="Joindre un fichier">${I.attach}</button><button class="btn icon sm ghost" data-pd="caudio" title="Commentaire audio">${I.mic}</button><button class="btn icon sm ghost" data-pd="cvideo" title="Commentaire vidéo">${I.video}</button><span class="grow"></span><button class="btn sm primary" data-pd="csend">${I.send}Envoyer</button></div></div></div>` : ''}
      </section>` : ''}
    </div>`;
  d.box.querySelector('.pd-content').scrollTop = scroll;
};
E.refreshOpenPost = function (post) { if (E.detail && (!post || post.id === E.detail.id)) E.renderDetail(); };
E.closeOpenPost = function (id) { if (E.detail && (!id || E.detail.id === id)) UI.close(E.detail.box); };
E.sendComment = async function () {
  const d = E.detail;
  const ta = d.box.querySelector('.pd-comment textarea');
  const body = ta.value.trim();
  if (!body && !d.attachment) return;
  try {
    const { post } = await E.api('POST', `/spaces/${E.space.id}/posts/${d.id}/comments`, { body, attachment: d.attachment });
    d.comment = ''; d.attachment = null; ta.value = '';
    E.upsertPost(post);
    setTimeout(() => { const list = d.box.querySelector('.pd-content'); if (list) list.scrollTop = list.scrollHeight; }, 30);
  } catch (err) { toast(err.message, 'error'); }
};
E.attachComment = async function (file) {
  const d = E.detail;
  if (!file || !d) return;
  toast('Envoi du fichier…');
  try { d.attachment = await E.upload(file, { name: file.name }); d.comment = d.box.querySelector('.pd-comment textarea')?.value || ''; E.renderDetail(); }
  catch (err) { toast(err.message, 'error'); }
};
document.addEventListener('click', async e => {
  const d = E.detail;
  if (!d || !d.box.contains(e.target)) return;
  const post = E.space?.posts.find(p => p.id === d.id);
  if (!post) return;
  const ext = e.target.closest('a[href^="http"]');
  if (ext && window.call && E.mode === 'app') { e.preventDefault(); call('openURL', { url: ext.href }).catch(err => toast(err.message, 'error')); return; }
  const eb = e.target.closest('[data-e]');
  if (eb) {
    e.preventDefault();
    const a = eb.dataset.e;
    if (a === 'react') return E.react(post, eb.dataset.type, eb.dataset.value != null ? (eb.dataset.type === 'emoji' ? eb.dataset.value : +eb.dataset.value) : undefined);
    if (a === 'fieldvote') return E.react(post, 'fieldVote', undefined, eb.dataset.field);
    if (a === 'emoji') return emojiPicker(eb, em => E.react(post, 'emoji', em));
    if (a === 'grade') return E.gradeDialog(post);
    if (a === 'vote') return E.vote(post, eb.dataset.opt);
    if (a === 'lightbox') return E.lightbox(post, eb.dataset.att);
    if (a === 'file' || a === 'local') return E.openAttachment(post, eb.dataset.att, e.target.closest('.cmt'));
    if (a === 'play') return;
    return;
  }
  const b = e.target.closest('[data-pd]');
  if (!b) return;
  const a = b.dataset.pd;
  if (a === 'maps') return;
  e.preventDefault();
  if (a === 'close') return UI.close(d.box);
  if (a === 'edit') { UI.close(d.box); return E.compose({ post }); }
  if (a === 'menu') return E.postMenu(b, post);
  if (a === 'approve') return E.moderate(post, 'approve');
  if (a === 'reject') return E.moderate(post, 'reject');
  if (a === 'csend') return E.sendComment();
  if (a === 'cfile') { const [f] = await E.pickFiles('', { multiple: false }); return E.attachComment(f); }
  if (a === 'caudio') return E.record('audio').then(E.attachComment).catch(err => toast(err.message, 'error'));
  if (a === 'cvideo') return E.record('video').then(E.attachComment).catch(err => toast(err.message, 'error'));
  if (a === 'catt-del') { d.attachment = null; return E.renderDetail(); }
  if (a === 'cdel') {
    const cid = b.closest('[data-cmt]').dataset.cmt;
    if (!await UI.confirm('Supprimer ce commentaire ?', { ok: 'Supprimer', danger: true })) return;
    try { const { post: fresh } = await E.api('DELETE', `/spaces/${E.space.id}/posts/${post.id}/comments/${cid}`); E.upsertPost(fresh); } catch (err) { toast(err.message, 'error'); }
  }
});
document.addEventListener('keydown', e => {
  if (E.detail && E.detail.box.contains(e.target) && e.target.matches('.pd-comment textarea') && (e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); E.sendComment(); }
});
E.gradeDialog = async function (post) {
  const mine = post.reactions?.mine?.grade;
  const v = await UI.prompt('Votre note sur 20', mine != null ? String(mine).replace('.', ',') : '', { placeholder: 'Ex. 15,5', ok: 'Noter', message: post.reactions?.gradeCount ? `Moyenne actuelle : ${String(post.reactions.grade).replace('.', ',')}/20 (${plural(post.reactions.gradeCount, 'note')}). Laissez vide pour retirer votre note.` : 'Laissez vide pour retirer votre note.' });
  if (v === null) return;
  const n = v.trim() === '' ? null : Number(v.replace(',', '.'));
  if (n !== null && (!Number.isFinite(n) || n < 0 || n > 20)) { toast('Entrez une note entre 0 et 20.', 'error'); return; }
  E.react(post, 'grade', n);
};

// ======================= Visionneuse et fichiers joints =======================
E.lightbox = function (post, attId) {
  const imgs = (post.attachments || []).filter(a => ['image', 'drawing', 'svg'].includes(a.kind));
  let i = Math.max(0, imgs.findIndex(a => a.id === attId));
  if (!imgs.length) return;
  const box = UI.modal('<div class="lb"></div>', { cls: 'lightbox' });
  const draw = () => {
    const a = imgs[i];
    box.querySelector('.lb').innerHTML = `<img src="${attr(E.mediaUrl(a.file))}" alt="${attr(a.name || '')}"><div class="lb-bar"><span>${esc(a.name || '')}${imgs.length > 1 ? ` · ${i + 1}/${imgs.length}` : ''}</span><span class="grow"></span><button class="btn sm" data-lb="dl">${I.download}Télécharger</button><button class="btn icon sm" data-lb="close">${I.close}</button></div>${imgs.length > 1 ? `<button class="lb-nav prev" data-lb="prev">${I.chevL}</button><button class="lb-nav next" data-lb="next">${I.chevR}</button>` : ''}`;
  };
  draw();
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-lb]');
    if (!b) { if (e.target === box || e.target.classList.contains('lb')) UI.close(box); return; }
    if (b.dataset.lb === 'close') UI.close(box);
    if (b.dataset.lb === 'prev') { i = (i - 1 + imgs.length) % imgs.length; draw(); }
    if (b.dataset.lb === 'next') { i = (i + 1) % imgs.length; draw(); }
    if (b.dataset.lb === 'dl') E.saveMedia(imgs[i]);
  });
  box.tabIndex = -1; box.focus();
  box.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { i = (i - 1 + imgs.length) % imgs.length; draw(); } if (e.key === 'ArrowRight') { i = (i + 1) % imgs.length; draw(); } });
};
E.saveMedia = async function (a) {
  const url = E.mediaUrl(a.file, E.space.id, '&download=1');
  if (window.call && E.mode === 'app') { try { const saved = await call('saveURL', { url, suggested: a.name || a.file }); if (typeof saved === 'string') toast(`Enregistré : ${saved.split('/').pop()}`); } catch (err) { toast(err.message, 'error'); } }
  else { const link = document.createElement('a'); link.href = url; link.download = a.name || ''; document.body.appendChild(link); link.click(); link.remove(); }
};
E.openAttachment = function (post, attId, inComment) {
  const list = inComment ? (post.comments || []).map(c => c.attachment).filter(Boolean) : post.attachments || [];
  const a = list.find(x => x.id === attId) || (post.attachments || []).find(x => x.id === attId);
  if (!a) return;
  if (a.kind === 'local') {
    if (E.mode === 'app' && window.call) { if (TextViewer.isText({ path: a.path })) return TextViewer.open(a.path); return call('open', { path: a.path }).catch(err => toast(err.message, 'error')); }
    return window.open(E.localUrl(a.id), '_blank');
  }
  const ext = String(a.name || a.file).split('.').pop().toLowerCase();
  if (['pdf', 'txt', 'md', 'csv', 'json', 'py', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'm4a', 'mp3', 'wav', 'webm'].includes(ext)) {
    const url = E.mediaUrl(a.file);
    const box = UI.modal(`<div class="doc-view"><div class="dv-bar"><b>${esc(a.name || a.file)}</b><span class="grow"></span><button class="btn sm" data-dv="dl">${I.download}Télécharger</button><button class="btn icon sm ghost" data-dv="close">${I.close}</button></div><iframe src="${attr(url)}" title="${attr(a.name || '')}"></iframe></div>`, { cls: 'sheet doc-sheet' });
    box.addEventListener('click', e => { const b = e.target.closest('[data-dv]'); if (!b) return; if (b.dataset.dv === 'close') UI.close(box); else E.saveMedia(a); });
    return;
  }
  E.saveMedia(a);
};

// ======================= Cellules du tableau (disposition Tableau) =======================
E.editCell = function (cell, post, key) {
  if (cell.querySelector('.cell-edit')) return;
  const f = key === 'title' ? null : E.field(key);
  const current = key === 'title' ? post.title : post.fields?.[key];
  let input;
  if (f?.type === 'select') input = `<select class="cell-edit"><option value="">—</option>${(f.options || []).map(o => `<option value="${attr(o.id)}" ${current === o.id ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  else if (f?.type === 'multiselect' || f?.type === 'rating') { E.compose({ post }); return; }
  else input = `<input class="cell-edit" type="${f?.type === 'number' || f?.type === 'score' ? 'number' : f?.type === 'date' ? 'date' : f?.type === 'email' ? 'email' : f?.type === 'url' || f?.type === 'button' ? 'url' : 'text'}" value="${attr(current ?? '')}" step="any">`;
  const before = cell.innerHTML;
  cell.innerHTML = input;
  const el = cell.querySelector('.cell-edit');
  el.focus(); el.select?.();
  let done = false;
  const commit = async save => {
    if (done) return; done = true;
    if (!save) { cell.innerHTML = before; return; }
    const v = el.value;
    const patch = key === 'title' ? { title: v } : { fields: { [key]: v === '' ? null : (f.type === 'number' || f.type === 'score') ? Number(v) : v } };
    try { const { post: fresh } = await E.api('PATCH', `/spaces/${E.space.id}/posts/${post.id}`, patch); E.upsertPost(fresh); }
    catch (err) { cell.innerHTML = before; toast(err.message, 'error'); }
  };
  el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); } });
  el.addEventListener('blur', () => commit(true));
  if (el.tagName === 'SELECT') el.addEventListener('change', () => commit(true));
};

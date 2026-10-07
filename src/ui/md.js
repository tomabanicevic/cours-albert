/* Cours Albert 3 — Markdown façon Obsidian (callouts, [[liens]], LaTeX avec KaTeX, cases à cocher, tableaux) et lecteur de fichiers texte. */
'use strict';

const MD = (() => {
  const CALLOUTS = {
    note: ['Note', '#3b82f6'], info: ['Info', '#3b82f6'], todo: ['À faire', '#3b82f6'], abstract: ['Résumé', '#06b6d4'], summary: ['Résumé', '#06b6d4'], tldr: ['Résumé', '#06b6d4'],
    tip: ['Astuce', '#14b8a6'], hint: ['Astuce', '#14b8a6'], important: ['Important', '#14b8a6'], success: ['Réussi', '#22c55e'], check: ['Vérifié', '#22c55e'], done: ['Fait', '#22c55e'],
    question: ['Question', '#eab308'], help: ['Aide', '#eab308'], faq: ['FAQ', '#eab308'], warning: ['Attention', '#f97316'], caution: ['Prudence', '#f97316'], attention: ['Attention', '#f97316'],
    failure: ['Échec', '#ef4444'], fail: ['Échec', '#ef4444'], missing: ['Manquant', '#ef4444'], danger: ['Danger', '#ef4444'], error: ['Erreur', '#ef4444'], bug: ['Bug', '#ef4444'],
    example: ['Exemple', '#a855f7'], quote: ['Citation', '#9ca3af'], cite: ['Citation', '#9ca3af'],
  };
  const slug = s => normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const tex = (src, display) => {
    if (window.katex) {
      try { return window.katex.renderToString(src, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'html' }); } catch {}
    }
    return `<code class="math-src">${esc(display ? `$$${src}$$` : `$${src}$`)}</code>`;
  };

  // ---------- En ligne ----------
  function inline(src, ctx) {
    const keep = [];
    const hold = html => `\u0000${keep.push(html) - 1}\u0000`;
    let s = String(src);
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, t, code) => hold(`<code>${esc(code.trim())}</code>`));
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => hold(tex(x.trim(), true)));
    s = s.replace(/(^|[^\\$\w])\$(?=\S)([^$\n]*?\S)\$(?![\w$])/g, (m, pre, x) => pre + hold(tex(x, false)));
    s = s.replace(/!\[\[([^\]]+?)\]\]/g, (m, x) => hold(embedWiki(x, ctx)));
    s = s.replace(/\[\[([^\]]+?)\]\]/g, (m, x) => { const [target, alias] = x.split('|'); return hold(`<a class="wikilink" href="#" data-wiki="${attr(target.trim())}">${esc((alias || target.split('#')[0].split('/').pop() || target).trim())}</a>`); });
    s = s.replace(/!\[([^\]]*)\]\(<?([^)>\s]+)>?(?:\s+"[^"]*")?\)/g, (m, alt, url) => hold(image(url, alt, ctx)));
    s = s.replace(/\[([^\]]+)\]\(<([^>]+)>\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, t1, u1, t2, u2) => hold(link(u1 || u2, inline(t1 || t2, ctx), ctx)));
    s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (m, u) => hold(link(u, esc(u), ctx)));
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g, (m, pre, u) => pre + hold(link(u, esc(u.length > 60 ? u.slice(0, 57) + '…' : u), ctx)));
    s = s.replace(/<br\s*\/?>/gi, () => hold('<br>'));
    s = esc(s);
    s = s.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>').replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>')
      .replace(/(^|\s)#([A-Za-zÀ-ÿ][\wÀ-ÿ/-]*)/g, '$1<span class="md-tag">#$2</span>');
    if (ctx.breaks !== false) s = s.replace(/\n/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
  }
  function link(url, label, ctx) {
    const u = String(url).trim();
    if (/^(https?:|mailto:)/i.test(u)) return `<a href="${attr(u)}" class="ext" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return label; // javascript:, file:… refusés
    if (u.startsWith('#')) return `<a href="#" data-anchor="${attr(slug(decodeURIComponent(u.slice(1))))}">${label}</a>`;
    return `<a href="#" class="wikilink" data-rel="${attr(safeDecode(u))}">${label}</a>`;
  }
  const safeDecode = u => { try { return decodeURIComponent(u); } catch { return u; } };
  function image(url, alt, ctx) {
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return `<img src="${attr(u)}" alt="${attr(alt)}" loading="lazy" referrerpolicy="no-referrer">`;
    if (/^data:image\/(png|jpe?g|gif|webp);/i.test(u)) return `<img src="${attr(u)}" alt="${attr(alt)}">`;
    return `<img data-rel-img="${attr(safeDecode(u))}" alt="${attr(alt)}" class="pending-img">`;
  }
  function embedWiki(x, ctx) {
    const [target, size] = x.split('|');
    if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i.test(target.trim())) return `<img data-wiki-img="${attr(target.trim())}" class="pending-img" alt="" ${/^\d+$/.test(size || '') ? `style="width:${+size}px"` : ''}>`;
    return `<a class="wikilink embed" href="#" data-wiki="${attr(target.trim())}">${I.fileText}${esc(target.trim())}</a>`;
  }

  // ---------- Blocs ----------
  function render(text, ctx = {}) {
    ctx = { breaks: true, ...ctx, line0: ctx.line0 || 0 };
    let src = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
    let html = '';
    if (!ctx.nested && ctx.frontmatter !== false) {
      const fm = src.match(/^---\n([\s\S]*?)\n---(\n|$)/);
      if (fm) {
        const lines = fm[1].split('\n').filter(l => l.trim());
        ctx.line0 += fm[0].split('\n').length - 1;
        src = src.slice(fm[0].length);
        if (ctx.showFrontmatter !== false && lines.length) html += `<details class="md-props"><summary>${I.list}Propriétés <span>${lines.length}</span></summary><dl>${lines.map(l => { const m = l.match(/^([^:]+):\s*(.*)$/); return m ? `<dt>${esc(m[1].trim())}</dt><dd>${esc(m[2].trim())}</dd>` : `<dd class="full">${esc(l)}</dd>`; }).join('')}</dl></details>`;
      }
    }
    const lines = src.split('\n');
    let i = 0;
    const lineNo = k => ctx.line0 + k;
    const para = [];
    const flush = () => { if (para.length) { html += `<p>${inline(para.join('\n'), ctx)}</p>`; para.length = 0; } };
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { flush(); i++; continue; }
      let m;
      if ((m = line.match(/^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/))) {
        flush();
        const fence = m[1], lang = m[2].toLowerCase();
        const body = [];
        i++;
        while (i < lines.length && !lines[i].startsWith(fence)) body.push(lines[i++]);
        i++;
        if (lang === 'math' || lang === 'latex' && false) html += `<div class="md-math">${tex(body.join('\n'), true)}</div>`;
        else if (lang === 'dataview' || lang === 'dataviewjs') html += `<div class="md-dataview"><span>${I.table} Requête Dataview — affichée dans Obsidian</span><pre><code>${esc(body.join('\n'))}</code></pre></div>`;
        else html += `<pre class="md-code"${lang ? ` data-lang="${attr(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`;
        continue;
      }
      if (/^\s*\$\$/.test(line)) {
        flush();
        const one = line.trim().match(/^\$\$([\s\S]+)\$\$$/);
        if (one && one[1].trim()) { html += `<div class="md-math">${tex(one[1].trim(), true)}</div>`; i++; continue; }
        const body = [line.trim().slice(2)];
        i++;
        while (i < lines.length && !lines[i].includes('$$')) body.push(lines[i++]);
        if (i < lines.length) body.push(lines[i].slice(0, lines[i].indexOf('$$')));
        i++;
        html += `<div class="md-math">${tex(body.join('\n').trim(), true)}</div>`;
        continue;
      }
      if ((m = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flush();
        const level = m[1].length;
        html += `<h${level} id="${attr(slug(m[2]))}">${inline(m[2], ctx)}</h${level}>`;
        i++; continue;
      }
      if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html += '<hr>'; i++; continue; }
      if (/^\s*<!--/.test(line)) { flush(); while (i < lines.length && !lines[i].includes('-->')) i++; i++; continue; }
      if (/^ {0,3}>/.test(line)) {
        flush();
        const start = i;
        const body = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ''));
        const head = body[0].match(/^\[!([\w-]+)\]([+-]?)\s*(.*)$/);
        if (head) {
          const type = head[1].toLowerCase();
          const [label, color] = CALLOUTS[type] || [capFirst(type), '#64748b'];
          const title = head[3] ? inline(head[3], ctx) : esc(label);
          const inner = render(body.slice(1).join('\n'), { ...ctx, nested: true, line0: lineNo(start + 1) });
          const fold = head[2];
          html += fold
            ? `<details class="md-callout" style="--co:${color}" ${fold === '+' ? 'open' : ''}><summary class="co-title">${title}</summary><div class="co-body">${inner}</div></details>`
            : `<div class="md-callout" style="--co:${color}"><div class="co-title">${title}</div>${inner ? `<div class="co-body">${inner}</div>` : ''}</div>`;
        } else html += `<blockquote>${render(body.join('\n'), { ...ctx, nested: true, line0: lineNo(start) })}</blockquote>`;
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
        const head = cells(line);
        const aligns = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|?\s*$/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        html += `<div class="md-table"><table><thead><tr>${head.map((c, k) => `<th${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(c, { ...ctx, breaks: false })}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(r[k] || '', { ...ctx, breaks: false })}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        continue;
      }
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        const res = list(lines, i, ctx, lineNo);
        html += res.html; i = res.next;
        continue;
      }
      para.push(line.trim() === '' ? '' : line.replace(/^ {0,3}/, ''));
      i++;
    }
    flush();
    return html;
  }
  function list(lines, i, ctx, lineNo) {
    const indentOf = l => l.match(/^\s*/)[0].length;
    const base = indentOf(lines[i]);
    const ordered = /^\s*\d+[.)]/.test(lines[i]);
    const start = ordered ? parseInt(lines[i].trim(), 10) : 1;
    let html = ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>` : '<ul>';
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { if (i + 1 < lines.length && indentOf(lines[i + 1]) > base && lines[i + 1].trim()) { i++; continue; } break; }
      const ind = indentOf(l);
      const m = l.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
      if (!m || ind < base) break;
      if (ind > base) { const sub = list(lines, i, ctx, lineNo); html = html.replace(/<\/li>$/, '') + sub.html + '</li>'; i = sub.next; continue; }
      if (/^\d/.test(m[1]) !== ordered) break;
      let content = m[2];
      const task = content.match(/^\[([ xX\/-])\]\s*(.*)$/);
      const lineIndex = lineNo(i);
      i++;
      const extra = [];
      while (i < lines.length && lines[i].trim() && indentOf(lines[i]) > base && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) extra.push(lines[i++].trim());
      if (extra.length) content += '\n' + extra.join('\n');
      if (task) {
        const done = task[1] !== ' ';
        html += `<li class="task ${done ? 'done' : ''}"><label><input type="checkbox" data-line="${lineIndex}" ${done ? 'checked' : ''} ${ctx.tasks ? '' : 'disabled'}><span>${inline(task[2] + (extra.length ? '\n' + extra.join('\n') : ''), ctx)}</span></label></li>`;
      } else html += `<li>${inline(content, ctx)}</li>`;
    }
    html += ordered ? '</ol>' : '</ul>';
    return { html, next: i };
  }
  /** Texte d’une publication : Markdown léger, pas de propriétés, liens externes seulement. */
  const post = text => render(text, { frontmatter: false, nested: true, tasks: false });
  const plain = text => String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/\$\$[\s\S]*?\$\$/g, ' [formule] ').replace(/\$[^$\n]+\$/g, '[formule]').replace(/[*_~=`>#|]/g, '').replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
  return { render, inline, post, plain, slug };
})();

// ======================= Lecteur de fichiers texte et Markdown =======================
const TextViewer = {
  history: [],
  state: null,
  canUse: () => !!(typeof E !== 'undefined' && E.token && E.available),
  isText: f => /\.(md|markdown|txt|text|csv|tsv|json|py|js|mjs|ts|css|xml|yaml|yml|tex|bib|r|sql|sh|ini|log|swift|c|h|java|rb|go|rs|ipynb)$/i.test(f.name || f.path || ''),
  async open(path, { push = true, line, edit = false, onClose = null } = {}) {
    if (!TextViewer.canUse()) { if (window.call) call('open', { path }).catch(err => toast(err.message, 'error')); return; }
    let file;
    try { file = await E.api('GET', `/file?path=${encodeURIComponent(path)}`); }
    catch (err) {
      if (err.status === 415 || err.status === 413) { toast(err.message); if (window.call) call('open', { path }).catch(() => {}); return; }
      toast(err.message, 'error'); return;
    }
    const drive = file.text.match(/\[Ouvrir dans Google Drive\]\((https:\/\/docs\.google\.com\/[^)\s]+)\)/);
    if (/\.g(doc|sheet|slides)\.md$/i.test(file.name) && drive) { window.call ? call('openURL', { url: drive[1] }).catch(e => toast(e.message, 'error')) : window.open(drive[1], '_blank'); return; }
    if (TextViewer.state && push) TextViewer.history.push(TextViewer.state.file.path);
    if (!push && !TextViewer.state) TextViewer.history = [];
    const s = { file, editing: !!(edit && file.editable), dirty: false, text: file.text };
    if (onClose) TextViewer.onDone = onClose;
    TextViewer.state = s;
    if (!TextViewer.box || !document.body.contains(TextViewer.box)) {
      TextViewer.box = UI.modal('<div class="tv"></div>', { cls: 'viewer', label: 'Lecteur', beforeClose: TextViewer.confirmLeave, onClose: () => { TextViewer.state = null; TextViewer.box = null; TextViewer.history = []; const done = TextViewer.onDone; TextViewer.onDone = null; try { done?.(); } catch (e) { console.error(e); } } });
      TextViewer.bind(TextViewer.box);
    }
    TextViewer.render();
    if (line) setTimeout(() => TextViewer.box?.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' }), 50);
    if (s.editing) setTimeout(() => { const ta = TextViewer.box?.querySelector('.tv-editor'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 60);
  },
  kind(name) {
    if (/\.(md|markdown)$/i.test(name)) return 'md';
    if (/\.(csv|tsv)$/i.test(name)) return 'csv';
    if (/\.ipynb$/i.test(name)) return 'ipynb';
    return 'code';
  },
  body(s) {
    const kind = TextViewer.kind(s.file.name);
    if (s.editing) return `<textarea class="tv-editor" spellcheck="${kind === 'md' ? 'true' : 'false'}">${esc(s.text)}</textarea>`;
    if (kind === 'md') return `<article class="md-doc">${MD.render(s.text, { tasks: true })}</article>`;
    if (kind === 'csv') {
      const sep = /\.tsv$/i.test(s.file.name) ? '\t' : (s.text.split('\n')[0].split(';').length > s.text.split('\n')[0].split(',').length ? ';' : ',');
      const rows = parseCSV(s.text, sep).slice(0, 2000);
      return `<div class="md-table tv-csv"><table>${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table></div>${rows.length >= 2000 ? '<p class="muted">2 000 premières lignes affichées.</p>' : ''}`;
    }
    if (kind === 'ipynb') {
      try {
        const nb = JSON.parse(s.text);
        return `<article class="md-doc">${(nb.cells || []).map(c => { const src = Array.isArray(c.source) ? c.source.join('') : String(c.source || ''); return c.cell_type === 'markdown' ? MD.render(src, { frontmatter: false }) : `<pre class="md-code" data-lang="python"><code>${esc(src)}</code></pre>`; }).join('')}</article>`;
      } catch { /* affiché comme du code */ }
    }
    return `<pre class="tv-code">${esc(s.text).split('\n').map((l, i) => `<span class="ln" data-n="${i + 1}"></span>${l}`).join('\n')}</pre>`;
  },
  render() {
    const s = TextViewer.state, box = TextViewer.box;
    if (!s || !box) return;
    const inVault = !!s.file.vault;
    const crumbs = s.file.vault ? s.file.path.slice(s.file.vault.length + 1).split('/').slice(0, -1).join(' / ') : s.file.path.split('/').slice(-3, -1).join(' / ');
    box.querySelector('.tv').innerHTML = `
      <header class="tv-head">
        ${TextViewer.history.length ? `<button class="btn icon ghost" data-tv="back" title="Retour">${I.chevL}</button>` : ''}
        <div class="tv-title"><b>${esc(s.file.name.replace(/\.md$/i, ''))}${s.dirty ? ' <span class="dot-dirty" title="Modifications non enregistrées">●</span>' : ''}</b><span>${esc(crumbs)}</span></div>
        <div class="tv-actions">
          ${s.file.editable ? (s.editing ? `<button class="btn" data-tv="preview">${I.eye}Aperçu</button><button class="btn primary" data-tv="save" ${s.dirty ? '' : 'disabled'}>${I.check}Enregistrer</button>` : `<button class="btn" data-tv="edit">${I.edit}Modifier</button>`) : ''}
          <button class="btn icon" data-tv="more" title="Plus">${I.more}</button>
          <button class="btn icon ghost" data-tv="close" title="Fermer (Échap)">${I.close}</button>
        </div>
      </header>
      <div class="tv-body ${s.editing ? 'editing' : ''}">${TextViewer.body(s)}</div>`;
    TextViewer.hydrate();
    if (s.editing) { const ta = box.querySelector('.tv-editor'); ta.focus(); }
    box.dataset.vault = inVault ? '1' : '';
  },
  async hydrate() {
    const s = TextViewer.state, box = TextViewer.box;
    for (const img of box.querySelectorAll('img.pending-img')) {
      const name = img.dataset.wikiImg || img.dataset.relImg;
      try {
        const { path } = await E.api('GET', `/vault/resolve?name=${encodeURIComponent(name)}&from=${encodeURIComponent(s.file.path)}`);
        img.src = E.rawUrl(path); img.classList.remove('pending-img');
      } catch { img.replaceWith(Object.assign(document.createElement('span'), { className: 'md-missing', textContent: `Image introuvable : ${name}` })); }
    }
  },
  bind(box) {
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-tv]');
      const s = TextViewer.state;
      if (b) {
        const act = b.dataset.tv;
        if (act === 'close') return TextViewer.tryClose();
        if (act === 'back') { if (s.dirty && !await UI.confirm('Quitter sans enregistrer les modifications ?', { ok: 'Quitter', danger: true })) return; const prev = TextViewer.history.pop(); TextViewer.state = null; return TextViewer.open(prev, { push: false }); }
        if (act === 'edit') { s.editing = true; return TextViewer.render(); }
        if (act === 'preview') { s.editing = false; return TextViewer.render(); }
        if (act === 'save') return TextViewer.save();
        if (act === 'more') {
          const items = [];
          if (s.file.vault && window.call) items.push({ label: 'Ouvrir dans Obsidian', icon: 'obsidian', act: () => call('openObsidian', { path: s.file.path }) });
          if (window.call) items.push({ label: 'Ouvrir avec l’app par défaut', icon: 'external', act: () => call('open', { path: s.file.path }) }, { label: 'Afficher dans le Finder', icon: 'folder', act: () => call('reveal', { path: s.file.path }) });
          items.push({ label: 'Copier le texte', icon: 'copy', act: () => copyText(s.text) });
          return UI.menu(b, items, { align: 'right' });
        }
      }
      const wl = e.target.closest('a.wikilink');
      if (wl) {
        e.preventDefault();
        const name = wl.dataset.wiki || wl.dataset.rel;
        try { const { path } = await E.api('GET', `/vault/resolve?name=${encodeURIComponent(name)}&from=${encodeURIComponent(s.file.path)}`); TextViewer.followLink(path); }
        catch (err) { toast(err.message, 'error'); }
        return;
      }
      const anchor = e.target.closest('a[data-anchor]');
      if (anchor) { e.preventDefault(); box.querySelector(`#${CSS.escape(anchor.dataset.anchor)}`)?.scrollIntoView({ behavior: 'smooth' }); return; }
      const ext = e.target.closest('a.ext');
      if (ext && window.call) { e.preventDefault(); call('openURL', { url: ext.href }).catch(err => toast(err.message, 'error')); }
    });
    box.addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox][data-line]');
      if (!cb) return;
      const s = TextViewer.state;
      const lines = s.text.split('\n');
      const n = +cb.dataset.line;
      if (lines[n] === undefined || !/\[[ xX\/-]\]/.test(lines[n])) { toast('Case introuvable dans le fichier.', 'error'); return; }
      lines[n] = lines[n].replace(/\[[ xX\/-]\]/, cb.checked ? '[x]' : '[ ]');
      s.text = lines.join('\n');
      cb.closest('li')?.classList.toggle('done', cb.checked);
      TextViewer.save(true);
    });
    box.addEventListener('input', e => {
      if (!e.target.classList.contains('tv-editor')) return;
      const s = TextViewer.state;
      s.text = e.target.value;
      if (!s.dirty) { s.dirty = true; box.querySelector('[data-tv="save"]')?.removeAttribute('disabled'); const t = box.querySelector('.tv-title b'); if (t && !t.querySelector('.dot-dirty')) t.insertAdjacentHTML('beforeend', ' <span class="dot-dirty">●</span>'); }
      // Enregistrement automatique pendant la frappe (comme Obsidian) : on écrit, c’est gardé.
      clearTimeout(TextViewer.autoTimer);
      TextViewer.autoTimer = setTimeout(async () => {
        if (TextViewer.state !== s || !s.dirty) return;
        await TextViewer.save(true);
        if (!s.dirty) { box.querySelector('.dot-dirty')?.remove(); box.querySelector('[data-tv="save"]')?.setAttribute('disabled', ''); }
      }, 1500);
    });
    box.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (TextViewer.state?.dirty) TextViewer.save(); }
      if (e.key === 'Tab' && e.target.classList.contains('tv-editor')) { e.preventDefault(); document.execCommand('insertText', false, '    '); }
    });
  },
  async followLink(path) {
    const s = TextViewer.state;
    if (s.dirty && !await UI.confirm('Quitter sans enregistrer les modifications ?', { ok: 'Quitter', danger: true })) return;
    if (TextViewer.isText({ path })) return TextViewer.open(path);
    if (window.call) call('open', { path }).catch(err => toast(err.message, 'error'));
    else window.open(E.rawUrl(path), '_blank');
  },
  async save(quiet = false, force = false) {
    const s = TextViewer.state;
    try {
      const sent = s.text;
      const r = await E.api('PUT', '/file', { path: s.file.path, text: sent, mtime: s.file.mtime, force });
      s.file.mtime = r.mtime; s.file.text = sent; s.dirty = s.text !== sent;
      if (!quiet) { toast('Fichier enregistré'); TextViewer.render(); }
    } catch (err) {
      if (err.status === 409) {
        const overwrite = await UI.confirm('Ce fichier a été modifié ailleurs (dans Obsidian par exemple) depuis que vous l’avez ouvert. Écraser cette autre version avec la vôtre ?', { title: 'Conflit', ok: 'Écraser', cancel: 'Garder l’autre version', danger: true });
        if (overwrite) return TextViewer.save(quiet, true);
        const path = s.file.path; TextViewer.state = null; TextViewer.history = []; return TextViewer.open(path, { push: false });
      }
      toast(err.message, 'error');
    }
  },
  async confirmLeave() {
    const s = TextViewer.state;
    return !s?.dirty || UI.confirm('Fermer sans enregistrer les modifications ?', { ok: 'Fermer', danger: true });
  },
  async tryClose() {
    if (await TextViewer.confirmLeave() && TextViewer.box) UI.close(TextViewer.box);
  },
};
function parseCSV(text, sep = ',') {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

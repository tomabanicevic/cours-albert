// Lecture d’Inside Albert avec la session Chrome de l’étudiant.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { withRetry, fmtErr, humanError, BrowserClosedError, isBrowserClosed, sha, safeName, exists, sleep } from './util.mjs';
import { scheduleItem, examRow, attendanceRow, attendanceSession, newsItem, parseDateTime, parisToISO, COURSE_CODE } from './parse.mjs';

const DAY = 86400_000;
const WINDOW_DAYS = 30;

// ---------- Fonctions exécutées dans la page (autonomes) ----------
export const PAGE = {
  tables: () => {
    const leaves = el => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const s = n.textContent.replace(/\s+/g, ' ').trim(); if (s) out.push(s); } return out; };
    return [...document.querySelectorAll('main table')].map(table => {
      const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.replace(/\s+/g, ' ').trim());
      const rows = [...table.querySelectorAll('tbody tr')].map(tr => {
        const cells = {};
        [...tr.cells].forEach((td, i) => { cells[td.dataset.label || headers[i] || `col${i}`] = leaves(td); });
        const link = tr.querySelector('a[href]');
        if (link) cells.href = link.getAttribute('href');
        return cells;
      });
      return { headers, rows };
    });
  },
  schedule: () => {
    const leaves = el => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const s = n.textContent.replace(/\s+/g, ' ').trim(); if (s) out.push(s); } return out; };
    const main = document.querySelector('main');
    if (!main) return { rendered: false, items: [] };
    const label = [...main.querySelectorAll('p, h2, h3, span')].find(e => !e.children.length && /\d{4}\s*[–—-]\s*\d/.test(e.textContent))?.textContent.trim() || '';
    let nodes = [...main.querySelectorAll('li')].filter(li => li.querySelectorAll('time[datetime]').length === 1);
    if (!nodes.length) nodes = [...main.querySelectorAll('a[href]')].filter(a => a.querySelectorAll('time[datetime]').length === 1);
    const items = nodes.map(el => {
      const t = el.querySelector('time[datetime]');
      const a = el.matches('a[href]') ? el : el.querySelector('a[href]');
      const title = el.querySelector('.truncate.font-medium, [data-slot="card-title"]')?.textContent.trim() || '';
      return {
        start: t.getAttribute('datetime'), range: t.textContent.trim(),
        href: a?.getAttribute('href') || '', label: a?.getAttribute('aria-label') || '',
        title, code: el.querySelector('.text-code')?.textContent.trim() || '',
        badge: el.querySelector('[data-slot="badge"]')?.textContent.trim() || '', leaves: leaves(el),
      };
    });
    return { rendered: !!label || items.length > 0, label, items };
  },
  home: () => {
    const main = document.querySelector('main');
    const text = main?.innerText || '';
    const name = text.match(/Good (?:morning|afternoon|evening|night),\s*([^\n]+)/i)?.[1]?.trim() || '';
    const news = [];
    for (const a of main?.querySelectorAll('a[href*="/courses/"]') || []) {
      const href = a.getAttribute('href') || '';
      if (!/\/content$|#announcements$/.test(href)) continue;
      const spans = [...a.querySelectorAll('span.block')];
      if (spans.length < 2) continue;
      news.push({ title: spans[0].textContent.trim(), meta: spans[1].textContent.trim(), href });
    }
    for (const art of main?.querySelectorAll('article') || []) {
      const h = art.querySelector('h3, h2');
      const t = art.querySelector('time[datetime]');
      if (h) news.push({ title: h.textContent.trim(), meta: (t?.parentElement?.textContent || '').replace(/\s+/g, ' ').trim(), datetime: t?.getAttribute('datetime') || '', href: '' });
    }
    return { name, news };
  },
  attendanceStats: () => {
    const text = document.querySelector('main')?.innerText || '';
    const num = re => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
    return { rate: num(/RATE\s*\n?\s*([\d.,]+)\s*%/i), present: num(/PRESENT\s*\n?\s*(\d+)/i), absent: num(/ABSENT\s*\n?\s*(\d+)/i), pending: num(/PENDING\s*\n?\s*(\d+)/i) };
  },
};

// ---------- Navigation ----------
async function goto(page, url, readySelector, timeout = 15000) {
  await withRetry(async () => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('main').first().waitFor({ timeout: 20000 });
  });
  if (readySelector) await page.locator(readySelector).first().waitFor({ timeout }).catch(() => {});
  await sleep(250);
}
const loggedIn = async page => (await page.locator('[aria-label*="Account menu"]').count()) > 0;

function scheduleWindows({ full, academicYearStart, now = Date.now() }) {
  const windows = [];
  if (full) {
    let from = Date.parse(parisToISO(academicYearStart, 7, 25));
    const end = Date.parse(parisToISO(academicYearStart + 1, 7, 20));
    for (; from < end; from += WINDOW_DAYS * DAY) windows.push(from);
  } else {
    const start = now - 7 * DAY;
    windows.push(start, start + WINDOW_DAYS * DAY);
  }
  return windows.map(ms => new Date(ms).toISOString().slice(0, 10));
}
function windowRange(dateText, label) {
  const [a, b] = String(label || '').split(/\s[–—-]\s/);
  const from = parseDateTime(a), to = parseDateTime(b);
  if (from && to) return [Date.parse(from), Date.parse(to) + DAY];
  const [y, m, d] = dateText.split('-').map(Number);
  const start = Date.parse(parisToISO(y, m - 1, d));
  return [start, start + WINDOW_DAYS * DAY];
}

// ---------- Étapes ----------
async function readHome(page, ctx) {
  await goto(page, `${ctx.base}/`, 'main h2');
  const home = await page.evaluate(PAGE.home);
  if (home.name) ctx.state.student = { ...(ctx.state.student || {}), firstName: home.name };
  const now = new Date().toISOString();
  const items = home.news.map(n => newsItem({ ...n, now, href: n.href ? new URL(n.href, ctx.base).pathname + (n.href.includes('#') ? '#' + n.href.split('#')[1] : '') : '' })).filter(Boolean);
  if (items.length) ctx.state.news = items.slice(0, 40);
  ctx.state.newsChecked = now;
  return items;
}

async function readSchedule(page, ctx) {
  const store = ctx.state.schedule ||= {};
  const windows = scheduleWindows({ full: ctx.full, academicYearStart: ctx.config.academicYearStart || new Date().getFullYear() });
  let done = 0;
  for (const date of windows) {
    ctx.progress({ phase: 'inside', label: 'Emploi du temps', current: ++done, total: windows.length });
    try {
      await goto(page, `${ctx.base}/schedule?view=list&date=${date}`, 'main time[datetime]', 8000);
      if (!page.url().includes('/schedule')) throw new Error('La connexion Inside a expiré pendant la lecture du planning.');
      const result = await page.evaluate(PAGE.schedule);
      if (!result.rendered) { ctx.report.warnings.push(`Planning à partir du ${date} : page vide, planning précédent conservé.`); continue; }
      const [from, to] = windowRange(date, result.label);
      for (const [id, item] of Object.entries(store)) { const t = Date.parse(item.start); if (t >= from && t < to) delete store[id]; }
      for (const raw of result.items) {
        if (!raw.title && raw.label) raw.title = raw.label.replace(/\s+—\s+open.*$/i, '');
        const item = scheduleItem(raw);
        if (!item) continue;
        store[item.id] = item;
        if (item.courseId) ctx.state.courses[item.courseId] ??= { url: `${ctx.base}/courses/${item.courseId}` };
        if (item.courseId && item.teacher) ctx.state.courses[item.courseId].teacher = item.teacher;
      }
      const cover = ctx.state.scheduleCoverage ||= {};
      cover.from = cover.from ? Math.min(Date.parse(cover.from), from) : from;
      cover.to = cover.to ? Math.max(Date.parse(cover.to), to) : to;
      cover.from = new Date(cover.from).toISOString(); cover.to = new Date(cover.to).toISOString();
    } catch (error) {
      if (isBrowserClosed(error)) throw error;
      ctx.report.errors.push(`Planning du ${date} : ${humanError(fmtErr(error))}`);
    }
  }
  ctx.state.scheduleChecked = new Date().toISOString();
}

async function readExams(page, ctx) {
  ctx.progress({ phase: 'inside', label: 'Examens', current: 1, total: 1 });
  await goto(page, `${ctx.base}/me/grades`, 'main table tbody tr');
  const tables = await page.evaluate(PAGE.tables);
  const table = tables.find(t => t.headers.some(h => /^exam$/i.test(h)) && t.headers.some(h => /^date$/i.test(h)));
  if (!table) {
    const text = await page.locator('main').innerText().catch(() => '');
    if (/no (upcoming )?exams?/i.test(text)) { ctx.state.exams = []; ctx.state.examsChecked = new Date().toISOString(); }
    else ctx.report.warnings.push('Examens : tableau introuvable, liste précédente conservée.');
    return;
  }
  const exams = table.rows.map(examRow).filter(Boolean);
  ctx.state.exams = exams;
  ctx.state.examsChecked = new Date().toISOString();

  await goto(page, `${ctx.base}/me/grades?tab=grades`, 'main table tbody tr, main h2, main h3', 6000).catch(() => {});
  const gradeTables = await page.evaluate(PAGE.tables).catch(() => []);
  const grades = gradeTables.find(t => t.rows.length);
  ctx.state.grades = grades ? { headers: grades.headers, rows: grades.rows, checked: new Date().toISOString() } : { headers: [], rows: [], checked: new Date().toISOString() };
}

async function readAttendance(page, ctx) {
  ctx.progress({ phase: 'inside', label: 'Présence', current: 0, total: 1 });
  await goto(page, `${ctx.base}/me/attendance`, 'main table tbody tr');
  const tables = await page.evaluate(PAGE.tables);
  const previous = ctx.state.attendance || {};
  const summary = [];
  const other = [];
  for (const table of tables) {
    if (table.headers.some(h => /^course$/i.test(h))) {
      for (const cells of table.rows) {
        const row = attendanceRow(cells);
        if (!row) continue;
        row.courseId = String(cells.href || '').match(/\/courses\/([0-9a-f-]{36})/i)?.[1] || null;
        summary.push(row);
      }
    } else if (table.headers.some(h => /^when$/i.test(h))) {
      for (const cells of table.rows) {
        const session = attendanceSession((cells.When || []).join(' '), (cells.Status || [])[0]);
        if (session) other.push(session);
      }
    }
  }
  if (!summary.length && !tables.length) { ctx.report.warnings.push('Présence : page vide, données précédentes conservées.'); return; }
  const sessions = { ...(previous.sessions || {}) };
  const due = summary.filter(row => row.courseId && (ctx.full || !sessions[row.courseId] || previous.summary?.find(p => p.courseId === row.courseId)?.total !== row.total || previous.summary?.find(p => p.courseId === row.courseId)?.attended !== row.attended));
  let i = 0;
  for (const row of due) {
    ctx.progress({ phase: 'inside', label: `Présence ${row.code}`, current: ++i, total: due.length });
    try {
      await goto(page, `${ctx.base}/courses/${row.courseId}/attendance`, 'main table tbody tr');
      const courseTables = await page.evaluate(PAGE.tables);
      const list = courseTables.find(t => t.headers.some(h => /^when$/i.test(h)));
      if (list) sessions[row.courseId] = list.rows.map(c => attendanceSession((c.When || []).join(' '), (c.Status || [])[0])).filter(Boolean);
      const stats = await page.evaluate(PAGE.attendanceStats);
      if (stats.pending != null) row.pending = stats.pending;
    } catch (error) {
      if (isBrowserClosed(error)) throw error;
      ctx.report.errors.push(`Présence ${row.code} : ${humanError(fmtErr(error))}`);
    }
  }
  for (const row of summary) {
    if (row.courseId) ctx.state.courses[row.courseId] ??= { url: `${ctx.base}/courses/${row.courseId}` };
    if (row.pending == null) row.pending = previous.summary?.find(p => p.courseId === row.courseId)?.pending ?? 0;
  }
  ctx.state.attendance = { summary, sessions, other, checked: new Date().toISOString() };
}

async function importCourse(page, ctx, id, course, { documents }) {
  await goto(page, course.url, 'h1');
  const title = (await page.locator('h1').first().innerText({ timeout: 20000 })).trim();
  const code = title.match(/^(MAT|DAT|BUS|HUM)\d{2}-\d+/)?.[0] || course.code || id;
  const summary = (await page.locator('body').innerText()).slice(0, 600);
  const semester = /SEMESTER\s*2/i.test(summary) ? 'S2' : 'S1';
  Object.assign(course, { code, title, semester });
  const dest = path.join(ctx.sourceRoot, 'Inside Albert', semester, safeName(title));
  await fs.mkdir(dest, { recursive: true });
  if (documents) {
    try {
      const overview = await page.locator('main').innerText({ timeout: 10000 });
      const cleaned = overview.split(/Teaching\s+team|Class\s+directory/i)[0].replace(/\n{3,}/g, '\n\n').trim();
      if (cleaned.length > title.length + 30) await ctx.putBuffer(`inside:${id}:overview.md`, path.join(dest, 'overview.md'), Buffer.from(`# ${title}\n\n${cleaned}\n\n[Voir ce cours sur Inside Albert](${course.url})\n`), 'inside');
    } catch (e) { ctx.report.errors.push(`${code} Overview : ${humanError(fmtErr(e))}`); }
    for (const kind of ['syllabus', 'textbook']) {
      for (const ext of ['md', 'pdf']) {
        try {
          const response = await withRetry(() => ctx.context.request.get(`${course.url}/${kind}.${ext}`, { timeout: 30000 }));
          if (!response.ok()) continue;
          const type = response.headers()['content-type'] || '';
          if (type.includes('text/html') || (ext === 'pdf' && !type.includes('pdf') && !type.includes('octet-stream'))) continue;
          const bytes = await response.body();
          if (ext === 'pdf' && bytes.subarray(0, 4).toString() !== '%PDF') continue;
          if (ext === 'md' && bytes.subarray(0, 100).toString().toLowerCase().includes('<!doctype html')) continue;
          await ctx.putBuffer(`inside:${id}:${kind}.${ext}`, path.join(dest, `${kind}.${ext}`), bytes, 'inside');
        } catch (e) { if (isBrowserClosed(e)) throw e; ctx.report.errors.push(`${code} ${kind}.${ext} : ${humanError(fmtErr(e))}`); }
      }
    }
  }
  await goto(page, `${course.url}/content`, 'button[aria-label^="Download "]', 4000);
  const cards = await page.locator('button[aria-label^="Download "]').evaluateAll(buttons => buttons.map(b => ({ name: b.getAttribute('aria-label').replace(/^Download /, ''), details: b.parentElement?.parentElement?.innerText || '' })));
  const counts = new Map();
  for (const [index, card] of cards.entries()) {
    const n = (counts.get(card.name) || 0) + 1; counts.set(card.name, n);
    const filename = n === 1 ? safeName(card.name) : `${n} — ${safeName(card.name)}`;
    const key = `inside:${id}:material:${filename}`;
    const signature = sha(Buffer.from(`${card.name}\n${card.details.match(/Uploaded[^\n]*/)?.[0] || ''}`));
    const known = ctx.state.files[key];
    if (known && await exists(known.path)) {
      if (!known.signatureScheme) { Object.assign(known, { signature, signatureScheme: 'uploaded-v1' }); ctx.report.unchanged++; continue; }
      if (known.signature === signature) { ctx.report.unchanged++; continue; }
    }
    try {
      await withRetry(async () => {
        const button = page.locator('button[aria-label^="Preview "]').filter({ visible: true }).nth(index);
        let resolveUrl;
        const signedUrl = new Promise(resolve => { resolveUrl = resolve; });
        const pattern = /https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/coursework\//;
        const handler = async route => { const url = route.request().url(); if (url.includes(`/coursework/${id}/`)) resolveUrl(url); await route.abort().catch(() => {}); };
        await ctx.context.route(pattern, handler);
        let url;
        try {
          const popup = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
          await button.click();
          url = await Promise.race([signedUrl, sleep(15000).then(() => { throw new Error('Lien du fichier non obtenu (timed out)'); })]);
          (await popup)?.close().catch(() => {});
        } finally { await ctx.context.unroute(pattern, handler).catch(() => {}); }
        const signed = new URL(url);
        if (signed.protocol !== 'https:' || !signed.hostname.endsWith('.r2.cloudflarestorage.com')) throw new Error('Adresse de téléchargement inattendue');
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw new Error(`Téléchargement impossible (${response.status})`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const mime = response.headers.get('content-type')?.split(';')[0] || '';
        const extension = ({ 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'text/plain': '.txt', 'application/zip': '.zip', 'text/csv': '.csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/x-ipynb+json': '.ipynb' })[mime] || '';
        const complete = path.extname(filename) ? filename : filename + extension;
        await ctx.putBuffer(key, path.join(dest, 'Materials', complete), bytes, 'inside');
        Object.assign(ctx.state.files[key], { signature, signatureScheme: 'uploaded-v1' });
        if (!page.url().endsWith('/content')) await goto(page, `${course.url}/content`, 'button[aria-label^="Download "]', 4000);
      });
    } catch (e) {
      if (isBrowserClosed(e)) throw e;
      ctx.report.errors.push(`${code} · support « ${filename} » : ${humanError(fmtErr(e))}`);
    }
  }
  course.materials = cards.length;
  (ctx.state.courseChecked ||= {})[id] = new Date().toISOString();
}

/** Passage complet sur Inside. Retourne false si la session doit être rouverte. */
export async function runInside(ctx) {
  const { config, report, interactive } = ctx;
  ctx.base = config.insideBase || 'https://inside.albertschool.com';
  await fs.mkdir(config.chromeProfile, { recursive: true });
  ctx.progress({ phase: 'inside', label: 'Ouverture de Chrome', current: 0, total: 1 });
  const launch = headless => chromium.launchPersistentContext(config.chromeProfile, {
    channel: 'chrome', headless, chromiumSandbox: true, acceptDownloads: true,
    locale: 'en-US', timezoneId: 'Europe/Paris', args: ['--no-first-run', '--no-default-browser-check'],
  });
  // Chrome reste invisible ; il ne s’affiche que si une connexion est nécessaire.
  let context = await launch(true);
  ctx.context = context;
  try {
    let page = context.pages()[0] || await context.newPage();
    await goto(page, `${ctx.base}/`, '[aria-label*="Account menu"]', 15000);
    if (!await loggedIn(page)) {
      if (!interactive) { report.insideConnected = false; report.errors.push('Inside Albert : session expirée. Ouvrez Cours Albert et cliquez sur « Se reconnecter ».'); return false; }
      await context.close().catch(() => {});
      ctx.progress({ phase: 'login', label: 'Connectez-vous à Inside dans Chrome', current: 0, total: 1 });
      context = ctx.context = await launch(false);
      page = context.pages()[0] || await context.newPage();
      await goto(page, `${ctx.base}/`, '[aria-label*="Account menu"]', 5000);
      await page.bringToFront().catch(() => {});
      await page.waitForFunction(() => !!document.querySelector('[aria-label*="Account menu"]'), null, { timeout: 600000 }).catch(() => {});
      const ok = await loggedIn(page).catch(() => false);
      await context.close().catch(() => {});
      if (!ok) { report.insideConnected = false; report.errors.push('Inside Albert : connexion non terminée.'); return false; }
      context = ctx.context = await launch(true);
      page = context.pages()[0] || await context.newPage();
      await goto(page, `${ctx.base}/`, '[aria-label*="Account menu"]', 15000);
    }
    report.insideConnected = true;
    const since = Date.parse(ctx.state.newsChecked || 0);
    const steps = [
      ['Accueil et nouveautés', () => readHome(page, ctx)],
      ['Emploi du temps', () => readSchedule(page, ctx)],
      ['Examens', () => readExams(page, ctx)],
      ['Présence', () => readAttendance(page, ctx)],
    ];
    for (const [label, step] of steps) {
      try { await step(); }
      catch (error) { if (isBrowserClosed(error)) throw error; report.errors.push(`${label} : ${humanError(fmtErr(error))}`); }
    }
    // Cours à vérifier : tous chaque jour, sinon ceux qui ont de nouveaux supports.
    const fresh = new Set((ctx.state.news || []).filter(n => n.kind === 'material' && n.courseId && Date.parse(n.date || 0) >= since - 3600_000).map(n => n.courseId));
    const daily = ctx.full || !ctx.state.lastDaily || Date.now() - Date.parse(ctx.state.lastDaily) > 20 * 3600_000;
    const entries = Object.entries(ctx.state.courses).filter(([id, course]) => daily || fresh.has(id) || !course.title || !ctx.state.courseChecked?.[id] || Date.now() - Date.parse(ctx.state.courseChecked[id]) > 6 * 3600_000);
    let i = 0;
    for (const [id, course] of entries) {
      ctx.progress({ phase: 'inside', label: `Supports ${course.code || ''}`.trim(), current: ++i, total: entries.length });
      try { await withRetry(() => importCourse(page, ctx, id, course, { documents: daily || !course.title }), { tries: 2 }); }
      catch (error) { if (isBrowserClosed(error)) throw error; report.errors.push(`Cours ${course.code || id} : ${humanError(fmtErr(error))}`); }
    }
    if (daily) ctx.state.lastDaily = new Date().toISOString();
    return true;
  } catch (error) {
    if (isBrowserClosed(error)) { report.errors.push('Chrome s’est fermé pendant la vérification d’Inside. Les étapes restantes seront refaites au prochain passage.'); return true; }
    throw error;
  } finally {
    await ctx.context.close().catch(() => {});
  }
}

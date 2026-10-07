/* Cours Albert 3 — outils communs à l’app et à la page des invités : échappement, icônes, fenêtres, menus, messages. */
'use strict';

// ======================= Outils =======================
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const attr = esc;
const $ = sel => document.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const normalize = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function sizeLabel(bytes) { if (!bytes && bytes !== 0) return ''; if (bytes < 1024) return `${bytes} o`; if (bytes < 1048576) return `${Math.round(bytes / 1024)} Ko`; return `${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo`; }
const plural = (n, one, many) => `${n} ${n > 1 ? (many || one + 's') : one}`;
const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
function debounce(fn, ms) { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; d.cancel = () => clearTimeout(t); return d; }
function throttle(fn, ms) { let last = 0, timer = null, args = null; return (...a) => { args = a; const now = Date.now(); if (now - last >= ms) { last = now; fn(...args); } else if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(...args); }, ms - (now - last)); }; }
const randomId = (n = 12) => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = crypto.getRandomValues(new Uint8Array(n)); let s = ''; for (const x of b) s += a[x % a.length]; return s; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function localDate(iso, opts) { try { return new Intl.DateTimeFormat('fr-FR', opts).format(new Date(iso)); } catch { return ''; } }
function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(iso), diff = Date.now() - t, min = Math.round(diff / 60000);
  if (!Number.isFinite(t)) return '';
  if (diff < 0) { const d = Math.round(-diff / 86400000); return d >= 1 ? `dans ${plural(d, 'jour')}` : `à ${localDate(iso, { hour: '2-digit', minute: '2-digit' })}`; }
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24 && new Date(t).toDateString() === new Date().toDateString()) return `il y a ${h} h`;
  const y = new Date(Date.now() - 86400000);
  if (new Date(t).toDateString() === y.toDateString()) return `hier ${localDate(iso, { hour: '2-digit', minute: '2-digit' })}`;
  return localDate(iso, { day: 'numeric', month: 'short', ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
const AVATAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];
function colorFor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_COLORS[h % AVATAR_COLORS.length]; }
const avatar = (name, id, size = 22) => `<span class="avatar" style="--av:${colorFor(id || name)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px" title="${attr(name)}">${esc(initials(name))}</span>`;

// ======================= Icônes =======================
const I = (() => {
  const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const f = d => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${d}</svg>`;
  return {
    today: s('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    calendar: s('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>'),
    exam: s('<path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1Z"/><path d="M16 5h1.5A2.5 2.5 0 0 1 20 7.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-11A2.5 2.5 0 0 1 6.5 5H8"/><path d="m8.5 13.5 2.3 2.3 4.7-4.8"/>'),
    attendance: s('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="m16 11 2 2 4-4"/>'),
    courses: s('<path d="M4 19.5V5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h13v-4"/><path d="M8 7h7"/>'),
    sync: s('<path d="M20 11a8 8 0 0 0-14.7-4.3L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4.3L21 15"/><path d="M21 20v-5h-5"/>'),
    settings: s('<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    folder: s('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>'),
    folderOpen: s('<path d="M3 17.5V7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h6.5A2.5 2.5 0 0 1 20 10v.5"/><path d="M3.3 18.6 5.6 12a2 2 0 0 1 1.9-1.4H21a1 1 0 0 1 .9 1.3l-2.2 6.4a2 2 0 0 1-1.9 1.4H5.2a2 2 0 0 1-1.9-1.1Z"/>'),
    folderPlus: s('<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/><path d="M12 11v5M9.5 13.5h5"/>'),
    external: s('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
    clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    pin: s('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>'),
    user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    users: s('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>'),
    alert: s('<path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4.5M12 17h.01"/>'),
    info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>'),
    check: s('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    chevL: s('<path d="m15 18-6-6 6-6"/>'),
    chevR: s('<path d="m9 18 6-6-6-6"/>'),
    chevD: s('<path d="m6 9 6 6 6-6"/>'),
    chevU: s('<path d="m18 15-6-6-6 6"/>'),
    close: s('<path d="M18 6 6 18M6 6l12 12"/>'),
    download: s('<path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>'),
    upload: s('<path d="M12 16V4m0 0 4.5 4.5M12 4 7.5 8.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>'),
    file: s('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Z"/><path d="M14 3v5h5"/>'),
    fileText: s('<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Z"/><path d="M14 3v5h5M8.5 12.5h7M8.5 16h5"/>'),
    spark: s('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
    sparkles: s('<path d="M10 3.5 11.6 8a2 2 0 0 0 1.2 1.2L17.5 11l-4.7 1.7a2 2 0 0 0-1.2 1.2L10 18.5 8.4 14a2 2 0 0 0-1.2-1.2L2.5 11l4.7-1.7A2 2 0 0 0 8.4 8Z"/><path d="M18.5 3v4M16.5 5h4M19 16v3M17.5 17.5h3"/>'),
    drive: s('<path d="M8.5 3.5h7l6 10.5-3.5 6h-12L2.5 14Z"/><path d="m8.5 3.5 6 10.5M15.5 3.5 9.5 14M2.5 14h19"/>'),
    desktop: s('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
    globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
    obsidian: s('<path d="m12 2.5 6.5 5-2 11.5-4.5 2.5-4.5-2.5-2-11.5Z"/><path d="M12 2.5 9.5 12l2.5 8.5M18.5 7.5 9.5 12"/>'),
    book: s('<path d="M12 6.5C10.5 5 8 4.5 4 4.5v14c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-14c-4 0-6.5.5-8 2Z"/><path d="M12 6.5v14"/>'),
    bell: s('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    logout: s('<path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M10 16.5 14.5 12 10 7.5M14.5 12H4"/>'),
    home: s('<path d="m3 11 9-7.5 9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    minus: s('<path d="M5 12h14"/>'),
    more: s('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
    grip: s('<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>'),
    wall: s('<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/>'),
    columns: s('<rect x="3.5" y="3.5" width="4.5" height="17" rx="1.2"/><rect x="9.75" y="3.5" width="4.5" height="12" rx="1.2"/><rect x="16" y="3.5" width="4.5" height="14" rx="1.2"/>'),
    grid: s('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
    table: s('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11"/>'),
    stream: s('<rect x="5" y="3.5" width="14" height="7" rx="1.5"/><rect x="5" y="13.5" width="14" height="7" rx="1.5"/>'),
    timeline: s('<path d="M3 12h18"/><circle cx="6.5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="17.5" cy="12" r="2"/><path d="M6.5 10V5M12 14v5M17.5 10V5"/>'),
    map: s('<path d="m9 4.5-5 2v13l5-2 6 2 5-2v-13l-5 2Z"/><path d="M9 4.5v13M15 6.5v13"/>'),
    canvas: s('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 15.5c2-4 4-6 5.5-4.5S12 15 15 13s2-3.5 2-3.5"/><circle cx="8" cy="8" r="1.3"/>'),
    free: s('<rect x="3" y="4" width="7" height="6" rx="1.3"/><rect x="14" y="3" width="7" height="6" rx="1.3"/><rect x="9" y="14" width="7" height="6" rx="1.3"/><path d="M10 7h4M17.5 9v3.5a1.5 1.5 0 0 1-1.5 1.5h-1M6.5 10v5.5a1.5 1.5 0 0 0 1.5 1.5H9"/>'),
    share: s('<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>'),
    qr: s('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM18 14h2.5M14 18v2.5"/>'),
    play: s('<path d="M7 4.5v15l12-7.5Z"/>'),
    present: s('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8.5 20h7M10 8l4 2-4 2Z"/>'),
    star: s('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>'),
    starFill: f('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"/>'),
    heart: s('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/>'),
    heartFill: f('<path d="M12 20.5s-8-4.9-8-10.7a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 10.7-8 10.7Z"/>'),
    up: s('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
    down: s('<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>'),
    comment: s('<path d="M20 15a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/>'),
    image: s('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 15.5-5-5L6 20"/>'),
    camera: s('<path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.6"/>'),
    video: s('<rect x="2.5" y="6" width="13.5" height="12" rx="2"/><path d="m16 10.5 5.5-3.5v10L16 13.5"/>'),
    mic: s('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
    screen: s('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10.5" r="2.5" fill="currentColor" stroke="none"/>'),
    pen: s('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m13.5 6.5 4 4"/>'),
    marker: s('<path d="m9 15 6.5-6.5a2.1 2.1 0 0 1 3 3L12 18l-4 1Z"/><path d="M4 21h7"/><path d="m14 10 3 3"/>'),
    eraser: s('<path d="m7 21-3.5-3.5a1.5 1.5 0 0 1 0-2.1L13.4 5.5a1.5 1.5 0 0 1 2.1 0l4 4a1.5 1.5 0 0 1 0 2.1L10 21Z"/><path d="M21 21H7M9.5 9.5l5 5"/>'),
    link: s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
    poll: s('<path d="M4 20h16"/><rect x="5" y="11" width="3.5" height="6" rx="1"/><rect x="10.25" y="5" width="3.5" height="12" rx="1"/><rect x="15.5" y="8.5" width="3.5" height="8.5" rx="1"/>'),
    text: s('<path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6"/>'),
    sticky: s('<path d="M4.5 4.5h15v9l-6 6h-9Z"/><path d="M13.5 19.5v-6h6"/>'),
    shapes: s('<rect x="3.5" y="12.5" width="8" height="8" rx="1.5"/><circle cx="16.5" cy="7.5" r="4"/><path d="m12.5 4-4.5 7.5h9"/>'),
    rect: s('<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>'),
    ellipse: s('<ellipse cx="12" cy="12" rx="9" ry="7"/>'),
    triangle: s('<path d="M12 4 21 20H3Z"/>'),
    diamond: s('<path d="m12 3 9 9-9 9-9-9Z"/>'),
    hexagon: s('<path d="m7.5 4h9l4.5 8-4.5 8h-9L3 12Z"/>'),
    line: s('<path d="M4 20 20 4"/>'),
    arrow: s('<path d="M4 20 19 5M10 5h9v9"/>'),
    cursor: s('<path d="m5 3 14 7-6 2-2 6Z"/>'),
    hand: s('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.7a6 6 0 0 1-4.9-2.6L3 15.6a1.6 1.6 0 0 1 2.6-1.9L8 16.5"/>'),
    smile: s('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>'),
    frame: s('<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/>'),
    undo: s('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: s('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    trash: s('<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5A1.5 1.5 0 0 0 8 21h8a1.5 1.5 0 0 0 1.5-1.5L18.5 7M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>'),
    copy: s('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    edit: s('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Z"/>'),
    lock: s('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>'),
    unlock: s('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.7-1.5"/>'),
    front: s('<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    back: s('<rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M8 16v2.5A1.5 1.5 0 0 0 9.5 20h9a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 18.5 8H16"/>'),
    zoomIn: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>'),
    zoomOut: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>'),
    fit: s('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    palette: s('<path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7" r="1.2" fill="currentColor"/>'),
    template: s('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 21V9"/>'),
    archive: s('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>'),
    restore: s('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
    eye: s('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
    eyeOff: s('<path d="M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    send: s('<path d="M4 12 20 4l-4 16-4-6.5Z"/><path d="m12 13.5 8-9.5"/>'),
    attach: s('<path d="m20.5 11-8.4 8.4a5 5 0 0 1-7.1-7.1l8.8-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l8-8"/>'),
    sort: s('<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>'),
    filter: s('<path d="M3.5 5h17l-6.5 8v6l-4 2v-8Z"/>'),
    shield: s('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/><path d="m9 12 2 2 4-4"/>'),
    clockPlus: s('<circle cx="11" cy="12" r="8"/><path d="M11 8v4l2.5 1.5M19 3v4M17 5h4"/>'),
    expand: s('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
    fullscreen: s('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
    menu: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    layers: s('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>'),
    wand: s('<path d="m4 20 11-11M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1ZM19 11l.6 1.4L21 13l-1.4.6L19 15l-.6-1.4L17 13l1.4-.6Z"/>'),
    group: s('<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><path d="M17 14v6M14 17h6"/>'),
    stop: f('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
    record: f('<circle cx="12" cy="12" r="6"/>'),
    pause: s('<path d="M8 5v14M16 5v14"/>'),
    hash: s('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
    at: s('<circle cx="12" cy="12" r="3.5"/><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>'),
    phone: s('<path d="M5 3.5h3l1.5 4.5L7.5 9.5a11 11 0 0 0 7 7l1.5-2 4.5 1.5v3a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5Z"/>'),
    list: s('<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
    bold: s('<path d="M7 4.5h6a3.5 3.5 0 0 1 0 7H7Zm0 7h7a3.5 3.5 0 0 1 0 7H7Z"/>'),
    italic: s('<path d="M15 4.5h-5M14 19.5H9M13 4.5l-3 15"/>'),
    sigma: s('<path d="M18 5.5V4H6l7 8-7 8h12v-1.5"/>'),
    ai: s('<path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16.5v4M17 18.5h4"/>'),
  };
})();

// ======================= Messages =======================
function toast(text, kind) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${kind || ''}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, kind === 'error' ? 6000 : 3500);
}

// ======================= Fenêtres, menus, dialogues =======================
const UI = {
  stack: [],
  root() { let r = document.getElementById('modals'); if (!r) { r = document.createElement('div'); r.id = 'modals'; document.body.appendChild(r); } return r; },
  /** Ouvre une fenêtre modale ; renvoie l’élément .m-box. Options : cls, onClose, wide, sheet, dismissable */
  modal(html, { cls = '', onClose, dismissable = true, label = '', beforeClose } = {}) {
    const back = document.createElement('div');
    back.className = `m-back ${cls}`;
    back.innerHTML = `<div class="m-box" role="dialog" aria-modal="true" aria-label="${attr(label)}">${html}</div>`;
    UI.root().appendChild(back);
    const box = back.firstElementChild;
    const entry = { back, box, onClose, dismissable, beforeClose };
    UI.stack.push(entry);
    back.addEventListener('pointerdown', e => { entry.downOnBack = e.target === back; });
    back.addEventListener('click', e => { if (e.target === back && entry.downOnBack && dismissable) UI.dismiss(entry); });
    requestAnimationFrame(() => back.classList.add('on'));
    setTimeout(() => { const f = box.querySelector('[autofocus]'); if (f) { f.focus(); if (f.select && f.dataset.select !== undefined) f.select(); } }, 30);
    return box;
  },
  close(box, result) {
    const i = UI.stack.findIndex(e => e.box === box || e.back === box);
    if (i < 0) return;
    const [entry] = UI.stack.splice(i, 1);
    entry.back.classList.remove('on');
    entry.back.classList.add('off');
    setTimeout(() => entry.back.remove(), 160);
    try { entry.onClose?.(result); } catch (e) { console.error(e); }
  },
  async dismiss(entry) {
    if (entry.closing) return;
    entry.closing = true;
    try { if (entry.beforeClose && !(await entry.beforeClose())) return; UI.close(entry.box); }
    finally { entry.closing = false; }
  },
  closeTop() { const top = UI.stack[UI.stack.length - 1]; if (top && top.dismissable) { UI.dismiss(top); return true; } return false; },
  top() { return UI.stack[UI.stack.length - 1]?.box || null; },
  confirm(message, { title = '', ok = 'Confirmer', cancel = 'Annuler', danger = false } = {}) {
    return new Promise(resolve => {
      let done = false;
      const box = UI.modal(`<div class="dlg">${title ? `<h2>${esc(title)}</h2>` : ''}<p>${esc(message)}</p><div class="dlg-actions"><button class="btn" data-ui="no">${esc(cancel)}</button><button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ui="yes" autofocus>${esc(ok)}</button></div></div>`, { cls: 'small', onClose: r => { if (!done) { done = true; resolve(!!r); } } });
      box.addEventListener('click', e => { const b = e.target.closest('[data-ui]'); if (b) UI.close(box, b.dataset.ui === 'yes'); });
    });
  },
  prompt(title, value = '', { placeholder = '', ok = 'Valider', multiline = false, message = '' } = {}) {
    return new Promise(resolve => {
      let done = false;
      const field = multiline ? `<textarea class="input" rows="4" placeholder="${attr(placeholder)}" autofocus>${esc(value)}</textarea>` : `<input class="input" value="${attr(value)}" placeholder="${attr(placeholder)}" autofocus data-select>`;
      const box = UI.modal(`<form class="dlg"><h2>${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}${field}<div class="dlg-actions"><button type="button" class="btn" data-ui="no">Annuler</button><button class="btn primary" type="submit">${esc(ok)}</button></div></form>`, { cls: 'small', onClose: r => { if (!done) { done = true; resolve(r ?? null); } } });
      const input = box.querySelector('input,textarea');
      box.querySelector('form').addEventListener('submit', e => { e.preventDefault(); UI.close(box, input.value); });
      box.addEventListener('click', e => { if (e.target.closest('[data-ui="no"]')) UI.close(box, null); });
    });
  },
  /** Menu contextuel ancré : items = [{label, icon, act, danger, disabled, checked, sep, sub}] */
  menu(anchor, items, { align = 'left', x, y } = {}) {
    UI.closeMenu();
    const el = document.createElement('div');
    el.className = 'ctx-menu';
    el.innerHTML = items.filter(Boolean).map((it, i) => it.sep ? '<div class="sep"></div>' : it.header ? `<div class="hdr">${esc(it.header)}</div>` : `<button type="button" class="${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? I[it.icon] || it.icon : '<span class="noicon"></span>'}<span>${esc(it.label)}</span>${it.checked ? `<span class="ck">${I.check}</span>` : it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''}</button>`).join('');
    document.body.appendChild(el);
    const list = items.filter(Boolean);
    const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, top: y, bottom: y };
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = align === 'right' ? r.right - w : r.left;
    let top = r.bottom + 4;
    if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 4);
    left = clamp(left, 8, innerWidth - w - 8);
    el.style.left = `${left}px`; el.style.top = `${top}px`;
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const it = list[+b.dataset.i];
      UI.closeMenu();
      try { const r2 = it.act?.(); if (r2?.catch) r2.catch(err => toast(err.message, 'error')); } catch (err) { toast(err.message, 'error'); }
    });
    UI.menuEl = el;
    setTimeout(() => document.addEventListener('pointerdown', UI.menuAway, true), 0);
    return el;
  },
  menuAway(e) { if (UI.menuEl && !UI.menuEl.contains(e.target)) UI.closeMenu(); },
  closeMenu() { if (UI.menuEl) { UI.menuEl.remove(); UI.menuEl = null; document.removeEventListener('pointerdown', UI.menuAway, true); } },
};
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (UI.menuEl) { UI.closeMenu(); e.stopImmediatePropagation(); return; }
  if (UI.stack.length && !e.defaultPrevented) { if (UI.closeTop()) { e.stopImmediatePropagation(); e.preventDefault(); } }
}, true);
window.addEventListener('blur', () => UI.closeMenu());

// ======================= Émojis =======================
const EMOJI = {
  'Fréquents': '📌 ⭐️ 💡 🎯 🚀 ✅ 📚 🧠 🎨 🗺️ 🗓️ 🎓 💬 ❤️ 🔥 👍 🎉 🌍 🧪 📊'.split(' '),
  'Études': '📖 📝 ✏️ 📐 📏 🧮 🔬 🧬 💻 ⌨️ 📈 📉 📊 🗂️ 📁 📎 🔖 🏫 🎓 🧑‍🏫 🧑‍🎓 📓 📒 📕 📗 📘 📙 🗒️ ✒️ 🖊️ 🖍️ 🧷 📋 🗃️'.split(' '),
  'Objets': '💡 🔑 🧭 ⏰ ⌛️ 📷 🎥 🎤 🎧 🎮 🧩 🎲 🏆 🥇 🎁 🛠️ ⚙️ 🔧 🔨 🧲 💎 💰 💳 🧾 📦 ✉️ 📮 🗳️ 🔔 📣 🔍 🧯 🪄 🧸 🪴 🕯️'.split(' '),
  'Nature': '🌍 🌎 🌏 🗺️ 🏔️ 🌋 🏝️ 🌊 🌲 🌳 🌵 🌸 🌻 🌈 ☀️ 🌙 ⭐️ ⚡️ ❄️ 🔥 💧 🍀 🍁 🐝 🦋 🐢 🐬 🦊 🐼 🦁 🐧 🐙'.split(' '),
  'Visages': '😀 😃 😄 😁 😆 😅 😂 🙂 😉 😊 😍 🤩 😎 🤓 🧐 🤔 😮 😲 😴 🥳 😇 🤗 🙃 😬 😢 😭 😡 🤯 🥶 🤠'.split(' '),
  'Gestes': '👍 👎 👏 🙌 🤝 🙏 💪 👋 ✌️ 🤞 👌 ☝️ 👉 👀 🧠 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💯 ✨ 💥 💫 🎉 🎊'.split(' '),
  'Symboles': '✅ ☑️ ✔️ ❌ ❓ ❗️ ⚠️ 🚫 ⛔️ ♻️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫️ ⚪️ 🟥 🟧 🟨 🟩 🟦 🟪 ➡️ ⬅️ ⬆️ ⬇️ 🔁 🆕 🆗 🔝 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣'.split(' '),
  'Lieux': '🏠 🏫 🏛️ 🏰 🗼 🗽 🏟️ 🏥 🏦 🏭 🚀 ✈️ 🚄 🚗 🚲 ⛵️ 🗿 🗻 🏙️ 🌆 🎡 🎢 ⛺️ 🏖️'.split(' '),
};
function emojiPicker(anchor, onPick) {
  const html = `<div class="emoji-pop"><input class="input sm" placeholder="Rechercher un groupe…" data-emoji-filter><div class="emoji-scroll">${Object.entries(EMOJI).map(([g, list]) => `<div class="emoji-group" data-g="${attr(normalize(g))}"><b>${esc(g)}</b><div>${list.map(e => `<button type="button" data-emoji="${attr(e)}">${e}</button>`).join('')}</div></div>`).join('')}</div></div>`;
  UI.closeMenu();
  const el = document.createElement('div');
  el.className = 'ctx-menu emoji-menu';
  el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  el.style.left = `${clamp(r.left, 8, innerWidth - el.offsetWidth - 8)}px`;
  el.style.top = `${r.bottom + 4 + el.offsetHeight > innerHeight ? Math.max(8, r.top - el.offsetHeight - 4) : r.bottom + 4}px`;
  el.addEventListener('click', e => { const b = e.target.closest('[data-emoji]'); if (b) { UI.closeMenu(); onPick(b.dataset.emoji); } });
  el.querySelector('[data-emoji-filter]').addEventListener('input', e => { const q = normalize(e.target.value); $$('.emoji-group', el).forEach(g => { g.style.display = !q || g.dataset.g.includes(q) ? '' : 'none'; }); });
  UI.menuEl = el;
  setTimeout(() => document.addEventListener('pointerdown', UI.menuAway, true), 0);
}

// ======================= Glisser-déposer (souris et tactile) =======================
/**
 * Démarre un glisser après un petit déplacement. opts : { onStart(ghostEl), onMove(x, y, ev), onDrop(x, y, ev), onCancel(), ghost: () => element, threshold }
 * Renvoie false si le geste reste un clic.
 */
function startDrag(down, opts) {
  const threshold = opts.threshold ?? 6;
  const x0 = down.clientX, y0 = down.clientY;
  let dragging = false, ghost = null, ox = 0, oy = 0;
  const pointerId = down.pointerId;
  const move = e => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - x0, e.clientY - y0) < threshold) return;
      dragging = true;
      document.body.classList.add('dragging');
      if (opts.ghost) {
        const src = opts.ghost();
        const r = src.getBoundingClientRect();
        ghost = src.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.style.width = `${r.width}px`;
        ghost.style.height = `${r.height}px`;
        ox = x0 - r.left; oy = y0 - r.top;
        document.body.appendChild(ghost);
      }
      opts.onStart?.(ghost);
    }
    e.preventDefault();
    if (ghost) { ghost.style.transform = `translate(${e.clientX - ox}px, ${e.clientY - oy}px) rotate(1.5deg)`; }
    opts.onMove?.(e.clientX, e.clientY, e);
  };
  const end = e => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move, { passive: false });
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    document.body.classList.remove('dragging');
    ghost?.remove();
    if (!dragging) return;
    if (e.type === 'pointercancel') opts.onCancel?.(); else opts.onDrop?.(e.clientX, e.clientY, e);
    const stopClick = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', stopClick, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stopClick, { capture: true }), 50);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

// ======================= Copie =======================
async function copyText(text, label = 'Copié dans le presse-papiers') {
  try { await navigator.clipboard.writeText(text); toast(label); return; } catch {}
  const t = document.createElement('textarea');
  t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); toast(label); } catch { toast('Copie impossible', 'error'); }
  t.remove();
}

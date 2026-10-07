// Lecture des pages Inside Albert et des syllabus : fonctions pures, testées hors ligne.
import { normalized } from './util.mjs';

export const TIMEZONE = 'Europe/Paris';
const MONTHS = {
  jan: 0, janv: 0, january: 0, janvier: 0,
  feb: 1, fev: 1, fevr: 1, february: 1, fevrier: 1,
  mar: 2, mars: 2, march: 2,
  apr: 3, avr: 3, april: 3, avril: 3,
  may: 4, mai: 4,
  jun: 5, juin: 5, june: 5,
  jul: 6, juil: 6, july: 6, juillet: 6,
  aug: 7, aou: 7, aout: 7, august: 7,
  sep: 8, sept: 8, september: 8, septembre: 8,
  oct: 9, october: 9, octobre: 9,
  nov: 10, november: 10, novembre: 10,
  dec: 11, december: 11, decembre: 11,
};
export const UNITS = {
  MAT11: { code: 'MAT11', name: 'Mathématiques', short: 'Maths' },
  DAT12: { code: 'DAT12', name: 'Data', short: 'Data' },
  BUS13: { code: 'BUS13', name: 'Business', short: 'Business' },
  HUM14: { code: 'HUM14', name: 'Humanités', short: 'Humanités' },
};
export const COURSE_CODE = /\b((?:MAT|DAT|BUS|HUM)\d{2}-\d+)\b/i;
export const unitOf = code => String(code || '').toUpperCase().match(/^([A-Z]{3}\d{2})/)?.[1] || '';

/** Décalage (minutes) du fuseau de Paris à un instant donné. */
export function tzOffsetMinutes(utcMs, timeZone = TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60000);
}
/** Heure locale de Paris -> ISO UTC. */
export function parisToISO(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month, day, hour, minute);
  let utc = guess - tzOffsetMinutes(guess) * 60000;
  const second = tzOffsetMinutes(utc);
  utc = guess - second * 60000;
  return new Date(utc).toISOString();
}
/** Date calendaire de Paris (YYYY-MM-DD) d’un instant. */
export function parisDay(iso) {
  const d = new Date(iso);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function to24(hour, minute, meridiem) {
  let h = Number(hour);
  const m = String(meridiem || '').toUpperCase();
  if (m === 'PM' && h < 12) h += 12;
  if (m === 'AM' && h === 12) h = 0;
  return [h, Number(minute)];
}
const DATE_RE = /([A-Za-zÀ-ÿ]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/;
const DATE_RE_FR = /(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,9})\.?\s+(\d{4})/;
const TIME_RE = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i;
function monthIndex(word) { return MONTHS[normalized(word).replace(/\s/g, '')]; }

/** « Jan 14, 2027, 02:00 PM » ou « Sept 24, 2026 · 08:00 AM » -> ISO. */
export function parseDateTime(text) {
  const s = String(text || '');
  let y, mo, d;
  let m = s.match(DATE_RE);
  if (m && monthIndex(m[1]) !== undefined) { mo = monthIndex(m[1]); d = +m[2]; y = +m[3]; }
  else if ((m = s.match(DATE_RE_FR)) && monthIndex(m[2]) !== undefined) { d = +m[1]; mo = monthIndex(m[2]); y = +m[3]; }
  else return null;
  const after = s.slice(s.indexOf(m[0]) + m[0].length);
  const t = after.match(TIME_RE);
  const [h, mi] = t ? to24(t[1], t[2], t[3]) : [0, 0];
  return parisToISO(y, mo, d, h, mi);
}
/** « 08:00–10:00 » -> durée en minutes (null si une seule heure). */
export function rangeMinutes(text) {
  const m = String(text || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–—-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  const [h1, m1] = to24(m[1], m[2], m[3] || m[6]);
  const [h2, m2] = to24(m[4], m[5], m[6]);
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}
const addMinutes = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
const courseIdFrom = href => String(href || '').match(/\/courses\/([0-9a-f-]{36})/i)?.[1] || null;
export function eventId(item) {
  return `${item.start}|${item.courseId || item.code || ''}|${normalized(item.title).slice(0, 40)}`;
}

/**
 * Ligne de « My schedule » (vue Liste) extraite par le navigateur :
 * { start, range, href, title, code, badge, leaves }.
 */
export function scheduleItem(raw) {
  if (!raw?.start || Number.isNaN(Date.parse(raw.start))) return null;
  const start = new Date(raw.start).toISOString();
  const minutes = rangeMinutes(raw.range);
  const exam = /exam/i.test(raw.badge || '') || /\/me\/grades/.test(raw.href || '');
  const known = new Set([raw.range, raw.badge, raw.title, raw.code].map(x => String(x || '').trim()).filter(Boolean));
  const extras = (raw.leaves || []).map(x => String(x).trim()).filter(x => x && !known.has(x));
  const code = String(raw.code || '').toUpperCase() || (String(raw.title).match(COURSE_CODE)?.[1] || '').toUpperCase();
  const item = {
    start,
    end: minutes ? addMinutes(start, minutes) : start,
    allDay: false,
    title: String(raw.title || (exam ? 'Examen' : 'Séance')).trim(),
    code,
    unit: unitOf(code),
    courseId: courseIdFrom(raw.href),
    kind: exam ? 'exam' : (courseIdFrom(raw.href) ? 'cours' : 'event'),
    room: exam ? '' : (extras[0] || ''),
    teacher: exam ? '' : (extras[1] || ''),
    deadline: !minutes,
  };
  if (/room to confirm/i.test(item.room)) item.room = 'Salle à confirmer';
  item.id = eventId(item);
  return item;
}

/** Ligne du tableau « My exams » : { Exam: [...], Module: [...], Date: [...], ... }. */
export function examRow(cells) {
  const first = key => (cells[key] || [])[0] || '';
  const [name = '', mode = ''] = cells.Exam || [];
  const [code = '', courseTitle = ''] = cells.Module || [];
  const [startText = '', endText = ''] = cells.Date || [];
  const start = parseDateTime(startText);
  if (!name || !start) return null;
  const end = parseDateTime(endText.replace(/^ends?\s*/i, '')) || start;
  const duration = parseInt(first('Duration'), 10);
  const coeff = parseFloat(String(first('Coeff')).replace(',', '.'));
  const exam = {
    name: name.trim(),
    mode: mode.trim(),
    code: code.trim().toUpperCase(),
    unit: unitOf(code),
    courseTitle: courseTitle.trim(),
    start,
    end,
    durationMin: Number.isFinite(duration) ? duration : null,
    session: first('Session').trim(),
    coeff: Number.isFinite(coeff) ? coeff : null,
    seb: (cells.SEB || []).join(' ').trim(),
  };
  exam.id = `${exam.code}|${normalized(exam.name)}|${exam.session}|${exam.coeff ?? ''}`;
  return exam;
}

/** « 4/5 » et « 80.0% » du tableau « My attendance ». */
export function attendanceRow(cells) {
  const course = (cells.Course || [])[0] || '';
  const code = course.match(COURSE_CODE)?.[1]?.toUpperCase() || '';
  const ratio = String((cells.Attended || [])[0] || '').match(/(\d+)\s*\/\s*(\d+)/);
  const rate = parseFloat(String((cells['Where you stand'] || [])[0] || '').replace(',', '.'));
  if (!code || !ratio) return null;
  return {
    code,
    unit: unitOf(code),
    title: course.replace(/^.*?—\s*/, '').trim(),
    attended: +ratio[1],
    total: +ratio[2],
    rate: Number.isFinite(rate) ? rate / 100 : (+ratio[2] ? +ratio[1] / +ratio[2] : null),
  };
}
const STATUS = { present: 'present', absent: 'absent', pending: 'pending', late: 'late', excused: 'excused', justified: 'excused' };
/** Séance d’une page Attendance : « Sept 24, 2026 · 08:00 AM–10:00 AM » + statut. */
export function attendanceSession(when, status) {
  const text = String(when || '');
  const start = parseDateTime(text);
  if (!start) return null;
  const range = text.match(/(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[–—-]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
  const minutes = range ? rangeMinutes(`${range[1]}–${range[2]}`) : null;
  const label = text.replace(/^[\s\S]*?\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*[–—-]\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?/i, '').trim();
  const key = normalized(status).split(' ')[0];
  return {
    start,
    end: minutes ? addMinutes(start, minutes) : start,
    status: STATUS[key] || key || 'unknown',
    statusLabel: String(status || '').trim(),
    label,
  };
}

/** Tableau « Grading breakdown » d’un syllabus Markdown. */
export function gradingFromSyllabus(markdown) {
  const text = String(markdown || '');
  const section = text.split(/^##\s+Grading breakdown\s*$/im)[1];
  if (!section) return [];
  const rows = [];
  for (const line of section.split('\n')) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith('|') || /^\|\s*-/.test(line.trim())) continue;
    const cols = line.split('|').slice(1, -1).map(c => c.trim());
    if (cols.length < 3 || /^component$/i.test(cols[0])) continue;
    const weight = parseFloat(String(cols[1]).replace('%', '').replace(',', '.'));
    rows.push({ component: cols[0], weight: Number.isFinite(weight) ? weight : null, kind: cols[2] || '', duration: cols[3] && cols[3] !== '—' ? cols[3] : '' });
  }
  return rows;
}

/** Élément de « What’s new » sur l’accueil Inside. */
export function newsItem(raw) {
  const title = String(raw?.title || '').trim();
  if (!title) return null;
  const meta = String(raw.meta || '').split('·').map(s => s.trim()).filter(Boolean);
  const code = (meta[0] || '').match(COURSE_CODE)?.[1]?.toUpperCase() || '';
  const kind = /new material/i.test(raw.meta) ? 'material' : /announcement|post/i.test(raw.meta) ? 'announcement' : (raw.href || '').includes('#announcements') ? 'announcement' : 'post';
  let date = raw.datetime && !Number.isNaN(Date.parse(raw.datetime)) ? new Date(raw.datetime).toISOString() : null;
  if (!date) {
    const last = meta[meta.length - 1] || '';
    const m = last.match(/(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,9})\.?,?\s*(\d{1,2}):(\d{2})/);
    if (m && monthIndex(m[2]) !== undefined) {
      const now = new Date(raw.now || Date.now());
      let year = now.getUTCFullYear();
      const candidate = parisToISO(year, monthIndex(m[2]), +m[1], +m[3], +m[4]);
      if (Date.parse(candidate) - now.getTime() > 45 * 86400_000) year -= 1;
      date = parisToISO(year, monthIndex(m[2]), +m[1], +m[3], +m[4]);
    }
  }
  return {
    title: title.replace(/\s+/g, ' ').slice(0, 200),
    code,
    unit: unitOf(code),
    courseTitle: code ? (meta[0] || '').replace(/^.*?—\s*/, '').trim() : '',
    author: kind === 'material' ? '' : code ? (meta.length > 2 ? meta[1] : '') : (meta.length > 1 ? meta[0] : ''),
    kind,
    date,
    courseId: courseIdFrom(raw.href),
    url: raw.href || '',
  };
}

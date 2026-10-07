import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDateTime, rangeMinutes, scheduleItem, examRow, attendanceRow, attendanceSession, gradingFromSyllabus, newsItem, parisToISO, parisDay } from '../src/parse.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(await fs.readFile(path.join(here, 'fixtures/inside-sample.json'), 'utf8'));

// Fuseau de Paris, heure d’été et d’hiver.
assert.equal(parisToISO(2026, 8, 24, 8, 0), '2026-09-24T06:00:00.000Z');
assert.equal(parisToISO(2027, 0, 14, 14, 0), '2027-01-14T13:00:00.000Z');
assert.equal(parisToISO(2026, 9, 25, 12, 0), '2026-10-25T11:00:00.000Z', 'jour du passage à l’heure d’hiver');
assert.equal(parisDay('2026-09-23T22:30:00.000Z'), '2026-09-24');

// Dates Inside.
assert.equal(parseDateTime('Jan 14, 2027, 02:00 PM'), '2027-01-14T13:00:00.000Z');
assert.equal(parseDateTime('Sept 28, 2026, 11:05 AM'), '2026-09-28T09:05:00.000Z');
assert.equal(parseDateTime('Sept 24, 2026 · 08:00 AM–10:00 AM'), '2026-09-24T06:00:00.000Z');
assert.equal(parseDateTime('Dec 18, 2026, 12:00 AM'), '2026-12-17T23:00:00.000Z');
assert.equal(parseDateTime('24 sept. 2026 à 08:00'), '2026-09-24T06:00:00.000Z');
assert.equal(rangeMinutes('08:00–10:00'), 120);
assert.equal(rangeMinutes('11:00'), null);
assert.equal(rangeMinutes('08:00 AM–10:30 AM'), 150);

// Planning.
const schedule = sample.schedule.map(scheduleItem).filter(Boolean);
assert.equal(schedule.length, 52);
const first = schedule.find(e => e.code === 'DAT12-1' && e.start === '2026-09-24T06:00:00.000Z');
assert.deepEqual([first.kind, first.room, first.teacher, first.end, first.unit], ['cours', 'STAR Room', 'Inès Moreau', '2026-09-24T08:00:00.000Z', 'DAT12']);
const marketing = schedule.find(e => e.code === 'BUS13-1');
assert.equal(marketing.teacher, '', 'Marketing n’a pas d’enseignant affiché');
const exam = schedule.find(e => e.title === 'MCQ');
assert.deepEqual([exam.kind, exam.room, exam.end], ['exam', '', '2026-09-28T09:35:00.000Z']);
const project = schedule.find(e => e.title === 'Project 1');
assert.equal(project.deadline, true);
assert.equal(schedule.find(e => e.room === 'Salle à confirmer')?.code, 'BUS13-5');
assert.equal(new Set(schedule.map(e => e.id)).size, schedule.length, 'identifiants uniques');

// Examens.
const exams = sample.exams.map(examRow).filter(Boolean);
assert.equal(exams.length, 32);
const mcq = exams.find(e => e.code === 'DAT12-1' && e.name === 'MCQ');
assert.deepEqual([mcq.start, mcq.end, mcq.durationMin, mcq.coeff, mcq.mode], ['2026-09-28T09:05:00.000Z', '2026-09-28T09:35:00.000Z', 30, 20, 'PAPER']);
const oral = exams.find(e => e.code === 'BUS13-4' && e.name === 'Oral check point');
assert.equal(oral.durationMin, null);
assert.equal(new Set(exams.map(e => e.id)).size, 32, 'identifiants d’examen uniques');

// Présence.
const rows = sample.attendance.summary.map(attendanceRow).filter(Boolean);
assert.deepEqual(rows[0], { code: 'DAT12-1', unit: 'DAT12', title: 'Introduction to Data with Spreadsheet', attended: 4, total: 5, rate: 0.8 });
const s = attendanceSession('Sept 24, 2026 · 08:00 AM–10:00 AM', 'Absent');
assert.deepEqual([s.start, s.end, s.status], ['2026-09-24T06:00:00.000Z', '2026-09-24T08:00:00.000Z', 'absent']);
const talk = attendanceSession('Sept 23, 2026 · 08:30 PM–09:30 PM Véronique Morali', 'Present');
assert.deepEqual([talk.start, talk.label, talk.status], ['2026-09-23T18:30:00.000Z', 'Véronique Morali', 'present']);

// Syllabus.
const syllabus = await fs.readFile(path.join(here, 'fixtures/syllabus-MAT11-1.md'), 'utf8').catch(() => null);
if (syllabus) {
  const grading = gradingFromSyllabus(syllabus);
  assert.equal(grading.length, 4);
  assert.deepEqual(grading[0], { component: 'MCQ', weight: 10, kind: 'BTS', duration: '45 min' });
}

// Actualités.
const news = sample.news.map(n => newsItem({ ...n, now: sample.now })).filter(Boolean);
assert.deepEqual([news[0].kind, news[0].code, news[0].date], ['material', 'MAT11-1', '2026-09-24T10:14:00.000Z']);
assert.equal(news[4].kind, 'announcement');
assert.equal(news[4].author, 'Inès Moreau');
assert.equal(news[5].date, '2026-08-31T10:20:14.796Z');

console.log('OK : dates, planning, examens, présence, syllabus et actualités.');

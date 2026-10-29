// Finished workouts, kept on this phone only.
import { setSummary } from './analysis.js';

const KEY = 'vbt.history.v1';
const MAX_WORKOUTS = 200;

export function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveWorkout(sets) {
  if (!sets.length) return;
  const history = loadHistory();
  history.unshift({ date: new Date().toISOString(), sets });
  try {
    localStorage.setItem(KEY, JSON.stringify(history.slice(0, MAX_WORKOUTS)));
  } catch {
    // storage full or blocked; the CSV export still works
  }
}

const n = (v, d) => v.toFixed(d).replace('.', ',');

/** Semicolon-separated CSV with decimal commas, which is what Polish Excel / Sheets expect. */
export function workoutCsv(workout) {
  const rows = [['Data', 'Seria', 'Powtórzenie', 'Prędkość średnia [m/s]', 'Prędkość max [m/s]', 'Spadek [%]', 'Zakres [cm]', 'Czas [s]', 'Czas do max [s]']];
  const date = new Date(workout.date).toLocaleString('pl-PL');
  for (const set of workout.sets) {
    const best = Math.max(...set.reps.map((r) => r.meanVelocity));
    set.reps.forEach((r, i) => {
      rows.push([date, set.number, i + 1, n(r.meanVelocity, 2), n(r.peakVelocity, 2), n(best > 0 ? ((best - r.meanVelocity) / best) * 100 : 0, 0), n(r.rom, 1), n(r.duration, 2), n(r.timeToPeak, 2)]);
    });
  }
  return '﻿' + rows.map((r) => r.join(';')).join('\r\n');
}

export function workoutTotals(workout) {
  const reps = workout.sets.reduce((a, s) => a + s.reps.length, 0);
  return { sets: workout.sets.length, reps, summaries: workout.sets.map(setSummary) };
}

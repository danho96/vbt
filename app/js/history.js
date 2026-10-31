// Athletes and finished workouts, kept on this phone only.
import { setSummary } from './analysis.js';

const HISTORY_KEY = 'vbt.history.v1';
const ATHLETES_KEY = 'vbt.athletes.v1';
const MAX_WORKOUTS = 500;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked; the CSV export still works
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- athletes ----------

export const loadAthletes = () => read(ATHLETES_KEY);

export function addAthlete(name) {
  const athletes = loadAthletes();
  const athlete = { id: newId(), name: name.trim() };
  athletes.push(athlete);
  athletes.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  write(ATHLETES_KEY, athletes);
  return athlete;
}

export const athleteName = (id) => loadAthletes().find((a) => a.id === id)?.name ?? null;

// ---------- workouts ----------

/** Workouts from v1 had no id/athlete; give them stable ids so they can be opened and edited. */
export function loadHistory() {
  const history = read(HISTORY_KEY);
  let changed = false;
  for (const w of history) {
    if (!w.id) {
      w.id = `w${Date.parse(w.date).toString(36)}`;
      changed = true;
    }
  }
  if (changed) write(HISTORY_KEY, history);
  return history;
}

export function saveWorkout(workout) {
  if (!workout.sets.length) return null;
  const saved = { id: newId(), date: new Date().toISOString(), comment: '', approved: false, ...workout };
  const history = loadHistory();
  history.unshift(saved);
  write(HISTORY_KEY, history.slice(0, MAX_WORKOUTS));
  return saved;
}

export function updateWorkout(id, changes) {
  const history = loadHistory();
  const workout = history.find((w) => w.id === id);
  if (!workout) return null;
  Object.assign(workout, changes);
  write(HISTORY_KEY, history);
  return workout;
}

export const getWorkout = (id) => loadHistory().find((w) => w.id === id) ?? null;

export const workoutsOf = (athleteId) => loadHistory().filter((w) => (w.athleteId ?? null) === athleteId);

export function workoutTotals(workout) {
  const reps = workout.sets.reduce((a, s) => a + s.reps.length, 0);
  const exercises = [...new Set(workout.sets.map((s) => s.exercise).filter(Boolean))];
  return { sets: workout.sets.length, reps, exercises, summaries: workout.sets.map(setSummary) };
}

/**
 * Progress of one exercise over time: per workout, the fastest rep (mean velocity) among sets of that
 * exercise, optionally only at a given load. Oldest first.
 */
export function progressSeries(workouts, exercise, load = null) {
  return workouts
    .map((w) => {
      const sets = w.sets.filter((s) => s.exercise === exercise && (load === null || s.load === load));
      if (!sets.length) return null;
      const best = Math.max(...sets.flatMap((s) => s.reps.map((r) => r.meanVelocity)));
      return { date: w.date, value: best, sets: sets.length, workoutId: w.id };
    })
    .filter(Boolean)
    .reverse();
}

const n = (v, d) => v.toFixed(d).replace('.', ',');

/** Semicolon-separated CSV with decimal commas, which is what Polish Excel / Sheets expect. */
export function workoutCsv(workout, athlete) {
  const rows = [['Data', 'Zawodnik', 'Ćwiczenie', 'Ciężar [kg]', 'Seria', 'Powtórzenie', 'Prędkość średnia [m/s]', 'Prędkość max [m/s]', 'Moc [W]', 'Spadek [%]', 'Zakres [cm]', 'Czas [s]', 'Czas do max [ms]', 'Strefa']];
  const date = new Date(workout.date).toLocaleString('pl-PL');
  for (const set of workout.sets) {
    const best = Math.max(...set.reps.map((r) => r.meanVelocity));
    set.reps.forEach((r, i) => {
      rows.push([
        date, athlete ?? '', set.exercise ?? '', set.load ? n(set.load, set.load % 1 ? 1 : 0) : '', set.number, i + 1,
        n(r.meanVelocity, 2), n(r.peakVelocity, 2), set.load ? n(set.load * 9.81 * r.meanVelocity, 0) : '',
        n(best > 0 ? ((best - r.meanVelocity) / best) * 100 : 0, 0), n(r.rom, 1), n(r.duration, 2), n(r.timeToPeak * 1000, 0),
        set.zone ? `${set.zone.name} ${n(set.zone.min, 2)}-${n(set.zone.max, 2)}` : '',
      ].map(csvCell));
    });
  }
  if (workout.comment) rows.push([csvCell(`Komentarz: ${workout.comment}`)]);
  return '﻿' + rows.map((r) => r.join(';')).join('\r\n');
}

const csvCell = (v) => (/[;"\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);

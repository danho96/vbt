// Progress of each exercise across workouts. Velocity is only comparable at the same load, so the views
// default to an exercise's most used load (the coach's "history at fixed weight").

export const PROGRESS_METRICS = {
  best: { label: 'Najszybsze powtórzenie', short: 'Najszybsze' },
  avg: { label: 'Średnia z powtórzeń', short: 'Średnia' },
  peak: { label: 'Prędkość max', short: 'Max' },
};

// Fitted change over the whole history below this is noise rather than progress: day-to-day variation of
// mean velocity at the same load is typically a few percent.
const FLAT_THRESHOLD = 0.05;
// "Consistent" when at least this share of session-to-session steps did not go down.
const CONSISTENT_SHARE = 0.7;

const matching = (w, exercise, load) => w.sets.filter((s) => s.exercise === exercise && (load === null || s.load === load));

/**
 * One row per workout that has sets of the exercise (at the load, if given), oldest first.
 * best: fastest rep's mean velocity, avg: mean of all reps' mean velocities, peak: highest peak velocity.
 */
export function exerciseSessions(workouts, exercise, load = null) {
  return workouts
    .map((w) => {
      const sets = matching(w, exercise, load);
      const reps = sets.flatMap((s) => s.reps);
      if (!reps.length) return null;
      return {
        workoutId: w.id,
        date: w.date,
        sets: sets.length,
        reps: reps.length,
        loads: [...new Set(sets.map((s) => s.load).filter(Boolean))],
        best: Math.max(...reps.map((r) => r.meanVelocity)),
        avg: reps.reduce((a, r) => a + r.meanVelocity, 0) / reps.length,
        peak: Math.max(...reps.map((r) => r.peakVelocity)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The load an exercise was done with in the most sets (ties: the heavier one), or null if never entered. */
export function mainLoad(workouts, exercise) {
  const counts = new Map();
  for (const w of workouts) for (const s of matching(w, exercise, null)) if (s.load) counts.set(s.load, (counts.get(s.load) ?? 0) + 1);
  let best = null;
  for (const [load, n] of counts) if (best === null || n > counts.get(best) || (n === counts.get(best) && load > best)) best = load;
  return best;
}

/** Distinct loads used for an exercise, lightest first. */
export function exerciseLoads(workouts, exercise) {
  return [...new Set(workouts.flatMap((w) => matching(w, exercise, null).map((s) => s.load)).filter(Boolean))].sort((a, b) => a - b);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Trend of one metric over sessions (oldest first). Fits a Theil–Sen line (median of pairwise slopes) over
 * session order: unlike least squares, a single unusually good or bad day cannot flip the verdict.
 * @returns {{first, last, best, bestDate, change, changePct, status: 'up'|'flat'|'down'|null, consistent: boolean}}
 */
export function trend(sessions, key) {
  if (!sessions.length) return null;
  const ys = sessions.map((s) => s[key]);
  const first = ys[0];
  const last = ys[ys.length - 1];
  const bestIdx = ys.indexOf(Math.max(...ys));
  const result = {
    first, last, best: ys[bestIdx], bestDate: sessions[bestIdx].date,
    change: last - first, changePct: first > 0 ? (last - first) / first : 0,
    status: null, consistent: false,
  };
  if (ys.length < 2) return result;

  const n = ys.length;
  const slopes = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) slopes.push((ys[j] - ys[i]) / (j - i));
  const slope = median(slopes);
  const fittedFirst = median(ys.map((y, i) => y - slope * i));
  const fittedChange = fittedFirst > 0 ? (slope * (n - 1)) / fittedFirst : 0;
  result.status = fittedChange >= FLAT_THRESHOLD ? 'up' : fittedChange <= -FLAT_THRESHOLD ? 'down' : 'flat';

  const steps = ys.slice(1).map((y, i) => y - ys[i]);
  const sameWay = steps.filter((d) => (result.status === 'down' ? d <= 0 : d >= 0)).length;
  result.consistent = n >= 3 && result.status !== 'flat' && sameWay / steps.length >= CONSISTENT_SHARE;
  return result;
}

export const TREND_LABELS = {
  up: { text: 'Postęp', consistent: 'Stały postęp', className: 'up' },
  flat: { text: 'Bez zmian', consistent: 'Bez zmian', className: 'flat' },
  down: { text: 'Spadek', consistent: 'Stały spadek', className: 'down' },
};

/**
 * Overview card per exercise the athlete has done, most recently trained first. The trend is computed at the
 * exercise's main load when there is one, so different weights are not mixed.
 */
export function exerciseOverview(workouts, key = 'best') {
  const exercises = [...new Set(workouts.flatMap((w) => w.sets.map((s) => s.exercise)).filter(Boolean))];
  return exercises
    .map((exercise) => {
      const load = mainLoad(workouts, exercise);
      const sessions = exerciseSessions(workouts, exercise, load);
      const all = exerciseSessions(workouts, exercise);
      return { exercise, load, sessions, totalSessions: all.length, lastDate: all[all.length - 1].date, trend: trend(sessions, key) };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Per exercise within one workout, in the order first done (coach's "session intel"). */
export function workoutByExercise(workout) {
  const groups = new Map();
  for (const set of workout.sets) {
    const key = set.exercise || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(set);
  }
  return [...groups].map(([exercise, sets]) => {
    const reps = sets.flatMap((s) => s.reps);
    return {
      exercise,
      sets,
      reps: reps.length,
      loads: [...new Set(sets.map((s) => s.load).filter(Boolean))],
      avg: reps.reduce((a, r) => a + r.meanVelocity, 0) / reps.length,
      best: Math.max(...reps.map((r) => r.meanVelocity)),
    };
  });
}

/** Minutes from the first set's start to when the workout was saved; null when sets lack timestamps. */
export function workoutMinutes(workout) {
  const starts = workout.sets.map((s) => s.startedAt).filter(Number.isFinite);
  if (!starts.length) return null;
  return Math.max(1, Math.round((Date.parse(workout.date) - Math.min(...starts)) / 60000));
}

import { RepDetector, Session, setSummary, velocityLoss } from './analysis.js';
import { BleSensor, DemoSensor, bluetoothAvailable } from './sensor.js';
import { METRICS, fmt, loadSettings, saveSettings } from './settings.js';
import { loadHistory, saveWorkout, workoutCsv, workoutTotals } from './history.js';

const $ = (id) => document.getElementById(id);

let settings = loadSettings();
let sensor = null;
let session = null;
let detector = null;
let battery = null;
let wakeLock = null;
let shownWorkout = null;

// ---------- navigation ----------

const screens = ['home', 'live', 'settings', 'summary', 'history'];
const navStack = ['home'];

function show(name, { push = true } = {}) {
  for (const s of screens) $(s).hidden = s !== name;
  if (push && navStack[navStack.length - 1] !== name) navStack.push(name);
  window.scrollTo(0, 0);
}

function back() {
  navStack.pop();
  show(navStack[navStack.length - 1] || 'home', { push: false });
}

document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));

// ---------- connection ----------

async function start(source) {
  $('connect-error').hidden = true;
  sensor = source;
  session = new Session({ setGapSeconds: settings.setGapSeconds, direction: settings.direction });
  detector = new RepDetector(onPhase);
  battery = null;
  sensor.addEventListener('state', renderStatus);
  sensor.addEventListener('battery', (e) => {
    battery = e.detail;
    renderStatus();
  });
  sensor.addEventListener('samples', (e) => e.detail.forEach((s) => detector.push(s)));
  try {
    await sensor.connect();
  } catch (err) {
    sensor = null;
    if (err.name !== 'NotFoundError') {
      // NotFoundError = user closed the device picker
      $('connect-error').textContent = `Nie udało się połączyć: ${err.message}`;
      $('connect-error').hidden = false;
    }
    return;
  }
  navStack.length = 1;
  show('live');
  renderLive();
  keepScreenOn();
}

$('connect').addEventListener('click', () => start(new BleSensor()));
$('demo').addEventListener('click', () => start(new DemoSensor()));

// During training the header only speaks up when the connection is not healthy;
// sensor name and battery live in settings.
function renderStatus() {
  if (!sensor) return;
  const labels = { connecting: 'Łączenie…', reconnecting: 'Utracono połączenie, łączę ponownie…', disconnected: 'Rozłączono' };
  $('sensor-status').textContent = labels[sensor.state] ?? '';
  $('sensor-status').style.color = sensor.state === 'reconnecting' ? 'var(--warn)' : '';
  $('sensor-name').textContent = sensor.name;
  $('sensor-battery').textContent = battery ? `${fmt(battery, 2)} V` : '–';
}

async function keepScreenOn() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  // The browser drops the wake lock whenever the page is hidden.
  if (document.visibilityState === 'visible' && sensor) keepScreenOn();
});

// ---------- reps ----------

function onPhase(phase) {
  // Sets are split on wall-clock gaps, so time spent disconnected still counts as rest.
  phase.startTime = performance.now() / 1000 - phase.duration;
  showAccepted(session.addPhase(phase));
}

function showAccepted(accepted) {
  if (!accepted.length) return;
  for (const { set, rep } of accepted) {
    const best = Math.max(...set.reps.map((r) => r.meanVelocity));
    rep.velocityLoss = velocityLoss(best, rep.meanVelocity);
  }
  if (isWarn(accepted[accepted.length - 1].rep)) warn();
  renderLive({ flash: true });
}

function isWarn(rep) {
  return rep.velocityLoss * 100 >= settings.lossWarnPercent;
}

let audio = null;
function warn() {
  if (settings.vibrate) navigator.vibrate?.(250);
  if (settings.beep) {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.3);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.3);
  }
}

// Bars and the list value use the hero metric, except velocity loss, which reads better as mean velocity.
const listMetric = () => (settings.heroMetric === 'velocityLoss' ? 'meanVelocity' : settings.heroMetric);

function renderLive({ flash = false } = {}) {
  // After "Nowa seria" the next set exists only once its first rep arrives; show it empty until then.
  const set = session.startNextSet ? null : session.currentSet;
  const reps = set?.reps ?? [];
  const last = reps[reps.length - 1];
  const hero = METRICS[settings.heroMetric];

  $('set-label').textContent = `Seria ${set ? set.number : session.sets.length + 1}`;
  $('hero-label').textContent = last ? `${hero.label} · powt. ${reps.length}` : hero.label;
  $('hero-value').textContent = last ? hero.format(last) : '–';
  $('hero-unit').textContent = hero.unit;
  $('hero-value').classList.toggle('warn', !!last && isWarn(last));
  if (flash) {
    $('hero-value').classList.remove('flash');
    void $('hero-value').offsetWidth;
    $('hero-value').classList.add('flash');
  }

  $('tiles').innerHTML = settings.tiles
    .filter((key) => key !== settings.heroMetric && METRICS[key])
    .map((key) => {
      const m = METRICS[key];
      const warnClass = key === 'velocityLoss' && last && isWarn(last) ? ' warn' : '';
      return `<div class="tile"><div class="muted">${m.short}</div><div class="value${warnClass}">${last ? m.format(last) : '–'}<small>${m.unit}</small></div></div>`;
    })
    .join('');

  const key = listMetric();
  $('reps-metric').textContent = `${METRICS[key].short} [${METRICS[key].unit}]`;
  $('reps').innerHTML = repRows(reps, key);
  $('waiting').hidden = reps.length > 0;
  $('reps-wrap').scrollTop = $('reps-wrap').scrollHeight;
}

function repRows(reps, key) {
  const max = Math.max(...reps.map((r) => r[key]), 0.0001);
  return reps
    .map((r, i) => {
      const width = Math.max(4, (r[key] / max) * 100);
      return `<li class="${isWarn(r) ? 'warn' : ''}"><span class="n">${i + 1}</span><span class="track"><span class="fill" style="display:block;width:${width}%"></span></span><span class="v">${METRICS[key].format(r)}</span></li>`;
    })
    .join('');
}

$('new-set').addEventListener('click', () => {
  showAccepted(session.newSet());
  renderLive();
});

$('finish').addEventListener('click', async () => {
  session.closeSet();
  const sets = session.sets.filter((s) => s.reps.length);
  await sensor?.disconnect();
  sensor = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  navStack.length = 1;
  if (!sets.length) return show('home');
  saveWorkout(sets);
  openSummary(loadHistory()[0]);
});

// ---------- settings ----------

$('open-settings').addEventListener('click', () => {
  renderSettings();
  show('settings');
});

function renderSettings() {
  $('hero-metric').innerHTML = Object.entries(METRICS)
    .map(([key, m]) => `<option value="${key}" ${key === settings.heroMetric ? 'selected' : ''}>${m.label}</option>`)
    .join('');
  $('tile-toggles').innerHTML = Object.entries(METRICS)
    .filter(([key]) => key !== settings.heroMetric)
    .map(([key, m]) => `<label>${m.label}<input type="checkbox" class="switch" data-tile="${key}" ${settings.tiles.includes(key) ? 'checked' : ''}></label>`)
    .join('');
  $('direction').value = settings.direction;
  $('loss-warn').value = settings.lossWarnPercent;
  $('set-gap').value = settings.setGapSeconds;
  $('vibrate').checked = settings.vibrate;
  $('beep').checked = settings.beep;
}

$('settings').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'hero-metric') settings.heroMetric = t.value;
  else if (t.dataset.tile) {
    settings.tiles = t.checked ? [...settings.tiles, t.dataset.tile] : settings.tiles.filter((k) => k !== t.dataset.tile);
  } else if (t.id === 'loss-warn') settings.lossWarnPercent = clamp(+t.value, 5, 60, settings.lossWarnPercent);
  else if (t.id === 'set-gap') settings.setGapSeconds = clamp(+t.value, 5, 600, settings.setGapSeconds);
  else if (t.id === 'vibrate') settings.vibrate = t.checked;
  else if (t.id === 'beep') settings.beep = t.checked;
  else if (t.id === 'direction') {
    settings.direction = t.value;
    // Applies from the next set; the set in progress keeps the direction it was measured with.
    if (session) session.opts.direction = t.value;
  }
  saveSettings(settings);
  if (session) session.opts.setGapSeconds = settings.setGapSeconds;
  renderSettings();
  if (session) renderLive();
});

const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

// ---------- summary and history ----------

function openSummary(workout) {
  shownWorkout = workout;
  $('summary-date').textContent = new Date(workout.date).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
  $('summary-sets').innerHTML = workout.sets
    .map((set) => {
      const s = setSummary(set);
      return `<div class="set-card">
        <h2><span>Seria ${set.number}</span><span class="muted">${s.reps} powt.</span></h2>
        <div class="stats">
          <div><span class="muted">Najlepsza śr.</span><b>${fmt(s.bestMean, 2)}</b></div>
          <div><span class="muted">Max</span><b>${fmt(s.peak, 2)}</b></div>
          <div><span class="muted">Spadek</span><b>${s.velocityLoss > 0 ? '-' : ''}${fmt(s.velocityLoss * 100, 0)}%</b></div>
        </div>
        <ol class="reps">${repRows(set.reps, 'meanVelocity')}</ol>
      </div>`;
    })
    .join('');
  show('summary');
}

$('summary-done').addEventListener('click', back);

$('export').addEventListener('click', async () => {
  const csv = workoutCsv(shownWorkout);
  const name = `trening-${shownWorkout.date.slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  const file = new File([csv], name, { type: 'text/csv' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Trening VBT' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('open-history').addEventListener('click', () => {
  const history = loadHistory();
  $('history-list').innerHTML = history
    .map((w, i) => {
      const t = workoutTotals(w);
      const date = new Date(w.date).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
      return `<li><button data-index="${i}"><span>${date}</span><span class="muted">${t.sets} serii · ${t.reps} powt.</span></button></li>`;
    })
    .join('');
  $('history-empty').hidden = history.length > 0;
  show('history');
});

$('history-list').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-index]');
  if (button) openSummary(loadHistory()[+button.dataset.index]);
});

// ---------- startup ----------

if (!bluetoothAvailable()) {
  $('no-bluetooth').hidden = false;
  $('connect').hidden = true;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

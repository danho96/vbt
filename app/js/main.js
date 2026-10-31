import { RepDetector, Session, setSummary, velocityLoss } from './analysis.js';
import { BleSensor, DemoSensor, bluetoothAvailable } from './sensor.js';
import { METRICS, MAX_TILES, RING_METRICS, EXERCISES, fmt, loadSettings, saveSettings, batteryPercent } from './settings.js';
import {
  loadAthletes, addAthlete, athleteName, loadHistory, saveWorkout, updateWorkout, getWorkout,
  workoutsOf, workoutTotals, progressSeries, workoutCsv,
} from './history.js';
import { PRESET_ZONES, SLIDER_MAX, zoneStatus, ringFraction, percentInZone, formatRange } from './zones.js';
import { $, esc, icon, initials, formatDate, ring, barChart, lineChart } from './ui.js';

let settings = loadSettings();
let sensor = null;
let session = null;
let detector = null;
let battery = null;
let wakeLock = null;

// ============================================================ navigation
// Each tab keeps its own stack of screens, so switching tabs mid-workout and back lands where you were.

const TAB_ROOTS = { training: 'setup', zones: 'zones', athletes: 'athletes', settings: 'settings' };
const stacks = Object.fromEntries(Object.entries(TAB_ROOTS).map(([tab, root]) => [tab, [root]]));
let currentTab = 'training';
const renderers = {};

function showScreen(name) {
  document.querySelectorAll('main > .screen').forEach((s) => (s.hidden = s.id !== name));
  renderers[name]?.();
  window.scrollTo(0, 0);
}

function go(name) {
  stacks[currentTab].push(name);
  showScreen(name);
}

function back() {
  const stack = stacks[currentTab];
  if (stack.length > 1) stack.pop();
  showScreen(stack[stack.length - 1]);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  showScreen(stacks[tab][stacks[tab].length - 1]);
}

document.querySelectorAll('[data-back]').forEach((b) => {
  b.innerHTML = `${icon('back')} Wróć`;
  b.addEventListener('click', back);
});
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = icon(el.dataset.icon, 22)));

// ============================================================ zones

const allZones = () => settings.zones ?? PRESET_ZONES;
const activeZone = () => allZones().find((z) => z.id === settings.activeZoneId) ?? null;
const zoneSnapshot = (z) => (z ? { id: z.id, name: z.name, min: z.min, max: z.max } : null);

// ============================================================ training: setup

renderers.setup = () => {
  $('setup-athlete').textContent = athleteName(settings.athleteId) ?? 'Bez zawodnika';
  $('setup-exercise').textContent = settings.exercise || '–';
  $('setup-load').textContent = settings.load ? `${fmt(settings.load, settings.load % 1 ? 1 : 0)} kg` : '–';
  $('setup-zone').textContent = activeZone()?.name ?? 'Brak';
};

$('setup-card').addEventListener('click', openSheet);

async function start(source) {
  $('connect-error').hidden = true;
  sensor = source;
  session = new Session({
    setGapSeconds: settings.setGapSeconds,
    direction: settings.direction,
    newSetInfo: () => ({
      athleteId: settings.athleteId,
      exercise: settings.exercise,
      load: settings.load,
      zone: zoneSnapshot(activeZone()),
    }),
  });
  detector = new RepDetector(onPhase);
  battery = null;
  sensor.addEventListener('state', renderConnection);
  sensor.addEventListener('battery', (e) => {
    battery = e.detail;
    renderSensorInfo();
  });
  sensor.addEventListener('samples', (e) => e.detail.forEach((s) => detector.push(s)));
  try {
    await sensor.connect();
  } catch (err) {
    sensor = null;
    session = null;
    if (err.name !== 'NotFoundError') {
      // NotFoundError = user closed the device picker
      $('connect-error').textContent = `Nie udało się połączyć: ${err.message}`;
      $('connect-error').hidden = false;
    }
    return;
  }
  stacks.training = ['live'];
  document.querySelector('.tabbar [data-tab="training"] span').classList.add('live-dot');
  switchTab('training');
  keepScreenOn();
}

$('connect').addEventListener('click', () => start(new BleSensor()));
$('demo').addEventListener('click', () => start(new DemoSensor()));

function renderConnection() {
  if (!sensor) return;
  const labels = { connecting: 'Łączenie…', connected: 'Połączono', reconnecting: 'Utracono połączenie, łączę ponownie…', disconnected: 'Rozłączono' };
  $('conn-text').textContent = labels[sensor.state] ?? '';
  $('conn').classList.toggle('warn', sensor.state !== 'connected');
  renderSensorInfo();
}

function renderSensorInfo() {
  $('sensor-name').textContent = sensor?.name || '–';
  $('sensor-battery').textContent = battery ? `${fmt(battery, 2)} V (ok. ${batteryPercent(battery)}%)` : '–';
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

// ============================================================ training: live

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
  if (!$('live').hidden) renderLive({ flash: true });
}

const isWarn = (rep) => rep.velocityLoss * 100 >= settings.lossWarnPercent;

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

/** Colour class of a rep: zone position when a zone is set, otherwise the velocity-loss warning. */
const repClass = (rep, zone) => (zone ? zoneStatus(zone, rep.meanVelocity) : isWarn(rep) ? 'warn' : '');

const loadText = (load) => (load ? `${fmt(load, load % 1 ? 1 : 0)} kg` : '–');

function renderLive({ flash = false } = {}) {
  if (!session) return;
  renderConnection();
  // After "Nowa seria" the next set exists only once its first rep arrives; show it empty until then.
  const set = session.startNextSet ? null : session.currentSet;
  const reps = set?.reps ?? [];
  const last = reps[reps.length - 1];
  const zone = set ? set.zone : zoneSnapshot(activeZone());
  const setNumber = set ? set.number : session.sets.length + 1;

  const who = athleteName(set ? set.athleteId : settings.athleteId);
  $('live-who').innerHTML = `${who ? `Zawodnik: <b>${esc(who)}</b><br>` : ''}Ciężar: <b>${loadText(set ? set.load : settings.load)}</b>`;
  $('live-exercise').textContent = (set ? set.exercise : settings.exercise) || 'Trening';
  $('live-progress').textContent = `Seria ${setNumber} | Powt. ${reps.length}`;

  // ---- ring
  const metric = settings.ringMetric;
  let value = '–';
  let unit = 'm/s';
  let fraction = 0;
  let status = null;
  if (metric === 'zonePercent') {
    unit = '%';
    if (zone && reps.length) {
      const p = percentInZone(zone, reps);
      value = fmt(p * 100, 0);
      fraction = p;
      status = 'in';
    } else if (!zone) {
      unit = 'wybierz strefę';
    }
  } else if (last) {
    const v = last[metric];
    value = fmt(v, 2);
    fraction = ringFraction(zone, v);
    status = zone ? zoneStatus(zone, last.meanVelocity) : isWarn(last) ? 'below' : null;
  }
  const tickAt = zone && metric !== 'zonePercent' ? zone.min / zone.max : null;
  $('ring').innerHTML = ring({ fraction, status, tickAt });
  $('ring-label').textContent = RING_METRICS[metric].short;
  $('ring-value').textContent = value;
  $('ring-unit').textContent = unit;
  $('ring-zone').textContent = zone ? `${zone.name} · ${formatRange(zone, fmt)}` : 'Bez strefy prędkości';
  if (flash) {
    $('ring-value').classList.remove('flash');
    void $('ring-value').offsetWidth;
    $('ring-value').classList.add('flash');
  }

  // ---- stats under the ring
  $('tiles').innerHTML = settings.tiles
    .map((key) => {
      const m = METRICS[key];
      const warnClass = key === 'velocityLoss' && last && isWarn(last) ? ' warn' : '';
      return `<div class="stat">${icon(m.icon, 22)}<span class="v${warnClass}">${last ? m.format(last, set) : '–'}<small>${m.unit}</small></span></div>`;
    })
    .join('');

  // ---- set card
  const avg = reps.length ? reps.reduce((a, r) => a + r.meanVelocity, 0) / reps.length : null;
  const max = reps.length ? Math.max(...reps.map((r) => r.peakVelocity)) : null;
  $('set-avg').textContent = `ŚR: ${avg === null ? '–' : fmt(avg, 2)} m/s`;
  $('set-max').textContent = `MAX: ${max === null ? '–' : fmt(max, 2)} m/s`;
  $('reps').innerHTML = repRows(reps, zone);
  $('waiting').hidden = reps.length > 0;
  $('reps-wrap').scrollTop = $('reps-wrap').scrollHeight;
}
renderers.live = () => renderLive();

function repRows(reps, zone) {
  const top = Math.max(...reps.map((r) => r.meanVelocity), zone?.max ?? 0, 0.0001);
  return reps
    .map((r, i) => {
      const width = Math.max(4, (r.meanVelocity / top) * 100);
      return `<li class="${repClass(r, zone)}"><span class="n">POWT. ${i + 1}</span><span class="track"><span class="fill" style="width:${width}%"></span></span><span class="v">${fmt(r.meanVelocity, 2)} m/s</span></li>`;
    })
    .join('');
}

$('live-who').addEventListener('click', openSheet);

$('new-set').addEventListener('click', () => {
  showAccepted(session.newSet());
  renderLive();
});

$('finish').addEventListener('click', async () => {
  if (session.sets.some((s) => s.reps.length) && !confirm('Zakończyć trening i zapisać wyniki?')) return;
  session.closeSet();
  const sets = session.sets.filter((s) => s.reps.length);
  await sensor?.disconnect();
  sensor = null;
  session = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  document.querySelector('.tabbar [data-tab="training"] span').classList.remove('live-dot');
  stacks.training = ['setup'];

  // One workout per athlete: a coach can alternate athletes within one session.
  const byAthlete = new Map();
  for (const set of sets) {
    const key = set.athleteId ?? null;
    if (!byAthlete.has(key)) byAthlete.set(key, []);
    byAthlete.get(key).push(set);
  }
  let lastSaved = null;
  for (const [athleteId, athleteSets] of byAthlete) {
    lastSaved = saveWorkout({ athleteId, sets: athleteSets.map((s, i) => ({ ...s, number: i + 1 })) });
  }
  if (lastSaved) {
    stacks.training.push('summary');
    summaryId = lastSaved.id;
  }
  switchTab('training');
});

// ============================================================ set sheet (athlete / exercise / load)

function openSheet() {
  const athletes = loadAthletes();
  $('sheet-athlete').innerHTML = [
    `<option value="">Bez zawodnika</option>`,
    ...athletes.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`),
    `<option value="__new">+ Nowy zawodnik…</option>`,
  ].join('');
  $('sheet-athlete').value = settings.athleteId ?? '';
  const used = loadHistory().flatMap((w) => w.sets.map((s) => s.exercise)).filter(Boolean);
  $('exercise-list').innerHTML = [...new Set([...used, ...EXERCISES])].map((e) => `<option value="${esc(e)}">`).join('');
  $('sheet-exercise').value = settings.exercise;
  $('sheet-load').value = settings.load || '';
  const midSet = session && !session.startNextSet && session.currentSet?.reps.length;
  $('sheet-note').textContent = midSet ? 'Zmiana zacznie nową serię.' : '';
  $('sheet').hidden = false;
}

const closeSheet = () => ($('sheet').hidden = true);
$('sheet-cancel').addEventListener('click', closeSheet);
$('sheet').addEventListener('click', (e) => e.target === $('sheet') && closeSheet());

$('sheet-athlete').addEventListener('change', (e) => {
  if (e.target.value !== '__new') return;
  const name = prompt('Imię i nazwisko zawodnika')?.trim();
  if (!name) {
    e.target.value = settings.athleteId ?? '';
    return;
  }
  const athlete = addAthlete(name);
  e.target.insertAdjacentHTML('beforeend', `<option value="${esc(athlete.id)}">${esc(athlete.name)}</option>`);
  e.target.value = athlete.id;
});

document.querySelectorAll('[data-step]').forEach((b) => {
  b.innerHTML = icon(+b.dataset.step > 0 ? 'plus' : 'minus');
  b.addEventListener('click', () => {
    const v = Math.max(0, (+$('sheet-load').value || 0) + +b.dataset.step);
    $('sheet-load').value = v;
  });
});

$('sheet-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const next = {
    athleteId: $('sheet-athlete').value || null,
    exercise: $('sheet-exercise').value.trim(),
    load: Math.max(0, Math.round((+$('sheet-load').value || 0) * 2) / 2),
  };
  const changed = next.athleteId !== settings.athleteId || next.exercise !== settings.exercise || next.load !== settings.load;
  Object.assign(settings, next);
  saveSettings(settings);
  closeSheet();
  // A new load or exercise is a new set.
  if (changed && session && !session.startNextSet && session.currentSet?.reps.length) showAccepted(session.newSet());
  renderers[stacks[currentTab][stacks[currentTab].length - 1]]?.();
});

// ============================================================ summary

let summaryId = null;

renderers.summary = () => {
  const workout = getWorkout(summaryId);
  if (!workout) return back();
  const name = athleteName(workout.athleteId);
  $('summary-title').textContent = name ? `Zawodnik: ${name}` : 'Podsumowanie';
  $('summary-date').textContent = formatDate(workout.date, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('summary-sets').innerHTML = workout.sets.map((set) => setBlock(set)).join('');
  $('summary-comment').value = workout.comment ?? '';
  renderApprove(workout);
};

function setBlock(set) {
  const s = setSummary(set);
  const zone = set.zone;
  const title = [set.exercise, set.load ? loadText(set.load) : null].filter(Boolean).map(esc).join(' · ');
  const rows = set.reps
    .map((r, i) => `<tr><td>${i + 1}</td><td class="${zone ? zoneStatus(zone, r.meanVelocity) : ''}">${fmt(r.meanVelocity, 2)}</td><td>${fmt(r.peakVelocity, 2)}</td><td>${fmt(r.timeToPeak * 1000, 0)}</td></tr>`)
    .join('');
  return `<div class="card set-block">
    <div class="head"><span class="display-sm">Seria ${set.number}${title ? ` · ${title}` : ''}</span><span class="muted">${s.reps} powt.</span></div>
    ${zone ? `<div class="muted">Strefa: ${esc(zone.name)} ${formatRange(zone, fmt)}</div>` : ''}
    ${barChart(set.reps.map((r) => r.meanVelocity), { zone, statusOf: (v) => (zone ? zoneStatus(zone, v) : '') })}
    <table class="reps-table">
      <thead><tr><th>Powt.</th><th>Średnia m/s</th><th>Max m/s</th><th>Do max ms</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary-line"><span class="muted">Średnia serii</span><span class="num">${fmt(s.avgMean, 2)} m/s</span></div>
    <div class="summary-line"><span class="muted">Spadek prędkości</span><span class="num">${s.velocityLoss > 0 ? '-' : ''}${fmt(s.velocityLoss * 100, 0)}%</span></div>
    ${set.load ? `<div class="summary-line"><span class="muted">Moc średnia</span><span class="num">${fmt(set.load * 9.81 * s.avgMean, 0)} W</span></div>` : ''}
  </div>`;
}

function renderApprove(workout) {
  $('approve').innerHTML = workout.approved ? `${icon('check')} Zatwierdzono` : 'Zatwierdź wynik';
  $('approve').classList.toggle('approved', !!workout.approved);
}

$('summary-comment').addEventListener('change', (e) => updateWorkout(summaryId, { comment: e.target.value.trim() }));

$('approve').addEventListener('click', () => {
  const w = getWorkout(summaryId);
  renderApprove(updateWorkout(summaryId, { approved: !w.approved, comment: $('summary-comment').value.trim() }));
});

$('export').innerHTML = icon('share');
$('export').addEventListener('click', async () => {
  const workout = getWorkout(summaryId);
  const athlete = athleteName(workout.athleteId);
  const csv = workoutCsv(workout, athlete);
  const name = `${athlete ? `${athlete.replace(/[^\p{L}\p{N}]+/gu, '-')}-` : ''}trening-${workout.date.slice(0, 16).replace(/[:T]/g, '-')}.csv`;
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

// ============================================================ zones screen

renderers.zones = () => {
  const active = settings.activeZoneId;
  $('zone-list').innerHTML = allZones()
    .map((z) => `<div class="zone ${z.id === active ? 'active' : ''}" role="button" tabindex="0" data-zone="${esc(z.id)}" aria-pressed="${z.id === active}">
      <span class="z-icon">${icon(z.icon ?? 'zone', 34)}</span>
      <span class="z-name">${esc(z.name)}</span>
      <input type="checkbox" class="switch" tabindex="-1" ${z.id === active ? 'checked' : ''} aria-hidden="true">
      ${z.description ? `<span class="z-desc">${esc(z.description)}</span>` : ''}
      <span class="z-range">${formatRange(z, fmt)}</span>
      <button class="btn ghost z-edit" data-edit="${esc(z.id)}" aria-label="Edytuj strefę ${esc(z.name)}">${icon('edit')}</button>
    </div>`)
    .join('');
  $('add-zone').innerHTML = `${icon('plus')} Dodaj własną strefę`;
  $('ring-metric').innerHTML = Object.entries(RING_METRICS)
    .map(([key, m]) => `<button role="radio" aria-checked="${key === settings.ringMetric}" data-ring="${key}">${m.label}</button>`)
    .join('');
};

$('zone-list').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (edit) return openZoneEditor(edit.dataset.edit);
  const card = e.target.closest('[data-zone]');
  if (!card) return;
  settings.activeZoneId = settings.activeZoneId === card.dataset.zone ? null : card.dataset.zone;
  saveSettings(settings);
  // The set in progress follows the zone the coach just picked.
  if (session && !session.startNextSet && session.currentSet) session.currentSet.zone = zoneSnapshot(activeZone());
  renderers.zones();
});

$('ring-metric').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ring]');
  if (!b) return;
  settings.ringMetric = b.dataset.ring;
  saveSettings(settings);
  renderers.zones();
});

// ---- zone editor

let editingZone = null; // a copy; {isNew} when adding

function openZoneEditor(id) {
  const zone = allZones().find((z) => z.id === id);
  editingZone = zone ? { ...zone } : { id: `z${Date.now().toString(36)}`, name: `Własna strefa ${allZones().length - PRESET_ZONES.length + 1}`, description: 'Zakres zdefiniowany przez trenera', min: 0.6, max: 0.9, icon: 'zone', isNew: true };
  go('zone-edit');
}

$('add-zone').addEventListener('click', () => openZoneEditor(null));

renderers['zone-edit'] = () => {
  if (!editingZone) return back();
  $('zone-edit-title').textContent = editingZone.isNew ? 'Nowa strefa' : 'Edytuj strefę';
  $('zone-name').value = editingZone.name;
  $('zone-delete').innerHTML = icon('trash');
  $('zone-delete').hidden = !!editingZone.isNew;
  $('zone-save').innerHTML = `${icon('check')} ${editingZone.isNew ? 'Dodaj strefę' : 'Zapisz'}`;
  syncZoneInputs();
};

const round2 = (v) => Math.round(v * 100) / 100;
const MIN_WIDTH = 0.05;

function syncZoneInputs() {
  const { min, max } = editingZone;
  $('zone-min').value = min;
  $('zone-max').value = max;
  $('zone-min-input').value = min.toFixed(2);
  $('zone-max-input').value = max.toFixed(2);
  $('zone-fill').style.left = `${(min / SLIDER_MAX) * 100}%`;
  $('zone-fill').style.right = `${100 - (max / SLIDER_MAX) * 100}%`;
  $('zone-range-text').textContent = `Zakres: ${formatRange(editingZone, fmt)}`;
}

function setZoneBound(which, raw) {
  const v = round2(Math.min(SLIDER_MAX, Math.max(0, +raw || 0)));
  if (which === 'min') editingZone.min = Math.min(v, round2(editingZone.max - MIN_WIDTH));
  else editingZone.max = Math.max(v, round2(editingZone.min + MIN_WIDTH));
  syncZoneInputs();
}

$('zone-min').addEventListener('input', (e) => setZoneBound('min', e.target.value));
$('zone-max').addEventListener('input', (e) => setZoneBound('max', e.target.value));
$('zone-min-input').addEventListener('change', (e) => setZoneBound('min', e.target.value));
$('zone-max-input').addEventListener('change', (e) => setZoneBound('max', e.target.value));
$('zone-name').addEventListener('input', (e) => (editingZone.name = e.target.value));

$('zone-save').addEventListener('click', () => {
  const { isNew, ...zone } = editingZone;
  zone.name = zone.name.trim() || 'Strefa';
  const zones = allZones().map((z) => ({ ...z }));
  if (isNew) zones.push(zone);
  else zones.splice(zones.findIndex((z) => z.id === zone.id), 1, zone);
  settings.zones = zones;
  if (isNew) settings.activeZoneId = zone.id;
  saveSettings(settings);
  if (session && !session.startNextSet && session.currentSet && settings.activeZoneId === zone.id) session.currentSet.zone = zoneSnapshot(zone);
  editingZone = null;
  back();
});

$('zone-delete').addEventListener('click', () => {
  if (!confirm(`Usunąć strefę „${editingZone.name}”?`)) return;
  settings.zones = allZones().filter((z) => z.id !== editingZone.id);
  if (settings.activeZoneId === editingZone.id) settings.activeZoneId = null;
  saveSettings(settings);
  editingZone = null;
  back();
});

// ============================================================ athletes

renderers.athletes = () => {
  $('search-icon').innerHTML = icon('search', 18);
  const q = $('athlete-search').value.trim().toLocaleLowerCase('pl');
  const history = loadHistory();
  const rows = loadAthletes().map((a) => ({ id: a.id, name: a.name }));
  if (history.some((w) => !w.athleteId)) rows.push({ id: '', name: 'Bez zawodnika' });
  $('athlete-list').innerHTML = rows
    .filter((a) => a.name.toLocaleLowerCase('pl').includes(q))
    .map((a) => {
      const ws = history.filter((w) => (w.athleteId ?? '') === a.id);
      const meta = ws.length ? `${ws.length} ${plural(ws.length, 'trening', 'treningi', 'treningów')} · ostatni ${formatDate(ws[0].date, { day: 'numeric', month: 'short' })}` : 'Brak treningów';
      return `<li><button data-athlete="${esc(a.id)}"><span class="avatar">${esc(initials(a.name))}</span><span class="grow"><div class="title">${esc(a.name)}</div><div class="meta">${meta}</div></span>${icon('chevron')}</button></li>`;
    })
    .join('');
};

const plural = (n, one, few, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

$('athlete-search').addEventListener('input', () => renderers.athletes());

$('add-athlete').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('new-athlete').value.trim();
  if (!name) return;
  addAthlete(name);
  $('new-athlete').value = '';
  renderers.athletes();
});

let shownAthleteId = null;

$('athlete-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-athlete]');
  if (!b) return;
  shownAthleteId = b.dataset.athlete || null;
  go('athlete');
});

renderers.athlete = () => {
  const name = athleteName(shownAthleteId) ?? 'Bez zawodnika';
  $('athlete-avatar').textContent = initials(name);
  $('athlete-name').textContent = name;
  const workouts = workoutsOf(shownAthleteId);

  // progress
  const exercises = [...new Set(workouts.flatMap((w) => w.sets.map((s) => s.exercise)).filter(Boolean))];
  $('progress-card').hidden = exercises.length === 0;
  if (exercises.length) {
    const sel = $('progress-exercise');
    const keep = exercises.includes(sel.value) ? sel.value : exercises[0];
    sel.innerHTML = exercises.map((e) => `<option>${esc(e)}</option>`).join('');
    sel.value = keep;
    renderProgress(workouts);
  }

  // workouts
  $('workout-list').innerHTML = workouts
    .map((w) => {
      const t = workoutTotals(w);
      const meta = [t.exercises.join(', '), `${t.sets} ${plural(t.sets, 'seria', 'serie', 'serii')} · ${t.reps} powt.`].filter(Boolean).map(esc).join(' · ');
      return `<li><button data-workout="${esc(w.id)}"><span class="status-dot ${w.approved ? 'approved' : ''}" title="${w.approved ? 'Zatwierdzony' : 'Niezatwierdzony'}"></span><span class="grow"><div class="title">${formatDate(w.date, { day: 'numeric', month: 'short', year: 'numeric' })}</div><div class="meta">${meta}</div></span>${icon('chevron')}</button></li>`;
    })
    .join('');
  $('workouts-empty').hidden = workouts.length > 0;
};

function renderProgress(workouts = workoutsOf(shownAthleteId)) {
  const exercise = $('progress-exercise').value;
  const loads = [...new Set(workouts.flatMap((w) => w.sets.filter((s) => s.exercise === exercise && s.load).map((s) => s.load)))].sort((a, b) => a - b);
  const loadSel = $('progress-load');
  const keep = loads.includes(+loadSel.value) ? loadSel.value : '';
  loadSel.innerHTML = `<option value="">Każdy ciężar</option>${loads.map((l) => `<option value="${l}">${loadText(l)}</option>`).join('')}`;
  loadSel.value = keep;
  const series = progressSeries(workouts, exercise, keep === '' ? null : +keep);
  if (!series.length) {
    $('progress-chart').innerHTML = '';
    $('progress-text').textContent = 'Brak danych dla tego ciężaru.';
    return;
  }
  $('progress-chart').innerHTML = lineChart(series);
  const first = series[0].value;
  const lastV = series[series.length - 1].value;
  const diff = lastV - first;
  $('progress-text').textContent = series.length > 1
    ? `Najszybsze powtórzenie w treningu. Od pierwszego: ${diff >= 0 ? '+' : ''}${fmt(diff, 2)} m/s (${diff >= 0 ? '+' : ''}${fmt((diff / first) * 100, 0)}%).`
    : `Najszybsze powtórzenie w treningu: ${fmt(lastV, 2)} m/s. Wykres pojawi się po kolejnym treningu.`;
}

$('progress-exercise').addEventListener('change', () => renderProgress());
$('progress-load').addEventListener('change', () => renderProgress());

$('workout-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-workout]');
  if (!b) return;
  summaryId = b.dataset.workout;
  go('summary');
});

// ============================================================ settings

renderers.settings = () => {
  const count = settings.tiles.length;
  $('tile-toggles').innerHTML = Object.entries(METRICS)
    .map(([key, m]) => {
      const on = settings.tiles.includes(key);
      return `<label>${m.label}<input type="checkbox" class="switch" data-tile="${key}" ${on ? 'checked' : ''} ${!on && count >= MAX_TILES ? 'disabled' : ''}></label>`;
    })
    .join('');
  $('direction').value = settings.direction;
  $('loss-warn').value = settings.lossWarnPercent;
  $('set-gap').value = settings.setGapSeconds;
  $('vibrate').checked = settings.vibrate;
  $('beep').checked = settings.beep;
  renderSensorInfo();
};

$('settings').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.tile) {
    settings.tiles = t.checked ? [...settings.tiles, t.dataset.tile].slice(0, MAX_TILES) : settings.tiles.filter((k) => k !== t.dataset.tile);
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
  renderers.settings();
});

const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

// ============================================================ startup

if (!bluetoothAvailable()) {
  $('no-bluetooth').hidden = false;
  $('connect').hidden = true;
}

switchTab('training');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

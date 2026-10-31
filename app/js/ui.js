// Small DOM helpers, icons and SVG charts shared by all screens.
import { fmt } from './settings.js';

export const $ = (id) => document.getElementById(id);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape user-entered text (athlete names, exercises, comments) before putting it into HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const PATHS = {
  bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/>',
  gauge: '<path d="M4 16a8 8 0 1 1 16 0"/><path d="m12 16 4-5"/><circle cx="12" cy="16" r="1.2"/>',
  speed: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  ruler: '<path d="m4 16 12-12 4 4-12 12z"/><path d="m8 12 2 2m1-5 2 2m1-5 2 2"/>',
  trend: '<path d="m3 7 6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  muscle: '<path d="M7 20c-2-3-2-7 1-10l2-5h3l-1 4 3 1c3 1 5 4 4 7l-2 3z"/>',
  barbell: '<path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/>',
  zone: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 8 8"/>',
  training: '<path d="M2 12h20M5 8v8M8 6v12M16 6v12M19 8v8"/>',
  athletes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-4 3.2-6 6.5-6s6 2 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .6 3.3 2.6 3.5 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M4.9 19.1 7 17m10-10 2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  share: '<path d="M12 3v12m-5-7 5-5 5 5M5 14v6h14v-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-8m4 8H3"/>',
};

export const icon = (name, size = 20) =>
  `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? ''}</svg>`;

export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const formatDate = (iso, opts = { dateStyle: 'medium', timeStyle: 'short' }) => new Date(iso).toLocaleString('pl-PL', opts);

// ---------- charts ----------

const RING_R = 88;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Ring gauge. fraction 0..1 is how far the arc goes; tickAt (0..1, optional) marks the zone's lower bound.
 * Arc starts at 12 o'clock and runs clockwise.
 */
export function ring({ fraction, status, tickAt = null }) {
  const len = RING_C * fraction;
  const tick = tickAt === null ? '' : (() => {
    const a = tickAt * 2 * Math.PI - Math.PI / 2;
    const r1 = RING_R - 13;
    const r2 = RING_R + 13;
    return `<line class="ring-tick" x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`;
  })();
  return `<svg viewBox="0 0 200 200" class="ring ${status ?? ''}" aria-hidden="true">
    <circle class="ring-track" cx="100" cy="100" r="${RING_R}"/>
    <circle class="ring-arc" cx="100" cy="100" r="${RING_R}" stroke-dasharray="${len} ${RING_C}" transform="rotate(-90 100 100)"/>
    ${tick}
  </svg>`;
}

/** Vertical bars of mean velocity per rep, labelled with values; zone band drawn behind when given. */
export function barChart(values, { zone = null, statusOf = () => '' } = {}) {
  const w = 320;
  const h = 150;
  const pad = { l: 28, r: 6, t: 18, b: 20 };
  const top = Math.max(...values, zone?.max ?? 0, 0.2) * 1.15;
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / top);
  const step = (w - pad.l - pad.r) / values.length;
  const bw = Math.min(36, step * 0.66);
  const ticks = niceTicks(top);
  const band = zone ? `<rect class="zone-band" x="${pad.l}" width="${w - pad.l - pad.r}" y="${y(Math.min(zone.max, top))}" height="${y(zone.min) - y(Math.min(zone.max, top))}"/>` : '';
  const grid = ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 5}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t, 1)}</text>`).join('');
  const bars = values.map((v, i) => {
    const x = pad.l + step * i + (step - bw) / 2;
    return `<rect class="bar ${statusOf(v)}" x="${x}" y="${y(v)}" width="${bw}" height="${y(0) - y(v)}" rx="3"/>
      <text class="bar-label" x="${x + bw / 2}" y="${y(v) - 5}" text-anchor="middle">${fmt(v, 2)}</text>
      <text class="axis" x="${x + bw / 2}" y="${h - 5}" text-anchor="middle">${i + 1}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Prędkość średnia w kolejnych powtórzeniach">${band}${grid}${bars}</svg>`;
}

/** Line chart of a time series [{date, value}], oldest first. */
export function lineChart(points) {
  const w = 320;
  const h = 170;
  const pad = { l: 30, r: 10, t: 14, b: 24 };
  const vals = points.map((p) => p.value);
  const lo = Math.max(0, Math.min(...vals) - 0.1);
  const hi = Math.max(...vals) + 0.1;
  const x = (i) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : ((w - pad.l - pad.r) * i) / (points.length - 1));
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - lo) / (hi - lo));
  const ticks = niceTicks(hi, lo);
  const grid = ticks.map((t) => `<line class="grid" x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${pad.l - 5}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t, 1)}</text>`).join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z`;
  const labelEvery = Math.ceil(points.length / 5);
  const labels = points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1
    ? `<text class="axis" x="${x(i)}" y="${h - 6}" text-anchor="middle">${formatDate(p.date, { day: 'numeric', month: 'short' })}</text>` : '')).join('');
  const dots = points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="3.5"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="Postęp prędkości w czasie">${grid}<path class="area" d="${area}"/><path class="line" d="${line}"/>${dots}${labels}</svg>`;
}

function niceTicks(hi, lo = 0) {
  const span = hi - lo;
  const step = span > 1.2 ? 0.5 : span > 0.5 ? 0.2 : 0.1;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

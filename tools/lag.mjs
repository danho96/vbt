import { readFileSync } from 'node:fs';
import { parsePacket, hexToDataView } from '../app/js/protocol.js';
const { packets } = JSON.parse(readFileSync('app/demo/recording.json', 'utf8'));
const s = packets.flatMap((h) => parsePacket(hexToDataView(h)).samples);
const p = s.map((x) => x[0]), b = s.map((x) => x[1]);
const k = 2, d = p.map((_, i) => (i < k || i >= p.length - k ? 0 : ((p[i + k] - p[i - k]) / (2 * k)) * 100));
for (let lag = 0; lag <= 12; lag += 2) {
  let num = 0, den1 = 0, den2 = 0;
  for (let i = 20; i < p.length - 20; i++) { num += d[i] * b[i + lag]; den1 += d[i] ** 2; den2 += b[i + lag] ** 2; }
  let scale = 0; { let n = 0, m = 0; for (let i = 20; i < p.length - 20; i++) { n += d[i] * b[i + lag]; m += b[i + lag] ** 2; } scale = n / m; }
  console.log(`lag ${lag} samples: corr=${(num / Math.sqrt(den1 * den2)).toFixed(3)} d/b scale=${scale.toFixed(2)}`);
}
console.log('peak derived', Math.max(...d).toFixed(0), 'peak B', Math.max(...b));

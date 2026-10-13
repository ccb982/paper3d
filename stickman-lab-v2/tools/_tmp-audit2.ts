import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const g = globalThis as any;
g.__WRITELOG = [];
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
// 不播动作：纯双腿站立
const body = w.body as any;
let cleared = false;
for (let s = 0; s < Math.round(1.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 0.2 && !cleared) { g.__WRITELOG = []; cleared = true; }
  if (t > 0.5) break;
}
const log: any[] = g.__WRITELOG;
console.log('double-leg writes in 0.2-0.5s:', log.length);
const byDof = new Map<number, Map<string, { n: number; mx: number; src: string }>>();
for (const [fr, di, kind, v, st] of log) {
  if (!byDof.has(di)) byDof.set(di, new Map());
  const m = byDof.get(di)!;
  if (!m.has(kind)) m.set(kind, { n: 0, mx: 0, src: '' });
  const rec = m.get(kind)!;
  rec.n++;
  if (Math.abs(v) > Math.abs(rec.mx)) {
    rec.mx = v;
    const frames = String(st).split('|');
    const fn = frames.map((x: string) => /ats+([w.$]+)/.exec(x)?.[1] ?? '').filter((x: string) => x && !/^Drive.|^Object./.test(x));
    rec.src = (fn.slice(0, 3).join('<') || '').slice(0, 60);
  }
}
for (const [di, m] of byDof) {
  const parts: string[] = [];
  for (const [k, r] of m) parts.push(k + 'x' + r.n + '(mx' + r.mx.toFixed(0) + ')@' + r.src);
  console.log((body.dofs[di]?.name + '/' + body.dofs[di]?.axis).padEnd(12), parts.join('  '));
}

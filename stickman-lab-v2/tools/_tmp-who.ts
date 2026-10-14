import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
(globalThis as any).__WRITELOG = [];
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
for (let s = 0; s < Math.round(3.3 / w.dt); s++) w.advance(1);
const log = (globalThis as any).__WRITELOG as Array<[number, number, string, number, string]>;
const targets: Array<[string, number, number]> = [];
for (const [n, ax] of [['spine1',0],['spine2',0],['spine3',0],['hip_r',0],['hip_l',0],['foot_r',0],['shoulder_l',0],['shoulder_r',0],['arm_l',0],['arm_r',0]] as Array<[string, number]>) {
  const di = body.dofByName(n, ax);
  if (di >= 0) targets.push([n, ax, di]);
}
const agg = new Map<string, { n: number; sum: number }>();
for (const [fr, di, kind, v, st] of log) {
  const t = fr * w.dt;
  if (t < 1.8 || t > 2.4) continue;
  const tg = targets.find(x => x[2] === di);
  if (!tg) continue;
  const key = tg[0] + '/' + tg[1] + ' | ' + kind + ' | ' + String(st).split('|').map((f: string) => f.replace(/.*bundle\.mjs/, '').trim()).slice(0, 5).join(' << ') || '(no-stack)';
  const e = agg.get(key) || { n: 0, sum: 0 };
  e.n++; e.sum += v;
  agg.set(key, e);
}
const rows = Array.from(agg.entries()).map(([k, e]) => ({ k, n: e.n, mean: e.sum / e.n, sum: e.sum }));
rows.sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
console.log('写手排行(按|累计|降序, t∈2.0-3.2s):');
for (const r of rows.slice(0, 22)) {
  
  if (r.sum > 0 && r.k.includes('torque')) console.log((r.sum >= 0 ? '+' : '') + r.sum.toFixed(0).padStart(6), '| mean=' + r.mean.toFixed(2).padStart(6), '|', r.k);
  else if (!r.k.includes('torque')) console.log((r.sum >= 0 ? '+' : '') + r.sum.toFixed(0).padStart(6), '| n=' + String(r.n).padStart(4), '| mean=' + r.mean.toFixed(2).padStart(6), '|', r.k.slice(0, 60));
}

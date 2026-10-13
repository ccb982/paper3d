import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const g = globalThis as any;
g.__WRITELOG = [];
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.65 && t < 2.80) g.__WRITELOG = [];   // 只留抬腿窗
}
const log: any[] = g.__WRITELOG;
console.log('writes in lift window:', log.length);
const byDof = new Map<number, Map<string, { n: number; mx: number; src: string }>>();
for (const [fr, di, kind, v, st] of log) {
  const name = body.dofs[di]?.name + '/' + body.dofs[di]?.axis;
  if (!byDof.has(di)) byDof.set(di, new Map());
  const m = byDof.get(di)!;
  const key = kind;
  if (!m.has(key)) m.set(key, { n: 0, mx: 0, src: '' });
  const rec = m.get(key)!;
  rec.n++;
  if (Math.abs(v) > Math.abs(rec.mx)) {
    rec.mx = v;
    const line = String(st).split('|').find((x: string) => x.includes('stickman') || x.includes('src')) ?? '';
    rec.src = line.trim().slice(0, 90);
  }
}
for (const [di, m] of byDof) {
  const name = body.dofs[di]?.name + '/' + body.dofs[di]?.axis;
  const parts: string[] = [];
  for (const [k, r] of m) parts.push(k + '×' + r.n + '(max' + r.mx.toFixed(0) + ')@' + r.src.split(/[\/]/).pop());
  console.log(name.padEnd(12), parts.join('  '));
}

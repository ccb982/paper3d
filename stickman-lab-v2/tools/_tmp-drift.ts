import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const rev = new Map<number, string>();
for (const [k, i] of (w.body as any).indexByKey as Map<string, number>) rev.set(i, k);
const groups: Record<string, string[]> = { 摆腿L: [], 支腿R: [], 躯干: [], 臂: [] };
for (const [i, k] of rev) {
  if (/(thigh|shin|foot)_l/.test(k)) groups['摆腿L']!.push(k);
  else if (/(thigh|shin|foot)_r/.test(k)) groups['支腿R']!.push(k);
  else if (/spine|pelvis|chest|head|neck/.test(k)) groups['躯干']!.push(k);
  else if (/arm|shoulder|forearm|hand/.test(k)) groups['臂']!.push(k);
}
console.log('t      总comZ   [各段 z / v_z]');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.3 || t > 4.05) continue;
  if (Math.round(t * 20) % 1 !== 0 && t - (globalThis as any).__pt < 0.05) continue;
  (globalThis as any).__pt = t;
  const out: string[] = [];
  for (const g of ['摆腿L', '支腿R', '躯干', '臂']) {
    let mz = 0, m = 0, pz = 0;
    for (const k of groups[g]!) {
      const b = w.body.bodies[(w.body as any).indexByKey.get(k)!]!;
      mz += b.mass() * b.worldCom().z; m += b.mass();
      pz += b.mass() * b.linvel().z;
    }
    out.push(m > 0 ? `${(mz / m).toFixed(2)} v=${(pz / m).toFixed(2)}` : '-');
  }
  console.log(`${t.toFixed(1)}  ${ctl.sensors.com[2]!.toFixed(3)}  ` + out.join('  '));
}

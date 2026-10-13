import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const F = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return ' n/a';
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return ' ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4);
};
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('t | footR2距矩 | footR2角 | 支撑fz(W%) | 踝τmax | kneeR2 | hipR2 | 腰前倾');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const W = body.sk.massTotal * 9.81;
    const fz = ctl.sensors.feet[1]!.fz / W * 100;
    const di2 = body.dofByName('foot_r', 2);
    const tm = di2 >= 0 ? body.dofs[di2].tauMax : NaN;
    console.log(`${t.toFixed(2)} | ${F('foot_r',2)} | ${A('foot_r',2).toFixed(0).padStart(4)} | ${fz.toFixed(0).padStart(4)} | ${tm.toFixed(0)} | ${F('knee_r',2)} | ${F('hip_r',2)} | ${A('hip_r',2).toFixed(0)}`);
  }
}

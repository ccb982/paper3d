import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const v = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.vel ?? 0) : NaN;
};
console.log('t | f_l/2速 | f_l/1速 | f_l/0速 | 左足载N | CoMy cm');
let boomT = -1;
for (let s = 0; s < Math.round(7.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const vf2 = Math.abs(v('foot_l', 2));
  if (boomT < 0 && vf2 > 30) { boomT = t; console.log(`★★爆炸点 t=${t.toFixed(3)} f_l/2速=${(vf2 * 57.3).toFixed(0)}°/s`); }
  if (s % 8 === 0 && t > 4.5 && t < 6.5) {
    const fl = ctl.sensors.feet[0]!;
    console.log(`${t.toFixed(3)} | ${(v('foot_l', 2) * 57.3).toFixed(0)} | ${(v('foot_l', 1) * 57.3).toFixed(0)} | ${(v('foot_l', 0) * 57.3).toFixed(0)} | ${fl.fz.toFixed(0)} | ${(ctl.sensors.com[1]! * 100).toFixed(0)}`);
  }
  if (boomT > 0 && t > boomT + 0.15) break;
}

import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const F = (n: string, ax: number): string => {
  const di = body.dofByName(n, ax);
  if (di < 0) return '  n/a';
  const b = ctl.warner.drive.lastBreakdown[di] as any;
  if (!b) return '  ---';
  const tot = (b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0);
  return tot.toFixed(0).padStart(4);
};
console.log('t | foot z/x/y轴矩 | fz% | CoP z | 足心z | CoM侧余量cm | 踝容量 | 髇余量');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const f = ctl.sensors.feet[1]!;
    const W = body.sk.massTotal * 9.81;
    const bs = balanceScale({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const mg = Math.min(bs.marginLat ?? 0, bs.marginMed ?? 0);
    const cap = Math.max(20, f.fz * 0.09 * 0.8);
    const comZ = ctl.sensors.com[2]! * 100;
    const edge = (f.z + (comZ - f.z * 100 > 0 ? -0.045 : 0.045)) * 100;
    console.log(`${t.toFixed(2)} | ${F('foot_r',2)}/${F('foot_r',1)}/${F('foot_r',0)} | ${(f.fz/W*100).toFixed(0).padStart(4)} | ${(f.copZ*100).toFixed(1).padStart(6)} | ${(f.z*100).toFixed(1).padStart(6)} | ${(mg*100).toFixed(1).padStart(5)} | ${cap.toFixed(0).padStart(5)} | ${(Math.abs(comZ - f.z*100)).toFixed(1)}`);
  }
}

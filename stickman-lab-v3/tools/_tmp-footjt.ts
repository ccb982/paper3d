import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | 关节 | θ | ω | 弹 | 活(柱/反射) | 伺(动作PD) | ff(写手) | 阻');
for (let s = 0; s < Math.round(4.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  for (const [nm, ax] of [['foot_r', 0], ['foot_r', 2], ['ankle_r', 0]] as Array<[string, number]>) {
    const di = body.dofByName(nm, ax);
    if (di < 0) continue;
    const bd = ctl.warner.drive.lastBreakdown[di];
    if (!bd) continue;
    const big = Math.max(Math.abs(bd.act), Math.abs(bd.servo), Math.abs(bd.ff), Math.abs(bd.damp), Math.abs(bd.stiff));
    if (big > 15 && s % 4 === 0) {
      const d = body.dofs[di];
      console.log(`${t.toFixed(2)} | ${nm}/${ax} | ${(d.angle * 57.3).toFixed(1)} | ${(d.vel * 57.3).toFixed(0)} | ${bd.stiff.toFixed(0)} | ${bd.act.toFixed(0)} | ${bd.servo.toFixed(0)} | ${bd.ff.toFixed(0)} | ${bd.damp.toFixed(0)}`);
    }
  }
}

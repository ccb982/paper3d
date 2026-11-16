/** _probe-momreg: momReg internals (owned/a/want/dead) + L.z + shoulder state. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { computeMomentum } from '../src/core/servo/momentum';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const mr = ctl.momReg as unknown as { owned: boolean; a: number };
const body = w.body;
console.log('t      phase      肩Lcmd  肩L角  momReg(owned|a)  Lz      want(death=0.5)  shoulder.hasAngle');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.8 || t > 6.0) continue;
  if (s % Math.round(0.15 / w.dt) !== 0) continue;
  const mm = computeMomentum(body);
  const dL = body.dofByName('shoulder_l', 2);
  const tg = Number.isNaN(w.drive.target[dL]!) ? NaN : w.drive.target[dL]!;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${Number.isNaN(tg) ? '  -' : tg.toFixed(2).padStart(5)} ${(body.dofs[dL]!.angle).toFixed(2).padStart(6)}  [${mr.owned ? 'T' : 'F'}|${mr.a.toFixed(2).padStart(6)}]  ${mm.L.z.toFixed(1).padStart(6)}  ${ctl.warner.manual.hasAngle(dL) ? 'HAS' : '-'}`,
  );
}

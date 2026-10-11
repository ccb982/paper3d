import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dInv = body.dofByName('foot_r', 0);
const dFlex = body.dofByName('foot_r', 2);
console.log('t     相位      支踝inv角 inv τ(账本)  支踝flexτ   pad目标dz  copSide限');
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.6 || t > 5.4) continue;
  if (s % Math.round(0.06 / w.dt) !== 0) continue;
  const bdI = w.drive.lastBreakdown[dInv]!;
  const bdF = w.drive.lastBreakdown[dFlex]!;
  const tgt = (ctl.pad as unknown as { getTarget?: (s: string) => { dz: number } }).getTarget?.('r');
  console.log(`${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${body.dofs[dInv]!.angle.toFixed(3).padStart(7)} ${(bdI.stiff + bdI.servo + bdI.ff + bdI.damp).toFixed(0).padStart(6)}  ${(bdF.stiff + bdF.servo + bdF.ff + bdF.damp).toFixed(0).padStart(6)}  ${tgt ? tgt.dz.toFixed(3) : '  -'}  ${(ctl.pad as unknown as { opt?: { copSide?: number } }).opt?.copSide}`);
}

/** _probe-support-foot.ts —— 承重脚全链受力回读 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t    相位       Rfz%   CoP_R  CoP范围  踝跖屈/τmax  踝内外翻τ  膝伸/τmax  髋伸/τmax  髋外展/τmax');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 4.8) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const f = ctl.sensors.feet[1]!;
  const W = w.sk.massTotal * 9.81;
  const g = (n: string, ax: number) => { const i = w.body.dofByName(n, ax); return i < 0 ? '-' : `${w.executor.ledger[i]!.applied.toFixed(0)}/${w.body.dofs[i]!.tauMax}`; };
  const fi = w.body.dofByName('foot_r', 2), ii = w.body.dofByName('foot_r', 0);
  const invT = ii >= 0 ? w.executor.ledger[ii]!.applied.toFixed(0) : '-';
  console.log(
    `${t.toFixed(1)}  ${(ctl.actions.status.phase ?? '-').padEnd(10)} ${(f.fz / W * 100).toFixed(0).padStart(4)}  ` +
    `${f.copZ.toFixed(3).padStart(6)}  ${f.copValid ? 'ok' : '--'}     ${g('foot_r', 2).padStart(10)}  ${invT.padStart(6)}   ` +
    `${g('knee_r', 2).padStart(9)}  ${g('hip_r', 2).padStart(9)}  ${g('hip_r', 0).padStart(9)}`,
  );
  void fi;
}

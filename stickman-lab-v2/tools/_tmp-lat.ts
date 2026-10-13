import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe, modeOf, unifiedActive } from '../src/core/servo/unified';
import { isLiftDone } from '../src/core/servo/supportReg';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | 相位 | tiltRel/速 | CoMz v | 模式 | 髇0矩 | sp0矩 | MoS | fz%');
for (let s = 0; s < Math.round(5.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 36 === 0) {
    const U = observe({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, 'r');
    const um = modeOf(U, isLiftDone());
    const bs = balanceScale({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, 'r');
    const tq = (n: string, ax: number): number => {
      const di = body.dofByName(n, ax);
      const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] as any : null;
      return b ? (b.act + b.servo + b.ff + b.damp) : 0;
    };
    console.log(`${t.toFixed(2)} | ${(ctl.actions.status.phase ?? '?').slice(0, 2)} | ${U.tiltRelDeg.toFixed(0)}/${U.tiltRateDeg.toFixed(0)} | ${(U.comZ * 100).toFixed(0)} ${(U.comVz * 100).toFixed(0)} | ${um} | ${tq('hip_r', 0).toFixed(0)} | ${tq('spine1', 0).toFixed(0)} | ${Math.min(bs.mosMed, bs.mosLat).toFixed(3)} | ${U.fzW.toFixed(0)}`);
  }
}

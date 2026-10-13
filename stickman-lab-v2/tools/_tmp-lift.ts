import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe, modeOf, unifiedActive } from '../src/core/servo/unified';
import { isLiftDone } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('【力矩账】静态需求=fz×CoM偏离;临界=fz×4.5cm(足缘);可用=踝接触约 30/髇 228/腹 156×3');
console.log('t | CoMz v | tilt/速 | 模式成立 | fz% | 髇矩 | 踝矩 | MoS');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && t < 3.1 && s % 8 === 0) {
    const ctx = { bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any;
    const U = observe(ctx, 'r');
    const um = modeOf(U, isLiftDone());
    const act = unifiedActive(U, isLiftDone());
    const br = (n: string, ax: number): number => {
      const di = body.dofByName(n, ax);
      const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] : null;
      return b ? (b.act + b.servo + b.ff + b.damp) : 0;
    };
    console.log(`${t.toFixed(3)} | ${(U.comZ * 100).toFixed(1)} ${(U.comVz * 100).toFixed(0)} | ${U.tiltDeg.toFixed(1)}/${U.tiltRateDeg.toFixed(0)} | ${um}${act ? '✓' : '✗'} | ${U.fzW.toFixed(0)} | ${br('hip_r', 0).toFixed(0)} | ${br('foot_r', 0).toFixed(0)} | ${U.mosMin.toFixed(3)}`);
  }
}

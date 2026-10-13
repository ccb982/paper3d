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
console.log('t | tilt/速 | CoMz v | fz% 对侧% | 模式 成立 | 最弯2节 | 髋矩/腰矩/踝矩 | MoS');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.7 && s % 24 === 0) {
    const ctx = { bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any;
    const U = observe(ctx, 'r');
    const um = modeOf(U, isLiftDone());
    const act = unifiedActive(U, isLiftDone());
    const ch = [...U.chain].sort((a, b) => b.d - a.d).slice(0, 2).map((c) => c.name + ':' + (c.d * 100).toFixed(0)).join(' ');
    const br = (n: string, ax: number): number => {
      const di = body.dofByName(n, ax);
      const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] : null;
      return b ? (b.act + b.servo + b.ff + b.damp) : 0;
    };
    console.log(`${t.toFixed(2)} | ${U.tiltDeg.toFixed(0)}/${U.tiltRateDeg.toFixed(0)} | ${(U.comZ * 100).toFixed(1)} ${(U.comVz * 100).toFixed(0)} | ${U.fzW.toFixed(0)} ${U.otherFzW.toFixed(0)} | ${um} ${act ? '✓' : '✗'} | ${ch} | ${br('hip_r', 0).toFixed(0)}/${br('spine1', 0).toFixed(0)}/${br('foot_r', 0).toFixed(0)} | ${U.mosMin.toFixed(3)}`);
  }
}

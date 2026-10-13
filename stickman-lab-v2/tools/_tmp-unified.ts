import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('统一观测器（三源+谓词）：');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.6 && s % 48 === 0) {
    const u = observe({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, 'r');
    const ch = u.chain.slice(0, 4).map((c) => c.name + ':' + (c.d * 100).toFixed(0)).join(' ');
    console.log(`${t.toFixed(2)} | tilt=${u.tiltDeg.toFixed(1)}° v=${u.tiltRateDeg.toFixed(0)} | CoMz=${(u.comZ * 100).toFixed(1)} v=${(u.comVz * 100).toFixed(0)} | fz=${u.fzW.toFixed(0)}% | 链[${ch}]cm | 谓词: 着地${u.footGrounded ? '✓' : '✗'} 反转${u.waistReversed ? '✓' : '✗'} 平衡${u.balanced ? '✓' : '✗'}`);
  }
}

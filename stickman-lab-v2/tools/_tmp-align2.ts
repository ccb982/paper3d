import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe } from '../src/core/servo/unified';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
let totalSL = 0, saveT = 0, saveMax = 0, cur = 0;
let fakeT = 0;   // \u65f6\u95f4\u88ab\u8ba1\u4f46\u4e0d\u53ef\u6551\uff08\u5047\u8c61\u65f6\u957f\uff09
for (let s = 0; s < Math.round(7.5 / w.dt); s++) {
  w.advance(1);
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const single = fl.loaded !== fr.loaded;
  if (single) {
    totalSL += w.dt;
    const side: 'l' | 'r' = fr.loaded ? 'r' : 'l';
    const U = observe({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, side);
    const bs = balanceScale({ bal: ctl.warner, body: w.body, sensors: ctl.sensors } as any, side);
    // \u53ef\u6551\u5224\u636e\uff1a\u5929\u5e73 recoverable\uff08XcoM \u5728\u652f\u6491\u57df\uff09\u2227 \u59ff\u6001\u5728\u683c\uff08|tilt|\u226420\u00b0\uff09\u2227 \u6293\u5730
    const ok = bs.recoverable && Math.abs(U.tiltDeg) <= 20 && U.footGrounded;
    if (ok) { saveT += w.dt; cur += w.dt; if (cur > saveMax) saveMax = cur; }
    else { cur = 0; fakeT += w.dt; }
  } else { cur = 0; }
}
console.log(`\u5355\u817f\u603b\u65f6\u957f=${totalSL.toFixed(2)}s  \u3010\u53ef\u6551\u7ad9\u7acb\u3011\u7d2f\u8ba1=${saveT.toFixed(2)}s (${(saveT / Math.max(0.01, totalSL) * 100).toFixed(0)}%)  \u6700\u957f\u8fde\u7eed=${saveMax.toFixed(2)}s`);
console.log(`\u5047\u8c61\u65f6\u957f\uff08\u4e0d\u53ef\u6551\u4f46\u5012\u5f97\u6162\uff09=${fakeT.toFixed(2)}s  \u2190 \u65b0\u5224\u636e\u4e0b\u7684"\u771f\u5b9e\u6218\u7ee9"`);
const st = (ctl.warner.drive.stats as any).conflicts;
console.log(`\u51b2\u7a81\u8fdd\u89c4\u603b\u6570=${st}`);

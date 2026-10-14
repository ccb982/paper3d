/** _tmp-roll-trace.ts —— 侧倾走线尸检（用户口径：绝对 roll≤15°、计时从抬脚起）
 *  用法：node tools/run.mjs _tmp-roll-trace
 *  输出：动作开始起每 0.1s 的 roll/pitch/CoMx/支撑脚fz；★=抬腿完成（有效计时起点）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const DEG = 180 / Math.PI;
let tLift = -1, nextMark = 0;
const log: string[] = [];
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const liftNow = tLift < 0 && isLiftDone();
  if (liftNow) tLift = t;
  if (t >= nextMark) {
    const roll = ctl.sensors.torsoTilt[1]! * DEG;
    const pitch = ctl.sensors.torsoTilt[0]! * DEG;
    const cx = ctl.sensors.com[0]! * 100;
    const fz = ctl.sensors.feet[1]!.fz;
    const tag = liftNow ? '★抬腿' : (tLift >= 0 ? `+${(t - tLift).toFixed(1)}s` : '');
    log.push(`t=${t.toFixed(2)}s ${tag.padEnd(7)} roll=${roll.toFixed(1).padStart(6)}° pitch=${pitch.toFixed(1).padStart(6)}° CoMx=${cx.toFixed(1).padStart(6)}cm fzR=${fz.toFixed(0).padStart(4)}`);
    nextMark = Math.round((t + 0.1) * 100) / 100;
  }
  if (tLift >= 0 && t - tLift > 0.9) break;
}
for (const l of log) console.log(l);

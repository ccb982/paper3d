import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const CTX = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const DEG = 57.3;

// 先静置 1s（基础力+回正力站住）
for (let i = 0; i < 480; i++) { supportClean(CTX, 'r'); supportClean(CTX, 'l'); w.advance(1); }
console.log('静置后: com=(x' + (ctl.sensors.com[0]! * 100).toFixed(1) + ',z' + (ctl.sensors.com[2]! * 100).toFixed(1) + ') pitch=' + (ctl.sensors.torsoTilt[0]! * DEG).toFixed(1) + '° roll=' + (ctl.sensors.torsoTilt[1]! * DEG).toFixed(1) + '°');

// 启动 idle（含手势/手臂动作）
ctl.actions.play('idle');
console.log('══ 手臂动作轨迹+力矩（肩2/肘2，右臂）══');
const A = (n: string, ax: number): string => {
  const di = w.body.dofByName(n, ax);
  if (di < 0) return '--';
  return `角=${(w.body.dofs[di]!.angle * DEG).toFixed(0)}° 力=${w.executor.appliedOf(di).toFixed(0)}`;
};
for (let s = 0; s < 1920; s++) {
  supportClean(CTX, 'r'); supportClean(CTX, 'l');
  w.advance(1);
  if (s % 120 === 0) {
    console.log(`t=${(s / 480).toFixed(2)}s ${A('shoulder_r', 2)} ${A('elbow_r', 2)} | com=(x${(ctl.sensors.com[0]! * 100).toFixed(1)},z${(ctl.sensors.com[2]! * 100).toFixed(1)}) p=${(ctl.sensors.torsoTilt[0]! * DEG).toFixed(1)}° r=${(ctl.sensors.torsoTilt[1]! * DEG).toFixed(1)}°`);
  }
}

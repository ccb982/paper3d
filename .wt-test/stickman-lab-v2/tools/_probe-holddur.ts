/** _probe-holddur —— 实际单腿平衡保持时长（用户成功标准：1~2s）。
 *  口径：B 相抬腿结束（双脚变单脚）→ CoM 出界（marginZ<-0.02 或 |comX-支撑|>0.10）的时刻。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

let liftEnd = -1, outT = -1;
const supChest0: number[] = [];
for (let s = 0; s < Math.round(8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '-';
  const fzR = ctl.sensors.feet[1]!.fz;
  const W = w.body.sk.massTotal * 9.81;
  if (liftEnd < 0 && ph === 'C保持' && t > 3.5) liftEnd = t;   // 抬腿完成=进 C 相
  if (liftEnd > 0 && outT < 0) {
    const marginZ = ctl.warner.supportState.marginZ;
    const chest = w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
    supChest0.push(chest);
    if (marginZ < -0.02 || chest < 1.1 || fzR < 0.05 * W) outT = t;
  }
}
const chestMin = Math.min(...supChest0);
console.log(`抬腿完成 t≈${liftEnd.toFixed(2)}s`);
console.log(outT > 0 ? `平衡保持 = ${(outT - liftEnd).toFixed(2)}s（其后出界/崩塌）` : '未出界');
console.log(`保持段胸最低 = ${chestMin.toFixed(3)}`);

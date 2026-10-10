/** 临时：后倾直读 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const ang = (n: string, ax: number) => { const i = w.body.dofByName(n, ax); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
console.log('t     相位       躯干pitch 脊2总   髋R屈  膝R    踝R    髋L屈  膝L    脚L高   comX');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.55 || t > 4.6) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const sp = ang('spine1', 2) + ang('spine2', 2) + ang('spine3', 2);
  console.log(
    `${t.toFixed(1)}  ${(ctl.actions.status.phase ?? '-').padEnd(10)} ${ctl.sensors.torsoTilt[0]!.toFixed(3).padStart(8)} ` +
    `${sp.toFixed(2).padStart(6)} ${ang('hip_r', 2).toFixed(2).padStart(6)} ${ang('knee_r', 2).toFixed(2).padStart(6)} ` +
    `${ang('foot_r', 2).toFixed(2).padStart(6)} ${ang('hip_l', 2).toFixed(2).padStart(6)} ${ang('knee_l', 2).toFixed(2).padStart(6)} ${(ctl.sensors.feet[0]!.y - 0.07).toFixed(3).padStart(6)} ${ctl.sensors.com[0]!.toFixed(3).padStart(6)}`,
  );
}
// 追加：谁在写 spine 轴2（检查 fold 挂起状态与 sagittalStab 输出）

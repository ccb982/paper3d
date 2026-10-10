import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { qRotateVec, type Quat } from '../src/core/quat';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const dF = body.dofByName('foot_l', 2);
const fi = body.indexByKey.get('foot_l') ?? 0;
const si = body.indexByKey.get('shin_l') ?? 0;
const tmp = new Float64Array(3);
const pitch = (i: number): number => {
  const q = body.bodies[i]!.rotation() as unknown as Quat;
  qRotateVec(q, 1, 0, 0, tmp);
  return Math.atan2(-tmp[1]!, tmp[0]!) * 180 / Math.PI;   // 局部 +x 的俯仰（+ = 前下?）
};
console.log('t     相位      踝cmd  踝实际  踝dofkp  脚体pitch°  胫pitch°  脚fz');
for (let s = 0; s < Math.round(5.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.6) continue;
  if (s % Math.round(0.08 / w.dt) !== 0) continue;
  const tg = w.drive.target[dF]!;
  console.log(`${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${Number.isNaN(tg) ? ' -' : tg.toFixed(2).padStart(5)} ${body.dofs[dF]!.angle.toFixed(2).padStart(6)}  ${w.drive.kp[dF]!.toFixed(0).padStart(5)}  ${pitch(fi).toFixed(1).padStart(8)} ${pitch(si).toFixed(1).padStart(8)}  ${ctl.sensors.feet[0]!.fz.toFixed(0).padStart(5)}`);
}

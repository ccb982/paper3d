/**
 * _calib.ts —— 关节正方向标定（写 actions.ts 前必须做）
 * 逐个给关节 +0.3rad 角目标，打印胸腔/头/脚的位移方向与关节读数。
 */
import './_boot';
import { World } from '../src/core/world';
import { StabilityWarner } from '../src/core/stability';

function probe(label: string, j: string, axis: number, rad: number): void {
  const w = new World();
  const bal = new StabilityWarner(w, { gravityComp: true, comKp: 0, comKd: 0 });
  w.controller = bal;
  w.reset();
  const i = w.body.dofByName(j, axis);
  const chest = w.body.indexByKey.get('spine2') ?? 0;
  const head = w.body.indexByKey.get('head') ?? 0;
  const footL = w.body.indexByKey.get('foot_l') ?? 0;
  const footR = w.body.indexByKey.get('foot_r') ?? 0;
  const x0 = w.body.bodies[chest]!.translation().x;
  const hx0 = w.body.bodies[head]!.translation().x;
  const hy0 = w.body.bodies[head]!.translation().y;
  for (let s = 0; s < 120; s++) {
    if (i >= 0) bal.manual.setAngle(j, axis, rad);
    w.advance(1);
  }
  const ang = i >= 0 ? w.body.dofs[i]!.angle * 180 / Math.PI : NaN;
  console.log(`${label.padEnd(22)} 关节${(j + '/' + axis).padEnd(11)} 实测角=${ang.toFixed(2).padStart(8)}°  胸Δx=${(w.body.bodies[chest]!.translation().x - x0).toFixed(4).padStart(8)}  头Δx=${(w.body.bodies[head]!.translation().x - hx0).toFixed(4).padStart(8)}  头Δy=${(w.body.bodies[head]!.translation().y - hy0).toFixed(4).padStart(8)}  FzL=${w.body.footNormalForce('l', w.dt).toFixed(0)}  FzR=${w.body.footNormalForce('r', w.dt).toFixed(0)}  footL_y=${w.body.bodies[footL]!.translation().y.toFixed(3)}  footR_y=${w.body.bodies[footR]!.translation().y.toFixed(3)}`);
}

console.log('════ 关节正方向标定（重力补偿ON，CoM控制OFF，1s）════');
console.log(`体重 = ${(new World().sk.massTotal * 9.81).toFixed(0)} N`);
probe('髋屈伸 +', 'hip_l', 2, +0.3);
probe('髋屈伸 −', 'hip_l', 2, -0.3);
probe('脊柱屈伸 +', 'spine1', 2, +0.3);
probe('脊柱屈伸 −', 'spine1', 2, -0.3);
probe('膝屈伸 +', 'knee_l', 2, +0.5);
probe('膝屈伸 −', 'knee_l', 2, -0.5);
probe('颈屈伸 +', 'neck', 2, +0.3);
probe('踝屈伸 +', 'foot_l', 2, +0.2);
probe('踝屈伸 −', 'foot_l', 2, -0.2);
probe('髋外展 +', 'hip_l', 0, +0.3);
probe('髋外展 −', 'hip_l', 0, -0.3);
probe('肩屈伸 +', 'shoulder_l', 2, +0.3);

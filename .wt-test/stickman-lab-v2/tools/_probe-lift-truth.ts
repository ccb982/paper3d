/** _probe-lift-truth —— 抬腿真相探针（用户要求）：
 *  ① 脚是否真离地：鞋底**最低点**（旋转后的鞋底四角，不是脚体原点）；
 *  ② 配重策略是否生效：comTarget.z 是否随 footZ 变化（对照 counterbalanceZ 原始输出）；
 *  ③ 上身是否在垮：胸/骨盆高度 + 支撑腿膝角 + CoM。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { counterbalanceZ, swingLegCoM } from '../src/core/step/stanceBalance';
import { qRotateVec, type Quat } from '../src/core/quat';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const fi = body.indexByKey.get('foot_l') ?? -1;
const chestI = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3') ?? 0;
const pelvisI = body.indexByKey.get('torso') ?? 0;
const kneeSup = body.dofByName('knee_r', 2);

/** 鞋底最低点 y：脚体原点 + 旋转四角（半长 0.14、鞋底面 −0.068、半宽 0.05） */
const tmp = new Float64Array(3);
function soleLowY(): number {
  const b = body.bodies[fi]!;
  const p = b.translation();
  const q = b.rotation() as unknown as Quat;
  let low = Infinity;
  for (const sx of [-0.14, 0.14]) {
    for (const sz of [-0.05, 0.05]) {
      qRotateVec(q, sx, -0.068, sz, tmp);
      const y = p.y + tmp[1]!;
      if (y < low) low = y;
    }
  }
  return low;
}

console.log('t     相位      脚L原点y 鞋底最低y 离地cm  Lfz%  胸y    骨盆y  支膝角 摆髋ab角 comZ   目标z   配重项  脚Lz   腿CoMdz');
let restZ = NaN;
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (Number.isNaN(restZ) && t > 0.3) restZ = ctl.sensors.feet[0]!.z;
  if (t < 3.4 || t > 5.2) continue;
  if (s % Math.round(0.08 / w.dt) !== 0) continue;
  const ph = ctl.actions.status.phase ?? '-';
  const f = ctl.sensors.feet[0]!;
  const W = body.sk.massTotal * 9.81;
  const tgt = ctl.warner.getComTarget();
  const cb = Number.isNaN(restZ) ? NaN : counterbalanceZ(f.z, restZ);
  const lg = (name: string) => {
    const i = body.indexByKey.get(name);
    if (i === undefined) return null;
    const b = body.bodies[i]!;
    const tt = b.translation();
    return { m: b.mass(), x: tt.x, z: tt.z };
  };
  const lc = swingLegCoM(lg, 'l');
  const legDz = lc && !Number.isNaN(restZ) ? lc.z - ((globalThis as { __lrz?: number }).__lrz ?? lc.z) : 0;
  if (t > 0.3 && (globalThis as { __lrz?: number }).__lrz === undefined && lc) (globalThis as { __lrz?: number }).__lrz = lc.z;
  console.log(
    `${t.toFixed(2)}  ${ph.padEnd(9)} ${f.y.toFixed(3)}   ${soleLowY().toFixed(3)}   ${(soleLowY() * 100).toFixed(1).padStart(5)} ${(f.fz / W * 100).toFixed(0).padStart(4)}  ` +
    `${body.bodies[chestI]!.translation().y.toFixed(3)}  ${body.bodies[pelvisI]!.translation().y.toFixed(3)}  ${body.dofs[kneeSup]!.angle.toFixed(2).padStart(5)} ${body.dofs[body.dofByName('hip_l', 0)]!.angle.toFixed(2).padStart(6)}  ` +
    `${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${tgt.z.toFixed(3).padStart(6)} ${Number.isNaN(cb) ? '  -' : cb.toFixed(4).padStart(7)}  ${f.z.toFixed(2)}  ${legDz.toFixed(4).padStart(7)}`,
  );
}

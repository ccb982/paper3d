/** _probe-toe —— 脚尖专门回读（用户要求）：鞋底四角世界坐标 + 最低点 = 真实离地间隙。 */
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
const fi = body.indexByKey.get('foot_l') ?? -1;
const tmpX = new Float64Array(3), tmpY = new Float64Array(3), tmpZ = new Float64Array(3);
/** 鞋底四角：局部 (±半长0.14, 鞋底-0.078, ±半宽0.05) */
function corners(): { pts: Array<{ x: number; y: number; z: number }>; minY: number; toe: { x: number; y: number }; heel: { x: number; y: number } } {
  const b = body.bodies[fi]!;
  const p = b.translation();
  const q = b.rotation() as unknown as Quat;
  const pts: Array<{ x: number; y: number; z: number }> = [];
  for (const sx of [-0.14, 0.14]) {
    for (const sz of [-0.05, 0.05]) {
      qRotateVec(q, sx, -0.078, sz, tmpX);
      pts.push({ x: p.x + tmpX[0]!, y: p.y + tmpX[1]!, z: p.z + tmpX[2]! });
    }
  }
  let minY = Infinity;
  let toe = pts[0]!, heel = pts[0]!;
  for (const pt of pts) {
    if (pt.y < minY) minY = pt.y;
    // ★ 修正（2026-10 末）：脚体局部 +x = **脚跟方向**，趾尖在局部 −x！
    if (pt.x < toe.x) toe = pt;
    if (pt.x > heel.x) heel = pt;
  }
  return { pts, minY, toe, heel };
}

console.log('t     相位      脚原点y  鞋底最低y(离地cm)  趾端y    跟端y   脚fz');
for (let s = 0; s < Math.round(6.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 5.4) continue;
  if (s % Math.round(0.08 / w.dt) !== 0) continue;
  const f = ctl.sensors.feet[0]!;
  const c = corners();
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${f.y.toFixed(3)}   ${c.minY.toFixed(3)} (${(c.minY * 100).toFixed(1).padStart(5)})  ` +
    `${c.toe.y.toFixed(3).padStart(6)}  ${c.heel.y.toFixed(3).padStart(6)}  ${f.fz.toFixed(0).padStart(5)}`,
  );
}

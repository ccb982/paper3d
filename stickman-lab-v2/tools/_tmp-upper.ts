import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const UB = ['torso', 'spine4', 'spine3', 'spine2', 'head', 'neck'];
const info = (): { roll: number; pitch: number; yaw: number; wx: number; wy: number; wz: number; comZ: number } => {
  // 上身合成旋转（质量加权）
  let q0 = { w: 0, x: 0, y: 0, z: 0 }; let mm = 0; let cz = 0;
  for (const k of UB) {
    const ix = body.indexByKey.get(k);
    if (ix === undefined) continue;
    const b = body.bodies[ix];
    const m = b.mass();
    const q = b.rotation();
    const sgn = q.w >= 0 ? 1 : -1;
    q0 = { w: q0.w + sgn * q.w * m, x: q0.x + sgn * q.x * m, y: q0.y + sgn * q.y * m, z: q0.z + sgn * q.z * m };
    mm += m;
    cz += b.translation().z * m;
  }
  const qn = Math.hypot(q0.w, q0.x, q0.y, q0.z) || 1;
  const q = { w: q0.w / qn, x: q0.x / qn, y: q0.y / qn, z: q0.z / qn };
  // up 向量倾角
  const upx = 2 * (q.x * q.y - q.w * q.z);
  const upy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const upz = 2 * (q.y * q.z + q.w * q.x);
  const roll = Math.atan2(upz, upy) * 57.3;
  const pitch = Math.atan2(-upx, upy) * 57.3;
  const yaw = Math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3;
  const ix = body.indexByKey.get('torso');
  const av = ix !== undefined ? body.bodies[ix].angvel() : { x: 0, y: 0, z: 0 };
  return { roll, pitch, yaw, wx: av.x * 57.3, wy: av.y * 57.3, wz: av.z * 57.3, comZ: cz / Math.max(1e-9, mm) * 100 };
};
console.log('t | 上身roll | 上身pitch | 上身yaw | ωx | ωy | ωz | UBcomZ');
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const d = info();
    console.log(`${t.toFixed(2)} | ${d.roll.toFixed(0).padStart(6)} | ${d.pitch.toFixed(0).padStart(6)} | ${d.yaw.toFixed(0).padStart(6)} | ${d.wx.toFixed(0).padStart(4)} | ${d.wy.toFixed(0).padStart(4)} | ${d.wz.toFixed(0).padStart(4)} | ${d.comZ.toFixed(1).padStart(6)}`);
  }
}

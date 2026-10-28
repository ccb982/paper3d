/** _tmp-freeze-body: 冻结期「48° 大腿拧转」的归属分解
 *
 *  目的：把 Δ大腿yaw 拆成
 *      Δ大腿yaw = Δ躯干yaw（父级带动） + Δ大腿相对躯干（髋环自身拧）
 *  并同时看躯干/骨盆的侧倾与横移（用户：'法庭的时候腿就开始侧偏了'）
 *
 *  yaw 定义：刚体局部 +X 轴在世界系的水平偏航 atan2(x, z)，0=+z(左)，90=+x(前)
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const localX = (key: string): { x: number; y: number; z: number } => {
  const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
  return {
    x: 1 - 2 * (q.y * q.y + q.z * q.z),
    y: 2 * (q.x * q.y + q.w * q.z),
    z: 2 * (q.x * q.z - q.w * q.y),
  };
};
const yaw = (key: string): number => { const v = localX(key); return Math.atan2(v.x, v.z) * D; };
/** 局部 +X 的水平分量指向：+1 = 偏 +x(前)，−1 = 偏 −x(后) */
const pitchSign = (key: string): number => Math.sign(localX(key).x) || 1;
const rollDeg = (key: string): number => {
  const v = localX(key);
  return Math.atan2(v.z, v.y) * D;   // 局部 +X 的侧倾（相对竖直面）
};
const anch = (nm: string, ax: number): { x: number; y: number; z: number } => {
  const a = body.dofs[body.dofByName(nm, ax)]!.anchorWorld;
  return { x: a[0]!, y: a[1]!, z: a[2]! };
};

console.log('\n════ 冻结期 全身朝向分解 ════');
console.log('  t   | 躯干yaw 躯干roll | 大腿yawL 大腿rollL | 小腿yawL | 相对躯干Δ | 髋z   膝z   踝z  | CoMz  | 躯干z');
const snap = (t: number): void => {
  const h = anch('hip_l', 2), k = anch('knee_l', 2), a = anch('foot_l', 2);
  const ty = yaw('torso'), tR = rollDeg('torso');
  const th = yaw('thigh_l'), sh = yaw('shin_l');
  console.log(
    ` ${t.toFixed(2)} | ${ty.toFixed(1).padStart(7)} ${tR.toFixed(1).padStart(8)} |` +
    ` ${th.toFixed(1).padStart(7)} ${rollDeg('thigh_l').toFixed(1).padStart(9)} | ${sh.toFixed(1).padStart(7)} |` +
    ` ${(th - ty).toFixed(1).padStart(8)} |` +
    ` ${(h.z * 100).toFixed(1).padStart(5)} ${(k.z * 100).toFixed(1).padStart(5)} ${(a.z * 100).toFixed(1).padStart(5)} |` +
    ` ${(ctl.sensors.com[2]! * 100).toFixed(1).padStart(5)} | ${(body.bodies[body.indexByKey.get('torso')!]!.translation().z * 100).toFixed(1).padStart(6)}`,
  );
};
snap(0);
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (Math.abs(t - 0.2) < 1e-6 || Math.abs(t - 1.0) < 1e-6) snap(t);
}
snap(2.0);
console.log('\n★ 「相对躯干Δ」= 大腿yaw − 躯干yaw ⇒ 大腿相对躯干自身的拧转（髋环扭转）');
console.log('★ 躯干roll 正 = 躯干 +X 偏向 +z(左)');

/** _tmp-ankle2: 踝侧向刚力的**位置空间**写法（不依赖法线约定）
 *
 *  B 方案上一版失败原因：脚背法线取错了（脚局部 +Y 不是法线）⇒ 踝面倾 24.4°。
 *  本版改用**纯位置量**：
 *    · 踝在**世界额向**的偏移 = 脚掌中心(foot 刚体原点) 与 踝锚点 的 z 差
 *    · 或者更直接：脚掌**底面**的两个角点在世界 z 上的差（脚掌是否歪）
 *
 *  物理直觉：踝的侧向（内翻/外翻）= 脚掌绕**足底长轴**滚。
 *  在多环链里，用「足底长轴在世界系是否水平」这个**世界几何量**做反馈，
 *  再按轴投影折算成关节角 ⇒ 不泄漏。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process?.env;
const E: Record<string, string> = globalThis.process!.env;
const D = 180 / Math.PI;
const ORIG = { ...E };

/** 脚掌底面长轴在世界系的额向倾角（度）：正 = 脚掌外翻（远离中线） */
const footRoll = (body: any, side: 'l' | 'r'): number => {
  const bi = body.indexByKey.get(`foot_${side}`);
  const rb = body.bodies[bi];
  const q = rb.rotation() as { x: number; y: number; z: number; w: number };
  const t = rb.translation();
  // 脚的局部 +X = 脚尖方向；把它在世界额状面（z）的投影取出来 ⇒ 脚掌长轴的横向分量
  // 局部 +X 的世界向量
  const xx = 1 - 2 * (q.y * q.y + q.z * q.z);
  const xy = 2 * (q.x * q.y + q.z * q.w);
  const xz = 2 * (q.x * q.z - q.y * q.w);
  // 脚掌长轴（+X）绕额状轴 roll ⇒ 用长轴在额状面内的 z 分量 + 脚高差
  void t;
  return Math.atan2(xz, 0) * D;   // 占位，下面用另一个量
};

const run = (mode: 'A' | 'C' | 'D', cfg: Record<string, string> = {}): string => {
  for (const k of Object.keys(E)) delete E[k];
  Object.assign(E, ORIG, cfg);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;
  w.controller = ctl;
  w.reset();
  const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
  const body = w.body;
  const yaw = (key: string): number => {
    const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
    return Math.atan2(1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.z - q.w * q.y)) * D;
  };
  const az = (nm: string): number => body.dofs[body.dofByName(nm, 2)]!.anchorWorld[2]!;
  const ang = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.angle * D;
  // 脚掌「roll」= 踝锚点相对小腿轴的横向偏移（纯位置量）
  const ankleOffset = (side: 'l' | 'r'): number => {
    const k = body.dofs[body.dofByName(`knee_${side}`, 2)]!.anchorWorld;
    const a = body.dofs[body.dofByName(`foot_${side}`, 2)]!.anchorWorld;
    const shankDz = a[2]! - k[2]!;
    const shankDy = a[1]! - k[1]!;
    return Math.atan2(shankDz, -shankDy) * D;   // 小腿的横向倾角
  };
  const t0 = yaw('thigh_l');
  const KA = 30, BA = 2, capA = 40, deadA = 0.5 / 57.3;
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (mode === 'C') continue;
    for (const side of ['l', 'r'] as const) {
      const di = body.dofByName(`foot_${side}`, 0);
      if (di < 0) continue;
      const d = body.dofs[di]!;
      let dev: number;
      if (mode === 'A') {
        dev = -d.angle;
      } else {
        // D：位置空间 —— 用「踝锚点相对小腿轴的横向偏移」当反馈
        //    目标：小腿竖直 ⇒ 偏移 0
        dev = ankleOffset(side) / 0.48;   // 折算（轴偏 29° ⇒ sin29=0.48）
      }
      if (Math.abs(dev) < deadA) continue;
      let tau = KA * dev - BA * d.vel;
      tau = Math.max(-capA, Math.min(capA, tau));
      if (Math.abs(tau) < 1e-6) continue;
      propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'cal.ankle', channel: 'passive' });
    }
  }
  const d = yaw('thigh_l') - t0;
  return `Δ大腿yaw=${d.toFixed(1).padStart(7)} | 踝额状读数 L=${ang('foot_l', 0).toFixed(1).padStart(6)}` +
    ` | 小腿横向倾 L=${ankleOffset('l').toFixed(1).padStart(6)}` +
    ` | 膝vs踝 L=${((az('knee_l') - az('foot_l')) * 100).toFixed(1).padStart(6)} R=${((az('knee_r') - az('foot_r')) * 100).toFixed(1).padStart(6)}` +
    ` | 判死 ${court.fall >= 0 ? court.fall.toFixed(2) : '无'}`;
};

console.log('\n════ 踝侧向刚力：位置空间 vs 角空间 ════');
console.log(`  A 关节读数弹簧        ${run('A')}`);
console.log(`  D 位置空间(小腿横向倾) ${run('D')}`);
console.log(`  C 不加额外弹簧        ${run('C')}`);
console.log(`  A + 关踝前馈          ${run('A', { SQC_ANKLE_FF: '0' })}`);
console.log(`  D + 关踝前馈          ${run('D', { SQC_ANKLE_FF: '0' })}`);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);
void footRoll;

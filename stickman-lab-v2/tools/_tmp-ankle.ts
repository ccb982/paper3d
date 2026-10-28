/** _tmp-ankle: 踝的「侧向被动刚力」该怎么写
 *
 *  用户（2026-10-28）：「缺乏踝的侧向回正或者被动张力，现在踝是随便偏移的」
 *                      「踝的被动刚力和回正力属于两种东西，但小腿腿偏了都要发力」
 *
 *  已实测（_tmp-sag.ts）：踝额状轴世界轴 = [0.873,−0.488,0] ⇒ **偏水平 29°**
 *    ⇒ 绕它做「角度弹簧」⇒ 额状力矩泄漏成矢状力矩 ⇒ 拧大腿
 *      （开踝被动 Δ大腿yaw 35.3° / 关掉 0.8°）
 *
 *  本探针测三种踝被动刚力写法：
 *    A. 关节读数弹簧（当前）：dev = 0 − d.angle
 *    B. 几何弹簧：dev = 踝面(world)偏离竖直的角度  ← 纯额状、不泄漏
 *    C. 关掉（对照）
 *  指标：Δ大腿yaw（冻结期）、踝额状读数、膝vs踝（竖直度）、判死
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

/** 踝面（脚背法线）相对世界竖直的额向倾角（度）：正 = 脚掌外翻方向 */
const ankleTilt = (body: any, side: 'l' | 'r'): number => {
  const bi = body.indexByKey.get(`foot_${side}`);
  const q = body.bodies[bi].rotation() as { x: number; y: number; z: number; w: number };
  // 脚的局部 +Y = 脚背法线（近似）；把它投影到世界额状面（z 分量）
  const nx = 2 * (q.x * q.y + q.w * q.z);
  const ny = 1 - 2 * (q.x * q.x + q.z * q.z);
  const nz = 2 * (q.y * q.z - q.w * q.x);
  return Math.atan2(nz, ny) * D;
};

const run = (mode: 'A' | 'B' | 'C', cfg: Record<string, string> = {}): string => {
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
  const t0 = yaw('thigh_l');
  const KA = 30, BA = 2, capA = 40, deadA = 0.5 / 57.3;
  const steps = Math.round(2.0 / w.dt);
  for (let s = 0; s < steps; s++) {
    supportClean(ctx, 'r'); supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    if (mode === 'C') continue;
    // 写踝额状轴
    for (const side of ['l', 'r'] as const) {
      const di = body.dofByName(`foot_${side}`, 0);
      if (di < 0) continue;
      const d = body.dofs[di]!;
      let dev: number;
      if (mode === 'A') {
        dev = -d.angle;                                   // 关节读数弹簧
      } else {
        // 几何弹簧：踝面偏离竖直的角度 → 折算到关节角
        // 踝额状轴偏水平 29° ⇒ 关节角变化 1° 只产生 sin(29°)=0.48° 的几何变化
        const geom = ankleTilt(body, side);
        const axisTilt = Math.atan2(-0.488, 0.873);       // 弧度，踝额状轴偏水平角
        dev = -geom / Math.max(0.15, Math.sin(Math.abs(axisTilt)));
      }
      if (Math.abs(dev) < deadA) continue;
      let tau = KA * dev - BA * d.vel;
      tau = Math.max(-capA, Math.min(capA, tau));
      if (Math.abs(tau) < 1e-6) continue;
      propose({ dof: di, kind: 'ext', pri: PRI.servo, tau, src: 'cal.ankle', channel: 'passive' });
    }
  }
  const d = yaw('thigh_l') - t0;
  return `Δ大腿yaw=${d.toFixed(1).padStart(7)} | 踝额状读数 L=${ang('foot_l', 0).toFixed(1).padStart(6)} | 踝面倾 L=${ankleTilt(body, 'l').toFixed(1).padStart(6)}` +
    ` | 膝vs踝 L=${((az('knee_l') - az('foot_l')) * 100).toFixed(1).padStart(6)} R=${((az('knee_r') - az('foot_r')) * 100).toFixed(1).padStart(6)}` +
    ` | 判死 ${court.fall >= 0 ? court.fall.toFixed(2) : '无'}`;
};

console.log('\n════ 踝侧向被动刚力：三种写法 ════');
console.log('  （A/B 都在内置写手之外另加一份踝弹簧，验证几何弹簧是否更优）');
console.log(`  A 关节读数弹簧     ${run('A')}`);
console.log(`  B 几何弹簧(踝面竖直) ${run('B')}`);
console.log(`  C 不加额外弹簧     ${run('C')}`);
console.log(`  A + 关踝前馈       ${run('A', { SQC_ANKLE_FF: '0' })}`);
console.log(`  B + 关踝前馈       ${run('B', { SQC_ANKLE_FF: '0' })}`);
console.log(`  B + 关矢状基础力    ${run('B', { SQC_PAIR_OFF: '1' })}`);
for (const k of Object.keys(E)) delete E[k];
Object.assign(E, ORIG);

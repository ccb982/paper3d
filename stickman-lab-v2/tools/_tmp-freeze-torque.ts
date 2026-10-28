/** _tmp-freeze-torque: 冻结期「大腿被拧」的力矩归因
 *
 *  现象（_tmp-freeze-pose2 实测）：
 *    冻结期 0→2s：大腿偏航 yaw 90° → 137°（大腿绕竖直轴**朝中线拧 47°**）
 *                  小腿 yaw 90° → 82°；脚 yaw 65° 不变（外八静偏）
 *    ⇒ 视觉上 = 大腿拧了、膝盖朝向中线 ⇒ 「膝盖内收」
 *
 *  本探针：同时抓
 *    ① 每帧各腿关键 DOF 的**实际施加力矩**（drive.lastBreakdown 汇总）
 *    ② 每帧各腿关键 DOF 的**提案写手**（proposalBus 记录 src + tau）
 *    ③ 姿态量（yaw / 膝踝偏移）
 *  并支持 env 开关对比（关掉某个写手看拧转是否消失）。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const E: Record<string, string> = globalThis.process!.env;

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

const D = 180 / Math.PI;
const yaw = (key: string): number => {
  const q = body.bodies[body.indexByKey.get(key)!]!.rotation() as { x: number; y: number; z: number; w: number };
  const x = 1 - 2 * (q.y * q.y + q.z * q.z);
  const z = 2 * (q.x * q.z - q.w * q.y);
  return Math.atan2(x, z) * D;
};
const anch = (nm: string, ax: number): number => body.dofs[body.dofByName(nm, ax)]!.anchorWorld[2]!;

// 提案日志钩子
const LOG: Array<[number, string, number, string]> = [];
(globalThis as { __PROPLOG?: Array<[number, string, number, string]> }).__PROPLOG = LOG;

const WATCH = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'];
const watchIdx = new Map<number, string>();
for (const nm of WATCH) for (const ax of [0, 1, 2]) {
  const i = body.dofByName(nm, ax);
  if (i >= 0) watchIdx.set(i, `${nm}/${ax}`);
}

console.log(`\n════ 冻结期力矩归因（HIP_STRATEGY=${E.SQC_HIP_STRATEGY ?? '1'} FRONTAL_PASSIVE=${E.SQC_FRONTAL_PASSIVE ?? '1'}）════`);
console.log('  t   | 大腿yawL 小腿yawL | 膝踝L | ' + WATCH.map((n) => n.padStart(8)).join(' ') + ' | 提案写手（关键 DOF）');
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  LOG.length = 0;
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = s * w.dt;
  if (Math.round(t * 10) % 5 !== 0) continue;   // 每 0.1s

  // 各 DOF 实际施加力矩
  const bd = w.drive.lastBreakdown ?? [];
  const tau = (nm: string, ax: number): string => {
    const i = body.dofByName(nm, ax);
    const b = bd[i];
    if (!b) return '-';
    const v = (b.act ?? 0) + (b.itb ?? 0) + (b.lum ?? 0) + (b.servo ?? 0) + (b.ff ?? 0) + (b.damp ?? 0) + (b.stiff ?? 0);
    return v.toFixed(1).padStart(8);
  };
  const cells: string[] = [];
  for (const nm of WATCH) for (const ax of [0, 1]) cells.push(tau(nm, ax));

  // 提案写手
  const srcs = new Map<string, string>();
  for (const [dof, kind, v, src] of LOG) {
    const key = watchIdx.get(dof);
    if (!key) continue;
    if (!/^(hip_l|knee_l)\/(0|1)$/.test(key)) continue;
    const cur = srcs.get(key) ?? '';
    srcs.set(key, `${cur}${src}(${kind}:${v.toFixed(0)}) `);
  }
  const srcTxt = [...srcs.entries()].map(([k, v]) => `${k}=${v}`).join(' | ');

  console.log(
    ` ${t.toFixed(2)} | ${yaw('thigh_l').toFixed(1).padStart(7)} ${yaw('shin_l').toFixed(1).padStart(8)} |` +
    ` ${((anch('knee_l', 2) - anch('foot_l', 2)) * 100).toFixed(1).padStart(5)} | ${cells.join(' ')} | ${srcTxt}`,
  );
}
console.log('\n列顺序：hip_l/0 hip_l/1 hip_r/0 hip_r/1 knee_l/0 knee_l/1 knee_r/0 knee_r/1 foot_l/0 foot_l/1 foot_r/0 foot_r/1（实际施加力矩 N·m）');
console.log('★ 大腿 yaw 增大 = 大腿绕竖直轴朝中线拧（膝盖朝向内）');

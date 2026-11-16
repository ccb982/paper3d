/** probe-erect.ts —— 按用户定义量「回正力」的误差（2026-10-26 原话：**髋水平，脚竖直**）
 *
 *  用户：『纯靠基础力的感觉 / 回正力写手你看了吗 / 回正力的目标就是髋水平，脚竖直』
 *
 *  所以回正误差必须量**世界几何**，不能量关节角：
 *    ① 髋水平 ：`hip_l` 与 `hip_r` 锚点连线的**世界侧倾** = atan2(Δz, Δy)，目标 0°
 *    ② 脚竖直 ：`knee_*` → `foot_*` 锚点（小腿）的**世界侧倾**，目标 0°（左右各一个）
 *    ③ 大腿    ：`hip_*` → `knee_*` 锚点连线的世界侧倾（诊断用，不一定是目标）
 *
 *  ★ 为什么必须量世界角而不是关节角：
 *    关节角 PD 的目标是「释放那一刻的姿势」（`baseAng`），它**没有"竖直"这个概念**。
 *    姿势本身只要不竖直，关节角 PD 就会把身体**锁在一个歪的姿势上**，
 *    表现为"纯靠基础力撑着"——因为回正力根本没在追"正"，只在追"别动"。
 *
 *  用法：node tools/run.mjs probe-erect        （每 0.25 s 一行）
 *        T_END=9 node tools/run.mjs probe-erect
 *        SQC_APPLY=0 ... 关掉申请制做 A/B
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const T_END = Number(ENV.T_END ?? 9);
const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.driveEnabled = true;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState | null;
const body = w.body;
const W = body.sk.massTotal * 9.81;

const anch = (nm: string, ax: number): Float64Array | null => {
  const i = body.dofByName(nm, ax);
  return i >= 0 ? body.dofs[i]!.anchorWorld : null;
};
/** 髋线侧倾（度）：= 世界 YZ 平面内「左髋相对右髋」的抬高角。**0 = 髋水平**（用户目标） */
const hipRoll = (l: Float64Array | null, r: Float64Array | null): number => {
  if (!l || !r) return NaN;
  return Math.atan2(l[1]! - r[1]!, Math.abs(l[2]! - r[2]!)) * 57.3;
};
/** 段落竖直度（度）：从 a 到 b 的侧向偏移 ÷ 竖直跨度。**0 = 竖直**（用户目标：脚竖直） */
const segTilt = (a: Float64Array | null, b: Float64Array | null): number => {
  if (!a || !b) return NaN;
  return Math.atan2(b[2]! - a[2]!, Math.max(1e-6, Math.abs(b[1]! - a[1]!))) * 57.3;
};

console.log('   t(s)  髋线°  胫L°  胫R°  |  股L°  股R°  |  hipy   kneey   | fzL fzR  ξzcm   胸y');
let lastBroke = NaN;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1, () => {});
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  const show = s % Math.round(0.25 / w.dt) === 0;
  if (!show || t < 1.6) continue;
  const hl = anch('hip_l', 2), hr = anch('hip_r', 2);
  const kl = anch('knee_l', 2), kr = anch('knee_r', 2);
  const fl = anch('foot_l', 2), fr = anch('foot_r', 2);
  const fzL = body.footNormalForce('l', w.dt) / W * 100;
  const fzR = body.footNormalForce('r', w.dt) / W * 100;
  const xi = ctl.sensors.com[2]! + ctl.sensors.comVel[2]! / Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
  const hy = hl && hr ? (hl[1]! + hr[1]!) / 2 : NaN;
  const ky = kl && kr ? (kl[1]! + kr[1]!) / 2 : NaN;
  console.log(
    `${t.toFixed(2).padStart(6)} ${hipRoll(hl, hr).toFixed(2).padStart(6)} ${segTilt(kl, fl).toFixed(2).padStart(6)} ${segTilt(kr, fr).toFixed(2).padStart(6)}  |` +
    ` ${segTilt(hl, kl).toFixed(2).padStart(6)} ${segTilt(hr, kr).toFixed(2).padStart(6)}  |` +
    ` ${(hy * 100).toFixed(1).padStart(6)} ${(ky * 100).toFixed(1).padStart(7)}  |` +
    ` ${fzL.toFixed(0).padStart(3)} ${fzR.toFixed(0).padStart(3)} ${(xi * 100).toFixed(1).padStart(6)}  ${(body.bodies[body.indexByKey.get('spine4') ?? 0]!.translation().y).toFixed(3)}`,
  );
  if (court && court.fall >= 0 && !Number.isFinite(lastBroke)) lastBroke = court.fall;
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`\nfall=${court && court.fall >= 0 ? `${court.fall.toFixed(2)}s ${court.reason}` : '未倒'}`);

/**
 * probe-stance.ts —— 蹲姿侧向安全区观测（不改物理，只读）
 *
 *  目的：验证 `stanceObserve()` 算出来的动态安全区是不是**好的预警量**。
 *  判据：`h` 穿零的时刻必须**早于** `court.fall`。如果穿零时人已经倒了，这个量没用。
 *
 *  用法：node tools/run.mjs probe-stance
 *  env：S_SEC=10（放开后时长）  P_EVERY=0.1（打印间隔）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import type { ServoRefs } from '../src/core/servo/supportReg';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { stanceObserve } from '../src/core/servo/stance';

/** 定种子 RNG（同 probe-golden/probe-states）：idle 动作用了 Math.random，不锁就不可复现。 */
{
  let s = 0x9e3779b9;
  Math.random = (): number => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const S_SEC = Number(ENV.S_SEC ?? 10);
const P_EVERY = Number(ENV.P_EVERY ?? 0.25);

const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx: ServoRefs = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;          // 与 main.ts 的 squatcourt 一致
w.controller = ctl;
w.driveEnabled = true;
w.reset();
ctl.resetCourt();
squatResetLimits(w);
const court: CourtState = squatCourtSetup(w, ctl, 2.0);

const W = w.sk.massTotal * 9.81;
const cm = (v: number): string => (v * 100).toFixed(2).padStart(7);

console.log('════ 蹲姿侧向安全区（动态·零标定）════');
console.log('    t(s)   fz%      ξz    zCop   zCop0   reach    h(cm)   |ξz−站心|/reach  τ(s)  踝余量');
console.log('  ──────────────────────────────────────────────────────────────────────────────────────────');

let hZero = -1;
let hZeroWhy = '';
let peakH = -9;
let rHalf = -1;
let rOne = -1;
let hRun = 0;
let rRun = 0;
let nextPrint = -1;

const N = Math.round((court.settle + S_SEC) / w.dt);
for (let s = 0; s < N; s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);

  if (!court.released) continue;

  const fzL = w.body.footNormalForce('l', w.dt);
  const fzR = w.body.footNormalForce('r', w.dt);
  // ★ 没有接触的帧不算：fz≈0 时 reach=0 ⇒ h 假穿零（第一帧就是这么误报的）
  if (fzL + fzR < 0.1 * W) continue;

  const o = stanceObserve(w, ctl);
  if (nextPrint < 0) nextPrint = court.t;
  const fzPct = (100 * (fzL + fzR)) / W;
  const zc = (ctl.sensors.feet[0]!.z + ctl.sensors.feet[1]!.z) / 2;   // 站心
  const drift = Math.abs(o.xiZ - zc);
  const ratio = o.reach > 1e-6 ? drift / o.reach : Number.POSITIVE_INFINITY;

  if (o.h > peakH) peakH = o.h;
  // ★ 去抖：触地那几帧踝力矩瞬间就把小预算用光，reach=0 ⇒ 假穿零。
  //   要求连续 6 帧（12.5ms）才算真穿零。
  if (o.h <= 0) { hRun++; if (hRun === 6 && hZero < 0) { hZero = court.t; hZeroWhy = `ξz=${cm(o.xiZ)} reach=${cm(o.reach)}`; } }
  else hRun = 0;
  if (ratio >= 0.5) { rRun++; if (rRun === 6 && rHalf < 0) rHalf = court.t; }
  else rRun = 0;
  if (ratio >= 1.0 && rOne < 0) rOne = court.t;

  if (court.t >= nextPrint) {
    nextPrint += P_EVERY;
    console.log(
      `  ${court.t.toFixed(2).padStart(7)} ${fzPct.toFixed(0).padStart(4)}% ${cm(o.xiZ)} ${cm(o.zCop)} ` +
      `${cm(o.zCop0)} ${cm(o.reach)} ${cm(o.h)} ${ratio.toFixed(2).padStart(9)}      ` +
      `${Number.isFinite(o.tauMargin) ? o.tauMargin.toFixed(2).padStart(6) : '   inf'} ` +
      `${o.tauRemain.toFixed(1).padStart(6)}`,
    );
  }
  if (court.fall >= 0) break;
}

console.log('  ──────────────────────────────────────────────────────────────────────────────────────────');
console.log('  （ξz / zCop / zCop0 / reach / h 单位都是 **cm**）');
console.log(`  安全区穿零 h≤0 : ${hZero < 0 ? '**从未穿零**（整个蹲姿都在区内）' : `t=${hZero.toFixed(2)}s  (${hZeroWhy})`}`);
console.log(`  比值过 0.5     : ${rHalf < 0 ? '未过' : `t=${rHalf.toFixed(2)}s`}`);
console.log(`  比值过 1.0     : ${rOne < 0 ? '未过' : `t=${rOne.toFixed(2)}s`}`);
console.log(`  哨兵倒 (fall@) : ${court.fall < 0 ? '未倒' : `t=${court.fall.toFixed(2)}s  reason=${court.reason}`}`);
console.log(`  h 峰值         : ${cm(peakH)} cm`);
if (rOne >= 0 && court.fall >= 0) {
  const lead = court.fall - rOne;
  console.log(`  比值预警提前量 : ${lead.toFixed(2)} s  ${lead > 0.2 ? '=> OK：能提前预警' : '=> 太晚'}`);
}
if (hZero < 0 && court.fall >= 0) {
  console.log('  ★★ 重要：h 全程 > 0 但人还是倒了 ⇒ **权限从来没被用完**。');
  console.log('     倒下不是"CoP 权限不够"，是**没人去推**（= 文档里的 P1：DCM 律被丢掉了）。');
}
console.log('');
console.log('读出方式：');
console.log('  · reach = Σ(min(τmax, fz·半脚宽) − 已用)/W，**全是实测值**，没有标定常数。');
console.log('  · h = reach − |ξz − zCop0|，h ≤ 0 表示当前这一瞬间已经没有 CoP 权限去截住发散。');
console.log('  · 若 h 全程 > 0 但人还是倒了 ⇒ 说明"瞬时可达"口径太松，得把差动卸载项加回来。');
console.log('  · 若 h 早早穿零但人还能撑很久 ⇒ 太保守，回正力会一直用大力（可接受，但要知道）。');

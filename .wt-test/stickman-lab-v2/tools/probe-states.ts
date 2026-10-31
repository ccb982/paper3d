/** probe-states.ts —— 多状态回归闸门（删/改任何写手前后都必须跑这个）
 *
 *  用户（2026-10-26）：『有的写手可能是站立要用的，就别动了』
 *                     『删完一个写手必须完整检查蹲下和站立等等』
 *
 *  所以本探针**不替换控制器**——它按 `src/main.ts` 的真实装配来：
 *      new ControlModule → sim.controller = ctl → driveEnabled = true → reset
 *      每帧：supportClean(r) → supportClean(l) → advance(1) → [court] squatFrame
 *  三个阶段各建一个**全新 World**（避免上一阶段的暖启动缓存污染）：
 *      A stand       : 站立 8s（真实站立路径，含 supportClean / drive / stability）
 *      B squat       : 蹲姿法庭 settle 2s → 放开 → 跑到判死或 10s
 *      C squat2stand : 蹲 3s 后 switchPoseState('stand')，再站 4s（验证状态切换不炸）
 *
 *  输出每条 `[GATE]` 一行、字段顺序固定，**可以直接 diff 两份日志**：
 *      node tools/run.mjs probe-states > before.txt
 *      （删写手）
 *      node tools/run.mjs probe-states > after.txt
 *      diff before.txt after.txt
 *
 *  env:
 *    ST_SEC=8   站立时长      SQ_SEC=10  蹲姿上限
 *    SW_SEC=3   蹲多久后切站   P2S_SEC=4  切站后站多久
 *    QUIET=1    只打 [GATE] 行（不做逐秒打印）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import type { ServoRefs } from '../src/core/servo/supportReg';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame, squatResetLimits } from '../src/core/servo/squat';

/** ★★ 确定性 RNG（mulberry32，定种子）。
 *  为什么必须有：`actions.ts:469-473` 的 idle 动作用了 `Math.random()`
 *  ⇒ 站立阶段**每次运行都不一样**（实测两次跑出 y=1.4272 / y=0.2485）。
 *  不锁种子的话，"stand 指纹不变"这种断言是没有意义的假证明。
 *  锁种子 ≠ 改行为：只是让同一次实验可复现。 */
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
const ST_SEC = Number(ENV.ST_SEC ?? 8);
const SQ_SEC = Number(ENV.SQ_SEC ?? 10);
const SW_SEC = Number(ENV.SW_SEC ?? 1.0);   // ★ 放开之后多久切站（基线 1.98s 就倒，别设 > 1.5）
const P2S_SEC = Number(ENV.P2S_SEC ?? 4);
const QUIET = String(ENV.QUIET ?? '0') === '1';

const DEG = 57.29578;
const CHEST = 'spine4';

interface Rig {
  w: World;
  ctl: ControlModule;
  ctx: ServoRefs;
}

/** 按 main.ts 的装配建一个真实世界。
 *  ★ 三个必须和 main.ts 对齐、否则基线对不上（实测差 1.4s）：
 *    ① `__PRED_OFF_RT = true`（main.ts:205 全局设一次，"反射默认关"）
 *    ② 站立阶段 `actions.idleEnabled` 保持 true（只有 squatcourt 才置 false）
 *    ③ 不变量必须在 `advance` 之后立刻读（ledger 每步 beginStep 清账，读完就过期）
 */
function makeWorld(idle: boolean): Rig {
  const w = new World();
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx: ServoRefs = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = idle;
  w.controller = ctl;
  w.driveEnabled = true;
  w.reset();
  return { w, ctl, ctx };
}

/** ★ 自己算物理不变量，不用 `executor.checkInvariants()`。
 *  原因（本次实测发现）：`checkInvariants` 的期望值是
 *      want = clamp(cmd) + clamp(passive)
 *  但 `applyAll` 的真实式子是
 *      t = clamp(cmd + pair) + clamp(passive)
 *  它**漏了 pair 桶**（2026-10-21 把肌肉对搬进执行器时没同步）⇒ 蹲姿只要 pair 在跑，
 *  它就逐帧报假 FAIL（基线 7600 条）。这是账本口径没跟上，不是物理错。
 *  所以闸门用下面这个正确式子；`checkInvariants` 的结果单独打出来当"账本滞后"的证词。 */
function physInv(w: World): { bad: number; builtin: number } {
  let bad = 0;
  const dofs = w.body.dofs;
  const led = w.executor.ledger;
  for (let i = 0; i < dofs.length; i++) {
    const d = dofs[i]!;
    const l = led[i]!;
    if (d.preRing) continue;
    const t = l.cmd + (l.pair ?? 0);
    const cl = Math.max(-d.tauMax, Math.min(d.tauMax, t))
      + Math.max(-d.tauMax, Math.min(d.tauMax, l.passive));
    if (!Number.isFinite(l.applied) || Math.abs(l.applied - cl) > 1e-9 + 1e-9 * d.tauMax) bad++;
  }
  return { bad, builtin: w.executor.checkInvariants().length };
}

function step(r: Rig, court: CourtState | null): { bad: number; builtin: number } {
  supportClean(r.ctx, 'r');
  supportClean(r.ctx, 'l');
  r.w.advance(1);
  const inv = physInv(r.w);          // ★ 紧跟 advance（ledger 每步 beginStep 清账）
  if (court) squatFrame(r.w, r.ctl, court);
  return inv;
}

interface Metrics {
  fzPct: number;      // ΣFz / 体重
  swPeak: number;     // Σ|ω| 峰值
  swEnd: number;
  y: number;          // 胸高
  dyMm: number;       // 胸高变化
  comOff: number;     // CoM 水平偏移（相对起点，cm）
  inv: number;        // 执行器不变量违规数
  fall: number;
  reason: string;
  roll: number;       // 躯干 roll 峰值（度）
  safeExit: number;
  safeWhy: string;
  xiZPeak: number;    // 侧向 DCM 偏差峰值（m）
  builtin: number;    // `checkInvariants`（漏 pair 桶）报错的帧数——账本滞后证据
}

const blank = (): Metrics => ({
  fzPct: 0, swPeak: 0, swEnd: 0, y: 0, dyMm: 0, comOff: 0, inv: 0,
  fall: -1, reason: '', roll: 0, safeExit: -1, safeWhy: '', xiZPeak: 0, builtin: 0,
});

/** A：站立 */
function runStand(sec: number): Metrics {
  const r = makeWorld(true);            // ★ 站立：idle 开着（与 main.ts 的 stand 一致）
  const { w, ctl } = r;
  const chest = w.body.indexByKey.get(CHEST) ?? 0;
  const weight = w.sk.massTotal * 9.81;
  const y0 = w.body.bodies[chest]!.translation().y;
  const com0x = ctl.sensors.com[0]!, com0z = ctl.sensors.com[2]!;
  let swPeak = 0, comOff = 0, inv = 0, bil = 0;
  const N = Math.round(sec / w.dt);
  for (let s = 0; s < N; s++) {
    const q = step(r, null); if (q.bad) inv++; if (q.builtin) bil++;
    const sw = w.totalRelVel();
    if (sw > swPeak) swPeak = sw;
    comOff = Math.max(comOff, Math.hypot(ctl.sensors.com[0]! - com0x, ctl.sensors.com[2]! - com0z));
    if (!QUIET && s % Math.round(1 / w.dt) === 0) {
      console.log(`  [stand] t=${(s * w.dt).toFixed(0)}s 胸y=${w.body.bodies[chest]!.translation().y.toFixed(4)} ` +
        `ΣFz=${(100 * (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt)) / weight).toFixed(0)}% ` +
        `Σ|ω|=${sw.toFixed(2)}`);
    }
  }
  const m = blank();
  m.y = w.body.bodies[chest]!.translation().y;
  m.dyMm = (m.y - y0) * 1000;
  m.fzPct = 100 * (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt)) / weight;
  m.swPeak = swPeak;
  m.swEnd = w.totalRelVel();
  m.comOff = comOff * 100;
  m.inv = inv;
  m.builtin = bil;
  return m;
}

/** B：蹲姿法庭（settle 2s → 放开 → 判死） */
function runSquat(sec: number): Metrics {
  const r = makeWorld(false);           // ★ 蹲姿法庭：与 main.ts 的 squatcourt 一致（不跑 idle）
  const { w, ctl } = r;
  ctl.resetCourt();
  squatResetLimits(w);
  const court = squatCourtSetup(w, ctl, 2.0);
  const weight = w.sk.massTotal * 9.81;
  let swPeak = 0, xiZPeak = 0, inv = 0, bil = 0;
  const N = Math.round(sec / w.dt);
  for (let s = 0; s < N; s++) {
    const q = step(r, court); if (q.bad) inv++; if (q.builtin) bil++;
    const sw = w.totalRelVel();
    if (sw > swPeak) swPeak = sw;
    if (court.released) {
      const omega = Math.sqrt(9.81 / Math.max(0.3, ctl.sensors.com[1]!));
      const xiZ = ctl.sensors.com[2]! + ctl.sensors.comVel[2]! / omega;
      const dz = Math.abs(xiZ - court.c0.z);
      if (dz > xiZPeak) xiZPeak = dz;
    }
    if (court.fall >= 0) break;
  }
  const m = blank();
  m.fzPct = 100 * (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt)) / weight;
  m.swPeak = swPeak;
  m.swEnd = w.totalRelVel();
  m.y = ctl.sensors.com[1]!;
  m.dyMm = (m.y - court.y0) * 1000;
  m.comOff = 100 * Math.hypot(ctl.sensors.com[0]! - court.c0.x, ctl.sensors.com[2]! - court.c0.z);
  m.inv = inv;
  m.fall = court.fall;
  m.reason = court.reason || '(未倒)';
  m.roll = court.peakRoll * DEG;
  m.safeExit = court.safeExit ?? -1;
  m.safeWhy = court.safeReason || '';
  m.xiZPeak = xiZPeak;
  m.builtin = bil;
  return m;
}

/** C：蹲 → switchPoseState('stand') → 再站
 *  ★ 切换点 = **放开之后** SW_SEC 秒（不是从 setup 起算）——否则基线 3.98s 倒，
 *    SW_SEC=3 时已经在地上，测出来的"切站失败"是假的。 */
function runSquatThenStand(swSec: number, stSec: number): Metrics {
  const r = makeWorld(false);
  const { w, ctl } = r;
  ctl.resetCourt();
  squatResetLimits(w);
  const court = squatCourtSetup(w, ctl, 2.0);
  const weight = w.sk.massTotal * 9.81;
  let swPeak = 0, inv = 0, bil = 0;
  const tSwitch = court.settle + swSec;
  const N = Math.round((tSwitch + stSec) / w.dt);
  let switched = false;
  let chest = w.body.indexByKey.get(CHEST) ?? 0;
  let yAtSwitch = 0;
  for (let s = 0; s < N; s++) {
    if (!switched && (court.t >= tSwitch || court.fall >= 0)) {
      // ★ 真实切换路径：switchPoseState 一次切完表/限位/被动基准/回正缓存/镜像
      w.switchPoseState('stand');
      ctl.warner.setComTarget(0, 0);
      chest = w.body.indexByKey.get(CHEST) ?? chest;
      yAtSwitch = w.body.bodies[chest]!.translation().y;
      switched = true;
      console.log(`  [p2s] 切换 t=${court.t.toFixed(2)}s（${court.fall >= 0 ? `蹲已判倒: ${court.reason}` : '未倒'}）胸y=${yAtSwitch.toFixed(3)}`);
    }
    { const q = step(r, switched ? null : court); if (q.bad) inv++; if (q.builtin) bil++; }
    swPeak = Math.max(swPeak, w.totalRelVel());
    if (!switched) continue;
    if (!QUIET && (s % Math.round(1 / w.dt) === 0)) {
      console.log(`  [p2s] t=${court.t.toFixed(2)}s 胸y=${w.body.bodies[chest]!.translation().y.toFixed(4)} Σ|ω|=${w.totalRelVel().toFixed(2)}`);
    }
  }
  const m = blank();
  m.y = w.body.bodies[chest]!.translation().y;
  m.dyMm = (m.y - yAtSwitch) * 1000;
  m.fzPct = 100 * (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt)) / weight;
  m.swPeak = swPeak;
  m.swEnd = w.totalRelVel();
  m.inv = inv;
  m.fall = court.fall;
  m.reason = court.reason || '(未倒)';
  m.roll = court.peakRoll * DEG;
  m.safeExit = court.safeExit ?? -1;
  m.safeWhy = court.safeReason || '';
  m.builtin = bil;
  return m;
}

const tag = (m: Metrics): string =>
  `fz=${m.fzPct.toFixed(0)}% y=${m.y.toFixed(4)} dy=${m.dyMm >= 0 ? '+' : ''}${m.dyMm.toFixed(1)}mm ` +
  `com=${m.comOff.toFixed(1)}cm SwPeak=${m.swPeak.toFixed(2)} SwEnd=${m.swEnd.toFixed(2)} ` +
  `inv=${m.inv === 0 ? 'ok' : `${m.inv}FAIL`} builtin=${m.builtin === 0 ? 'ok' : `${m.builtin}漏pair`}`;

// ─────────────────────────── 跑 ───────────────────────────
{
  const t = new World();
  console.log('════ 多状态回归闸门（真实 ControlModule 装配）════');
  console.log(`dt=${(1 / t.dt).toFixed(0)}Hz  stand=${ST_SEC}s  squat≤${SQ_SEC}s  squat→stand: ${SW_SEC}s+${P2S_SEC}s`);
}

const A = runStand(ST_SEC);
console.log(`[GATE] stand    ${tag(A)} => ${A.y > 1.3 && A.fzPct > 80 && A.inv === 0 ? 'PASS' : 'FAIL'}`);

const B = runSquat(SQ_SEC);
console.log(`[GATE] squat    ${tag(B)} fall=${B.fall < 0 ? '未倒' : `${B.fall.toFixed(2)}s`} ` +
  `roll=${B.roll.toFixed(0)}° xiZpeak=${(B.xiZPeak * 100).toFixed(1)}cm ` +
  `safeExit=${B.safeExit < 0 ? '未出' : `${B.safeExit.toFixed(2)}s(${B.safeWhy})`} reason=${B.reason} ` +
  `=> ${B.inv === 0 ? 'PASS' : 'FAIL'}`);

const C = runSquatThenStand(SW_SEC, P2S_SEC);
// ★ 2026-10-26：p2stand **不是闸门**。`main.ts` 只在 `squatdown` 的**准备阶段**调
//   `switchPoseState('stand')`，产品里根本没有「蹲 → 站」的入口（没有这个按钮），
//   所以这条路径从来没有被跑通过。这里保留数值输出当**已知缺口记录**，
//   但不能拿它当回归判据（否则每次改代码都会被一条没人走的路径卡住）。
console.log(`[GATE] p2stand  ${tag(C)} squatFall=${C.fall < 0 ? '未倒' : `${C.fall.toFixed(2)}s`} ` +
  `=> REC(非闸门·产品无蹲→站入口，仅记录)`);

console.log('');
console.log('判定口径：');
console.log('  stand   : 胸 y > 1.3 m、ΣFz > 80% 体重、不变量通过');
console.log('  squat   : 不变量通过（fall@ / roll / xiZpeak 与基线**比数值**，不是比 PASS）');
console.log('  p2stand : **非闸门**，只记录（`main.ts` 无蹲→站入口，此路径从未接线）');

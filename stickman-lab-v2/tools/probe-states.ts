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

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const ST_SEC = Number(ENV.ST_SEC ?? 8);
const SQ_SEC = Number(ENV.SQ_SEC ?? 10);
const SW_SEC = Number(ENV.SW_SEC ?? 3);
const P2S_SEC = Number(ENV.P2S_SEC ?? 4);
const QUIET = String(ENV.QUIET ?? '0') === '1';

const DEG = 57.29578;
const CHEST = 'spine4';

interface Rig {
  w: World;
  ctl: ControlModule;
  ctx: ServoRefs;
}

/** 按 main.ts 的装配建一个真实世界。 */
function makeWorld(): Rig {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx: ServoRefs = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = false;      // 与 main.ts 的 squatcourt 一致：不跑 idle 动作
  w.controller = ctl;
  w.driveEnabled = true;
  w.reset();
  return { w, ctl, ctx };
}

function step(r: Rig, court: CourtState | null): void {
  supportClean(r.ctx, 'r');
  supportClean(r.ctx, 'l');
  r.w.advance(1);
  if (court) squatFrame(r.w, r.ctl, court);
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
}

const blank = (): Metrics => ({
  fzPct: 0, swPeak: 0, swEnd: 0, y: 0, dyMm: 0, comOff: 0, inv: 0,
  fall: -1, reason: '', roll: 0, safeExit: -1, safeWhy: '', xiZPeak: 0,
});

/** A：站立 */
function runStand(sec: number): Metrics {
  const r = makeWorld();
  const { w, ctl } = r;
  const chest = w.body.indexByKey.get(CHEST) ?? 0;
  const weight = w.sk.massTotal * 9.81;
  const y0 = w.body.bodies[chest]!.translation().y;
  const com0x = ctl.sensors.com[0]!, com0z = ctl.sensors.com[2]!;
  let swPeak = 0, comOff = 0;
  const N = Math.round(sec / w.dt);
  for (let s = 0; s < N; s++) {
    step(r, null);
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
  m.inv = w.executor.checkInvariants().length;
  return m;
}

/** B：蹲姿法庭（settle 2s → 放开 → 判死） */
function runSquat(sec: number): Metrics {
  const r = makeWorld();
  const { w, ctl } = r;
  ctl.resetCourt();
  squatResetLimits(w);
  const court = squatCourtSetup(w, ctl, 2.0);
  const weight = w.sk.massTotal * 9.81;
  let swPeak = 0, xiZPeak = 0;
  const N = Math.round(sec / w.dt);
  for (let s = 0; s < N; s++) {
    step(r, court);
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
  m.inv = w.executor.checkInvariants().length;
  m.fall = court.fall;
  m.reason = court.reason || '(未倒)';
  m.roll = court.peakRoll * DEG;
  m.safeExit = court.safeExit ?? -1;
  m.safeWhy = court.safeReason || '';
  m.xiZPeak = xiZPeak;
  return m;
}

/** C：蹲 → switchPoseState('stand') → 再站 */
function runSquatThenStand(swSec: number, stSec: number): Metrics {
  const r = makeWorld();
  const { w, ctl } = r;
  ctl.resetCourt();
  squatResetLimits(w);
  const court = squatCourtSetup(w, ctl, 2.0);
  const weight = w.sk.massTotal * 9.81;
  let swPeak = 0;
  for (let s = 0; s < Math.round(swSec / w.dt); s++) {
    step(r, court);
    swPeak = Math.max(swPeak, w.totalRelVel());
    if (court.fall >= 0) break;
  }
  // ★ 真实切换路径：switchPoseState 一次切完表/限位/被动基准/回正缓存/镜像
  w.switchPoseState('stand');
  ctl.warner.setComTarget(0, 0);
  const chest = w.body.indexByKey.get(CHEST) ?? 0;
  const yAtSwitch = w.body.bodies[chest]!.translation().y;
  const N = Math.round(stSec / w.dt);
  for (let s = 0; s < N; s++) {
    step(r, null);
    swPeak = Math.max(swPeak, w.totalRelVel());
    if (!QUIET && s % Math.round(1 / w.dt) === 0) {
      console.log(`  [p2s] t=${(s * w.dt).toFixed(0)}s 胸y=${w.body.bodies[chest]!.translation().y.toFixed(4)} Σ|ω|=${w.totalRelVel().toFixed(2)}`);
    }
  }
  const m = blank();
  m.y = w.body.bodies[chest]!.translation().y;
  m.dyMm = (m.y - yAtSwitch) * 1000;
  m.fzPct = 100 * (w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt)) / weight;
  m.swPeak = swPeak;
  m.swEnd = w.totalRelVel();
  m.inv = w.executor.checkInvariants().length;
  m.fall = court.fall;
  m.reason = court.reason || '(未倒)';
  m.roll = court.peakRoll * DEG;
  m.safeExit = court.safeExit ?? -1;
  m.safeWhy = court.safeReason || '';
  return m;
}

const tag = (m: Metrics): string =>
  `fz=${m.fzPct.toFixed(0)}% y=${m.y.toFixed(4)} dy=${m.dyMm >= 0 ? '+' : ''}${m.dyMm.toFixed(1)}mm ` +
  `com=${m.comOff.toFixed(1)}cm SwPeak=${m.swPeak.toFixed(2)} SwEnd=${m.swEnd.toFixed(2)} inv=${m.inv === 0 ? 'ok' : `${m.inv}FAIL`}`;

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
console.log(`[GATE] p2stand  ${tag(C)} => ${C.y > 1.3 && C.fzPct > 70 && C.inv === 0 ? 'PASS' : 'FAIL'}`);

console.log('');
console.log('判定口径：');
console.log('  stand   : 胸 y > 1.3 m、ΣFz > 80% 体重、不变量通过');
console.log('  squat   : 不变量通过（fall@ / roll / xiZpeak 与基线**比数值**，不是比 PASS）');
console.log('  p2stand : 切回站立后胸 y > 1.3 m、ΣFz > 70% 体重');

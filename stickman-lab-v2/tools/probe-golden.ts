/** probe-golden.ts —— 逐位等价证明器（anti-breakage）
 *
 *  用户（2026-10-26）：『我的担心是收敛过程中有很大的破坏』
 *
 *  光比 `fall@` / `Σ|ω|` 不足以证明"没破坏"——它们只说明**结果差不多**。
 *  本工具比的是**每一步真正施加到每个自由度上的力矩位模式**（Float64 bits），
 *  以及根刚体的位姿位模式。于是"纯重构"和"改行为"变成可判定的：
 *
 *    hash 序列逐位相同  ⇒ 这一刀是纯重构，物理上什么都没变
 *    hash 序列不同      ⇒ 你在改行为，必须用指标（fall@ / ξz / 逐关节对账）验收
 *
 *  用法：
 *      node tools/run.mjs probe-golden > before.txt
 *      （改代码）
 *      node tools/run.mjs probe-golden > after.txt
 *      diff before.txt after.txt        # 只应该差第一行的时间戳（本工具不打印时间戳）
 *
 *  env:
 *      G_STAND=3   站立比对时长（秒）
 *      G_SQUAT=5   蹲姿比对时长（秒）
 *      G_VERBOSE=1 每 0.5s 打一行滚动 hash（定位发散发生在哪一步）
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
const G_STAND = Number(ENV.G_STAND ?? 3);
const G_SQUAT = Number(ENV.G_SQUAT ?? 5);
const VERBOSE = String(ENV.G_VERBOSE ?? '0') === '1';

/** FNV-1a over raw bytes of a Float64Array —— 对位模式敏感（NaN/±0 都能分辨）。 */
function fnv(bytes: Uint8Array, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mkRig(idle: boolean): { w: World; ctl: ControlModule; ctx: ServoRefs } {
  const w = new World();
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;   // 与 main.ts:205 一致
  const ctl = new ControlModule(w, { postureTone: 8 });
  const ctx: ServoRefs = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  ctl.actions.idleEnabled = idle;
  w.controller = ctl;
  w.driveEnabled = true;
  w.reset();
  return { w, ctl, ctx };
}

/** 一步：施加力矩的位模式 + 根刚体位姿。返回 (hash, 时间)。 */
function fingerprint(w: World): number {
  const led = w.executor.ledger;
  const n = led.length;
  const buf = new Float64Array(n + 14);
  for (let i = 0; i < n; i++) buf[i] = led[i]!.applied;      // ★ 真正下发的力矩
  const root = w.body.root();
  const p = root.translation();
  const q = root.rotation();
  const v = root.linvel();
  buf[n + 0] = p.x; buf[n + 1] = p.y; buf[n + 2] = p.z;
  buf[n + 3] = q.x; buf[n + 4] = q.y; buf[n + 5] = q.z; buf[n + 6] = q.w;
  buf[n + 7] = v.x; buf[n + 8] = v.y; buf[n + 9] = v.z;
  // 关节角/角速度也进指纹（比只有力矩更早暴露分叉）
  const dofs = w.body.dofs;
  buf[n + 10] = dofs.length;
  let h = fnv(new Uint8Array(buf.buffer, 0, buf.byteLength));
  const ab = new Float64Array(dofs.length * 2);
  for (let i = 0; i < dofs.length; i++) { ab[i * 2] = dofs[i]!.angle; ab[i * 2 + 1] = dofs[i]!.vel; }
  h ^= fnv(new Uint8Array(ab.buffer), h);
  return h >>> 0;
}

function runStand(sec: number): { steps: number; chain: number; first: number } {
  const { w, ctx } = mkRig(true);
  let chain = 0x811c9dc5, first = 0;
  const N = Math.round(sec / w.dt);
  for (let s = 0; s < N; s++) {
    supportClean(ctx, 'r');
    supportClean(ctx, 'l');
    w.advance(1);
    const f = fingerprint(w);
    chain = fnv(new Uint8Array(new Uint32Array([f]).buffer), chain);
    if (s === 0) first = f;
    if (VERBOSE && s % Math.round(0.5 / w.dt) === 0) console.log(`  [stand] step=${s} f=${f.toString(16)}`);
  }
  return { steps: N, chain: chain >>> 0, first };
}

function runSquat(sec: number): { steps: number; chain: number; first: number; releaseStep: number } {
  const { w, ctl, ctx } = mkRig(false);
  ctl.resetCourt();
  squatResetLimits(w);
  const court: CourtState = squatCourtSetup(w, ctl, 2.0);
  let chain = 0x811c9dc5, first = 0, releaseStep = -1;
  const N = Math.round(sec / w.dt);
  for (let s = 0; s < N; s++) {
    supportClean(ctx, 'r');
    supportClean(ctx, 'l');
    w.advance(1);
    squatFrame(w, ctl, court);
    const f = fingerprint(w);
    chain = fnv(new Uint8Array(new Uint32Array([f]).buffer), chain);
    if (s === 0) first = f;
    if (releaseStep < 0 && court.released) releaseStep = s;
    if (VERBOSE && s % Math.round(0.5 / w.dt) === 0) {
      console.log(`  [squat] step=${s} f=${f.toString(16)} fall=${court.fall < 0 ? '-' : court.fall.toFixed(2)}`);
    }
  }
  return { steps: N, chain: chain >>> 0, first, releaseStep };
}

const A = runStand(G_STAND);
const B = runSquat(G_SQUAT);

console.log('════ 逐位等价指纹（同一状态两次运行必须完全一致）════');
console.log(`[GOLD] stand  steps=${A.steps} first=0x${A.first.toString(16).padStart(8, '0')} chain=0x${A.chain.toString(16).padStart(8, '0')}`);
console.log(`[GOLD] squat  steps=${B.steps} release@${B.releaseStep} first=0x${B.first.toString(16).padStart(8, '0')} chain=0x${B.chain.toString(16).padStart(8, '0')}`);
console.log('');
console.log('判读：');
console.log('  · 先连跑两次本工具，两行 chain 必须相同 —— 不同说明环境本身不确定，本工具作废。');
console.log('  · 改代码后 chain 不变  ⇒ **纯重构**，物理逐位没变（这才是"没破坏"的证据）。');
console.log('  · 改代码后 chain 变了  ⇒ 你在改行为，必须用 fall@ / ξz / 逐关节对账验收，不能声称"等价"。');

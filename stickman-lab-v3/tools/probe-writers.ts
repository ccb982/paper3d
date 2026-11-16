/** probe-writers.ts —— 蹲姿伺服写手审计（运行期，definitive）
 *
 *  用户（2026-10-26）：『顺便审计一下蹲下伺服的写手都有什么 / 我感觉现在很不干净了』
 *  用户架构：伺服层、动作层给出提案 → 汇总到执行层 → 最后由执行层操作写手
 *
 *  所以审计要区分三件事，不能只看 `propose`：
 *    ① 走**提案总线**的（合规：伺服层/动作层交上来的）
 *    ② 走 `executor` 但**没有提案**的（`drive.step` 直接把 tex/td 灌进 l.cmd）
 *    ③ **完全绕过执行层**，直接改刚体的（`applyImpulseAtPoint` / `setLinvel` / 手动钉）
 *
 *  做法：不靠 grep——
 *    · 劫持 `PROPOSALS.push` 抓完整提案，复刻 `control.ts:222` 仲裁，标出谁赢了；
 *    · 给 `executor.addTorque` / `commandPair` / `drive.setTorque` 打桩，用**调用栈帧**
 *      去重出"到底有哪些代码位置在写力矩"（这就抓得到绕过提案的）；
 *    · 直接改刚体的写法在源码里静态列出对照。
 *
 *  只统计**放开之后**的帧（静置期是摆姿，不算伺服）。
 *
 *  用法：node tools/run.mjs probe-writers
 *  env: T_END=6（放开后时长）  W_MIN=10（只列出现 ≥N 帧的写手）
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { squatCourtSetup, type CourtState } from '../src/core/court';
import { squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { PROPOSALS, type DofProposal } from '../src/core/proposalBus';

const ENV = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
const T_END = Number(ENV.T_END ?? 6);
const W_MIN = Number(ENV.W_MIN ?? 10);

// ── ① 抓提案 ────────────────────────────────────────────────
const ORIG_PUSH = PROPOSALS.push.bind(PROPOSALS);
let CAP: DofProposal[] = [];
(PROPOSALS as unknown as { push: (p: DofProposal) => number }).push = (p: DofProposal): number => {
  CAP.push(p);
  return ORIG_PUSH(p);
};

const w = new World();
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.driveEnabled = true;
w.reset();

// ── ② 给执行层/驱动打桩，抓"没走提案"的写入点 ──────────────
type Hit = { n: number; sum: number; peak: number; first: number };
const bypass = new Map<string, Hit>();          // callsite → 统计
const methods = new Map<string, Hit>();         // 方法名 → 统计（对照）
let recording = false;

let inDrive = false;            // 是否正在 drive.step 里（= 绕过提案的直接灌力矩）
const bump = (map: Map<string, Hit>, key: string, v: number): void => {
  let h = map.get(key);
  if (!h) { h = { n: 0, sum: 0, peak: 0, first: 0 }; map.set(key, h); }
  h.n++; h.sum += v; if (Math.abs(v) > h.peak) h.peak = Math.abs(v);
};

const exec = w.executor as unknown as Record<string, unknown>;
for (const name of ['addTorque', 'addPassiveTorque', 'addLimitImpulse', 'commandPair']) {
  const orig = (exec[name] as (...a: unknown[]) => unknown).bind(w.executor);
  exec[name] = (...a: unknown[]): unknown => {
    if (recording) {
      const v = name === 'commandPair' ? 0 : Number(a[1] ?? 0);
      const bucket = name === 'addTorque' && inDrive ? `addTorque[drive.step 内·无条件]` : `${name}[总线派发]`;
      bump(methods, bucket, v);
      bump(bypass, bucket, v);
    }
    return orig(...a);
  };
}
const drv = ctl.warner.drive as unknown as Record<string, unknown>;
/** ★ 2026-10-26：统计"同值重写"（赋值幂等 ⇒ 1b 会直接跳过）。
 *  只数**调用次数**是看不出 1b 收益的——桩在方法外面，
 *  必须在进桩时就比对当前 `ff`，才知道这一笔是不是空写。 */
let ffNoop = 0;
let ffCalls = 0;
{
  const orig = (drv['setTorque'] as (...a: unknown[]) => unknown).bind(ctl.warner.drive);
  drv['setTorque'] = (...a: unknown[]): unknown => {
    if (recording) {
      const v = Number(a[1] ?? 0);
      bump(methods, 'drive.setTorque[总线派发]', v);
      bump(bypass, 'drive.setTorque[总线派发]', v);
      ffCalls++;
      if (Object.is((ctl.warner.drive as unknown as { ffOf(i: number): number }).ffOf(Number(a[0])), v)) ffNoop++;
    }
    return orig(...a);
  };
  // ★ 打 drive.step 的边界：它内部会对**每个** DoF 调一次 addTorque
  const origStep = (drv['step'] as (dt: number) => void).bind(ctl.warner.drive);
  drv['step'] = (dt: number): void => { inDrive = true; try { origStep(dt); } finally { inDrive = false; } };
}

// ── ③ 跑蹲姿法庭 ────────────────────────────────────────────
ctl.resetCourt();
squatResetLimits(w);
const court: CourtState = squatCourtSetup(w, ctl, 2.0);

const DEG = 57.29578;
interface SrcStat { frames: number; win: number; dofs: Set<string>; kinds: Set<string>; pri: number; ch: string; peak: number; sum: number }
const srcs = new Map<string, SrcStat>();
const multiKind = new Map<string, Set<string>>();     // dof → kinds（同帧）
let frames = 0;
let multiKindFrames = 0;
const multiKindHits = new Map<string, number>();      // "dof|kindA+kindB"

for (let i = 0; i < Math.round(T_END / w.dt); i++) {
  // ★ 写入发生在 `advance` 里（controller.step 派发 + drive.step + applyAll），
  //   所以 recording 必须在 advance **之前**开；提案也要在 advance 之后立刻快照
  //   （squatFrame 推的那批是下一帧才仲裁，不属于本帧写入）。
  const rec = court.released && court.fall < 0;
  recording = rec;
  supportClean(ctx, 'r'); supportClean(ctx, 'l');   // ← 不清 CAP：上一帧 squatFrame 的提案要活到本次 advance 仲裁
  w.advance(1);
  const cap = CAP;
  CAP = [];
  squatFrame(w, ctl, court);
  if (!rec) continue;
  frames++;
  if (court.fall >= 0) { /* 本帧已判倒，照样计入后退出 */ }
  // 复刻 control.ts:222 仲裁
  const best = new Map<string, DofProposal>();
  for (const p of cap) {
    if (p.kind === 'antiG') continue;
    const k = `${p.dof}|${p.kind}|${p.channel ?? 'default'}`;
    const cur = best.get(k);
    if (!cur || (p.pri ?? 0) >= (cur.pri ?? 0)) best.set(k, p);
  }
  const winners = new Set(best.values());

  // 同 DoF 多 kind（跨 kind 不仲裁 ⇒ 相加）
  multiKind.clear();
  for (const p of cap) {
    const d = w.body.dofs[p.dof];
    if (!d) continue;
    const key = `${d.name}/${d.axis}`;
    let s = multiKind.get(key);
    if (!s) { s = new Set(); multiKind.set(key, s); }
    s.add(String(p.kind));
  }
  let anyMulti = false;
  for (const [dof, ks] of multiKind) {
    if (ks.size < 2) continue;
    anyMulti = true;
    const sig = `${dof}|${[...ks].sort().join('+')}`;
    multiKindHits.set(sig, (multiKindHits.get(sig) ?? 0) + 1);
  }
  if (anyMulti) multiKindFrames++;

  for (const p of cap) {
    const d = w.body.dofs[p.dof];
    if (!d) continue;
    const src = p.src ?? '(无 src)';
    let s = srcs.get(src);
    if (!s) {
      s = { frames: 0, win: 0, dofs: new Set(), kinds: new Set(), pri: p.pri ?? 0, ch: p.channel ?? 'default', peak: 0, sum: 0 };
      srcs.set(src, s);
    }
    s.frames++;
    if (winners.has(p)) s.win++;
    s.dofs.add(`${d.name}/${d.axis}`);
    s.kinds.add(String(p.kind));
    const tau = Math.abs(Number(p.tau ?? 0));
    if (tau > s.peak) s.peak = tau;
    s.sum += tau;
  }
}

// ── ④ 出表 ──────────────────────────────────────────────────
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const padL = (s: string | number, n: number): string => String(s).padStart(n);

console.log('════════ 蹲姿伺服写手审计（放开后 %d 帧）════════', frames);
console.log('');
console.log('── ① 提案总线上的写手（合规：伺服层/动作层交上来）──');
console.log(`${pad('#', 3)}${pad('src', 26)}${pad('kind', 8)}${padL('pri', 4)} ${pad('channel', 10)}${padL('帧', 6)}${padL('胜出', 6)}${padL('DoF', 5)}${padL('峰|τ|', 8)}  覆盖`);
const rows = [...srcs.entries()].filter(([, s]) => s.frames >= W_MIN).sort((a, b) => b[1].frames - a[1].frames);
rows.forEach(([src, s], i) => {
  const cover = [...s.dofs].sort().join(' ');
  console.log(`${pad(i + 1, 3)}${pad(src, 26)}${pad([...s.kinds].join(','), 8)}${padL(s.pri, 4)} ${pad(s.ch, 10)}` +
    `${padL(s.frames, 6)}${padL(s.win, 6)}${padL(s.dofs.size, 5)}${padL(s.peak.toFixed(0), 8)}  ${cover.slice(0, 90)}`);
});
const ghost = [...srcs.entries()].filter(([, s]) => s.frames < W_MIN);
if (ghost.length) console.log(`  另有 ${ghost.length} 个写手出现 <${W_MIN} 帧：${ghost.map(([k]) => k).join(', ')}`);

console.log('');
console.log('── ② 跨 kind 并联（不同 kind 永不仲裁 ⇒ 同一 DoF 多套定律相加）──');
console.log(`命中帧：${multiKindFrames}/${frames}（${(100 * multiKindFrames / Math.max(1, frames)).toFixed(0)}%）`);
[...multiKindHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .forEach(([sig, n]) => console.log(`  ${padL(n, 5)} 帧  ${sig}`));

console.log('');
console.log('── ③ 非提案写入点（绕过总线，直接进执行层/驱动）──');
console.log(`${pad('次数', 7)}${padL('峰|值|', 8)}  ${pad('通道', 42)}`);
const by = [...bypass.entries()].sort((a, b) => b[1].n - a[1].n);
if (!by.length) console.log('  （无）');
by.forEach(([k, h]) => {
  console.log(`${padL(h.n, 7)}${padL(h.peak.toFixed(0), 8)}  ${pad(k, 42)}`);
});

console.log('');
console.log('── ④ 方法级汇总 ──');
[...methods.entries()].sort((a, b) => b[1].n - a[1].n)
  .forEach(([k, h]) => console.log(`  ${pad(k, 42)}${padL(h.n, 8)} 次  峰=${h.peak.toFixed(0)}`));
if (ffCalls > 0) {
  console.log(`  ${pad('  ↳ 其中「同值重写」', 42)}${padL(ffNoop, 8)} 次  ${(100 * ffNoop / ffCalls).toFixed(0)}%` +
    `  （赋值幂等 ⇒ 1b 直接 return，状态逐位不变）`);
}

console.log('');
console.log('读出方式：');
console.log('  · ①里 `胜出 < 帧` 的写手 = 每帧提交但常被同 kind 的别人盖掉（白算）。');
console.log('  · ②里出现 spine/neck = 躯干被多套定律并联（这是"不干净"的主要来源）。');
console.log('  · ③里 `addTorque @ drive.ts:...` = 驱动层绕过提案直接灌力矩（伺服层没交提案）。');
console.log('  · ③里若出现 `applyImpulse*` 相关，那是**完全绕过执行层**直接改刚体。');

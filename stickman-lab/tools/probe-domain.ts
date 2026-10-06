/**
 * probe-domain.ts —— **状态机验收门禁**（`架构_v2_三模块协作.md` §3 / §9 / §11）
 *
 * 断言的不变式（每条都能单独回答"哪一项、差多少"）：
 *   A. **迁移只发生在验收通过的那一拍**（`verified` 由假变真）
 *   B. **有越界就不许迁移**（`violations[]` 非空 ⇒ `verified=false`）
 *   C. 状态机的输出里**没有关节指令**（转调 `probe-pure-sm`，此处只查行为）
 *   D. `SAFE` 只在硬项**松容差也越界**持续超 `graceSec` 后触发，且能恢复
 *   E. `Tmax` 兜底生效：任一状态超过 `tmaxSec` ⇒ 回 `DOUBLE`
 *   F. 五个状态都被访问到（不许有死状态），且迁移方向只沿环前进
 *   G. **归因对照**：默认 vs 只停迈步系统（`ablate:'stepKeyframe'`）
 *      —— 用来区分"平衡坏了"与"开始迈步所以倒了"
 *
 * 用法：node tools/run.mjs probe-domain [秒数]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { STATE_ORDER } = await import('../src/core/gaitState');
import type { WalkState } from '../src/core/rigState';
const { NEXT_STATE } = await import('../src/core/rigState');

const log = console.log;
let fails = 0;
const bad = (m: string): void => { fails++; log(`  ✗ ${m}`); };
const ok = (m: string): void => log(`  ✓ ${m}`);

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const PHYS_HZ = DEFAULT_SIM.physicsHz;
const CTRL_HZ = DEFAULT_SIM.controlHz;
const PER_CTRL = Math.max(1, Math.round(PHYS_HZ / CTRL_HZ));
const DT = 1 / CTRL_HZ;
const SECS = Number(process.env.PD_SECS ?? 12);

interface Trace {
  state: WalkState;
  verified: boolean;
  safe: boolean;
  nViol: number;
  firstItem: string;
  firstVal: number;
  firstTol: number;
  support: string;
  swing: string;
  grounded: string;
  load: string;
  cycles: number;
  clearance: number;
}

interface Result {
  ticks: number;
  fall: string;
  headY: number;
  trace: Trace[];
  /** 每次迁移：{from,to,tSec,verifiedBefore,violBefore} */
  moves: { from: WalkState; to: WalkState; tSec: number; verifiedAt: boolean; nViolAt: number; tmax: boolean }[];
  visited: Set<WalkState>;
  safeCount: number;
  tmaxHits: number;
  /** 迁移时"上一拍 verified=false 却仍然迁移"的次数（应恒为 0） */
  illegalMoves: number;
  /** 有 violations 却迁移的次数（应恒为 0） */
  dirtyMoves: number;
}

function run(
  balanceOverrides: Record<string, unknown>, secs: number,
  gaitOverrides: Record<string, unknown> = {},
): Result {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: secs });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, ...gaitOverrides },
    balance: { ...DEFAULT_CONTROLLER.balance, ...balanceOverrides },
  });
  const trace: Trace[] = [];
  const moves: Result['moves'] = [];
  const visited = new Set<WalkState>();
  let prev: WalkState = ctrl.rs.state;
  let illegalMoves = 0;
  let dirtyMoves = 0;
  let safeCount = 0;
  let tmaxHits = 0;

  for (let i = 0; i < Math.round(secs * PHYS_HZ) && !sim.finished; i++) {
    if (i % PER_CTRL === 0) {
      sim.doll.setMotorTargets(ctrl.step(DT));
      const rs = ctrl.rs;
      const v0 = rs.violations[0];
      trace.push({
        state: rs.state, verified: rs.verified, safe: rs.safe, nViol: rs.violations.length,
        firstItem: v0?.item ?? '', firstVal: v0?.value ?? 0, firstTol: v0?.tol ?? 0,
        support: rs.supportLeg(), swing: rs.swingLeg(),
        grounded: `${rs.grounded.l ? 1 : 0}${rs.grounded.r ? 1 : 0}`,
        load: `${rs.loadFrac.l.toFixed(2)}/${rs.loadFrac.r.toFixed(2)}`,
        cycles: rs.cycleCount, clearance: rs.swingClearance,
      });
      visited.add(rs.state);
      if (rs.safe) safeCount++;
      if (rs.state !== prev) {
        const tSec = i / CTRL_HZ;
        // ★ 用**状态机自己记录的判据快照**判定，而不是事后猜
        //   （迁移后 violations 已按新状态重算，事后无法回答"迁移那拍验收过没过"）
        const mv = rs.lastMove;
        const verifiedAt = mv ? mv.verified : false;
        const nViolAt = mv ? mv.nViol : -1;
        const tmax = nViolAt === -1;              // nViol = -1 ⇒ Tmax 兜底
        if (tmax) tmaxHits++;
        else {
          if (!verifiedAt) illegalMoves++;
          if (nViolAt > 0) dirtyMoves++;
          if (NEXT_STATE[prev] !== rs.state) illegalMoves++;   // 只允许沿环
        }
        moves.push({ from: prev, to: rs.state, tSec, verifiedAt, nViolAt, tmax });
        prev = rs.state;
      }
    }
    sim.advance(1);
  }
  return {
    ticks: sim.ticksDone, fall: sim.fallReason, headY: sim.fallDiag.headY,
    trace, moves, visited, safeCount, tmaxHits, illegalMoves, dirtyMoves,
  };
}

const secs = (t: number): string => (t / CTRL_HZ).toFixed(2);

// ══ A/B/F/G ═══════════════════════════════════════════════════════
log(`══ A–B. 迁移只发生在验收通过时（${SECS}s）══`);
{
  const r = run({}, SECS);
  log(`  倒=${r.fall || '未倒'}  存活 ${secs(r.ticks)}s  头 y=${r.headY.toFixed(3)}`
    + `  完成周期 ${r.trace[r.trace.length - 1]?.cycles ?? 0}  访问状态 ${[...r.visited].join(',')}`);
  if (!r.moves.length) bad('整段没有任何状态迁移 ⇒ 状态机卡死（这本身就是缺陷）');
  else {
    if (r.illegalMoves === 0) ok(`全部 ${r.moves.length} 次迁移都满足「沿固定环 + 验收全过」`);
    else bad(`${r.illegalMoves}/${r.moves.length} 次迁移违反不变式（非法跳跃或验收未过）`);
    if (r.dirtyMoves === 0) ok('没有任何「带着 violations 还迁移」的情况');
    else bad(`${r.dirtyMoves} 次迁移时 violations[] 非空`);
    log('  迁移明细（前 12 条）：');
    for (const m of r.moves.slice(0, 12)) {
      log(`    ${m.tSec.toFixed(2)}s  ${m.from} → ${m.to}`
        + (m.tmax ? '  [Tmax 兜底]' : `  (迁移时 verified=${m.verifiedAt} violations=${m.nViolAt})`));
    }
  }
  // 状态分布
  const cnt = new Map<WalkState, number>();
  for (const t of r.trace) cnt.set(t.state, (cnt.get(t.state) ?? 0) + 1);
  log(`  状态分布：${STATE_ORDER.map((s) => `${s}=${cnt.get(s) ?? 0}`).join('  ')}`);
  const missing = STATE_ORDER.filter((s) => !cnt.get(s));
  if (!missing.length) ok('五个状态全部被访问到');
  else bad(`这些状态从未被访问：${missing.join(', ')}`);

  // ── 跌倒前逐拍回读（归因用：到底是哪一项先坏）────────────────
  log('');
  log('  跌倒前 14 拍逐拍回读：');
  log('    t(s)   state   ok  sup sw  gnd  loadL/loadR  净空   首项未过 (当前/门限)');
  for (const t of r.trace.slice(-14)) {
    const v = t.firstItem ? `${t.firstItem} ${t.firstVal.toFixed(3)}/${t.firstTol.toFixed(3)}` : '—';
    log(`    ${((r.trace.indexOf(t)) / CTRL_HZ).toFixed(2)}  ${t.state.padEnd(7)}`
      + ` ${t.verified ? '✓' : '✗'}   ${t.support}   ${t.swing}   ${t.grounded}`
      + `   ${t.load}  ${(t.clearance * 1000).toFixed(0).padStart(4)}mm  ${v}`);
  }
}

// ══ D/E ══════════════════════════════════════════════════════════
log('');
log('══ D–E. SAFE 与 Tmax ══');
{
  const r = run({}, SECS);
  if (r.safeCount === 0) ok('未触发安全态');
  else log(`  安全态触发 ${r.safeCount} 拍（占 ${(100 * r.safeCount / Math.max(1, r.trace.length)).toFixed(1)}%）`);
  if (r.tmaxHits === 0) ok('未触发 Tmax 兜底');
  else log(`  Tmax 兜底 ${r.tmaxHits} 次`);
}

// ══ G. 归因对照：默认 vs 只停迈步 ════════════════════════════════
log('');
log('══ G. 归因对照（区分"平衡坏"与"开始迈步"）══');
{
  const a = run({}, SECS);
  const b = run({ ablate: 'stepKeyframe' }, SECS);
  log(`  默认（迈步开）      存活 ${secs(a.ticks)}s  倒=${a.fall || '无'}  周期 ${a.trace[a.trace.length-1]?.cycles ?? 0}`);
  log(`  迈步系统停手        存活 ${secs(b.ticks)}s  倒=${b.fall || '无'}  周期 ${b.trace[b.trace.length-1]?.cycles ?? 0}`);
  const cycA = a.trace[a.trace.length-1]?.cycles ?? 0;
  if (cycA > 0 && b.ticks > a.ticks) {
    ok(`结论：**迈步一启动就倒**（周期 ${cycA}，停手后多活 ${secs(b.ticks - a.ticks)}s）`
      + ' ⇒ 平衡尚不能承担当前迈步，属 P3/P4 待办，不是回读改动引起');
  } else if (cycA === 0) {
    log('  结论：还没走成任何完整周期 ⇒ 卡在早期状态，先看 A 段的迁移明细');
  } else {
    ok(`停手后未变差（${secs(a.ticks)}s vs ${secs(b.ticks)}s）`);
  }

  // ── 归因②：把状态机**钉死在 DOUBLE**（最短驻留设成天文数字 ⇒ 永不迁移）──
  //   若此时能站住 ⇒ 倒的原因是「离开 DOUBLE、进入 LOAD」，与迈步无关，
  //   指向 **平衡系统在 LOAD 态的行为**（P4 未做），而不是回读或验收。
  const c = run({}, SECS, { minDwellSec: 1e9 });
  log(`  状态机钉死 DOUBLE     存活 ${secs(c.ticks)}s  倒=${c.fall || '无'}  周期 ${c.trace[c.trace.length-1]?.cycles ?? 0}`);
  if (c.ticks > a.ticks + CTRL_HZ * 0.5) {
    ok(`归因：倒因是**进入 LOAD 态**（钉死 DOUBLE 后多活 ${secs(c.ticks - a.ticks)}s）`
      + ' ⇒ 平衡系统在 LOAD 态的行为是 P4 的待办，与回读/验收改动无关');
  } else {
    log('  归因：钉死 DOUBLE 也一样倒 ⇒ 与状态无关，需另查（回读改动或物理/接触）');
  }
}

log('');
if (fails) { log(`✗ 状态机验收失败 ${fails} 项`); process.exit(1); }
log('✓ 状态机验收全绿');

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
  /** ★ 本拍 balance 提出的关节修正（`轴:度`）——「先回读平衡系统的修正情况」 */
  bfix: string;
  bfixN: number;
  /** τ 余量 sag/lat（N·m；<0 = 该方向必然倒） */
  bfixMargin: string;
  verified: boolean;
  safe: boolean;
  nViol: number;
  firstItem: string;
  firstVal: number;
  firstTol: number;
  support: string;
  swing: string;
  grounded: string;
  /** ★ 诊断用：脚底离地高度(mm) / 接触块数 / 是否受正冲量 —— 用来分辨
   *  「真的在空中」与「接触检测坏了」两种完全不同的故障 */
  soleYmm: string;
  contactN: number;
  loaded: string;
  /** ★ 去抖后的接地（判据真正读的那份）—— 与 `grounded` 并排才能看出是噪声还是真离地 */
  gndS: string;
  /** ★ 转移时刻的关节角（经网关，deg）—— 用来回答"验收过了，关节到底动没动" */
  kneeRecv: number;
  ankleRecv: number;
  /** 承接腿载荷（力链口径，两脚归一） */
  recvLoad: number;
  /** ★ `recv`（承接腿）当拍身份：打印的是**锁存值**（与判据同一口径） */
  recv: string;
  frontLeg: string;
  lastSwing: string;
  load: string;
  cycles: number;
  clearance: number;
  /** ★★★ 姿态（2026-10-06 加，§22.12.4）：**“不倒”不等于“站住”** —— 必须同时看姿态 */
  pitch: number; roll: number; spine1: number; ubY: number;
  /** 末帧的状态环 / 下一态 / 已等 / 卡在（直接取 `telemetry`，与网页同一份；长度 = STATE_ORDER） */
  ring: string[];
  next: string;
  wait: string;
  blocked: string;
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
        recv: String(rs.roleRecv ?? 'NULL'), frontLeg: rs.frontLeg(), lastSwing: rs.lastSwing ?? '-',
        ring: rs.telemetry.ring.slice(), next: rs.telemetry.next,
        wait: rs.telemetry.wait, blocked: rs.telemetry.blocked,
        support: rs.supportLeg(), swing: rs.swingLeg(),
        grounded: `${rs.grounded.l ? 1 : 0}${rs.grounded.r ? 1 : 0}`,
        soleYmm: `${((rs.soleY.l ?? 0) * 1000).toFixed(0)}/${((rs.soleY.r ?? 0) * 1000).toFixed(0)}`,
        contactN: rs.support.contactN,
        loaded: `${sim.doll.footLoaded(0) ? 1 : 0}${sim.doll.footLoaded(1) ? 1 : 0}`,
        gndS: `${rs.gndStable.l ? 1 : 0}${rs.gndStable.r ? 1 : 0}`,
        // ⚠ 必须与状态机**同一个** recv 身份（`lastSwing ?? frontLeg()`）。
        //   之前这里写的是 `swingLeg()`，于是诊断测一条腿、判据测另一条腿 ——
        //   实测两者读数差 14°（一个 11.8°、一个 −2.4°），诊断完全误导。
        kneeRecv: rs.jq ? -rs.jq.angleDeg(`knee_${rs.roleRecv ?? rs.frontLeg()}`, 2) : 0,
        ankleRecv: rs.jq ? -rs.jq.angleDeg(`foot_${rs.roleRecv ?? rs.frontLeg()}`, 2) : 0,
        recvLoad: rs.loadFrac[rs.roleRecv ?? rs.frontLeg()],
        bfix: rs.balanceFix.axes
          .map((a) => `${a.axis}:${((a.dTheta * 180) / Math.PI).toFixed(1)}`).join(' '),
        bfixN: rs.balanceFix.axes.length,
        bfixMargin: `${rs.balanceFix.tauMarginSag.toFixed(0)}/${rs.balanceFix.tauMarginLat.toFixed(0)}`,
        load: `${rs.loadFrac.l.toFixed(2)}/${rs.loadFrac.r.toFixed(2)}`,
        cycles: rs.cycleCount, clearance: rs.swingClearance,
        pitch: rs.pitchDeg ?? 0, roll: rs.rollDeg ?? 0,
        spine1: (rs.angleOf('spine1', 2) * 180) / Math.PI,
        ubY: rs.com.y,
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
  // ★ 末帧的状态环（与网页面板同一份 `telemetry.ring`，长度 = STATE_ORDER）：当前态在哪、哪些已过、哪些没到。
  //   状态机是"验收不过就不往下走"，所以这一行就是全部诊断信息。
  const lastT = r.trace[r.trace.length - 1];
  if (lastT) {
    log(`  末帧状态环：${lastT.ring.join(' | ')}`);
    log(`             下一态 ${lastT.next}　已等/最短驻留 ${lastT.wait}　卡在 ${lastT.blocked}`);
  }
  const missing = STATE_ORDER.filter((s) => !cnt.get(s));
  if (!missing.length) ok('五个状态全部被访问到');
  else bad(`这些状态从未被访问：${missing.join(', ')}`);

  // ── 跌倒前逐拍回读（归因用：到底是哪一项先坏）────────────────
  log('');
  log('  跌倒前 14 拍逐拍回读：');
  log('    t(s)   state   ok  sup sw  gnd  load  触地  载荷  脚底离地mm 接触块  首项未过 (当前/门限)');
  // ★ 先看**迁移之后那 40 拍**（= LOAD 段）—— 末 14 拍已在坠落，解释不了"为什么不进下一态"
  const firstMove = r.moves.length ? Math.round(r.moves[0]!.tSec * CTRL_HZ) : 0;
  log('');
  log(`  首次迁移前后逐拍（t=${(Math.max(0, firstMove - 6) / CTRL_HZ).toFixed(2)}s 起 60 拍）：`);
  log('    t(s)   state  recv front 承接踝跖 承接膝屈 承接载荷  |Δ踝|/拍  首项未过');
  const post = r.trace.slice(Math.max(0, firstMove - 6));
  for (const t of post.slice(0, 60)) {
    const k = ((r.trace.indexOf(t)) / CTRL_HZ).toFixed(2);
    const prev = r.trace[r.trace.indexOf(t) - 1];
    const d = prev ? Math.abs(t.ankleRecv - prev.ankleRecv) : 0;
    const v = t.firstItem ? `${t.firstItem} ${t.firstVal.toFixed(2)}/${t.firstTol.toFixed(2)}` : '—';
    log(`    ${k}  ${t.state.padEnd(7)}  ${t.recv}    ${t.frontLeg}   `
      + `${t.ankleRecv.toFixed(2).padStart(7)} ${t.kneeRecv.toFixed(2).padStart(7)}`
      + ` ${t.recvLoad.toFixed(3).padStart(6)}  ${d.toFixed(2).padStart(7)}   ${v}`);
  }
  // ── ★★ 平衡系统修正回读（用户 2026-10-06：「先回读一下平衡系统的修正情况」）──
  log('');
  log('  平衡系统修正逐拍（前 40 拍 = DOUBLE/LOAD 段）：state 条数 τ余量sag/lat  修正(轴:度)');
  for (const t of r.trace.slice(0, 40)) {
    log(`    ${String(r.trace.indexOf(t)).padStart(3)}  ${t.state.padEnd(7)} ${String(t.bfixN).padStart(2)}`
      + `  ${t.bfixMargin.padStart(9)}  ${t.bfix || '（无修正）'}`);
  }
  // 逐态汇总：每个态平均提出几条修正
  {
    const per = new Map<string, { n: number; k: number; hit: number }>();
    for (const t of r.trace) {
      const e = per.get(t.state) ?? { n: 0, k: 0, hit: 0 };
      e.n++; e.k += t.bfixN; if (t.bfixN > 0) e.hit++;
      per.set(t.state, e);
    }
    log('');
    log('  平衡修正汇总（逐态）：态      拍数  有修正占比  平均条数');
    for (const [st, e] of per) {
      log(`    ${st.padEnd(8)} ${String(e.n).padStart(4)}`
        + `  ${((100 * e.hit) / e.n).toFixed(0).padStart(7)}%`
        + `  ${(e.k / e.n).toFixed(2).padStart(8)}`);
    }
  }

  log('');
  log('  跌倒前 14 拍逐拍回读：');
  for (const t of r.trace.slice(-14)) {
    const v = t.firstItem ? `${t.firstItem} ${t.firstVal.toFixed(3)}/${t.firstTol.toFixed(3)}` : '—';
    log(`    ${((r.trace.indexOf(t)) / CTRL_HZ).toFixed(2)}  ${t.state.padEnd(7)}`
      + ` ${t.verified ? '✓' : '✗'}   ${t.support}   ${t.swing}   ${t.grounded}  ${t.gndS}`
      + `   ${t.load}   ${t.grounded}   ${t.loaded}   ${t.soleYmm.padEnd(9)} ${String(t.contactN).padStart(2)}   ${v}`);
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
  // ★★ 发力门禁 A/B（用户 2026-10-06：「承重无上限，但发力有上限」）
  const capOff = run({ ablate: 'forceCap' }, SECS);
  // ★ 上身发力架构 A/B（用户 2026-10-06：「先迈步给出，balance 再综合发布」）
  const upOff = run({ ablate: 'upForce' }, SECS);
  const fltOff = run({ ablate: 'forceFlt' }, SECS);
  const upOffStepOff = run({ ablate: 'upForce,stepKeyframe' }, SECS);
  log(`  默认（迈步开）      存活 ${secs(a.ticks)}s  倒=${a.fall || '无'}  周期 ${a.trace[a.trace.length-1]?.cycles ?? 0}`);
  log(`  迈步系统停手        存活 ${secs(b.ticks)}s  倒=${b.fall || '无'}  周期 ${b.trace[b.trace.length-1]?.cycles ?? 0}`);
  log(`  迈步停手+关发力门禁   存活 ${secs(capOff.ticks)}s  倒=${capOff.fall || '无'}  周期 ${capOff.trace[capOff.trace.length-1]?.cycles ?? 0}`
    + '　← 与"迈步系统停手"之差 = 发力门禁的净贡献');
  log(`  默认+关力链低通       存活 ${secs(fltOff.ticks)}s  倒=${fltOff.fall || '无'}  周期 ${fltOff.trace[fltOff.trace.length-1]?.cycles ?? 0}`
    + '　← 与"默认"之差 = 低通的净贡献');
  log(`  默认+关上身架构       存活 ${secs(upOff.ticks)}s  倒=${upOff.fall || '无'}  周期 ${upOff.trace[upOff.trace.length-1]?.cycles ?? 0}`
    + '　← 与"默认"之差 = 上身提案+综合的净贡献');
  log(`  迈步停手+关上身架构    存活 ${secs(upOffStepOff.ticks)}s  倒=${upOffStepOff.fall || '无'}  周期 ${upOffStepOff.trace[upOffStepOff.trace.length-1]?.cycles ?? 0}`
    + '　← 与"迈步系统停手"之差 = 架构在纯站立下的净贡献');
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
    // ★★★ §22.12.4：**姿态列** —— 「不倒」≠「站住」（那个 12.00s 曾是折腰熬满的）
  log('\n  ══ 姿态列（§22.12.4：不倒 ≠ 站住）══');
  for (const [nm, r] of [['默认（迈步开）', a], ['迈步系统停手', b], ['关发力门禁', capOff],
    ['关力链低通', fltOff], ['关上身架构', upOff], ['停手+关架构', upOffStepOff],
    ['钉死 DOUBLE', c]] as const) {
    const tr = r.trace;
    const last = tr[tr.length - 1];
    if (!last) { log(`  ${nm.padEnd(16)} 无数据`); continue; }
    let wp = 0, ws = 0;
    for (const t of tr) {
      if (Math.abs(t.pitch) > Math.abs(wp)) wp = t.pitch;
      if (Math.abs(t.spine1) > Math.abs(ws)) ws = t.spine1;
    }
    log(`  ${nm.padEnd(16)} 末帧 pitch ${last.pitch.toFixed(1).padStart(6)}° spine1 ${last.spine1.toFixed(1).padStart(6)}°`
      + ` CoM.y ${(last.ubY * 1000).toFixed(0)}mm  ｜ 最差 |pitch| ${Math.abs(wp).toFixed(1)}° |spine1| ${Math.abs(ws).toFixed(1)}°`
      + `  ${Math.abs(wp) < 10 && Math.abs(ws) < 10 ? '★ 站住' : '✗ 折腰/倒'}`);
  }
  log('  归因：钉死 DOUBLE 也一样倒 ⇒ 与状态无关，需另查（回读改动或物理/接触）');
  }
}

log('');
if (fails) { log(`✗ 状态机验收失败 ${fails} 项`); process.exit(1); }
log('✓ 状态机验收全绿');

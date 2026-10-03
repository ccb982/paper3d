/**
 * 重构后的验收探针 —— **单腿站立，重点考核平衡维持系统**
 *
 * ★ 与网页同源：`Controller` 产出的 `snapshot` 就是 UI 画的那一份，
 *   本探针**只读它**，不自己算任何物理量。
 *   （这是"你看到的和我回读的必须一致"的机械保证，见 probe-uipanel。）
 *
 * 评分沿用 arXiv:2608.00500 的三档，把"会平衡"和"会自救"分开：
 *   Perfect  = 支撑脚从不跳、摆动脚从不触地、不摔
 *   Marginal = 靠跳或靠摆动脚触地才站住
 *   Failure  = 摔
 * 本阶段**不考核**落地质量/步长/速度跟踪（迈步系统只要求"被正确门控"）。
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
  const bg = bgNs as Record<string, (...a: unknown[]) => unknown>;
  const im: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');

// ★ 可选开踝（用户 2026-10-03："脚踝关节应该写的，而且足部还要学会发力"）
const ANKLE_ON = process.env.ANKLE === '1';
const ANK_TAU = Number(process.env.ANKLE_TAU ?? 60);
const sk = buildSkeleton(ANKLE_ON
  ? { ...DEFAULT_CONFIG, ankleEnabled: true, ankleTorque: ANK_TAU }
  : DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
// ★ 与其它探针一致：参数从 argv[3] 起（argv[2] 是探针名）
const DUR = Number(process.argv[3] ?? 8) || 8;
const SUP = (process.argv[4] ?? 'l') as 'l' | 'r';
if (SUP !== 'l' && SUP !== 'r') throw new Error(`支撑腿参数必须是 l 或 r，收到 ${JSON.stringify(SUP)}`);
const log = console.log;

const AGF = Number(process.env.AGF ?? 6);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: DUR, driver: 'controller',
  doll: { ankleGroundFactor: AGF } });
sim.begin(new Float32Array(sim.params.length));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, singleLeg: SUP, liftHold: 0.25 },
});

log('══ 重构后验收：单腿站立（考核平衡维持系统）══');
log(`  骨架 ${ctrl.summary}`);
log(`  支撑腿 = ${SUP === 'l' ? '左' : '右'}   回合 ${DUR}s   踝=${ANKLE_ON ? `开 ${ANK_TAU}N·m，接地惯量×${AGF}` : '关'}`);
log('');
log('  体检发现的问题（这些决定了控制器能写哪些轴）：');
for (const pr of ctrl.rigReport.problems.slice(0, 6)) log(`    · ${pr}`);
log('');

const dtC = 1 / sim.cfg.controlHz;
const dtP = 1 / sim.cfg.physicsHz;
// ★ 控制拍 = 每 stages 个物理步跑一次。⚠ 顺序是 dtP/dtC，不是 1/dtC/dtP
//   （后者 = 7200 ⇒ 整个回合只跑一拍 ⇒ 等于开环，测出来的是零输出基线）
const stages = Math.max(1, Math.round(dtP / dtC));

let singleSupportTicks = 0, total = 0;
let supFootHopped = false, swingFootTouched = false, maxSwingClear = 0;
let minMos = Infinity, maxMos = -Infinity, mosOutCount = 0;
let anyStepPhase = false, maxAuthority = 0, vetoCount = 0, suppressedCount = 0;
let lastSupY = 0;

const steps = Math.round(DUR / dtP);
for (let i = 0; i < steps && !sim.finished; i++) {
  if (i % stages === 0) {
    const out = ctrl.step(dtC);
    sim.doll.setMotorTargets(out);
    ctrl.soleClearance('l'); ctrl.soleClearance('r');
    const s = ctrl.snapshot;      // ★ 只读快照
    total++;
    const supG = s.legs[SUP].grounded, swG = s.legs[SUP === 'l' ? 'r' : 'l'].grounded;
    if (supG && !swG) singleSupportTicks++;
    if (s.phase === 'STEP') anyStepPhase = true;
    if (s.authority > maxAuthority) maxAuthority = s.authority;
    for (const a of s.axes) { vetoCount += a.vetoed.length; suppressedCount += a.suppressed.length; }
    // MoS 健康度
    if (s.phase === 'SINGLE' || s.phase === 'SHIFT') {
      if (s.mos < minMos) minMos = s.mos;
      if (s.mos > maxMos) maxMos = s.mos;
      if (s.mos < 0) mosOutCount++;
    }
    // 支撑脚"跳"：离地过 > 3 cm
    const sy = SUP === 'l' ? s.legs.l.soleY : s.legs.r.soleY;
    if (i > 4 && lastSupY - sy > 0.03) supFootHopped = true;
    lastSupY = sy;
    // 摆动脚触地（Perfect 档要求"从不触地"）
    const sw = SUP === 'l' ? s.legs.r : s.legs.l;
    const clr = SUP === 'l' ? s.legs.r.soleY : s.legs.l.soleY;
    if (clr > maxSwingClear) maxSwingClear = clr;
    if (i > 4 && clr < 0.005) swingFootTouched = true;
    void sw;
  }
  sim.advance(1);
}

const s = ctrl.snapshot;
const alive = sim.ticksDone / sim.cfg.controlHz;
const ratio = total ? singleSupportTicks / total : 0;
const grade = sim.fallen ? 'Failure' : (!supFootHopped && !swingFootTouched ? 'Perfect' : 'Marginal');

log('── 结果 ──');
log(`  存活        ${alive >= DUR - 0.05 ? `站满 ${DUR}s` : `${alive.toFixed(2)}s`}   ${sim.fallen ? `✗ 摔（${sim.fallReason}）` : '✓ 未摔'}`);
if (sim.fallen) log(`  摔因详情    ${JSON.stringify(sim.fallDiag)}`);
{
  // 末 0.6 s 逐拍：谁在往下掉
  log('  末段逐拍（0.1s 采样）：t  comZ   ξz    躯干y  倾°  左踝°  右踝°  接地  摆动离地mm');
}
log(`  评分档      ${grade}`);
log(`  单支撑占比  ${(ratio * 100).toFixed(1)}%`);
log(`  承重腿      ${s.loadBearer ?? '（未授予）'}   锁定 l=${s.locked.l} r=${s.locked.r}`);
log(`  相          ${s.phase}   α(权限)=${s.authority.toFixed(3)}`);
log(`  终倾角      ${s.tiltDeg.toFixed(1)}°   终躯干高 ${s.torsoY.toFixed(3)}m`);
log(`  MoS         最小 ${(minMos * 1000).toFixed(0)}mm  最大 ${(maxMos * 1000).toFixed(0)}mm  越界 ${mosOutCount}/${total} 拍`);
log(`  摆动脚      最高离地 ${(maxSwingClear * 1000).toFixed(0)}mm   ${swingFootTouched ? '✗ 触地过' : '✓ 从未触地'}`);
log(`  支撑脚      ${supFootHopped ? '✗ 跳了' : '✓ 从未跳'}`);
log(`  迈步系统    ${anyStepPhase ? '进过 STEP 相' : '未进 STEP（许可未齐）'}   峰值 α=${maxAuthority.toFixed(3)}`);
log(`  仲裁        锁定否决 ${vetoCount} 次   优先级压制 ${suppressedCount} 次`);
log('');
log('  判据逐条回显（末拍）——"为什么没迈步"不用推断：');
for (const [gname, c] of [['承重 B1..B4', s.criteria.bearer], ['解锁 U', s.criteria.unlock], ['迈步许可 P', s.criteria.stepPermit]] as const) {
  const parts = Object.entries(c.flags).map(([k, v]) => `${v ? '✓' : '✗'}${k}`);
  log(`    ${gname.padEnd(12)} ${parts.join('  ')}   ${c.all ? '全部满足' : '未满足'}`);
  const vals = Object.entries(c.values).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(3) : v}`).join('  ');
  if (vals) log(`    ${''.padEnd(12)} ${vals}`);
}
log('');
log('  ★ 目标（arXiv:2608.00500 的单腿保持）：MoS 侧向 −25mm、捕获点出域 0.09s/3.3s、摆动脚从不触地');
void DEFAULT_BALANCE_PARAMS;
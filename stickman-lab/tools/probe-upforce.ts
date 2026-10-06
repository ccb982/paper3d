/**
 * ══════════════════════════════════════════════════════════════════
 * probe-upforce.ts —— **上身的受力基线**（力从脚往上传到了什么程度）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06 定调（设计 §22.7 上身发力规则的前置）：
 *   「迈步系统和平衡系统的**上身发力都需要好好设计**」
 *   「顺序是**先迈步系统给出，然后平衡系统再综合这个给一个最终的上身发力状态**」
 *   「力是从脚、从腿往上传的，**盲目发力就是会折腰**」
 *
 * 本探针回答：**现在**上身到底在被谁推、推多大、方向对不对。
 *   A 传递力：逐关节子树约束力 `F = m·(a−g)`（自下而上，踝→膝→髋→脊柱→…）
 *   B 上身姿态：脊柱各轴角度（域口径：正=屈）+ 实际施加 τ + 让位掩码
 *   C 迈步的提案：`rs.stepProps` 逐条（上身的那些是谁在要、要多少）
 *   D balance 的综合：`disposeStat`（几条被原样发布/限幅）+ 发力门禁被夹次数
 *
 * 用法：node tools/run.mjs probe-upforce [secs]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 2);
// ★ 第 2 参 = 消融名（用于复现「迈步系统停手」那个 12s 用例，看点它到底什么姿态）
const ABL = (ARGS[1] ?? '').trim();
const HZ = 60, DT = 1 / HZ;
const DEG = 57.2958;

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll;
const rv = new Float64Array(3);

// 自下而上的观察顺序（力链的物理次序）
const CHAIN = ['foot_l', 'knee_l', 'hip_l', 'arch_l', 'mfoot_l',
  'spine1', 'spine2', 'spine3', 'torso', 'head'];
const IDX = CHAIN.map((n) => ({ n, i: jointIndexByName(sk, n) }));
// `torso`/`head` 不是关节名（是刚体）⇒ 从 forceBuf 里取不到；过滤掉
const JOINTS = IDX.filter((x) => x.i >= 0);

log('══ A. 逐关节传递力（子树约束力 `F = m·(a−g)`，自下而上）══');
log('   轴约定：fx=矢状(前)  fy=竖直  fz=额状(左)；`mass` = 该关节子树的总质量');
log('');
log('   t(s)  关节      子树质量    Fx      Fy      Fz     |F|     角度      实际τ     归属');
for (let i = 0; i < SECS * 120 && !sim.finished; i++) {
  if (i % 2 === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % 20 !== 0) continue;
  const rs = ctrl.rs;
  const fc = rs.forceChain();
  if (!fc.ready) { log(`   ${(i / 120).toFixed(2)}  （力链未就绪：速度环未填满）`); continue; }
  // 每 20 拍只打一次完整链，避免刷屏
  log(`   ── t=${(i / 120).toFixed(2)}s  状态 ${rs.state}  躯干倾角 ${rs.tiltDeg.toFixed(1)}°`);
  for (const { n, i: ji } of JOINTS) {
    const j = fc.joints[ji]!;
    d.jointRot(ji, rv);
    const sag = -rv[2]! * DEG;          // 域口径：正 = 屈
    const tau = d.tauApplied[ji * 3 + 2] ?? 0;
    const own = rs.axisOwner(ji * 3 + 2);
    const hold = rs.holdMask[ji * 3 + 2] ?? 0;
    log(`     ${n.padEnd(8)} ${j.mass.toFixed(1).padStart(7)}kg `
      + `${j.fx.toFixed(0).padStart(7)} ${j.fy.toFixed(0).padStart(7)} ${j.fz.toFixed(0).padStart(7)}`
      + ` ${j.f.toFixed(0).padStart(6)}`
      + `  ${sag.toFixed(1).padStart(6)}°  ${tau.toFixed(0).padStart(6)}`
      + `  ${own}${hold ? `/让位${hold}` : ''}`);
  }
  // C+D：迈步提案与 balance 的综合结果
  const up = rs.stepProps.filter((p) => /spine/.test(sk.joints[Math.floor(p.i / 3)]?.name ?? ''));
  if (up.length) {
    log(`     ── 迈步对**上身**的提案 ${up.length} 条：`
      + up.map((p) => `${sk.joints[Math.floor(p.i / 3)]!.name}/${p.i % 3}=${(p.rad * DEG).toFixed(1)}°(${p.label})`).join('  '));
  }
  // ★ 上身发力状态全量（用户定调的那个"最终上身发力状态"）
  {
    const ub = rs.upperBody;
    log(`     ── 上身状态：质量 ${ub.mass.toFixed(1)}kg  作用点 (${ub.comX.toFixed(3)}, ${ub.comY.toFixed(3)}, ${ub.comZ.toFixed(3)})`);
    log(`        迈步提案 pitch=${(ub.step.pitch * DEG).toFixed(1)}° roll=${(ub.step.roll * DEG).toFixed(1)}°`
      + `　balance 修正 pitch=${(ub.corrPitch * DEG).toFixed(1)}° roll=${(ub.corrRoll * DEG).toFixed(1)}°`);
    log(`        块⑧执行 ${rs.ubRuns} 次　质量缓存 ${ub.mass.toFixed(1)}kg　decidedBy=${ub.decidedBy}`);
    log(`        最终 final pitch=${(ub.final.pitch * DEG).toFixed(1)}° roll=${(ub.final.roll * DEG).toFixed(1)}°`
      + `　由 ${ub.decidedBy} 定　力 (${ub.force.fx.toFixed(0)}, ${ub.force.fy.toFixed(0)}, ${ub.force.fz.toFixed(0)})N`);
  }
  const ds = rs.disposeStat;
  log(`     ── balance 综合：提案 ${ds.props} → 发布 ${ds.republished}（覆盖 ${ds.overridden}）k=${ds.k.toFixed(2)}`
    + `　发力门禁夹 ${rs.capHits.req} 次`
    + (rs.capLast.axis >= 0 ? `（最近 轴${rs.capLast.axis} 想${rs.capLast.want.toFixed(0)}→${rs.capLast.cap.toFixed(0)}N·m）` : ''));
  log('');
}

log(`存活 ${(sim.ticksDone / 60).toFixed(2)}s  死因 ${sim.fallReason || '未倒'}`);

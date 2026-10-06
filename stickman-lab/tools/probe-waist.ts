/**
 * ══════════════════════════════════════════════════════════════════
 * probe-waist.ts —— **腰部借力**的最小验证（重构第 0 步）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：「**本来就没站起来，一直是折腰状态的**。
 *   我觉得还是**腰部借力让腰挺起来**概率大点」
 * ⇒ 在重构之前，先**只测这一件事**（§22.12 的基准问题正出在这里）：
 *
 *   A. 给脊柱写一个**角度目标**（+10°）：位置伺服**出不出力矩**？腰**动不动**？
 *   B. `requestAngleCorr`（修正增量）在**没人写目标**（`bind`）时能不能单独挺起腰？
 *   C. 什么都不写（`none`）时的对照 —— 这就是"折腰"的基线。
 *
 * 用法：`node tools/run.mjs probe-waist [秒数] [tgt|corr|none]`
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
const SECS = Number(ARGS[0] ?? 3);
const MODE = (ARGS[1] ?? 'tgt').trim();
const HZ = 120, DT = 1 / HZ;
const R2D = 57.2958;

log(`══ probe-waist 模式=${MODE} 时长=${SECS}s（t=0 起注入 +10°）══`);
log('  t(s)  脊柱目标  spine1角  spine2角  spine3角   τ1   τ2   τ3  |ω|骨盆 pitch  CoM.z  Fz_l  Fz_r  胸高');

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  // ★ 迈步系统停手（只看"腰"）+ 上身架构关（否则块⑧会另写脊柱）
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: 'stepKeyframe,upForce' },
});
const d = sim.doll;
const j1 = jointIndexByName(sk, 'spine1');
const j2 = jointIndexByName(sk, 'spine2');
const j3 = jointIndexByName(sk, 'spine3');
if (j1 < 0) throw new Error('缺 spine1');

const rows: string[] = [];
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  const t = i * DT;
  // ★★ 从 t=0 就注入：混沌系统里"后来"的差异是发散不是因果，
  //   只有**前几拍**的差异才是机制的净效应（§22.12 的教训）
  const active = t >= 0.0;
  ctrl.rs.waistInject = active ? { mode: MODE, deg: 10 } : null;
  if (i % 2 === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % 4 !== 0) continue;
  const rs = ctrl.rs;
  const fa = (j: number) => (rs.angle(j, 2) * R2D);
  // 承重比例（已滤波，`Controller.step` 里算好）
  const zl = (rs.loadFrac.l ?? 0) * 100;
  const zr = (rs.loadFrac.r ?? 0) * 100;
  if (rows.length === 0) {
    log(`   [诊断] acorrStat=${rs.acorrStat.length} badRequests=${rs.badRequests}`
      + ` reqCount=${rs.requestCount} span1=${(() => { const dj = sk.joints[j1]!; return Math.max(Math.abs(dj.minRad[2]), Math.abs(dj.maxRad[2])).toFixed(3); })()}`);
  }
  rows.push(
    `${t.toFixed(2).padStart(6)}`
    + `${(active && MODE === 'tgt' ? '+10°' : active && MODE === 'corr' ? '修正' : ' — ').padStart(9)}`
    + `${fa(j1).toFixed(1).padStart(10)}`
    + `${fa(j2).toFixed(1).padStart(10)}`
    + `${fa(j3).toFixed(1).padStart(10)}`
    + `${(d.tauApplied[j1 * 3 + 2] ?? 0).toFixed(0).padStart(6)}`
    + `${(d.tauApplied[j2 * 3 + 2] ?? 0).toFixed(0).padStart(5)}`
    + `${(d.tauApplied[j3 * 3 + 2] ?? 0).toFixed(0).padStart(5)}`
    + `${(rs.pelvisW ?? 0).toFixed(0).padStart(7)}`
    + `${(rs.pitchDeg ?? 0).toFixed(1).padStart(6)}`
    + `${(rs.com.z * 1000).toFixed(0).padStart(7)}`
    + `${zl.toFixed(0).padStart(5)}%`
    + `${zr.toFixed(0).padStart(5)}%`
    + `${(rs.com.y * 1000).toFixed(0).padStart(7)}`,
  );
}
log(rows.join('\n'));
log(`\n存活 ${sim.t.toFixed(2)}s（上限 ${SECS}s）`);

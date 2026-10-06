/**
 * ══════════════════════════════════════════════════════════════════
 * probe-foot01.ts —— **前 0.1s：脚的力链为前后（矢状）修正做了什么**
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户：「还是看**前 0.1s**，**脚的力链**为了修正**前后侧偏移**做了什么」。
 *
 * 逐控制拍（60Hz）打出：
 *   · 任务量：`CoM.x` / `vx` / 捕获点 `ξ = dcm.x` / 全局 CoP.x / 误差
 *   · **左脚 / 右脚**：竖向力 `fz`、压力中心 `copX`、**前后切向力 `fx`**、块数
 *   · **踝（支撑侧）**：实际施加 τ、关节角、分支（1=PD 2=让位 3/4=限位）
 *   · 任务层需求：把 CoP 放到 ξ 需要的踝力矩 `τ_need = Fz·(CoP−ξ)`（Winter 1995）
 *
 * 用法：`node tools/run.mjs probe-foot01 [秒数=0.12]`
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 0.12);
const ABL = (ARGS[1] ?? '').trim();
const HZ = 120, DT = 1 / HZ, PER = 2;
const sk = buildSkeleton(DEFAULT_CONFIG);
const jn = sk.joints.map((j) => j.name);
const jAnkL = jn.indexOf('foot_l'), jAnkR = jn.indexOf('foot_r');

log(`══ probe-foot01 前 ${SECS}s：脚的力链的前后修正逐拍（控制 ${HZ / PER}Hz）${ABL ? ` 消融[${ABL}]` : ''} ══`);
log('   t(s) 状态  CoM.x   vx    ξ     CoP.x  CoP−ξ | 左:fz  copX   fx | 右:fz  copX   fx | 踝 τ_施/角/分支 | τ_need');
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll;
const rs = ctrl.rs;
const mm = (v: number): string => (v * 1000).toFixed(1).padStart(6);
const f1 = (v: number): string => v.toFixed(1).padStart(6);
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % PER !== 0) continue;
  const t = i / HZ;
  const fl = d.soleForceProfile(0, DT), fr = d.soleForceProfile(1, DT);
  const wsum = (fl.copValid ? fl.fz : 0) + (fr.copValid ? fr.fz : 0);
  const copX = wsum > 1 ? ((fl.copValid ? fl.fz * fl.copX : 0) + (fr.copValid ? fr.fz * fr.copX : 0)) / wsum : 0;
  const xi = rs.dcm.x;
  // 支撑侧 = supportLeg；取其踝
  const supS = rs.supportLeg();
  const jA = supS === 'l' ? jAnkL : jAnkR;
  const tau = d.tauApplied[jA * 3 + 2] ?? 0;
  const jr = new Float64Array(3); d.jointRot(jA, jr);
  const br = d.motorBranch[jA * 3 + 2] ?? 0;
  const fzSup = supS === 'l' ? fl.fz : fr.fz;
  const tauNeed = fzSup * (copX - xi);   // Winter 1995：把 CoP 放到 ξ 需要的踝矩
  const plan = rs.copPlan ?? { needX: NaN, overX: NaN, errX: NaN, kX: NaN, actionability: NaN, fallNeeded: false, region: '—' };
  log(`   ${t.toFixed(3)} ${rs.state === 'DOUBLE' ? 'DBL ' : rs.state.slice(0, 4)} ${mm(rs.com.x)} ${mm(rs.com.vx)} ${mm(xi)} ${mm(copX)} ${mm(copX - xi)}`
    + ` |${f1(fl.fz)} ${mm(fl.copX)} ${f1(fl.fx)} |${f1(fr.fz)} ${mm(fr.copX)} ${f1(fr.fx)}`
    + ` | ${f1(tau)} ${f1(jr[2]! * 57.2958)}° b${br} | ${f1(tauNeed)}   sup=${supS}`
    + ` | 计划 need=${mm(plan.needX)} over=${mm(plan.overX)} err=${mm(plan.errX)} k=${plan.kX.toFixed(2)} 可救=${plan.actionability.toFixed(2)}${plan.fallNeeded ? '★落足' : ''} ${plan.region}`);
}

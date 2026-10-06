/**
 * ══════════════════════════════════════════════════════════════════
 * probe-jointtrace.ts —— **全时段关节轨迹 + 限位/τ 违例扫描**
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户：「**回读看看有没有出问题，读完整的关节变化**」。
 *
 * 每 `STEP` 秒打一行：18 个关节各取**三轴里最歪的那个**（角度°、该轴限位、
 * 是否越界标记），加上该关节的 τ 峰值。末尾给**全程违例清单**（角度越限位 / τ 打满）。
 *
 * 用法：`node tools/run.mjs probe-jointtrace [秒数=12] [间隔=0.5]`
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
const SECS = Number(ARGS[0] ?? 12);
const STEP = Number(ARGS[1] ?? 0.5);
const HZ = 120, DT = 1 / HZ, PER = 2;
const DEG = 180 / Math.PI;
const sk = buildSkeleton(DEFAULT_CONFIG);
const NJ = sk.joints.length;

log(`══ probe-jointtrace ${SECS}s（每 ${STEP}s 一行；每关节取三轴里最歪的）══`);
// 表头
log('  t(s) ' + sk.joints.map((j) => j.name.slice(0, 6).padStart(7)).join(''));

const sim = new Sim(sk, shapeForJoints(NJ), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
});
const d = sim.doll;
const jr = new Float64Array(3);
const trace = new Float64Array(NJ * 3);          // 峰值 |角度|（带符号记录最大值）
const tauPeak = new Float64Array(NJ * 3);
const violAng: string[] = [];
const violTau: string[] = [];
let nextT = 0;
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  const t = i / HZ;
  // 记录全程峰值
  for (let j = 0; j < NJ; j++) {
    d.jointRot(j, jr);
    for (let a = 0; a < 3; a++) {
      const ang = jr[a]! * DEG;
      if (Math.abs(ang) > Math.abs(trace[j * 3 + a]!)) trace[j * 3 + a] = ang;
      const tau = d.tauApplied[j * 3 + a] ?? 0;
      if (Math.abs(tau) > Math.abs(tauPeak[j * 3 + a]!)) tauPeak[j * 3 + a] = tau;
    }
  }
  if (t + 1e-6 < nextT) continue;
  nextT += STEP;
  const cells: string[] = [];
  for (let j = 0; j < NJ; j++) {
    d.jointRot(j, jr);
    let worst = 0, k = 0;
    for (let a = 0; a < 3; a++) {
      const v = Math.abs(jr[a]! * DEG);
      if (v > worst) { worst = v; k = a; }
    }
    const lim = sk.joints[j]!.maxRad[k]! * DEG;
    const min = sk.joints[j]!.minRad[k]! * DEG;
    const ang = jr[k]! * DEG;
    const out = ang > lim + 0.5 || ang < min - 0.5;
    cells.push((out ? '*' : ' ') + `${worst.toFixed(0)}`.padStart(5) + `/${lim.toFixed(0)}`.padStart(4));
  }
  log(`  ${t.toFixed(2).padStart(5)}` + cells.join(''));
}
log('\n── 全程违例清单（* = 曾越限位 >0.5°；τ = 曾打满对应 τmax）──');
for (let j = 0; j < NJ; j++) {
  const jj = sk.joints[j]!;
  const angHits: string[] = [];
  for (let a = 0; a < 3; a++) {
    const ang = trace[j * 3 + a]!;
    const lim = ang >= 0 ? jj.maxRad[a]! * DEG : jj.minRad[a]! * DEG;
    if (ang > jj.maxRad[a]! * DEG + 0.5 || ang < jj.minRad[a]! * DEG - 0.5) {
      angHits.push(`${jj.name}/${a} 峰值 ${ang.toFixed(1)}°（限位 ${lim.toFixed(0)}°）`);
    }
  }
  const tauHits: string[] = [];
  for (let a = 0; a < 3; a++) {
    const tmax = jj.maxTorque[a] ?? 0;
    const tp = Math.abs(tauPeak[j * 3 + a]!);
    if (tmax > 1 && tp >= tmax * 0.98) tauHits.push(`${jj.name}/${a} ${tauPeak[j * 3 + a]!.toFixed(0)}/${tmax.toFixed(0)}`);
  }
  if (angHits.length) violAng.push(`  ✗ ${angHits.join('；')}`);
  if (tauHits.length) violTau.push(`  τ满 ${tauHits.join('  ')}`);
}
log(`  角度越限位 ${violAng.length} 处：`);
for (const v of violAng) log(v);
log(`  τ 打满的轴（含引擎锁死的轴，那类无意义）：`);
for (const v of violTau) log(v);

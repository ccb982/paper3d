/**
 * probe-chain —— **整链逐帧回读**（预警包 → 提案包 → 实际修正）
 *
 *   每 1/60s 一行，展示三段链路在同一时刻的对应值：
 *     预警：MoS x/z、urgency、dir
 *     提案：state/角色、stepX/Z、shiftDemandF、copPlan.urg
 *     修正：W* 的 Fx/Fz（v4 实际在追的力）→ 腿链 τ
 *   用法：`node tools/run.mjs probe-chain [秒]`
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const c = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(c)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T = Number(ARGS[0] ?? 2);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const d = sim.doll;
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const jHipL = jointIndexByName(sk, 'hip_l') * 3 + 2;
const jKneeL = jointIndexByName(sk, 'knee_l') * 3 + 2;
const jAnkL = jointIndexByName(sk, 'foot_l') * 3 + 2;

const log = (s: string) => console.log(s);
log(`══ probe-chain 整链逐帧（${T}s @120Hz，每 2 拍行）══`);
log('     t   | 预警: MoSx MoSz urg dir | 提案: state/roles stepX shiftF urg | 修正: W*Fx W*Fz | τ髋 τ膝 τ踝');
const N = Math.round(T * HZ);
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 2 !== 0) continue;
  const w = (ctrl as unknown as { warning: Record<string, any> | null }).warning;
  const dg = (ctrl as unknown as { v4Diag: { Wt: number[] } | null }).v4Diag;
  const plan = rs.copPlan as Record<string, any> | null;
  log(
    `  ${t.toFixed(2)} |` +
    `${((w?.mosX as number ?? 0) * 1000).toFixed(0).padStart(6)}${((w?.mosZ as number ?? 0) * 1000).toFixed(0).padStart(6)}` +
    `${(w?.urgency as number ?? 0).toFixed(2).padStart(5)}${String(w?.dirX ?? 0).padStart(4)} |` +
    `${String(rs.state).padStart(6)}/${String(rs.roleSup)}${String(rs.roleSw)}` +
    `${((plan?.stepX as number) ?? 0).toFixed(2).padStart(7)}${(rs.shiftDemandF ?? 0).toFixed(0).padStart(6)}${((plan?.stepUrgent as number) ?? 0).toFixed(2).padStart(5)} |` +
    `${((dg?.Wt?.[0] as number) ?? 0).toFixed(0).padStart(6)}${((dg?.Wt?.[2] as number) ?? 0).toFixed(0).padStart(6)} |` +
    `${(d.tauApplied[jHipL] ?? 0).toFixed(0).padStart(5)}${(d.tauApplied[jKneeL] ?? 0).toFixed(0).padStart(5)}${(d.tauApplied[jAnkL] ?? 0).toFixed(0).padStart(5)}`,
  );
}

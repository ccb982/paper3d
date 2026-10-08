/**
 * probe-packages —— **预警包 + 提案包回读**（用户：两个包都要有回读）
 *
 *   每 0.1s 报：
 *     预警包：MoS x/z、TTB x/z、dir、urgency、reachable
 *     提案包：state/角色、copPlan 的 stepX/stepZ/urg、仲裁目标（腰/髋/摆动腿）
 *   用法：`node tools/run.mjs probe-packages [秒]`
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
const T = Number(ARGS[0] ?? 3);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const rs = (ctrl as unknown as { rs: Record<string, any> }).rs;
const HZ = 120, DT = 1 / HZ;
const jSp1 = jointIndexByName(sk, 'spine1') * 3 + 2;
const jHipL = jointIndexByName(sk, 'hip_l') * 3 + 2;

const log = (s: string) => console.log(s);
log(`══ probe-packages（${T}s）══`);
log('     t   | ── 预警包 ──                      | ── 提案包 ──');
log('         | MoSx  MoSz  TTBx  TTBz  dir urg re | state/sup/sw | stepX stepZ urg | tgt腰   tgt髋L');
const N = Math.round(T * HZ);
let bad = 0;
for (let k = 0; k <= N; k++) {
  ctrl.step(DT);
  sim.advance(2);
  const t = (k + 1) * DT;
  if (k % 12 !== 0) continue;
  const w = (ctrl as unknown as { warning: Record<string, number | boolean> | null }).warning;
  const plan = rs.copPlan as Record<string, number | boolean> | null;
  const st = String(rs.state ?? '—');
  const sup = String(rs.roleSup ?? '—'), sw = String(rs.roleSw ?? '—');
  const tgtSp = rs.tgtOut?.[jSp1] ?? 0, tgtHip = rs.tgtOut?.[jHipL] ?? 0;
  // 质量标志：预警或提案全零 ⇒ 计数
  if (w && w.mosX === 0 && w.mosZ === 0 && !w.reachable) bad++;
  log(
    `  ${t.toFixed(2)} |${((w?.mosX as number ?? 0) * 1000).toFixed(0).padStart(6)}${((w?.mosZ as number ?? 0) * 1000).toFixed(0).padStart(6)}` +
    `${(w?.ttbX === Infinity ? 'inf' : ((w?.ttbX as number) ?? 0).toFixed(2)).toString().padStart(6)}` +
    `${(w?.ttbZ === Infinity ? 'inf' : ((w?.ttbZ as number) ?? 0).toFixed(2)).toString().padStart(6)}` +
    `${String(w?.dirX ?? 0).padStart(4)}${String(w?.dirZ ?? 0).padStart(4)}${(w?.urgency as number ?? 0).toFixed(1).padStart(4)}${(w?.reachable ? '1' : '0').padStart(3)} |` +
    `${st.padStart(7)}/${sup}/${sw} |` +
    `${((plan?.stepX as number) ?? 0).toFixed(2).padStart(6)}${((plan?.stepZ as number) ?? 0).toFixed(2).padStart(6)}${((plan?.stepUrgent as number) ?? 0).toFixed(1).padStart(5)} |` +
    `L${String(rs.plansLevel ?? '-').padStart(2)}/${String(rs.plansBestKind ?? '-').padStart(6)} |` +
    `${tgtSp.toFixed(2).padStart(7)}${tgtHip.toFixed(2).padStart(8)}`,
  );
}
log(`──── 质量标志：预警全零&&不可达 的样本 = ${bad}（应≈0）`);

/**
 * ★★ F1 验收：**踝力矩能不能推动足底压力中心（CoP）？**
 *
 * 这是重构方案 §14.5 的判据。CoP **直接由接触冲量加权算出**
 * （`Ragdoll.readCoP`），不是从 ΔCoM 反推 —— 反推量的是"身体怎么动了"，
 * 混着惯量与耦合；直接读压力分布才是"足部发力"本身。
 *
 * 判据（预先登记）：
 *   刚性足 ⇒ CoP 被钉在接触面形心附近，踝转多少都几乎不动
 *   柔性足 ⇒ CoP 随踝力矩**连续移动**，行程明显 > 0
 *
 * 理论对照：`dCoP = τ_ankle / (m·g)`，m=70kg ⇒ 45 N·m ⇒ 65 mm；60 N·m ⇒ 87 mm。
 * 额状面同样看（踝的内/外翻轴）。
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
  const bg = bgNs as Record<string, (...a: unknown[]) => unknown>;
  const im: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');

const ANKLE_ON = process.env.ANKLE !== '0';
const ANK_TAU = Number(process.env.ANKLE_TAU ?? 60);
const CHZ = Number(process.env.CHZ ?? 0);
const dtP = 1 / 120;
const log = console.log;

const sk = buildSkeleton(ANKLE_ON ? { ...DEFAULT_CONFIG, ankleEnabled: true, ankleTorque: ANK_TAU } : DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const jA = jointIndexByName(sk, 'foot_l');
const jA2 = jointIndexByName(sk, 'foot_r');

/**
 * ★ 命令**饱和**踝角（超出软限位 ⇒ PD 一定打到 τmax），并回读**实际**踝力矩。
 *
 * ⚠ 2026-10-03 修正：这一版原先命令 ±12°（软限位内）⇒ PD 只产生"刚好维持该角度"
 *   的力矩（远小于 τmax）⇒ CoP 偏移小是**必然**的，不能据此推出"刚性足钉死 CoP"。
 *   静力学要求：踝出力矩 τ ⇒ 地面必须提供力矩 τ ⇒ CoP 偏移 τ/(mg)。**必须先饱和再比。**
 *
 * @returns [copX, copZ, Σλ, 实际踝力矩 N·m, 踝角实测]
 */
function copUnder(ankDeg: number, axis: number, contactHz: number): number[] {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 3, driver: 'controller', contactHz });
  sim.begin(new Float32Array(sim.params.length));
  const out = new Float64Array(SHAPE.outputs);
  // 先静置 1.2 s 让它站稳
  for (let i = 0; i < Math.round(1.2 / dtP); i++) sim.advance(1);
  if (jA < 0) return [NaN, NaN, NaN, 0];
  const span = Math.max(Math.abs(sk.joints[jA]!.minRad[axis]), Math.abs(sk.joints[jA]!.maxRad[axis]));
  // ★ 指令给到 3× 限位跨度 ⇒ θ_ref 远超限位 ⇒ PD 必然饱和在 τmax
  const cmd = (ankDeg * Math.PI / 180 * 3) * 0.9 / span;
  out[jA * 3 + axis] = Math.max(-1, Math.min(1, cmd));
  if (jA2 >= 0) out[jA2 * 3 + axis] = out[jA * 3 + axis]!;
  let tau = 0;
  const idx = jA * 3 + axis;
  for (let i = 0; i < Math.round(0.6 / dtP) && !sim.finished; i++) {
    sim.doll.setMotorTargets(out);
    sim.advance(1);
    tau = Math.abs(sim.doll.motorImpulse[idx]!) / dtP;   // 实际踝力矩（N·m）
  }
  const cop = new Float64Array(4);
  sim.doll.readCoP(0, cop);
  const ang = sim.doll.jointRot ? 0 : 0;
  void ang;
  return [cop[0]!, cop[2]!, cop[3]!, tau, cop[1]!];
}

log('══ F1 验收：踝力矩能不能推动足底压力中心（CoP）══');
log(`  踝 ${ANKLE_ON ? `开（τ=${ANK_TAU} N·m，矢状轴）` : '关'}   接触柔度 contactHz=${CHZ}`);
log(`  理论 CoP 偏移 = τ/(mg)：45N·m → ${(45 / 687 * 1000).toFixed(0)}mm   ${ANK_TAU}N·m → ${(ANK_TAU / 687 * 1000).toFixed(0)}mm`);
log('');

if (jA < 0) {
  log('  ✗ 本骨架没有踝关节（ANKLE=0）⇒ 无 CoP 通道，跳过。');
} else {
  const DEGS = [-1, -0.5, 0, 0.5, 1];   // 饱和倍数（×3 限位跨度）
  log('  ── 矢状面（踝 pitch）─────────────────────────────────────');
  log('   饱和×   CoP_x(mm)   CoP_z(mm)   实际踝力矩(N·m)   τ/(mg)(mm)   比值');
  let base = 0;
  const rows: number[][] = [];
  for (const d of DEGS) {
    const r = copUnder(d, 2, CHZ);
    rows.push(r);
    if (d === 0) base = r[0]!;
  }
  for (let i = 0; i < DEGS.length; i++) {
    const r = rows[i]!;
    const pred = r[3]! / 687 * 1000;      // 静力学预测的 CoP 偏移
    const meas = Math.abs(r[0]! - base) * 1000;
    log(`  ${String(DEGS[i]).padStart(5)}   ${(r[0]! * 1000).toFixed(1).padStart(8)}   ${(r[1]! * 1000).toFixed(1).padStart(8)}`
      + `   ${r[3]!.toFixed(1).padStart(14)}   ${pred.toFixed(1).padStart(10)}`
      + `   ${pred > 1 ? (meas / pred).toFixed(2) : '—'}`);
  }
  const travelX = (Math.max(...rows.map((r) => r[0]!)) - Math.min(...rows.map((r) => r[0]!))) * 1000;

  log('');
  log('  ── 额状面（踝 roll）──────────────────────────────────────');
  const rows2: number[][] = [];
  for (const d of DEGS) rows2.push(copUnder(d, 0, CHZ));
  for (let i = 0; i < DEGS.length; i++) {
    const r = rows2[i]!;
    log(`  ${String(DEGS[i]).padStart(5)}   CoP_x=${(r[0]! * 1000).toFixed(1).padStart(7)}mm   CoP_z=${(r[1]! * 1000).toFixed(1).padStart(7)}mm   τ=${r[3]!.toFixed(1)}N·m`);
  }
  const travelZ = (Math.max(...rows2.map((r) => r[1]!)) - Math.min(...rows2.map((r) => r[1]!))) * 1000;

  log('');
  log('  ══ 结论 ══');
  log(`  矢状面 CoP 行程 = ${travelX.toFixed(1)} mm   （理论 ${(ANK_TAU / 687 * 1000).toFixed(0)} mm）`);
  log(`  额状面 CoP 行程 = ${travelZ.toFixed(1)} mm`);
  log('');
  // 与静力学预测比：CoP 偏移 ≈ τ_actual/(mg)
  const worst = rows.reduce((m, r) => (r[3]! > 5 ? Math.max(m, Math.abs(r[0]! - base) * 1000 / (r[3]! / 687 * 1000)) : m), 0);
  if (travelX > 20) {
    log(`  ✓ 踝力矩**能**推动压力中心（${travelX.toFixed(0)}mm）`);
    log(`  ★ 实测/静力学预测 最大比值 = ${worst.toFixed(2)}`);
    log(worst > 0.5
      ? '    ⇒ 接近静力学预期 ⇒ CoP 基本可控，**刚性足并没有把 CoP 钉死**（推翻我上一轮的结论）'
      : '    ⇒ 远小于静力学预期 ⇒ 接触几何在限制 CoP ⇒ 才需要 F2');
  } else {
    log(`  ✗ CoP 行程只有 ${travelX.toFixed(1)}mm ⇒ 压力中心被接触几何钉死 ⇒ 需要 F2`);
  }
  if (travelZ > 10) log(`  ✓ 额状面也有权限（${travelZ.toFixed(0)}mm）⇒ 单腿额状面有救了`);
  else log(`  ✗ 额状面行程 ${travelZ.toFixed(1)}mm ⇒ 额状面仍无 CoP 通道，只能靠 spine1/0（35mm）`);
}
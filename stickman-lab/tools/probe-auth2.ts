/**
 * 双平面 × 双执行器的权限表 —— 单腿站立缺哪个通道，靠这张表定。
 *
 * 已测（probe-ankauth）：**矢状面踝有完整 CoP 权限**（a_x/a_理论≈1.2~1.7，线性对称）
 *   符号：τ 正 ⇒ CoM 往后（−x）
 *
 * ★ 但单腿实测（probe-oneleg）：1.7s 必倒，**终ξz ≈ −1.0**，comZ 冲到 −0.8m
 *   ⇒ 缺的是**额状面**权限。文献对应：
 *   · Hof2005：单脚 b_min = 15.5mm（双脚 64mm）⇒ 单腿可容 CoM 速度只有 47mm/s
 *   · 单脚侧向被动半宽 ≈ 0.07m（双脚 0.139m）
 *   · Morasso VIP 是矢状面的；额状面对应的是 VMP（vector-field method）
 *
 * 本表测四件事（全部开环恒力矩，1.2s 窗，与代数无关）：
 *   ① 踝 pitch  → Δvx   （已知，应当 ≈ ±0.66×2）
 *   ② 踝roll    → Δvz   （**未知**，`balanceHold` 的 kVmpAnkle 默认 0 暗示它可能没用）
 *   ③ 髋外展    → Δvz   （额状面的主力，Liu2012 的力学链起点）
 *   ④ 髋 pitch  → Δvx   （已知应该也有，用来对照标定是否正常）
 *
 * 判读：哪一格|Δv| 接近 0 ⇒ 那条通道不存在，单腿就必须绕开它。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-auth2] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled, imports)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { newCom, readCom } = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DT = 1 / 120;
const HOLD = Number(process.argv[3] ?? 1.2) || 1.2;
const log = console.log;

const F = jointIndexByName(sk, 'foot_l');
const H = jointIndexByName(sk, 'hip_l');
const SAG = 2, LAT = 0, ABD = 1;
const TAU_ANK = 45, TAU_HIP = 200;
const out = new Float64Array(SHAPE.outputs);
const com = newCom();

interface Ch { name: string; j: number; axis: number; tau: number; key: 'vx' | 'vz'; note: string }
const CH: Ch[] = [
  { name: '踝 pitch  (foot_l/2)', j: F, axis: SAG, tau: TAU_ANK, key: 'vx', note: '矢状面踝策略' },
  { name: '踝roll    (foot_l/0)', j: F, axis: LAT, tau: TAU_ANK * 0.6, key: 'vz', note: '额状面踝（内/外翻）' },
  { name: '髋外展    (hip_l/1) ', j: H, axis: ABD, tau: TAU_HIP * 0.35, key: 'vz', note: '额状面主力（Liu2012）' },
  { name: '髋 pitch  (hip_l/2) ', j: H, axis: SAG, tau: TAU_HIP, key: 'vx', note: '矢状面髋策略' },
];

log('双平面执行器权限表（开环恒力矩，1.2s 窗，两脚同时驱动）');
log(` 理论对照：τ/(m·h)，h=1.0 ⇒ 踝45N·m→0.643、髋200N·m→2.86 m/s²（单关节单独算会偏大，`);
log('           因为另一关节也在出力、且有耦合。下表看的是**相对大小和有没有量级差异**。');
log('');
log('  执行器                τ(N·m)   Δvx(m/s)   Δvz(m/s)   |Δv|相对同轴最强');
log('  ──────────────────────────────────────────────────────────────────────');

for (const c of CH) {
  let peak = 0;
  const rows: { tau: number; dvx: number; dvz: number }[] = [];
  for (const frac of [-1, -0.5, 0.5, 1]) {
    const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, duration: HOLD + 0.5, mode: 'stand' });
    sim.begin(new Float32Array(sim.params.length));
    out.fill(0);
    readCom(sim.doll, com);
    const vx0 = com.vx, vz0 = com.vz;
    out[c.j * 3 + c.axis] = frac;
    const steps = Math.round(HOLD / DT);
    for (let i = 0; i < steps && !sim.finished; i++) { sim.doll.setMotorTargets(out); sim.advance(1); }
    readCom(sim.doll, com);
    const dvx = com.vx - vx0, dvz = com.vz - vz0;
    rows.push({ tau: frac * c.tau, dvx, dvz });
    peak = Math.max(peak, Math.abs(c.key === 'vx' ? dvx : dvz));
  }
  for (const r of rows) {
    const m = Math.abs(c.key === 'vx' ? r.dvx : r.dvz);
    log(`  ${c.name}  ${r.tau.toFixed(0).padStart(7)}   ${r.dvx.toFixed(3).padStart(7)}   ${r.dvz.toFixed(3).padStart(7)}`
      + `   ${peak > 0 ? ((m / peak) * 100).toFixed(0).padStart(3) + '%' : '—'}`);
  }
  log(`      ↑ ${c.note}`);
}
log('');
log('  ★ 判读：额状面那两行（踝roll / 髋外展）的 |Δvz| 若都接近 0 ⇒');
log('    单腿额状面无控制器可用，必须靠脚位/步态而不是靠关节反馈。');
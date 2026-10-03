/**
 * 逐通道权限表 —— 平衡维持系统只能在**有权限的通道**上工作，所以这个数必须先知道。
 *
 * ★ 与旧版的区别（2026-10-03 更正）：
 *   旧版标着"踝"的行其实驱动的�� `spine1`（`jointIndexByName` 回退到 `JOINT_ORDER`，
 *   `foot_l`=9 在真实 joints 里是 spine1）。现在标的都是真名，且**跳过不存在的关节**。
 *
 * 测法：开环恒定目标角，观察 1.0 s 内全身 CoM 的 Δv。
 *   · 矢状面权限看 Δvx（前后），额状面看 Δvz（左右）。
 *   · 理论对照：CoM 加速度 ≈ τ/(m·h)，m=70 kg、h≈1.0 m ⇒ τ=100 N·m ⇒ 1.43 m/s²
 *
 * 用途：确定平衡维持系统的**可用通道集合**。没有权限的通道
 *（例如踝 CoP、髋外展）不能写进控制器，否则调参永远无效。
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName, hasJoint, JOINT_MAX_TORQUE } = await import('../src/core/skeleton');
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
const { newCom, readCom } = await import('../src/core/posture');

// ★ 可选：开踝（用户 2026-10-03："脚踝关节应该写的，而且足部还要学会发力"）
const ANKLE_ON = process.env.ANKLE === '1';
const ANK_TAU = Number(process.env.ANKLE_TAU ?? 60);
const sk = buildSkeleton(ANKLE_ON
  ? { ...DEFAULT_CONFIG, ankleEnabled: true, ankleTorque: ANK_TAU }
  : DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DT = 1 / 120;
const HOLD = 1.0;
const log = console.log;

const com = newCom();
const AX = ['轴0 内外旋', '轴1 外展/侧倾', '轴2 屈伸'];
const CH = [
  'hip_l', 'hip_r', 'knee_l', 'knee_r',
  'spine1', 'spine2', 'spine3',
  'shoulder_l', 'neck', 'elbow_l',
  'foot_l',        // 故意包含：证明它不存在、被跳过
];

log('逐通道开环权限（恒定目标角，1.0 s 窗，零输出基线为基准）');
log(`  真实关节 ${sk.joints.length} 个：${sk.joints.map((j) => j.name).join(' ')}`);
log(`  踝：${ANKLE_ON ? `**开**（ankleTorque=${ANK_TAU} N·m）` : '关（脚掌是小腿第二个 collider）'}`);
log('');

interface Row { name: string; ax: number; tau: number; axExists: boolean; dvx: number; dvz: number; dx: number; dz: number; spd: number }
const rows: Row[] = [];

for (const name of CH) {
  const idx = jointIndexByName(sk, name);
  const exists = hasJoint(sk, name);
  if (!exists) {
    log(`  ${name.padEnd(11)} —  **该骨架没有这个关节**（命令会被静默丢弃）`);
    continue;
  }
  const j = sk.joints[idx]!;
  for (let ax = 0; ax < 3; ax++) {
    const span = Math.max(Math.abs(j.minRad[ax]), Math.abs(j.maxRad[ax]));
    if (span < 0.05) { rows.push({ name, ax, tau: 0, axExists: false, dvx: 0, dvz: 0, spd: 0 }); continue; }
    const base = JOINT_MAX_TORQUE[name] ?? 100;
    const factor = [0.60, 0.35, 1.00][ax]!;
    const tau = base * factor;

    // 同侧对称一起驱（单腿场景要成对），左右同号/反号由测得符号决定，这里只测"能不能产生 Δv"
    const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: HOLD + 0.4 });
    sim.begin(new Float32Array(sim.params.length));
    const out = new Float64Array(SHAPE.outputs);
    out.fill(0);
    readCom(sim.doll, com);
    const vx0 = com.vx, vz0 = com.vz;
    const x0 = com.x, z0 = com.z;
    // 目标角 = 该轴量程的 40%（在限位内；反对称时两侧各偏 40%，合成角度仍安全）
    out[idx * 3 + ax] = 0.4;
    // 对侧同名轴同量（除 trunk 只动自身）
    const pair: Record<string, [string, number]> = {
      hip_l: ['hip_r', 1], knee_l: ['knee_r', 1], shoulder_l: ['shoulder_r', 1], elbow_l: ['elbow_r', 1],
    };
    const pr = pair[name];
    // ★★ 关键修正：测**额状面**必须用**反对称**驱动。
    //   左右「同号」驱动（例如两条腿同时外展）按构造只能加宽支撑域，
    //   **不可能横向移动 CoM** —— 旧版就是踩了这个坑，得出"额状面无权限"的错误结论。
    //   反对称（一侧 +、另一侧 −）才是真正搬 CoM 的模式。
    if (pr) out[jointIndexByName(sk, pr[0]) * 3 + ax] = ax === 2 ? 0.3 * pr[1] : -0.3;
    const steps = Math.round(HOLD / DT);
    // ★ 两个指标都要：
    //   · Δv   —— 动态权限（1s 末的速度变化）
    //   · Δpos —— **静态权限**（CoM 被搬了多远）。这一项才是"能不能靠这个通道保持平衡"的依据：
    //     静态侧倾把 CoM 搬过去后进入准静态平衡，Δv 会回到 0，但位移是实打实的。
    //     旧版只测 Δv ⇒ 把"腰侧倾 8°"误判成"无权限"。
    for (let i = 0; i < steps && !sim.finished; i++) { sim.doll.setMotorTargets(out); sim.advance(1); }
    readCom(sim.doll, com);
    const dvx = com.vx - vx0, dvz = com.vz - vz0;
    const dx = com.x - x0, dz = com.z - z0;
    rows.push({ name, ax, tau, axExists: true, dvx, dvz, dx, dz, spd: Math.max(Math.abs(dvx), Math.abs(dvz)) });
  }
}

log('');
log('  关节/轴                     τ     目标角   Δvx     Δvz    Δx(mm) Δz(mm)  权限');
log('  ' + '─'.repeat(78));
for (const r of rows) {
  if (!r.axExists) { log(`  ${(r.name + '/' + r.ax).padEnd(22)}  该轴限位≈0（不用）`); continue; }
  const j = sk.joints[jointIndexByName(sk, r.name)]!;
  const span = Math.max(Math.abs(j.minRad[r.ax]), Math.abs(j.maxRad[r.ax]));
  const deg = (0.4 * span * 57.2958).toFixed(1);
  const posMag = Math.hypot(r.dx, r.dz);
  const grade = (posMag < 0.01 && r.spd < 0.02) ? '**无权限**'
    : (posMag < 0.03 && r.spd < 0.05) ? '弱'
    : (posMag < 0.08 && r.spd < 0.12) ? '中' : '强';
  log(`  ${(r.name + '/' + r.ax + ' ' + AX[r.ax]!).padEnd(22)} ${r.tau.toFixed(0).padStart(5)}  ${deg.padStart(5)}°`
    + `  ${r.dvx.toFixed(3).padStart(7)}  ${r.dvz.toFixed(3).padStart(7)}`
    + `  ${(r.dx * 1000).toFixed(0).padStart(6)}  ${(r.dz * 1000).toFixed(0).padStart(6)}   ${grade}`);
}

log('');
log('  ★ 判读（与单腿站立直接相关）：');
const FRONTAL_MIN = 0.03;   // 30 mm：单脚侧向被动半宽约 70mm，30mm 已经是可观的权限
const sagittal = rows.filter((r) => r.axExists && r.ax === 2 && (Math.abs(r.dvx) >= 0.08 || Math.abs(r.dx) >= 0.05)).map((r) => r.name);
const frontal = rows.filter((r) => r.axExists && (r.ax === 0 || r.ax === 1)
  && (Math.abs(r.dvz) >= 0.05 || Math.abs(r.dz) >= FRONTAL_MIN)).map((r) => `${r.name}/${r.ax}`);
const dead = rows.filter((r) => r.axExists && Math.hypot(r.dx, r.dz) < 0.01 && r.spd < 0.02).map((r) => `${r.name}/${r.ax}`);
log(`    矢状面有权限 (|Δvx|≥0.08 或 |Δx|≥50mm): ${sagittal.join(', ') || '（无）'}`);
log(`    额状面有权限 (|Δvz|≥0.05 或 |Δz|≥30mm): ${frontal.join(', ') || '**（无）**'}`);
log(`    完全无权限: ${dead.join(', ') || '（无）'}`);
if (frontal.length) {
  log('');
  log(`  ★ 单腿站立可用的额状面通道：${frontal.join(', ')}`);
  log('    ⇒ 平衡维持系统的额状面只能走这些通道；踝 CoP 不存在，不要在控制器里写踝。');
} else {
  log('');
  log('  ✗✗ 额状面无权限 ⇒ 单腿站立必倒。要么开踝（ankleEnabled=true），要么改几何。');
}
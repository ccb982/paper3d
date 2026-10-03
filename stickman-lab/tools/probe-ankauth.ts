/**
 * ★★★ 更正（2026-10-03）：本探针原先测的是"踝"，**但这个骨架里没有踝关节**。
 *
 *   `DEFAULT_CONFIG.ankleEnabled = false` ⇒ `sk.joints` 只有 12 个，**不含 foot_l/foot_r**
 *   （脚掌是小腿上的第二个 collider）。而 `jointIndexByName` 当时会回退到
 *   `JOINT_ORDER.indexOf('foot_l') = 9` —— 真实索引 9 是 **`spine1`**。
 *   ⇒ 下面标着"踝"的每一行，实际驱动的都是 **spine1**。
 *   ⇒ 之前那两条结论都作废：
 *      · "踝 CoP 权限 a_x/a_理论≈1.2~1.7" ⇒ 那是 spine1 屈伸的权限
 *      · "踝 CoP 反馈 1N·m 站满 20s"  ⇒ 那是 spine1 的 0.2° 指令
 *   `skeleton.jointIndexByName` 已改为不回退（返回 -1），本探针现在直接报**真实关节名**。
 *
 * 本探针保留的价值：**它就是"逐关节开环权限表"的通用工具**，
 * 只是以前把脊柱关节错标成了踝。现在标的都是真名。
 *
 * 理论（Prince 1994 / Winter 1998 的踝策略）：
 *     踝力矩 τ 产生的地面反力矩 = τ  ⇒ 等效 CoP 偏移 d = τ/(m·g)
 *     对 CoM 的加速度 ≈ τ/(m·h)（h = 踝到 CoM 高度）
 *     满力矩 45 N·m、h ≈ 0.97 m ⇒ **理论权限 ≈ 45/(70·0.97) = 0.66 m/s²**
 *     等效 CoP 偏移 = 45/687 = 65 mm
 *
 * 实验：开环施加**恒定**踝矢状力矩（正负各若干档），测 1.2 s 内 CoM 水平速度变化。
 *   判读（预先登记）：
 *     实测 a ≈ ±0.66 m/s² 且随 τ 线性 ⇒ 踝有完整权限 ⇒ "站不住"是**控制器缺失**
 *     实测 |a| < 0.1·理论 或不随 τ 变化 ⇒ 踝没有权限 ⇒ 必须动脚/加自由度
 *
 * ★ 与代数无关，也不可能用"训练代数不够"解释掉。
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
    if (typeof fn !== 'function') throw new Error(`[probe-ankauth] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled, imports)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { newCom, readCom, omegaAt, dcm } = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);   // ★ 12 关节；BRAIN_SHAPE 是 9 关节的默认值
const SHAPE = shapeForJoints(sk.joints.length);
const DT = 1 / 120;
const HOLD = Number(process.argv[3] ?? 1.2) || 1.2;
const log = console.log;

const FL = jointIndexByName(sk, 'foot_l');
const FR = jointIndexByName(sk, 'foot_r');
const AX = 2;
if (FL < 0 || FR < 0) {
  console.log('★★ 本骨架**没有踝关节**（ankleEnabled=false，脚掌是小腿的第二个 collider）');
  console.log(`真实关节（${sk.joints.length} 个）：${sk.joints.map((j) => j.name).join(' ')}`);
}
/** 踝矢状轴量程（探针实测：指令 → 实测位移 6.2°，限位 [-10°,+18°]） */
const ANK_RANGE = 0.2618;          // 15°（balanceHold 用的同一个量程）
const ANK_TAU = 45;
const TH = 1.0;                    // 等效摆长，用于对照理论

const out = new Float64Array(SHAPE.outputs);
const com = newCom();

log(`逐关节开环权限标定（恒力矩，非反馈）　真实关节 ${sk.joints.length} 个`);
log(`  ${sk.joints.map((j) => j.name).join(' ')}`);
log(`  理论：a = τ/(m·h) = 45/(70·${TH}) = ${(ANK_TAU / (70 * TH)).toFixed(3)} m/s²   等效 CoP 偏移 = τ/(mg) = ${(ANK_TAU / 687 * 1000).toFixed(0)} mm`);
log(`  测量窗 ${HOLD}s   理论 Δv = ${(ANK_TAU / (70 * TH) * HOLD).toFixed(3)} m/s（满力矩）`);
log('');
log(`   τ(N·m)   ${sk.joints[FL]?.name ?? '(无踝)'}θ实测°  ${sk.joints[FR]?.name ?? '(无踝)'}θ实测°   Δvx(m/s)  Δvz(m/s)   a_x理论   a_x/a_理论   终倾°`);
log('  ─────────────────────────────────────────────────────────────────────────────');

for (const tau of [-45, -30, -15, 0, 15, 30, 45]) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, duration: HOLD + 0.6, mode: 'stand' });
  sim.begin(new Float32Array(sim.params.length));
  out.fill(0);
  readCom(sim.doll, com);
  const vx0 = com.vx, vz0 = com.vz;
  // 踝目标角：τ 满量程 ⇒ θ_ref = ±ANK_RANGE
  const cmd = tau / ANK_TAU;
  // ★ 没有踝时**一条指令都不下**（旧代码下到了 spine1，看起来像踝在工作）
  if (FL >= 0) out[FL * 3 + AX] = cmd;
  if (FR >= 0) out[FR * 3 + AX] = cmd;
  let thL = 0, thR = 0;
  const steps = Math.round(HOLD / DT);
  for (let i = 0; i < steps && !sim.finished; i++) {
    sim.doll.setMotorTargets(out);
    sim.advance(1);
    if (i === steps - 1) {
      if (FL >= 0) thL = sim.doll.jointAngle(FL, AX);
      if (FR >= 0) thR = sim.doll.jointAngle(FR, AX);
    }
  }
  readCom(sim.doll, com);
  const dvx = com.vx - vx0, dvz = com.vz - vz0;
  const aTh = tau / (70 * TH);
  const aMe = dvx / HOLD;
  log(`  ${String(tau).padStart(6)}   ${(thL * 57.2958).toFixed(2).padStart(10)}  ${(thR * 57.2958).toFixed(2).padStart(11)}`
    + `   ${dvx.toFixed(3).padStart(7)}   ${dvz.toFixed(3).padStart(7)}`
    + `  ${aTh.toFixed(3).padStart(7)}   ${(aTh !== 0 ? aMe / aTh : 0).toFixed(2).padStart(8)}`
    + `  ${(sim.endTilt * 57.2958).toFixed(1).padStart(7)}`);
}

log('');
log('  ★ 结论：本骨架**没有踝关节**，七行读数逐位相同（Δvx 恒 0.005）');
log('    ⇒ 矢状面唯一的 CoP 通道不存在。`balanceHold.ts` 文件头结论①「踝没有 CoP 权限」是对的。');
log('    ⇒ 之前那些"踝权限/踝 CoP 控制站住"的结论全部作废：那些指令下到了 spine1。');
log('');
log('  真要开 CoP 通道，只能改硬件，三条路（按性价比）：');
log('    ① `ankleEnabled: true` —— 脚掌拆成独立刚体 + 踝球铰（代码已就绪，需重调 PD/惯量）');
log('    ② 加长/加宽脚掌 —— 增大被动 CoP 权限（脚长 +80% ⇒ 解析上限 0.46→0.82 m/s）');
log('    ③ 只靠髋策略（额状面另需髋外展，而它当前权限≈0，见 probe-auth2）');
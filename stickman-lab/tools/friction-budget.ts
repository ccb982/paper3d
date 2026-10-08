/**
 * friction-budget —— ★ 脚部摩擦预算（用户令 2026-10-16："摩擦力小是完全没有站住的可能"）
 *
 * 目的：把"摩擦够不够"变成一个可算的判据，而不是感觉。
 *
 * 物理：
 *   站立/行走时，脚底需要提供的水平力 = 推动 CoM 的力（含加减速与平衡修正）。
 *   脚的摩擦上限（库仑）  F_t,max = μ · F_n
 *   ⇒ **防滑判据**： |F_t,需求| ≤ μ · F_n
 *
 *   而 μ 的组合规则在 Rapier 里默认是 Average ⇒ μ_eff = (μ_鞋底 + μ_地面)/2。
 *
 *   另外，"防滑余量"要按**最坏时刻**算：单脚支撑时 F_n 最小（只有一条腿承重），
 *   但需要的水平力不一定小 ⇒ 危险时刻是"单脚 + 高加速度"。
 *
 * 数据来源：本体实测（probe-stability 系列的历史读数，见架构.md §3）
 *   · 体重 m·g = 70 × 9.81 = 686.7 N
 *   · 支撑域：前后 ±0.110 m（左右 ±0.266 m）
 *   · ω = √(g/h)，h=0.966 ⇒ ω = 3.19 rad/s，τ = 1/ω = 0.314 s
 *   · 最大可控 CoM 加速度（前后）= 1.12 m/s²
 *   · 行走速度 ~1 m/s
 */
const g = 9.81;
const m = 70.0;
const W = m * g;
const h = 0.966;
const omega = Math.sqrt(g / h);
const tau = 1 / omega;
const pMaxX = 0.110;         // 前后支撑域半宽（CoP 行程）
const PMAX_Z = 0.266;

console.log('════ 脚部摩擦预算 ════');
console.log('');
console.log(`体重            W = m·g = ${m} × ${g} = ${W.toFixed(1)} N`);
console.log(`质心高度        h = ${h} m`);
console.log(`LIPM 常数       ω = √(g/h) = ${omega.toFixed(3)} rad/s   τ = 1/ω = ${tau.toFixed(3)} s`);
console.log(`CoP 行程(前后)  ±${pMaxX.toFixed(3)} m     (左右) ±${PMAX_Z.toFixed(3)} m`);
console.log('');

// ── 1) 站住所需的水平力（静态）：0
//     但"抗扰动"需要的水平力 = m · a_max
const aMax = omega * omega * pMaxX;   // = g·pMaxX/h
console.log('① 静止站立（静态）');
console.log(`   需要的水平力 = 0 N（静平衡）`);
console.log(`   但抗扰动的可用加速度 a_max = ω²·p_max = ${aMax.toFixed(3)} m/s²`);
console.log(`   ⇒ 需要的水平力上限 = m·a_max = ${(m * aMax).toFixed(1)} N`);
console.log('');

// ── 2) 各摩擦系数下，单脚/双脚的可提供水平力
console.log('② 可提供的最大水平力 F_t,max = μ_eff · F_n');
console.log('');
console.log('μ_eff  | 双脚F_n=W    | 单脚F_n=W/2  | 单脚能否提供 m·a_max');
for (const mu of [0.1, 0.2, 0.4, 0.6, 0.8, 1.0, 1.5, 3.0, 5.45]) {
  const ftBoth = mu * W;
  const ftOne = mu * (W / 2);
  const need = m * aMax;
  const ok = ftOne >= need ? '✔ 够' : `✘ 差 ${(need / ftOne).toFixed(2)}×`;
  console.log(`${mu.toFixed(2).padStart(6)} | ${ftBoth.toFixed(1).padStart(12)} | ${ftOne.toFixed(1).padStart(12)} | ${ok}`);
}
console.log('');

// ── 3) 反解：需要多少 μ 才能"单脚抗扰动"
const need = m * aMax;
const muNeedOne = need / (W / 2);
const muNeedBoth = need / W;
console.log('③ 反解（单脚支撑时要抗住最大可控加速度）');
console.log(`   需要 F_t = m·a_max = ${need.toFixed(1)} N`);
console.log(`   双脚：需 μ ≥ ${muNeedBoth.toFixed(3)}`);
console.log(`   单脚：需 μ ≥ ${muNeedOne.toFixed(3)}   ← 危险时刻`);
console.log('');

// ── 4) 行走所需的 μ（摆动腿加速/减速）
//     行走时把摆动腿(约 8% 体重)在 0.3s 内加速到 1 m/s ⇒ F = m_swing * a
const mSwing = 0.08 * m;
const vWalk = 1.0;
const tSwing = 0.3;
const aSwing = vWalk / (tSwing / 2);
console.log('④ 行走（摆动腿加减速）');
console.log(`   摆动腿质量 ≈ 8% × ${m} = ${mSwing.toFixed(2)} kg`);
console.log(`   在 ${tSwing} s 内到 ${vWalk} m/s ⇒ a ≈ ${aSwing.toFixed(2)} m/s²`);
console.log(`   需要水平力 = ${(mSwing * aSwing).toFixed(1)} N（很小，不是瓶颈）`);
console.log('');

console.log('════ 结论 ════');
console.log(`· **单脚支撑**是摩擦的危险时刻：需 μ ≥ ${muNeedOne.toFixed(2)}（抗最大扰动）`);
console.log(`· 仅"站着不滑"只需 μ ≥ ${(0).toFixed(2)}（静态无水平力）`);
console.log(`· 当前设置：鞋底 0.9 + 地面 10.0 ⇒ μ_eff = ${((0.9 + 10) / 2).toFixed(2)}（远超需求，但**不物理**）`);
console.log(`· 合理目标：μ_eff ≈ 0.8~1.2（橡胶-水泥实测 0.8~1.0）`);
console.log(`  ⇒ 地面取 μ_ground 使 (0.9 + μ_g)/2 ∈ [0.8, 1.2] ⇒ μ_g ∈ [0.7, 1.5]`);

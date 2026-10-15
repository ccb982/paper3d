/**
 * _tmp-model.ts —— 上身通道·简化数学模型 v2（喂入冻结实测数据 + 合理扰动）
 *
 * 数据来源（《对照实验-单腿标准发力.md》§4 冻结实测 / §7 力矩账）：
 *  · 体重 70kg → 687N；上身 47.46kg（465.6N，占 68%）；CoM 高 h≈0.95m
 *  · 支撑腿预算（申请制链）：接触 fz≈700N → 膝≤300、髋≤228、脊≤470 N·m（脊柱通道封顶=470）
 *  · 摆动腿力度：主动≈0，自重补偿髋侧向 −18.3 N·m（对身体的反应作常值扰动）
 *  · 已知扰动：入场侧速 −5~−13 cm/s（B 抬腿段残余）；合理推搡 ±5cm/s 瞬时
 *
 * 模型（每平面独立）：单腿=倒立摆 + 上身通道
 *   ẍ = ω₀²·x − kτ·u − a_sw + a_dist
 *   u  = B + G·W·(x + v/ω₀)，|u| ≤ 470（脊柱预算）
 * 判据：10s 内 |x| ≤ 4cm（支撑面）——对全部扰动组合成立才算"有效参数"。
 */

const g = 9.81;
const h = 0.95;
const omega0 = Math.sqrt(g / h);       // ≈3.21
const M = 70, W = 687;                 // N
const hUp = 0.5;                       // 上身 CoM 力臂
const ktau = (1 / hUp) / M;            // 0.0286 m/s² 每 N·m（u/hUp 力 / M_total）
const xMax = 0.04;
const uCap = 470;                      // 脊柱预算（申请制）
const aSw = 18.3 * ktau;               // 摆动腿反力矩 → 常值扰加速度 ≈0.52*0.0286？(见下)
const dt = 0.001;

// 扰动组合（用户："一些合理的扰动"）：入场速度 × 中段推搡
const cases: Array<{ name: string; v0: number; kick: number }> = [
  { name: '静止入', v0: 0, kick: 0 },
  { name: '前入13', v0: 0.13, kick: 0 },
  { name: '后入13', v0: -0.13, kick: 0 },
  { name: '前13+推5', v0: 0.13, kick: 0.05 },
  { name: '后13+推5', v0: -0.13, kick: -0.05 },
];

function run(B: number, G: number, v0: number, kick: number): { ok: boolean; t: number } {
  let x = 0.0, v = v0;
  for (let t = 0; t < 10; t += dt) {
    if (Math.abs(t - 3.0) < dt / 2) v += kick;
    if (Math.abs(t - 6.0) < dt / 2) v -= kick;
    let u = B + G * W * (x + v / omega0);
    if (u > uCap) u = uCap; else if (u < -uCap) u = -uCap;
    const a = omega0 * omega0 * x - ktau * u;
    v += a * dt; x += v * dt;
    if (Math.abs(x) > xMax) return { ok: false, t };
  }
  return { ok: true, t: 10 };
}

console.log(`【模型v2·喂实测】ω₀=${omega0.toFixed(2)}  kτ=${ktau.toFixed(4)}（m/s² per N·m）  uCap=${uCap}N·m  扰动=${cases.length}组合`);
console.log(`注：aSw=${(18.3 * ktau).toFixed(3)} m/s²（摆动腿反力矩量级，本版未计入主式）`);

// 判据：对全部扰动组合 10s 通过
console.log(`\n== 有效域扫描（全部扰动组合 10s |x|≤4cm）==`);
const okB: number[] = [];
for (let B = -16; B <= 16; B += 2) {
  let all = true;
  for (const G of [0.75, 1.0, 1.25]) for (const c of cases) if (!run(B, G, c.v0, c.kick).ok) all = false;
  if (all) okB.push(B);
}
console.log(`  G∈{0.75,1,1.25} 全过 → |B| 域: ${okB.length ? `[${Math.min(...okB)}, ${Math.max(...okB)}]` : '空'}`);
for (const G of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]) {
  const bs: number[] = [];
  for (let B = -16; B <= 16; B += 1) {
    let all = true;
    for (const c of cases) if (!run(B, G, c.v0, c.kick).ok) all = false;
    if (all) bs.push(B);
  }
  console.log(`  G=${G}: B 有效 [${bs.length ? `${Math.min(...bs)}, ${Math.max(...bs)}` : '空'}]`);
}

// 逐扰动分解（G=1 时 B 的边界由哪个扰动决定）
console.log(`\n== G=1 逐扰动边界 ==`);
for (const c of cases) {
  const bs: number[] = [];
  for (let B = -16; B <= 16; B += 1) if (run(B, 1.0, c.v0, c.kick).ok) bs.push(B);
  console.log(`  ${c.name.padEnd(8)}: B ∈ [${bs.length ? `${Math.min(...bs)}, ${Math.max(...bs)}` : '空'}]`);
}

// G 的作用（B=0）：入场速度可承受上限
console.log(`\n== B=0 时 G 能扛的入场速度（±cm/s）==`);
for (const G of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]) {
  let vmax = 0;
  for (let v = 0.01; v <= 0.30; v += 0.01) {
    if (run(0, G, v, 0).ok && run(0, G, -v, 0).ok) vmax = v; else break;
  }
  console.log(`  G=${G}: 可扛 ±${(vmax * 100).toFixed(0)} cm/s`);
}

// ── v3：腿扰动预算（上身参数必须容忍的腿扰动上限）──
//   d(t) 加到 ẍ 上；恒值扰 + 正弦扰（0.5~4Hz——腿抖实测 29Hz±，先扫低频到中频）
console.log(`\n== 上身能容忍的腿扰上限（G=1、B=0、10s |x|≤4cm）==`);
{
  const tol = (d: (t: number) => number): number => {
    let x = 0, v = 0, dmax = 0;
    for (let t = 0; t < 10; t += dt) {
      let u = 0 + 1.0 * W * (x + v / omega0);
      if (u > uCap) u = uCap; else if (u < -uCap) u = -uCap;
      const dd = d(t);
      const a = omega0 * omega0 * x - ktau * u + dd;
      v += a * dt; x += v * dt;
      if (Math.abs(x) > xMax) return NaN;
      if (Math.abs(dd) > dmax) dmax = Math.abs(dd);
    }
    return dmax;
  };
  // 恒值
  let dc = 0;
  for (let A = 0.05; A <= 2.0; A += 0.05) {
    if (Number.isNaN(tol(() => A))) break;
    dc = A;
  }
  console.log(`  恒值扰：可容忍 |d| ≤ ${dc.toFixed(2)} m/s²`);
  for (const f of [0.5, 1, 2, 4]) {
    let okA = 0;
    for (let A = 0.05; A <= 3.0; A += 0.05) {
      const r = tol((t) => A * Math.sin(2 * Math.PI * f * t));
      if (Number.isNaN(r)) break;
      okA = A;
    }
    console.log(`  正弦扰 ${f}Hz：可容忍 幅值 ≤ ${okA.toFixed(2)} m/s²`);
  }
  // 对照：实测腿过力折算（hip_r/2 109 vs 需求 9.8 → 超额 ~99 N·m；折算 a≈τe/(M·0.9)）
  const aLeg = 99 / (70 * 0.9);
  console.log(`  实测腿超额折算 ≈ ${aLeg.toFixed(2)} m/s²（远超容忍 → 当前腿扰下上身无解）`);
}

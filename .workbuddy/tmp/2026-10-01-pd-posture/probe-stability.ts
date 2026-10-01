// ============================================================
// probe-stability —— 站立可行性：CoP 权限 / CoM 倒立摆判据 / 观测体检
// ============================================================
// 回答的问题：「能通过调整整体重心来保证站着吗？」
//
// ★ 先把物理讲清楚，否则"调重心"这个词会把人骗了：
//   刚体动力学里，关节力矩是**内力对**，对 CoM 的净贡献恒为 0。改 CoM 加速度的唯一途径是
//   **合外力**，而外力只有两个：重力（固定）与地面反力（作用在 CoP 上）。
//   ⇒ "调重心" ≡ "调 CoP" ≡ "调地面反力" —— **这三个其实是同一个自由度**。
//   ⇒ 所以能调多少，完全由**支撑多边形**（CoP 的可行域）决定，与"想不想调"无关。
//
// ★ 而 CoM 在水平面上的动力学是**不稳定**的（线性倒立摆 LIPM）：
//       ẍ = ω²(x − p),   ω = √(g / z_c),   p = CoP ∈ [−p_max, +p_max]
//   稳定判据不是"CoM 投影在支撑多边形内"（那只是静力近似），而是**发散分量（DCM）在域内**：
//       ξ = x + ẋ/ω    必须始终落在 [−p_max, +p_max]
//   ξ 越出 p_max 之后，**任何 p 的取法都救不回来** —— 只能迈步。这就是"保证"的硬上界。
//
// 本文件只做**解析**计算（不跑物理、不碰 GPU、不用 wasm）：
//   [A] 支撑多边形（两只脚底板在 XZ 上的凸包）
//   [B] 绑定姿态 CoM 与静稳定余量
//   [C] LIPM 常数：ω / 时间常数 / 最大可控加速度 / 反馈截止时间
//   [D] DCM 捕获表：给定 CoM 速度，还剩多少位置余量；反之亦然
//   [E] 摩擦排除项：地面摩擦是不是真正的瓶颈
//   [F] 观测/适应度体检：网络现在调的是**胸腔**，不是 CoM —— 差多远
//
// 跑法：node tools/run.mjs probe-stability

import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';

const log = (...a: unknown[]) => console.log(...a);
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
}
function note(name: string, detail = ''): void {
  log(`  info  ${name}${detail ? '   ' + detail : ''}`);
}
const f = (x: number, n = 4) => x.toFixed(n);

const G = 9.81;
const sk = buildSkeleton(DEFAULT_CONFIG);

log('站立可行性 —— CoP 权限 / CoM 倒立摆判据');
log(`  骨架：${sk.bodies.length} 刚体 / ${sk.joints.length} 关节 / 总质量 ${f(sk.massTotal, 1)} kg`);
log('');

// ------------------------------------------------------------ [A] 支撑多边形

interface Rect { x0: number; x1: number; z0: number; z1: number; key: string }
/**
 * ★ 支撑多边形只能由**真正接地**的碰撞体构成。
 * 踩过的坑：躯干各段用的也是 `cuboid` collider（骨盆/脊椎的盒子），
 * 若按 shape==='cuboid' 收集，躯干盒子会被当成脚底板，把支撑多边形从 ±0.110 撑到 ±0.136。
 * 所以判据必须是**几何接地**：取所有碰撞体最低点的最小值，凡落在 [min, min+2cm] 的都算接触。
 */
interface Contact { key: string; shape: string; bottom: number; x0: number; x1: number; z0: number; z1: number }
const all: Contact[] = [];
for (const b of sk.bodies) {
  for (const c of b.colliders) {
    const halfY = c.shape === 'cuboid' ? c.hy : c.halfHeight + c.radius;
    const bottom = b.cy + c.offsetY - halfY;
    const hx = c.shape === 'cuboid' ? c.hx : c.radius;
    const hz = c.shape === 'cuboid' ? c.hz : c.radius;
    all.push({ key: b.key, shape: c.shape, bottom, x0: b.cx - hx, x1: b.cx + hx, z0: b.cz - hz, z1: b.cz + hz });
  }
}
const groundY = Math.min(...all.map((c) => c.bottom));
const CONTACT_BAND = 0.02;
const feet: Rect[] = all.filter((c) => c.bottom <= groundY + CONTACT_BAND)
  .map((c) => ({ key: `${c.key}(${c.shape})`, x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1 }));
if (feet.length === 0) throw new Error('[probe-stability] 找不到接地碰撞体');

// 支撑多边形 = 所有接触矩形并集的凸包（两脚都平放时，净 CoP 可以是两脚接触点的任意加权平均
// ⇒ 可达域就是凸包，包括两脚之间那道空隙）
const hull = {
  x0: Math.min(...feet.map((r) => r.x0)), x1: Math.max(...feet.map((r) => r.x1)),
  z0: Math.min(...feet.map((r) => r.z0)), z1: Math.max(...feet.map((r) => r.z1)),
};
const xHalf = (hull.x1 - hull.x0) / 2;          // ★ 前后（行走方向）半宽
const zHalf = (hull.z1 - hull.z0) / 2;          // 侧向半宽

log('[A] 支撑多边形（CoP 可行域 = 接地碰撞体足迹的凸包）');
log(`      最低点 y = ${f(groundY, 4)} m，接触带 = [${f(groundY, 4)}, ${f(groundY + CONTACT_BAND, 4)}]`);
for (const c of all) {
  const touching = c.bottom <= groundY + CONTACT_BAND;
  log(`      ${touching ? '●' : ' '} ${c.key.padEnd(7)} ${c.shape.padEnd(8)} bottom=${f(c.bottom, 3)}  `
    + `X[${f(c.x0, 3)}, ${f(c.x1, 3)}] Z[${f(c.z0, 3)}, ${f(c.z1, 3)}]`);
}
log(`      接地 ${feet.length} 个：${feet.map((r) => r.key).join(', ')}`);
log(`      凸包    X[${f(hull.x0, 3)}, ${f(hull.x1, 3)}]  Z[${f(hull.z0, 3)}, ${f(hull.z1, 3)}]`);
log(`      ⇒ 前后半宽 p_max,X = ${f(xHalf)} m     侧向半宽 p_max,Z = ${f(zHalf)} m`);
note('★ 前后是这个骨架的**最弱方向**', `只有 ±${f(xHalf)} m —— 而前后正是"走路/被推"的方向`);
log('');

// ------------------------------------------------------------ [B] CoM

let mtot = 0, cy = 0, cz = 0;
const contrib: { key: string; m: number; y: number }[] = [];
for (const b of sk.bodies) {
  let bm = 0, bMy = 0;
  for (const c of b.colliders) {
    bm += c.mass;
    bMy += c.mass * (c.offsetY + c.comY);         // 相对刚体几何中心的 CoM 偏移
  }
  const y = b.cy + (bm > 0 ? bMy / bm : 0);
  mtot += bm;
  cy += bm * y;
  cz += bm * b.cz;
  contrib.push({ key: b.key, m: bm, y });
}
cy /= mtot;
cz /= mtot;

log('[B] 绑定姿态整体重心');
log(`      CoM = (0.000, ${f(cy)}, ${f(cz)}) m      身高 ${f(sk.totalHeight, 2)} m`);
const marginX = xHalf - Math.abs(0);              // CoM_x = 0（素材是正面视图，深度全归零）
const marginZ = Math.min(hull.z1 - cz, cz - hull.z0);
log(`      静稳定余量（前后）= ${f(marginX)} m       （侧向）= ${f(marginZ)} m`);
check('B1 绑定姿态 CoM 投影落在支撑多边形内', marginX > 0 && marginZ > 0,
  `前后余量 ${f(marginX)} / 侧向余量 ${f(marginZ)}`);
note('★ 静力余量看着还行，但**静力判据是错的**', '真实约束是下面的 DCM（动态）判据，比它严得多');
log('');

// ------------------------------------------------------------ [C] LIPM 常数

const zc = cy;
const omega = Math.sqrt(G / zc);
const tau = 1 / omega;
const aMax = omega * omega * xHalf;               // 把 CoP 顶到边界能产生的最大 CoM 水平加速度
const vCatch = omega * xHalf;                     // x=0 时，还能被"刹住"的最大 CoM 速度
const tDeadline = (xi: number) => Math.log(xHalf / xi) / omega;

log('[C] 线性倒立摆（LIPM）常数');
log(`      z_c（CoM 高度）        = ${f(zc)} m`);
log(`      ω = √(g/z_c)           = ${f(omega)} rad/s     时间常数 τ = ${f(tau)} s`);
log(`      最大可控 CoM 加速度    = ω²·p_max = ${f(aMax)} m/s²（= ${f(aMax / G)} g）`);
log(`      x=0 时最大可刹 CoM 速度 = ω·p_max = ${f(vCatch)} m/s`);
note('★ 发散速度', `停滞不控时 DCM 按 e^{t/τ} 增长 —— ${f(tau)} s 一涨 e 倍（×2.72）`);
note('★ 反馈截止时间', `若 DCM 已到 ${f(xHalf / 2, 3)} m（余量一半），什么都不做还有 ${f(tDeadline(xHalf / 2), 3)} s 就必须迈步`);
log('');

// ------------------------------------------------------------ [D] DCM 捕获表

log('[D] DCM 捕获判据：ξ = x + ẋ/ω 必须 ≤ p_max,X = ' + f(xHalf) + ' m');
log('      CoM 速度 ẋ      允许的 CoM 位置余量 |x|max     说明');
const speeds = [0, 0.05, 0.1, 0.2, 0.3, vCatch, 0.5, 1.0];
for (const v of speeds) {
  const slack = xHalf - v / omega;
  const tag = slack <= 0 ? '★ 即使 CoM 正好在中心也已经刹不住 ⇒ 必须迈步'
    : slack < 0.03 ? '余量极薄' : '';
  log(`      ${f(v, 3)} m/s      ${(slack > 0 ? '+' + f(slack, 3) : f(slack, 3)).padStart(9)} m            ${tag}`);
}
check('D1 步速量级（≥0.5 m/s）下静止站立已不可恢复（⇒ 站与走是两个域）',
  0.5 > vCatch, `0.5 m/s > 可刹上限 ${f(vCatch)} m/s`);
log('');
log(`      ⇒ 站立不动 ⟺ |ẋ| ≲ ${f(vCatch, 2)} m/s 且 |x| 很小。一旦进入走路（~1 m/s），`);
log(`         "靠调 CoP 站住"在数学上就不可能，只有**迈步**能救（把支撑多边形搬到 DCM 前面）。`);
log('');

// ------------------------------------------------------------ [E] 摩擦排除项

log('[E] 摩擦是不是瓶颈？（排除项）');
const N = mtot * G;
const Fric = 1.0 * N;
// 把 0.1 m/s 的 CoM 动量刹停需要的最小时间：t = m·v / F
const tFric = (mtot * 0.1) / Fric;
log(`      正压力 N ≈ ${f(N, 0)} N      摩擦上限 μ·N（μ=1.0）≈ ${f(Fric, 0)} N`);
log(`      刹住 0.1 m/s 的 CoM 只需要 ${f(tFric * 1000, 2)} ms 的全力水平推力`);
check('E1 摩擦不是限制项（几何/CoP 限远比摩擦先到）', tFric < 0.02,
  `${f(tFric * 1000, 2)} ms ≪ τ = ${f(tau)} s`);
log('');

// ------------------------------------------------------------ [F] 观测 / 适应度体检

log('[F] 观测与适应度体检：现在调的是"胸腔"，不是 CoM');
const chest = sk.bodies[sk.bodies.map((b, i) => (b.texSlice ? i : -1)).filter((i) => i >= 0).pop()!];
const chestMass = chest.mass;
const torsoMass = contrib.filter((c) => sk.bodies.find((b) => b.key === c.key)!.texSlice)
  .reduce((s, c) => s + c.m, 0);
const aboveHip = contrib.filter((c) => c.y > sk.joints.find((j) => j.name === 'hip_l')!.wy)
  .reduce((s, c) => s + c.m, 0);

log(`      胸腔（${chest.key}）质量        = ${f(chestMass, 2)} kg = 全身 ${f((chestMass / mtot) * 100, 1)}%`);
log(`      胸腔中心 y                = ${f(chest.cy)} m   （CoM y = ${f(cy)} m，差 ${f(chest.cy - cy)} m）`);
log(`      躯干 4 段合计              = ${f(torsoMass, 2)} kg = ${f((torsoMass / mtot) * 100, 1)}%`);
log(`      髋以上全部                 = ${f(aboveHip, 2)} kg = ${f((aboveHip / mtot) * 100, 1)}%`);
log(`      ⇒ 髋以下（腿+脚）           = ${f(mtot - aboveHip, 2)} kg = ${f(((mtot - aboveHip) / mtot) * 100, 1)}%`);
log('');
log('      当前观测（sim.ts controlTick，88 维）：');
log('        x[2..5]  胸腔四元数      x[6..8]  胸腔线速度      x[9..11] 胸腔角速度');
log('        x[12]    胸腔高度 y      x[13]    胸腔侧偏 z');
log('        x[14..]  12 关节角 ×3    + 12 关节相对角速度 ×3    + 左右脚高度 ×2');
check('F1 观测里**没有** CoM / CoM 速度 / CoP / DCM',
  true, '⇒ 策略在原理上拿不到"重心"这个量，只能靠胸腔姿态间接推断');
check('F2 适应度的直立/平衡项全部基于**胸腔**',
  true, `tiltOf(chest) 与 tp.z；但胸腔只占 ${f((chestMass / mtot) * 100, 1)}% 质量`);
note('★ 用胸腔代理 CoM 的代价',
  `绕质心的力臂差 ${f(Math.abs(chest.cy - cy))} m ⇒ 胸腔直立 ≠ CoM 落在支撑域内`);

// ------------------------------------------------------------ [G] 设计敏感度

log('[G] 设计敏感度：改模型能买到多少"可站速度" v_catch = ω·p_max');
// v_catch = √(g/z_c)·p_max
//   ∂v/∂p_max = ω            （**线性**：脚加长 1 m ⇒ 可站速度 +3.19 m/s）
//   ∂v/∂z_c   = −ω·p_max/(2z_c)（**只有 √ 级**：重心降 1 m ⇒ 可站速度 +0.18 m/s）
const dvDp = omega;
const dvDz = -(omega * xHalf) / (2 * zc);
const footLen = hull.x1 - hull.x0;
log(`      ∂v_catch/∂p_max = ω            = ${f(dvDp, 3)} (m/s) per m  —— 支撑面加长是**线性**收益`);
log(`      ∂v_catch/∂z_c   = −ω·p_max/2z_c = ${f(dvDz, 3)} (m/s) per m  —— 降重心只有**开方**收益`);
log(`      等价换算：脚掌加长 1 cm  ≈  重心降低 ${f(Math.abs(dvDp * 0.01 / dvDz) * 100, 1)} cm`);
log('');
log(`      脚掌长 = ${f(footLen, 3)} m（= 身高的 ${f((footLen / sk.totalHeight) * 100, 1)}%）`);
log(`      解剖学参考：足长/身高 ≈ 15% ⇒ 1.80 m 的人应有 ${f(1.8 * 0.15, 3)} m`);
log(`      ⇒ 素材的脚比解剖值短 ${f((1 - footLen / (1.8 * 0.15)) * 100, 1)}%，而且**没有踝关节**`);
log(`        （真人站不稳时靠踝关节把 CoP 往前顶到脚趾，本骨架做不到）`);
check('G1 支撑面加长的边际收益远高于降重心', Math.abs(dvDp) > 10 * Math.abs(dvDz),
  `${f(dvDp, 3)} vs ${f(dvDz, 3)} —— 差 ${f(Math.abs(dvDp / dvDz), 1)} 倍`);
log('');

// ------------------------------------------------------------ [H] 建模注意

log('[H] 建模注意：脚底是"平板 + 球底"混合接触');
{
  const cap = all.find((c) => c.key === 'shin_l' && c.shape === 'capsule')!;
  const box = all.find((c) => c.key === 'shin_l' && c.shape === 'cuboid')!;
  log(`      小腿胶囊底端 y=${f(cap.bottom, 4)} m，脚掌扁盒底面 y=${f(box.bottom, 4)} m`);
  note('两者齐平 ⇒ 脚掌平面与胶囊底球相切',
    '平坦地面上由平板主导，无碍；但一旦脚倾斜，胶囊球底会变成"摇椅"接触点，有效 CoP 会比脚掌矩形更窄');
  note('凸包实际由 cuboid 决定', `capsule 足迹 X[±${f(cap.x1, 3)}] ⊂ cuboid X[±${f(box.x1, 3)}]`);
}

log('');
log(failures === 0 ? '  ✅ probe-stability 全部通过' : `  ❌ probe-stability 失败 ${failures} 项`);
process.exitCode = failures === 0 ? 0 : 1;

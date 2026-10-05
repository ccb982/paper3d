/**
 * probe-qp.ts —— 全链 QP 求解器的**离线验收**（不跑物理）
 *
 * 验三件事（都是数学性质，不依赖仿真状态，所以能单独验）：
 *   ① 唯一性：同一输入多次求解，逐位相同
 *   ② 等式残差：|Σ τ·arm − F_des| 应趋近 0（力矩够时）
 *   ③ 限幅有效：τ 全部落在 ±τmax 内
 *   ④ 欠定：F_des 大到不可能时 → feasible=false（而不是静默输出垃圾）
 */
import { solveWholeBodyQp, type QpAxis } from '../src/core/systems/wholeBodyQp';
const log = console.log;
const D2R = Math.PI / 180;

/**
 * 构造一个轴。`axis` 是**世界系下的旋转轴单位向量**，`r` 是关节相对**接触点**的位置。
 * 力矩对地面的作用 = `axis × r`。
 * ⚠ 数据取自本 rig 的真实几何（足底 y≈0，踝 y≈0.05，膝 y≈0.42，髋 y≈0.90）：
 *   · 踝绕 **X**（额状旋转轴）→ `c = X × (0,0.05,0.05) = (0,0,−0.05)` ⇒ 产生**侧向 z** 力
 *   · 踝绕 **Z**（矢状旋转轴）→ `c = Z × (0,0.05,0) = (−0.05,0,0)` ⇒ 产生**前后向 x** 力
 *   ⇒ **踝的矢状权限（前后）比额状大**，且都只有 5cm 力臂 —— 这是几何决定的。
 */
/**
 * 构造一个轴。`ax` 是**世界系旋转轴单位向量**；`jx/jz` 是关节相对接触点的位置（y=0 地面）。
 * 力矩对地面的作用系数：`c = axis × r`，于是 `Fx = τ·(ay·rz − az·ry)`、
 * `Fz = τ·(ax·ry − ay·rx)`。
 * ⚠ **侧向能力来自 `ry`**（关节离地高度）：踝只有 5cm ⇒ 侧向权重天然极低，
 *   这与文献一致（踝的额状权限弱，靠几何而非增益）。
 *   要在测试里造出侧向力，必须让 `rx≠0`（关节在前后方向偏离接触点）。
 */
function mkAx(nm: string, joint: number, axis: 0 | 1 | 2,
             ax: number, ay: number, az: number,
             jx: number, jy: number, jz: number, tauMax: number, mul = 1): QpAxis {
  void nm;
  return { joint, axis, wx: ax, wy: ay, wz: az, rx: jx, ry: jy, rz: jz,
    tauMax, w: mul / tauMax };
}
const AXES: QpAxis[] = [
  // 踝绕 X（额状旋转轴）→ c_z = ax·ry = 1·0.05 = 0.05（侧向，臂弱）
  mkAx('踝旋前', 0, 0, 1, 0, 0, 0.02, 0.05, 0.06, 120, 4),
  // 踝绕 Z（矢状旋转轴）→ c_x = −az·ry = −0.05（前后，臂同样 5cm）
  mkAx('踝矢状', 0, 2, 0, 0, 1, 0.00, 0.05, 0.00, 120, 4),
  mkAx('踝外翻', 0, 1, 0, 1, 0, 0.02, 0.05, 0.06, 42, 4),
  // 膝：臂 42cm ⇒ 同样力矩能出 8 倍力
  mkAx('膝侧', 1, 0, 1, 0, 0, 0.02, 0.42, 0.06, 90),
  mkAx('膝矢状', 1, 2, 0, 0, 1, 0.00, 0.42, 0.00, 150),
  // 髋：臂 90cm ⇒ 主力
  mkAx('髋侧', 2, 0, 1, 0, 0, 0.02, 0.90, 0.06, 120),
  mkAx('髋矢状', 2, 2, 0, 0, 1, 0.00, 0.90, 0.00, 200),
  // 腰
  mkAx('腰侧倾', 3, 0, 1, 0, 0, 0.02, 0.60, 0.06, 72),
  mkAx('腰屈伸', 3, 2, 0, 0, 1, 0.00, 0.60, 0.00, 120),
];
const axes = AXES;
log('══ 全链 QP 离线验收 ══');
log('');
log('  ① 唯一性 + ② 等式残差（同一输入多次求解应逐位相同）');
for (const [fx, fz] of [[0, 0], [20, 0], [0, 30], [-50, -50], [200, 200]]) {
  const runs: QpTickLite[] = [];
  for (let k = 0; k < 3; k++) {
    const o = solveWholeBodyQp({
      axes, fDesX: fx, fDesZ: fz, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09],
    });
    runs.push({ t: [...o.tau], f: o.feasible, r: o.residual });
  }
  const same = runs.every((r) => r.t.every((v, i) => v === runs[0]!.t[i]));
  let s0 = 0, s1 = 0, over = 0;
  runs[0]!.t.forEach((v, i) => {
    const a = axes[i]!;
    s0 += v * (a.wy * a.rz - a.wz * a.ry);
    s1 += v * (a.wx * a.ry - a.wy * a.rx);
    if (Math.abs(v) > a.tauMax * 1.0001) over++;
  });
  log(`     F_des=(${String(fx).padStart(4)},${String(fz).padStart(4)})N`
    + `  残差=${runs[0]!.r.toFixed(2)}N  合成=(${s0.toFixed(1)},${s1.toFixed(1)})`
    + `  超限轴=${over}  可行=${runs[0]!.f ? '✓' : '✗'}  三次逐位相同=${same ? '✓' : '✗'}`);
}
interface QpTickLite { t: number[]; f: boolean; r: number }

log('');
log('  ③ 力矩分配：矢状(前后) vs 额状(侧向) 各出一份，对比踝权重的作用');
{
  const o = solveWholeBodyQp({ axes, fDesX: 40, fDesZ: 30, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  const nm = ['踝旋前', '踝矢状', '踝外翻', '膝侧', '膝矢状', '髋侧', '髋矢状', '腰侧倾', '腰屈伸'];
  o.tau.forEach((v, i) => log(`     ${nm[i]!.padEnd(6)} ${v.toFixed(1).padStart(8)} N·m  (τmax ${axes[i]!.tauMax})`));
}

log('');
log('  ④ 踝权重的作用：把 ankleMul 从 4 降到 0，看分配怎么变');
for (const mul of [4, 1, 0]) {
  const ax2 = axes.map((a, i) => (i < 3 ? { ...a, w: mul / a.tauMax } : a));
  const o = solveWholeBodyQp({ axes: ax2, fDesX: 40, fDesZ: 30, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  const g = (i0: number): string => (o.tau[i0] ?? 0).toFixed(1).padStart(7);
  log(`     ankleMul=${mul}  踝[旋前 ${g(0)} 矢状 ${g(1)} 外翻 ${g(2)}]`
    + `  膝[侧 ${g(3)} 矢 ${g(4)}]  髋[侧 ${g(5)} 矢 ${g(6)}]  腰[侧 ${g(7)} 矢 ${g(8)}]`);
}

log('');
log('  ⑤ 欠定：F_des 大到力矩上限也做不到（feasible 必须为 ✗）');
for (const f of [300, 1000, 3000]) {
  const o = solveWholeBodyQp({ axes, fDesX: f, fDesZ: 0, copXRange: [-0.14, 0.14], copZRange: [-0.05, 0.09] });
  let s0 = 0;
  o.tau.forEach((v, i) => {
    const a = axes[i]!;
    s0 += v * (a.wy * a.rz - a.wz * a.ry);
  });
  log(`     F_des=${String(f).padStart(4)}N → 实际 ${s0.toFixed(0)}N`
    + `  残差 ${o.residual.toFixed(0)}N  feasible=${o.feasible ? '✓' : '✗（已如实报出）'}`);
}
void D2R;

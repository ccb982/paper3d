/**
 * wholeBodyQp.ts —— **静态伺服平衡 = 全链一次性求解**（`架构设计.md` 附录 B）
 *
 * ════════════════════════════════════════════════════════════════════════
 * 为什么是这个文件（用户 2026-10-05：「伺服平衡系统必须进行完整的力链求解，
 * 从足部到身体都求一次，每次给出一个唯一的、综合的、完整的修正方案」）：
 *
 *  现有的平衡是**逐关节独立**的：每轴各自算 `τ = kP·(θ_ref−θ) − kD·ω`，
 *  各自被自己的护栏夹住。后果（全部实测）：
 *    · 各轴不知道别人在做什么，修正会在足部**互相抵消**，而两边都以为做完了
 *    · 承重脚的等效惯量是"身体绕踝的惯量"（0.5~1 kg·m²），不是脚掌自身的
 *      0.005 ⇒ 用后者算，踝只能拿到 τmax 的 3~8%，而指标看起来全部正常
 *    · **不存在唯一的解**：同一需求有无穷多种力矩分配，护栏各自截断后
 *      落地的是互相矛盾剩下的残数
 *
 *  这里一次性求解整条链：
 *      min  Σ_i w_i·τ_i²                       ← 加权最小范数（⇒ 唯一解）
 *      s.t. Σ_i τ_i · J_i = M·a_des + g − Sᵀf_ground
 *           CoP = c(f_ground) ∈ 支撑多边形
 *           f_ground·ŷ ≥ 0,  |τ_i| ≤ τmax_i,  θ_min ≤ θ ≤ θ_max
 *
 *  `min ‖W·τ‖²` 配**等式**约束 ⇒ 目标严格凸 + 可行集是仿射子空间 ⇒ **唯一解**。
 *  这就是用户"唯一的、综合的、完整的修正方案"的数学落点。
 *
 *  数值实现：**投影梯度法**（POCS），不做通用 QP 求解器。
 *  理由：约束都是"盒 + 一个等式"，POCS 对这类问题收敛快且**无依赖**；
 *  且本项目此前反复被"静默失效"咬（详见各函数注释），POCS 每轮都把
 *  残差算出来，可逐轮回读，不靠"应该收敛了"。
 * ════════════════════════════════════════════════════════════════════════
 */

import type { RigState, Side } from '../rigState';
import type { Ragdoll } from '../ragdoll';

/** 一个被求解的关节轴（一维自由度） */
export interface QpAxis {
  /** 关节下标 */
  joint: number;
  /** 0/1/2 = 绕局部 X/Y/Z */
  axis: number;
  /** 该轴的世界转动方向（单位向量） */
  wx: number; wy: number; wz: number;
  /**
   * 该轴相对支撑点的力臂（m，三维）。**必须三维**：`τ · (axis × r)` 决定它
   * 能在哪个方向产生地面反力。
   * ⚠ 我第一版只留 `rx/rz` 两个分量，于是"绕 X 轴"（额状面旋转）被当成能产生
   *   侧向力 —— 错了。绕 X 轴产生的是**前后向 x** 力（踝离地 5cm ⇒ 力臂极小），
   *   这恰恰解释了为什么踝的额状权限很弱：**几何决定的，不是增益问题**。
   */
  rx: number; ry: number; rz: number;
  /** 该轴的力矩上限（N·m），已按 τmax 填好 */
  tauMax: number;
  /** 权重：按 τmax 归一（Kim 2022：W_τ 逐关节对角，踝取髋的 3~5 倍） */
  w: number;
}

export interface QpInput {
  /** 被求解的轴（通常是承重腿的 hip/knee/ankle + 腰，全部矢状+额状） */
  axes: QpAxis[];
  /** 期望的地面反力 —— **矢状**（N，+x 朝前） */
  fDesX: number;
  /**
   * ★★ 期望的地面反力 —— **竖向**（N，+y 朝上）。
   *
   *   **必填，且不是可选项。** 完整逆动力学是
   *       `M(q)a + C + g = Sᵀτ + JᵀF`
   *   竖向那一行**就是撑体重**：`F_y = m·(g + a_y_des)`，静态时 `= m·g`。
   *
   *   ⚠⚠ 为什么必填（这是本文件最重要的一次修正，2026-10-06）：
   *   原实现**显式排除**竖向（注释：「竖向由体重承担，不靠关节力矩」），只解
   *   2×2 正规方程。后果不是"少了一维、精度差一点"，而是：
   *       等式只管水平 ⇒ 求出来的 τ 是「在任意竖向载荷下都成立」的力矩，
   *       而系统此刻正被 mg 压着 ⇒ **QP 一写进去就把唯一的支撑擦掉**。
   *   这与 `wantedForce.ts:196` 记的是同一件事的两面：那里因为「位置伺服
   *   已经在撑体重」而把 `weight` 关掉，理由是「叠一份 mg 就是重力双计」。
   *   两边都躲，于是**谁都没撑体重**。
   *
   *   ⇒ 正确处置（`wantedForce.ts:200` 已经写下了配方，本文件是执行它）：
   *     ① QP 对它求解的每一根轴调 `requestHold` ⇒ 位置环 P 项归零、退化为纯阻尼
   *        （`ragdoll.ts:2435`），不再有第二个撑体重的来源；
   *     ② 此时才允许把 `mg` 放进等式的竖向行。
   *   顺序反了就是双计，顺序对了才是定量支撑。
   */
  fDesY: number;
  /** 期望的地面反力 —— **额状**（N，+z 朝左） */
  fDesZ: number;
  /** 支撑多边形在世界系下的 X 区间 [minX, maxX] */
  copXRange: [number, number];
  copZRange: [number, number];
  /**
   * 摩擦系数（F/T 摩擦锥）。QP **不能**给出一个摩擦锥外的地面反力 ——
   * 那不是"推不动"，是**物理上不存在**。默认 0.8（橡胶底/橡胶地）。
   * 用它替代原来那句「竖向不参与等式」：竖向不进等式 ⇒ 摩擦锥无从判定。
   */
  mu?: number;
  /** 迭代数（默认 40，实测够） */
  iters?: number;
  /** 权重放大：踝相对髋的倍数（文献 3~5，取 4） */
  ankleWeightMul?: number;
}

export interface QpOutput {
  /** 每个轴解出的力矩（与 `axes` 同序） */
  tau: Float64Array;
  /** 是否全部约束都满足（不满足时 `tau` 是"尽力而为"的投影点） */
  feasible: boolean;
  /** 等式残差 ‖Σ τ·arm − F_des‖（N，**三维**）。0 = 精确解 */
  residual: number;
  /**
   * 分量残差（magnitude）。`residual` 是三个分量的合成模，
   * 而竖向分量天然比水平大一个量级（mg≈687 N vs 侧向几十 N），
   * ⇒ 只看合成模会**把竖向没撑住这件事完全掩盖掉**。
   * 这正是本文件原来"看不见自己错在哪"的原因。
   */
  residualXYZ: [number, number, number];
  /** 合成地面反力（N，三维），便于回读 */
  fActual: [number, number, number];
  /** 各条不等式的逐条结果（false = 这条没过，`feasible` 才是 false） */
  checks: {
    box: boolean;        // |τ_i| ≤ τmax_i
    equality: boolean;    // ‖residual‖ ≤ tol
    cop: boolean;        // 合力方向落在支撑多边形凸锥内
    friction: boolean;   // |F_h| ≤ μ·F_y 且 F_y ≥ 0
  };
  iters: number;
}

/**
 * 求解。
 *
 * 约束（按优先级投影，硬的先投）：
 *   C1 支撑多边形：`|CoP_x − 中心| ≤ 半宽` 等价于 `Στ·arm` 的水平分量受限
 *   C2 力矩上限：`|τ_i| ≤ τmax_i`（盒约束，一次投影即可）
 *   C3 等式：`Σ τ_i · arm_i = F_des`（投影到超平面）
 *
 * 循环 C2→C3，收敛后不动点即为投影点。
 */
export function solveWholeBodyQp(inp: QpInput): QpOutput {
  const n = inp.axes.length;
  const tau = new Float64Array(n);
  const mu = inp.mu ?? 0.8;
  if (n === 0) {
    return {
      tau, feasible: false, residual: 0,
      residualXYZ: [0, 0, 0], fActual: [0, 0, 0],
      checks: { box: false, equality: false, cop: false, friction: false },
      iters: 0,
    };
  }
  const iters = inp.iters ?? 40;

  // ── 等式约束：三维，不是两维 ──────────────────────────────────────────
  //   `c_i = axis_i × r_i`（**三维**），`F = Σ τ_i · c_i`。
  //   ★ 2026-10-06：原实现只取 `c` 的 x、z 两个分量（竖向被显式丢弃）。
  //     丢掉的那一项 `c_y = w_z·r_x − w_x·r_z` 恰恰是**踝策略的物理通道**：
  //     绕 X（外展）轴的力矩给出 `F_y = −τ_x·r_z` —— 前后半臂就是竖向力，
  //     所以踝改变压力中心（CoP）**必须**经过这一项。
  //     竖向不进等式 ⇒ 踝的 CoP 权限在数学上就不存在。
  const C = new Float64Array(n * 3);       // 行主序 3×n：行 0=x, 1=y, 2=z
  for (let i = 0; i < n; i++) {
    const a = inp.axes[i]!;
    C[i * 3]     = a.wy * a.rz - a.wz * a.ry;   // c_x
    C[i * 3 + 1] = a.wz * a.rx - a.wx * a.rz;   // c_y  ← 新增
    C[i * 3 + 2] = a.wx * a.ry - a.wy * a.rx;   // c_z
  }
  const iw = new Float64Array(n);
  for (let i = 0; i < n; i++) iw[i] = 1 / Math.max(1e-9, inp.axes[i]!.w);

  // `b` = F_des（三维）
  const b0 = inp.fDesX, b1 = inp.fDesY, b2 = inp.fDesZ;

  /**
   * 3×3 对称矩阵的闭式求逆解 `λ = N⁻¹ r`。
   *
   * 用伴随矩阵而不是 Cramer 展开式，是为了**同时拿到行列式**做奇异性判定：
   * `det` 接近 0 ⇒ 这组轴的力臂在三维里退化（共面/共线）⇒ 等式欠定。
   * 原来的 2×2 版本只看水平面，垂向退化完全不可见 —— 而**垂向正是撑体重
   * 所在的方向**，退化时输出会是一组"看起来正常但没有竖向权限"的力矩。
   *
   * @param off 起始下标（用来在子矩阵 `N` 上就地累加，不额外分配）
   * @param fix 非 0 的轴被钉在边界上，只累加自由轴的贡献（= 子矩阵）
   */
  const solve3 = (
    N: Float64Array, fix: Int8Array | null,
    r0: number, r1: number, r2: number,
  ): { ok: boolean; l0: number; l1: number; l2: number } => {
    // 累加 N = A_free · W_free⁻¹ · A_freeᵀ（3×3，对称）
    N[0] = 0; N[1] = 0; N[2] = 0; N[3] = 0; N[4] = 0; N[5] = 0;
    N[6] = 0; N[7] = 0; N[8] = 0;
    for (let i = 0; i < n; i++) {
      if (fix !== null && fix[i] !== 0) continue;
      const w = iw[i]!;
      const a0 = C[i * 3]!, a1 = C[i * 3 + 1]!, a2 = C[i * 3 + 2]!;
      N[0] += a0 * w * a0; N[1] += a0 * w * a1; N[2] += a0 * w * a2;
      N[4] += a1 * w * a1; N[5] += a1 * w * a2;
      N[8] += a2 * w * a2;
    }
    N[3] = N[1]!; N[6] = N[2]!; N[7] = N[5]!;      // 对称化
    const m00 = N[0]!, m01 = N[1]!, m02 = N[2]!;
    const m11 = N[4]!, m12 = N[5]!, m22 = N[8]!;
    // 伴随矩阵（对称阵的伴随 = 余子式矩阵）
    const a00 = m11 * m22 - m12 * m12;
    const a01 = m12 * m02 - m01 * m22;
    const a02 = m01 * m12 - m11 * m02;
    const a11 = m00 * m22 - m02 * m02;
    const a12 = m02 * m01 - m00 * m12;
    const a22 = m00 * m11 - m01 * m01;
    const det = a00 * m00 + a01 * m01 + a02 * m02;
    // 尺度相关的退化阈值：用 N 的迹，量纲一致
    const scale = Math.abs(m00) + Math.abs(m11) + Math.abs(m22);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12 * Math.max(1e-30, scale ** 3)) {
      return { ok: false, l0: 0, l1: 0, l2: 0 };
    }
    const id = 1 / det;
    return {
      ok: true,
      l0: (a00 * r0 + a01 * r1 + a02 * r2) * id,
      l1: (a01 * r0 + a11 * r1 + a12 * r2) * id,
      l2: (a02 * r0 + a12 * r1 + a22 * r2) * id,
    };
  };

  // ── 无约束最小范数解：τ₀ = W⁻¹Aᵀ(AW⁻¹Aᵀ)⁻¹ b ────────────────────────
  const Nfull = new Float64Array(9);
  const l0f = solve3(Nfull, null, b0, b1, b2);
  let tau0: Float64Array;
  let degenerate = false;
  if (l0f.ok) {
    tau0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tau0[i] = iw[i]! * (C[i * 3]! * l0f.l0 + C[i * 3 + 1]! * l0f.l1 + C[i * 3 + 2]! * l0f.l2);
    }
  } else {
    // ★ 力臂在三维里退化（全部共面或共线）⇒ **无法解等式**。
    //   退化方向上取 |c| 最长的轴按 F_des 的模长比例满足，让输出至少"动起来"。
    //   这个降级**必须**在输出里说出来（`checks.equality` 会掉、`feasible=false`），
    //   绝不静默 —— 否则调用方拿到一组看似正常的 τ。
    degenerate = true;
    let best = -1, bestR = 1e-9;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(C[i * 3]!, C[i * 3 + 1]!, C[i * 3 + 2]!);
      if (r > bestR) { bestR = r; best = i; }
    }
    tau0 = new Float64Array(n);
    if (best >= 0) {
      const mag = Math.hypot(b0, b1, b2);
      // 沿 c 的方向投 F_des：τ = (c·b̂)/|c|² × mag，取 c·b 的符号
      const dot = C[best * 3]! * b0 + C[best * 3 + 1]! * b1 + C[best * 3 + 2]! * b2;
      tau0[best] = (mag / bestR) * Math.sign(dot || 1);
    }
  }

  // ★★ `tau0` 必须拷进 `tau`！少了这一行 ⇒ `tau` 全 0 ⇒ 输出恒为 0
  //   （实测：所有 F_des 的残差都等于 |F_des| 本身，合成恒 (0,0)）
  tau.set(tau0);

  // ── 求解：**主动集法**（active-set QP），不是 POCS ────────────────────
  //
  // 问题：约束是「盒 + 3 个等式」，POCS 在这类混合约束上不收敛
  //   · 阻尼步长 0.5 ⇒ 投影在盒边界来回弹跳，F_des=20N 给出 322.8N（过冲 16 倍）
  //   · 步长 1.0 ⇒ 等式投影把盒内点推出去，输出达 τmax 的 100 倍
  //
  // 正确做法：这是**标准的带等式约束 QP**。把当前违反盒约束的轴固定在边界上，
  // 对剩下的自由轴解等式 —— 降到 3×3 闭式，**精确**、**单调**、无过冲。
  // 迭代：找出违规轴 → 钉住 → 解 → 重复
  // 每步的 τ 都**严格在盒内**，等式残差逐步下降。
  //
  // 变量定义：free = 未被钉住的轴；fixed = 被钉在 ±τmax 的轴。
  //   A_free τ_free + A_fixed τ_fixed = b  ⇒  τ_free = τ_free⁰ + W_f⁻¹A_fᵀ N_f⁻¹ (b − A_free τ_free⁰)
  const FIXED = new Int8Array(n);      // 0 = 自由, 1 = 钉在 +, -1 = 钉在 −
  const Nsub = new Float64Array(9);
  let used = 0;
  for (let iter = 0; iter < 8 * n; iter++) {
    used = iter + 1;
    // ① 当前解（自由轴取最优，钉住轴取边界）
    tau.set(tau0);
    for (let i = 0; i < n; i++) {
      if (FIXED[i] === 1) tau[i] = inp.axes[i]!.tauMax;
      else if (FIXED[i] === -1) tau[i] = -inp.axes[i]!.tauMax;
    }
    // ② 自由轴当前已贡献的部分 g，以及残差 r = b − g（**三维**）
    let g0 = 0, g1 = 0, g2 = 0, nf = 0;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      const t = tau[i]!;
      g0 += C[i * 3]! * t; g1 += C[i * 3 + 1]! * t; g2 += C[i * 3 + 2]! * t; nf++;
    }
    if (nf === 0) break;
    const lam = solve3(Nsub, FIXED, b0 - g0, b1 - g1, b2 - g2);
    if (!lam.ok) break;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      tau[i] = tau[i]! + iw[i]! * (C[i * 3]! * lam.l0 + C[i * 3 + 1]! * lam.l1 + C[i * 3 + 2]! * lam.l2);
    }
    // ③ 若某个自由轴越界 ⇒ 钉它
    let changed = false;
    for (let i = 0; i < n; i++) {
      const m = inp.axes[i]!.tauMax;
      if (FIXED[i] === 0) {
        if (tau[i]! > m) { FIXED[i] = 1; changed = true; }
        else if (tau[i]! < -m) { FIXED[i] = -1; changed = true; }
      }
    }
    if (!changed) break;
  }

  // ── 残差（分分量报告）+ 四条不等式逐条判定 ───────────────────────────
  let s0 = 0, s1 = 0, s2 = 0;
  let boxOk = true;
  for (let i = 0; i < n; i++) {
    s0 += tau[i]! * C[i * 3]!;
    s1 += tau[i]! * C[i * 3 + 1]!;
    s2 += tau[i]! * C[i * 3 + 2]!;
    if (Math.abs(tau[i]!) > inp.axes[i]!.tauMax * 1.001) boxOk = false;
  }
  const rx = s0 - b0, ry = s1 - b1, rz = s2 - b2;
  const residualXYZ: [number, number, number] = [rx, ry, rz];
  const residual = Math.hypot(rx, ry, rz);

  // ★ CoP 可行性：**支撑多边形的凸锥**判据（Piazza 2024, Thm 1 / Lemma 1）。
  //
  //   合成水平力 (Fx,Fz) 必须能被多边形内的分布**纯压力**地分解
  //   ⇔ 该矢量落在以原点为顶点的**多边形凸锥**内。
  //   判定：把多边形各顶点按"极角"排序，矢量方向必须落在相邻顶点的角度区间内。
  //   （我第一版写的是 `|F| ≤ 半宽 × 686` —— 686 是**体重（竖向）**，
  //     与水平分力能否实现毫无关系，纯属臆造；射线法又漏掉 t<0 的情形，已删。）
  const copOk = (() => {
    const F = Math.hypot(s0, s2);
    if (F < 1e-9) return true;                        // 无水平力 ⇒ 恒可行
    const [x0, x1] = inp.copXRange, [z0, z1] = inp.copZRange;
    const ang = (x: number, z: number): number => Math.atan2(z, x);
    const a = [ang(x0, z0), ang(x1, z0), ang(x1, z1), ang(x0, z1)];
    const target = ang(s0, s2);
    for (let k = 0; k < 4; k++) {
      let a0 = a[k]!, a1 = a[(k + 1) % 4]!;
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      let t = target - a0;
      while (t > Math.PI) t -= 2 * Math.PI;
      while (t < -Math.PI) t += 2 * Math.PI;
      if (t >= -1e-9 && t <= d + 1e-9) return true;
    }
    return false;
  })();

  // ★ 摩擦锥（F/T）：`|F_h| ≤ μ·F_y` 且 `F_y ≥ 0`。
  //   这条在竖向不进等式时**根本无法判定**（没有 F_y）。
  //   ⇒ 它正是把竖向补回等式之后才拿得到的那条物理上限：
  //     「推不动」和「物理上不存在」必须分开报，否则调参会一直撞幻觉墙。
  const Fh = Math.hypot(s0, s2);
  const frictionOk = s1 >= 0 && Fh <= mu * s1 + 1e-6;

  // ★ 容差按**每个分量各自**给，不按合成模给。
  //   原实现 `tolEq = 1% × |F_h|`：竖向分量比水平大一个量级（mg≈687 vs 几十），
  //   于是「竖向差 300 N」在合成模里被摊薄成合格 —— 而那 300 N 就是「没撑住」。
  const tolEqX = 0.01 * Math.max(1, Math.abs(b0));
  const tolEqY = 0.01 * Math.max(1, Math.abs(b1));
  const tolEqZ = 0.01 * Math.max(1, Math.abs(b2));
  const equalityOk = !degenerate
    && Math.abs(rx) <= tolEqX && Math.abs(ry) <= tolEqY && Math.abs(rz) <= tolEqZ;

  return {
    tau,
    feasible: boxOk && equalityOk && copOk && frictionOk,
    residual, residualXYZ,
    fActual: [s0, s1, s2],
    checks: { box: boxOk, equality: equalityOk, cop: copOk, friction: frictionOk },
    iters: used,
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * 与 RigState / Ragdoll 的接线
 * ════════════════════════════════════════════════════════════════════════ */

import { DEFAULT_WANTED_FORCE } from './wantedForce';

/** 一拍的 QP 输出（可直接回读） */
export interface QpTick {
  /** 每个轴的解，按 `axes` 顺序 */
  tau: Float64Array;
  /** 轴的描述（回读用：关节名 + 轴号） */
  names: string[];
  feasible: boolean;
  residual: number;
  /** 分量残差（N）：竖向那一项就是"没撑住多少" */
  residualXYZ: [number, number, number];
  fDesX: number;
  /** ★ 竖向目标 = 撑体重（`m·g`） */
  fDesY: number;
  fDesZ: number;
  /** 实际合成出来的地面反力（N，三维） */
  fActual: [number, number, number];
  /** 四条不等式逐条结果 —— `feasible` 只是它们的与 */
  checks: {
    box: boolean; equality: boolean; cop: boolean; friction: boolean;
  };
  /** 本拍请求了哪些轴（人数） */
  nAxes: number;
  /** ξ（相对支撑中心）—— 确认 F_des 满足控制理论前提时读它 */
  xiX: number;
  xiZ: number;
  /** 是否碰到摩擦锥上限了（满足控制理论前提时应为 false） */
  grfSat: boolean;
}

/**
 * ★ **支撑多边形** = 所有**着地**脚的鞋底包围盒之并。
 *
 * ⚠⚠ **不能只取单脚**：实测（左脚着地，双脚站）
 *     soleBounds Z=[0.077, 0.257] ⇒ 单脚中心 z=+0.167，而 `com.z=0.003`。
 *     双脚着地时 com 在**两脚之间**，所以拿单脚中心当 ξ 的参考 ⇒
 *     永久横向偏差 167mm = `F_des_z ≈ 0.8×760×0.167 = 127N` 恒定侧推
 *     !d2 ξ 被自己喂大 !d2 正反馈 !d2 角色横着散开。
 *     （这是本轮实测到的，不是推断。）
 *
 * ⇑ 参考点取**并集**的中心；CoP 可行区间也用并集
 *   —— 否则 QP 会把“足底落在双支撑区里”判成不可行。
 */
export function supportPolygon(
  doll: Ragdoll,
): { cx: number; cz: number; x: [number, number]; z: [number, number]; nFeet: number } {
  const bb = new Float64Array(4);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (const idx of [0, 1] as const) {
    if (!doll.footGrounded(idx)) continue;
    doll.footSoleBounds(idx, bb);
    x0 = Math.min(x0, bb[0]!); x1 = Math.max(x1, bb[1]!);
    z0 = Math.min(z0, bb[2]!); z1 = Math.max(z1, bb[3]!);
    n++;
  }
  if (n === 0) {   // 一只脚都不着地 ⇒ 无支撑，退回单腿中心供调试
    doll.footSoleBounds(0, bb);
    x0 = bb[0]!; x1 = bb[1]!; z0 = bb[2]!; z1 = bb[3]!;
  }
  return { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, x: [x0, x1], z: [z0, z1], nFeet: n };
}

/**
 * ★★★ QP 的**轴集合（唯一真源）** —— 关节基名 + 轴号，运行时补上腿侧后缀。
 *
 *   为什么要导出成常量：`AXIS_OWNERSHIP`（balance.ts）必须登记 QP 要写的每一根轴，
 *   而这份名单以前是**手抄**在两处的（这里 + 表里）⇒ 改一处忘另一处，
 *   就会出现「表在说谎」或「轴没登记」。门禁 E2 现在拿它双向对账。
 *
 *   ⚠ `hip` 只有 1、2 轴：`hip/0`（外展）的 tau 主人是 `latTransfer`。
 *   ⚠ 2026-10-06 腰（`spine1..3`）已移出（依据 Winter 1996 / 1998，见下）。
 */
// ★★★ 2026-10-06 **踝轴开关**（`QPNK=1`：把 `foot/2` 从 QP 里摘掉）。
//   实测（`probe-foot01` 前 0.12s）：QP 在写踝矢状轴，把 CoP **一路往前推**
//   （+7→+20mm）而 CoM 不动 ⇒ 净水平力向后 ⇒ `vx` 0→**−14.5mm/s**（后倒起点）。
//   关掉整个 QP（`ABL=qp`）：CoP 回到 **−5mm**、`vx` 保持 +1.4→+3.5、踝 τ 回到 ∓个位数
//   ⇒ **前 0.1s 的前后破坏源就是 QP 的踝轴**（它还与 `ankleCop` 同轴，是门禁里
//   那条未登记的冲突）。
const QP_NO_ANKLE = ['1', 'true', 'on'].includes(String(
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).QPNK ?? '').toLowerCase());

export const QP_AXIS_SPEC: readonly { joint: string; axes: readonly number[] }[] = Object.freeze([
  { joint: 'foot', axes: Object.freeze(QP_NO_ANKLE ? [0, 1] as number[] : [0, 1, 2] as number[]) },
  { joint: 'knee', axes: Object.freeze([0, 1, 2]) },
  { joint: 'hip', axes: Object.freeze([1, 2]) },
]);

/**
 * 从 `Ragdoll` 的当前状态构造待求轴：**承重腿整条链**，矢状 + 额状。
 *
 * 为什么只取承重腿（附录 B.1：「一次动一个模块」是 step 的职责）：
 *   摆动腿不承重，它的地面对 CoM 无净贡献；把它放进等式约束会让
 *   求解器去"命令一条不接触地面的腿"，那是纯粹的伪自由度。
 *
 * @param ankleMul 踝轴权重倍数（Kim 2022：踝取髋的 3~5 倍）。
 *   权重**按 τmax 归一**后乘这个 —— 含义是"同样 τmax 下踝更值得用"。
 */
export function buildQpAxes(
  rs: RigState, doll: Ragdoll, sup: Side, ankleMul = 4,
): QpAxis[] {
  const sk = rs.sk;
  const out: QpAxis[] = [];
  const idx = (nm: string): number => sk.joints.findIndex((j) => j.name === nm);
  // ★ `jointWorld` 的签名是 `(i, out) => void`（写进 out，不是返回）
  const supW = new Float64Array(3);
  doll.jointWorld(idx(`foot_${sup}`), supW);
  // 接触点取**足底包围盒中心**（比踝位置低，力臂才是对的）
  const BBt = new Float64Array(4);
  doll.footSoleBounds(sup === 'l' ? 0 : 1, BBt);
  const copW = new Float64Array([(BBt[0]! + BBt[1]!) / 2, BBt[2]!, (BBt[2]! + BBt[3]!) / 2]);
  void supW;

  // 关节与要解的轴：由 `QP_AXIS_SPEC` 展开（表与代码的唯一真源）
  const spec: [string, number][] = [];
  for (const g of QP_AXIS_SPEC) {
    for (const ax of g.axes) spec.push([`${g.joint}_${sup}`, ax]);
  }
  // ★★ 2026-10-06 腰的三轴**移出 QP**（依据 Winter 1996 / 1998，见下）。
    //   QP 的等式只有**水平两行**（`wholeBodyQp.ts` 的 `Cx/Cz`），所以
    //   腰在 QP 里既没有"该多直"的约束、也没有任何姿态项 ——
    //   它只是被动分摊水平力矩的一个**冗余自由度**，由最小范数随意填。
    //   实测后果（`tools/dbg-spine2`，每物理步）：
    //       t=0.000  spine1/2 = −1.4°  τ = +14.3
    //       t=0.050  spine1/2 = −27.2° τ = −120.0（打满）
    //       t=0.250  spine1/2 = −43.9° τ = −120.0（限位 ±25°，超 1.8 倍）
    //   目标恒为 0（`requestWaistSlot` 在 `DOUBLE` 相 `authority=0` ⇒ 请求 0）
    //   ⇒ **没有任何指令折腰，是 QP 自己在把它折下去。**
    //
    //   文献依据：
    //     Winter 1996 *J Neurophysiol* 75:2334 — 静立两个平衡机构完全分离，
    //       矢状 = 踝、额状 = 髋，**腰在两张表里都不出现**。
    //     Winter 1998 80:1211 — `Ke ≈ 850 N·m/rad` 在**踝**跖屈肌，
    //       `Ma = R·px`（踝力矩 ∝ CoP 偏移）。
    //     Horak & Nashner 1986 — 踝策略远端→近端，躯干最后被动参与。
    //   ⇒ 腰不进平衡求解；它只该抵抗自重折叠（静态 3% MVC）。
    //   ⇒ QP 要搬水平力，用**踝**（矢状，Vincent/CoP 策略）和**髋外展**（额状，
    //     换载荷），这两条本来就已经在跑（`ankleCop` / `latTransfer`）。
    //
    //   ⚠ 代价（必须知道）：移出后腰在水平面内**完全不受 QP 约束**，
    //     躯干姿态不再被 QP 主动修正 —— 这与用户「平衡系统需要能控制体态」
    //     的要求冲突。正确形态是**躯干姿态作为一个任务**进 QP（任务空间），
    //     而不是让腰作为冗余自由度被动分摊。这属于 #1 逆动力学的后续工作。
  for (const [nm, ax] of spec) {
    const ji = idx(nm);
    if (ji < 0) continue;
    const j = sk.joints[ji]!;
    if (!j.revoluteAxis && ax === 2 && j.name.startsWith('foot')) continue;
    // 该轴的世界方向 = 父刚体姿态旋转局部轴
    const pw = doll.bodyWorldAxis(ji, ax as 0 | 1 | 2);
    const jw = new Float64Array(3);
    doll.jointWorld(ji, jw);
    // 力臂 = 关节 − 支撑点。地面反力作用在 CoP，力矩 = r × F
    const tmax = Math.abs(j.maxTorque[ax]!);
    if (!(tmax > 1e-6)) continue;
    // 权重：按 τmax 归一（无量纲）⇒ "单位力矩的相对代价"
    // 踝 ×ankleMul（文献：踝是额状/矢状 CoP 的主力，值得优先用）
    const isAnkle = nm.startsWith('foot_');
    out.push({
      joint: ji, axis: ax,
      wx: pw[0], wy: pw[1], wz: pw[2],
      // ★ 力臂 = 关节位置 − 接触点（取足底接触面中点，不是踝位置）
      rx: jw[0] - copW[0], ry: jw[1] - copW[1], rz: jw[2] - copW[2],
      tauMax: tmax,
      w: (isAnkle ? ankleMul : 1) / tmax,
    });
  }
  return out;
}

/**
 * 从 `RigState` 的 ξ 生成期望水平地面反力。
 *
 * ξ = CoM − Ẋ/ω₀（附录 B.3）。要 ξ → 0，需要 CoM 加速度 `a = −ω₀²·ξ`，
 * 由 `M·a = ΣF + mg` ⇒ **`F_des = m·(a − g)**`：
 *     Fx_des = −m·ω₀²·ξ_x
 *     Fz_des = −m·ω₀²·ξ_z
 *  ⇒ 只在**水平**两个方向给出目标（竖向由体重承担，不靠关节力矩）。
 *
 * ★★ **ξ 必须相对"期望 CoP 位置"算，不能相对世界原点** —— 这是实测踩到的：
 *   第一版写 `xiX = com.x − vx/ω₀`（世界原点），于是角色只要走出 1m，
 *   ξ 就变 1.0，`m·ω₀²·ξ = 763N` ⇒ 越走越用力，形成正反馈。
 *   实测倒地把 F_des 推到 **3733N**（mω₀² = 760 ⇒ ξ≈4.9m），而那只是尸体状态。
 *   ⇒ 改为相对支撑中心 `ref`，即"把 CoP 拉回支撑面中心"这件事。
 *
 * ★ 饱和：`|F_h| ≤ μ·N ≈ μ·m·g`（摩擦锥，μ 取 0.8）。
 *   这是**物理上限**，不是经验裁剪：超过它就没有任何接触力分布能实现，
 *   QP 也就不该收到这个目标。
 */
export function desiredGrfFromXi(
  rs: RigState, m: number,
  ref: { x: number; z: number } = { x: 0, z: 0 },
  mu = 0.8,
): { fx: number; fz: number; xiX: number; xiZ: number; sat: boolean } {
  const h = Math.max(0.05, rs.com.y);
  const w0 = Math.sqrt(9.81 / h);
  // ★★★★★ 2026-10-06 **速度项符号修正**（`QPXI=1`，默认 0 = 保持旧行为到验证完）
  //   捕获点的定义是 `ξ = (x − ref) + v/ω₀`（**加**号）。
  //   旧代码写成 `(x − ref) − v/ω₀` ⇒
  //     `f = −m·ω₀²·ξ = −k(x−ref) **+** m·ω₀·v`  ⇒ **速度项是正反馈**！
  //   正确形式（把 CoP 放到 ξ）：`F = m·ẍ = m·ω₀²(x − ξ) = −m·ω₀·v` ⇒ **阻尼**。
  //   实测（`probe-lat` 默认）：`CoM.z` 3→171 mm **单调加速**（`v.z` 一路为正）、
  //   `probe-footpush`：`CoM.x` 一路后退到 −397 mm —— 前后+横向**同时**单调漂移，
  //   与"速度项是负阻尼"完全一致。
  const envW = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  // ★★★★★ 2026-10-06 **实测裁定：默认保持旧形式（减号）**。
  //   推导上捕获点应是 `x + v/ω₀`，但实测「转正加号」把**钉死 DOUBLE 的存活
  //   从 12.00 s 打到 1.11 s**（站立门禁 1.18→1.04、停手 1.34→0.63）⇒
  //   本 rig 的 `fDesX` 口径与"m·ẍ"推导**相反**（减号才是对的）。
  //   `QPXI=1` 保留作对照（它把横向漂移 171→54 mm，但以牺牲站立为代价，
  //   正是"符号对但口径反"的典型表现 —— 两面都对不上，说明还没找对口径）。
  const xiQp = String(envW.QPXI ?? '').trim().toLowerCase();
  const xiPlus = ['1', 'true', 'on'].includes(xiQp);
  const xiX = (rs.com.x - ref.x) + (xiPlus ? 1 : -1) * rs.com.vx / w0;
  const xiZ = (rs.com.z - ref.z) + (xiPlus ? 1 : -1) * rs.com.vz / w0;
  let fx = -m * w0 * w0 * xiX;
  let fz = -m * w0 * w0 * xiZ;
  const lim = mu * m * 9.81;
  const mag = Math.hypot(fx, fz);
  let sat = false;
  if (mag > lim && mag > 1e-9) { fx *= lim / mag; fz *= lim / mag; sat = true; }
  return { fx, fz, xiX, xiZ, sat };
}

/**
 * 每拍调一次：构造轴 → 求解 → 把解写进 `rs.requestTorque`。
 *
 * ★ 轴归属：这些轴走 `mode='tau'`（力矩通道），所以**不会**和位置环双计
 *   （附录 B.4 的处置表）。`requestTorque` 的仲裁规则是 balance > step，
 *   与 `latTransfer` 同级 —— 若两者同时写同一轴，本函数后调用会覆盖前者。
 *   为避免静默互相覆盖，本函数**只写 `latTransfer` 之外的轴**（由调用方保证）。
 *
 * @param gain 把 ξ 误差映射到 F 的额外增益（默认 1；>1 更激进）
 */
export function wholeBodyBalanceTick(
  rs: RigState, doll: Ragdoll, sup: Side,
  opt: { ankleMul?: number; gain?: number; iters?: number } = {},
): QpTick {
  const sk = rs.sk;
  const axes = buildQpAxes(rs, doll, sup, opt.ankleMul ?? 4);
  const g = opt.gain ?? 1;
  // ★ 相对**支撑多边形**的中心（否则当双脚着地时会永远偏）
  const SP = supportPolygon(doll);
  const grf = desiredGrfFromXi(rs, sk.massTotal, { x: SP.cx, z: SP.cz });
  // ★★★ 2026-10-06 **横向力符号开关**（`QPSIGN`，默认 1 = 现状，−1 = 翻转）。
  //   实测（`probe-lat`）：**关掉整个 QP（`ABL=qp`）后 `CoM.z` 纹丝不动**
  //   （3,3,2,1,0,−1,−2 mm），而默认下它 0→171 mm 一路左漂并**把承重腿翻掉**
  //   （l/r ↔ r/l 来回换）。⇒ QP 的横向力极可能是**正反馈**（符号约定病）。
  const qpSign = (() => {
    const env2 = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const v = Number(env2.QPSIGN ?? '');
    return Number.isFinite(v) && v !== 0 ? v : 1;
  })();
  const fx = grf.fx * g, fz = qpSign * grf.fz * g;

  // ★★ 竖向：**撑体重**。`F_y = m·(g + a_y)`，静态时 `a_y = 0` ⇒ `m·g`。
  //
  //   这一项必须与下面 ① 的 `requestHold` **成对出现**，顺序不能反：
  //     · 先 `requestHold`（位置环 P 项归零，只剩阻尼）⇒ 位置伺服不再撑体重；
  //     · 再把 `mg` 放进等式 ⇒ 竖向支撑**定量**且**只有一份**。
  //   只做前者不做后者 ⇒ 没人撑体重（当前状态）；
  //   只做后者不做前者 ⇒ mg 双计，把关节灌爆
  //   （`wantedForce.ts:197` 实测：含 mg 且位置伺服还在，单腿 1.5 s → 0.43 s，
  //     `hip/1` 钉在 ±70 N·m）。
  //
  //   体重真源用 `sk.massTotal`（骨架唯一真源），不用 `70×9.81` 那个魔数
  //   —— `wantedForce.ts:79` 的 `weight: 70*9.81` 是**另一处**独立写死的，
  //   本文件不复制它。
  const fy = sk.massTotal * 9.81;

  const out = solveWholeBodyQp({
    axes,
    fDesX: fx, fDesY: fy, fDesZ: fz,
    copXRange: SP.x,
    copZRange: SP.z,
    iters: opt.iters ?? 40,
  });

  const names: string[] = [];
  for (let i = 0; i < axes.length; i++) {
    const a = axes[i]!;
    const nm = `${sk.joints[a.joint]!.name}/${a.axis}`;
    names.push(nm);
    const t = out.tau[i]!;
    if (Math.abs(t) < 1e-6) continue;      // 不写 0，避免把轴标成"有人管"
    // ★★ 统一用 `addTorque`（累加）—— 不用 `requestTorque`（会被压制）也不用
    //   `forceTorque`（会抹掉同通道的静力矩）。两者的实测后果见 `addTorque` 注释。
    rs.addTorque(a.joint, a.axis, t, 'balance', `全链QP/${nm}`);
  }
  // ★★★ ① **让位**：QP 求解的轴，位置环必须交出 P 项。
  //
  //   这是竖向支撑能定量起来的**唯一前提**（见上面 `fy` 处的说明）：
  //   位置伺服只要还在跟 `θ_ref ≠ θ`，它就在持续输出一个撑体重的力矩，
  //   与等式里的 `mg` 构成**重力双计**。
  //
  //   `requestHold` ⇒ `holdMask` ⇒ `ragdoll.ts:2435` `holdCmd` ⇒
  //   位置环退化为 `err = -kDd·ω_rel`（纯阻尼，P 项为零）。
  //
  //   ⚠ 为什么放在**写完 τ 之后**：让位是"这根轴交给力矩通道"的**声明**，
  //   不是求解的前提。放在求解之后，于是"本拍解出来了"与"本拍让位了"
  //     是同一个循环里相邻的两步，读者能一眼看出它们成对。
  //   ⚠ `addTorque` **不调** `claimAxis`（见 `rigState.ts:924` 的注释），
  //     所以这一行是 QP 唯一被记入 `holdMask` 的地方 —— 去掉它，
  //     `mg` 与位置伺服的力矩会同时存在，且**没有任何机制会报告这件事**。
  // ★★★ 2026-10-06 **撤回这一步**（`probe-readout` ⑤ 实测腰在 0.18s 内被推到限位 3.2 倍）。
  //
  //   原本的想法是「QP 接管 ⇒ 位置环退化为纯阻尼 ⇒ 等式里的 mg 不双计」。
  //   但实测表明**在腰上这个前提根本不成立**，而且失效方式很坏：
  //
  //     · 让位后 `err = −kD·ω_rel`（纯阻尼），于是该轴**唯一的**回复力矩
  //       来自 `enforceLimits`，而它的权限虽然刚被修好（3× 马达），
  //       回收速度上限 36 rad/s 仍然需要约 **10 个物理步**才能把 55° 拉回 25°；
  //       期间腰的姿态目标（`postureSag`/`postureLat`，位置环通道）被完全忽略。
  //     · 实测：让位后 `spine1/2` 从 −1.4° 单调冲到 **−79.6°**（限位 ±25° 的 3.2 倍），
  //       `spine1/0` 冲到 **+54.5°**（限位 ±15° 的 3.6 倍）。
  //     · 四轴 τmax 全耗在对抗限位冲量上 ⇒ 力矩全变成内耗，
  //       一点都变不成地面上的力 ⇒ CoM 从 0.962 掉到 0.866（0.25 s 内）。
  //
  //   ⇒ 正确的顺序**反过来**：竖向支撑不该靠「QP 让位 + 等式里放 mg」，
  //     而该靠**接触约束**（λ-QP 的单边/摩擦锥/CoP 那一路，见 `grfQp.ts`）——
  //     地面法向力本来就不需要关节力矩去"造"。
  //     关节力矩该负责的是**力矩平衡**（把 CoP 搬到该在的位置），那部分才交给 QP。
  //
  //   ⇒ 在那之前：**不**让位。让位置环继续给腰做姿态保持（它至少能守住限位），
  //     QP 的 τ 走 `addTorque` **并联**叠加（力矩通道与位置环在 `driveMotors`
  //     里相加、最后按 τmax 饱和，两条路径不冲突）。
  //
  //   ⚠ 这是**撤回一次已经写下的机制**，不是新增。原因记录在案，
  //     免得后面有人看到「等式里有 mg 却不让位」又困惑。
  //   void requestHold(...)  ← 保留位置标记，等 λ-QP 接进 `balance` 后再定
  void 0;
  void DEFAULT_WANTED_FORCE;
  return { tau: out.tau, names, feasible: out.feasible, residual: out.residual,
    fDesX: fx, fDesY: fy, fDesZ: fz, nAxes: axes.length,
    xiX: grf.xiX, xiZ: grf.xiZ, grfSat: grf.sat,
    checks: out.checks, fActual: out.fActual, residualXYZ: out.residualXYZ };
}

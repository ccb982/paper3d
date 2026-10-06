/**
 * ════════════════════════════════════════════════════════════════════════
 * grfQp.ts —— **接触力 QP**（λ-QP）：文献里的那个 QP
 *
 * ════════════════════════════════════════════════════════════════════════
 * 这个文件回答的问题（用户 2026-10-06：「查论文，看到���应该怎么做」）：
 *
 *   本项目此前只有一个 QP（`wholeBodyQp.ts`），决策变量是**关节力矩 τ**，
 *   等式是 `Σ τᵢ(axisᵢ × rᵢ) = F_des` 的**水平两行**。
 *   它必然撑不起体重 —— 实测竖向上限 24.1 N vs 体重 686.7 N（3.5%）。
 *
 *   查文献（Kuindersma 2013 / Herzog 2013,2016 / WBDC 2018 / Cisneros 2020）
 *   得到三条结论，本文件是第一条的落地：
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ QP 的决策变量是**接触力 λ**，不是 τ。                        │
 *   │                                                                │
 *   │ 浮动基座动力学  H(q)q̈ + C(q,q̇) = B u + Φᵀ λ               │
 *   │ 按「驱动 / 欠驱动」拆行，基座那 6 行 B = 0 ⇒ 它是牛顿-欧拉：  │
 *   │     Σ f_i            = m·(a_CoM_des − g)      ← 线性动量       │
 *   │     Σ (p_i − c) × f_i = I_c·α_des + ḣ_c_des  ← 绕 CoM 角动量   │
 *   │                                                                │
 *   │ ★ **竖向力在第一行的 m·(−g) 里，是约束的结果。**              │
 *   │   它不是"要用力矩造出来"的东西 —— 竖向由地面法向力平衡，       │
 *   │   而地面法向力是**接触约束**（单边 + 摩擦锥）给的。            │
 *   │   ⇒ 纯 revolute 的腿照样站得住。                              │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * ── ★★ 接触点的变量：`(f, dx, dz)` 5 个，**不是** `(f, τ)` 6 个 ────────
 *
 *   这是本文件第一版的真 bug，被 `probe-grf` B 段当场抓到：
 *   `F_x = 70 N` 拿到了，但 `ZMP_x = 0.0000 m` —— **水平力没有物理代价**。
 *
 *   原因：第一版给了每个接触一个**自由的接触力矩 τ**。自由的 `τ` 能吸收
 *   任意力矩需求 ⇒ QP 永远不需要搬 CoP ⇒ 「要多大水平力就把 CoP 推多远」
 *   这条最重要的因果关系在数学上消失了。
 *   而物理上，平面足踩平面地面能产生的力矩**全部等价于在足底块内移动压力
 *   中心**：`M_x = dz·f_y`、`M_z = −dx·f_y`、`M_y = dx·f_y − dz·f_x + dx·f_z`，
 *   其中 `(dx, dz)` 就是 CoP 偏移。**没有额外的自由力矩。**
 *
 *   ⇒ 改成文献的「点力 + 可滑移作用点」模型（Kuindersma 2013 用足底 4 角
 *     点力，本 rig 的鞋底是**单块刚性盒**，用 1 个滑移点更贴合）：
 *       变量：`f = (fx, fy, fz)` + CoP 偏移 `(dx, dz)`
 *       力作用在 `(x+dx, y, z+dz)`
 *       不等式：`|dx| ≤ 半长`、`|dz| ≤ 半宽`（就是 CoP 在支撑多边形内）
 *   ⇒ **产生力矩必须搬 CoP**，代价回来了。
 *
 * ── 变量 ──────────────────────────────────────────────────────────────
 *   每接触点 5 个 ⇒ 两只脚 10 个变量、6 行等式 ⇒ 冗余 4 维，
 *   正好用来做**载荷分配**（`footLoadFrac` 测的那个量，
 *   文献里叫 force distribution ratio）与 CoP 的横向摆放。
 *
 * ── 约束 ──────────────────────────────────────────────────────────────
 *   等式（6 行，硬）：牛顿-欧拉
 *   不等式：
 *     · `fy ≥ 0`                          单边（不能往下拉地面）
 *     · `fy ≤ fyMax`                      接触切换平滑（WBDC 的做法）
 *     · `|fh| ≤ μ·fy`                     摩擦锥
 *     · `|dx| ≤ halfX`、`|dz| ≤ halfZ`    CoP ∈ 支撑多边形
 *
 *   ★ 后两条都必须有 `f_y` 才有定义 ⇒ 这就是「把竖向补回来」的**直接收益**。
 *     此前竖向不进等式 ⇒ CoP 与摩擦锥在数学上是空的
 *     （`probe-qp` ⑥b 实测「竖向为 0 时摩擦锥恒判外」）。
 *
 * ── 求解 ──────────────────────────────────────────────────────────────
 *   10 个变量、6 个等式、单面不等式 ⇒ **投影法**：
 *     ① 等式：加权最小范数闭式解 `λ = W⁻¹Φᵀ(ΦW⁻¹Φᵀ)⁻¹ b`（6×6 高斯消元）
 *     ② 不等式就地投影（`fy` 截断、摩擦锥沿 `fy` 缩放、CoP 偏移夹紧）
 *     ③ 交替迭代
 *   ★ **未着地的接触直接从 Φ 里删列**，不做"事后置零"。
 *     第一版用事后置零，于是等式解每次又把载荷分给它、下一轮再置零
 *     ⇒ 两个不相容集合之间来回弹（POCS 的典型失效），
 *     实测单支撑时支撑脚只拿到 343 N（正好一半）。
 *     与其投影到「脚离地」这个集合（它与等式集**不交**），
 *     不如**一开始就不给这个自由度**。
 *
 * ── 与 `wholeBodyQp` 的关系（**不是替代，是上下游**）──────────────────
 *   本 QP 出 λ（含 `f_y` 与 CoP）。`τ` 仍由 `wholeBodyQp` 的 `τ = JᵀF`
 *   处理**水平**分量 —— 因为竖向不需要力矩（见上）。
 *   ⇒ 竖向这一路**不接 τ**，它回答「需要多大 `f_y`、CoP 该在哪」，
 *     然后由位置伺服的虚拟刚度 + 接触约束在物理上兑现。
 *   这是文献里位置控制型人形（无力矩传感器）的常规做法
 *   （Cisneros 2020；RVC 框架）。
 * ════════════════════════════════════════════════════════════════════════
 */

import { solveIc, type CentroidalState } from '../centroidal';

/** 每个接触点的变量数：`fx, fy, fz, dx, dz` */
const VARS_PER_CONTACT = 5;

/** 一个接触点（单块刚性鞋底 + 可滑移的压力中心） */
export interface Contact {
  /** 鞋底盒中心的世界位置（m）—— CoP 在这个盒内滑动 */
  x: number; y: number; z: number;
  /** 支撑多边形（世界系下的 x/z 区间），由 `footSoleBounds` 给出 */
  copX: [number, number];
  copZ: [number, number];
  /** 接触是否**已建立**（着地）。false ⇒ 该接触**不参与求解**（列被删掉） */
  active: boolean;
}

/** QP 的输入（全部是**量**，不含任何隐含的参考点约定） */
export interface GrfQpInput {
  contacts: Contact[];
  /** 质心状态（`centroidal()` 的输出） */
  cs: CentroidalState;
  /**
   * 期望的质心加速度（m/s²，世界系）。
   * ★ 由**上层控制律**给（例如 ξ → `a = −ω₀²·ξ`），这个 QP 不自己算。
   */
  aDesX: number; aDesY: number; aDesZ: number;
  /**
   * 期望的角动量率 `ḣ_c`（N·m/s，三维）。
   * ⚠ 若上层还没有角动量律，传 `null` ⇒ `α = 0`（不主动甩动身体，保守）。
   */
  alphaDes?: [number, number, number];
  /** 摩擦系数（F/T 摩擦锥）。默认 0.8 */
  mu?: number;
  /** 单点法向力上限（相对 `m·g` 的倍数）。默认 4（WBDC 用它做接触切换平滑） */
  fyMaxMul?: number;
  /** 迭代上限。默认 200（POCS 在这种小问题上收敛慢，宁可多跑） */
  iters?: number;
}

export interface GrfQpOutput {
  /**
   * 决策变量，长度 = `5 × 接触点数`（**含未着地的接触**，它们恒为 0）。
   * 布局：接触 k ⇒ `[fx, fy, fz, dx, dz] @ 5k`
   */
  lambda: Float64Array;
  /** ��否所有约束都满足 */
  feasible: boolean;
  /** 牛顿-欧拉等式残差：`[|线性|, |角动量|]`，单位 N 与 N·m/s */
  residual: [number, number];
  /** 逐条约束结果 */
  checks: {
    unilateral: boolean;   // fy ≥ 0
    friction: boolean;    // |fh| ≤ μ fy
    cop: boolean;         // CoP ∈ 支撑多边形
    equality: boolean;    // 牛顿-欧拉
  };
  /** 合成地面反力（三维，N）—— 竖向分量就是"撑起多少体重" */
  fTotal: [number, number, number];
  /** 合成 ZMP（世界系 x/z，m）。`f_y ≈ 0` 时为 NaN —— 必须报出来，不能静默给 0 */
  zmp: [number, number];
  /** 参与求解的接触点数（= `lambda` 里非零块数） */
  nActive: number;
  iters: number;
}

/** `(−g)` 在 y 上是 `+g`；`Σf = m(a_des − g)` ⇒ `b_y = m(a_des_y + g)` */
const G = 9.81;

export function solveGrfQp(inp: GrfQpInput): GrfQpOutput {
  const all = inp.contacts;
  const mu = inp.mu ?? 0.8;
  const iters = inp.iters ?? 200;
  const nc = all.length;
  const nAll = nc * VARS_PER_CONTACT;
  const lambda = new Float64Array(nAll);

  if (nc === 0) {
    return {
      lambda, feasible: false, residual: [0, 0],
      checks: { unilateral: false, friction: false, cop: false, equality: false },
      fTotal: [0, 0, 0], zmp: [NaN, NaN], nActive: 0, iters: 0,
    };
  }

  // ── 只保留**已着地**的接触：未着地的列直接不存在（不是事后置零，见文件头）
  const act: number[] = [];
  for (let k = 0; k < nc; k++) if (all[k]!.active) act.push(k);
  const na = act.length;
  if (na === 0) {
    return {
      lambda, feasible: false, residual: [0, 0],
      checks: { unilateral: true, friction: true, cop: false, equality: false },
      fTotal: [0, 0, 0], zmp: [NaN, NaN], nActive: 0, iters: 0,
    };
  }

  // ── 右端项 b（6 行）：牛顿-欧拉
  //   `Σ f_i = m(a_des − g)` ⇒ b_lin = m·a_des + m·g·ŷ
  //   **竖向权重就在这里**：静态 a_des_y = 0 ⇒ b_y = m·g。
  //   这就是「竖向哪来的」的答案 —— 它来自这一行，不是任何力矩。
  const cs = inp.cs;
  const m = Math.max(1e-6, cs.m);
  const bLin = [m * inp.aDesX, m * (inp.aDesY + G), m * inp.aDesZ];
  // `Σ (p_i − c) × f_i = I_c·α_des`（不主动甩身体 ⇒ α 默认 0）
  const alpha = inp.alphaDes ?? [0, 0, 0];
  const bAng = [
    cs.Ic[0]! * alpha[0] + cs.Ic[1]! * alpha[1] + cs.Ic[2]! * alpha[2],
    cs.Ic[3]! * alpha[0] + cs.Ic[4]! * alpha[1] + cs.Ic[5]! * alpha[2],
    cs.Ic[6]! * alpha[0] + cs.Ic[7]! * alpha[1] + cs.Ic[8]! * alpha[2],
  ];

  return solveLinear(inp, all, act, m, bLin, bAng, mu, iters, lambda, nAll);
}

/** 线性版本：每接触点 5 变量 = `f`(3) + CoP 力矩 `(Mzx, Mzz)`（各 ≤ f_y·半长） */
function solveLinear(
  inp: GrfQpInput,
  all: Contact[],
  act: number[],
  m: number,
  bLin: number[],
  bAng: number[],
  mu: number,
  iters: number,
  lambda: Float64Array,
  nAll: number,
): GrfQpOutput {
  void nAll;
  const na = act.length;
  const n = na * 5;
  const cs = inp.cs;

  // Φ（6 × n）。行：0..2 = f 的三个分量；3..5 = 力矩三个分量
  // 列（每接触 5）：fx, fy, fz, Mzx, Mzz
  //   M = (rx0, ry, rz0) × f  +  (0, Mzz, 0)×?  ——
  //   法向力 f_y 在足底内偏移 (dx, dz) 产生的附加力矩是 (−dz·f_y, ?, dx·f_y)，
  //   注意它**乘上 f_y**，仍是双线性。
  //   ⇒ 真正线性的写法：把 `Mzx, Mzz` 定义为**已经乘过 f_y 的**力矩
  //     （单位就是 N·m），而约束写成 `|Mzx| ≤ f_y·halfX` —— 这是**双线性**的
  //     不等式，但可以用**保守的线性替代**：`f_y ≥ |Mzx|/halfX`，
  //     在投影步里按 `Mzx` 夹紧并相应抬 `f_y`，仍是收敛的 POCS。
  //   —— 这是本项目唯一允许的近似，且必须在这里标出来。
  const Phi = new Float64Array(6 * n);
  for (let a = 0; a < na; a++) {
    const C = all[act[a]!]!;
    const rx = C.x - cs.cx, ry = C.y - cs.cy, rz = C.z - cs.cz;
    const o = a * 5;
    Phi[0 * n + o + 0] = 1; Phi[1 * n + o + 1] = 1; Phi[2 * n + o + 2] = 1;
    // (r × f)_x = ry·f_z − rz·f_y
    Phi[3 * n + o + 1] = -rz; Phi[3 * n + o + 2] = ry;
    // (r × f)_y = rz·f_x − rx·f_z  ← CoP 的 x 偏移就通过 `Mzy` 表达
    Phi[4 * n + o + 0] = rz;  Phi[4 * n + o + 2] = -rx;
    // (r × f)_z = rx·f_y − ry·f_x  ← CoP 的 z 偏移就通过 `Mzx` 表达
    Phi[5 * n + o + 1] = rx;  Phi[5 * n + o + 0] = -ry;
    // CoP 力矩列：直接进对应的两行
    Phi[3 * n + o + 3] = 1;   // Mzx ⇒ 力矩 x（z 方向偏移）
    Phi[5 * n + o + 4] = 1;   // Mzz ⇒ 力矩 z（x 方向偏移）
  }

  // ── 权重：目标是 `min λᵀ W λ`，闭式解用 `Φ W⁻¹ Φᵀ` ⇒ 这里填 **W⁻¹**。
  //
  // ⚠⚠ 第一版把 `W⁻¹` 写成 `1/100` / `1/700`，等于给水平项成本 100、
  //   竖向项成本 700。后果：**竖向被重罚 7 倍** ⇒ 最小范数解绕开 `f_y`
  //   把载荷分给别的列，紧接着不等式投影又把它掰回来 ⇒ 两个不相容集合
  //   之间弹跳，实测「两脚载荷 343 / 0」（应该各半）、「单支撑 0 N」。
  //   ⇒ `W⁻¹` 必须按**参考量级的平方**给，这样"按各自满量程用"的代价才相等。
  const iw = new Float64Array(n);
  const SC_H = 100;    // 水平力参考量级（N）
  const SC_V = 700;    // 法向力参考量级（N）= 体重量级
  const SC_T = 100;    // 力矩参考量级（N·m）
  for (let a = 0; a < na; a++) {
    const o = a * 5;
    iw[o + 0] = SC_H * SC_H; iw[o + 1] = SC_V * SC_V; iw[o + 2] = SC_H * SC_H;
    iw[o + 3] = SC_T * SC_T; iw[o + 4] = SC_T * SC_T;
  }

  const fyMax = (inp.fyMaxMul ?? 4) * m * G;
  let it = 0;
  for (; it < iters; it++) {
// ① 等式最小范数解
    //
    // ⚠⚠ **Tikhonov 正则**（2026-10-06 修，见 `solveSym6` 的注释）：
    //   单支撑时只有 1 个接触 ⇒ 5 个变量 vs **6 行方程** ⇒ `ΦW⁻¹Φᵀ` **奇异**。
    //   而单支撑**物理上可行**（CoM 在 CoP 正上方时方程组是**相容**的，
    //   只是 Φ 秩亏）⇒ 不能因为奇异就放弃。
    //   原来 `solveSym6` 遇奇异直接 `return null` ⇒ 主循环 `break`
    //   ⇒ 单支撑时 λ 恒为全 0 ⇒ 「支撑脚只拿到 0 N」。
    const N = new Float64Array(36);
    for (let r = 0; r < 6; r++) {
      for (let c = r; c < 6; c++) {
        let acc = 0;
        for (let j = 0; j < n; j++) acc += Phi[r * n + j]! * iw[j]! * Phi[c * n + j]!;
        N[r * 6 + c] = acc; N[c * 6 + r] = acc;
      }
    }
    // 正则量取**迹的相对值**（量纲一致，否则 `W⁻¹` 用了平方量级后绝对阈值无意义）
    const tr = N[0]! + N[7]! + N[14]! + N[21]! + N[28]! + N[35]!;
    const eps = 1e-10 * Math.max(1, Math.abs(tr));
    for (let d = 0; d < 6; d++) N[d * 6 + d]! += eps;   // 类型断言：Float64Array 可写
    const y = solveSym6(N, bLin.concat(bAng));
    if (!y) break;
    const sol = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let acc = 0;
      for (let r = 0; r < 6; r++) acc += Phi[r * n + j]! * y[r]!;
      sol[j] = iw[j]! * acc;
    }
    // ② 不等式投影
    for (let a = 0; a < na; a++) {
      const C = all[act[a]!]!;
      const o = a * 5;
      const halfX = Math.max(1e-4, (C.copX[1] - C.copX[0]) / 2);
      const halfZ = Math.max(1e-4, (C.copZ[1] - C.copZ[0]) / 2);
      if (sol[o + 1]! < 0) sol[o + 1] = 0;
      if (sol[o + 1]! > fyMax) sol[o + 1] = fyMax;
      const fy = sol[o + 1]!;
      // CoP 约束：`|Mzx| ≤ f_y·halfZ`、`|Mzz| ≤ f_y·halfX`
      //   （x 方向的 CoP 偏移产生**绕 z** 的力矩，故配 halfX）
      const capZ = fy * halfZ, capX = fy * halfX;
      if (Math.abs(sol[o + 3]!) > capZ) sol[o + 3] = Math.sign(sol[o + 3]!) * capZ;
      if (Math.abs(sol[o + 4]!) > capX) sol[o + 4] = Math.sign(sol[o + 4]!) * capX;
      // 摩擦锥
      const fh = Math.hypot(sol[o + 0]!, sol[o + 2]!);
      const cap = mu * fy;
      if (fh > cap) {
        if (cap <= 1e-9) { sol[o + 0] = 0; sol[o + 2] = 0; }
        else { const s = cap / fh; sol[o + 0] = sol[o + 0]! * s; sol[o + 2] = sol[o + 2]! * s; }
      }
    }
    // ③ 收敛判据：与上一轮的**相对**改变量比较
    //   ⚠ 原来没有判据 ⇒ 每次都跑满 200 轮，`iters` 是个永远等于上限的
    //   死读数（探针里看不出来，但它让「收敛了吗」这个问题无法回答）。
    //   尺度用各自列的参考量级，否则 `f_x`（~50）与 `Mzx`（~30）没法比。
    let rel = 0;
    for (let j = 0; j < n; j++) {
      const scale = Math.sqrt(iw[j]!);
      rel = Math.max(rel, Math.abs(sol[j]! - lambda[act[Math.floor(j / 5)!]! * 5 + (j % 5)]!) / scale);
    }
    for (let j = 0; j < n; j++) lambda[act[Math.floor(j / 5)!]! * 5 + (j % 5)] = sol[j]!;
    if (rel < 1e-9) { it++; break; }
  }

  // ── 残差 + 逐条判定
  const actv = new Float64Array(6);
  for (let r = 0; r < 6; r++) {
    let acc = 0;
    for (let j = 0; j < n; j++) acc += Phi[r * n + j]! * lambda[act[Math.floor(j / 5)!]! * 5 + (j % 5)]!;
    actv[r] = acc;
  }
  const resLin = Math.hypot(actv[0]! - bLin[0]!, actv[1]! - bLin[1]!, actv[2]! - bLin[2]!);
  const resAng = Math.hypot(actv[3]! - bAng[0]!, actv[4]! - bAng[1]!, actv[5]! - bAng[2]!);
  const tolLin = 1e-2 * m * G;
  const tolAng = 1e-2 * Math.max(1, Math.hypot(bAng[0]!, bAng[1]!, bAng[2]!));
  const equalityOk = resLin <= tolLin && resAng <= tolAng;

  let unilateralOk = true, frictionOk = true, copOk = true;
  let fxT = 0, fyT = 0, fzT = 0, zmpW = 0, zmpX = 0, zmpZ = 0;
  for (let k = 0; k < all.length; k++) {
    if (!all[k]!.active) continue;
    const o = k * 5;
    const fx = lambda[o]!, fy = lambda[o + 1]!, fz = lambda[o + 2]!;
    const Mzx = lambda[o + 3]!, Mzz = lambda[o + 4]!;
    fxT += fx; fyT += fy; fzT += fz;
    if (fy < -1e-6) unilateralOk = false;
    if (Math.hypot(fx, fz) > mu * fy + 1e-3) frictionOk = false;
    const halfX = (all[k]!.copX[1] - all[k]!.copX[0]) / 2;
    const halfZ = (all[k]!.copZ[1] - all[k]!.copZ[0]) / 2;
    if (Math.abs(Mzz) > fy * halfX + 1e-3) copOk = false;
    if (Math.abs(Mzx) > fy * halfZ + 1e-3) copOk = false;
    // CoP：x 方向偏移 = Mzz / f_y；z 方向偏移 = −Mzx / f_y
    //
    // ⚠⚠ 加权平均必须**乘上 f_y**（2026-10-06 修，`probe-grf` B 段抓到）：
    //   原来写成 `zmpX += x + Mzz/fy` 然后 `zmpX /= Σf_y` ——
    //   那是 `(Σ zmp_k) / (Σ f_y)`，**漏了权重** ⇒ 结果被缩小了约 `f_y` 倍。
    //   实测：两脚各 `Mzz = −33.25`、`f_y = 343`（正确的 ZMP_x = −96.8mm），
    //   报出来却是 −0.0003 m ⇒ 「水平力没有物理代价」的假象。
    //   ⇒ 这条假象**掩盖了本文件最核心的那条因果**，差点让我以为
    //     CoP 约束没接上（它其实一直在工作，见 a_des_x=4 那行）。
    if (fy > 1e-6) {
      const zx = all[k]!.x + Mzz / fy;
      const zz = all[k]!.z - Mzx / fy;
      zmpW += fy;
      zmpX += fy * zx;
      zmpZ += fy * zz;
    }
  }
  const zmp: [number, number] = zmpW > 1e-9 ? [zmpX / zmpW, zmpZ / zmpW] : [NaN, NaN];

  return {
    lambda, feasible: equalityOk && unilateralOk && frictionOk && copOk,
    residual: [resLin, resAng],
    checks: { unilateral: unilateralOk, friction: frictionOk, cop: copOk, equality: equalityOk },
    fTotal: [fxT, fyT, fzT], zmp, nActive: na, iters: it,
  };
}

/**
 * 6×6 线性方程组的部分主元高斯消元。
 *
 * ⚠ `N` 应当**已经加上 Tikhonov 正则**（见调用处）。加正则之后这里几乎不会
 *   真的奇异，但为了不让一个 0/0 悄悄污染输出，仍保留 `null` 分支。
 *   ⇒ 「相容但秩亏」（单支撑）走正则化精确解；「真正不相容」（力臂退化）
 *     给出最小二乘近似，并由 `residual` + `checks.equality` **如实报出** ——
 *     这两件事必须分开，否则调用方无法区分「没做到」与「做不到」。
 */
function solveSym6(N: Float64Array, b: number[]): number[] | null {
  const A = new Float64Array(36);
  A.set(N);
  const x = new Float64Array(6);
  for (let i = 0; i < 6; i++) x[i] = b[i]!;
  for (let c = 0; c < 6; c++) {
    let piv = c, best = Math.abs(A[c * 6 + c]!);
    for (let r = c + 1; r < 6; r++) {
      const v = Math.abs(A[r * 6 + c]!);
      if (v > best) { best = v; piv = r; }
    }
    if (best < 1e-300) return null;
    if (piv !== c) {
      for (let c3 = 0; c3 < 6; c3++) {
        const t = A[c * 6 + c3]!; A[c * 6 + c3] = A[piv * 6 + c3]!; A[piv * 6 + c3] = t;
      }
      const t = x[c]!; x[c] = x[piv]!; x[piv] = t;
    }
    const d = A[c * 6 + c]!;
    for (let r = c + 1; r < 6; r++) {
      const f = A[r * 6 + c]! / d;
      if (f === 0) continue;
      for (let c3 = c; c3 < 6; c3++) A[r * 6 + c3]! -= f * A[c * 6 + c3]!;
      x[r]! -= f * x[c]!;
    }
  }
  for (let r = 5; r >= 0; r--) {
    let acc = x[r]!;
    for (let c = r + 1; c < 6; c++) acc -= A[r * 6 + c]! * x[c]!;
    const d = A[r * 6 + r]!;
    if (Math.abs(d) < 1e-300) return null;
    x[r] = acc / d;
  }
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    if (!Number.isFinite(x[i]!)) return null;
    out.push(x[i]!);
  }
  return out;
}

/** 供上层复用：给定 λ 算合成 ZMP 的**灵敏度** —— `∂ZMP/∂F`（诊断 CoP 权限用） */
export function zmpFromLambda(
  contact: Contact, fy: number, Mzz: number, Mzx: number,
): [number, number] {
  if (fy <= 1e-9) return [NaN, NaN];
  return [contact.x + Mzz / fy, contact.z - Mzx / fy];
}

void solveIc;
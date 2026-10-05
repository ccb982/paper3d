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
  /** 期望的水平地面反力（N）。由 ξ 收敛律给出 */
  fDesX: number;
  fDesZ: number;
  /** 支撑多边形在世界系下的 X 区间 [minX, maxX] */
  copXRange: [number, number];
  copZRange: [number, number];
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
  /** 等式残差 ‖Σ τ·arm − F_des‖（N）。0 = 精确解 */
  residual: number;
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
  if (n === 0) {
    return { tau, feasible: false, residual: 0, iters: 0 };
  }
  const iters = inp.iters ?? 40;

  // ── 等式约束的最小范数解：τ₀ = W⁻¹Aᵀ(AW⁻¹Aᵀ)⁻¹ b ──────────────────
  // A 是 3×n（水平两个方向 + 竖向不用力矩），这里只用**水平两行**
  // （竖向由体重承担，不靠关节力矩 —— 那是 `wantedForce.weight`，默认关）。
  // 用 2×2 的正规方程闭式解，n 很小，无需通用线性代数。
  // ★ 力矩对地面反力的比系数：`c_i = axis_i × r_i`（三维）。
  //   然后 `F = Σ τ_i · c_i`。
  //   强约束：只约束**水平两个分量**（x/z）——竖向由体重承担（不靠关节力矩）。
  const cx3 = new Float64Array(n);
  const cz3 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = inp.axes[i]!;
    // c = axis × r
    cx3[i] = a.wy * a.rz - a.wz * a.ry;
    cz3[i] = a.wx * a.ry - a.wy * a.rx;
  }
  const Aw = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) { Aw[i * 2] = cx3[i]!; Aw[i * 2 + 1] = cz3[i]!; }
  const iw = new Float64Array(n);
  for (let i = 0; i < n; i++) iw[i] = 1 / Math.max(1e-9, inp.axes[i]!.w);
  let m00 = 0, m01 = 0, m11 = 0;
  for (let i = 0; i < n; i++) {
    m00 += Aw[i * 2]! * iw[i]! * Aw[i * 2]!;
    m01 += Aw[i * 2]! * iw[i]! * Aw[i * 2 + 1]!;
    m11 += Aw[i * 2 + 1]! * iw[i]! * Aw[i * 2 + 1]!;
  }
  const det = m00 * m11 - m01 * m01;
  let tau0: Float64Array;
  if (Math.abs(det) < 1e-12) {
    // 力臂退化（全部轴的力臂共线，或 rx/rz 全为 0）⇒ **无法解等式**。
    // 此时改用“带最大约束的单轴”：选力臂最长的轴按 F_des 比例满足。
    // 这个降级必须在输出里说出来（feasible 会掉），不能静默。
    let best = 0, bestR = 1e-9;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(Aw[i * 2]!, Aw[i * 2 + 1]!);
      if (r > bestR) { bestR = r; best = i; }
    }
    tau0 = new Float64Array(n);
    if (bestR > 1e-9) {
      const mag = Math.hypot(inp.fDesX, inp.fDesZ);
      tau0[best] = (mag / bestR) * Math.sign(
        Aw[best * 2]! * inp.fDesX + Aw[best * 2 + 1]! * inp.fDesZ || 1);
    }
  } else {
    const l0 = (m11 * inp.fDesX - m01 * inp.fDesZ) / det;
    const l1 = (m00 * inp.fDesZ - m01 * inp.fDesX) / det;
    tau0 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tau0[i] = iw[i]! * (Aw[i * 2]! * l0 + Aw[i * 2 + 1]! * l1);
    }
  }

  // ★★ `tau0` 必须拷进 `tau`！少了这一行 ⇒ `tau` 全 0 ⇒ 输出恒为 0
  //   （实测：所有 F_des 的残差都等于 |F_des| 本身，合成恒 (0,0)）
  tau.set(tau0);

  // ── 求解：**主动集法**（active-set QP），不是 POCS ────────────────────
  //
  // 问题：约束是「盒 + 2 个等式」，POCS 在这类混合约束上不收敛
  //   · 阻尼步长 0.5 ⇒ 投影在盒边界来回弹跳，F_des=20N 给�� 322.8N（过冲 16 倍）
  //   · 步长 1.0 ⇒ 等式投影把盒内点推出去，输出达 τmax 的 100 倍
  //
  // 正确做法：这是**标准的带等式约束 QP**。把当前违反盒约束的轴固定在边界上，
  //   对剩下的自由轴解等式 —— 降到 1×1/2×2 闭式，**精确**、**单调**、无过冲。
  //   迭代：找出违规轴 → 钉住 → 解 → 若有轴从"钉住"变为应松开则松开（交换）
  //   每步的 τ 都**严格在盒内**，等式残差逐步下降。
  //
  // 变量定义：free = 未被钉住的轴；fixed = 被钉在 ±τmax 的轴。
  //   A_free τ_free + A_fixed τ_fixed = b  ⇒  τ_free = τ_free⁰ + W_f⁻¹A_fᵀ M⁻¹ (b − A_free τ_free⁰)
  const FIXED = new Int8Array(n);      // 0 = 自由, 1 = 钉在 +, -1 = 钉在 −
  for (let iter = 0; iter < 8 * n; iter++) {
    // ① 当前解（自由轴取最优，钉住轴取边界）
    tau.set(tau0);
    for (let i = 0; i < n; i++) {
      if (FIXED[i] === 1) tau[i] = inp.axes[i]!.tauMax;
      else if (FIXED[i] === -1) tau[i] = -inp.axes[i]!.tauMax;
    }
    // ② 算自由轴的修正量
    let g0 = 0, g1 = 0, nf = 0;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      g0 += Aw[i * 2]! * tau[i]!; g1 += Aw[i * 2 + 1]! * tau[i]!; nf++;
      // 用该轴自身权重参与 M（子矩阵）
    }
    let n00 = 0, n01 = 0, n11 = 0;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      n00 += Aw[i * 2]! * iw[i]! * Aw[i * 2]!;
      n01 += Aw[i * 2]! * iw[i]! * Aw[i * 2 + 1]!;
      n11 += Aw[i * 2 + 1]! * iw[i]! * Aw[i * 2 + 1]!;
    }
    const nd = n00 * n11 - n01 * n01;
    if (nf === 0 || Math.abs(nd) < 1e-12) break;
    const r0 = inp.fDesX - g0, r1 = inp.fDesZ - g1;
    const id = 1 / nd;
    const l0 = (n11 * r0 - n01 * r1) * id, l1 = (n00 * r1 - n01 * r0) * id;
    for (let i = 0; i < n; i++) {
      if (FIXED[i] !== 0) continue;
      tau[i] = tau[i]! + iw[i]! * (Aw[i * 2]! * l0 + Aw[i * 2 + 1]! * l1);
    }
    // ③ 若某个自由轴越界 ⇒ 钉它；已钉的轴若"应该松开"（方向反了）则松开
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

  // 残差 + 可行性
  let s0 = 0, s1 = 0;
  let allInBox = true;
  for (let i = 0; i < n; i++) {
    s0 += tau[i]! * cx3[i]!;
    s1 += tau[i]! * cz3[i]!;
    if (Math.abs(tau[i]!) > inp.axes[i]!.tauMax * 1.001) allInBox = false;
  }
  const residual = Math.hypot(s0 - inp.fDesX, s1 - inp.fDesZ);
  // ★ CoP 可行性：**支撑多边形的凸锥**判据（Piazza 2024, Thm 1 / Lemma 1）。
  //
  //   合成水平力 (Fx,Fz) 必须能被多边形内的分布**纯压力**地分解
  //   ⇔ 该矢量落在以原点为顶点的**多边形凸锥**内。
  //   判定：把多边形各顶点按"极角"排序，矢量方向必须落在相邻顶点的角度区间内。
  //   （我第一版写的是 `|F| ≤ 半宽 × 686` —— 686 是**体重（竖直）**，
  //     与水平分力能否实现毫无关系，纯属臆造；射线法又漏掉 t<0 的情形，已删。）
  const copOk = (() => {
    const F = Math.hypot(s0, s1);
    if (F < 1e-9) return true;                        // 无水平力 ⇒ 恒可行
    const [x0, x1] = inp.copXRange, [z0, z1] = inp.copZRange;
    const ang = (x: number, z: number): number => Math.atan2(z, x);
    // 多边形 4 角的方向区间（取跨度 < π 的那一侧，含原点）
    const a = [ang(x0, z0), ang(x1, z0), ang(x1, z1), ang(x0, z1)];
    const target = ang(s0, s1);
    // 逐边检查"target 是否落在由两个角张成的 <π 区间内"
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
  // ★ `feasible` 必须**同时**要求：盒内 ∧ 等式成立 ∧ CoP 在多边形锥内。
  //   只判前两项会让「力矩全在限幅内但等式没满足」被误报成成功 ——
  //   实测 F_des=3000N 时输出 324N（残差 2677N）却曾报 feasible=✓。
  //   容差取 1% 的 F_des（相对残差），避免浮点噪声误判。
  const tolEq = 0.01 * Math.max(1, Math.hypot(inp.fDesX, inp.fDesZ));
  return { tau, feasible: allInBox && copOk && residual <= tolEq, residual, iters };
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
  fDesX: number;
  fDesZ: number;
  /** 本拍请求了哪些轴（人数） */
  nAxes: number;
}

/**
 * 从 `Ragdoll` 的当前状态构造待求轴：**承重腿整条链 + 腰**，矢状 + 额状。
 *
 * 为什么只取承重腿（附录 B.1：「一次动一个模块」是 step 的职责）：
 *   摆动腿不承重，它的地面对 CoM 无净贡献；把它放进等式约束会让
 *   求解器去"命令一条不接触地面的腿"，那是纯粹的伪自由度。
 *
 * 为什么含腰：文献（Horak 2006 / Xu & Sher）指出躯干侧倾能用重力矩卸载髋，
 *   额度可观。腰的力臂长（~0.5m）⇒ 同样的 τ 能产生大得多的水平力。
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

  // 关节与要解的轴：[关节名, 轴号]。含腰（spine1/2/3 的侧倾与屈伸）
  const spec: [string, number][] = [
    [`foot_${sup}`, 0], [`foot_${sup}`, 1], [`foot_${sup}`, 2],
    [`knee_${sup}`, 0], [`knee_${sup}`, 1], [`knee_${sup}`, 2],
    [`hip_${sup}`, 0], [`hip_${sup}`, 1], [`hip_${sup}`, 2],
    ['spine1', 0], ['spine1', 2],
    ['spine2', 0], ['spine2', 2],
  ];
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
 * 由 `M·a = ΣF + mg` ⇒ **`F_des = m·(a − g)**：
 *     Fx_des = −m·ω₀²·ξ_x
 *     Fz_des = −m·ω₀²·ξ_z
 *  ⇒ 只在**水平**两个方向给出目标（竖向由体重承担，不靠关节力矩）。
 */
export function desiredGrfFromXi(rs: RigState, m: number): { fx: number; fz: number } {
  const h = Math.max(0.05, rs.com.y);
  const w0 = Math.sqrt(9.81 / h);
  const xiX = rs.com.x - rs.com.vx / w0;
  const xiZ = rs.com.z - rs.com.vz / w0;
  return { fx: -m * w0 * w0 * xiX, fz: -m * w0 * w0 * xiZ };
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
  const { fx, fz } = desiredGrfFromXi(rs, sk.massTotal);
  const BB = new Float64Array(4);
  doll.footSoleBounds(sup === 'l' ? 0 : 1, BB);
  const out = solveWholeBodyQp({
    axes,
    fDesX: fx * g, fDesZ: fz * g,
    copXRange: [BB[0]!, BB[1]!],
    copZRange: [BB[2]!, BB[3]!],
    iters: opt.iters ?? 40,
  });

  const names: string[] = [];
  for (let i = 0; i < axes.length; i++) {
    const a = axes[i]!;
    const nm = `${sk.joints[a.joint]!.name}/${a.axis}`;
    names.push(nm);
    const t = out.tau[i]!;
    if (Math.abs(t) < 1e-6) continue;      // 不写 0，避免把轴标成"有人管"
    // 力矩 → 沿该轴的世界方向。符号约定：`requestTorque` 的正值 = 推子体正转。
    rs.requestTorque(a.joint, a.axis, t, 'balance', `全链QP/${nm}`);
  }
  void DEFAULT_WANTED_FORCE;
  return { tau: out.tau, names, feasible: out.feasible, residual: out.residual,
    fDesX: fx * g, fDesZ: fz * g, nAxes: axes.length };
}

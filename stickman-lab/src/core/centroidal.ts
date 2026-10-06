/**
 * ════════════════════════════════════════════════════════════════════════
 * centroidal.ts —— **质心动量**（centroidal momentum）
 *
 * ════════════════════════════════════════════════════════════════════════
 * 为什么要有这个文件（2026-10-06，用户「查论文，看看到底应该怎么做」）：
 *
 *   本项目此前把整件事建在 `τ = JᵀF` 上（`balance.ts` 称其为「唯一的分配规则」）。
 *   那条规则能算**水平**力矩，但**算不出竖向**：
 *
 *       F = Σ τᵢ·(axisᵢ × rᵢ)
 *       竖向分量 = Σ τᵢ·(w_z·r_x − w_x·r_z)
 *
 *   而这两个偏移在承重腿上恰恰最小（踝离地 5cm，髋/膝都在支撑中心正上方
 *   几厘米）。实测（`probe-qp` ⑥）：**所有轴顶满 τmax，竖向上限只有 24.1 N**，
 *   而体重 686.7 N ⇒ 竖向权限 = 体重的 **3.5%**。
 *
 *   ★ 但这个数**不是**"机制缺失"，而是**问错了问题**。
 *     查文献（Kuindersma 2013 / Herzog 2013,2016 / WBDC 2018 / Cisneros 2020）
 *     的结论是一致的：
 *
 *       ① 浮动基座系统的**基座那 6 行**里 B = 0（基座不受驱动力矩），
 *          所以它给出的是**牛顿-欧拉方程**，而不是力矩方程：
 *              Σ f_i            = m·(a_CoM − g)          ← 线性动量
 *              Σ (p_i − c) × f_i = I_c·α + ḣ_c          ← 绕 CoM 角动量
 *          **竖向力在第一行的 `m·(−g) = m·g` 里，是约束的结果，不是决策。**
 *
 *       ② 关节力矩**不需要**产生竖向力。竖向由**地面法向力**平衡，
 *          而地面法向力是**接触约束**（单边 `f_y ≥ 0` + 摩擦锥）给的。
 *          腿是纯 revolute 关节照样站得住，靠的就是这个 + 关节的虚拟刚度
 *          （Virtual Model Control / Pratt 1995；本项目的 `hipStiff`、VIP 踝
 *          就是它）。
 *
 *       ③ 所以 QP 的**决策变量是接触力 λ**（含 `f_y`），不是 τ。
 *          τ 在之后由**驱动行**定死：`τ = H_a·q̈ + C_a − Φᵀ_a·λ`。
 *          ⇒ **唯一性来自方程本身，不需要最小范数正则。**
 *
 *   ⇒ 这个文件提供第 ① 步需要的那一半输入：`m`、`c`、`v_c`、`I_c`、`ḣ_c`。
 *     另一半（`q̈_des` 与任务）由上层给。
 *
 * ── 坐标系（沿用全项目唯一口径，见 `wantedForce.ts:22-24`）──────────────
 *      **x = 矢状（+x 朝前）　y = 竖直（+y 朝上）　z = 额状（+z 朝左）**
 *
 * ── 角动量的定义（必须写死，否则同一符号在不同文献里含义相反）──────────
 *      质心角动量 `h_c = Σᵢ [ I_i·ω_i + m_i·r_i × v_i ]`
 *        · `I_i`  = 刚体 i 绕**自身质心**的惯量，取到**世界系**
 *        · `r_i`  = 刚体 i 质心 − 全局质心 `c`
 *        · `v_i`  = 刚体 i 质心速度
 *      `ḣ_c` 用**中心差分**在窗口上求（窗口 `H_MOM_WIN`），
 *      而不是逐帧差分 —— 后者把接触冲击读成几千 N·m/s（同一个坑：
 *      `jointForce` 的 `VEL_WIN`，见 `ragdoll.ts` 里 `primeVelocities` 的注释）。
 * ════════════════════════════════════════════════════════════════════════
 */

import type { Ragdoll } from './ragdoll';

/** 质心动量的一帧读数（世界系） */
export interface CentroidalState {
  /** 总质量（kg） */
  m: number;
  /** 质心位置 `c`（m） */
  cx: number; cy: number; cz: number;
  /** 质心速度（m/s）—— 由 `m·v_c = Σ mᵢ·v_i` 得到，不是对 `c` 差分 */
  vx: number; vy: number; vz: number;
  /**
   * 质心加速度（m/s²）。
   * ⚠ 由 `m·a_c = Σ mᵢ·a_i = Σ (f_i − mᵢ·g)` 形式的**动量差分**得到，
   *   不是对 `c` 做二阶差分 —— 后者把接触噪声放大两个数量级。
   */
  ax: number; ay: number; az: number;
  /**
   * 质心惯量张量 `I_c`（kg·m²，**世界系**，对称 3×3，行主序 9 元）
   *   `I_c = Σᵢ [ R_i·diag(I_i)·Rᵢᵀ + mᵢ·(|r_i|²·E − r_i r_iᵀ) ]`
   */
  Ic: Float64Array;
  /** 质心角动量 `h_c`（kg·m²/s，三维） */
  hx: number; hy: number; hz: number;
  /** `ḣ_c`（kg·m²/s²，三维，中心差分） */
  dhx: number; dhy: number; dhz: number;
  /** `ḣ_c` 的有限差分窗口是否已填满（false 时 `ḣ_c` 不可信） */
  dhReady: boolean;
  /**
   * ── 以下四个是**内部环形缓冲**，不是物理量。放在接口里是为了让
   *   `centroidal()` 能原地复用同一个对象（每帧新分配 120Hz 会抖 GC）。
   *   调用方**不要读**它们；语义见实现处的注释。
   */
  _hHist: Float64Array;
  _pHist: Float64Array;
  _filled: number;
  _ptr: number;
}

/**
 * `ḣ_c` 的中心差分窗口（帧）。5 帧 ≈ 42 ms @120Hz —— 与 `jointForce` 的 `VEL_WIN` 同量级
 */
const H_MOM_WIN = 5;

/** 新建一个空的质心读数（第一次调用 `centroidal()` 时用） */
export function newCentroidalState(): CentroidalState {
  return {
    m: 0, cx: 0, cy: 0, cz: 0, vx: 0, vy: 0, vz: 0,
    ax: 0, ay: 0, az: 0,
    Ic: new Float64Array(9),
    hx: 0, hy: 0, hz: 0, dhx: 0, dhy: 0, dhz: 0, dhReady: false,
    _hHist: new Float64Array(H_MOM_WIN * 3),
    _pHist: new Float64Array(H_MOM_WIN * 3),
    _filled: 0, _ptr: 0,
  };
}

/** 四元数旋一个向量（写进 `out`），不分配 */
function rotVec(
  qx: number, qy: number, qz: number, qw: number,
  vx: number, vy: number, vz: number, out: Float64Array,
): void {
  // t = 2 * (q_vec × v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

/**
 * 一拍的质心状态。**纯读**（不改 `doll` 的任何状态）。
 *
 * @param prev 上一拍的读数；传同一个对象即可（内部原地更新环形缓冲）。
 *             第一次调用传 `undefined` ⇒ `dhReady=false`。
 */
export function centroidal(doll: Ragdoll, prev?: CentroidalState): CentroidalState {
  const s: CentroidalState = prev ?? newCentroidalState();

  // ── ① 总质量与质心（Rapier 的 `mass()` 读回值与 `sk.bodies[i].mass` 逐体一致，
  //     这里用 Rapier 的，因为它才是求解器真正用的那个）
  let m = 0, mx = 0, my = 0, mz = 0;
  const n = doll.bodies.length;
  for (let i = 0; i < n; i++) {
    const b = doll.bodies[i]!;
    const mi = b.mass();
    const c = b.worldCom();          // ★ 世界系质心（不是 body.translation()）
    m += mi; mx += mi * c.x; my += mi * c.y; mz += mi * c.z;
  }
  const inv = m > 1e-9 ? 1 / m : 0;
  const cx = mx * inv, cy = my * inv, cz = mz * inv;

  // ── ② 动量 `p = Σ mᵢ·v_i` 与角动量 `h_c = Σ [ I_i ω_i + m_i r_i × v_i ]`
  //
  //  `I_i` 取到世界系：`I_w = R·diag(Ix,Iy,Iz)·Rᵀ`（R = 刚体姿态）。
  //  `principalInertiaLocalFrame()` 给的是**主惯量坐标系相对刚体局部系**的旋转，
  //  所以刚体自身的世界旋转是 `q_body ⊗ q_principal`。
  //
  //  ⚠ 这里必须用**世界系**的 `I_w` 去乘 `ω`（世界系角速度）。
  //    用局部系 `I` 配局部系 `ω` 再旋转是等价的，但前提是**同一个系**；
  //    本项目此前把局部主惯量直接当世界惯量用过（`axisInertia` 里是显式旋转的，
  //    这里是显式构造 `I_w`），两者不能混。
  const Ic = s.Ic;
  Ic.fill(0);
  let px = 0, py = 0, pz = 0;
  let hx = 0, hy = 0, hz = 0;
  const r = TMP_R, Iv = TMP_I;
  for (let i = 0; i < n; i++) {
    const b = doll.bodies[i]!;
    const mi = b.mass();
    const c = b.worldCom();
    const lin = b.linvel();
    const av = b.angvel();
    px += mi * lin.x; py += mi * lin.y; pz += mi * lin.z;

    // r_i = 质心 − 全局质心
    r[0] = c.x - cx; r[1] = c.y - cy; r[2] = c.z - cz;
    // m_i·(r_i × v_i)
    hx += mi * (r[1] * lin.z - r[2] * lin.y);
    hy += mi * (r[2] * lin.x - r[0] * lin.z);
    hz += mi * (r[0] * lin.y - r[1] * lin.x);

    // ── 刚体自身惯量旋到世界：q_w = q_body ⊗ q_principal
    const qb = b.rotation();
    const qp = b.principalInertiaLocalFrame();
    const qw = quatMul(qb.x, qb.y, qb.z, qb.w, qp.x, qp.y, qp.z, qp.w);
    const ip = b.principalInertia();
    const e0 = TMP_Q0, e1 = TMP_Q1, e2 = TMP_Q2;
    rotVec(qw.x, qw.y, qw.z, qw.w, 1, 0, 0, e0);
    rotVec(qw.x, qw.y, qw.z, qw.w, 0, 1, 0, e1);
    rotVec(qw.x, qw.y, qw.z, qw.w, 0, 0, 1, e2);
    // I_w = Σ_k I_k · e_k e_kᵀ
    Iv.fill(0);
    addOuterScaled(Iv, e0, ip.x);
    addOuterScaled(Iv, e1, ip.y);
    addOuterScaled(Iv, e2, ip.z);
    // I_w·ω
    const iwx = Iv[0]! * av.x + Iv[1]! * av.y + Iv[2]! * av.z;
    const iwy = Iv[3]! * av.x + Iv[4]! * av.y + Iv[5]! * av.z;
    const iwz = Iv[6]! * av.x + Iv[7]! * av.y + Iv[8]! * av.z;
    hx += iwx; hy += iwy; hz += iwz;

    // ── 质心惯量累加：I_c += I_w + m(|r|²E − r rᵀ)
    const rr = r[0]! * r[0]! + r[1]! * r[1]! + r[2]! * r[2]!;
    Ic[0] += Iv[0]! + mi * (rr - r[0]! * r[0]!); Ic[1] += Iv[1]! - mi * r[0]! * r[1]!; Ic[2] += Iv[2]! - mi * r[0]! * r[2]!;
    Ic[3] += Iv[3]! - mi * r[1]! * r[0]!; Ic[4] += Iv[4]! + mi * (rr - r[1]! * r[1]!); Ic[5] += Iv[5]! - mi * r[1]! * r[2]!;
    Ic[6] += Iv[6]! - mi * r[2]! * r[0]!; Ic[7] += Iv[7]! - mi * r[2]! * r[1]!; Ic[8] += Iv[8]! + mi * (rr - r[2]! * r[2]!);
  }

  s.m = m; s.cx = cx; s.cy = cy; s.cz = cz;
  s.vx = px * inv; s.vy = py * inv; s.vz = pz * inv;
  s.hx = hx; s.hy = hy; s.hz = hz;

  // ── ③ `a_c` 与 `ḣ_c`：中心差分环形缓冲
  //
  //  ★ 用**动量**差分（`p = m·v_c`）而不是位置二阶差分：
  //    后者在有接触冲击时把噪声放大到几十 m/s²（实测落地冲击在 `jointForce`
  //    里被读成 109 kN，根因相同）。动量差分在接触瞬间是**连续**的。
  const hHist = s._hHist;
  const pHist = s._pHist;
  const ptr = s._ptr;
  const filled = s._filled;
  hHist[ptr * 3] = hx; hHist[ptr * 3 + 1] = hy; hHist[ptr * 3 + 2] = hz;
  pHist[ptr * 3] = px; pHist[ptr * 3 + 1] = py; pHist[ptr * 3 + 2] = pz;

  if (filled >= H_MOM_WIN) {
    // 中心差分：当前 − 窗口另一端，除以窗口长度（帧）
    const other = (ptr + 1) % H_MOM_WIN;      // ptr 刚写入 ⇒ 另一端是 ptr+1（最老）
    const invWin = 1 / H_MOM_WIN;
    s.dhx = (hx - hHist[other * 3]!) * invWin;
    s.dhy = (hy - hHist[other * 3 + 1]!) * invWin;
    s.dhz = (hz - hHist[other * 3 + 2]!) * invWin;
    // a_c = ṗ / m。⚠ 帧间 dt = H_MOM_WIN / controlHz，要除回去 ⇒ 调用方
    //   需要用「每帧位移」而不是「加速度」。这里存的是**每帧增量**，
    //   语义在字段注释里写死（`ax` 单位 = m/s² × dt_ctrl）。
    s.ax = (px - pHist[other * 3]!) * invWin;
    s.ay = (py - pHist[other * 3 + 1]!) * invWin;
    s.az = (pz - pHist[other * 3 + 2]!) * invWin;
    s.dhReady = true;
  } else {
    s.dhReady = false;
  }
  s._ptr = (ptr + 1) % H_MOM_WIN;
  if (filled < H_MOM_WIN) s._filled = filled + 1;
  return s;
}

/**
 * `a_c` / `ḣ_c` 的**真加速度**形式：除掉帧间 dt。
 *
 * ⚠ 为什么单独给而不是在 `centroidal()` 里就除：`centroidal()` 不知道调用方的
 *   `dt`（`Sim` 的物理步长、控制拍长、探针的墙钟 dt 三者不同），
 *   写死任何一个都会引入本项目最常见的那类错（时间单位，见 `probe-axisown`
 *   里「时间单位」那段注释）。⇒ 存**每帧增量**，由调用方按自己的 dt 换算。
 */
export function perFrameToAccel(perFrame: number, dtCtrl: number): number {
  return dtCtrl > 1e-9 ? perFrame / dtCtrl : 0;
}

/** `I_c` 的迹（`tr(I_c)` = Σ 三个主惯量）—— 上界估计与合理性检查用 */
export function traceIc(s: CentroidalState): number {
  return s.Ic[0]! + s.Ic[4]! + s.Ic[8]!;
}

/** `I_c⁻¹ · v`（解 `I_c·x = v`）。奇异时返回 false（不静默给垃圾） */
export function solveIc(s: CentroidalState, vx: number, vy: number, vz: number, out: Float64Array): boolean {
  const a = s.Ic[0]!, b = s.Ic[1]!, c = s.Ic[2]!;
  const d = s.Ic[3]!, e = s.Ic[4]!, f = s.Ic[5]!;
  const g = s.Ic[6]!, h = s.Ic[7]!, i = s.Ic[8]!;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return false;
  const id = 1 / det;
  const i00 = A * id, i01 = -(b * i - c * h) * id, i02 = (b * f - c * e) * id;
  const i10 = B * id, i11 = (a * i - c * g) * id, i12 = -(a * f - c * d) * id;
  const i20 = C * id, i21 = -(a * h - b * g) * id, i22 = (a * e - b * d) * id;
  out[0] = i00 * vx + i01 * vy + i02 * vz;
  out[1] = i10 * vx + i11 * vy + i12 * vz;
  out[2] = i20 * vx + i21 * vy + i22 * vz;
  return true;
}

// ── 小工具（不分配，避免每帧 GC 抖动：120Hz × 18 刚体）────────────────────
const TMP_R = new Float64Array(3);
const TMP_I = new Float64Array(9);
const TMP_Q0 = new Float64Array(3);
const TMP_Q1 = new Float64Array(3);
const TMP_Q2 = new Float64Array(3);
const TMP_Q = new Float64Array(4);

function addOuterScaled(M: Float64Array, e: Float64Array, k: number): void {
  M[0] += k * e[0]! * e[0]!; M[1] += k * e[0]! * e[1]!; M[2] += k * e[0]! * e[2]!;
  M[3] += k * e[1]! * e[0]!; M[4] += k * e[1]! * e[1]!; M[5] += k * e[1]! * e[2]!;
  M[6] += k * e[2]! * e[0]!; M[7] += k * e[2]! * e[1]!; M[8] += k * e[2]! * e[2]!;
}

/** 四元数乘（a ⊗ b），写进 `TMP_Q` */
function quatMul(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
): { x: number; y: number; z: number; w: number } {
  TMP_Q[0] = aw * bx + ax * bw + ay * bz - az * by;
  TMP_Q[1] = aw * by - ax * bz + ay * bw + az * bx;
  TMP_Q[2] = aw * bz + ax * by - ay * bx + az * bw;
  TMP_Q[3] = aw * bw - ax * bx - ay * by - az * bz;
  return { x: TMP_Q[0]!, y: TMP_Q[1]!, z: TMP_Q[2]!, w: TMP_Q[3]! };
}
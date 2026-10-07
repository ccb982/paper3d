/**
 * v4/controlV1.ts —— **V4 v1：三证明的代码化**（架构_v4.md §3.5）
 *
 * 对应开工闸门的三条证明：
 *   (a) 力层核算器：F* 在**力层**截断（|Fx|≤μFz）+ 迈步请求（裂缝①）
 *   (b) 躯干任务：τ_hip 进入**躯干角动量方程**（显式 T2，髋驱动）
 *   (c) N₁ 投影：τ₂ = τ₁ + N₁Δτ₂（J₁N₁≡0 ⇒ L1 任务量严格不变，裂缝②）
 *
 * 与 v0 的区别：T2 不再直接相加，而是经**零空间投影**（数学保证不打架）。
 */
import type { Ragdoll } from '../ragdoll';

export interface V4Cfg1 {
  xF: number; xB: number; zH: number;   // 脚支持范围（相对踝，m）
  mu: number;                            // 摩擦系数（力层）
  kTrunk: number;                        // 躯干回正（髋）
  bTrunk: number;                        // 躯干阻尼（髋）
  kPost: number;                         // 其余关节对齐基线弱弹簧
  kSpine: number;                        // 脊柱极小刚度（E1 张力）
  bDamp: number;                         // 关节黏性（E2，非髋轴）
}

export const DEFAULT_V4_1: V4Cfg1 = {
  xF: 0.13, xB: 0.05, zH: 0.055,
  mu: 0.7,
  kTrunk: 40, bTrunk: 4,
  kPost: 12, kSpine: 3, bDamp: 8,
};

export interface V4Out1 {
  /** 唯一 τ 向量（nj*3） */
  tau: Float64Array;
  /** 裂缝①：CoP 饱和量（>0 即迈步请求；方向与大小由 errX/errZ 给） */
  stepReqX: number;
  stepReqZ: number;
  /** 力层截断计数（诊断） */
  clampFx: number;
  /** L1 任务量校验：J₁τ 与 J₁τ₁ 的差（应 ≈0；>1e-9 即投影失效） */
  l1Leak: number;
}

const G = 9.81;
const envNum = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

/** 6×6 求逆（高斯-约当；小矩阵，纯 JS） */
function invN(A: Float64Array, out: Float64Array): boolean {
  const M = new Float64Array(8 * 16);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) M[r * 16 + c] = A[r * 8 + c]!;
    M[r * 16 + 8 + r] = 1;
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(M[r * 16 + col]!) > Math.abs(M[piv * 16 + col]!)) piv = r;
    if (Math.abs(M[piv * 16 + col]!) < 1e-12) return false;
    if (piv !== col) for (let c = 0; c < 16; c++) { const t = M[col * 16 + c]!; M[col * 16 + c] = M[piv * 16 + c]!; M[piv * 16 + c] = t; }
    const p = M[col * 16 + col]!;
    for (let c = 0; c < 16; c++) M[col * 16 + c] = M[col * 16 + c]! / p;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = M[r * 16 + col]!;
      if (f === 0) continue;
      for (let c = 0; c < 16; c++) M[r * 16 + c] = M[r * 16 + c]! - f * M[col * 16 + c]!;
    }
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) out[r * 8 + c] = M[r * 16 + 8 + c]!;
  return true;
}

export function v4ControlV1(
  doll: Ragdoll,
  nj: number,
  com: { x: number; y: number; z: number; vx: number; vz: number },
  feet: {
    x: [number, number]; z: [number, number];
    fz: [number, number]; copX: [number, number]; copZ: [number, number];
    valid: [boolean, boolean];
  },
  out: Float64Array,
  tmp: { axisW: Float64Array; jw: Float64Array; jw2: Float64Array; rj: Float64Array; A: Float64Array; N: Float64Array; G6: Float64Array; dtau: Float64Array; dtauP: Float64Array; tau1: Float64Array },
  cfg: V4Cfg1 = DEFAULT_V4_1,
): V4Out1 {
  const mu = envNum('V4MU', cfg.mu);
  const kTrunk = envNum('V4KTRUNK', cfg.kTrunk);
  const bTrunk = envNum('V4BTRUNK', cfg.bTrunk);

  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(G / h);

  // ══ (a) 力层核算器：XcoM → F*（每脚），摩擦在**力层**截断 ═════════
  const xiX = com.x + com.vx / w0;
  const xiZ = com.z + com.vz / w0;
  let fzTot = 0;
  for (let q = 0; q < 2; q++) fzTot += Math.max(0, feet.fz[q] ?? 0);
  const m = doll.sk.massTotal;
  const W = m * G;
  const Fx = [0, 0], Fy = [0, 0], Fz2 = [0, 0];
  let clampFx = 0;
  let stepReqX = 0, stepReqZ = 0;
  for (let q = 0; q < 2; q++) {
    const share = fzTot > 40 ? Math.max(0, feet.fz[q]!) / fzTot : 0.5;
    const fz = W * share;
    Fy[q] = fz;
    const copNowX = feet.valid[q] ? feet.copX[q]! : feet.x[q]!;
    const copNowZ = feet.valid[q] ? feet.copZ[q]! : feet.z[q]!;
    const copCmdX = Math.min(feet.x[q]! + cfg.xF, Math.max(feet.x[q]! - cfg.xB, xiX));
    const copCmdZ = Math.min(feet.z[q]! + cfg.zH, Math.max(feet.z[q]! - cfg.zH, xiZ));
    // 裂缝①：饱和量 = 步请求（唯一合法接口）
    if (Math.abs(xiX - copCmdX) > Math.abs(stepReqX)) stepReqX = xiX - copCmdX;
    if (Math.abs(xiZ - copCmdZ) > Math.abs(stepReqZ)) stepReqZ = xiZ - copCmdZ;
    // ★★ LIPM 正解（2026-10-06 修一处符号错误）：
    //   倒立摆动力学 ẍ = ω₀²·(x − p)（加速度与 (CoM−CoP) **同号**——远离支撑才失稳）。
    //   要 CoP 落在 copCmd ⇒ 所需加速度 a* = (g/h)·(com − copCmd)
    //   ⇒ Fx = m_share·a* = W_share·(com − copCmd)/h。
    //   （曾写成 (copCmd − com)：符号翻转 ⇒ 正反馈 ⇒ CoM 一漂就再也回不来。）
    let fx = (W * share * (com.x - copCmdX)) / h;
    let fzz = (W * share * (com.z - copCmdZ)) / h;
    // 力层摩擦截断（|F_t| ≤ μF_n），绝不到 τ 层再封顶
    const fLim = mu * fz;
    if (Math.abs(fx) > fLim) { fx = Math.sign(fx) * fLim; clampFx++; }
    if (Math.abs(fzz) > fLim) { fzz = Math.sign(fzz) * fLim; clampFx++; }
    // ★ 显式 CoM 速度阻尼（补传播/相位不足；V4CD=N/(m/s)）
    {
      const cd = envNum('V4CD', 0);
      if (cd > 0) {
        fx += -cd * share * com.vx;
        fzz += -cd * share * com.vz;
      }
    }
    const noFx = envNum('V4NOFX', 0);
    Fx[q] = noFx > 0 ? 0 : fx;
    Fz2[q] = noFx > 0 ? 0 : fzz;
  }

  // ══ 任务矩阵 A（n×6）：τ_j = Σ_q (a_j×r_jq)·F_q ════════════════
  const A = tmp.A;      // n×8（列0-5=双足力；列6-7=上身角动量 Ḣx/Ḣz）
  for (let i = 0; i < nj; i++) {
    doll.jointWorld(i, tmp.jw);
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k;
      if (!doll.jointWorldAxis(i, k, tmp.axisW)) {
        for (let s = 0; s < 8; s++) A[idx * 8 + s] = 0;
        continue;
      }
      const ax = tmp.axisW[0]!, ay = tmp.axisW[1]!, az = tmp.axisW[2]!;
      // A_aug 列6/7：该轴对**上身角动量变化率**的贡献（关节对 ≈ ±1 的度规）
      const nmA = doll.sk.joints[i]?.name ?? '';
      if (/^hip_/.test(nmA)) {
        if (k === 2) A[idx * 8 + 6] = 1.0;    // 髋矢状 → Ḣx(俯仰)
        if (k === 0) A[idx * 8 + 7] = 1.0;    // 髋侧向 → Ḣz(侧倾)
      }
      for (let q = 0; q < 2; q++) {
        const rx = feet.x[q]! - tmp.jw[0]!;
        const ry = 0 - tmp.jw[1]!;
        const rz = feet.z[q]! - tmp.jw[2]!;
        // a×r 的分量
        const cx = ay * rz - az * ry;
        const cy = az * rx - ax * rz;
        const cz = ax * ry - ay * rx;
        A[idx * 8 + q * 3 + 0] = cx;
        A[idx * 8 + q * 3 + 1] = cy;
        A[idx * 8 + q * 3 + 2] = cz;
      }
    }
  }

  // ══ τ₁ = A·F* ══════════════════════════════════════════════════
  const tau1 = tmp.tau1;
  // L1 的角动量分量（Ḣ*）：躯干转速的 L1 阻尼（"躯干平衡"归 L1，姿态归 T2）
  const hdotK = envNum('V4HDOT', 0);
  let hdotX = 0, hdotZ = 0;
  {
    const bi = doll.sk.bodies.findIndex((b) => b.key === 'spine3');
    if (bi >= 0 && doll.bodyAngVel(bi, tmp.rj)) {
      hdotX = -hdotK * tmp.rj[0]!;
      hdotZ = -hdotK * tmp.rj[2]!;
    }
  }
  for (let i = 0; i < nj * 3; i++) {
    let t = 0;
    for (let q = 0; q < 2; q++) {
      t += A[i * 8 + q * 3 + 0]! * Fx[q]! + A[i * 8 + q * 3 + 1]! * Fy[q]! + A[i * 8 + q * 3 + 2]! * Fz2[q]!;
    }
    t += A[i * 8 + 6]! * hdotX + A[i * 8 + 7]! * hdotZ;
    tau1[i] = t;
  }

  // ══ (b) Δτ₂：躯干角动量任务（髋驱动）+ 非髋的弱弹簧 + E1/E2 ═════
  const dtau = tmp.dtau;
  // 躯干对**世界**的倾角（直接读物理姿态；含髋的贡献——"从胯发力"的量化前提）
  let trunkPitch = 0, trunkRoll = 0;
  {
    const bi = doll.sk.bodies.findIndex((b) => b.key === 'spine3');
    if (bi >= 0 && doll.bodyWorldAxis(bi, 1, tmp.rj)) {
      // 躯干局部 +Y 的世界分量：pitch = atan2(-x?), roll = atan2(z, y)
      const ux = tmp.rj[0]!, uy = tmp.rj[1]!, uz = tmp.rj[2]!;
      trunkPitch = Math.atan2(ux, uy);   // 前倾为正（世界 x 前）
      trunkRoll = Math.atan2(uz, uy);
    }
  }
  for (let i = 0; i < nj; i++) {
    const nm = doll.sk.joints[i]?.name ?? '';
    const isHip = /^hip_/.test(nm);
    const isSpine = /^spine/.test(nm);
    doll.jointRot(i, tmp.jw2);
    const q = tmp.jw2;
    doll.jointRelVel(i, tmp.rj);
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k;
      let d = 0;
      if (isHip && (k === 2 || k === 0)) {
        // 躯干任务：髋直接控躯干角动量（证明二）
        d += -kTrunk * (k === 2 ? trunkPitch : trunkRoll);
        d += -bTrunk * tmp.rj[k]!;
      } else if (isSpine) {
        d += -envNum('V4KSPINE', cfg.kSpine) * q[k]!;
      } else {
        d += -envNum('V4KPOST', cfg.kPost) * q[k]!;
        d += -envNum('V4BDAMP', cfg.bDamp) * tmp.rj[k]!;
      }
      dtau[idx] = d;
    }
  }

  // ══ (c) N₁ 投影：N = I − A(AᵀA)⁻¹Aᵀ（n×n 作用在 Δτ 上）═════════
  // Gram = AᵀA（6×6）
  const G6 = tmp.G6;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * A[i * 8 + c]!;
      G6[r * 8 + c] = s;
    }
  }
  const G6i = tmp.N;   // 复用
  // ★ 阻尼（Tikhonov）：Gram 在本系统**天然奇异**（两脚 Fz 列因刚体平移近似共线，
  //   实测 pivot 失败）⇒ 加 λ·I 后再求逆（λ = 1e-4·trace/6）。阻尼 NSP 是标准做法。
  {
    let tr = 0;
    for (let r = 0; r < 8; r++) tr += G6[r * 8 + r]!;
    const lam = Math.max(1e-8, 1e-4 * tr / 8);
    for (let r = 0; r < 8; r++) G6[r * 8 + r] = G6[r * 8 + r]! + lam;
  }
  const okInv = invN(G6, G6i);
  // 调试：登记奇异（经 env V4DBG 打印一次）
  if (!okInv && !(globalThis as { __v4sing?: boolean }).__v4sing) {
    (globalThis as { __v4sing?: boolean }).__v4sing = true;
    const dbg = ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).V4DBG;
    if (dbg === '1') console.log('[v4] Gram 奇异！不投影。G6 =', Array.from(G6).map((v) => v.toFixed(2)).join(','));
  }
  const dtauP = tmp.dtauP;
  if (okInv) {
    // w = G6i·(AᵀΔτ)  （6 维）
    const at = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * dtau[i]!;
      at[r] = s;
    }
    const w = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let c = 0; c < 8; c++) s += G6i[r * 8 + c]! * at[c]!;
      w[r] = s;
    }
    // ΔτP = Δτ − A·w
    for (let i = 0; i < nj * 3; i++) {
      let s = 0;
      for (let r = 0; r < 8; r++) s += A[i * 8 + r]! * w[r]!;
      dtauP[i] = dtau[i]! - s;
    }
  } else {
    // Gram 奇异（退化姿态）：不投影（flag 由 l1Leak 暴露）
    for (let i = 0; i < nj * 3; i++) dtauP[i] = dtau[i]!;
  }

  // ══ 合成 + L1 泄漏自检 + 软墙 ═══════════════════════════════════
  // ★ L1 泄漏度量：‖Aᵀ·Δτ_P‖（投影正确时严格 = 0；错误索引曾把此量算成垃圾）
  let l1Leak = 0;
  {
    const at = new Float64Array(8);
    for (let r = 0; r < 8; r++) {
      let s = 0;
      for (let i = 0; i < nj * 3; i++) s += A[i * 8 + r]! * dtauP[i]!;
      at[r] = s;
    }
    for (let r = 0; r < 8; r++) l1Leak += Math.abs(at[r]!);
  }
  for (let i = 0; i < nj * 3; i++) {
    out[i] = tau1[i]! + dtauP[i]!;
  }
  // ★★★★★ 约束感知投影（POCS 交替投影；裂缝④的修复）
  //   Ju 2021 的教训：硬碰边界 ⇒ 振荡；事后软墙 ⇒ 破坏零空间不变量。
  //   正确：在"盒约束集"与"L1 零空间仿射集"之间**交替投影**（两者都是凸集）
  //   ⇒ 收敛到交集内一点（近端解），且 L1 不变量在任何一步都被重新施加。
  {
    const softFrac = 0.9;
    const proj = (vec: Float64Array): void => {
      // 步1：盒约束（软墙）
      for (let i = 0; i < nj; i++) {
        const jd = doll.sk.joints[i];
        if (!jd) continue;
        for (let k = 0; k < 3; k++) {
          const idx = i * 3 + k;
          const cap = jd.maxTorque[k]!;
          const soft = cap * softFrac;
          const v = vec[idx]!;
          if (v > soft) vec[idx] = soft + (cap - soft) * Math.tanh((v - soft) / Math.max(1e-6, cap - soft));
          else if (v < -soft) vec[idx] = -soft + (-cap + soft) * Math.tanh((v + soft) / Math.max(1e-6, cap - soft));
        }
      }
      // 步2：残差回投零空间（恢复 L1 不变量）
      if (!okInv) return;
      const at = new Float64Array(8);
      for (let r = 0; r < 8; r++) {
        let s2 = 0;
        for (let i = 0; i < nj * 3; i++) s2 += A[i * 8 + r]! * (vec[i]! - tau1[i]!);
        at[r] = s2;
      }
      const w = new Float64Array(8);
      for (let r = 0; r < 8; r++) {
        let s2 = 0;
        for (let c = 0; c < 8; c++) s2 += G6i[r * 8 + c]! * at[c]!;
        w[r] = s2;
      }
      for (let i = 0; i < nj * 3; i++) {
        let s2 = 0;
        for (let r = 0; r < 8; r++) s2 += A[i * 8 + r]! * w[r]!;
        vec[i] = vec[i]! - s2;
      }
    };
    for (let it = 0; it < 4; it++) proj(out);
  }
  return { tau: out, stepReqX, stepReqZ, clampFx, l1Leak };
}

/**
 * v4/control.ts —— **V4 控制层（全新，不 import 任何旧控制模块）**
 *
 * 设计依据：架构_v4.md §3 + 架构_v3.md §8.10（HQP 文献综合）。
 *
 * 结构：
 *   L1 平衡：足底期望力 F*（XcoM→CoP 的 Hof 规则）→ τ = Σ_feet a·(r×F)
 *            （与重力补偿同一个几何式；姿态自动精确）
 *   L2 姿态：对齐基线的**弱弹簧**（K 小）+ 阻尼（物理层）
 *   L3 肢体：由调度层暂缺（后续接状态机的关键帧）
 *   约束：τmax 硬夹 + **摩擦锥软墙**（τ ≤ μFv·h，距离加权）
 *
 * 每拍输出**唯一 τ 向量**（无多通道相加）。
 */
import type { Ragdoll } from '../ragdoll';

export interface V4Cfg {
  /** 脚的支持范围（相对踝，米） */
  xF: number;
  xB: number;
  zH: number;
  /** 摩擦安全系数 */
  mu: number;
  /** L2 弱弹簧刚度（N·m/rad）与基线**
  kPost: number;
  /** 阻尼（N·m·s/rad） */
  bDamp: number;
  /** 每关节的 τmax 缩放（1=由 maxTorque 决定） */
  tauScale: number;
  /** L2 弱弹簧刚度（N·m/rad） */
  kPost: number;
}

export const DEFAULT_V4: V4Cfg = {
  xF: 0.13, xB: 0.05, zH: 0.055,
  mu: 0.7,
  kPost: 12,       // 弱（生理量级下限；L1 为主）
  bDamp: 8,        // 关节黏性（物理阻尼）
  tauScale: 1.0,
};

const G = 9.81;

/** 数值环境变量 */
const envNum = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export interface V4Tmp {
  axisW: Float64Array;
  jw: Float64Array;
  jw2: Float64Array;
}

export const makeTmp = (): V4Tmp => ({
  axisW: new Float64Array(3),
  jw: new Float64Array(3),
  jw2: new Float64Array(3),
});

/**
 * 一拍的 V4 控制。**doll 是纯执行器**：本函数返回 τ 向量（长度 nj*3），
 * 由调用方写入执行器（外加被动阻尼在执行器侧）。
 */
export function v4Control(
  doll: Ragdoll,
  nj: number,
  com: { x: number; y: number; z: number; vx: number; vz: number },
  feet: {
    x: [number, number]; z: [number, number];
    fz: [number, number]; copX: [number, number]; copZ: [number, number];
    valid: [boolean, boolean];
  },
  supIdx: 0 | 1,

  out: Float64Array,
  tmp: V4Tmp,
  cfg: V4Cfg = DEFAULT_V4,
): void {
  const mu = envNum('V4MU', cfg.mu);
  const kPost = envNum('V4KPOST', cfg.kPost);
  const bDamp = envNum('V4BDAMP', cfg.bDamp);

  // ── XcoM（Hof 2010）─────────────────────────────────────────
  // 支撑高度：CoM 高出地面（脚在 y≈0）
  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(G / h);
  const xiX = com.x + com.vx / w0;
  const xiZ = com.z + com.vz / w0;

  // ── 每脚的期望力 ────────────────────────────────────────────
  // Fz：把总重按测量 Fz 份额分配（无测量则对半）
  let fzTot = 0;
  for (let q = 0; q < 2; q++) fzTot += Math.max(0, feet.fz[q] ?? 0);
  const m = doll.sk.massTotal;
  const W = m * G;
  const fxDes: number[] = [0, 0], fzDes: number[] = [0, 0], fzLatDes: number[] = [0, 0];
  for (let q = 0; q < 2; q++) {
    const share = fzTot > 40 ? Math.max(0, feet.fz[q]!) / fzTot : 0.5;
    const Fz = W * share;
    fzDes[q] = Fz;
    // Hof：把 CoP 压到 clamp(ξ, 足缘)；再换算成水平力 Fx = Fz·(copCmd − cop)/h
    const copNowX = feet.valid[q] ? feet.copX[q]! : feet.x[q]!;
    const copNowZ = feet.valid[q] ? feet.copZ[q]! : feet.z[q]!;
    const copCmdX = Math.min(feet.x[q]! + cfg.xF, Math.max(feet.x[q]! - cfg.xB, xiX));
    const copCmdZ = Math.min(feet.z[q]! + cfg.zH, Math.max(feet.z[q]! - cfg.zH, xiZ));
    fxDes[q] = (Fz * (copCmdX - copNowX)) / h;
    fzLatDes[q] = (Fz * (copCmdZ - copNowZ)) / h;
  }

  // ── 摩擦锥软墙的每轴上限（先算好）────────────────────────────
  const caps = new Float64Array(nj * 3);
  for (let i = 0; i < nj; i++) {
    doll.jointWorld(i, tmp.jw);
    const hJ = Math.max(0.02, tmp.jw[1]!);
    const cap = mu * W * hJ;
    const jd = doll.sk.joints[i]; const tmax = jd ? jd.maxTorque : [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      caps[i * 3 + k] = Math.min(tmax[k]!, cap);
    }
  }

  // ── L1+L2 合成：τ_j = Σ_feet a_j·(r_j×F) + L2 弱弹簧 − 阻尼 ──
  //   （r_j = 足位置 − 关节位置；a_j = 关节轴世界方向）
  for (let i = 0; i < nj; i++) {
    doll.jointWorld(i, tmp.jw);
    // 关节轴世界方向（用父体姿态：与 enforceLimits 同约定）
    for (let k = 0; k < 3; k++) {
      const idx = i * 3 + k;
      if (!doll.jointWorldAxis(i, k, tmp.axisW)) { out[idx] = 0; continue; }
      const ax = tmp.axisW[0]!, ay = tmp.axisW[1]!, az = tmp.axisW[2]!;
      let tau = 0;
      for (let q = 0; q < 2; q++) {
        const rx = feet.x[q]! - tmp.jw[0]!;
        const ry = 0 - tmp.jw[1]!;               // 足在 y≈0
        const rz = feet.z[q]! - tmp.jw[2]!;
        const Fx = fxDes[q]!, Fy = fzDes[q]!, Fz2 = fzLatDes[q]!;
        // (r×F)·a
        tau += (ry * Fz2 - rz * Fy) * ax + (rz * Fx - rx * Fz2) * ay + (rx * Fy - ry * Fx) * az;
      }
      // L2 弱弹簧（对齐基线 = 关节角 0 度，即静姿；用户"腿伸直/重力线穿关节"）
      doll.jointRot(i, tmp.jw2);
      const q = tmp.jw2[k]!;
      tau += -kPost * q;
      // 阻尼（物理层，非控制；此处并入输出，执行器不再另加）
      doll.jointRelVel(i, tmp.jw2);
      tau += -bDamp * tmp.jw2[k]!;
      // 软墙（Ju 2021：靠近上限做距离加权降级，而非硬碰）
      const cap = caps[idx]!;
      const soft = cap * 0.85;
      if (tau > soft) tau = soft + (cap - soft) * Math.tanh((tau - soft) / Math.max(1e-6, cap - soft));
      else if (tau < -soft) tau = -soft + (-cap + soft) * Math.tanh((tau + soft) / Math.max(1e-6, cap - soft));
      out[idx] = tau;
    }
  }
}

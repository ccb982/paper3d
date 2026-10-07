/**
 * v4/predict.ts —— **坠落预测**（架构_v4.md §4.10.1①）
 *   前向 LIPM 推演（解析）：ξ(t) = p + (ξ0−p)·e^{ωt}（每轴独立）
 *   文献：Hof 2010（ξ 解析）；Messiou 2025（MPC=CNS 模型）；DEC（扰动估计精神）
 */
export interface V4Prediction {
  /** 前向 T 秒后各轴的 ξ */
  xiTX: number; xiTZ: number;
  /** 若以当前 CoP 继续，出界时间（∞=不出界） */
  ttb: number;
  /** 扰动源估计（当前 CoM 的等效外部加速度，DEC 精神） */
  distX: number; distZ: number;
  /** 是否不可逆（即使最优 CoP 也救不回） */
  irreversible: boolean;
}

const G = 9.81;

/** 前向推演（单轴）：ξ(T) = p + (ξ0−p)e^{ωT} */
const predictAxis = (xi0: number, p: number, w0: number, T: number): number =>
  p + (xi0 - p) * Math.exp(w0 * T);

/**
 * 预测（给定一个候选 CoP 方案）。
 * @param com     当前质心状态
 * @param copX/copZ  候选方案的 CoP（x/z）
 * @param edgeX/edgeZ 支撑面边界（出界判据）
 * @param horizon  预测时域（s，默认 0.5）
 */
export function predictFall(
  com: { x: number; y: number; z: number; vx: number; vz: number },
  copX: number, copZ: number,
  edgeX: { lo: number; hi: number }, edgeZ: { lo: number; hi: number },
  horizon = 0.25,
): V4Prediction {
  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(G / h);
  const xi0X = com.x + com.vx / w0;
  const xi0Z = com.z + com.vz / w0;
  const xiTX = predictAxis(xi0X, copX, w0, horizon);
  const xiTZ = predictAxis(xi0Z, copZ, w0, horizon);
  // TTB（以当前 CoP 连续作用）：解 ξ(t)=edge 的 t
  const ttbAxis = (xi0: number, p: number, lo: number, hi: number): number => {
    // ξ 向远离 p 的方向漂：只有 xi0>p 会向上出界、xi0<p 向下
    if (xi0 > p && xi0 < hi) {
      const t = Math.log(Math.max(1e-9, (hi - p) / (xi0 - p))) / w0;
      return Number.isFinite(t) ? Math.max(0, t) : Number.POSITIVE_INFINITY;
    }
    if (xi0 < p && xi0 > lo) {
      const t = Math.log(Math.max(1e-9, (lo - p) / (xi0 - p))) / w0;
      return Number.isFinite(t) ? Math.max(0, t) : Number.POSITIVE_INFINITY;
    }
    return 0; // 已出界
  };
  const ttb = Math.min(ttbAxis(xi0X, copX, edgeX.lo, edgeX.hi), ttbAxis(xi0Z, copZ, edgeZ.lo, edgeZ.hi));
  // 扰动估计（DEC 精神）：由 ξ 与"当前 CoP 预测"的残差反推等效外部加速度
  const xiPredX = predictAxis(xi0X, copX, w0, 0.02);
  const xiPredZ = predictAxis(xi0Z, copZ, w0, 0.02);
  const distX = (xiPredX - xi0X) / 0.02;
  const distZ = (xiPredZ - xi0Z) / 0.02;
  const irreversible = xi0X < edgeX.lo - 0.3 || xi0X > edgeX.hi + 0.3 || xi0Z < edgeZ.lo - 0.3 || xi0Z > edgeZ.hi + 0.3;
  return { xiTX, xiTZ, ttb, distX, distZ, irreversible };
}

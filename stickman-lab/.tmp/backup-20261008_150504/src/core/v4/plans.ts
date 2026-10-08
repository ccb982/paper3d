/**
 * v4/plans.ts —— **救援方案枚举 + 择优**（架构_v4.md §4.10.1②③）
 *
 *   候选集：
 *     A. 垫脚（仅踝）：CoP = clamp(ξ, 踝可达域)
 *     B. 垫脚+髋（CMP）：A + 髋角动量等效 CoP 扩展
 *     C. 迈步×方向：落足点候选（前/后/左/右 + 原地），支撑面前移/后移
 *   择优：J = w1·预测残留 + w2·干预代价（级别） + w3·切换代价
 *   ⇒ 输出给平衡系统的提案（含 level 与推荐 CoP/落足点）
 */
import { predictFall, type V4Prediction } from './predict';

export interface V4Plan {
  kind: 'pad' | 'padHip' | 'step';
  stepX: number; stepZ: number;
  copX: number; copZ: number;
  pred: V4Prediction;
  cost: number;
}

export interface V4PlansOut {
  plans: V4Plan[];
  best: V4Plan;
  /** 推荐 level：0=垫脚 1=加髋 2=迈步 */
  level: 0 | 1 | 2;
}

export function enumeratePlans(
  com: { x: number; y: number; z: number; vx: number; vz: number },
  footX: number, footZ: number,          // 支撑脚位置
  ankleReach: { back: number; front: number; half: number },   // 踝可达域（相对脚）
  prevKind: 'pad' | 'padHip' | 'step' = 'pad',
  horizon = 0.25,
): V4PlansOut {
  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(9.81 / h);
  const xiX = com.x + com.vx / w0;
  const xiZ = com.z + com.vz / w0;
  const plans: V4Plan[] = [];

  const copClamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const edgeX = { lo: footX - 0.5, hi: footX + 0.5 };   // 出界判据（宽口径，真正判 level 用可达域）
  const edgeZ = { lo: footZ - 0.5, hi: footZ + 0.5 };

  // A. 垫脚（仅踝）
  {
    const copX = copClamp(xiX, footX - ankleReach.back, footX + ankleReach.front);
    const copZ = copClamp(xiZ, footZ - ankleReach.half, footZ + ankleReach.half);
    const pred = predictFall(com, copX, copZ, edgeX, edgeZ, horizon);
    const resid = Math.max(0, Math.abs(pred.xiTX - footX) - 0.15) + Math.max(0, Math.abs(pred.xiTZ - footZ) - 0.1);
    plans.push({ kind: 'pad', stepX: 0, stepZ: 0, copX, copZ, pred, cost: 1.0 + 10 * resid });
  }
  // B. 垫脚+髋（CMP：等效 CoP 向外扩展 0.12m）
  {
    const ext = 0.12;
    const copX = copClamp(xiX, footX - ankleReach.back - ext, footX + ankleReach.front + ext);
    const copZ = copClamp(xiZ, footZ - ankleReach.half - ext, footZ + ankleReach.half + ext);
    const pred = predictFall(com, copX, copZ, edgeX, edgeZ, horizon);
    const resid = Math.max(0, Math.abs(pred.xiTX - footX) - 0.15) + Math.max(0, Math.abs(pred.xiTZ - footZ) - 0.1);
    plans.push({ kind: 'padHip', stepX: 0, stepZ: 0, copX, copZ, pred, cost: 2.0 + 10 * resid });
  }
  // ★★★★★ C. 迈步候选 —— **Koolen 2012 的 1-step capturability 判据**（论文级重构）
  //   0-step 可捕获（Pratt 2006）：ξ ∈ [支撑最小, 支撑最大]（CP 在支撑内）
  //   1-step：存在落足点 nf，使**一步后**的 ξ' 落入 nf 的 0-step 集
  //     ξ' = p_cur + (ξ0 − p_cur)·e^{ωT_step}   （步中 CoP≈当前脚，T_step=步时）
  //     capturable ⇔ ξ' ∈ [nf − footHalf, nf + footHalf]（脚掌几何）
  {
    const TSTEP = 0.3;   // 步时（LIFT+SWING，与状态机同源）
    const footHalfX = 0.12, footHalfZ = 0.055;
    const pCurX = copClamp(xiX, footX - ankleReach.back, footX + ankleReach.front);
    const pCurZ = copClamp(xiZ, footZ - ankleReach.half, footZ + ankleReach.half);
    const xiAfterX = pCurX + (xiX - pCurX) * Math.exp(w0 * TSTEP);
    const xiAfterZ = pCurZ + (xiZ - pCurZ) * Math.exp(w0 * TSTEP);
    const cand: Array<[number, number]> = [
      [0.25, 0], [-0.2, 0], [0, 0.2], [0, -0.2], [0.15, 0.15], [-0.12, -0.12],
    ];
    for (const [sx, sz] of cand) {
      const nfx = footX + sx, nfz = footZ + sz;
      // 该落足点能否捕获一步后的 ξ'
      const missX = Math.max(0, Math.abs(xiAfterX - nfx) - footHalfX);
      const missZ = Math.max(0, Math.abs(xiAfterZ - nfz) - footHalfZ);
      const miss = Math.hypot(missX, missZ);       // 0 = 1-step 可捕获
      const copX = copClamp(xiX, nfx - ankleReach.back, nfx + ankleReach.front);
      const copZ = copClamp(xiZ, nfz - ankleReach.half, nfz + ankleReach.half);
      const pred = predictFall(com, copX, copZ, edgeX, edgeZ, horizon);
      // 代价：可捕获(miss=0) ⇒ 基础 5（仍高于垫脚）；不可捕获 ⇒ 天价
      const cost = miss < 1e-6 ? 5.0 + 0.5 * Math.hypot(sx, sz) : 20.0 + 50 * miss;
      plans.push({ kind: 'step', stepX: sx, stepZ: sz, copX, copZ, pred, cost });
    }
  }
  // 切换代价
  for (const p of plans) if (p.kind !== prevKind) p.cost += 0.5;
  plans.sort((a, b) => a.cost - b.cost);
  const best = plans[0]!;
  const level: 0 | 1 | 2 = best.kind === 'pad' ? 0 : best.kind === 'padHip' ? 1 : 2;
  return { plans, best, level };
}

/**
 * virtualLeg.ts —— 虚拟腿协同（2026-10-18 用户：'把下身固定'）
 *
 * 文献依据（用户：'你看论文要咋弄'）：
 *   · Bernstein 1967 冻结自由度（Freezing DOF）：新手把冗余关节锁成刚性协同=稳定的合法策略
 *   · SLIP/虚拟腿（腿部机器人）：腿当一根伸缩弹簧——蹲=虚拟腿压缩，无内部乱动自由度
 *   · 蹲起肌电文献：髋膝踝按固定协变运动（协同 synergy）
 *
 * 正解：髋+膝锁成**一个自由度**（髋-踝望远镜）：
 *   L   = |p_踝 − p_髋|（矢状面 = X-Y 平面：前-上；蹲姿的腿在 X-Y 里折）
 *   F   = kpL×(L0−L) − kdL×L̇（虚拟腿弹簧；L0=静置捕获；L̇=数值差分免约定）
 *   τ_j = F × g_j，g_j = ∂L/∂θ_j = u·(ω_j × (p_踝 − a_j))（虚功；ω_j = 轴矢量）
 *
 * ★★ 2026-10-18 根因修正（VDBG 实测）：矢状关节的轴是 **Z**（body.ts: "轴0=X 轴2=Z（屈伸）"），
 *   不是 Y！此前公式用 Y 轴+XZ 平面 → 梯度≈0（力矩≈0，腿实际只受基础力+dp）→"撑不起"。
 *   staticBalance 用的是 u[2]（Z 轴）——一致。
 *
 *   ——髋/膝只做伸缩（协同），没有相对乱动；侧向轴不在此（由逐关节 PD 管）
 *   ——踝不在 L 里（它只管脚掌平贴=抓地，由 supportClean 的阻尼路径管）
 */
import type { Body } from '../body';

const _ref: { l: { L0: number | null; Lp: number | null }; r: { L0: number | null; Lp: number | null } } = {
  l: { L0: null, Lp: null }, r: { L0: null, Lp: null },
};

/** ∂L/∂θ 对关节 j（轴 az、锚 p，踝点 q）——u=(ux,uy)，ω=(0,0,az) */
function gradL(az: number, q: Float64Array, p: Float64Array, ux: number, uy: number): number {
  const rx = q[0]! - p[0]!;
  const ry = q[1]! - p[1]!;
  // (ω×r) = (−az·ry, az·rx, 0) → g = ux·(−az·ry) + uy·(az·rx)
  return ux * (-az * ry) + uy * (az * rx);
}

/**
 * 计算虚拟腿协同力矩（dofIndex → N·m，未限幅）。只写髋/膝的矢状（轴2=Z）自由度；
 * 其余自由度不动（由逐关节路径负责）。
 */
export function virtualLeg(body: Body): Map<number, number> {
  const res = new Map<number, number>();
  const e = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const kpL = Number(e.SQ_VLEG_KP ?? 12000);   // 虚拟腿刚度 N/m
  const kdL = Number(e.SQ_VLEG_KD ?? 1300);    // 虚拟腿阻尼 N·s/m（临界≈2√(kp·M_eff)）
  for (const side of ['l', 'r'] as const) {
    const hi = body.dofByName(`hip_${side}`, 2);
    const ki = body.dofByName(`knee_${side}`, 2);
    const fi = body.dofByName(`foot_${side}`, 2);
    if (hi < 0 || ki < 0 || fi < 0) continue;
    const hd = body.dofs[hi]!, kd = body.dofs[ki]!, fd = body.dofs[fi]!;
    const pHip = hd.anchorWorld;
    const pAnk = fd.anchorWorld;
    const dx = pAnk[0]! - pHip[0]!;
    const dy = pAnk[1]! - pHip[1]!;   // ★ 矢状面 = X-Y（前-上）
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1e-6) continue;
    const r = _ref[side];
    const l0f = Number(e.SQ_VLEG_L0F ?? 1.0);
    if (r.L0 === null) r.L0 = L * l0f;   // 静置捕获（姿势=标准目标）
    const ux = dx / L, uy = dy / L;
    // L̇ = 数值差分（免轴/角符号约定）
    const Ldot = r.Lp === null ? 0 : (L - r.Lp) / (1 / 240);
    r.Lp = L;
    const F = kpL * (r.L0 - L) - kdL * Ldot;
    // 虚功：τ_j = F × ∂L/∂θ_j（矢状轴 = Z）
    const gH = gradL(hd.axisWorld[2]!, pAnk, pHip, ux, uy);
    const gK = gradL(kd.axisWorld[2]!, pAnk, kd.anchorWorld, ux, uy);
    if (e.SQ_VLEG_DBG === '1' && side === 'r') {
      console.log(`VDBG L=${L.toFixed(3)} L0=${r.L0.toFixed(3)} Ldot=${Ldot.toFixed(3)} F=${F.toFixed(0)} | u=(${ux.toFixed(2)},${uy.toFixed(2)}) gH=${gH.toFixed(3)} gK=${gK.toFixed(3)} | azH=${hd.axisWorld[2]!.toFixed(2)} azK=${kd.axisWorld[2]!.toFixed(2)} angH=${hd.angle.toFixed(0)} angK=${kd.angle.toFixed(0)} | tauH=${(F * gH).toFixed(0)} tauK=${(F * gK).toFixed(0)}`);
    }
    res.set(hi, (res.get(hi) ?? 0) + F * gH);
    res.set(ki, (res.get(ki) ?? 0) + F * gK);
  }
  return res;
}

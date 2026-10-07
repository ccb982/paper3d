/**
 * v4/warning.ts —— **摔倒预警包**（架构_v4.md §4.5；平衡系统的唯一感知输入）
 *
 *   文献：
 *   · Hof 2005《The condition for dynamic stability》：MoS = 支撑面前沿 − ξ
 *   · Hof 2010：ξ̇ = ω₀(ξ − p)  ⇒  TTB = MoS / |ξ̇|（提前量解析式）
 *   · arXiv:2606.02928 / 2606.02888：MoS = 跌倒风险的标准量
 *
 *   产物（每拍，控制率）：
 *     mosX/mosZ  —— 余量（m，正=稳）
 *     ttbX/ttbZ  —— 到界时间（s，∞=稳；<τ_react 须提前动作）
 *     dirX/dirZ  —— 出界方向（±1）
 *     urgency    —— 归一化紧急度（0~1，供平衡/迈步分级）
 *     reachable  —— 当前 CoP 能否追上出界点（踝可达性）
 */

export interface V4Warning {
  /** ξ（XcoM）本身——感知层算一次，下游共享（v4 不得自算） */
  xiX: number; xiZ: number;
  mosX: number; mosZ: number;
  ttbX: number; ttbZ: number;
  dirX: number; dirZ: number;
  urgency: number;
  reachable: boolean;
}

const G = 9.81;
const envNumW = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

export function computeWarning(
  com: { x: number; y: number; z: number; vx: number; vz: number },
  support: { cx: number; cz: number; halfX: number; halfZ: number; halfZActive: number },
  ankleRangeX: { back: number; front: number },   // 踝可达的 CoP 范围（相对当前脚）
  supFootX: number, supFootZ: number,
): V4Warning {
  void supFootX; void supFootZ;
  const h = Math.max(0.25, com.y);
  const w0 = Math.sqrt(G / h);
  const xiX = com.x + com.vx / w0;
  const xiZ = com.z + com.vz / w0;

  // MoS：ξ 到支撑面的距离（沿 x、z 两个方向；正=在界内）
  const backX = support.cx - support.halfX;
  const frontX = support.cx + support.halfX;
  const leftZ = support.cz - Math.max(support.halfZ, support.halfZActive);
  const rightZ = support.cz + Math.max(support.halfZ, support.halfZActive);
  let mosX: number, dirX: number;
  if (xiX < backX) { mosX = xiX - backX; dirX = -1; }
  else if (xiX > frontX) { mosX = frontX - xiX; dirX = +1; }
  else { mosX = Math.min(xiX - backX, frontX - xiX); dirX = 0; }
  let mosZ: number, dirZ: number;
  if (xiZ < leftZ) { mosZ = xiZ - leftZ; dirZ = -1; }
  else if (xiZ > rightZ) { mosZ = rightZ - xiZ; dirZ = +1; }
  else { mosZ = Math.min(xiZ - leftZ, rightZ - xiZ); dirZ = 0; }

  // TTB：Hof 2010 的 ξ̇ = ω₀(ξ − p)，p 取支撑面内最近的等效点
  const pX = Math.min(frontX, Math.max(backX, xiX));
  const pZ = Math.min(rightZ, Math.max(leftZ, xiZ));
  const xiDotX = Math.abs(w0 * (xiX - pX));
  const xiDotZ = Math.abs(w0 * (xiZ - pZ));
  const ttbX = mosX >= 0 ? Number.POSITIVE_INFINITY : Math.abs(mosX) / Math.max(1e-6, xiDotX);
  const ttbZ = mosZ >= 0 ? Number.POSITIVE_INFINITY : Math.abs(mosZ) / Math.max(1e-6, xiDotZ);

  // ★ 2026-10-06 修 urgency（回读发现：τ_react=0.2 时 TTB=0.3 恒得 0——
  //   物理上 0.3s 后要倒显然是紧急的）。
  //   正确标度：TTB=0 ⇒ 1；TTB≥T_WINDOW（默认 1.0s）⇒ 0（线性）。
  const tWindow = Math.max(0.2, Number(envNumW('V4T_WINDOW', 1.0)));
  const tMin = Math.min(ttbX, ttbZ);
  const urgency = Number.isFinite(tMin) ? Math.min(1, Math.max(0, 1 - tMin / tWindow)) : 0;

  // reachable：CoP 能否覆盖出界方向（踝前后行程）
  const reachable = mosX >= 0 || (dirX < 0 ? -mosX <= ankleRangeX.back : -mosX <= ankleRangeX.front);

  return { xiX, xiZ, mosX, mosZ, ttbX, ttbZ, dirX, dirZ, urgency, reachable };
}

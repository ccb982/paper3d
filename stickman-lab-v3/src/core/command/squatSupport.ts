import type { Body } from '../body';
import { squatDynamicSupport } from '../servo/squatGravity';

/** 只生成蹲下基础支撑前馈；不写关节目标/脚底接触。 */
export function computeSquatSupport(body: Body, gBuf: Float64Array, sBuf: Float64Array, tauGravity: Float64Array): void {
  body.gravityComp(gBuf, -9.81);
  squatDynamicSupport(body, sBuf, { scale: 1 });
  const ki = body.dofByName('knee_l', 2);
  const knee = ki >= 0 ? Math.abs(body.dofs[ki]!.angle) : 0;
  const w = Math.max(0, Math.min(1, (knee - 0.25) / 0.95));
  const hipSup = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.PP_HIP_SUP ?? 1.0);
  for (let i = 0; i < body.dofs.length; i++) {
    const d = body.dofs[i]!;
    if (!/^(hip|knee|spine|neck|shoulder|elbow)/.test(d.name) || d.engineMotor) continue;
    if (d.axis !== 2) continue;
    let v = (1 - w) * gBuf[i]! + w * sBuf[i]!;
    if (/^hip_/.test(d.name)) v *= hipSup;
    tauGravity[i] = Math.abs(v) > 1e-9 ? v : 0;
  }
}

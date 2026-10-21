/**
 * virtualLegStrut.ts —— 蹲姿 ankle→hip 虚拟腿柱（基础力结构，不是关节力矩）
 *
 * 用户定稿（2026-10-21）：
 *   · 虚拟柱属于**基础力**；力向量“偏竖直、带一点前向”（矢状面）；
 *   · 等大反向施加在 hip / foot，净外力为 0；外部支撑仍是 GRF；
 *   · 不是 CoM 反馈、不是 hip 常值前馈；是预计算的基础力分量；
 *   · 申请制：UP/FWD 预算、squat/released/深屈/承重门控、逐帧可审计。
 *
 * 力向量：
 *   F_hip  = (+F_fwd, +F_up, 0)
 *   F_foot = (−F_fwd, −F_up, 0)
 *   F_fwd / F_up 预计算；F_up 承担竖向分担，F_fwd 抵消后倒。
 */

import type { World } from '../world';
import type { CourtState } from '../court';
import { baseState } from './baseTable';

/** 法庭/离开蹲姿时清空（保留 API；常量力不需要状态） */
export function resetLegStrut(): void {
  /* no state */
}

/** 每物理步（squatFrame 内调用；在 advance 之后施加，作用于下一步） */
export function squatLegStrut(w: World, st: CourtState): void {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  if (String(env.SQC_STRUT ?? '0') !== '1') return;
  if (baseState() !== 'squat' || !st.released || st.fall >= 0) return;

  const body = w.body;
  const dt = w.dt;
  const fMax = Math.abs(Number(env.SQC_STRUT_FMAX ?? 800));
  const fUp = Math.max(-fMax, Math.min(fMax, Number(env.SQC_STRUT_UP ?? 150)));    // N/侧，正=向上
  const fFwd = Math.max(-fMax, Math.min(fMax, Number(env.SQC_STRUT_FWD ?? 40)));   // N/侧，正=向前
  const kneeMin = Number(env.SQC_STRUT_KNEE ?? -0.6);   // 深屈门槛（rad）
  const dbg = String(env.SQC_STRUT_DBG ?? '0') === '1';
  const bw = w.sk.massTotal * 9.81;
  if (fUp === 0 && fFwd === 0) return;

  for (const side of ['l', 'r'] as const) {
    const ki = body.dofByName(`knee_${side}`, 2);
    const ai = body.dofByName(`foot_${side}`, 2);
    const hi = body.dofByName(`hip_${side}`, 2);
    const fi = body.indexByKey.get(`foot_${side}`);
    const ti = body.indexByKey.get('torso');
    if (ki < 0 || ai < 0 || hi < 0 || fi === undefined || ti === undefined) continue;
    if (body.dofs[ki]!.angle > kneeMin) continue;             // 不够深屈
    const fz = body.footNormalForce(side, dt);
    if (fz < 0.1 * bw) continue;                               // 脚没承重

    const pa = body.dofs[ai]!.anchorWorld;
    const ph = body.dofs[hi]!.anchorWorld;
    const Jx = fFwd * dt;
    const Jy = fUp * dt;
    if (Jx === 0 && Jy === 0) continue;
    body.bodies[ti]!.applyImpulseAtPoint({ x: Jx, y: Jy, z: 0 }, { x: ph[0]!, y: ph[1]!, z: ph[2]! }, true);
    body.bodies[fi]!.applyImpulseAtPoint({ x: -Jx, y: -Jy, z: 0 }, { x: pa[0]!, y: pa[1]!, z: pa[2]! }, true);
    if (dbg) console.log(`STRUT t=${st.t.toFixed(3)} ${side} Fup=${fUp.toFixed(0)}N Ffwd=${fFwd.toFixed(0)}N Fmax=${fMax.toFixed(0)}`);
  }
}

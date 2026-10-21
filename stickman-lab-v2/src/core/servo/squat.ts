/** squat.ts —— 蹲下模块（2026-10-21 架构清理版）
 *
 * 蹲姿 = **一个写手**（squat.pairBase）+ **一个捕获点**（释放瞬间）+ **一套参数**（状态表）。
 *
 *   L0 基础力：释放瞬间按标准姿势算一次静态支撑力矩（子树+GRF），固定不变
 *   L1 回正力：pair 的 PD（kp·(ref−θ) − kd·ω），ref = 释放姿势目标角
 *   L2 阻尼：drive.step 的 td（唯一阻尼）
 *
 * 任何新增写手必须先在本文件登记，否则禁止。
 */

import { baseState, baseParams, baseAng } from './baseTable';
import { propose, PRI } from '../proposalBus';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 基础力缓存（释放瞬间捕获一次；离开蹲姿清空） */
let _sqBaseBuf: Float64Array | null = null;

/**
 * 蹲姿每帧：唯一关节力写手。
 * 基础力（固定）+ 回正目标角，全部经 proposalBus 的 pair 通道。
 */
export function squatPairBase(w: World, ctl: ControlModule): void {
  void ctl;
  if (baseState() !== 'squat') {
    _sqBaseBuf = null;
    return;
  }
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const g = 9.81;
  let mTot = 0;
  for (const rb of body.bodies) mTot += rb.mass();
  const N = mTot * g * 0.5;
  const com = new Float64Array(3);
  body.com(com);
  const comX = com[0]!;
  const fpos = (s: 'l' | 'r'): number => {
    const bi = body.indexByKey.get(`foot_${s}`);
    return bi === undefined ? 0 : body.bodies[bi]!.translation().x;
  };
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  // ── L0 基础力：释放瞬间（outputScale>0 首帧）按释放姿势算一次 ──
  if (_sqBaseBuf === null && w.drive.outputScale > 0) {
    const pl = fpos('l'), pr = fpos('r');
    const copL = cl(comX, pl - 0.12, pl + 0.12);
    const copR = cl(comX, pr - 0.12, pr + 0.12);
    _sqBaseBuf = new Float64Array(body.dofs.length);
    for (const d of body.dofs) {
      if (!(/^(hip|knee|foot|ankle|spine)/.test(d.name) && (d.axis === 0 || d.axis === 2))) continue;
      const a = d.anchorWorld, u = d.axisWorld;
      let tau = 0;
      for (const bi of body.subtree[d.joint]!) {
        const rb = body.bodies[bi]!;
        const c = rb.worldCom();
        const Fy = rb.mass() * -g;
        tau += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
      }
      if (/^(hip|knee|foot|ankle)_/.test(d.name)) {
        const isL = d.name.endsWith('_l');
        const cop = isL ? copL : copR;
        tau += u[2]! * ((cop - a[0]!) * N);
      }
      _sqBaseBuf[d.dofIndex] = -tau;
    }
  }

  // ── L1 回正：ref = 释放姿势目标角（captureAngFrom 写入） ──
  const bp = baseParams() as unknown as { pairC?: number };
  const cPair = Number(env.SQC_PAIR_C ?? bp.pairC ?? 0.7);
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    if (!(/^(hip|knee|foot|ankle|spine)/.test(d.name) && (d.axis === 0 || d.axis === 2))) continue;
    const base = _sqBaseBuf?.[d.dofIndex] ?? 0;
    const ref = baseAng(d.name, d.axis) ?? d.angle;
    propose({ dof: d.dofIndex, kind: 'pair', pri: PRI.action, c: cPair, rad: ref, tau: base, src: 'squat.pairBase' });
  }
}

// ── 蹲姿编排入口：法庭 + 注入（唯一入口）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

/** 蹲姿每物理步：法庭（目标/判死）+ 唯一写手 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatPairBase(w, ctl);
  courtInject(w, ctl);
}

/** squat.ts —— 蹲下模块（唯一入口，2026-10-21 重建）
 *
 * 职责只有两件：
 *   ① 脚：FootPad（自主抓地）+ 踝软限位（在 supportClean 的 ft 分支保留）
 *   ② 阻尼：td（drive 全局）+ srs + ow（kernel.dampTorque）
 *
 * 铁律：
 *   · 本模块**不写任何关节基础力/回正力/主动力矩**；
 *   · 目标姿势 = 法庭捕获的 ref（只读，永不跟随）；
 *   · 后续要加基础力/回正力，必须作为独立函数显式接入，并在本文档登记。
 */

import { baseState, baseParams } from './baseTable';
import { dampTorque } from './kernel';

export interface SquatCtx {
  body: {
    dofs: Array<{ name: string; axis: number; dofIndex: number; angle: number; vel: number }>;
  };
  dt: number;
}

/** 蹲姿每帧：只返回阻尼力矩（三层的 srs/ow 分量；td 由 drive 自己算） */
export function squatDamp(ctx: SquatCtx, dt: number, outwardOf: (dofIndex: number) => boolean): Array<{ dof: number; tau: number; src: string }> {
  if (baseState() !== 'squat') return [];
  const out: Array<{ dof: number; tau: number; src: string }> = [];
  const bp = baseParams();
  void bp;
  for (const d of ctx.body.dofs) {
    const part = /^(hip|knee|foot|ankle)/.test(d.name) ? 'leg'
      : /^spine/.test(d.name) ? 'spine'
      : /^neck/.test(d.name) ? 'neck'
      : /^(shoulder|elbow)/.test(d.name) ? 'arm' : 'other';
    const outward = outwardOf(d.dofIndex);
    const r = dampTorque({ part, vel: d.vel, velPrev: d.vel, tauMax: 200, inertiaLow: 0.01, velMax: 0, inertia: 0.01, dev: 0, outward, dt, b: 0, kd: NaN, tgt: NaN, acted: true, srsK: 0, kdBase: 0 });
    const tau = r.srs + r.ow;
    if (Math.abs(tau) > 0.01) out.push({ dof: d.dofIndex, tau, src: 'squat.damp' });
  }
  return out;
}


// ── 蹲姿基础力：脚主动蹬地（Jᵀ·F）+ 踝接触力闭环（2026-10-21 用户定稿）──
import { propose, PRI } from '../proposalBus';

/**
 * 力从脚来（唯一外力=地面反力）：
 *   1. 需求：每脚 N=W/2，作用点 CoP（初始姿势 CoM 投影，钳位脚内）
 *   2. 关节力矩 = Jᵀ·F：τ_j = −[子树重力 + N·(CoP−x_j)]（踝/膝/髋；脊柱只子树）
 *   3. **脚主动补足**：τ_ankle += Kf·(N − fz_measured)（接触力闭环，要多少发多少）
 * 全部走提案总线（kind:'torque' → drive.ff → squat 路径 out=bd.ff+td）。
 */
export function squatForce(w: World, ctl: ControlModule): void {
  void ctl;
  if (baseState() !== 'squat') return;
  const body = w.body;
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const g = 9.81;
  let mTot = 0;
  for (const rb of body.bodies) mTot += rb.mass();
  const N = (mTot * g) * 0.5;
  const com = new Float64Array(3);
  body.com(com);
  const comX = com[0]!;
  const fpos = (s: 'l' | 'r'): { x: number } => {
    const bi = body.indexByKey.get(`foot_${s}`);
    return bi === undefined ? { x: 0 } : { x: body.bodies[bi]!.translation().x };
  };
  const pl = fpos('l'), pr = fpos('r');
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const copL = cl(comX, pl.x - 0.12, pl.x + 0.12);
  const copR = cl(comX, pr.x - 0.12, pr.x + 0.12);
  const fzL = body.footNormalForce('l', w.dt);
  const fzR = body.footNormalForce('r', w.dt);
  const kF = Number(env.SQC_KF ?? 0.03);   // 接触力闭环增益（N·m/N）
  for (const d of body.dofs) {
    if (d.engineMotor) continue;
    const a = d.anchorWorld, u = d.axisWorld;
    let tau = 0;
    // 子树重力
    for (const bi of body.subtree[d.joint]!) {
      const rb = body.bodies[bi]!;
      const c = rb.worldCom();
      const Fy = rb.mass() * -g;
      tau += u[0]! * (-(c.z - a[2]!) * Fy) + u[2]! * ((c.x - a[0]!) * Fy);
    }
    // Jᵀ·F（脚蹬地需求；腿链）
    const isLeg = /^(hip|knee|foot|ankle)_/.test(d.name);
    if (isLeg) {
      const isL = d.name.endsWith('_l');
      const cop = isL ? copL : copR;
      tau += u[2]! * ((cop - a[0]!) * N);
      // 踝接触力闭环：实测不足 → 踝补
      if (/^(foot|ankle)_/.test(d.name)) {
        const fz = isL ? fzL : fzR;
        tau += u[2]! * (-kF * (N - fz) * 0.12);
      }
    }
    const out = -tau;
    if (Math.abs(out) > 1e-6) propose({ dof: d.dofIndex, kind: 'torque', pri: PRI.servo, tau: out, src: 'squat.base' });
  }
}

// ── 蹲姿编排入口：法庭 + 注入（唯一入口；后续基础力/回正力只加在这里）──
export {
  squatCourtSetup,
  courtStep,
  courtInject,
  type CourtState,
} from '../court';

import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep, courtInject } from '../court';

/** 蹲姿每物理步：法庭（目标/判死）+ 脚/阻尼注入 */
export function squatFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  squatForce(w, ctl);   // ★ 基础力：脚蹬地 Jᵀ·F + 踝接触闭环
  courtInject(w, ctl);
}

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
  courtInject(w, ctl);
}

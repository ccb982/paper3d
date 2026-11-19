/**
 * supportWbc —— 基础力/支撑的第一版纯计算层。
 *
 * 只读：Fz 预算 + 脚接触 + 静态腿逆动力学。
 * 不写 PD、不写 executor、不写脚目标。
 */
import type { World } from '../world';
import type { Sensors } from '../sensors';
import { computeFzBudget } from './fzBudget';
import { sampleFootContact } from './footContact';
import { solveStaticLegTorques, type LegIdTorque } from './legInverseDynamics';

export interface SupportWbcResult {
  fzL: number;
  fzR: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  ankleL: number;
  ankleR: number;
  valid: boolean;
}

export function computeSupportWbc(w: World, s: Sensors): SupportWbcResult {
  const body = w.body;
  const cL = sampleFootContact(w, 'l');
  const cR = sampleFootContact(w, 'r');
  const zL = body.bodies[body.indexByKey.get('foot_l')!]!.translation().z;
  const zR = body.bodies[body.indexByKey.get('foot_r')!]!.translation().z;
  const fzb = computeFzBudget(w, {
    fzTotal: cL.fz + cR.fz,
    fzNominal: w.sk.massTotal * 9.81,
    comZ: s.com[2]!, comVZ: s.comVel[2]!, comTargetZ: s.com[2]!, comY: s.com[1]!,
    zL, zR,
    contactL: cL.contact, contactR: cR.contact,
    copValidL: cL.copValid, copValidR: cR.copValid,
    dt: w.dt,
  });
  const l: LegIdTorque = solveStaticLegTorques(w, 'l', cL, fzb.fzLTarget);
  const r: LegIdTorque = solveStaticLegTorques(w, 'r', cR, fzb.fzRTarget);
  return {
    fzL: fzb.fzLTarget, fzR: fzb.fzRTarget,
    hipL: l.hip, hipR: r.hip,
    kneeL: l.knee, kneeR: r.knee,
    ankleL: l.ankle, ankleR: r.ankle,
    valid: fzb.valid && cL.contact && cR.contact,
  };
}

/** 力链 + 扰动联合检测：只读、只汇报，不修正。 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import { detectDirection, type DirectionResult } from './disturbance';
import { measureActualForceChain, type ActualForceChain } from './actualForceChain';
import { captureShankLeg } from './shankIK';
import { senseWholeBody, type WholeBodySense } from './wholeBodySense';

export interface ChainSense {
  direction: DirectionResult;
  chain: { l: ActualForceChain; r: ActualForceChain };
  contact: { l: boolean; r: boolean };
  whole: WholeBodySense;
}

export function senseChainAndDisturbance(w: World, ctl: ControlModule): ChainSense {
  const mk = (s: 'l' | 'r'): ActualForceChain => {
    const leg = captureShankLeg(w, s);
    return measureActualForceChain(w, s, leg.hip, leg.knee, leg.ankle);
  };
  const chain = { l: mk('l'), r: mk('r') };
  const fzL = Math.max(0, chain.l.F.y), fzR = Math.max(0, chain.r.F.y);
  const total = Math.max(1e-9, fzL + fzR);
  const copZ = (chain.l.cop.z * fzL + chain.r.cop.z * fzR) / total;
  const direction = detectDirection(ctl, w.dt, ctl.sensors.com[2]!, ctl.sensors.comVel[2]!, fzL, fzR, copZ);
  return { direction, chain, contact: { l: chain.l.contact, r: chain.r.contact }, whole: senseWholeBody(w, ctl) };
}

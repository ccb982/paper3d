/** 力链 + 扰动联合检测：只读、只汇报，不修正。 */
import type { World } from '../world';
import type { ControlModule } from '../control';
import { detectDirection, type DirectionResult } from './disturbance';
import { measureActualForceChain, type ActualForceChain } from './actualForceChain';
import { captureShankLeg } from './shankIK';
import { senseWholeBody, type WholeBodySense } from './wholeBodySense';
import { senseSkin, type SkinSense } from './skinSense';

export interface WeakLink {
  side: 'l' | 'r';
  joint: string;
  metric: 'tau' | 'fPerp' | 'contact' | 'cop';
  value: number;
  text: string;
}

export interface ChainSense {
  direction: DirectionResult;
  chain: { l: ActualForceChain; r: ActualForceChain };
  contact: { l: boolean; r: boolean };
  whole: WholeBodySense;
  skin: SkinSense;
  weak: WeakLink | null;
}

function pickWeak(chain: ChainSense['chain']): WeakLink | null {
  let best: WeakLink | null = null;
  const consider = (w: WeakLink): void => { if (!best || w.value > best.value) best = w; };
  for (const side of ['l', 'r'] as const) {
    const c = chain[side];
    consider({ side, joint: 'leg', metric: 'tau', value: c.tauUtil, text: `tauUtil=${c.tauUtil.toFixed(2)}` });
    const ratio = c.fParallel > 1 ? c.fPerp / c.fParallel : 1;
    consider({ side, joint: 'leg', metric: 'fPerp', value: ratio, text: `fPerp/fPar=${ratio.toFixed(2)}` });
    if (!c.copInside) consider({ side, joint: 'foot', metric: 'cop', value: 1, text: 'CoP 出支撑多边形' });
    if (!c.contact) consider({ side, joint: 'foot', metric: 'contact', value: 1, text: '无接触' });
  }
  return best;
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
  const weak = pickWeak(chain);
  return { direction, chain, contact: { l: chain.l.contact, r: chain.r.contact }, whole: senseWholeBody(w, ctl), skin: senseSkin(w), weak };
}

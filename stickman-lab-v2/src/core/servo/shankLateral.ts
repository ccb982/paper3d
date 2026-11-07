import type { CourtState as CS } from '../court';

export interface ShankLateralInput {
  side: 'l' | 'r';
  active: boolean;
  grip: boolean;
  dt: number;
  fadeHz: number;
  ikKnee0: number;
  ikFoot0: number;
  actualKnee0: number;
  actualKnee0Vel: number;
  foot0Min: number;
  foot0Max: number;
  fParallel: number;
  fPerp: number;
  /** 膝力额状面有符号侧向分量（低通） */
  fLat: number;
  /** 原始膝力侧向分量（仅用于快速触发） */
  fLatRaw: number;
  /** 释放时捕获的稳定力链（侧向只追相对偏差） */
  fPerp0: number;
  fParallel0: number;
  fLat0: number;
  /** 接触可行性（actualForceChain raw：接触/CoP/力矩/fParallel） */
  feasible: boolean;
  copInside: boolean;
  tauUtil: number;
  /** 摩擦锥利用率：0=最好，1=到边界 */
  frictionUse: number;
  frictionMax: number;
}

export interface ShankLateralOutput {
  knee0Target: number;
  foot0Target: number;
  knee0Ff: number;
  /** 相对释放基线的力链偏差 */
  ePerp: number;
  /** 相对释放基线的有符号侧向偏差 */
  eLat: number;
  soft: number;
  eLatRate: number;
  eLatRawRate: number;
  chainOk: boolean;
  active: boolean;
  fade: number;
  chainOpen: boolean;
  align: boolean;
  fParallel: number;
  fPerp: number;
  fLat: number;
  fLat0: number;
}

interface SideState {
  fade: number;
  open: boolean;
  eLatPrev: number;
  rate: number;
  eLatRawPrev: number;
  rawRate: number;
}

const _state = new WeakMap<CS, Map<'l' | 'r', SideState>>();
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function shankLateral(st: CS, i: ShankLateralInput): ShankLateralOutput {
  let m = _state.get(st);
  if (!m) { m = new Map(); _state.set(st, m); }
  let s = m.get(i.side);
  if (!s) { s = { fade: 0, open: false, eLatPrev: 0, rate: 0, eLatRawPrev: 0, rawRate: 0 }; m.set(i.side, s); }

  const on = i.active && i.grip;
  const a = 1 - Math.exp(-Math.max(0, i.dt) * 2 * Math.PI * Math.max(0.1, i.fadeHz));
  s.fade += ((on ? 1 : 0) - s.fade) * a;

  const openT = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_CHAIN_OPEN ?? 80));
  const closeT = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_CHAIN_CLOSE ?? 100));
  // 力链通 = 接触/CoP/摩擦锥/关节力矩可行，且相对释放基线的 fPerp 偏差不大。
  const ePerp = i.fPerp - i.fPerp0;
  const eLat = i.fLat - i.fLat0;
  const eLatRate = i.dt > 1e-9 ? (eLat - s.eLatPrev) / i.dt : 0;
  s.eLatPrev = eLat;
  s.rate = eLatRate;
  const eLatRaw = i.fLatRaw - i.fLat0;
  const eLatRawRate = i.dt > 1e-9 ? (eLatRaw - s.eLatRawPrev) / i.dt : 0;
  s.eLatRawPrev = eLatRaw;
  s.rawRate = eLatRawRate;
  const ePar = i.fParallel - i.fParallel0;
  const chainOk = i.feasible && i.copInside && i.tauUtil <= 1 && i.frictionUse <= i.frictionMax;
  const fAbs = Math.abs(eLat);
  // 主判据是接触可行性；只有不可行，或偏差大到异常，才动踝。
  const hardDev = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_CHAIN_HARD ?? 40));
  const deviated = !chainOk || fAbs >= hardDev;
  s.open = !deviated;

  const align = on && deviated;
  const forceAngle = clamp(Math.atan2(eLat, Math.max(1, Math.abs(i.fParallel))), -1.2, 1.2);
  const sideSign = i.side === 'l' ? 1 : -1;
  const ankleSignRaw = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ANKLE_SIGN ?? -1);
  const ankleSign = Number.isFinite(ankleSignRaw) && ankleSignRaw < 0 ? -1 : 1;
  const ankleK = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ANKLE_K ?? 1));
  const ankleCap = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_ANKLE_CAP ?? 0.3));
  // 膝盖不参与侧向回正：knee0 只回 IK/被动；侧向只动踝。
  const knee0Target = i.ikKnee0;
  const softLo = Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_SOFT_LO ?? hardDev));
  const softHi = Math.max(softLo + 1e-3, Math.abs(Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_SHANK_SOFT_HI ?? 100)));
  const soft = clamp((Math.abs(eLat) - softLo) / (softHi - softLo), 0, 1);
  const ankleDelta = align ? clamp(ankleSign * sideSign * forceAngle * ankleK, -ankleCap, ankleCap) : 0;
  // 先夹到关节可用 ROM，再按力链偏移软启动；40N 不放大力矩，100N 才到满。
  const deltaAvail = clamp(i.ikFoot0 + ankleDelta, i.foot0Min, i.foot0Max) - i.ikFoot0;
  const foot0Target = i.ikFoot0 + deltaAvail * soft * s.fade;

  // 膝盖不参与侧向回正：knee0 只回 IK/被动；回正层不出 ff。
  return {
    knee0Target,
    foot0Target,
    knee0Ff: 0,
    ePerp,
    eLat,
    soft,
    eLatRate,
    eLatRawRate,
    chainOk,
    active: on,
    fade: s.fade,
    chainOpen: s.open,
    align,
    fParallel: i.fParallel,
    fPerp: i.fPerp,
    fLat: i.fLat,
    fLat0: i.fLat0,
  };
}

/* READ-ONLY SENSOR: 本模块只采样，不写执行器；写手白名单见架构文档 112。 */
import type { World } from '../world';

export type FootContactState = 'airborne' | 'touchdown' | 'loaded' | 'slipping';

export interface FootSensorReading {
  side: 'l' | 'r';
  time: number;
  valid: boolean;
  contact: boolean;
  state: FootContactState;
  fz: number;
  fzFiltered: number;
  fzTarget: number;
  normalError: number;
  copValid: boolean;
  copX: number;
  copZ: number;
  copTargetX: number;
  copTargetZ: number;
  copErrorX: number;
  copErrorZ: number;
  copInside: boolean;
  copXFiltered: number;
  copZFiltered: number;
  copMarginX: number;
  copMarginZ: number;
  copMarginNorm: number;
  copVelX: number;
  copVelZ: number;
  copSpeed: number;
  copHalfX: number;
  copHalfZ: number;
  footX: number;
  footY: number;
  footZ: number;
  footSpeed: number;
  parts: { foot: number; arch: number; mfoot: number };
  contactEnterFz: number;
  contactExitFz: number;
}

interface SensorState {
  contact: boolean;
  contactFrames: number;
  fzLp: number;
  copXLp: number;
  copZLp: number;
  copVXLp: number;
  copVZLp: number;
  lastCopX: number;
  lastCopZ: number;
  hasCop: boolean;
  hasLastCop: boolean;
}

const COP_HALF_X = 0.09;
const COP_HALF_Z = 0.05;
const _state = new WeakMap<World, Map<'l' | 'r', SensorState>>();
/** 每帧缓存：同一 w.clock 内只采样/推进一次滤波器，所有消费者读同一份。 */
const _cache = new WeakMap<World, Map<'l' | 'r', { clock: number; reading: FootSensorReading }>>();

const getState = (w: World, side: 'l' | 'r'): SensorState => {
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  let s = m.get(side);
  if (!s) { s = { contact: false, contactFrames: 0, fzLp: 0, copXLp: 0, copZLp: 0, copVXLp: 0, copVZLp: 0, lastCopX: 0, lastCopZ: 0, hasCop: false, hasLastCop: false }; m.set(side, s); }
  return s;
};

/** 高精度足底感受：只采样/滤波/判定，不写执行器。 */
/** 法庭重开时清掉跨局接触/滤波状态。 */
export function resetFootSensor(w: World): void { _state.delete(w); _cache.delete(w); }

export function sampleFootContact(w: World, side: 'l' | 'r'): FootSensorReading {
  let cm = _cache.get(w);
  if (!cm) { cm = new Map(); _cache.set(w, cm); }
  const hit = cm.get(side);
  if (hit && hit.clock === w.clock) return hit.reading;
  const s = getState(w, side);
  const fz = w.body.footNormalForce(side, w.dt);
  const cop = new Float64Array(3);
  const copValid = w.body.footCoP(side, w.dt, cop);
  const bi = w.body.indexByKey.get(`foot_${side}`);
  const rb = bi !== undefined ? w.body.bodies[bi]! : null;
  const p = rb ? rb.translation() : { x: 0, y: 0, z: 0 };
  const v = rb ? rb.linvel() : { x: 0, y: 0, z: 0 };
  const footSpeed = Math.hypot(v.x, v.z);
  const W = w.sk.massTotal * 9.81;
  const enter = Math.max(20, W * 0.03);
  const exit = Math.max(8, enter * 0.35);
  const wasContact = s.contact;
  const wantContact = s.contact ? fz >= exit : fz > enter;
  if (wantContact === s.contact) s.contactFrames = 0;
  else if (++s.contactFrames >= 3) { s.contact = wantContact; s.contactFrames = 0; }
  const a = 1 - Math.exp(-w.dt / 0.02);
  // 接触切换时重置滤波，避免离地后 fzFiltered 仍停留在旧载荷
  if (s.contact !== wasContact) s.fzLp = fz;
  else s.fzLp += (fz - s.fzLp) * a;
  if (copValid) {
    if (!s.hasCop) { s.copXLp = cop[0]!; s.copZLp = cop[1]!; s.hasCop = true; }
    else { s.copXLp += (cop[0]! - s.copXLp) * a; s.copZLp += (cop[1]! - s.copZLp) * a; }
  }
  const target = { copX: p.x, copZ: p.z };
  // copInside 用滤波后的 CoP：raw CoP 在边界抖动会让 capacity/capFactor 逐帧翻转
  const copXCtrl = s.hasCop ? s.copXLp : (cop[0] ?? 0);
  const copZCtrl = s.hasCop ? s.copZLp : (cop[1] ?? 0);
  if (s.contact !== wasContact || !copValid) {
    s.hasLastCop = false;
    s.copVXLp = 0;
    s.copVZLp = 0;
  }
  let rawVX = 0;
  let rawVZ = 0;
  if (copValid && s.hasLastCop && w.dt > 1e-6) {
    rawVX = Math.max(-5, Math.min(5, (copXCtrl - s.lastCopX) / w.dt));
    rawVZ = Math.max(-5, Math.min(5, (copZCtrl - s.lastCopZ) / w.dt));
  }
  const av = 1 - Math.exp(-w.dt / 0.03);
  s.copVXLp += (rawVX - s.copVXLp) * av;
  s.copVZLp += (rawVZ - s.copVZLp) * av;
  if (copValid) { s.lastCopX = copXCtrl; s.lastCopZ = copZCtrl; s.hasLastCop = true; }
  const copMarginX = copValid ? COP_HALF_X - Math.abs(copXCtrl - p.x) : -COP_HALF_X;
  const copMarginZ = copValid ? COP_HALF_Z - Math.abs(copZCtrl - p.z) : -COP_HALF_Z;
  const copMarginNorm = Math.max(0, Math.min(1, Math.min(copMarginX / COP_HALF_X, copMarginZ / COP_HALF_Z)));
  const copInside = copValid && copMarginX > 0 && copMarginZ > 0;
  const state: FootContactState = !s.contact
    ? 'airborne'
    : (!copInside || footSpeed > 0.08)
      ? 'slipping'
      : fz > W * 0.15
        ? 'loaded'
        : 'touchdown';
  const parts = {
    foot: w.body.footPartNormalForce(side, 'foot', w.dt),
    arch: w.body.footPartNormalForce(side, 'arch', w.dt),
    mfoot: w.body.footPartNormalForce(side, 'mfoot', w.dt),
  };
  const vals = [fz, s.fzLp, p.x, p.y, p.z, v.x, v.z, copValid ? cop[0] : 0, copValid ? cop[1] : 0, copMarginX, copMarginZ, copMarginNorm, s.copVXLp, s.copVZLp, parts.foot, parts.arch, parts.mfoot];
  const reading: FootSensorReading = {
    side,
    time: w.clock,
    valid: vals.every(Number.isFinite),
    contact: s.contact,
    state,
    fz,
    fzFiltered: s.fzLp,
    fzTarget: 0.5 * W,
    normalError: 0.5 * W - fz,
    copValid,
    copX: copValid ? cop[0]! : 0,
    copZ: copValid ? cop[1]! : 0,
    copTargetX: target.copX,
    copTargetZ: target.copZ,
    copErrorX: copValid ? cop[0]! - target.copX : 0,
    copErrorZ: copValid ? cop[1]! - target.copZ : 0,
    copInside,
    copXFiltered: s.copXLp,
    copZFiltered: s.copZLp,
    copMarginX,
    copMarginZ,
    copMarginNorm,
    copVelX: s.copVXLp,
    copVelZ: s.copVZLp,
    copSpeed: Math.hypot(s.copVXLp, s.copVZLp),
    copHalfX: COP_HALF_X,
    copHalfZ: COP_HALF_Z,
    footX: p.x,
    footY: p.y,
    footZ: p.z,
    footSpeed,
    parts,
    contactEnterFz: enter,
    contactExitFz: exit,
  };
  cm.set(side, { clock: w.clock, reading });
  return reading;
}

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
  fzLp: number;
  copXLp: number;
  copZLp: number;
  hasCop: boolean;
}

const _state = new WeakMap<World, Map<'l' | 'r', SensorState>>();

const getState = (w: World, side: 'l' | 'r'): SensorState => {
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  let s = m.get(side);
  if (!s) { s = { contact: false, fzLp: 0, copXLp: 0, copZLp: 0, hasCop: false }; m.set(side, s); }
  return s;
};

/** 高精度足底感受：只采样/滤波/判定，不写执行器。 */
export function sampleFootContact(w: World, side: 'l' | 'r'): FootSensorReading {
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
  if (!s.contact && fz > enter) s.contact = true;
  else if (s.contact && fz < exit) s.contact = false;
  const a = 1 - Math.exp(-w.dt / 0.02);
  // 接触切换时重置滤波，避免离地后 fzFiltered 仍停留在旧载荷
  if (s.contact !== wasContact) s.fzLp = fz;
  else s.fzLp += (fz - s.fzLp) * a;
  if (copValid) {
    if (!s.hasCop) { s.copXLp = cop[0]!; s.copZLp = cop[1]!; s.hasCop = true; }
    else { s.copXLp += (cop[0]! - s.copXLp) * a; s.copZLp += (cop[1]! - s.copZLp) * a; }
  }
  const target = { copX: p.x, copZ: p.z };
  const copInside = copValid && Math.abs((cop[0] ?? 0) - p.x) < 0.09 && Math.abs((cop[1] ?? 0) - p.z) < 0.05;
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
  const vals = [fz, s.fzLp, p.x, p.y, p.z, v.x, v.z, copValid ? cop[0] : 0, copValid ? cop[1] : 0, parts.foot, parts.arch, parts.mfoot];
  return {
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
    footX: p.x,
    footY: p.y,
    footZ: p.z,
    footSpeed,
    parts,
    contactEnterFz: enter,
    contactExitFz: exit,
  };
}

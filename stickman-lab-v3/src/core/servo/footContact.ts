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
  fzHeld: number;
  copXHeld: number;
  copZHeld: number;
  loadValid: boolean;
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
  lastLoadT: number;
  lastLoadFz: number;
  lastLoadCopX: number;
  lastLoadCopZ: number;
}

const COP_HALF_X = 0.09;
const COP_HALF_Z = 0.05;
const _state = new WeakMap<World, Map<'l' | 'r', SensorState>>();
/** 每帧缓存：同一 w.clock 内只采样/推进一次滤波器，所有消费者读同一份。 */
const _cache = new WeakMap<World, Map<'l' | 'r', { clock: number; reading: FootSensorReading }>>();

type P2 = { x: number; z: number };
function cross(o: P2, a: P2, b: P2): number { return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x); }
function convexHull(points: P2[]): P2[] {
  if (points.length <= 2) return points;
  const pts = [...points].sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
function insideConvex(p: P2, hull: P2[]): boolean {
  if (hull.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!, b = hull[(i + 1) % hull.length]!;
    const c = cross(a, b, p);
    if (Math.abs(c) < 1e-9) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const getState = (w: World, side: 'l' | 'r'): SensorState => {
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  let s = m.get(side);
  if (!s) { s = { contact: false, contactFrames: 0, fzLp: 0, copXLp: 0, copZLp: 0, copVXLp: 0, copVZLp: 0, lastCopX: 0, lastCopZ: 0, hasCop: false, hasLastCop: false, lastLoadT: -1e9, lastLoadFz: 0, lastLoadCopX: 0, lastLoadCopZ: 0 }; m.set(side, s); }
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
  const contactSamples = w.body.footContactSamples(side, w.dt);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const c of contactSamples) {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  }
  const hasPoly = contactSamples.length > 0 && Number.isFinite(minX);
  const copHalfX = hasPoly ? Math.max(0.02, Math.max(p.x - minX, maxX - p.x)) : COP_HALF_X;
  const copHalfZ = hasPoly ? Math.max(0.02, Math.max(p.z - minZ, maxZ - p.z)) : COP_HALF_Z;
  const hull = hasPoly ? convexHull(contactSamples.map((c) => ({ x: c.x, z: c.z }))) : [];
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
  if (fz > 1 && copValid) {
    s.lastLoadT = w.clock;
    s.lastLoadFz = fz;
    s.lastLoadCopX = copXCtrl;
    s.lastLoadCopZ = copZCtrl;
  }
  const loadHoldT = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_LOAD_HOLD ?? 0.10);
  const loadValid = w.clock - s.lastLoadT <= Math.max(0.02, loadHoldT);
  const fzHeld = loadValid ? s.lastLoadFz : fz;
  const copXHeld = loadValid ? s.lastLoadCopX : copXCtrl;
  const copZHeld = loadValid ? s.lastLoadCopZ : copZCtrl;
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
  const copMarginX = copValid
    ? (hasPoly ? Math.min(copXCtrl - minX, maxX - copXCtrl) : copHalfX - Math.abs(copXCtrl - p.x))
    : -copHalfX;
  const copMarginZ = copValid
    ? (hasPoly ? Math.min(copZCtrl - minZ, maxZ - copZCtrl) : copHalfZ - Math.abs(copZCtrl - p.z))
    : -copHalfZ;
  const copMarginNorm = Math.max(0, Math.min(1, Math.min(copMarginX / copHalfX, copMarginZ / copHalfZ)));
  const copInside = copValid && (hull.length >= 3 ? insideConvex({ x: copXCtrl, z: copZCtrl }, hull) : (copMarginX > 0 && copMarginZ > 0));
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
    fzHeld,
    copXHeld,
    copZHeld,
    loadValid,
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
    copHalfX,
    copHalfZ,
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

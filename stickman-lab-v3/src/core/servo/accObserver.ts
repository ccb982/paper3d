/**
 * AccObserver —— 加速度观测器第一版。
 *
 * 关节：自适应标量 Kalman（原始 qdd 作为测量，高频尖峰提高 R）
 * COM：优先使用足底接触力合力（Newton），失败回退原始 COM 加速度
 */
import type { World } from '../world';
import { sampleMotionAcceleration } from './motionAcceleration';

interface JointState { x: number; p: number; init: boolean }
const _state = new WeakMap<World, Map<number, JointState>>();
const _comState = new WeakMap<World, { v: Float64Array; p: Float64Array; init: boolean }>();
const _baseLp = new WeakMap<World, Float64Array>();
const _comLp = new WeakMap<World, Float64Array>();
const _limbLp = new WeakMap<World, Map<string, { lin: Float64Array; ang: Float64Array; p: Float64Array }>>();
const LIMBS = ['thigh_l','thigh_r','shin_l','shin_r','foot_l','foot_r'] as const;

const num = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const v = Number(env[k]);
  return Number.isFinite(v) ? v : d;
};

export interface AccObserverOut {
  qdd: Float64Array;
  comAcc: Float64Array;
  baseAcc: Float64Array;
  limb: Map<string, { lin: Float64Array; ang: Float64Array }>;
  confidence: number;
}

export function sampleAccObserver(w: World): AccObserverOut {
  const raw = sampleMotionAcceleration(w);
  let m = _state.get(w);
  if (!m) { m = new Map(); _state.set(w, m); }
  const qdd = new Float64Array(raw.dofAcc.length);
  const qProc = Math.max(1e-6, num('SQC_ACC_OBS_Q', 50));
  const rBase = Math.max(1e-3, num('SQC_ACC_OBS_R', 400));
  for (let i = 0; i < qdd.length; i++) {
    const z = raw.dofAcc[i]!;
    let s = m.get(i);
    if (!s) { s = { x: z, p: rBase, init: true }; m.set(i, s); }
    const spike = Math.abs(z - s.x);
    const r = rBase + 4 * spike * spike;
    s.p += qProc * w.dt;
    const k = s.p / (s.p + r);
    s.x += k * (z - s.x);
    s.p *= (1 - k);
    qdd[i] = s.x;
  }

  const comAcc = new Float64Array(3);
  const contacts = w.body.allContactSamples(w.dt);
  const contactOk = contacts.length > 0;
  if (contactOk) {
    const mass = Math.max(1e-6, w.sk.massTotal);
    let fx=0, fy=0, fz=0;
    for (const c of contacts) { fx += c.fx; fy += c.fy; fz += c.fz; }
    comAcc[0] = fx / mass; comAcc[1] = fy / mass - 9.81; comAcc[2] = fz / mass;
  } else {
    comAcc[0] = raw.comAcc[0]!; comAcc[1] = raw.comAcc[1]!; comAcc[2] = raw.comAcc[2]!;
  }
  let cs = _comState.get(w);
  if (!cs) { cs = { v: new Float64Array(3), p: new Float64Array(3).fill(rBase), init: true }; _comState.set(w, cs); }
  const comQ = Math.max(1e-6, num('SQC_COM_ACC_Q', 30));
  const comR = Math.max(1e-3, num('SQC_COM_ACC_R', 250));
  for (let i = 0; i < 3; i++) {
    const z = comAcc[i]!;
    cs.p[i]! += comQ * w.dt;
    const r = comR + (contactOk ? 0 : 1e4);
    const k = cs.p[i]! / (cs.p[i]! + r);
    cs.v[i]! += k * (z - cs.v[i]!);
    cs.p[i]! *= (1 - k);
    comAcc[i] = cs.v[i]!;
  }

  const ti = w.body.indexByKey.get('torso') ?? -1;
  const baseAcc = new Float64Array(3);
  if (ti >= 0) {
    const a = 1 - Math.exp(-w.dt / Math.max(0.005, num('SQC_BASE_ACC_LP', 0.02)));
    let lp = _baseLp.get(w); if (!lp) { lp = new Float64Array(3); _baseLp.set(w, lp); }
    for (let i=0;i<3;i++) { lp[i]! += ((raw.bodyLinAcc[ti*3+i] ?? 0) - lp[i]!) * a; baseAcc[i] = lp[i]!; }
  }
  let lm = _limbLp.get(w); if (!lm) { lm = new Map(); _limbLp.set(w, lm); }
  const limb = new Map<string, { lin: Float64Array; ang: Float64Array }>();
  const la = 1 - Math.exp(-w.dt / Math.max(0.003, num('SQC_LIMB_ACC_LP', 0.05)));
  for (const key of LIMBS) {
    const bi = w.body.indexByKey.get(key); if (bi === undefined) continue;
    let st = lm.get(key); if (!st) { st = { lin: new Float64Array(3), ang: new Float64Array(3), p: new Float64Array(6).fill(50) }; lm.set(key, st); }
    for (let i=0;i<3;i++) {
      st.lin[i]! += ((raw.bodyLinAcc[bi*3+i] ?? 0) - st.lin[i]!) * la;
      st.ang[i]! += ((raw.bodyAngAcc[bi*3+i] ?? 0) - st.ang[i]!) * la;
    }
    limb.set(key, { lin: st.lin.slice(), ang: st.ang.slice() });
  }
  const comErr = Math.hypot(comAcc[0]!-raw.comAcc[0]!, comAcc[1]!-raw.comAcc[1]!, comAcc[2]!-raw.comAcc[2]!);
  const confidence = contactOk ? Math.max(0, Math.min(1, 1 - comErr / 5)) : 0.3;
  const out: AccObserverOut = { qdd, comAcc, baseAcc, limb, confidence };
  (globalThis as { __LIMB_ACC?: Record<string, number> }).__LIMB_ACC = (() => {
    const o: Record<string, number> = {};
    for (const key of ['thigh_l','shin_l','foot_l','torso'] as const) {
      const v = limb.get(key); if (!v) continue;
      o[`${key}Ax`] = v.lin[0]!; o[`${key}Ay`] = v.lin[1]!; o[`${key}Az`] = v.lin[2]!;
      o[`${key}Wx`] = v.ang[0]!; o[`${key}Wy`] = v.ang[1]!; o[`${key}Wz`] = v.ang[2]!;
    }
    return o;
  })();
  (globalThis as { __ACC_OBS?: Record<string, number> }).__ACC_OBS = {
    qddHip: qdd[w.body.dofByName('hip_l', 2)] ?? 0,
    qddKnee: qdd[w.body.dofByName('knee_l', 2)] ?? 0,
    qddAnkle: qdd[w.body.dofByName('foot_l', 2)] ?? 0,
    comAccX: comAcc[0]!, comAccY: comAcc[1]!, comAccZ: comAcc[2]!,
    baseAccX: baseAcc[0]!, baseAccY: baseAcc[1]!, baseAccZ: baseAcc[2]!, confidence: out.confidence,
  };
  return out;
}

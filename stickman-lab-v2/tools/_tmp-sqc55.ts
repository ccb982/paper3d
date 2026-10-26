import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

const SEED = Number(process.env.SEED ?? 1);
const T_END = Number(process.env.T_END ?? 6);
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
Math.random = mulberry32(SEED * 100 + 1);
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = true;
const tPre = Number(process.env.TPRE ?? 2.0);
for (let s = 0; s < Math.round(tPre / w.dt); s++) { supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l'); w.advance(1); }
ctl.actions.abort();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
w.controller = ctl;
w.driveEnabled = true;
w.reset();
ctl.resetCourt();
squatResetLimits(w);
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
if (process.env.FIXCAP === '1') {
  w.body.updateDofState();
  (await import('../src/core/servo/baseTable')).captureAngFrom(w.body.dofs);
  (ctl.warner as unknown as { captureSquatBase(): void }).captureSquatBase();
  console.log('[fixcap] 目标角按蹲姿口径重捕');
}

const deg = (r: number): string => (r * 57.2958).toFixed(1);
const ang = (n: string, ax: number): string => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? deg(w.body.dofs[i]!.angle) : '-';
};
const body = w.body;
console.log(`[setup] comY=${(ctl.sensors.com[1]! * 100).toFixed(1)} comX=${(ctl.sensors.com[0]! * 100).toFixed(1)} comZ=${(ctl.sensors.com[2]! * 100).toFixed(1)} p0=${deg(court.p0)} r0=${deg(court.r0)}`);
console.log(`[setup] hipL2=${ang('hip_l', 2)} kneeL2=${ang('knee_l', 2)} footL2=${ang('foot_l', 2)} hipL0=${ang('hip_l', 0)}`);
{
  const p = (n: string, ax: number): string => {
    const i = body.dofByName(n, ax);
    if (i < 0) return '-';
    const a = body.dofs[i]!.anchorWorld;
    return `(${(a[0]! * 100).toFixed(1)},${(a[1]! * 100).toFixed(1)},${(a[2]! * 100).toFixed(1)})`;
  };
  console.log(`[anchors] hip=${p('hip_l', 2)} knee=${p('knee_l', 2)} ankle=${p('foot_l', 2)}`);
  const L = (a: number[], b: number[]): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  const h = body.dofs[body.dofByName('hip_l', 2)]!.anchorWorld;
  const k = body.dofs[body.dofByName('knee_l', 2)]!.anchorWorld;
  const an = body.dofs[body.dofByName('foot_l', 2)]!.anchorWorld;
  console.log(`[len] thigh=${(L(h, k) * 100).toFixed(1)}cm shin=${(L(k, an) * 100).toFixed(1)}cm`);
}
const hipY = (): number => {
  const l = body.dofByName('hip_l', 0), r = body.dofByName('hip_r', 0);
  return ((body.dofs[l]!.anchorWorld[1]! + body.dofs[r]!.anchorWorld[1]!) / 2) * 100;
};
const pitchOf = (): number => {
  const i = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3')!;
  const q = body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  return Math.atan2(ux, Math.hypot(uy, uz)) * 57.2958 * Math.sign(uy >= 0 ? 1 : 1);
};
let nextLog = 0;
let pitchRef = NaN; let maxDev = 0; let pAt1 = NaN; let pAt2 = NaN;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.released) {
    const p = pitchOf();
    if (!Number.isFinite(pitchRef)) pitchRef = p;
    if (court.fall < 0) maxDev = Math.max(maxDev, Math.abs(p - pitchRef));
    const rel = court.t - court.settle;
    if (!Number.isFinite(pAt1) && rel >= 1.0) pAt1 = p;
    if (!Number.isFinite(pAt2) && rel >= 2.0) pAt2 = p;
  }
  if (court.t >= nextLog) {
    nextLog += 0.1;
    const fzL = body.footNormalForce('l', w.dt), fzR = body.footNormalForce('r', w.dt);
    const lim = (n: string, ax: number): string => {
      const i = body.dofByName(n, ax);
      if (i < 0) return '-';
      const d = body.dofs[i]!;
      return `[${(d.min * 57.3).toFixed(0)},${(d.max * 57.3).toFixed(0)}]τ${body.executor.appliedOf(i).toFixed(0)}`;
    };
    console.log(
      `t=${court.t.toFixed(2)} hipY=${hipY().toFixed(1)} com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[1]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)}) ` +
      `foot0=${lim('foot_l', 0)} hip0=${lim('hip_l', 0)} knee1=${lim('knee_l', 1)} foot2=${lim('foot_l', 2)} trunkPitch=${pitchOf().toFixed(1)}`
    );
  }
  if (court.fall >= 0) break;
}
console.log(`RESULT seed=${SEED} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'} reason=${court.reason} safeExit=${court.safeExit ?? '-'} ${court.safeReason ?? ''}`);
console.log(`[背] pitchRef=${pitchRef.toFixed(1)} @1s=${pAt1.toFixed(1)} @2s=${pAt2.toFixed(1)} maxDev=${maxDev.toFixed(1)}°`);
// ★ 姿态表就地打印（squatPoseTable 已随回退移除，探针自带，避免依赖 src 诊断函数）
{
  const one = (n: string, ax: number): string => {
    const i = body.dofByName(n, ax);
    return i >= 0 ? deg(body.dofs[i]!.angle) : '-';
  };
  console.log(`[标准姿态表] hip2=${one('hip_l', 2)} knee2=${one('knee_l', 2)} foot2=${one('foot_l', 2)} hip0=${one('hip_l', 0)} knee1=${one('knee_l', 1)} foot0=${one('foot_l', 0)} spine1/2/3=${one('spine1', 2)}/${one('spine2', 2)}/${one('spine3', 2)} neck=${one('neck', 2)} hipY=${hipY().toFixed(1)}cm comY=${(ctl.sensors.com[1]! * 100).toFixed(1)}cm`);
}

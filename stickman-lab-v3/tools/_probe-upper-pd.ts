import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { measureUpperLoads } from '../src/core/servo/upperForceChain';
import { captureSquatCourt, type CourtState } from '../src/core/court';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;

const MODE = String(process.env.UPPER_PATH ?? 'squatdown');
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
let court: CourtState | null = null;
if (MODE === 'setup') {
  court = squatCourtSetup(w, ctl, 2.0);
} else {
  w.switchPoseState('stand');
  ctl.actions.play('squatDown');
}
const SEC = Number(process.env.SEC ?? 3.0);

const deg = (v: number): string => (v * 57.29578).toFixed(1);
const pitchOf = (): number => {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  if (i === undefined) return 0;
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(ux, uy);
};
const ang = (n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.body.dofs[i]!.angle : 0;
};
const app = (n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.executor.ledger[i]!.applied : 0;
};
const yOf = (key: string): number => {
  const i = w.body.indexByKey.get(key);
  return i === undefined ? NaN : w.body.bodies[i]!.translation().y;
};
const ax = (n: string): string => {
  const i = w.body.dofByName(n, 2);
  if (i < 0) return '-';
  const u = w.body.dofs[i]!.axisWorld;
  return `(${u[0]!.toFixed(2)},${u[1]!.toFixed(2)},${u[2]!.toFixed(2)})`;
};
const log = (): void => {
  const t = court!.t;
  const pv = pitchOf();
  const torsoIdx = w.body.indexByKey.get('torso');
  let pelvisPitch = 0;
  if (torsoIdx !== undefined) { const q = w.body.bodies[torsoIdx]!.rotation(); const ux = 2 * (q.x * q.y - q.w * q.z); const uy = 1 - 2 * (q.x * q.x + q.z * q.z); pelvisPitch = Math.atan2(ux, uy); }
  for (const n of ['spine1', 'spine2', 'spine3', 'neck']) {
    const q = ang(n, 2);
    if (!j0.has(n)) j0.set(n, q);
    jointDevMax = Math.max(jointDevMax, Math.abs(q - j0.get(n)!));
  }
  const s1 = ang('spine1', 2);
  if (sp1Ref === null) sp1Ref = s1;
  sp1DevMax = Math.max(sp1DevMax, Math.abs(s1 - sp1Ref));
  const rel = pv - pelvisPitch;
  if (relRef === null) relRef = rel;
  relDevMax = Math.max(relDevMax, Math.abs(rel - relRef));
  const hipA = w.body.dofByName('hip_l', 0);
  const hy = hipA >= 0 ? w.body.dofs[hipA]!.anchorWorld[1]! : 0;
  if (hipYRef === null) hipYRef = hy;
  hipRiseMax = Math.max(hipRiseMax, hy - hipYRef);
  const cy = yOf('spine4');
  if (chestRef === null) chestRef = cy;
  chestRiseMax = Math.max(chestRiseMax, cy - chestRef);
  chestEnd = cy;
  const loads = measureUpperLoads(w);
  const ld = (n: string): number => loads.find((x) => x.name === n)?.torque[2] ?? 0;
  const sp4 = w.body.indexByKey.get('spine4');
  const avz = sp4 === undefined ? 0 : w.body.bodies[sp4]!.angvel().z;
  const hip = w.body.dofByName('hip_l', 0);
  const hipY = hip >= 0 ? w.body.dofs[hip]!.anchorWorld[1]! : NaN;
  console.log(
    `${t.toFixed(3)} ${deg(pitchOf()).padStart(7)} ${avz.toFixed(2).padStart(6)} | ` +
    `${ld('spine1').toFixed(0).padStart(5)} ${ld('spine2').toFixed(0).padStart(5)} ${ld('spine3').toFixed(0).padStart(5)} ${ld('neck').toFixed(0).padStart(5)} | ` +
    `${app('spine1', 2).toFixed(0).padStart(5)} ${app('spine2', 2).toFixed(0).padStart(5)} ${app('spine3', 2).toFixed(0).padStart(5)} ${app('neck', 2).toFixed(0).padStart(5)} | ` +
    `${deg(ang('spine1', 2)).padStart(6)} ${deg(ang('spine2', 2)).padStart(6)} ${deg(ang('spine3', 2)).padStart(6)} | ` +
    `${hipY.toFixed(3)} ${yOf('spine4').toFixed(3)} ${deg(ang('hip_l', 2)).padStart(6)} ${deg(ang('knee_l', 2)).padStart(6)} | ` +
    `${ctl.sensors.feet[0]!.fz.toFixed(0)} ${ctl.sensors.feet[1]!.fz.toFixed(0)}`,
  );
  if (court!.fall >= 0) console.log('FALL', court!.fall.toFixed(3), court!.reason);
};

let handoffT = -1;
let lastLog = -1;
let relRef: number | null = null;
let relDevMax = 0;
const j0 = new Map<string, number>();
let jointDevMax = 0;
let hipYRef: number | null = null;
let hipRiseMax = 0;
let chestRef: number | null = null;
let chestRiseMax = 0;
let chestEnd = 0;
let sp1Ref: number | null = null;
let sp1DevMax = 0;
console.log('t      pitch   avz  | G1 G2 G3 Gn | a1 a2 a3 an | sp1 sp2 sp3 angles | hipY  chestY hip2 knee2 | fzL fzR');
for (let s = 0; s < Math.round(12 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  if (!court && ctl.actions.status.active) {
    const a = (n: string, ax2: number): number => {
      const i = w.body.dofByName(n, ax2);
      return i >= 0 ? w.body.dofs[i]!.angle : Number.NaN;
    };
    const jt = 5 / 57.29578;
    const poseOk = Number.isFinite(a('hip_l', 2)) && Number.isFinite(a('knee_l', 2))
      && Math.abs(a('hip_l', 2) - 103.1 / 57.29578) < jt
      && Math.abs(a('knee_l', 2) + 102.1 / 57.29578) < jt
      && w.body.footNormalForce('l', w.dt) > 50 && w.body.footNormalForce('r', w.dt) > 50;
    const forced = ctl.actions.status.phase === '交接' && a('knee_l', 2) < -60 / 57.29578;
    if (poseOk || forced) {
      ctl.actions.abort();
      ctl.manual.clear();
      court = captureSquatCourt(w, ctl);
      handoffT = w.clock;
      console.log(`HANDOFF t=${w.clock.toFixed(2)} forced=${forced} pitch=${deg(pitchOf())} axes sp1=${ax('spine1')} sp2=${ax('spine2')} sp3=${ax('spine3')}`);
    }
  }
  if (court) {
    squatFrame(w, ctl, court);
    if (court.t >= 0 && court.t > lastLog + 0.0199) {
      lastLog = court.t;
      log();
    }
    if (court.fall >= 0) { console.log('FALL', court.fall.toFixed(3), court.reason); break; }
    if (court.t > SEC) break;
  }
  if (w.clock > 11) break;
}
void handoffT;
console.log(`SUMMARY fall=${court && court.fall >= 0 ? court.fall.toFixed(3) : '-'} jointDevMax=${(jointDevMax * 57.3).toFixed(1)}deg relDevMax=${(relDevMax * 57.3).toFixed(1)}deg hipRiseMax=${(hipRiseMax * 1000).toFixed(0)}mm chestRiseMax=${(chestRiseMax * 1000).toFixed(0)}mm sp1DevMax=${(sp1DevMax * 57.3).toFixed(1)}deg chestEnd=${chestEnd.toFixed(3)} tEnd=${court ? court.t.toFixed(3) : '-'}`);

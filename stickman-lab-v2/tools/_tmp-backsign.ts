/** _tmp-backsign: 标定"给某轴加正力矩 → 躯干 pitch / 髋高 / comX 往哪走"的符号。
 *  只读真实链路：法庭摆姿 → 释放 → 在 [rel 0.05, 0.35] 窗口内叠加 ±10 N·m 到单根轴。
 *  用途：写"背保持水平"之前先把符号量出来，不靠推断。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { propose, PRI } from '../src/core/proposalBus';

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Arm { name: string; dof: string; ax: number; tau: number }
const ARMS: Arm[] = [
  { name: 'base    ', dof: '', ax: 0, tau: 0 },
  { name: 'hip2 +10', dof: 'hip_l', ax: 2, tau: 10 },
  { name: 'hip2 -10', dof: 'hip_l', ax: 2, tau: -10 },
  { name: 'sp1  +10', dof: 'spine1', ax: 2, tau: 10 },
  { name: 'sp1  -10', dof: 'spine1', ax: 2, tau: -10 },
  { name: 'sp2  +10', dof: 'spine2', ax: 2, tau: 10 },
  { name: 'sp2  -10', dof: 'spine2', ax: 2, tau: -10 },
  { name: 'sp3  +10', dof: 'spine3', ax: 2, tau: 10 },
  { name: 'sp3  -10', dof: 'spine3', ax: 2, tau: -10 },
  { name: 'ft2  +10', dof: 'foot_l', ax: 2, tau: 10 },
  { name: 'ft2  -10', dof: 'foot_l', ax: 2, tau: -10 },
];

interface Out { pitch0: number; pitch1: number; comX0: number; comX1: number; hipY0: number; hipY1: number; axisZ: number; fall: number }

const W0 = 0, W1 = 0.05, W2 = 0.35;

function run(arm: Arm, seed: number): Out {
  Math.random = mulberry32(seed * 100 + 1);
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
  w.controller = ctl;
  w.reset();
  ctl.actions.idleEnabled = true;
  for (let s = 0; s < Math.round(2.0 / w.dt); s++) { supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l'); w.advance(1); }
  ctl.actions.abort();
  ctl.actions.idleEnabled = false;
  ctl.manual.clear();
  w.controller = ctl;
  w.driveEnabled = true;
  w.reset();
  ctl.resetCourt();
  squatResetLimits(w);
  const court: CourtState = squatCourtSetup(w, ctl, 2.0);

  const body = w.body;
  const pitchOf = (): number => {
    const i = body.indexByKey.get('spine4') ?? body.indexByKey.get('spine3')!;
    const q = body.bodies[i]!.rotation();
    const ux = 2 * (q.x * q.y - q.w * q.z);
    const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
    return Math.atan2(ux, uy) * 57.2958;
  };
  const hipY = (): number => {
    const l = body.dofByName('hip_l', 0), r = body.dofByName('hip_r', 0);
    return ((body.dofs[l]!.anchorWorld[1]! + body.dofs[r]!.anchorWorld[1]!) / 2) * 100;
  };
  const dofIdx = arm.dof ? body.dofByName(arm.dof, arm.ax) : -1;
  const axisZ = dofIdx >= 0 ? body.dofs[dofIdx]!.axisWorld[2]! : 0;

  let p0 = NaN, p1 = NaN, x0 = NaN, x1 = NaN, y0 = NaN, y1 = NaN;
  for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
    supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
    if (court.released && dofIdx >= 0) {
      const rel = court.t - court.settle;
      if (rel >= W1 && rel <= W2) {
        propose({ dof: dofIdx, kind: 'ext', pri: PRI.direct, tau: arm.tau, src: 'probe.backsign', channel: 'active' });
      }
    }
    w.advance(1);
    squatFrame(w, ctl, court);
    if (court.released) {
      const rel = court.t - court.settle;
      if (!Number.isFinite(p0) && rel >= W0) { p0 = pitchOf(); x0 = ctl.sensors.com[0]! * 100; y0 = hipY(); }
      if (!Number.isFinite(p1) && rel >= W2) { p1 = pitchOf(); x1 = ctl.sensors.com[0]! * 100; y1 = hipY(); }
    }
    if (court.fall >= 0) break;
  }
  return { pitch0: p0, pitch1: p1, comX0: x0, comX1: x1, hipY0: y0, hipY1: y1, axisZ, fall: court.fall >= 0 ? court.fall - court.settle : -1 };
}

const base = run(ARMS[0]!, 1);
const dp = base.pitch1 - base.pitch0;
console.log(`[base] pitch ${base.pitch0.toFixed(1)} → ${base.pitch1.toFixed(1)} (${dp >= 0 ? '+' : ''}${dp.toFixed(1)}°)  comX ${base.comX0.toFixed(1)} → ${base.comX1.toFixed(1)}  hipY ${base.hipY0.toFixed(1)} → ${base.hipY1.toFixed(1)}  fall=${base.fall < 0 ? 'none' : base.fall.toFixed(2)}`);
console.log('arm       axisWorldZ   Δpitch vs base    ΔcomX(cm)   ΔhipY(cm)   fall');
for (const a of ARMS.slice(1)) {
  const o = run(a, 1);
  const d = o.pitch1 - o.pitch0 - dp;
  const dcx = (o.comX1 - o.comX0) - (base.comX1 - base.comX0);
  const dhy = (o.hipY1 - o.hipY0) - (base.hipY1 - base.hipY0);
  const s = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(2);
  console.log(`${a.name}  az=${o.axisZ.toFixed(3).padStart(6)}   Δpitch=${s(d).padStart(7)}°        ΔcomX=${s(dcx).padStart(6)}    ΔhipY=${s(dhy).padStart(6)}   ${o.fall < 0 ? 'none' : o.fall.toFixed(2)}`);
}

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
const body = w.body;
const G = 9.81;

/** 某关节矢状需求的力矩（自由体：子树重力 + 本侧实测 GRF） */
const needTau = (name: string, side: 'l' | 'r' | null, copX: number, copZ: number, fz: number): number => {
  const di = body.dofByName(name, 2);
  if (di < 0) return NaN;
  const d = body.dofs[di]!;
  const a = d.anchorWorld, u = d.axisWorld;
  let tau = 0;
  for (const bi of body.subtree[d.joint]!) {
    const rb = body.bodies[bi]!;
    const c = rb.worldCom();
    const Fy = rb.mass() * -G;
    const rx = c.x - a[0]!, rz = c.z - a[2]!;
    tau += u[0]! * (-rz * Fy) + u[2]! * (rx * Fy);
  }
  if (side) {
    const rx = copX - a[0]!, rz = copZ - a[2]!;
    tau += u[0]! * (-rz * fz) + u[2]! * (rx * fz);
  }
  return -tau;
};
const copBuf = new Float64Array(6);
const hipY = (): number => {
  const l = body.dofByName('hip_l', 0), r = body.dofByName('hip_r', 0);
  return ((body.dofs[l]!.anchorWorld[1]! + body.dofs[r]!.anchorWorld[1]!) / 2) * 100;
};
const applied = (n: string, ax: number): number => { const i = body.dofByName(n, ax); return i >= 0 ? body.executor.appliedOf(i) : NaN; };
let nextLog = 0;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t >= nextLog) {
    nextLog += 0.25;
    const fzL = body.footNormalForce('l', w.dt), fzR = body.footNormalForce('r', w.dt);
    const okL = body.footCoP('l', w.dt, copBuf); const cLx = copBuf[0]!, cLz = copBuf[1]!;
    const okR = body.footCoP('r', w.dt, copBuf); const cRx = copBuf[0]!, cRz = copBuf[1]!;
    const row = (n: string, side: 'l' | 'r', cx: number, cz: number, fz: number): string => {
      const nd = needTau(n + '_' + side, side, cx, cz, fz);
      const ap = applied(n + '_' + side, 2);
      return `${n}:${ap.toFixed(0)}/${nd.toFixed(0)}(${(ap - nd).toFixed(0)})`;
    };
    console.log(
      `t=${court.t.toFixed(2)} hipY=${hipY().toFixed(1)} com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[1]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)}) ` +
      `fz=${fzL.toFixed(0)}/${fzR.toFixed(0)} cop=(${(okL ? cLx * 100 : NaN).toFixed(1)},${(okL ? cLz * 100 : NaN).toFixed(1)})/(${(okR ? cRx * 100 : NaN).toFixed(1)},${(okR ? cRz * 100 : NaN).toFixed(1)}) ` +
      `${row('hip', 'l', cLx, cLz, fzL)} ${row('knee', 'l', cLx, cLz, fzL)} ${row('foot', 'l', cLx, cLz, fzL)} ` +
      `S1:${applied('spine1', 2).toFixed(0)}/${needTau('spine1', null, 0, 0, 0).toFixed(0)} ` +
      `S2:${applied('spine2', 2).toFixed(0)}/${needTau('spine2', null, 0, 0, 0).toFixed(0)} ` +
      `S3:${applied('spine3', 2).toFixed(0)}/${needTau('spine3', null, 0, 0, 0).toFixed(0)} ` +
      `N:${applied('neck', 2).toFixed(0)} ` +
      `ang=(${(body.dofs[body.dofByName('spine1', 2)]!.angle * 57.3).toFixed(0)},${(body.dofs[body.dofByName('spine2', 2)]!.angle * 57.3).toFixed(0)},${(body.dofs[body.dofByName('spine3', 2)]!.angle * 57.3).toFixed(0)})`
    );
  }
  if (court.fall >= 0) break;
}
console.log(`RESULT seed=${SEED} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'} reason=${court.reason}`);

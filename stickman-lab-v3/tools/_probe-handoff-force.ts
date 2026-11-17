import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const T_END = Number(process.env.T_END ?? 9.0);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset();
w.switchPoseState('stand');
ctl.actions.play('squatDown');

let court: CourtState | null = null;
let handT = -1;
let lastPrint = -1;
const f = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : '-');
const tau = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.executor.ledger[i]?.applied ?? 0 : 0;
};
const ang = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.2958 : 0;
};
console.log('rel t phase | fzL fzR sum copZ | comX comZ comVZ | hip0L/R hip2L/R knee2L/R foot2L/R | tauHip2L/R tauKnee2L/R tauFoot2L/R');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  const t = w.clock;
  if (!court) {
    const knee = ang('knee_l', 2);
    const phase = ctl.actions.status.phase;
    if ((phase === '交接' && knee < -60) || (!ctl.actions.status.active && t > 4)) {
      ctl.actions.abort();
      ctl.manual.clear();
      court = captureSquatCourt(w, ctl);
      handT = t;
      console.log(`HANDOFF t=${t.toFixed(3)} knee=${knee.toFixed(1)} phase=${phase}`);
    }
  }
  if (court) squatFrame(w, ctl, court);
  if (handT < 0) continue;
  const rel = t - handT;
  if (rel < -0.30 || rel > 1.00) continue;
  if (t - lastPrint < 0.02 - 1e-9) continue;
  lastPrint = t;
  const fzL = w.body.footNormalForce('l', w.dt);
  const fzR = w.body.footNormalForce('r', w.dt);
  const ftL = ctl.perception.feet[0]!;
  const ftR = ctl.perception.feet[1]!;
  const copZ = (ftL.fz * ftL.copZ + ftR.fz * ftR.copZ) / Math.max(1, ftL.fz + ftR.fz);
  const c = ctl.sensors.com;
  const v = ctl.sensors.comVel;
  console.log(
    `${rel.toFixed(2)} ${t.toFixed(2)} ${ctl.actions.status.phase ?? '-'} | ${f(fzL, 0)} ${f(fzR, 0)} ${f(fzL + fzR, 0)} ${f(copZ, 3)} | ` +
    `${f(c[0]! * 100, 1)} ${f(c[2]! * 100, 1)} ${f(v[2]! * 100, 1)} | ` +
    `${f(ang('hip_l', 0))}/${f(ang('hip_r', 0))} ${f(ang('hip_l', 2))}/${f(ang('hip_r', 2))} ${f(ang('knee_l', 2))}/${f(ang('knee_r', 2))} ${f(ang('foot_l', 2))}/${f(ang('foot_r', 2))} | ` +
    `${f(tau('hip_l', 2), 0)}/${f(tau('hip_r', 2), 0)} ${f(tau('knee_l', 2), 0)}/${f(tau('knee_r', 2), 0)} ${f(tau('foot_l', 2), 0)}/${f(tau('foot_r', 2), 0)}`,
  );
  if (court && court.fall >= 0 && rel > 0.1) break;
}
console.log(`RESULT handT=${handT.toFixed(2)} fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);

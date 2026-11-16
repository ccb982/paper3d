import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { captureSquatCourt, type CourtState } from '../src/core/court';
import { squatFrame } from '../src/core/servo/squat';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset(); w.switchPoseState('stand');
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const ang = (n: string, ax = 2): string => { const i = w.body.dofByName(n, ax); return i >= 0 ? (w.body.dofs[i]!.angle * 57.3).toFixed(0) : '-'; };
const fy = (n: string): number => { const i = w.body.indexByKey.get(n); return i === undefined ? NaN : w.body.bodies[i]!.translation().y; };
let court: CourtState | null = null;
let last = -1;
for (let i = 0; i < Math.round(10 / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (!court && ctl.actions.status.active) {
    const c = ctl.sensors.com;
    const fzL = w.body.footNormalForce('l', w.dt);
    const fzR = w.body.footNormalForce('r', w.dt);
    const comY = c[1] ?? 1;
    const ang = (n: string, ax: number): number => { const i = w.body.dofByName(n, ax); return i >= 0 ? w.body.dofs[i]!.angle : Number.NaN; };
    const jt = 5 / 57.29578;
    const poseOk = Number.isFinite(ang('hip_l', 2)) && Number.isFinite(ang('knee_l', 2))
      && Math.abs(ang('hip_l', 2) - 103.1 / 57.29578) < jt
      && Math.abs(ang('knee_l', 2) + 102.1 / 57.29578) < jt
      && Math.abs(ang('foot_l', 2)) < 10 / 57.29578
      && Math.abs((c[0] ?? 0) - 0.010) < 0.03
      && Math.abs(c[2] ?? 0) < 0.03
      && fzL > 50 && fzR > 50;
    if (poseOk) {
      ctl.actions.abort();
      ctl.manual.clear();
      court = captureSquatCourt(w, ctl);
      console.log(`HANDOFF t=${w.clock.toFixed(2)} comY=${(comY * 100).toFixed(1)} fz=${fzL.toFixed(0)}/${fzR.toFixed(0)}`);
    }
  }
  if (court) squatFrame(w, ctl, court);
  if (w.clock - last >= 0.2) {
    last = w.clock;
    const c = ctl.sensors.com;
    const fzL = w.body.footNormalForce('l', w.dt);
    const fzR = w.body.footNormalForce('r', w.dt);
    console.log(`HO t=${w.clock.toFixed(2)} ${court ? (court.released ? 'SQ-Rel' : 'SQ-Set') : (ctl.actions.status.phase ?? '-')} comY=${((c[1] ?? 0) * 100).toFixed(1)} comX=${((c[0] ?? 0) * 100).toFixed(1)} footY=${(fy('foot_l') * 100).toFixed(1)} fz=${fzL.toFixed(0)}/${fzR.toFixed(0)} hip=${ang('hip_l')}/${ang('hip_r')} knee=${ang('knee_l')}/${ang('knee_r')} ankle=${ang('foot_l')}/${ang('foot_r')} fall=${court?.fall ?? -1}`);
  }
}

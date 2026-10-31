import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

const J = Number(process.env.J ?? 2);
const T_IMP = Number(process.env.T_IMP ?? 2.1);
const T_END = Number(process.env.T_END ?? 6.0);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;
const sp4 = w.body.indexByKey.get('spine4')!;
let fired = false;
let lastPrint = -1;
const cop = new Float64Array(3);
const f = (v: number, n = 1): string => v.toFixed(n).padStart(7);
const deg = (v: number): number => v * 57.3;

console.log('t     torsoZ headZ sp4Z comY  roll  hipZl hipZr kneeZl kneeZr footZl footZr k1L  k1R  f0L  f0R  fzL  fzR  copZL copZR  comZ  comVZ copZ load srvFz srvCop');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
    console.log(`IMPULSE t=${t.toFixed(3)} Jz=${J}`);
  }
  if (t - lastPrint < 0.1 - 1e-9) continue;
  lastPrint = t;
  const b = w.body;
  const z = (k: string): number => b.bodies[b.indexByKey.get(k)!]!.translation().z * 1000;
  const a = (n: string, ax: number): number => {
    const i = b.dofByName(n, ax);
    return i >= 0 ? deg(b.dofs[i]!.angle) : NaN;
  };
  const fz = (side: 'l' | 'r'): number => b.footNormalForce(side, w.dt);
  const cp = (side: 'l' | 'r'): number => (b.footCoP(side, w.dt, cop) ? cop[1]! * 1000 : NaN);
  const q = b.bodies[sp4]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.w * q.x + q.y * q.z);
  const roll = deg(Math.atan2(uz, Math.hypot(ux, uy)));
  const L = w.lateral.state;
  const srv = ctl.lateralServo;
  console.log(
    `${t.toFixed(3)} ${f(b.bodies[b.indexByKey.get('torso')!]!.translation().z * 1000)} ${f(b.bodies[b.indexByKey.get('head')!]!.translation().z * 1000)} ${f(b.bodies[b.indexByKey.get('spine4')!]?.translation().z * 1000 ?? 0)} ${f(b.bodies[b.indexByKey.get('torso')!]!.translation().y * 100, 1)} ${f(roll, 1)} ` +
    `${f(z('thigh_l'))} ${f(z('thigh_r'))} ${f(z('shin_l'))} ${f(z('shin_r'))} ${f(z('foot_l'))} ${f(z('foot_r'))} ` +
    `${f(a('knee_l', 1), 1)} ${f(a('knee_r', 1), 1)} ${f(a('foot_l', 0), 1)} ${f(a('foot_r', 0), 1)} ` +
    `${fz('l').toFixed(0).padStart(4)} ${fz('r').toFixed(0).padStart(4)} ${String(cp('l')).padStart(6)} ${String(cp('r')).padStart(6)} ` +
    `${f(L.comZ * 1000)} ${(L.comVelZ * 1000).toFixed(0).padStart(5)} ${f(L.copZ * 1000)} ${L.loadDiff.toFixed(0).padStart(5)} ` +
    `${srv.fzReq.toFixed(0).padStart(5)} ${(srv.copReq * 1000).toFixed(1).padStart(6)}`,
  );
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);

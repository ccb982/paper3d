import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { PROPOSALS } from '../src/core/proposalBus';

const J = Number(process.env.J ?? 2);
const T_IMP = Number(process.env.T_IMP ?? 2.1);
const T_END = Number(process.env.T_END ?? 3.4);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torso = w.body.indexByKey.get('torso')!;
const key = (name: string, ax: number): number => w.body.dofByName(name, ax);
const keys: Array<[string, number]> = [['foot_l', 0], ['foot_r', 0], ['hip_l', 0], ['hip_r', 0], ['knee_l', 2], ['knee_r', 2]];
let fired = false;
let last = -1;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torso]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
  }
  if (t - last < 0.1 - 1e-9) continue;
  last = t;
  const sums = new Map<string, number>();
  for (const [name, ax] of keys) {
    const di = key(name, ax);
    if (di < 0) continue;
    for (const p of PROPOSALS) {
      if (p.dof !== di || p.kind === 'pair' || p.kind === 'angle' || p.kind === 'motor' || p.kind === 'clear') continue;
      const k = `${name}/${ax}:${p.src}`;
      sums.set(k, (sums.get(k) ?? 0) + (p.tau ?? 0));
    }
  }
  const top = [...sums.entries()].filter(([, v]) => Math.abs(v) > 0.5).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' ');
  const L = w.lateral.state;
  console.log(`t=${t.toFixed(2)} com=${(L.comZ * 1000).toFixed(1)} cop=${(L.copZ * 1000).toFixed(1)} roll=${(L.roll * 57.3).toFixed(1)} fzL=${w.body.footNormalForce('l', w.dt).toFixed(0)} fzR=${w.body.footNormalForce('r', w.dt).toFixed(0)} | ${top}`);
}

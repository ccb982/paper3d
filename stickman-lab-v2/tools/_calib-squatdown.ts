import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup } from '../src/core/servo/squat';
import { staticBalance } from '../src/core/servo/staticBalance';

const env = process.env;
const K0 = 2.0, A0 = 0.5, L0 = -0.42, ARM0 = 0.5;
const PS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
for (const p of PS) {
  env.SQC_K = String(K0 * p);
  env.SQC_A = String(A0 * p);
  env.SQC_L = String(L0 * p);
  env.SQC_ARM = String(ARM0 * p);
  env.SQC_H = '0';
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  squatCourtSetup(w, ctl, 0.1);
  const body = w.body;
  const W = body.bodies.reduce((a, b) => a + b.mass(), 0) * 9.81;
  const c = ctl.sensors.com;
  const fp = (s: 'l' | 'r'): { x: number; z: number } => {
    const i = body.indexByKey.get('foot_' + s)!;
    const q = body.bodies[i]!.translation();
    return { x: q.x, z: q.z };
  };
  const l = fp('l'), r = fp('r');
  const buf = new Float64Array(body.dofs.length);
  staticBalance(body, buf, {
    l: { N: W / 2, copX: Math.max(l.x - 0.12, Math.min(l.x + 0.12, c[0]!)), copZ: Math.max(l.z - 0.06, Math.min(l.z + 0.06, c[2]!)) },
    r: { N: W / 2, copX: Math.max(r.x - 0.12, Math.min(r.x + 0.12, c[0]!)), copZ: Math.max(r.z - 0.06, Math.min(r.z + 0.06, c[2]!)) },
  });
  const tq = (n: string, ax = 2): number => { const i = body.dofByName(n, ax); return i >= 0 ? +buf[i]!.toFixed(1) : 0; };
  const a = (n: string): number => { const i = body.dofByName(n, 2); return i >= 0 ? +(body.dofs[i]!.angle * 57.3).toFixed(1) : 0; };
  console.log(JSON.stringify({
    p: +p.toFixed(2),
    a: { hip: a('hip_l'), knee: a('knee_l'), ankle: a('foot_l'), sp1: a('spine1'), sp2: a('spine2'), sp3: a('spine3'), neck: a('neck'), sh: a('shoulder_l'), el: a('elbow_l') },
    tq: { hip: tq('hip_l'), knee: tq('knee_l'), ankle: tq('foot_l'), sp1: tq('spine1'), sp2: tq('spine2'), sp3: tq('spine3'), neck: tq('neck'), sh: tq('shoulder_l'), el: tq('elbow_l') },
    lat: { hipL: tq('hip_l', 0), hipR: tq('hip_r', 0), kneeL: tq('knee_l', 0), kneeR: tq('knee_r', 0), footL: tq('foot_l', 0), footR: tq('foot_r', 0), sp1L: tq('spine1', 0), neck: tq('neck', 0) },
    tw: { hip: tq('hip_l', 1), knee: tq('knee_l', 1), foot: tq('foot_l', 1), sp1: tq('spine1', 1), sp2: tq('spine2', 1), sp3: tq('spine3', 1), neck: tq('neck', 1) },
    comX: +(c[0]! * 100).toFixed(1), comY: +(c[1]! * 100).toFixed(1),
  }));
}
